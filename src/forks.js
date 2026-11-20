import { contentRevision } from './source.js';
import { ForgingError } from './records.js';
import { presetId } from './presets.js';
import { validateResources } from './resources.js';

export function forkSpark(parent, soul, model) {
  const spark = structuredClone(parent);
  spark.soul = soul;
  spark.cog = { provider: model.provider, model: model.model, reasoningEffort: model.reasoningEffort ?? '' };
  spark.matrix = false;
  delete spark.council;
  spark.energon = { maxTokens: null, tokenLimit: null, maxTurnDurationMs: null, wrapUpLeadTimeMs: 0,
    steps: { maxStepsPerTurn: null, wrapUpSteps: 0, finalReplySteps: 0 },
    web: { searchMaxQueries: null, searchMaxResults: null, searchSummaryMaxChars: null } };
  return spark;
}

export function forkRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !['requestId', 'sessionId', 'atSeq'].includes(key))
    || typeof input.requestId !== 'string' || !input.requestId.trim() || input.requestId.length > 256
    || typeof input.sessionId !== 'string' || !input.sessionId.trim() || input.sessionId.length > 256
    || !Number.isSafeInteger(input.atSeq) || input.atSeq < 0) {
    throw new ForgingError('INVALID_FORK', 'Supply requestId, source sessionId and an exact native event atSeq.');
  }
  return structuredClone(input);
}

/** Freeze the cut before preparing files; retries never choose a newer snapshot. */
async function prepare(forging, request, id, inputRevision) {
  if (!await forging.view(request.sessionId)) throw new ForgingError('NOT_FORGED', 'Use native branching for ordinary Sessions.');
  const parent = forging.known.get(request.sessionId);
  if (!(await forging.states.get(request.sessionId))?.ready) throw new ForgingError('CREATION_INCOMPLETE', 'Source creation has not completed.');
  await validateResources(parent.composition.resources);
  const source = await forging.observe(request.sessionId);
  if (!source) throw new ForgingError('SESSION_MISSING', 'Fork source no longer exists.');
  try {
    const selected = source.events.findLast(event => event.type === 'agent-preset/selected')?.data.agentPreset ?? source.header.agentPreset;
    if (!forging.ownsSelection(parent, selected) || source.header.agentPreset !== presetId(parent)) throw new ForgingError('PRESET_CHANGED', 'Source no longer runs its fixed Preset.');
    const anchor = await forging.context.at(request.sessionId, request.atSeq);
    if (source.events[request.atSeq]?.seq !== request.atSeq) throw new ForgingError('INVALID_ANCHOR', 'Anchor is outside the observed source prefix.');
    const prefix = source.events.slice(0, request.atSeq + 1);
    const { modelSelectionProjectionDefinition: modelProjection } = await forging.ctx.loader.import('@deepseek-ai/dsh-agent');
    const selection = prefix.reduce(modelProjection.apply, modelProjection.init(source.header, 0));
    const model = selection.pending ?? selection.lastUsed ?? parent.model;
    await forging.ctx.llm.resolveCallConfig(model);
    const workspace = forging.ctx.workspaceRegistry.list().find(item => item.sessionIds.includes(request.sessionId));
    const intent = { inputRevision, source: parent.binding.source,
      spark: forkSpark(parent.binding.spark, anchor.soul, model), composition: parent.composition, model,
      workspaceId: workspace?.id ?? null, cwd: source.header.cwd,
      fork: { sessionId: request.sessionId, atSeq: request.atSeq, resetOutputCap: parent.binding.spark.energon.maxTokens !== null || parent.fork?.resetOutputCap === true, prefixRevision: contentRevision(prefix),
        persistedEventCount: Math.min(request.atSeq + 1, source.persistedEventCount ?? request.atSeq + 1),
        captures: (await forging.context.history(request.sessionId)).filter(record => record.requestSeq <= request.atSeq) } };
    await forging.forks.put(id, intent, { immutable: true });
    return intent;
  } finally { source[Symbol.dispose](); }
}

