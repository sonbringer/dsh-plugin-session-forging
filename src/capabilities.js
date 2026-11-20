import { ForgingError } from './records.js';
import { councilPrompt } from './council.js';
import { SOUL_CONTEXT } from './context.js';

export const name = 'session-forging-capabilities';
export const inject = ['skills', 'systemPrompt'];

/** Mounted inside the fixed Preset's isolated skill registry. */
export function apply(ctx, config) {
  ctx.systemPrompt.context({ name: SOUL_CONTEXT, order: 510, required: true, interpolate: false,
    text: ({ agent }) => {
      if (!agent) return '';
      if (agent.id !== config.sessionId) throw new ForgingError('UNBOUND_SESSION', 'Soul belongs to another Session.');
      const forging = ctx.get('sessionForging');
      if (!forging) throw new ForgingError('PLUGIN_STOPPING', 'Session forging is unavailable.');
      return forging.context.render(agent.id);
    } });
  const guidance = section => config.complete
    ? ctx.systemPrompt.context({ ...section, required: true })
    : ctx.systemPrompt.section(section);
  guidance({ name: 'session-forging:mission', order: 505, interpolate: false,
    text: ({ agent }) => {
      const mission = agent && ctx.get('sessionForging')?.rallies.mission(agent.id);
      return mission ? '本会话使命：' + mission : '';
    } });
  if (config.leader) guidance({ name: 'session-forging:leader', order: 525, interpolate: false,
    text: ({ agent }) => agent && !ctx.get('sessionForging')?.rallies.removed.has(agent.id)
      ? '你拥有领袖模块。用户要求协调时，先用 forging_members 查询成员和操作说明，再用 forging_rally 派工。仅在用户授权恢复时使用 forging_revive。' : '' });
  if (config.council) guidance({ name: 'session-forging:council', order: 520, interpolate: false,
    text: ({ agent }) => agent ? councilPrompt(ctx.get('sessionForging'), agent.id) : '' });
  // The retained Preset outlives Host plugin teardown while Agents still use it.
  // Guard admission here too, including a creation racing with unload.
  ctx.on('agent/created', async ({ agent }) => {
    const forging = ctx.get('sessionForging');
    if (!forging || forging.closing) throw new ForgingError('PLUGIN_STOPPING', 'Session forging is unavailable.');
    if (agent.id !== config.sessionId) throw new ForgingError('UNBOUND_SESSION', 'This Preset belongs to another Session.');
    await forging.attach(agent);
  });
  for (const skill of config.skills) ctx.skills.register(skill);
  ctx.systemPrompt.variable('provider', context => context.modelSelection?.provider);
  ctx.systemPrompt.variable('model', context => context.modelSelection?.model);
}
