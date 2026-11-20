import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, symlink, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Records } from '../src/records.js';

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'forging-records-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return new Records(directory);
}

test('immutable creation has one winner under competing writers', async t => {
  const records = await setup(t);
  const results = await Promise.allSettled(Array.from({ length: 16 }, (_, model) => records.put('one', { model }, { immutable: true })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  for (const result of results.filter(result => result.status === 'rejected')) assert.equal(result.reason.code, 'CREATION_CONFLICT');
  const value = await new Records(records.directory).get('one');
  await records.put('one', value, { immutable: true });
  assert.deepEqual(await readdir(records.directory), ['one.json']);
});

test('state replacement is complete and recoverable by another instance', async t => {
  const records = await setup(t);
  await records.put('state', { ready: true, suspended: false });
  await records.put('state', { ready: true, suspended: true });
  assert.deepEqual(await new Records(records.directory).get('state'), { ready: true, suspended: true });
});

test('modified records cannot be silently reused as creation inputs', async t => {
  const records = await setup(t);
  await records.put('one', { model: 'original' });
  const file = records.path('one');
  await writeFile(file, (await readFile(file, 'utf8')).replace('original', 'modified'));
  await assert.rejects(records.get('one'), { code: 'CORRUPT_RECORD' });
  await assert.rejects(records.put('one', { model: 'modified' }, { immutable: true }), { code: 'CORRUPT_RECORD' });
});

test('record reads reject links and unsafe identities', async t => {
  const records = await setup(t);
  await records.put('one', { ready: false });
  await symlink(records.path('one'), records.path('linked'));
  await assert.rejects(records.get('linked'), { code: 'CORRUPT_RECORD' });
  for (const id of ['../one', '', 'one\n', 1, null]) assert.throws(() => records.path(id), { code: 'INVALID_RECORD_ID' });
});

test('recovery ignores unpublished files and rejects unexpected records', async t => {
  const records = await setup(t);
  assert.deepEqual(await records.list(), []);
  await records.put('one', { ready: false });
  await writeFile(join(records.directory, '.pending'), 'incomplete');
  assert.deepEqual(await records.list(), [{ id: 'one', value: { ready: false } }]);
  await writeFile(join(records.directory, 'unrecognized'), 'broken');
  await assert.rejects(records.list(), { code: 'CORRUPT_RECORD' });
});
