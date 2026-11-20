import { join } from 'node:path';
import { contentRevision, isNativeExample } from './source.js';
import { ForgingError, Records } from './records.js';
import { ensureRegistered, sourcePreview } from './workbench.js';

const keyFor = (sourceId, sparkId) => contentRevision([sourceId, sparkId]);

function menuItem(key, sparkId, { source, revision }) {
  const spark = source.sparks.find(item => item.id === sparkId);
  if (!spark) return null;
  return {
    key, sparkId, source: { id: source.id, revision }, sourceName: source.name,
    name: spark.name, description: spark.description, matrix: spark.matrix, cog: spark.cog, version: contentRevision(spark),
  };
}

/** Publication is separate from the versioned source and from DSH's Preset roster. */
export class Quantity {
  constructor(forging, directory) {
    this.forging = forging;
    this.entries = new Records(join(directory, 'quantity'));
  }

  async item(key) {
    const entry = await this.entries.get(key);
    if (!entry?.enabled) return null;
    return menuItem(key, entry.sparkId, await this.forging.sources.latestById(entry.source.id));
  }

  async list() {
    const items = [];
    const sources = new Map();
    for (const { id, value } of await this.entries.list()) {
      if (!value.enabled) continue;
      if (!sources.has(value.source.id)) {
        sources.set(value.source.id, await this.forging.sources.latestById(value.source.id));
      }
      const item = menuItem(id, value.sparkId, sources.get(value.source.id));
      if (item) items.push(item);
    }
    return items.sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
  }

  async withdraw(sourceId, sparkId) {
    const key = keyFor(sourceId, sparkId);
    const entry = await this.entries.get(key);
    if (entry?.enabled) await this.entries.put(key, { ...entry, enabled: false });
  }

  async publish(text, sparkId, enabled) {
    const preview = sourcePreview(text);
    if (isNativeExample(preview.source)) throw new ForgingError('READ_ONLY_SOURCE', '请先另存原生示例再加入量产。');
    const source = await ensureRegistered(this.forging, preview);
    const key = keyFor(source.id, sparkId);
    const current = await this.forging.sources.latest(preview);
    const spark = preview.source.sparks.find(item => item.id === sparkId);
    const latest = current.source.sparks.find(item => item.id === sparkId);
    if (!spark || !latest || contentRevision(spark) !== contentRevision(latest))
      throw new ForgingError('SOURCE_CHANGED', '火种已更新，请刷新后再操作。');
    await this.entries.put(key, { source, sparkId, enabled });
    return this.list();
  }

  async create({ origin, source, sparkId, version, requestId, responsibility, firstMessage, attachments, title, composerSessionId }) {
    const f = this.forging;
    const workspace = f.ctx.workspaceRegistry.list().find(w => w.sessionIds.includes(origin));
    if (!workspace) throw new ForgingError('WORKSPACE_NOT_FOUND', '请先选择工作区。');
    if (composerSessionId !== undefined && composerSessionId !== origin)
      throw new ForgingError('WORKSPACE_CHANGED', '请在选择火种的对话页发送。');
    const template = (await f.sources.get(source)).sparks.find(s => s.id === sparkId);
    if (!template || contentRevision(template) !== version) throw new ForgingError('SOURCE_CHANGED','火种版本无效。');
    const input = { source, sparkId, workspaceId: workspace.id, requestId,
      ...(composerSessionId === undefined ? {} : {composerSessionId}),
      ...(firstMessage === undefined ? {} : { firstMessage }), ...(attachments?.length ? { attachments, origin } : {}), ...(title?.trim() ? { title: title.trim() } : {}),
      ...(responsibility?.trim() ? { responsibility: responsibility.trim() } : {}) };
    // A lost response may be replayed after the publication or template has changed.
    const previous = await f.plans.get('forged-' + contentRevision(requestId));
    if (!previous || previous.inputRevision !== contentRevision(input)) {
      const current = await this.item(keyFor(source.id, sparkId));
      if (!current || current.version !== version)
        throw new ForgingError('QUANTITY_CHANGED', '量产火种已更新或移出，请重新打开菜单。');
    }
    const result = await f.createOnce(input);
    return { sessionId: result.sessionId };
  }
}

async function captureSessionSpark(forging, sessionId, id, name) {
  const plan = await forging.validate(sessionId);
  const soul = await forging.bindings.readSoul(sessionId);
  const observation = await forging.observe(sessionId);
  if (!observation) throw new ForgingError('SESSION_MISSING', '会话不存在。');
  try {
    const { modelSelectionProjectionDefinition: projection } = await forging.ctx.loader.import('@deepseek-ai/dsh-agent');
    const state = observation.events.reduce(projection.apply, projection.init(observation.header, 0));
    const model = state.pending ?? state.lastUsed ?? plan.model;
    return { ...plan.binding.spark, id, name, soul,
      cog: { provider: model.provider, model: model.model, reasoningEffort: model.reasoningEffort ?? '' } };
  } finally { observation[Symbol.dispose](); }
}

export async function saveSessionSpark(forging, { sessionId, sourceText, id, name }) {
  const target = sourcePreview(sourceText);
  if (isNativeExample(target.source)) throw new ForgingError('READ_ONLY_SOURCE', '请选择可编辑的目标火种源。');
  const reference = await ensureRegistered(forging, target);
  const key = keyFor(reference.id, id);
  const signature = contentRevision({ sessionId, reference, id, name: name.trim() });
  let saved = await forging.sessionSparkSaves.get(key);
  if (saved && saved.signature !== signature) throw new ForgingError('CREATION_CONFLICT', '这个火种副本 ID 已用于其他保存请求。');
  if (saved?.revision) {
    return { revision: saved.revision, source: await forging.sources.get({ id: reference.id, revision: saved.revision }) };
  }
  if (!saved) {
    const spark = await captureSessionSpark(forging, sessionId, id, name.trim());
    sourcePreview(JSON.stringify({ ...target.source, sparks: [spark] }));
    saved = { signature, spark };
    await forging.sessionSparkSaves.put(key, saved);
  }
  const result = await forging.sources.appendSpark(reference, saved.spark);
  await forging.sessionSparkSaves.put(key, { signature, revision: result.revision });
  return result;
}
