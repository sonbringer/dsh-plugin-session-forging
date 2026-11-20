import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionForging } from '../src/forging.js';
import { presetId } from '../src/presets.js';

async function setup(t, archive = async () => {}) {
  const directory = await mkdtemp(join(tmpdir(), 'forging-lifecycle-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const headers = [], archivedSessionIds = [];
  const ctx = {
    isolate() {
      return { plugin: () => ({ await: async () => {} }),
        inject(_services, apply) { apply({ agentPresets: { list: async () => [] } }); return { await: async () => {} }; } };
    },
    loader: { import: async () => ({ isAgentLoopRequest: () => false }) },
    fiber: { await: () => new Promise(() => {}) }, on() {}, logger: { error() {} },
    sessionPersistence: { list: async () => headers.map(header => ({ header })) },
    workspaceRegistry: {
      archivedSessionIds,
      async archiveSession(id, options) { await archive(id, options); archivedSessionIds.push(id); },
    },
  };
  const service = new SessionForging(ctx, directory);
  function own(id) {
    const plan = { binding: { sessionId: id } };
    service.known.set(id, plan);
    headers.push({ id, agentPreset: presetId(plan) });
  }
  return { service, headers, archivedSessionIds, own };
}

test('stop cancels activation waiting and rejects queued creation', async t => {
  const { service } = await setup(t);
  await service.start();
  const creation = service.create({ requestId: 'one' });
  const rejection = assert.rejects(creation, { code: 'PLUGIN_STOPPING' });
  await service.stop();
  await rejection;
});

test('stop archives only owned sessions and preserves user archives', async t => {
  const { service, headers, archivedSessionIds, own } = await setup(t, async (_, options) => assert.equal(options.stopActivity, true));
  own('active'); own('manual');
  archivedSessionIds.push('manual');
  headers.push({ id: 'ordinary', agentPreset: 'standard' }, { id: 'elsewhere', agentPreset: 'session-forging-another-owner' });
  await service.states.put('active', { ready: true, suspended: false });
  await service.states.put('manual', { ready: true, suspended: false });
  await service.stop();
  await service.stop();
  assert.deepEqual(archivedSessionIds, ['manual', 'active']);
  assert.deepEqual(await service.states.get('active'), { ready: true, suspended: true });
  assert.deepEqual(await service.states.get('manual'), { ready: true, suspended: false });
});

test('archive failure retains the denying guard and still unregisters definitions', async t => {
  const { service, own } = await setup(t, async () => { throw Error('archive failure'); });
  own('one');
  let guardDisposed = false, unregistered = false;
  service.attached.set({ id: 'one' }, () => { guardDisposed = true; });
  service.registrations.set('one', async () => { unregistered = true; });
  await assert.rejects(service.stop(), AggregateError);
  assert.equal(guardDisposed, false);
  assert.equal(service.closing, true);
  assert.equal(unregistered, true);
  assert.equal(await service.states.get('one'), undefined);
});

test('failed suspension journal cannot reopen a user archive on recovery', async t => {
  const { service, archivedSessionIds, own } = await setup(t);
  own('one');
  await service.states.put('one', { ready: true, suspended: false });
  service.states.put = async () => { throw Error('write failure'); };
  await assert.rejects(service.suspend('one'), /write failure/);
  assert.deepEqual(archivedSessionIds, ['one']);
  assert.equal((await service.states.get('one')).suspended, false);
});

test('enumeration failure still attempts to suspend known sessions', async t => {
  const { service, archivedSessionIds, own } = await setup(t);
  own('one');
  service.ctx.sessionPersistence.list = async () => { throw Error('index unavailable'); };
  await assert.rejects(service.stop(), AggregateError);
  assert.deepEqual(archivedSessionIds, ['one']);
});

test('partial feature attachment cannot become runnable on a later retry', async t => {
  const { service } = await setup(t);
  const hooks = new Map();
  service.ctx.effect = effect => effect();
  service.ctx.loader.import = async () => { throw Error('Web integration unavailable'); };
  service.validate = async () => {};
  service.known.set('one', { binding: { spark: {
    matrix: false, components: { tools: ['web_search'] },
    energon: { web: { searchTimeoutMs: 1 } },
  } } });
  await service.states.put('one', { ready: true });
  const agent = { id: 'one', ctx: {
    effect: effect => effect(),
    on: (event, handler) => { hooks.set(event, handler); return () => hooks.delete(event); },
    tools: { restrict: () => () => {} },
    inject: () => ({ dispose() {} }),
  } };
  await assert.rejects(service.attach(agent), /Web integration unavailable/);
  await assert.rejects(service.attach(agent), /Web integration unavailable/);
  let entered = false;
  assert.deepEqual(await hooks.get('agent/pre-step')({ agent }, () => { entered = true; }), { kind: 'reject' });
  assert.equal(entered, false);
});
