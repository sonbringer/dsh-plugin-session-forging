import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Records, ForgingError } from './records.js';
import { contentRevision } from './source.js';

export function reportedUsage(usage) {
  if (
    !usage ||
    !['inputTokens', 'outputTokens'].every(
      (key) => Number.isSafeInteger(usage[key]) && usage[key] >= 0
    )
  )
    return null;
  const buckets = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'];
  if (
    buckets.some(
      (key) => usage[key] !== undefined && (!Number.isSafeInteger(usage[key]) || usage[key] < 0)
    )
  )
    return null;
  const total = buckets.reduce((sum, key) => sum + (usage[key] ?? 0), 0);
  if (
    !Number.isSafeInteger(total) ||
    (usage.totalTokens !== undefined && usage.totalTokens !== total)
  )
    return null;
  return {
    ...Object.fromEntries(buckets.map((key) => [key, usage[key] ?? 0])),
    totalTokens: total,
  };
}
export function usageCost(usage, price) {
  if (!usage || !price) return null;
  const cost =
    (usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      usage.cacheReadTokens * price.cacheRead +
      usage.cacheWriteTokens * price.cacheWrite) /
    1000000;
  return Number.isFinite(cost) ? cost : null;
}
export function stepPolicy(config, events, now = Date.now()) {
  const start = events.findLast((e) => e.type === 'turn/start');
  const count = start
    ? events.filter((e) => e.type === 'step/start' && e.seq > start.seq).length
    : 0;
  const end = Math.min(
    config.deadlineAt ?? Infinity,
    start && config.maxTurnDurationMs !== null ? start.time + config.maxTurnDurationMs : Infinity
  );
  const remaining =
    config.steps.maxStepsPerTurn === null ? null : config.steps.maxStepsPerTurn - count;
  const final = remaining !== null && remaining > 0 && remaining <= config.steps.finalReplySteps;
  const wrap =
    final ||
    (remaining !== null && remaining <= config.steps.wrapUpSteps) ||
    (Number.isFinite(end) && end - now <= config.wrapUpLeadTimeMs);
  return {
    turn: start?.data.turn ?? null,
    startSeq: start?.seq ?? null,
    count,
    remaining,
    deadline: Number.isFinite(end) ? end : null,
    stage:
      remaining !== null && remaining <= 0
        ? 'step-limit'
        : end <= now
          ? 'time-limit'
          : final
            ? 'final'
            : wrap
              ? 'wrap-up'
              : 'work',
  };
}
export class Energon {
  constructor(forging, directory) {
    this.forging = forging;
    this.directory = directory;
    this.timers = new Map();
  }
  config(id) {
    return this.forging.known.get(id)?.binding.spark.energon;
  }
  ledger(id) {
    return new Records(join(this.directory, 'usage', contentRevision(id)));
  }
  async usage(id) {
    const records = (await this.ledger(id).list()).map((r) => r.value);
    return {
      tokens: records.reduce((sum, r) => sum + (r.usage?.totalTokens ?? 0), 0),
      cost: records.reduce((sum, r) => sum + (r.cost ?? 0), 0),
      unknownUsage: records.filter((r) => !r.usage || r.status !== 'settled').length,
      unknownCost: records.filter((r) => r.cost === null || r.status !== 'settled').length,
      calls: records.length,
    };
  }
  async quota(id, model) {
    const config = this.config(id),
      usage = await this.usage(id);
    if (config.tokenLimit !== null && (usage.unknownUsage || usage.tokens >= config.tokenLimit))
      return usage.unknownUsage
        ? 'Token usage is incomplete; further calls are blocked.'
        : 'Session Token quota reached.';
    if (config.costLimit != null) {
      if (usage.unknownCost)
        return 'Cost cannot be measured for every call; further calls are blocked.';
      if (usage.cost >= config.costLimit) return 'Session cost quota reached.';
      if (
        model &&
        !config.pricing?.some((p) => p.provider === model.provider && p.model === model.model)
      )
        return 'The selected model has no configured unit prices.';
    }
    return null;
  }
  async *stream(options, next) {
    const id = options.sessionId,
      config = this.config(id);
    const blocked = await this.quota(id, options);
    if (blocked) throw new ForgingError('ENERGON_LIMIT', blocked);
    const price =
      config.pricing?.find((p) => p.provider === options.provider && p.model === options.model) ??
      null;
    const key = randomUUID(),
      ledger = this.ledger(id);
    const record = {
      sessionId: id,
      provider: options.provider,
      model: options.model,
      price,
      currency: config.costCurrency ?? null,
      startedAt: Date.now(),
      status: 'pending',
      usage: null,
      cost: null,
    };
    await ledger.put(key, record, { immutable: true });
    try {
      for await (const chunk of next()) {
        if (chunk.type === 'usage') record.usage = reportedUsage(chunk.usage);
        yield chunk;
      }
    } finally {
      record.cost = usageCost(record.usage, price);
      record.status = 'settled';
      record.endedAt = Date.now();
      await ledger.put(key, record);
    }
  }
  clear(agent) {
    for (const timer of this.timers.get(agent)?.handles ?? []) clearTimeout(timer);
    this.timers.delete(agent);
  }
  arm(agent, state) {
    if (this.timers.get(agent)?.startSeq === state.startSeq) return;
    this.clear(agent);
    const entry = { startSeq: state.startSeq, handles: [] };
    this.timers.set(agent, entry);
    if (state.deadline === null) return;
    const current = () =>
      agent.status === 'running' &&
      agent.session.snapshotEvents().findLast((e) => e.type === 'turn/start')?.seq ===
        state.startSeq;
    const later = (at, callback) => {
      const delay = at - Date.now();
      const timer = setTimeout(
        () => {
          if (delay > 2147483647) later(at, callback);
          else if (current()) {
            try { callback(); }
            catch (error) { this.forging.ctx.logger.error(error); }
          }
        },
        Math.max(0, Math.min(delay, 2147483647))
      );
      timer.unref?.();
      entry.handles.push(timer);
    };
    const config = this.config(agent.id);
    if (config.wrapUpLeadTimeMs > 0)
      later(state.deadline - config.wrapUpLeadTimeMs, () => {
        agent.steer(
          this.forging.message({
            content: [
              {
                type: 'text',
                text: 'Energon: the time limit is approaching. Stop expanding scope; finish the current safe operation and give your final answer with unfinished work.',
              },
            ],
            source: { kind: 'session-forging:energon' },
          })
        );
      });
    later(state.deadline, () => {
      this.forging.notices.publish(agent.id, 'Energon：已达到时间限制。');
      agent.cancel({ kind: 'hook', reason: 'Energon time limit reached.' });
    });
  }
  async before(payload, next) {
    const { agent, modelSelection } = payload,
      config = this.config(agent.id);
    const state = stepPolicy(config, agent.session.snapshotEvents());
    const reason = ['step-limit', 'time-limit'].includes(state.stage)
      ? state.stage
      : await this.quota(agent.id, modelSelection);
    if (reason) {
      this.forging.notices.publish(agent.id, 'Energon：' + reason);
      return { kind: 'reject' };
    }
    this.arm(agent, state);
    const decision = await next();
    if (decision.kind !== 'enter') return decision;
    const text = [
      state.remaining === null
        ? ''
        : `This Turn has ${state.remaining} outer Agent steps left, including this one.`,
      state.deadline === null
        ? ''
        : `Time remaining: ${Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000))} seconds.`,
      state.stage === 'final'
        ? 'Final-answer reserve: no further tools may execute. Respond now with results and unfinished work.'
        : state.stage === 'wrap-up'
          ? 'Wrap up now. Avoid new work, leave the workspace safe, and prepare your final answer.'
          : '',
    ]
      .filter(Boolean)
      .join(' ');
    return text
      ? {
          ...decision,
          messages: [
            ...decision.messages,
            this.forging.message({
              content: [{ type: 'text', text: 'Energon: ' + text }],
              source: { kind: 'session-forging:energon' },
            }),
          ],
        }
      : decision;
  }
  async attach(agent) {
    const config = this.config(agent.id);
    if (config.maxTokens !== null) agent.options.maxTokens = config.maxTokens;
    else if (this.forging.known.get(agent.id).fork?.resetOutputCap) delete agent.options.maxTokens;
    const disposers = [
      agent.ctx.on('agent/pre-step', (payload, next) => payload.agent === agent ? this.before(payload, next) : next()),
      agent.ctx.on('agent/status', ({ agent: changed, status }) => {
        if (changed === agent && status === 'idle') this.clear(agent);
      }),
      agent.ctx.tools.guard((exec) => {
        if (exec.agent !== agent) return;
        const state = stepPolicy(config, agent.session.snapshotEvents());
        // The admitted Step has already been logged; include it in the final reserve.
        if (
          config.steps.maxStepsPerTurn !== null &&
          state.count > config.steps.maxStepsPerTurn - config.steps.finalReplySteps
        )
          return { reason: 'Energon final-answer reserve: respond without tools.' };
        if (state.deadline !== null && Date.now() >= state.deadline)
          return { reason: 'Energon time limit reached.' };
      }),
    ];
    const dispose = () => {
      this.clear(agent);
      for (const fn of disposers) fn();
    };
    const release = this.forging.ctx.effect(() => dispose);
    agent.ctx.effect(() => release);
  }
  close() {
    for (const agent of this.timers.keys()) this.clear(agent);
  }
}
