import { readFile } from 'node:fs/promises';
import { previewSource, isNativeExample, nativeExampleName, nativeExampleId, readOnlyExampleError } from './source.js';
import { ForgingError } from './records.js';
import { webDefaults } from './session-features.js';

export const emptyEnergon = () => ({
  maxTokens: null,
  tokenLimit: null,
  maxTurnDurationMs: null,
  wrapUpLeadTimeMs: 0,
  steps: { maxStepsPerTurn: null, wrapUpSteps: 0, finalReplySteps: 0 },
  web: {
    searchMaxQueries: null,
    searchMaxResults: null,
    searchSummaryMaxChars: null,
    searchTimeoutMs: null,
    fetchTimeoutMs: null,
  },
});
async function nativeRows(ctx, preset) {
  const { content } = await ctx.agentPresets.readDocument(preset);
  const include = await ctx.loader.import('@deepseek-ai/cordis-plugin-include');
  return include.parseEntryYaml
    ? include.parseEntryYaml(content)
    : (await ctx.loader.import('js-yaml')).load(content, { schema: include.entryListSchema });
}
function personaOf(rows) {
  for (const row of rows) {
    if (row.name === '@deepseek-ai/dsh-persona' && !row.disabled) return row.config ?? {};
    if (row.group && Array.isArray(row.config)) {
      const value = personaOf(row.config);
      if (value) return value;
    }
  }
  return undefined;
}
export async function catalog(forging, workspaceId) {
  await forging.ready;
  const ctx = forging.ctx,
    workspace = workspaceId ? ctx.workspaceRegistry.get(workspaceId) : undefined;
  if (workspaceId && !workspace)
    throw new ForgingError('WORKSPACE_NOT_FOUND', 'Select an existing native Workspace.');
  const modes = {},
    sparks = [];
  for (const preset of ['standard', 'ptc', 'minimal', 'cordis']) {
    const rows = await nativeRows(ctx, preset),
      lease = await ctx.agentPresets.acquireScope(preset);
    try {
      const tools = ctx.tools.schemas(lease.key),
        skills = workspace ? await ctx.skills.list({ scope: lease.key, cwd: workspace.path }) : [];
      modes[preset] = {
        tools: tools.map(({ name, description }) => ({ name, description })),
        skills: skills.map(({ name, description }) => ({ name, description })),
        skillsLoaded: Boolean(workspace),
        webDefaults: webDefaults(rows),
      };
      const persona = personaOf(rows) ?? {};
      sparks.push({
        id: preset,
        name: preset,
        description: '原生示例',
        persona: persona.prefix ?? '',
        soul: '',
        cog: { provider: '', model: '', reasoningEffort: '' },
        components: { tools: tools.map((t) => t.name), skills: skills.map((s) => s.name) },
        energon: emptyEnergon(),
        matrix: false,
        runtime: {
          preset,
          complete: persona.complete ?? false,
          includeRuntimeContext: persona.includeRuntimeContext ?? true,
          execution:
            preset === 'ptc' ? 'ptc' : preset === 'minimal' ? 'persistent-shell' : 'native',
        },
      });
    } finally {
      await lease[Symbol.asyncDispose]();
    }
  }
  const native = {
    schemaVersion: 1,
    id: 'native',
    name: nativeExampleName,
    description: '展示当前工作区可用的四种 DSH 原生模式。需要调整火种时，请先另存为新火种源。',
    sparks,
  };
  native.id = nativeExampleId(native);
  const sources = [];
  for (const file of ['awesome-copilot', 'agency-agents'])
    sources.push({
      ...previewSource(
        await readFile(new URL('../sources/' + file + '.json', import.meta.url), 'utf8')
      ),
      builtin: true,
    });
  for (const item of sources) Object.assign(item, await forging.sources.latest(item));
  for (const reference of await forging.sources.list()) {
    const source = await forging.sources.get(reference);
    if (isNativeExample(source)) {
      // Keep user-added templates from earlier releases accessible under their pinned revision.
      if (source.sparks.length > sparks.length)
        sources.push({ source, revision: reference.revision, readOnly: true, displayName: '历史原生示例（含自定义火种）' });
      continue;
    }
    if (
      !sources.some((item) => item.source.id === source.id && item.revision === reference.revision)
    )
      sources.push({ source, revision: reference.revision, builtin: false });
  }
  sources.push({ ...previewSource(JSON.stringify(native)), builtin: true, liveExample: true, readOnly: true });
  const models = await ctx.sessionController.modelCatalog();
  let modelDefaults = null;
  try {
    modelDefaults = await ctx.llm.resolveCallConfig(models.default);
  } catch {
    /* Catalog remains usable when the default route is unavailable. */
  }
  return JSON.parse(
    JSON.stringify({
      workspaces: ctx.workspaceRegistry
        .list()
        .map((w) => ({ id: w.id, name: w.title ?? w.path, path: w.path })),
      modes,
      models,
      modelDefaults,
      quantity: await forging.quantity.list(),
      sources,
    })
  );
}
export function sourcePreview(text) {
  try {
    return previewSource(text);
  } catch (error) {
    if (error.issues)
      error.message +=
        ' ' +
        error.issues
          .slice(0, 6)
          .map((issue) => `${issue.instancePath}: ${issue.message}`)
          .join('; ');
    throw error;
  }
}
export async function sourceImport(forging, text, revision) {
  const { source } = sourcePreview(text);
  if (isNativeExample(source)) throw readOnlyExampleError();
  return forging.sources.register(text, revision);
}
export const sourceExport = (forging, reference) => forging.sources.export(reference);
export async function ensureRegistered(forging, preview) {
  const reference = { id: preview.source.id, revision: preview.revision };
  try {
    await forging.sources.get(reference);
  } catch (error) {
    if (error.code !== 'SOURCE_NOT_FOUND') throw error;
    try {
      await forging.sources.register(JSON.stringify(preview.source), preview.revision);
    } catch (cause) {
      if (cause.code !== 'SOURCE_EXISTS') throw cause;
      await forging.sources.get(reference);
    }
  }
  return reference;
}

export async function saveSparkCopy(forging, sourceText, spark) {
  const base = sourcePreview(sourceText);
  if (isNativeExample(base.source)) throw readOnlyExampleError();
  sourcePreview(JSON.stringify({ ...base.source, sparks: [spark] }));
  const reference = await ensureRegistered(forging, base);
  return forging.sources.appendSpark(reference, spark);
}

export async function saveSourceCopy(forging, text) {
  const preview = sourcePreview(text);
  if (!preview.source.id.startsWith('copy-'))
    throw new ForgingError('INVALID_COPY', '火种源副本需要独立 ID。');
  await ensureRegistered(forging, preview);
  return preview;
}

export async function workbenchCreate(forging, input) {
  const { sourceText, ...request } = input;
  const preview = sourcePreview(sourceText);
  if (preview.source.id !== request.source?.id || preview.revision !== request.source?.revision)
    throw new ForgingError('SOURCE_CHANGED', 'Source changed after preview.');
  await ensureRegistered(forging, preview);
  const result = await forging.create(request);
  return { sessionId: result.sessionId };
}
