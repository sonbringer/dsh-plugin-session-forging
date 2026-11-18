import { constants } from 'node:fs';
import { link, mkdir, open, readdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { isSourceId, MAX_SOURCE_BYTES, previewSource, SourceError } from './source.js';

export { MAX_SOURCE_BYTES, previewSource, SourceError } from './source.js';

const revisionPattern = /^[a-f0-9]{64}$/;
const validRevision = revision => typeof revision === 'string' && revision.length === 64 && revisionPattern.test(revision);

/** Immutable source registry. Use a dedicated directory, shared by all callers. */
export class SourceRegistry {
  #directory;

  constructor(directory) {
    if (typeof directory !== 'string' || !isAbsolute(directory)) {
      throw new TypeError('Source registry requires an absolute data directory.');
    }
    this.#directory = directory;
  }

  async register(text, expectedRevision) {
    const { source, revision } = previewSource(text);
    if (!validRevision(expectedRevision) || revision !== expectedRevision) {
      throw new SourceError('SOURCE_CHANGED', 'Source differs from the confirmed preview.');
    }
    const record = JSON.stringify({ formatVersion: 1, revision, source });
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    const temporary = join(this.#directory, `.${randomUUID()}.tmp`);
    const destination = join(this.#directory, `source-${source.id}.json`);
    let published = false;
    try {
      const file = await open(temporary, 'wx', 0o600);
      try {
        await file.writeFile(record, 'utf8');
        await file.sync();
      } finally {
        await file.close();
      }
      // Atomic no-replace publication also arbitrates competing processes.
      await link(temporary, destination);
      published = true;
      if (process.platform !== 'win32') {
        const directory = await open(this.#directory, 'r');
        try { await directory.sync(); } finally { await directory.close(); }
      }
    } catch (cause) {
      if (published) {
        throw new SourceError('SOURCE_WRITE_UNCERTAIN', 'Source was published, but durability could not be confirmed. Reopen and inspect it before retrying.', { cause });
      }
      if (cause.code === 'EEXIST') {
        throw new SourceError('SOURCE_EXISTS', `Source "${source.id}" already exists.`, { cause });
      }
      throw cause;
    } finally {
      // A leftover staging file is never considered a registered source.
      await rm(temporary, { force: true }).catch(() => {});
    }
    return { id: source.id, revision };
  }

  async list() {
    let entries;
    try {
      entries = await readdir(this.#directory);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    const result = [];
    for (const name of entries.filter(name => name.endsWith('.json')).sort()) {
      const id = name.slice('source-'.length, -5);
      if (!name.startsWith('source-') || !isSourceId(id)) throw new SourceError('CORRUPT_SOURCE', `Invalid source filename: ${name}`);
      const { source, revision } = await this.#load(id);
      result.push({ id, revision, name: source.name });
    }
    return result;
  }

  async get(reference) {
    const { id, revision: expectedRevision } = reference ?? {};
    if (!isSourceId(id) || !validRevision(expectedRevision)) {
      throw new SourceError('INVALID_REFERENCE', 'A source ID and SHA-256 revision are required.');
    }
    const { source, revision } = await this.#load(id);
    if (revision !== expectedRevision) {
      throw new SourceError('SOURCE_CHANGED', `Source "${id}" does not match its pinned revision.`);
    }
    return source;
  }

  async export(reference) {
    // Compact JSON stays within the same import size limit.
    return JSON.stringify(await this.get(reference));
  }

  async #load(id) {
    let file;
    try {
      file = await open(join(this.#directory, `source-${id}.json`), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    } catch (cause) {
      if (cause.code === 'ENOENT') throw new SourceError('SOURCE_NOT_FOUND', `Source "${id}" does not exist.`, { cause });
      if (cause.code === 'ELOOP') throw new SourceError('CORRUPT_SOURCE', 'Source records cannot be symbolic links.', { cause });
      throw cause;
    }
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > MAX_SOURCE_BYTES + 1024) throw new Error('Invalid record size or type.');
      const record = JSON.parse(await file.readFile('utf8'));
      if (record?.formatVersion !== 1 || Object.keys(record).sort().join(',') !== 'formatVersion,revision,source') {
        throw new Error('Unknown source record format.');
      }
      const { source, revision } = previewSource(JSON.stringify(record.source));
      if (source.id !== id || revision !== record.revision) throw new Error('Source integrity check failed.');
      return { source, revision };
    } catch (cause) {
      throw new SourceError('CORRUPT_SOURCE', `Source "${id}" is invalid or has been modified.`, { cause });
    } finally {
      await file.close();
    }
  }
}
