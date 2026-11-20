import { contentRevision } from './source.js';

export function nativeWebConfig(rows) {
  for (const row of rows) {
    if (row.name === '@deepseek-ai/dsh-tool-web' && !row.disabled) return row.config ?? {};
    if (row.group && Array.isArray(row.config)) {
      const nested = nativeWebConfig(row.config);
      if (nested) return nested;
    }
  }
  return undefined;
}
export const webDefaults = (rows) => ({
  searchMaxQueries: 10,
  searchMaxResults: 10,
  searchSummaryMaxChars: 800,
  searchTimeoutMs: 30000,
  fetchTimeoutMs: 30000,
  fetchMaxOutputChars: 200000,
  ...nativeWebConfig(rows),
});

export async function attachFeatures(forging, agent) {
  const spark = forging.known.get(agent.id).binding.spark,
    expected = new Map();
  const overrides = Object.fromEntries(
    Object.entries(spark.energon.web).filter(([, value]) => value !== null)
  );
  const names = spark.components.tools;
  const needsSearch =
    names.includes('web_search') && Object.keys(overrides).some((key) => key.startsWith('search'));
  const needsFetch = names.includes('web_fetch') && overrides.fetchTimeoutMs !== undefined;
  if (needsSearch || needsFetch) {
    const native = await forging.ctx.loader.import('@deepseek-ai/dsh-tool-web');
    const config = { ...webDefaults(forging.known.get(agent.id).composition.rows), ...overrides };
    const fiber = agent.ctx.inject(['tools', 'web', 'systemPrompt'], (ctx) => {
      if (needsSearch)
        native.applyWebSearchTool(
          ctx,
          config.searchMaxResults,
          config.searchMaxQueries,
          config.searchSummaryMaxChars,
          config.searchTimeoutMs,
          names.includes('web_fetch')
        );
      if (needsFetch)
        native.applyWebFetchTool(ctx, config.fetchTimeoutMs, config.fetchMaxOutputChars);
    });
    const release = forging.ctx.effect(() => () => fiber.dispose());
    agent.ctx.effect(() => release);
    await fiber.await();
    for (const tool of agent.ctx.tools.schemas(agent))
      if ((tool.name === 'web_search' && needsSearch) || (tool.name === 'web_fetch' && needsFetch))
        expected.set(tool.name, contentRevision(tool));
  }
  if (spark.matrix && !forging.rallies.removed.has(agent.id)) {
    const { defineTool } = await forging.ctx.loader.import('@deepseek-ai/dsh-tools');
    const scope = { type: 'string', enum: ['workspace', 'authorized'], description: 'Defaults to this workspace. authorized includes workspaces granted by the owner.' };
    const specs = [
      { name: 'forging_members', description: 'List current forged members, stable IDs, workspace, mission and archive status. Returns the rally operating guide.',
        parameters: { scope },
        run: async args => {
          forging.rallies.leader(agent.id);
          return { ...await forging.rallies.members(agent.id, args.scope),
            guide: 'Use targets:[id] for one member or [id1,id2] for a group. Omit targets for all active peers, or pass exclude:[id1,id2]. Use the listed revision as membershipRevision to detect changes. For different assignments, freeze the listed IDs and send each group its own message and requestId. Across workspaces include accessible PRD text or a shared reference. Archived targets require explicit user authorization and forging_revive, then query again. Retry a delivery with identical arguments and requestId. Accepted means input received, not work completed.' };
        } },
      { name: 'forging_rally', description: 'Deliver the requested message to active forged peers. Query forging_members for routing and retry instructions.',
        parameters: { requestId: { type: 'string', required: true }, message: { type: 'string', required: true }, scope,
          targets: { type: 'array', items: { type: 'string' } }, exclude: { type: 'array', items: { type: 'string' } }, membershipRevision: { type: 'string' } },
        run: async (args, exec) => {
          const record = await forging.rally({ ...args, sessionId: agent.id }, exec.signal);
          return { id: record.id, targets: record.targets };
        } },
      { name: 'forging_revive', description: 'Restore one named archived forged member when the user authorized restoring it. Preserve its history. Use a separate rally to send work.',
        parameters: { requestId: { type: 'string', required: true }, targetId: { type: 'string', required: true }, scope },
        run: args => forging.rallyRevive({ ...args, sessionId: agent.id }) },
    ];
    for (const { run, ...spec } of specs) {
      const dispose = agent.ctx.tools.register(defineTool({ ...spec,
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        execute: async (args, exec) => JSON.stringify(await run(args, exec)),
      }));
      const release = forging.ctx.effect(() => dispose);
      agent.ctx.effect(() => release);
      expected.set(spec.name, contentRevision(agent.ctx.tools.schemas(agent).find(tool => tool.name === spec.name)));
    }
  }
  forging.featureSchemas.set(agent, expected);
  await forging.energon.attach(agent);
}
