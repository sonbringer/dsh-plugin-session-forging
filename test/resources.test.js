import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { captureResources, validateResources } from '../src/resources.js';

async function setup(t) {
  const path = await mkdtemp(join(tmpdir(), 'forging-resources-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  await mkdir(join(path, 'scripts'));
  await writeFile(join(path, 'scripts/run.sh'), 'original');
  return { path, skills: [{ name: 'test', resourceBase: { kind: 'directory', path } }] };
}

test('resource dependencies detect changed, added and missing files', async t => {
  const { path, skills } = await setup(t);
  const captured = await captureResources(skills);
  await validateResources(captured);
  await writeFile(join(path, 'scripts/run.sh'), 'modified');
  await assert.rejects(validateResources(captured), { code: 'SKILL_RESOURCES_CHANGED' });
  await writeFile(join(path, 'scripts/run.sh'), 'original');
  await writeFile(join(path, 'new'), 'added');
  await assert.rejects(validateResources(captured), { code: 'SKILL_RESOURCES_CHANGED' });
  await rm(join(path, 'new'));
  await validateResources(captured);
  await rm(join(path, 'scripts/run.sh'));
  await assert.rejects(validateResources(captured), { code: 'SKILL_RESOURCES_CHANGED' });
});

test('unverifiable resources fail explicitly', async t => {
  const { path, skills } = await setup(t);
  await symlink(join(path, 'scripts'), join(path, 'link'));
  await assert.rejects(captureResources(skills), { code: 'SKILL_RESOURCES_UNAVAILABLE' });
  await assert.rejects(captureResources([{ name: 'remote', resourceBase: { kind: 'url', url: 'https://example.com' } }]), { code: 'UNSUPPORTED_SKILL_RESOURCES' });
});

test('text-only Skills need no external dependency and shared roots are deduplicated', async t => {
  const { skills } = await setup(t);
  assert.deepEqual(await captureResources([{ name: 'text', content: 'fixed' }]), []);
  assert.equal((await captureResources([...skills, ...skills])).length, 1);
});

test('repointing a resource directory link invalidates the original dependency', async t => {
  const { path } = await setup(t);
  const link = path + '-linked';
  t.after(() => rm(link, { force: true }));
  await symlink(join(path, 'scripts'), link);
  const captured = await captureResources([{ name: 'linked', resourceBase: { kind: 'directory', path: link } }]);
  await mkdir(join(path, 'replacement'));
  await writeFile(join(path, 'replacement/run.sh'), 'original');
  await rm(link);
  await symlink(join(path, 'replacement'), link);
  await assert.rejects(validateResources(captured), { code: 'SKILL_RESOURCES_CHANGED' });
});
