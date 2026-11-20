/** Forging endpoints use native Gateway authentication and access checks. */
export async function registerView(ctx, forging) {
  const { bindTypertRemote } = await ctx.loader.import('@deepseek-ai/dsh-typert-protocol');
  const { z } = await ctx.loader.import('zod');
  forging.typertRemote = bindTypertRemote(forging, 'sessionForging');
  const codec = (name, schema) => ({ mode: 'strict', typeSymbol: name, create: () => schema });
  const forkParameters = [{ name: 'input', wire: 'input', source: 'json', codec: codec('ForkInput', z.strictObject({
    requestId: z.string().min(1).max(256), sessionId: z.string().min(1).max(256), atSeq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  })) }];
  const forkResult = codec('ForkResult', z.strictObject({ sessionId: z.string() }));
  const sid = z.string().min(1).max(256), revision = z.string().regex(/^[a-f0-9]{64}$/);
  const parameter = (name, schema) => ({ name, wire: name, source: 'json', codec: codec(name, schema) });
  const endpoint = (method, parameters, result = z.json(), cancel = false) => ({
    id: '@zhengrenwritecode/dsh-session-forging#sessionForging/' + method, service: 'sessionForging', namespace: 'sessionForging', method,
    invocation: { kind: 'direct' }, parameters, result: codec(method + 'Result', result), ...(cancel ? { cancellation: { parameter: 'signal' } } : {}),
  });
  const reference = z.strictObject({ id: z.string().min(1).max(80), revision });
  const firstMessage = z.string().max(131072);
  const attachments = z.array(z.discriminatedUnion('type', [
    z.strictObject({type:z.literal('file'), receiptId:sid}),
    z.strictObject({type:z.literal('image'), mediaType:z.enum(['image/png','image/jpeg','image/webp','image/gif']), data:z.string().min(1), name:z.string().optional()}),
  ])).optional();
  const extra = [
    endpoint('quantityList', []),
    endpoint('quantitySet', [parameter('text', z.string().max(262144)), parameter('sparkId', sid), parameter('enabled', z.boolean())]),
    endpoint('quantityCreate', [parameter('input', z.strictObject({ origin: sid, source: reference, sparkId: sid, version: revision, requestId: sid, firstMessage, attachments, composerSessionId:sid.optional(), title: z.string().max(120).optional(), responsibility: z.string().max(300).optional() }))], forkResult.create()),
    endpoint('changeSpark', [parameter('source', reference), parameter('sparkId', sid), parameter('spark', z.json().nullable())]),
    endpoint('saveSessionSpark', [parameter('input', z.strictObject({ sessionId: sid, sourceText: z.string().max(262144), id: z.string().regex(/^copy-[a-z0-9-]+$/).max(80), name: z.string().trim().min(1).max(120) }))]),
    endpoint('catalog', [parameter('workspaceId', sid.nullable())]),
    endpoint('sourcePreview', [parameter('text', z.string().max(262144))]),
    endpoint('sourceImport', [parameter('text', z.string().max(262144)), parameter('revision', revision)], reference),
    endpoint('sourceExport', [parameter('reference', reference)], z.string()),
    endpoint('saveSparkCopy', [parameter('sourceText', z.string().max(262144)), parameter('spark', z.json())]),
    endpoint('saveSourceCopy', [parameter('text', z.string().max(262144))]),
    endpoint('workbenchCreate', [parameter('input', z.strictObject({ requestId: sid, workspaceId: sid, source: reference, sparkId: z.string().min(1).max(80), spark: z.json(), sourceText: z.string().max(262144), firstMessage, attachments, composerSessionId:sid.optional(), origin:sid.optional(), title: z.string().max(120).optional(), responsibility: z.string().max(300).optional() }))], forkResult.create()),
    endpoint('collaboration', [parameter('id', sid)]),
    endpoint('rallyMembers', [parameter('id', sid), parameter('scope', z.enum(['workspace', 'authorized']))]),
    endpoint('rallyGrant', [parameter('input', z.strictObject({sessionId: sid, workspaceId: sid, enabled: z.boolean()}))]),
    endpoint('rallyRevive', [parameter('input', z.strictObject({sessionId: sid, targetId: sid, requestId: sid, scope: z.enum(['workspace','authorized']).optional()}))]),
    endpoint('rallyRemove', [parameter('input', z.strictObject({sessionId: sid, targetId: sid, workspaceId: sid, scope: z.enum(['workspace','authorized'])}))], z.null()),
    endpoint('rallyRemovalRevision', [parameter('after', z.number().int().nonnegative().nullable())], z.number().int().nonnegative().nullable(), true),
    endpoint('rally', [parameter('input', z.strictObject({ requestId: sid, sessionId: sid, message: z.string().min(1).max(8000), membershipRevision: revision.optional(), scope: z.enum(['workspace','authorized']).optional(), targets: z.array(sid).min(1).optional(), exclude: z.array(sid).optional(), responsibilities: z.record(sid, z.string().min(1).max(300)).optional() }))], z.json(), true),
    endpoint('councilDocument', [parameter('input', z.strictObject({ sessionId: sid, name: z.string().min(1).max(240), action: z.enum(['read', 'write', 'delete']).optional(), text: z.string().max(262144).optional(), revision: revision.nullable().optional() }))]),
    endpoint('modelDefaults', [parameter('selection', z.strictObject({ provider: sid, model: sid, reasoningEffort: z.string().max(80).optional() }))]),
  ];
  ctx.typert.register({
    package: '@zhengrenwritecode/dsh-session-forging', face: 'host', schemas: [],
    model: { services: [], events: [], objects: [] },
    invocations: [...extra, {
      id: '@zhengrenwritecode/dsh-session-forging#sessionForging/view',
      service: 'sessionForging', namespace: 'sessionForging', method: 'view', invocation: { kind: 'direct' },
      parameters: [{ name: 'sessionId', wire: 'sessionId', source: 'json', codec: codec('SessionId', z.string().min(1).max(256)) }],
      result: codec('ForgingView', z.strictObject({ sessionId: z.string(), bindingRevision: z.string(), soulPath: z.string(),
        creation: z.strictObject({ persona: z.string(), soul: z.string() }) }).nullable()),
    }, {
      id: '@zhengrenwritecode/dsh-session-forging#sessionForging/fork',
      service: 'sessionForging', namespace: 'sessionForging', method: 'fork', invocation: { kind: 'direct' },
      parameters: forkParameters,
      cancellation: { parameter: 'signal' },
      result: forkResult,
    }, {
      id: '@zhengrenwritecode/dsh-session-forging#sessionForging/forkTurn',
      service: 'sessionForging', namespace: 'sessionForging', method: 'forkTurn', invocation: { kind: 'direct' },
      parameters: forkParameters, cancellation: { parameter: 'signal' }, result: forkResult,
    }, {
      id: '@zhengrenwritecode/dsh-session-forging#sessionForging/forkNotice',
      service: 'sessionForging', namespace: 'sessionForging', method: 'forkNotice', invocation: { kind: 'direct' },
      parameters: [
        { name: 'sessionId', wire: 'sessionId', source: 'json', codec: codec('SessionId', z.string().min(1).max(256)) },
        { name: 'after', wire: 'after', source: 'json', codec: codec('NoticeCursor', z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable()) },
      ],
      cancellation: { parameter: 'signal' },
      result: codec('ForkNotice', z.strictObject({ revision: z.number().int().min(0), message: z.string().nullable() }).nullable()),
    }],
  });
}
