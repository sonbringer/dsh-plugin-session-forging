import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { SourceRegistry, previewSource } from '../src/sources.js';
import { SessionBindings } from '../src/bindings.js';
import { manifest } from './fixtures.js';

const hasCode = code => error => error.code === code;

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'forging-bindings-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sources = new SourceRegistry(join(root, 'sources'));
  const text = JSON.stringify(manifest());
  const source = await sources.register(text, previewSource(text).revision);
  const directory = join(root, 'bindings');
  const bindings = new SessionBindings(directory, sources);
  const input = { sessionId: 'session-a', source, sparkId: 'test-spark' };
  return { root, sources, directory, bindings, input };
}

test('binding, creation text and independent soul survive reopening', async t => {
  const { bindings, input, directory, sources } = await fixture(t);
  const prepared = await bindings.prepare(input);
  assert.equal(prepared.sessionId, input.sessionId);
  assert.deepEqual(prepared.source, input.source);
  assert.deepEqual(prepared.creation, { persona: '', soul: '' });
  assert.equal(await bindings.readSoul(input.sessionId), '');
  const reopened = new SessionBindings(directory, sources);
  assert.deepEqual(await reopened.get(input.sessionId), prepared);
  assert.deepEqual((await readdir(dirname(prepared.soulPath))).sort(), ['binding.json', 'soul.md']);
  prepared.spark.persona = 'Mutated return value';
  assert.equal((await reopened.get(input.sessionId)).spark.persona, '');
});

test('recovery enumerates published bindings without resetting edited soul or admitting staging files', async t => {
  const { bindings, input, directory, sources } = await fixture(t);
  assert.deepEqual(await bindings.list(), []);
  const a = await bindings.prepare(input);
  const b = await bindings.prepare({ ...input, sessionId: 'session-b' });
  await writeFile(a.soulPath, 'Edited after preparation');
  await mkdir(join(directory, '.preparing-interrupted'));
  const reopened = new SessionBindings(directory, sources);
  const recovered = await reopened.list();
  assert.deepEqual(recovered.sort((a, b) => a.sessionId.localeCompare(b.sessionId)), [a, b]);
  assert.equal(await reopened.readSoul(input.sessionId), 'Edited after preparation');
  await rm(a.soulPath);
  assert.equal((await reopened.list()).length, 2);
  await assert.rejects(reopened.readSoul(input.sessionId), hasCode('SOUL_UNAVAILABLE'));
});

test('recovery refuses corrupted bindings and identity mismatches instead of hiding them', async t => {
  const { bindings, input, directory } = await fixture(t);
  const a = await bindings.prepare(input);
  const file = join(dirname(a.soulPath), 'binding.json');
  const original = await readFile(file);
  await writeFile(file, '{');
  await assert.rejects(bindings.list(), hasCode('CORRUPT_BINDING'));
  await writeFile(file, original);
  await rename(dirname(a.soulPath), join(directory, `session-${'0'.repeat(64)}`));
  await assert.rejects(bindings.list(), hasCode('CORRUPT_BINDING'));
});

test('recovery does not follow a binding directory link', { skip: process.platform === 'win32' }, async t => {
  const { root, bindings, input } = await fixture(t);
  const a = await bindings.prepare(input);
  const directory = dirname(a.soulPath);
  const moved = join(root, 'moved');
  await rename(directory, moved);
  await symlink(moved, directory);
  await assert.rejects(bindings.list(), hasCode('CORRUPT_BINDING'));
});

test('edited Spark is validated and fixed without changing its source', async t => {
  const { bindings, input, sources } = await fixture(t);
  const spark = manifest().sparks[0];
  spark.persona = 'TEST_PERSONA {{model}}';
  spark.soul = 'TEST_SOUL';
  const result = await bindings.prepare({ ...input, spark });
  spark.persona = 'Changed later';
  assert.equal(result.creation.persona, 'TEST_PERSONA {{model}}');
  assert.equal((await bindings.get(input.sessionId)).creation.soul, 'TEST_SOUL');
  assert.equal((await sources.get(input.source)).sparks[0].persona, '');
  const invalid = manifest().sparks[0];
  invalid.energon.maxTokens = 0;
  await assert.rejects(bindings.prepare({ ...input, sessionId: 'invalid', spark: invalid }), hasCode('INVALID_SOURCE'));
});

