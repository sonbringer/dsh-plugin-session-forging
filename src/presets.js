import { contentRevision } from './source.js';
import { ForgingError } from './records.js';
import { captureResources } from './resources.js';

export const PRESET_PREFIX = 'session-forging-';
export const sparkPresetName = spark => '火种 · ' + spark.name;
export const isForgingPreset = id => typeof id === 'string' && (id.startsWith(PRESET_PREFIX) || id.startsWith('火种 · '));
export const presetId = plan => plan.displayPreset ?? PRESET_PREFIX + contentRevision(plan);

/** Read trusted native declarations through DSH; source JSON never supplies executable rows. */
export async function capturePreset(ctx, spark, cwd) {
  const base = spark.runtime?.preset ?? 'standard';
  const { content } = await ctx.agentPresets.readDocument(base);
  const include = await ctx.loader.import('@deepseek-ai/cordis-plugin-include');
  const rows = include.parseEntryYaml ? include.parseEntryYaml(content)
    : (await ctx.loader.import('js-yaml')).load(content, { schema: include.entryListSchema });
  if (!Array.isArray(rows)) throw new ForgingError('INVALID_PRESET', 'Native Preset has no plugin list.');
  const lease = await ctx.agentPresets.acquireScope(base);
  try {
    const tools = ctx.tools.schemas(lease.key);
    const selected = spark.components.tools.map(name => {
      const tool = tools.find(tool => tool.name === name);
      if (!tool) throw new ForgingError('TOOL_UNAVAILABLE', `Tool is unavailable in ${base}: ${name}`);
      return tool;
    });
    const skills = [];
    for (const name of spark.components.skills) {
      const skill = await ctx.skills.get(name, { scope: lease.key, cwd });
      if (!skill) throw new ForgingError('SKILL_UNAVAILABLE', `Skill is unavailable in ${base}: ${name}`);
      skills.push(skill);
    }
    return { base, rows, tools: selected, skills, resources: await captureResources(skills) };
  } finally { await lease[Symbol.asyncDispose](); }
}

export function definition(plan) {
  const { spark } = plan.binding;
  const clean = rows => rows.flatMap(row => {
    if (['@deepseek-ai/dsh-persona', '@deepseek-ai/dsh-skill', '@deepseek-ai/dsh-skill-filesystem'].includes(row.name)) return [];
    if (row.group && Array.isArray(row.config)) return [{ ...row, config: clean(row.config) }];
    return [row];
  });
  return {
    id: presetId(plan), name: spark.name,
    plugins: [{ name: 'cordis:group', group: true, isolate: { skills: true }, config: [
      { name: '@deepseek-ai/dsh-skill' },
      ...clean(structuredClone(plan.composition.rows)),
      { name: '@deepseek-ai/dsh-persona', config: {
        prefix: spark.persona, complete: spark.runtime?.complete ?? false,
        includeRuntimeContext: spark.runtime?.includeRuntimeContext ?? true,
      } },
      { name: new URL('./capabilities.js', import.meta.url).href, config: { sessionId: plan.binding.sessionId, council: !!spark.council?.enabled, leader: !!spark.matrix, skills: plan.composition.skills, complete: spark.runtime?.complete ?? false } },
    ] }],
  };
}
