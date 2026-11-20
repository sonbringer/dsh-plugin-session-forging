import { constants } from 'node:fs';
import { mkdir, open, link, rename, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { contentRevision } from './source.js';

export class ForgingError extends Error {
  constructor(code, message, options) { super(message, options); this.name = 'ForgingError'; this.code = code; }
}

/** Plugin-owned records; immutable creation plans and replaceable lifecycle state. */
export class Records {
  constructor(directory) { this.directory = directory; }
  path(id) {
    if (typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id) || id.length > 128) throw new ForgingError('INVALID_RECORD_ID', 'Invalid record ID.');
    return join(this.directory, id + '.json');
  }
  async get(id) {
    let file;
    try { file = await open(this.path(id), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
    catch (cause) {
      if (cause.code === 'ENOENT') return undefined;
      throw new ForgingError('CORRUPT_RECORD', `Cannot read forging record ${id}.`, { cause });
    }
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 16 * 1024 * 1024) throw Error('Invalid record size or type.');
      const record = JSON.parse(await file.readFile('utf8'));
      if (record.version !== 1 || contentRevision(record.value) !== record.revision) throw Error('Record integrity mismatch.');
      return record.value;
    } catch (cause) { throw new ForgingError('CORRUPT_RECORD', `Invalid forging record ${id}.`, { cause }); }
    finally { await file.close(); }
  }
  async list() {
    let names;
    try { names = await readdir(this.directory); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    return Promise.all(names.filter(name => !name.startsWith('.')).sort().map(async name => {
      if (!name.endsWith('.json')) throw new ForgingError('CORRUPT_RECORD', 'Unexpected forging record.');
      const id = name.slice(0, -5), value = await this.get(id);
      if (value === undefined) throw new ForgingError('CORRUPT_RECORD', 'Forging record disappeared.');
      return { id, value };
    }));
  }
  async put(id, value, { immutable = false } = {}) {
    const destination = this.path(id), revision = contentRevision(value);
    const text = JSON.stringify({ version: 1, revision, value });
    if (Buffer.byteLength(text) > 16 * 1024 * 1024) throw new ForgingError('RECORD_TOO_LARGE', 'Forging record exceeds 16 MiB.');
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = join(this.directory, '.' + randomUUID());
    let published = false;
    try {
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(text); await file.sync(); } finally { await file.close(); }
      if (immutable) {
        try { await link(temporary, destination); }
        catch (error) {
          if (error.code !== 'EEXIST') throw error;
          const existing = await this.get(id);
          if (existing === undefined || contentRevision(existing) !== revision) throw new ForgingError('CREATION_CONFLICT', 'Creation ID already has a different configuration.');
        }
      } else await rename(temporary, destination);
      published = true;
      if (process.platform !== 'win32') {
        const directory = await open(this.directory, 'r');
        try { await directory.sync(); } finally { await directory.close(); }
      }
    } catch (cause) {
      if (published) throw new ForgingError('RECORD_WRITE_UNCERTAIN', 'Record was published but durability is unconfirmed; reopen and inspect it.', { cause });
      throw cause;
    } finally { await rm(temporary, { force: true }).catch(() => {}); }
    return value;
  }
}