test('current soul edits never rewrite creation records or another Session', async t => {
  const { bindings, input } = await fixture(t);
  const a = await bindings.prepare(input);
  const b = await bindings.prepare({ ...input, sessionId: 'session-b' });
  assert.notEqual(a.soulPath, b.soulPath);
  await writeFile(a.soulPath, '\uFEFF新的档案\n');
  assert.equal(await bindings.readSoul(input.sessionId), '\uFEFF新的档案\n');
  assert.equal(await bindings.readSoul('session-b'), '');
  assert.deepEqual((await bindings.get(input.sessionId)).creation, { persona: '', soul: '' });
  assert.equal((await bindings.get(input.sessionId)).revision, a.revision);
});

test('retrying the same preparation is idempotent and does not reset soul', async t => {
  const { bindings, input } = await fixture(t);
  const original = await bindings.prepare(input);
  await writeFile(original.soulPath, 'Keep this edit');
  assert.deepEqual(await bindings.prepare(input), original);
  assert.equal(await bindings.readSoul(input.sessionId), 'Keep this edit');
  const changed = manifest().sparks[0];
  changed.persona = 'Different fixed configuration';
  await assert.rejects(bindings.prepare({ ...input, spark: changed }), hasCode('BINDING_EXISTS'));
  assert.deepEqual(await bindings.get(input.sessionId), original);
});

test('invalid reference or Spark leaves no prepared files', async t => {
  const { bindings, input, directory } = await fixture(t);
  await assert.rejects(bindings.prepare({ ...input, sparkId: 'absent' }), hasCode('SPARK_NOT_FOUND'));
  await assert.rejects(bindings.prepare({ ...input, source: { ...input.source, revision: '0'.repeat(64) } }), hasCode('SOURCE_CHANGED'));
  await assert.rejects(bindings.prepare({ ...input, sessionId: '\n' }), hasCode('INVALID_SESSION_ID'));
  await assert.rejects(bindings.prepare({ ...input, sessionId: '\ud800' }), hasCode('INVALID_SESSION_ID'));
  const invalidSoul = { ...manifest().sparks[0], soul: '\ud800' };
  await assert.rejects(bindings.prepare({ ...input, spark: invalidSoul }), hasCode('INVALID_SOUL'));
  await assert.rejects(stat(directory), hasCode('ENOENT'));
  await assert.rejects(bindings.get('ordinary-session'), hasCode('BINDING_NOT_FOUND'));
});

test('opaque native IDs stay inside the data directory', async t => {
  const { bindings, input, directory } = await fixture(t);
  const result = await bindings.prepare({ ...input, sessionId: '../native/id' });
  assert.equal(dirname(dirname(result.soulPath)), directory);
  assert.equal((await bindings.get('../native/id')).sessionId, '../native/id');
});

test('missing source, binding or soul is never replaced with a cached default', async t => {
  const { root, bindings, input } = await fixture(t);
  const prepared = await bindings.prepare(input);
  await rm(prepared.soulPath);
  await assert.rejects(bindings.readSoul(input.sessionId), hasCode('SOUL_UNAVAILABLE'));
  assert.equal((await bindings.get(input.sessionId)).creation.soul, '');
  await bindings.prepare(input);
  await assert.rejects(stat(prepared.soulPath), hasCode('ENOENT'));
  const sourcePath = join(root, 'sources', 'source-test-source.json');
  const original = await readFile(sourcePath);
  await rm(sourcePath);
  await assert.rejects(bindings.get(input.sessionId), hasCode('SOURCE_NOT_FOUND'));
  await writeFile(sourcePath, original);
  await rm(join(dirname(prepared.soulPath), 'binding.json'));
  await assert.rejects(bindings.get(input.sessionId), hasCode('CORRUPT_BINDING'));
  await assert.rejects(bindings.prepare(input), hasCode('CORRUPT_BINDING'));
});