export async function forkSession(forging, request, signal) {
  signal?.throwIfAborted();
  const id = 'forged-' + contentRevision(['fork', request.requestId]);
  const inputRevision = contentRevision(request);
  let intent = await forging.forks.get(id);
  if (intent && intent.inputRevision !== inputRevision) throw new ForgingError('FORK_CONFLICT', 'Fork requestId already names different inputs.');
  intent ??= await prepare(forging, request, id, inputRevision);
  signal?.throwIfAborted();
  let plan = await forging.plans.get(id);
  if (plan && plan.inputRevision !== inputRevision) throw new ForgingError('FORK_CONFLICT', 'Child has another creation record.');
  if (!plan) {
    const binding = await forging.bindings.prepare({ sessionId: id, source: intent.source, sparkId: intent.spark.id, spark: intent.spark });
    plan = { inputRevision, workspaceId: intent.workspaceId, binding, displayPreset: await forging.displayName(binding.spark), composition: intent.composition, model: intent.model, fork: intent.fork };
    await forging.plans.put(id, plan, { immutable: true });
  }
  forging.known.set(id, plan);
  const existing = await forging.observe(id);
  if (existing) {
    try {
      if (existing.header.agentPreset !== presetId(plan) || existing.inheritedEventCount !== request.atSeq + 1
        || contentRevision(existing.events.slice(0, request.atSeq + 1)) !== plan.fork.prefixRevision) {
        throw new ForgingError('SESSION_CONFLICT', 'Existing child does not match its reserved fork.');
      }
    } finally { existing[Symbol.dispose](); }
  }
  const state = await forging.states.get(id);
  if (state?.ready) {
    if (!existing) throw new ForgingError('SESSION_MISSING', 'Completed child was deleted; it will not be recreated.');
    await forging.validate(id, forging.ctx.agents.get(id));
    return { sessionId: id };
  }
  const workspace = plan.workspaceId === null ? undefined : forging.ctx.workspaceRegistry.get(plan.workspaceId);
  if (plan.workspaceId !== null && !workspace) throw new ForgingError('WORKSPACE_NOT_FOUND', 'Reserved fork workspace is unavailable.');
  const { installModelSelection } = await forging.ctx.loader.import('@deepseek-ai/dsh-agent');
  const finishSetup = async agent => {
    await forging.attach(agent);
    await forging.validate(id, agent);
    if (workspace && !workspace.sessionIds.includes(id)) await workspace.attachSession(id);
    await forging.ctx.sessions.flush(agent.session);
    signal?.throwIfAborted();
    if (forging.closing) throw new ForgingError('PLUGIN_STOPPING', 'Session forging is stopping.');
    // Forked inbox/Goal behavior stays native. Its loop may run immediately after publication.
    await forging.states.put(id, { ready: true, suspended: state?.suspended ?? false });
  };
  const setup = async (agentCtx, agent) => {
    installModelSelection(agentCtx);
    await forging.mount(plan, agentCtx);
    // Preserve inherited selections; this child-owned event selects its own fixed definition.
    if (forging.ctx.agentPresets.presetForSession(agent.session) !== presetId(plan)) {
      agent.session.append('agent-preset/selected', { agentPreset: presetId(plan) });
    }
    await finishSetup(agent);
    return { commit() {
      signal?.throwIfAborted();
      if (forging.closing) throw new ForgingError('PLUGIN_STOPPING', 'Session forging is stopping.');
    } };
  };
  try {
    signal?.throwIfAborted();
    let agent = forging.ctx.agents.get(id);
    if (!agent) {
      if (existing) {
        ({ agent } = await forging.runtime.agents.resume({ resumeSessionId: id, agentOptions: { ...plan.model }, signal, setup }));
      } else {
        const source = await forging.observe(request.sessionId);
        if (!source) throw new ForgingError('SESSION_MISSING', 'Fork source no longer exists.');
        try {
          if (contentRevision(source.events.slice(0, request.atSeq + 1)) !== plan.fork.prefixRevision) throw new ForgingError('SOURCE_CHANGED', 'Reserved source prefix is missing or changed.');
          const { buildForkSeed } = await forging.ctx.loader.import('@deepseek-ai/dsh-session/fork');
          ({ agent } = await forging.runtime.agents.create({ sessionId: id, seed: buildForkSeed(source.events, request.atSeq),
            parentSource: { sessionId: request.sessionId, endSeq: plan.fork.persistedEventCount },
            inheritedEventCount: request.atSeq + 1, meta: { cwd: intent.cwd, isSeeded: true, agentPreset: presetId(plan) },
            agentOptions: { ...plan.model }, signal, setup }));
        } finally { source[Symbol.dispose](); }
      }
    } else await finishSetup(agent);
    await forging.attach(agent);
    await forging.ctx.sessions.flush(agent.session);
    if (state?.suspended) await forging.ctx.workspaceRegistry.unarchiveSession(id);
    await forging.states.put(id, { ready: true, suspended: false });
    return { sessionId: id };
  } catch (error) {
    await forging.states.put(id, { ready: false, suspended: state?.suspended ?? false }).catch(cause => forging.ctx.logger.error(cause));
    const partial = await forging.observe(id);
    if (partial) {
      partial[Symbol.dispose]();
      await forging.suspend(id).catch(cause => forging.ctx.logger.error(cause));
    }
    throw error;
  }
}
