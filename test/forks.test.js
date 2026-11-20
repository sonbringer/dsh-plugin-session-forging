import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forkSpark, forkRequest } from '../src/forks.js';
import { ForkNotices } from '../src/notices.js';

test('fork inherits fixed mind and capabilities while resetting collaboration and energy policies', () => {
  const parent = { id: 'test', persona: 'fixed', soul: 'today', cog: { model: 'today' },
    components: { tools: ['read'], skills: ['skill'] }, runtime: { preset: 'minimal', complete: true },
    matrix: true, council: { enabled: true, types: ['prd'] }, energon: { tokenLimit: 0 }, provenance: { revision: 'pinned' } };
  const before = structuredClone(parent), result = forkSpark(parent, 'historical', { provider: 'fixture', model: 'then' });
  assert.deepEqual(parent, before);
  assert.equal(result.soul, 'historical');
  assert.equal(result.persona, parent.persona);
  assert.deepEqual(result.components, parent.components);
  assert.deepEqual(result.runtime, parent.runtime);
  assert.deepEqual(result.provenance, parent.provenance);
  assert.deepEqual(result.cog, { provider: 'fixture', model: 'then', reasoningEffort: '' });
  assert.equal(result.matrix, false);
  assert.equal(result.council, undefined);
  assert.equal(result.energon.tokenLimit, null);
  result.components.tools.push('write');
  assert.deepEqual(parent, before);
});

test('fork requires an exact anchor and a stable request identity without coercing inputs', () => {
  const request = { requestId: 'request', sessionId: 'source', atSeq: 0 };
  assert.deepEqual(forkRequest(request), request);
  assert.notEqual(forkRequest(request), request);
  for (const value of [undefined, null, '0', -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => forkRequest({ ...request, atSeq: value }), { code: 'INVALID_FORK' });
  }
  assert.throws(() => forkRequest({ ...request, requestId: ' ' }), { code: 'INVALID_FORK' });
  assert.throws(() => forkRequest({ ...request, workspaceId: 'another' }), { code: 'INVALID_FORK' });
});

test('fork rejection notices are session-local, cancellable and released on unload', async () => {
  const notices = new ForkNotices(), control = new AbortController();
  notices.publish('one', 'old');
  assert.deepEqual(await notices.read('one', null), { revision: 1, message: null });
  const waiting = notices.read('one', 1, control.signal);
  notices.publish('two', 'other');
  assert.equal(notices.listeners.size, 1);
  notices.publish('one', 'refused');
  assert.deepEqual(await waiting, { revision: 3, message: 'refused' });
  assert.equal(notices.listeners.size, 0);
  const aborted = notices.read('one', 3, control.signal);
  control.abort(Error('cancelled'));
  await assert.rejects(aborted, /cancelled/);
  assert.equal(notices.listeners.size, 0);
  const closed = notices.read('one', 3);
  notices.close();
  assert.equal(await closed, null);
  assert.equal(notices.listeners.size, 0);
});
