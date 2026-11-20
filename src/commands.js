/** Human command shares the Host fork transaction and does not prompt the model. */
export function registerForkCommand(ctx, forging, agent) {
  const fiber = ctx.inject(['commands'], commandCtx => {
    if (forging.known.get(agent.id).binding.spark.matrix && !forging.rallies.removed.has(agent.id)) commandCtx.commands.register({ name: 'forging-rally', definitionId: 'session-forging:rally',
      description: '向同工作区的锻造成员发起召集', input: { hint: '<项目变化>' },
      handler: async ({ commandId, rawInput, signal }) => {
        try { return { kind: 'success', text: JSON.stringify(await forging.rally({ requestId: 'command:' + commandId, sessionId: agent.id, message: rawInput.trim() }, signal)) }; }
        catch (error) { return { kind: 'error', text: error.message }; }
      },
    });
    commandCtx.commands.register({ name: 'forging-fork', definitionId: 'session-forging:fork',
      description: '从原生事件锚点创建锻造分支', input: { hint: '<eventSeq>' },
      handler: async ({ commandId, rawInput, signal }) => {
        const text = rawInput.trim();
        if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text))) return { kind: 'error', text: '用法：/forging-fork <eventSeq>' };
        try {
          const result = await forging.fork({ requestId: 'command:' + commandId, sessionId: agent.id, atSeq: Number(text) }, signal);
          return { kind: 'success', text: '已创建锻造分支：' + result.sessionId };
        } catch (error) { return { kind: 'error', text: error.message }; }
      },
    });
  });
  const release = forging.ctx.effect(() => () => fiber.dispose());
  ctx.effect(() => release);
}
