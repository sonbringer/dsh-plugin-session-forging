import { createHash } from 'node:crypto';
import { readdir, open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { ForgingError } from './records.js';
import { contentRevision } from './source.js';

/** Fixed Skill text can refer to local assets; refuse silent dependency drift. */
export async function resourceRevision(path) {
  let bytes = 0, entries = 0;
  const files = [];
  async function walk(directory, prefix = '') {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (++entries > 4096) throw Error('Skill resources exceed 4096 entries.');
      const relative = prefix + entry.name, path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw Error('Nested resource links cannot be pinned.');
      if (entry.isDirectory()) { files.push([relative + '/', null]); await walk(path, relative + '/'); continue; }
      if (!entry.isFile()) throw Error('Unsupported Skill resource type.');
      const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const stat = await file.stat();
        bytes += stat.size;
        if (!stat.isFile() || bytes > 64 * 1024 * 1024) throw Error('Skill resources exceed 64 MiB.');
        const hash = createHash('sha256');
        let read = 0;
        for await (const chunk of file.createReadStream({ autoClose: false })) {
          read += chunk.length;
          if (read > stat.size) throw Error('Skill resource changed during capture.');
          hash.update(chunk);
        }
        if (read !== stat.size) throw Error('Skill resource changed during capture.');
        files.push([relative, stat.mode & 0o111, hash.digest('hex')]);
      } finally { await file.close(); }
    }
  }
  try { await walk(path); return contentRevision(files); }
  catch (cause) { throw new ForgingError('SKILL_RESOURCES_UNAVAILABLE', `Cannot pin Skill resources: ${path}`, { cause }); }
}

export async function captureResources(skills) {
  const resources = [];
  for (const skill of skills) {
    if (!skill.resourceBase) continue;
    if (skill.resourceBase.kind !== 'directory') throw new ForgingError('UNSUPPORTED_SKILL_RESOURCES', `Skill ${skill.name} requires resources that cannot be pinned locally.`);
    const path = skill.resourceBase.path, resolved = await realpath(path);
    if (!resources.some(item => item.path === path)) resources.push({ path, resolved, revision: await resourceRevision(path) });
  }
  return resources;
}

export async function validateResources(resources) {
  for (const { path, resolved, revision } of resources) {
    if (await realpath(path) !== resolved || await resourceRevision(path) !== revision) throw new ForgingError('SKILL_RESOURCES_CHANGED', `Fixed Skill resources changed: ${path}`);
  }
}
