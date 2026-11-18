import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { SourceRegistry, previewSource, MAX_SOURCE_BYTES } from '../src/sources.js';

function manifest() {
  return {
    schemaVersion: 1, id: 'test-source', name: 'Test source', description: '',
    sparks: [{
      id: 'test-spark', name: 'Test spark', description: '', persona: '', soul: '',
      cog: { provider: '', model: '', reasoningEffort: '' },
      components: { tools: [], skills: [] }, matrix: false,
      energon: {
        maxTokens: null, tokenLimit: null, maxTurnDurationMs: null, wrapUpLeadTimeMs: 0,
        steps: { maxStepsPerTurn: null, wrapUpSteps: 0, finalReplySteps: 0 },
        web: { searchMaxQueries: null, searchMaxResults: null, searchSummaryMaxChars: null },
      },
    }],
  };
}

async function registry(t) {
  const root = await mkdtemp(join(tmpdir(), 'forging-sources-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'sources');
  return { directory, sources: new SourceRegistry(directory) };
}

const register = (sources, source = manifest()) => {
  const text = JSON.stringify(source);
  return sources.register(text, previewSource(text).revision);
};
const hasCode = code => error => error.code === code;

test('preview validates without creating data or binding mutable objects', async t => {
  const { directory, sources } = await registry(t);
  const text = JSON.stringify(manifest());
  const preview = previewSource(text);
  assert.equal(preview.source.sparks[0].soul, '');
  preview.source.sparks[0].soul = 'Edited preview';
  assert.deepEqual(await sources.list(), []);
  await assert.rejects(stat(directory), hasCode('ENOENT'));
  const ref = await sources.register(text, preview.revision);
  const loaded = await sources.get(ref);
  assert.equal(loaded.sparks[0].soul, '');
  loaded.sparks[0].components.tools.push('changed');
  assert.deepEqual((await sources.get(ref)).sparks[0].components.tools, []);
});

test('schema rejects malformed, unknown, missing and mistyped configuration', () => {
  assert.throws(() => previewSource('{'), hasCode('INVALID_SOURCE'));
  assert.throws(() => previewSource({}), hasCode('INVALID_SOURCE'));
  assert.throws(() => previewSource('null'), hasCode('INVALID_SOURCE'));
  for (const mutate of [
    s => { s.schemaVersion = 2; },
    s => { s.execute = 'anything'; },
    s => { s.id = '../escape'; },
    s => { s.id = 'trailing-newline\n'; },
    s => { s.name = ' '; },
    s => { s.sparks = []; },
    s => { s.sparks.push(structuredClone(s.sparks[0])); },
    s => { delete s.sparks[0].soul; },
    s => { s.sparks[0].soul = null; },
    s => { s.sparks[0].matrix = 'false'; },
    s => { s.sparks[0].components.tools = ['read', 'read']; },
    s => { s.sparks[0].cog.model = 'model-without-provider'; },
    s => { s.sparks[0].persona = '{{unknown}}'; },
    s => { s.sparks[0].energon.maxTokens = 0; },
    s => { s.sparks[0].energon.maxTokens = '100'; },
    s => { s.sparks[0].energon.tokenLimit = Number.MAX_SAFE_INTEGER + 1; },
  ]) {
    const source = manifest();
    mutate(source);
    assert.throws(() => previewSource(JSON.stringify(source)), hasCode('INVALID_SOURCE'));
  }
});

test('size limits count UTF-8 bytes; schema limits the number of sparks', () => {
  const large = JSON.stringify({ text: '火'.repeat(MAX_SOURCE_BYTES / 2) });
  assert.ok(large.length < MAX_SOURCE_BYTES);
  assert.throws(() => previewSource(large), /256 KiB/);
  const source = manifest();
  source.sparks = Array.from({ length: 51 }, (_, i) => ({ ...source.sparks[0], id: `spark-${i}` }));
  assert.throws(() => previewSource(JSON.stringify(source)), hasCode('INVALID_SOURCE'));
});

test('step and time reserves obey their total limits, while zero token quota is valid', () => {
  const source = manifest();
  const energy = source.sparks[0].energon;
  energy.tokenLimit = 0;
  energy.maxTokens = 1;
  energy.steps = { maxStepsPerTurn: 3, wrapUpSteps: 2, finalReplySteps: 1 };
  energy.maxTurnDurationMs = 100;
  energy.wrapUpLeadTimeMs = 99;
  assert.doesNotThrow(() => previewSource(JSON.stringify(source)));
  for (const [steps, duration, lead] of [
    [{ maxStepsPerTurn: null, wrapUpSteps: 1, finalReplySteps: 0 }, 100, 0],
    [{ maxStepsPerTurn: 3, wrapUpSteps: 4, finalReplySteps: 1 }, 100, 0],
    [{ maxStepsPerTurn: 3, wrapUpSteps: 1, finalReplySteps: 2 }, 100, 0],
    [{ maxStepsPerTurn: 3, wrapUpSteps: 1, finalReplySteps: 1 }, null, 1],
    [{ maxStepsPerTurn: 3, wrapUpSteps: 1, finalReplySteps: 1 }, 100, 100],
  ]) {
    Object.assign(energy, { steps, maxTurnDurationMs: duration, wrapUpLeadTimeMs: lead });
    assert.throws(() => previewSource(JSON.stringify(source)), hasCode('INVALID_SOURCE'));
  }
});

test('revision ignores object order and formatting, but preserves strings and array order', () => {
  const source = manifest();
  source.sparks[0].persona = '{{ model }}\n';
  source.sparks[0].components.tools = ['a', 'b'];
  const reverseKeys = v => Array.isArray(v) ? v.map(reverseKeys)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).reverse().map(k => [k, reverseKeys(v[k])])) : v;
  const original = previewSource(JSON.stringify(source));
  assert.equal(previewSource(JSON.stringify(reverseKeys(source), null, 2)).revision, original.revision);
  assert.equal(original.source.sparks[0].persona, '{{ model }}\n');
  source.sparks[0].components.tools.reverse();
  assert.notEqual(previewSource(JSON.stringify(source)).revision, original.revision);
});

