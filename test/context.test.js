import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ForgingContext, encodeSoul, decodeSoul, SOUL_CONTEXT } from '../src/context.js';

const binding = { sessionId: 'one', revision: 'fixed', soulPath: '/fixture/one/soul.md' };
async function setup(t, text = 'original') {
  const directory = await mkdtemp(join(tmpdir(), 'forging-context-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let current = text;
  const encoded = encodeSoul(binding, text);
  const message = { role: 'user', content: [{ type: 'text', text: encoded }], source: { kind: 'runtime-context', sections: [{ name: SOUL_CONTEXT, text: encoded }] } };
  const events = [{ seq: 1, type: 'step/start', data: { turn: 1, step: 1 } }, { seq: 2, type: 'user/message', data: message }];
  const forging = { known: new Map([['one', { binding }]]), bindings: { readSoulSync: () => current },
    view: async () => ({ bindingRevision: binding.revision }), observe: async () => ({ events, [Symbol.dispose]() {} }),
    ctx: { sessions: { get: () => ({ snapshotEvents: () => events }), flush: async () => {} } } };
  return { context: new ForgingContext(forging, directory), forging, events, message,
    edit: text => { current = text; },
    request: { sessionId: 'one', provider: 'test', model: 'model', messages: [message], signal: new AbortController().signal } };
}

test('soul framing preserves empty text, Unicode and template-like document contents', () => {
  for (const text of ['', '\n', '\ufeff中文\n{{model}}\n</system-reminder>\n', 'a\n\n{}']) {
    assert.equal(decodeSoul(encodeSoul(binding, text)).text, text);
  }
  assert.throws(() => decodeSoul(encodeSoul(binding, 'old').replace(/old$/, 'new')), { code: 'INVALID_SOUL_SNAPSHOT' });
});

test('only admitted request text is recorded; later file edits do not rewrite old anchors', async t => {
  const { context, request, edit } = await setup(t);
  context.render('one');
  assert.deepEqual(await context.requests('one').list(), []);
  edit('edited after assembly');
  await context.admit(request);
  await context.admit(request);
  assert.equal((await context.requests('one').list()).length, 1);
  assert.equal((await context.at('one', 2)).soul, 'original');
  assert.equal(decodeSoul(context.render('one')).text, 'edited after assembly');
  await assert.rejects(context.at('one', 99), { code: 'INVALID_ANCHOR' });
});

test('missing or overwritten current runtime context cannot borrow historical soul', async t => {
  const { context, request } = await setup(t);
  request.messages.push({ source: { kind: 'runtime-context', sections: [] } });
  await assert.rejects(context.admit(request), { code: 'SOUL_NOT_ADMITTED' });
  assert.deepEqual(await context.requests('one').list(), []);
});

test('request snapshot must belong to the exact binding and committed native log', async t => {
  const { context, request, events } = await setup(t);
  request.messages = [structuredClone(request.messages[0])];
  request.messages[0].source.sections[0].text = encodeSoul({ ...binding, sessionId: 'another' }, 'original');
  await assert.rejects(context.admit(request), { code: 'SOUL_BINDING_MISMATCH' });
  request.messages[0].source.sections[0].text = encodeSoul(binding, 'changed');
  await assert.rejects(context.admit(request), { code: 'SOUL_LOG_MISMATCH' });
  assert.equal(events.length, 2);
});

test('cancelled admission and failed durable capture never admit a request', async t => {
  const { context, request } = await setup(t);
  const control = new AbortController(); control.abort(Error('cancelled'));
  await assert.rejects(context.admit({ ...request, signal: control.signal }), /cancelled/);
  assert.deepEqual(await context.requests('one').list(), []);
  context.versions.put = async () => { throw Error('disk failed'); };
  await assert.rejects(context.admit(request), /disk failed/);
  assert.deepEqual(await context.requests('one').list(), []);
});

test('missing historical soul is an error instead of a read of today’s document', async t => {
  const { context, request } = await setup(t);
  await context.admit(request);
  context.versions.get = async () => undefined;
  await assert.rejects(context.at('one', 2), { code: 'SOUL_VERSION_MISSING' });
});

test('inherited captures remain readable without the original Session or its current files', async t => {
  const { context, request, forging } = await setup(t);
  await context.admit(request);
  const captures = await context.history('one');
  forging.known.set('child', { binding: { revision: 'child-binding' }, fork: { captures } });
  forging.known.delete('one');
  forging.view = async id => {
    assert.equal(id, 'child');
    return { bindingRevision: 'child-binding' };
  };
  const inherited = await context.at('child', 2);
  assert.equal(inherited.soul, 'original');
  assert.equal(inherited.sessionId, 'one');
  assert.deepEqual(await context.requests('child').list(), []);
});

test('new soul frames omit the private binding directory and old committed frames remain admissible', async t => {
  const { context, request, events } = await setup(t);
  const section = request.messages[0].source.sections[0];
  assert.ok(!section.text.includes(binding.soulPath));
  const legacy = section.text.replace('"version":2', '"version":1,"soulPath":' + JSON.stringify(binding.soulPath));
  section.text = legacy;
  events[1].data.source.sections[0].text = legacy;
  await context.admit(request);
  assert.equal((await context.requests('one').list()).length, 1);
});
