import { sendFirstMessage, checkFirstMessage } from './first-message.js';
import { Quantity, saveSessionSpark } from './quantity.js';
import { join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { SourceRegistry } from './sources.js';
import { SessionBindings } from './bindings.js';
import { contentRevision, isNativeExample, readOnlyExampleError } from './source.js';
import { Records, ForgingError } from './records.js';
import { capturePreset, definition, presetId, sparkPresetName, isForgingPreset } from './presets.js';
import { validateResources } from './resources.js';
import { ForgingContext, SOUL_CONTEXT } from './context.js';
import { forkRequest, forkSession } from './forks.js';
import { ForkNotices } from './notices.js';
import { Rally } from './rally.js';
import { Energon } from './energon.js';
import { councilList, councilDocument } from './council.js';
import { attachFeatures } from './session-features.js';
import { catalog, validateSpark, sourcePreview, sourceImport, sourceExport, saveSourceCopy, saveSparkCopy, workbenchCreate } from './workbench.js';
import { registerForkCommand } from './commands.js';

/** Host-only orchestration; Workspace and Session membership remain native facts. */
export class SessionForging {
  constructor(ctx, directory) {
    this.ctx = ctx;
    this.sources = new SourceRegistry(join(directory, 'sources'));
    this.bindings = new SessionBindings(join(directory, 'bindings'), this.sources);
    this.plans = new Records(join(directory, 'creations'));
    this.states = new Records(join(directory, 'states'));
    this.forks = new Records(join(directory, 'forks'));
    this.quantity = new Quantity(this, directory);
    this.previousReceipts = new Records(join(directory, 'first-messages'));
    this.mountQueue = Promise.resolve();
    this.presetAliases = new Map();
    this.sessionSparkSaves = new Records(join(directory, 'session-spark-saves'));
    this.context = new ForgingContext(this, directory);
    this.known = new Map();
    this.rallies = new Rally(this, directory);
    this.energon = new Energon(this, directory);
    this.featureSchemas = new WeakMap();
    this.registrations = new Map();
    this.opening = new Map();
    this.attached = new Map();
    this.featureReady = new WeakSet();
    this.attachmentErrors = new WeakMap();
    this.notices = new ForkNotices();
    this.quarantines = new Set();
    this.queue = Promise.resolve();
    this.closing = false;
    this.closed = new Promise(resolve => { this.signalClose = resolve; });
  }

  async start() {
    const { isAgentLoopRequest, createUserMessage } = await this.ctx.loader.import('@deepseek-ai/dsh-llm');
    this.message = createUserMessage;
    // This registry mounts ordinary DSH compositions in the forging plugin's own Cordis realm.
    // The public mode picker only reads the registry in the host realm.
    const { default: AgentPresetRegistry } = await this.ctx.loader.import('@deepseek-ai/dsh-agent-preset-registry');
    const realm = this.ctx.isolate('agentPresets');
    const registry = realm.plugin(AgentPresetRegistry, { default: 'standard' });
    await registry.await();
    await realm.inject(['agentPresets'], local => { this.runtime = local; }).await();
    if (!this.runtime || (await this.runtime.agentPresets.list()).length)
      throw new Error('Could not initialize an independent forging preset registry.');
    const context = this.context, energon = this.energon;
    this.ctx.on('llm/stream', async function* (options, next) {
      if (isAgentLoopRequest(options) && context.forging.known.has(options.sessionId)) {
        await context.admit(options);
        yield* energon.stream(options, next);
      } else yield* next();
    });
    for (const { id, value } of await this.plans.list()) {
      if (value?.binding?.sessionId !== id) throw new ForgingError('CORRUPT_RECORD', 'Creation identity mismatch.');
      this.known.set(id, value);
    }
    await this.rallies.loadRemovals();
    await this.rallies.loadLegacyMissions();
    for (const { id, value } of await this.previousReceipts.list()) {
      if (value.sent && value.alias) this.presetAliases.set(id, value.alias);
    }
    this.ctx.on('session/created', session => {
      const plan = this.known.get(session.id);
      const marked = isForgingPreset(session.header.agentPreset) && (plan || session.id.startsWith('forged-'));
      const copied = !plan && session.header.isSeeded && session.snapshotEvents().some(event =>
        (event.type === 'agent-preset/selected' && /^session-forging-[a-f0-9]{64}$/.test(event.data.agentPreset))
        || (event.type === 'user/message' && event.data.source?.kind === 'runtime-context'
          && event.data.source.sections?.some(section => section.name === SOUL_CONTEXT)));
      if (!marked && !copied) return;
      if (!plan || session.header.agentPreset !== presetId(plan)) {
        this.quarantine(session);
        throw new ForgingError('UNBOUND_SESSION', 'Use 锻造分支 or sessionForging.fork; native branching cannot bind this forged Session.');
      }
    }, { global: true });
    this.ctx.on('agent/created', ({ agent }) => this.attach(agent), { global: true });
    this.ctx.on('workspace/session-unarchiving', async ({ sessionId }) => {
      if (!this.closing && this.known.has(sessionId) && !this.ctx.agents.get(sessionId)) {
        await this.openBoundAgent(this.known.get(sessionId));
      }
    });
    // Preset audits wait for Loader activation; do not await them inside apply().
    this.ready = Promise.race([this.ctx.fiber.await(), this.closed]).then(async () => {
      if (this.closing) return;
      for (const [id] of this.known) {
        if (this.closing) break;
        try {
          const state = await this.states.get(id);
          if (state?.ready && (state.suspended || !this.ctx.workspaceRegistry.archivedSessionIds.includes(id))) await this.restoreOnce(id);
          else if (this.ctx.agents.get(id)) await this.attach(this.ctx.agents.get(id));
        } catch (error) { this.ctx.logger.error(error); }
      }
    });
    this.ready.catch(error => this.ctx.logger.error(error));
  }

  async displayName(spark) {
    const base = sparkPresetName(spark);
    const occupied = new Set((await this.ctx.agentPresets.list()).map(row => row.id));
    let name = base;
    for (let n = 1; occupied.has(name); n++) name = base + '（锻造 ' + n + '）';
    return name;
  }

  ownsSelection(plan, selected) {
    return selected === presetId(plan) || (typeof selected === 'string' &&
      selected === this.presetAliases.get(plan.binding.sessionId));
  }

  withDefinition(plan, id, operation) {
    // Each same-name mount retains its own generation. Serialize only the interval
    // in which that name is registered in the private registry.
    const task = this.mountQueue.then(async () => {
      await this.validate(plan.binding.sessionId);
      const registry = this.runtime.agentPresets;
      const remove = await registry.register({ ...definition(plan), id });
      this.registrations.set(id, remove);
      try { return await operation(registry); }
      finally { try { await remove(); } finally { this.registrations.delete(id); } }
    });
    this.mountQueue = task.catch(() => {});
    return task;
  }

  mount(plan, agentCtx, id = presetId(plan)) {
    return this.withDefinition(plan, id, registry => registry.mount(agentCtx, id));
  }

  openBoundAgent(plan, cwd) {
    const id = plan.binding.sessionId;
    let pending = this.opening.get(id);
    if (!pending) {
      pending = this.openOnce(plan, cwd).finally(() => this.opening.delete(id));
      this.opening.set(id, pending);
    }
    return pending;
  }

  async openOnce(plan, cwd) {
    const id = plan.binding.sessionId;
    const live = this.ctx.agents.get(id);
    if (live) {
      await this.validate(id, live);
      return live;
    }
    const { installModelSelection } = await this.ctx.loader.import('@deepseek-ai/dsh-agent');
    const setup = async (agentCtx, agent) => {
      installModelSelection(agentCtx);
      const selected = this.ctx.agentPresets.presetForSession(agent.session);
      if (!this.ownsSelection(plan, selected)) throw new ForgingError('PRESET_CHANGED', 'Session selected another Preset.');
      await this.mount(plan, agentCtx, selected);
    };
    const agentOptions = { ...plan.model };
    const handle = cwd === undefined
      ? await this.runtime.agents.resume({ resumeSessionId: id, agentOptions, setup })
      : await this.runtime.agents.create({ sessionId: id, agentOptions, setup,
          meta: { cwd: await realpath(cwd), agentPreset: presetId(plan) } });
    return handle.agent;
  }

  async validate(id, agent) {
    const plan = this.known.get(id);
    if (!plan) throw new ForgingError('NOT_FORGED', 'Session has no forging creation record.');
    const stored = await this.plans.get(id);
    if (!stored || contentRevision(stored) !== contentRevision(plan)) throw new ForgingError('CREATION_CHANGED', 'Fixed creation record is missing or changed.');
    const binding = await this.bindings.get(id);
    if (binding.revision !== plan.binding.revision) throw new ForgingError('BINDING_CHANGED', 'Creation no longer matches its fixed binding.');
    await this.bindings.readSoul(id);
    await validateResources(plan.composition.resources);
    if (agent) {
      if (!this.ownsSelection(plan, this.ctx.agentPresets.presetForSession(agent.session))) {
        throw new ForgingError('PRESET_CHANGED', 'Session no longer runs its fixed forging Preset.');
      }
      const current = agent.ctx.tools.schemas(agent);
      const additions = this.featureSchemas.get(agent) ?? new Map();
      if (current.some(tool => !plan.composition.tools.some(expected => expected.name === tool.name) && !additions.has(tool.name))) {
        throw new ForgingError('TOOLS_CHANGED', 'Session exposes tools outside its fixed capability selection.');
      }
      for (const [name, revision] of additions) {
        const tool = current.find(t => t.name === name);
        if (!tool || contentRevision(tool) !== revision) throw new ForgingError('TOOLS_CHANGED', 'Session feature tool changed: ' + name);
      }
      for (const expected of plan.composition.tools) {
        const actual = current.find(tool => tool.name === expected.name);
        if (!actual || contentRevision(actual) !== (additions.get(expected.name) ?? contentRevision(expected))) throw new ForgingError('TOOLS_CHANGED', `Fixed tool is missing or changed: ${expected.name}`);
      }
    }
    return plan;
  }

  async attach(agent) {
    if (!this.known.has(agent.id)) return;
    if (this.attachmentErrors.has(agent)) throw this.attachmentErrors.get(agent);
    if (this.attached.has(agent)) return;
    const plan = this.known.get(agent.id);
    const dispose = agent.ctx.effect(() => {
      const guard = agent.ctx.on('agent/pre-step', async (payload, next) => {
        if (payload.agent !== agent) return next();
        try {
          if (this.closing) throw new ForgingError('PLUGIN_STOPPING', 'Session forging is stopping.');
          const state = await this.states.get(agent.id);
          if (!this.featureReady.has(agent)) throw new ForgingError('CREATION_INCOMPLETE', 'Session features have not finished attaching.');
          if (!state?.ready) throw new ForgingError('CREATION_INCOMPLETE', 'Session creation has not completed.');
          await this.validate(agent.id, payload.agent);
          return next();
        } catch (error) { this.ctx.logger.error(error); return { kind: 'reject' }; }
      });
      const restriction = agent.ctx.tools.restrict({ allow: plan.binding.spark.components.tools });
      return () => {
        try { guard(); restriction(); }
        finally { this.attached.delete(agent); this.featureReady.delete(agent); }
      };
    });
    this.attached.set(agent, dispose);
    try {
      registerForkCommand(agent.ctx, this, agent);
      await this.validate(agent.id, agent);
      await attachFeatures(this, agent);
      await this.validate(agent.id, agent);
      this.featureReady.add(agent);
    } catch (error) { this.attachmentErrors.set(agent, error); throw error; }
  }

  async modelDefaults(selection) { return JSON.parse(JSON.stringify(await this.ctx.llm.resolveCallConfig(selection))); }
  catalog(workspaceId) { return catalog(this, workspaceId); }
  validateSpark(text) { return validateSpark(text); }
  sourcePreview(text) { return sourcePreview(text); }
  sourceImport(text, revision) { return this.enqueue(() => sourceImport(this, text, revision)); }
  sourceExport(reference) { return sourceExport(this, reference); }
  saveSourceCopy(text) { return this.enqueue(() => saveSourceCopy(this, text)); }
  saveSparkCopy(sourceText, spark) { return this.enqueue(() => saveSparkCopy(this, sourceText, spark)); }
  quantityList() { return this.quantity.list(); }
  quantitySet(text, sparkId, enabled) { return this.enqueue(() => this.quantity.publish(text, sparkId, enabled)); }
  quantityCreate(input) { return this.enqueue(() => this.quantity.create(input)); }
  changeSpark(source, sparkId, spark) {
    return this.enqueue(async () => {
      const updated = await this.sources.changeSpark(source, sparkId, spark);
      if (spark === null) await this.quantity.withdraw(source.id, sparkId);
      return updated;
    });
  }
  saveSessionSpark(input) { return this.enqueue(() => saveSessionSpark(this, input)); }
  workbenchCreate(input) { return workbenchCreate(this, input); }
  // Model tools call the session-bound service directly. Operator RPCs may also
  // administer durable grants that outlive the current browser connection.
  requireOperator() {
    const principal = this.ctx.invocation?.peer.principal;
    if (principal && principal.kind !== 'owner') throw new ForgingError('ACCESS_DENIED', '需要宿主所有者权限。');
  }
  rallyGrant({ sessionId, workspaceId, enabled }) {
    this.requireOperator();
    return this.enqueue(() => this.rallies.grant(sessionId, workspaceId, enabled));
  }
  rallyMembers(id, scope) {
    this.requireOperator();
    return this.rallies.members(id, scope);
  }
  rallyRevive(input) {
    this.requireOperator();
    return this.enqueue(() => this.rallies.revive(input));
  }
  rallyRemove(input) {
    this.requireOperator();
    return this.enqueue(() => this.rallies.remove(input));
  }
  async rallyRemovalRevision(after, signal) {
    this.requireOperator();
    const notice = await this.rallies.removalNotices.read('members', after, signal);
    return notice?.revision ?? null;
  }
  rally(input, signal) { this.requireOperator(); return this.enqueue(() => this.rallies.send(structuredClone(input), signal)); }
  councilDocument(input) { this.requireOperator(); return this.enqueue(() => councilDocument(this, input)); }
  async collaboration(id) {
    this.requireOperator();
    if (!await this.view(id)) throw new ForgingError('NOT_FORGED', 'Select a forged Session.');
    const spark = this.known.get(id).binding.spark;
    const rallyRemoved = this.rallies.removed.has(id);
    const leader = spark.matrix && !rallyRemoved;
    const council = spark.council?.enabled ? await councilList(this, id) : undefined;
    if (council) council.guidance = council.path
      ? (spark.runtime?.complete ? 'runtime-context' : 'system-prompt') : null;
    return { ...(council ? { council } : {}),
      rallyRemoved, group: rallyRemoved ? null : await this.rallies.members(id).catch(error => {
        if (error.code === 'WORKSPACE_NOT_FOUND') return null;
        throw error;
      }),
      granted: leader ? (await this.rallies.scopes(id).catch(error => {
        if (error.code === 'WORKSPACE_NOT_FOUND') return { granted: [] };
        throw error;
      })).granted : [],
      leader, records: await this.rallies.list(id), energon: { config: this.energon.config(id), usage: await this.energon.usage(id) } };
  }

  create(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return Promise.reject(new ForgingError('INVALID_CREATION', 'Creation must be an object.'));
    const request = structuredClone(input);
    return this.enqueue(() => this.createOnce(request));
  }

  fork(input, signal) {
    const request = forkRequest(input);
    return this.enqueue(() => forkSession(this, request, signal));
  }

  async forkTurn(input, signal) {
    const request = forkRequest(input);
    signal?.throwIfAborted();
    const source = await this.observe(request.sessionId);
    if (!source) throw new ForgingError('SESSION_MISSING', 'Fork source no longer exists.');
    try {
      const event = source.events[request.atSeq];
      const start = source.events.slice(0, request.atSeq + 1).findLast(item => item.type === 'turn/start');
      const end = start && source.events.find(item => item.type === 'turn/end' && item.data.turn === start.data.turn && item.seq >= request.atSeq);
      if (!event || !end) throw new ForgingError('INVALID_ANCHOR', 'This message does not belong to a completed Turn.');
      return await this.fork({ ...request, atSeq: end.seq }, signal);
    } finally { source[Symbol.dispose](); }
  }

  forkNotice(sessionId, after, signal) {
    return this.known.has(sessionId) ? this.notices.read(sessionId, after, signal) : null;
  }

  quarantine(session) {
    const owners = [...this.known].filter(([, plan]) => presetId(plan) === session.header.agentPreset);
    const sourceId = owners.length === 1 ? owners[0][0] : undefined;
    if (sourceId) this.notices.publish(sourceId, '原生分支已拒绝，请使用消息末尾的「锻造分支」。');
    const pending = Promise.resolve().then(async () => {
      if (await this.ctx.sessionPersistence.stat(session.id)) await this.ctx.workspaceRegistry.archiveSession(session.id, { stopActivity: true });
    }).catch(error => {
      this.ctx.logger.error(error);
      if (sourceId) this.notices.publish(sourceId, '原生分支已拒绝，但残留会话归档失败，请检查 DSH 日志。');
    }).finally(() => this.quarantines.delete(pending));
    this.quarantines.add(pending);
  }

  enqueue(operation) {
    const pending = this.queue.then(async () => {
      await this.ready;
      if (this.closing) throw new ForgingError('PLUGIN_STOPPING', 'Session forging is stopping.');
      return operation();
    });
    this.queue = pending.catch(() => {});
    return pending;
  }

  async observe(id) {
    try { return await this.ctx.sessionQuery.observeSession(id); }
    catch (error) { if (error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') return undefined; throw error; }
  }

  async firstTurnModel(workspace, composerSessionId, cog) {
    const catalog = await this.ctx.sessionController.modelCatalog();
    const available = selection => {
      const route = catalog.groups.find(group => group.id === selection.provider)?.models.find(item => item.id === selection.model);
      return route && (!selection.reasoningEffort || route.reasoning?.efforts.some(item => item.id === selection.reasoningEffort));
    };
    let model = catalog.default;
    if (composerSessionId !== undefined) {
      if (!workspace.sessionIds.includes(composerSessionId) || this.known.has(composerSessionId))
        throw new ForgingError('WORKSPACE_CHANGED', '请在原工作区的新会话页发送。');
      const view = await this.observe(composerSessionId);
      try {
        if (!view || view.events.some(event => event.type === 'turn/start'))
          throw new ForgingError('SESSION_CHANGED', '请在尚未开始的新会话页发送。');
        // Before the first turn DSH's native picker follows the last model/selection,
        // falling back to the current host default when no selection was recorded.
        model = view.events.findLast(event => event.type === 'model/selection')?.data ?? model;
      } finally { view?.[Symbol.dispose](); }
    } else if (cog.provider || cog.reasoningEffort) {
      const candidate = {...(cog.provider ? {provider:cog.provider, model:cog.model} : catalog.default),
        ...(cog.reasoningEffort ? {reasoningEffort:cog.reasoningEffort} : {})};
      if (available(candidate)) {
        try { await this.ctx.llm.resolveCallConfig(candidate); model = candidate; }
        catch { /* An obsolete template route leaves DSH's default in effect. */ }
      }
    }
    if (!available(model))
      throw new ForgingError('MODEL_UNAVAILABLE', '当前模型或推理等级已不可用，请在 DSH 选择可用模型后再发送。');
    return model;
  }

  async createOnce(request) {
    const { requestId, workspaceId, source, sparkId, spark } = request;
    if (Object.keys(request).some(key => !['requestId', 'workspaceId', 'source', 'sparkId', 'spark', 'title', 'responsibility', 'firstMessage', 'attachments', 'origin', 'composerSessionId'].includes(key))
      || typeof requestId !== 'string' || !requestId.trim() || requestId.length > 256) {
      throw new ForgingError('INVALID_CREATION', 'Supply a stable requestId and select a native workspace and Spark.');
    }
    for (const [field, maximum] of [['title', 120], ['responsibility', 300]]) {
      if (request[field] !== undefined && (typeof request[field] !== 'string' || request[field].length > maximum)) throw new ForgingError('INVALID_CREATION', 'Invalid ' + field);
    }
    if (request.firstMessage !== undefined) checkFirstMessage(request.firstMessage, request.attachments);
    const workspace = this.ctx.workspaceRegistry.get(workspaceId);
    if (!workspace) throw new ForgingError('WORKSPACE_NOT_FOUND', 'Select an existing native workspace.');
    const id = 'forged-' + contentRevision(requestId);
    const inputRevision = contentRevision(request);
    let plan = this.known.get(id) ?? await this.plans.get(id);
    if (plan) this.known.set(id, plan);
    if (plan && plan.inputRevision !== inputRevision) throw new ForgingError('CREATION_CONFLICT', 'Creation requestId already names different inputs.');
    const observed = await this.observe(id);
    if (observed) {
      try {
        if (!plan || observed.header.agentPreset !== presetId(plan)) throw new ForgingError('SESSION_CONFLICT', 'Native Session is not owned by this creation.');
        const selected = observed.events.findLast(event => event.type === 'agent-preset/selected')?.data.agentPreset ?? observed.header.agentPreset;
        if (!this.ownsSelection(plan, selected)) throw new ForgingError('PRESET_CHANGED', 'Session no longer selects its fixed forging Preset.');
        if (await realpath(workspace.path) !== await realpath(observed.header.cwd)) throw new ForgingError('WORKSPACE_CHANGED', 'Native Session belongs to another directory.');
      } finally { observed[Symbol.dispose](); }
    }
    const state = await this.states.get(id);
    if (state?.firstSendFailed && request.firstMessage !== undefined && this.ctx.workspaceRegistry.archivedSessionIds.includes(id))
      await this.ctx.workspaceRegistry.unarchiveSession(id);
    if (plan && state?.ready) {
      await this.validate(id, this.ctx.agents.get(id));
      if (!observed) throw new ForgingError('SESSION_MISSING', 'Completed native Session is missing; it will not be recreated.');
      if (!this.ctx.workspaceRegistry.archivedSessionIds.includes(id)) await this.openBoundAgent(plan);
      if (request.firstMessage !== undefined) await this.submitFirst(id, request);
      return this.summary(id);
    }
    if (!plan) {
      const original = await this.sources.get(source);
      const template = original.sparks.find(item => item.id === sparkId);
      if (!template || (spark !== undefined && spark?.id !== sparkId)) throw new ForgingError('SPARK_NOT_FOUND', 'Select a Spark from the pinned source.');
      if (spark && isNativeExample(original) && contentRevision(spark) !== contentRevision(template)) throw readOnlyExampleError();
      // Prepare validates the edited Spark before inspecting or mounting anything.
      const binding = await this.bindings.prepare({ sessionId: id, source, sparkId, ...(spark === undefined ? {} : { spark }) });
      const composition = await capturePreset(this.ctx, binding.spark, workspace.path);
      const model = await this.firstTurnModel(workspace, request.composerSessionId, binding.spark.cog);
      await this.ctx.llm.resolveCallConfig({ ...model, ...(binding.spark.energon.maxTokens === null ? {} : { maxTokens: binding.spark.energon.maxTokens }) });
      plan = { inputRevision, workspaceId, binding, composition, model, mission: request.responsibility?.trim() ?? '', displayPreset: await this.displayName(binding.spark) };
      await this.plans.put(id, plan, { immutable: true });
      this.known.set(id, plan);
    }
    try {
      const agent = await this.openBoundAgent(plan, observed ? undefined : workspace.path);
      await this.attach(agent);
      if (this.closing) throw new ForgingError('PLUGIN_STOPPING', 'Session forging is stopping.');
      await this.validate(id, agent);
      if (!workspace.sessionIds.includes(id)) await workspace.attachSession(id);
      agent.model.select(plan.model);
      await this.ctx.sessions.flush(agent.session);
      if (state?.suspended) await this.ctx.workspaceRegistry.unarchiveSession(id);
      if (request.title?.trim()) {
        await this.ctx.sessionController.rename({ sessionId: id, title: request.title.trim() });
        await this.ctx.sessions.flush(agent.session);
      }
      await this.states.put(id, { ready: true, suspended: false });
    } catch (error) {
      const partial = await this.observe(id);
      if (partial) {
        partial[Symbol.dispose]();
        await this.suspend(id).catch(cause => this.ctx.logger.error(cause));
      }
      throw error;
    }
    if (request.firstMessage !== undefined) await this.submitFirst(id, request);
    return this.summary(id);
  }

  async submitFirst(id, input) {
    try {
      await sendFirstMessage(this, id, input);
      const state = await this.states.get(id);
      if (state.firstSendFailed) await this.states.put(id, {ready:true, suspended:false});
    } catch (error) {
      const observation = await this.observe(id);
      try {
        if (observation && !observation.events.some(e => e.type === 'turn/start' || e.type === 'user/message' ||
            (e.type === 'agent/inbox/spliced' && e.data.inserted.length))) {
          await this.states.put(id, {ready:true, suspended:false, firstSendFailed:true});
          await this.ctx.workspaceRegistry.archiveSession(id);
        }
      } finally { observation?.[Symbol.dispose](); }
      throw error;
    }
  }

  async summary(id) {
    const plan = await this.validate(id);
    return { sessionId: id, preset: presetId(plan), binding: await this.bindings.get(id),
      workspaceId: this.ctx.workspaceRegistry.list().find(workspace => workspace.sessionIds.includes(id))?.id,
      archived: this.ctx.workspaceRegistry.archivedSessionIds.includes(id) };
  }

  async view(id) {
    const plan = this.known.get(id);
    if (!plan) return null;
    const stored = await this.plans.get(id), binding = await this.bindings.get(id);
    if (!stored || contentRevision(stored) !== contentRevision(plan) || binding.revision !== plan.binding.revision) {
      throw new ForgingError('CREATION_CHANGED', 'Fixed creation record is missing or changed.');
    }
    return { sessionId: id, bindingRevision: binding.revision, soulPath: binding.soulPath, creation: binding.creation };
  }

  restore(id) { return this.enqueue(() => this.restoreOnce(id)); }

  async restoreOnce(id) {
    const plan = await this.validate(id);
    const agent = await this.openBoundAgent(plan);
    await this.validate(id, agent);
    await this.attach(agent);
    const state = await this.states.get(id);
    if (!state?.ready) throw new ForgingError('CREATION_INCOMPLETE', 'Retry the original creation before restoring this Session.');
    if (state.suspended && !this.closing) {
      await this.ctx.workspaceRegistry.unarchiveSession(id);
      await this.states.put(id, { ready: true, suspended: false });
    }
    return this.summary(id);
  }

  async suspend(id) {
    if (this.ctx.workspaceRegistry.archivedSessionIds.includes(id)) return;
    // Archive first: a failed journal write may require manual recovery, but must
    // never label a user's later archive as ours and silently reopen it.
    await this.ctx.workspaceRegistry.archiveSession(id, { stopActivity: true });
    const state = await this.states.get(id);
    await this.states.put(id, { ready: state?.ready ?? false, suspended: true });
  }

  stop() {
    if (this.stopping) return this.stopping;
    this.closing = true;
    this.notices.close();
    this.rallies.removalNotices.close();
    this.energon.close();
    this.signalClose();
    return this.stopping = this.stopOnce();
  }

  async stopOnce() {
    const errors = [];
    try { await this.ready; } catch (error) { errors.push(error); }
    await this.queue;
    await Promise.allSettled(this.opening.values());
    await Promise.all(this.quarantines);
    const owned = new Map([...this.known].map(([id, plan]) => [id, presetId(plan)]));
    const archived = new Set();
    let ids;
    try { ids = (await this.ctx.sessionPersistence.list()).filter(({ header }) => owned.has(header.id) && owned.get(header.id) === header.agentPreset).map(({ header }) => header.id); }
    catch (error) { errors.push(error); ids = [...this.known.keys()]; }
    for (const id of ids) {
      try {
        await this.suspend(id);
        archived.add(id);
      } catch (error) { errors.push(error); }
    }
    // Keep the denying guard if native archival fails. Successful archival is
    // the native durable gate that survives removal of this plugin's callbacks.
    for (const [agent, dispose] of this.attached) {
      if (archived.has(agent.id)) { try { dispose(); } catch (error) { errors.push(error); } }
    }
    this.attached.clear();
    for (const dispose of this.registrations.values()) {
      try { await dispose(); } catch (error) { errors.push(error); }
    }
    this.registrations.clear();
    if (errors.length) throw new AggregateError(errors, 'Some forged Sessions could not be archived.');
  }
}