test('confirmation checks the exact preview and revalidates input before writing', async t => {
  const { directory, sources } = await registry(t);
  const source = manifest();
  const preview = previewSource(JSON.stringify(source));
  source.name = 'Changed after preview';
  await assert.rejects(sources.register(JSON.stringify(source), preview.revision), hasCode('SOURCE_CHANGED'));
  await assert.rejects(sources.register(JSON.stringify(source)), hasCode('SOURCE_CHANGED'));
  await assert.rejects(sources.register('{', preview.revision), hasCode('INVALID_SOURCE'));
  await assert.rejects(stat(directory), hasCode('ENOENT'));
});

test('registered sources reopen by pinned reference and export all attribution unchanged', async t => {
  const { directory, sources } = await registry(t);
  const source = manifest();
  source.provenance = {
    project: 'Fixture', url: 'https://example.com/source', revision: 'fixed',
    license: 'MIT', licenseText: 'Fixture license text\n', adaptation: 'Fixture only',
  };
  source.sparks[0].provenance = structuredClone(source.provenance);
  const ref = await register(sources, source);
  const reopened = new SourceRegistry(directory);
  assert.deepEqual(await reopened.get(ref), source);
  const exported = await reopened.export(ref);
  assert.deepEqual(JSON.parse(exported), source);
  assert.equal(previewSource(exported).revision, ref.revision);
  assert.deepEqual(await reopened.list(), [{ ...ref, name: source.name }]);
  assert.deepEqual(await readdir(directory), ['source-test-source.json']);
  await assert.rejects(reopened.get({ id: ref.id }), hasCode('INVALID_REFERENCE'));
  await assert.rejects(reopened.get({ ...ref, id: '../escape' }), hasCode('INVALID_REFERENCE'));
});

test('duplicate IDs never overwrite a registered source, even with changed content', async t => {
  const { sources } = await registry(t);
  const original = manifest();
  const ref = await register(sources, original);
  const changed = structuredClone(original);
  changed.sparks[0].soul = 'New source content';
  await assert.rejects(register(sources, original), hasCode('SOURCE_EXISTS'));
  await assert.rejects(register(sources, changed), hasCode('SOURCE_EXISTS'));
  assert.deepEqual(await sources.get(ref), original);
  const changingReference = { ...ref };
  const pendingRead = sources.get(changingReference);
  changingReference.revision = '0'.repeat(64);
  assert.deepEqual(await pendingRead, original);
  changed.id = 'other-source';
  await register(sources, changed);
  assert.equal((await sources.list()).length, 2);
});

