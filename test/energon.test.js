import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Energon, reportedUsage, usageCost, stepPolicy } from '../src/energon.js';
import { emptyEnergon } from '../src/workbench.js';

test('step reserves count durable starts, survive steering, and include final answers', () => {
  const config = {
    ...emptyEnergon(),
    maxTurnDurationMs: 1000,
    wrapUpLeadTimeMs: 200,
    steps: { maxStepsPerTurn: 3, wrapUpSteps: 2, finalReplySteps: 1 },
  };
  const events = [{ seq: 0, time: 100, type: 'turn/start', data: { turn: 1 } }];
  assert.equal(stepPolicy(config, events, 200).remaining, 3);
  events.push({ seq: 1, type: 'step/start' }, { seq: 2, type: 'user/message' });
  assert.equal(stepPolicy(config, events, 200).stage, 'wrap-up');
  events.push({ seq: 3, type: 'step/start' });
  assert.equal(stepPolicy(config, events, 200).stage, 'final');
  events.push({ seq: 4, type: 'step/start' });
  assert.equal(stepPolicy(config, events, 200).stage, 'step-limit');
  events.push({ seq: 5, time: 2000, type: 'turn/start', data: { turn: 2 } });
  assert.equal(stepPolicy(config, events, 2100).remaining, 3);
  assert.equal(stepPolicy(config, events, 3000).stage, 'time-limit');
  assert.equal(stepPolicy({ ...config, deadlineAt: 2050 }, events, 2100).stage, 'time-limit');
});
test('usage buckets are disjoint and inconsistent totals remain unknown', () => {
  const usage = reportedUsage({
    inputTokens: 5,
    outputTokens: 2,
    cacheReadTokens: 1,
    reasoningTokens: 2,
    totalTokens: 8,
  });
  assert.equal(usage.totalTokens, 8);
  assert.equal(usageCost(usage, { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 1 }), 0.0000095);
  assert.equal(reportedUsage({ inputTokens: 5, outputTokens: 2, totalTokens: 8 }), null);
  assert.equal(reportedUsage({ inputTokens: NaN, outputTokens: 2 }), null);
  assert.equal(usageCost(usage, null), null);
});
test('durable usage tracks partial attempts and blocks a finite quota after uncertainty', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'forging-energy-'));
  try {
    const config = { ...emptyEnergon(), tokenLimit: 10 };
    const forging = { known: new Map([['id', { binding: { spark: { energon: config } } }]]) };
    const energy = new Energon(forging, directory);
    const options = { sessionId: 'id', provider: 'p', model: 'm' };
    for await (const _ of energy.stream(options, async function* () {
      yield { type: 'usage', usage: { inputTokens: 5, outputTokens: 2 } };
    })) {
    }
    assert.equal((await new Energon(forging, directory).usage('id')).tokens, 7);
    for await (const _ of energy.stream(options, async function* () {})) {
    }
    assert.match(await energy.quota('id'), /incomplete/);
    assert.equal((await energy.usage('id')).unknownUsage, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('scoped Energon handlers ignore events from another Agent', async () => {
  const callbacks = new Map(), config = emptyEnergon();
  const owner = { id: 'owner', options: {}, ctx: {
    on: (name, callback) => { callbacks.set(name, callback); return () => {}; },
    effect: setup => setup(), tools: { guard: () => () => {} },
  } };
  const energy = new Energon({ known: new Map([['owner', { binding: { spark: { energon: config } } }]]), ctx: { effect: setup => setup() } }, '/tmp/unused-forging');
  await energy.attach(owner);
  const other = { id: 'other' };
  energy.before = () => { throw Error('Wrong Agent'); };
  const timer = { handles: [], startSeq: 1 }; energy.timers.set(owner, timer);
  assert.equal(await callbacks.get('agent/pre-step')({ agent: other }, () => 'unmodified'), 'unmodified');
  callbacks.get('agent/status')({ agent: other, status: 'idle' });
  assert.equal(energy.timers.get(owner), timer);
  callbacks.get('agent/status')({ agent: owner, status: 'idle' });
  assert.equal(energy.timers.has(owner), false);
});

test('timer callback failure is reported instead of escaping the event loop', async () => {
  const errors = [], config = { ...emptyEnergon(), wrapUpLeadTimeMs: 15 };
  const forging = { known: new Map([['owner', { binding: { spark: { energon: config } } }]]),
    ctx: { logger: { error: error => errors.push(error.message) } }, message: value => value, notices: { publish() {} } };
  const energy = new Energon(forging, '/tmp/unused-forging');
  const agent = { id: 'owner', status: 'running', session: { snapshotEvents: () => [{ type: 'turn/start', seq: 0 }] },
    steer() { throw Error('steer failed'); }, cancel() { throw Error('cancel failed'); } };
  energy.arm(agent, { startSeq: 0, deadline: Date.now() + 30 });
  try { await new Promise(resolve => setTimeout(resolve, 60)); assert.deepEqual(errors, ['steer failed', 'cancel failed']); }
  finally { energy.clear(agent); }
});