test('modified bindings and invalid UTF-8 soul fail explicitly', async t => {
  const { bindings, input } = await fixture(t);
  const prepared = await bindings.prepare(input);
  const path = join(dirname(prepared.soulPath), 'binding.json');
  const original = await readFile(path, 'utf8');
  const record = JSON.parse(original);
  record.snapshot.spark.persona = 'Tampered fixed content';
  await writeFile(path, JSON.stringify(record));
  await assert.rejects(bindings.get(input.sessionId), hasCode('CORRUPT_BINDING'));
  await writeFile(path, original);
  await writeFile(prepared.soulPath, Buffer.from([0xff]));
  await assert.rejects(bindings.readSoul(input.sessionId), hasCode('SOUL_UNAVAILABLE'));
  await writeFile(prepared.soulPath, 'a'.repeat(16001));
  await assert.rejects(bindings.readSoul(input.sessionId), hasCode('SOUL_UNAVAILABLE'));
  await writeFile(prepared.soulPath, '');
  assert.equal(await bindings.readSoul(input.sessionId), '');
});

test('separate processes publish one complete binding for a conflicting Session ID', async t => {
  const { root, directory, bindings, input } = await fixture(t);
  const moduleUrl = new URL('../src/bindings.js', import.meta.url).href;
  const sourcesUrl = new URL('../src/sources.js', import.meta.url).href;
  const code = `
    const { SessionBindings } = await import(process.argv[1]);
    const { SourceRegistry } = await import(process.argv[2]);
    const bindings = new SessionBindings(process.argv[3], new SourceRegistry(process.argv[4]));
    try { await bindings.prepare(JSON.parse(process.argv[5])); }
    catch (error) { console.error(error.code); process.exitCode = error.code === 'BINDING_EXISTS' ? 2 : 1; }
  `;
  const run = input => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code, moduleUrl, sourcesUrl, directory, join(root, 'sources'), JSON.stringify(input)], { timeout: 10000 });
    let error = '';
    child.stderr.on('data', b => { error += b; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, error }));
  });
  const spark = manifest().sparks[0];
  spark.soul = 'Competing initial soul';
  const results = await Promise.all([run(input), run({ ...input, spark })]);
  assert.deepEqual(results.map(r => r.code).sort(), [0, 2], JSON.stringify(results));
  const prepared = await bindings.get(input.sessionId);
  assert.equal(await bindings.readSoul(input.sessionId), prepared.creation.soul);
  assert.equal((await readdir(directory)).length, 1);
});

test('interrupted staging stays separate from visible bindings', async t => {
  const { directory, bindings, input } = await fixture(t);
  await mkdir(join(directory, '.preparing-interrupted'), { recursive: true });
  await writeFile(join(directory, '.preparing-interrupted', 'binding.json'), '{');
  await assert.rejects(bindings.get(input.sessionId), hasCode('BINDING_NOT_FOUND'));
  const prepared = await bindings.prepare(input);
  assert.equal(await bindings.readSoul(input.sessionId), prepared.creation.soul);
});

test('soul links cannot replace the independent Session file', { skip: process.platform === 'win32' }, async t => {
  const { bindings, input } = await fixture(t);
  const a = await bindings.prepare(input);
  const b = await bindings.prepare({ ...input, sessionId: 'session-b' });
  await rm(a.soulPath);
  await symlink(b.soulPath, a.soulPath);
  await assert.rejects(bindings.readSoul(input.sessionId), hasCode('SOUL_UNAVAILABLE'));
  assert.throws(() => bindings.readSoulSync(input.sessionId), hasCode('SOUL_UNAVAILABLE'));
});

test('admission reads the latest literal soul synchronously and rejects missing or invalid text', async t => {
  const { bindings, input } = await fixture(t);
  const binding = await bindings.prepare(input);
  assert.equal(bindings.readSoulSync(input.sessionId), '');
  await writeFile(binding.soulPath, '\ufeff心智 {{model}}\n');
  assert.equal(bindings.readSoulSync(input.sessionId), '\ufeff心智 {{model}}\n');
  await writeFile(binding.soulPath, Buffer.from([0xff]));
  assert.throws(() => bindings.readSoulSync(input.sessionId), hasCode('SOUL_UNAVAILABLE'));
  await rm(binding.soulPath);
  assert.throws(() => bindings.readSoulSync(input.sessionId), hasCode('SOUL_UNAVAILABLE'));
});