test('separate processes racing the same ID publish exactly one complete source', async t => {
  const { directory, sources } = await registry(t);
  const moduleUrl = new URL('../src/sources.js', import.meta.url).href;
  const code = `
    const { SourceRegistry, previewSource } = await import(process.argv[1]);
    const text = process.argv[3];
    try {
      const ref = await new SourceRegistry(process.argv[2]).register(text, previewSource(text).revision);
      console.log(JSON.stringify(ref));
    } catch (error) { console.log(error.code); process.exitCode = error.code === 'SOURCE_EXISTS' ? 2 : 1; }
  `;
  const run = source => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code, moduleUrl, directory, JSON.stringify(source)], { timeout: 10000 });
    let output = '', errors = '';
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { errors += b; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, output: output.trim(), errors }));
  });
  const left = manifest(), right = manifest();
  right.name = 'Concurrent alternative';
  const results = await Promise.all([run(left), run(right)]);
  assert.deepEqual(results.map(r => r.code).sort(), [0, 2], JSON.stringify(results));
  const ref = JSON.parse(results.find(r => r.code === 0).output);
  assert.equal((await sources.list()).length, 1);
  assert.ok(['Test source', 'Concurrent alternative'].includes((await sources.get(ref)).name));
  assert.deepEqual(await readdir(directory), ['source-test-source.json']);
});

test('corruption and missing records fail explicitly; no in-memory cache masks edits', async t => {
  const { directory, sources } = await registry(t);
  const ref = await register(sources);
  const path = join(directory, `source-${ref.id}.json`);
  const original = await readFile(path, 'utf8');
  for (const corrupt of [
    '{',
    original.replace('"formatVersion":1', '"formatVersion":2'),
    original.replace('Test source', 'Edited source'),
    ' '.repeat(MAX_SOURCE_BYTES + 1025),
  ]) {
    await writeFile(path, corrupt);
    await assert.rejects(sources.get(ref), hasCode('CORRUPT_SOURCE'));
    await assert.rejects(sources.list(), hasCode('CORRUPT_SOURCE'));
  }
  await writeFile(path, original);
  assert.deepEqual(await sources.get(ref), manifest());
  await rm(path);
  await assert.rejects(sources.get(ref), hasCode('SOURCE_NOT_FOUND'));
});

test('a valid replacement record cannot satisfy an older pinned reference', async t => {
  const { directory, sources } = await registry(t);
  const ref = await register(sources);
  const changed = manifest();
  changed.name = 'Replacement';
  const { revision } = previewSource(JSON.stringify(changed));
  await writeFile(join(directory, `source-${ref.id}.json`), JSON.stringify({ formatVersion: 1, revision, source: changed }));
  await assert.rejects(sources.get(ref), hasCode('SOURCE_CHANGED'));
});

test('unpublished staging files remain invisible, and an invalid storage path is not treated as empty', async t => {
  const { directory, sources } = await registry(t);
  await mkdir(directory);
  await writeFile(join(directory, '.interrupted.tmp'), '{');
  assert.deepEqual(await sources.list(), []);
  const ref = await register(sources);
  assert.deepEqual(await sources.get(ref), manifest());
  assert.throws(() => new SourceRegistry('relative/path'), /absolute/);
  const notDirectory = join(directory, '.interrupted.tmp');
  await assert.rejects(new SourceRegistry(notDirectory).list(), hasCode('ENOTDIR'));
});

test('record symlinks are rejected instead of reading another source', { skip: process.platform === 'win32' }, async t => {
  const { directory, sources } = await registry(t);
  const ref = await register(sources);
  const path = join(directory, `source-${ref.id}.json`);
  const bytes = await readFile(path);
  await rm(path);
  await writeFile(join(directory, 'outside.tmp'), bytes);
  await symlink('outside.tmp', path);
  await assert.rejects(sources.get(ref), hasCode('CORRUPT_SOURCE'));
});
