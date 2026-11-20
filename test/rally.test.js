import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Rally } from '../src/rally.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'forging-rally-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const events = [],
    deliveries = [],
    workspace = { id: 'work', sessionIds: ['leader', 'member', 'ordinary'] };
  const agent = {
    status: 'idle',
    session: { snapshotEvents: () => events },
    followup: (message) => {
      deliveries.push(message);
      events.push({ type: 'user/message', data: message });
    },
  };
  const f = {
    known: new Map(
      ['leader', 'member'].map((id) => [
        id,
        { binding: { spark: { name: id, matrix: id === 'leader' } } },
      ])
    ),
    observe: async () => undefined,
    view: async (id) => f.known.has(id),
    states: { get: async () => ({ ready: true }) },
    restoreOnce: async () => {},
    ctx: {
      workspaceRegistry: { list: () => [workspace], archivedSessionIds: [] },
      sessionController: { list: async () => ({items: workspace.sessionIds.map(sessionId =>
        ({sessionId, blank:false, agentAvailable:true, projections:{values:{title:sessionId}}}))}) },
      agents: new Map([['member', agent]]),
      sessions: { flush: async () => {} },
      loader: { import: async () => ({ freezeMessage: (value) => value }) },
    },
  };
  const rally = new Rally(f, directory),
    input = {
      sessionId: 'leader',
      requestId: 'change',
      message: 'New model',
      responsibilities: { leader: 'Design', member: 'Data' },
    };
  return { f, rally, input, deliveries, events, workspace, directory };
}

test('rally retries failed recipients without duplicating accepted inputs or adding new members', async (t) => {
  const { f, rally, input, deliveries } = await fixture(t);
  f.restoreOnce = async (id) => {
    if (id === 'member') throw Error('offline');
  };
  assert.equal((await rally.send(input)).targets[0].status, 'failed');
  assert.equal(deliveries.length, 0);
  f.restoreOnce = async () => {};
  const result = await rally.send(input);
  assert.equal(result.targets[0].status, 'accepted');
  assert.equal(deliveries.length, 1);
  assert.deepEqual(await rally.send(input), result);
  assert.equal(deliveries.length, 1);
  await assert.rejects(rally.send({ ...input, message: 'different' }), { code: 'RALLY_CONFLICT' });
});

test('uncertain enqueue is persisted and never automatically resent', async (t) => {
  const { f, rally, input, deliveries } = await fixture(t);
  f.ctx.sessions.flush = async () => {
    throw Error('disk unavailable');
  };
  assert.equal((await rally.send(input)).targets[0].status, 'uncertain');
  f.ctx.sessions.flush = async () => {};
  assert.equal((await rally.send(input)).targets[0].status, 'uncertain');
  assert.equal(deliveries.length, 1);
});

test('interrupted sending reconciles durable evidence and otherwise stays uncertain', async (t) => {
  const { rally, input, deliveries, events } = await fixture(t);
  const result = await rally.send(input);
  result.targets[0].status = 'sending';
  await rally.records.put(result.id, result);
  assert.equal((await rally.send(input)).targets[0].status, 'accepted');
  events.length = 0;
  await rally.records.put(result.id, result);
  assert.equal((await rally.send(input)).targets[0].status, 'uncertain');
  assert.equal(deliveries.length, 1);
});

test('archived or moved recipients are not awakened and stale membership is rejected', async (t) => {
  const { f, rally, input, deliveries, workspace } = await fixture(t);
  await assert.rejects(rally.send({ ...input, membershipRevision: 'stale' }), {
    code: 'MEMBERS_CHANGED',
  });
  f.ctx.workspaceRegistry.archivedSessionIds.push('member');
  await assert.rejects(rally.send({...input, targets:['member']}), { code:'SESSION_ARCHIVED' });
  f.ctx.workspaceRegistry.archivedSessionIds.length = 0;
  workspace.sessionIds = ['leader', 'ordinary'];
  await assert.rejects(rally.send({...input, responsibilities:{}, targets:['member']}), {code:'UNKNOWN_MEMBER'});
  assert.equal(deliveries.length, 0);
});

test('old responsibilities stay with the original session after a workspace move', async t => {
  const { f, rally, workspace } = await fixture(t);
  const {contentRevision} = await import('../src/source.js');
  const plan = f.known.get('member');
  plan.workspaceId = 'original';
  await rally.roles.put(contentRevision('original'), { member: '审查接口' });
  await rally.loadLegacyMissions();
  assert.equal((await rally.members('leader')).members.find(m => m.sessionId === 'member').responsibility,'审查接口');
  plan.mission = '';
  assert.equal(rally.mission('member'), '');
  workspace.sessionIds = ['leader'];
  assert.equal((await rally.members('leader')).members.length,1);
});

test('unknown or blank summaries stay off the roster and recipients see only their own delivery', async t => {
  const { f, rally, input } = await fixture(t);
  await rally.send(input);
  const [record] = await rally.list('member');
  assert.equal(record.input, undefined);
  assert.equal(record.roles, undefined);
  f.ctx.sessionController.list = async () => ({items:[{sessionId:'member',blank:true}]});
  assert.deepEqual((await rally.members('leader')).members,[]);
});

test('only a leader panel may remove another archived member in the confirmed workspace', async t => {
  const {f, rally} = await fixture(t);
  const remove = {sessionId:'leader', targetId:'member', workspaceId:'work', scope:'workspace'};
  await assert.rejects(rally.remove(remove), {code:'NOT_ARCHIVED'});
  f.ctx.workspaceRegistry.archivedSessionIds.push('member');
  await assert.rejects(rally.remove({...remove,sessionId:'member',targetId:'leader'}), {code:'NOT_LEADER'});
  await assert.rejects(rally.remove({...remove,workspaceId:'moved'}), {code:'UNKNOWN_MEMBER'});
  await assert.rejects(rally.remove({...remove,targetId:'ordinary'}), {code:'UNKNOWN_MEMBER'});
  await assert.rejects(rally.remove({...remove,targetId:'leader'}), {code:'UNKNOWN_MEMBER'});
  const change = rally.removalNotices.read('members',0);
  assert.equal(await rally.remove(remove),null);
  assert.equal((await change).revision,1);
  assert.equal(await rally.remove(remove),null);
  assert.equal((await rally.removalNotices.read('members',null)).revision,1);
  assert.deepEqual(f.ctx.workspaceRegistry.archivedSessionIds,['member']);
});

test('removal survives reopening and native unarchive, including retries of a failed delivery', async t => {
  const {f, rally, input, directory, deliveries} = await fixture(t);
  f.known.get('member').binding.spark.matrix = true;
  f.restoreOnce = async id => { if (id === 'member') throw Error('offline'); };
  const failed = await rally.send(input);
  assert.equal(failed.targets[0].status,'failed');
  f.ctx.workspaceRegistry.archivedSessionIds.push('member');
  await rally.remove({sessionId:'leader',targetId:'member',workspaceId:'work',scope:'workspace'});
  const reopened = new Rally(f, directory);
  await reopened.loadRemovals();
  f.ctx.workspaceRegistry.archivedSessionIds.length = 0;
  f.restoreOnce = async () => {};
  assert.deepEqual((await reopened.members('leader','authorized')).members.map(m=>m.sessionId),['leader']);
  const retry = await reopened.send(input);
  assert.equal(retry.targets[0].status,'failed');
  assert.equal(deliveries.length,0);
  await assert.rejects(reopened.send({...input,requestId:'new',responsibilities:{},targets:['member']}), {code:'UNKNOWN_MEMBER'});
  await assert.rejects(reopened.revive({sessionId:'leader',targetId:'member',requestId:'new'}), {code:'UNKNOWN_MEMBER'});
  await assert.rejects(reopened.send({...input,sessionId:'member'}), {code:'NOT_LEADER'});
  assert.equal((await reopened.list('leader'))[0].id, failed.id);
});

test('delegated callers cannot submit an operator removal', async () => {
  const {SessionForging} = await import('../src/forging.js');
  const service = Object.create(SessionForging.prototype);
  service.ctx = {invocation:{peer:{principal:{kind:'guest'}}}};
  assert.throws(() => service.rallyRemove({sessionId:'leader',targetId:'member',workspaceId:'work',scope:'workspace'}),
    {code:'ACCESS_DENIED'});
});

test('native unarchive during confirmation keeps the member visible', async t => {
  const { f, rally } = await fixture(t);
  f.ctx.workspaceRegistry.archivedSessionIds.push('member');
  const members = rally.members.bind(rally);
  rally.members = async (...args) => {
    const snapshot = await members(...args);
    f.ctx.workspaceRegistry.archivedSessionIds.length = 0;
    return snapshot;
  };
  await assert.rejects(rally.remove({sessionId:'leader', targetId:'member', workspaceId:'work', scope:'workspace'}),
    {code:'NOT_ARCHIVED'});
  assert.equal(rally.removed.has('member'),false);
  assert.deepEqual(await rally.removals.list(),[]);
});
