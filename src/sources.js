import { Records } from './records.js';
import { constants } from 'node:fs';
import { link, mkdir, open, readdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { contentRevision, isSourceId, isNativeExample, isNativeExampleId, nativeExampleId, readOnlyExampleError, MAX_SOURCE_BYTES, previewSource, SourceError } from './source.js';

export { MAX_SOURCE_BYTES, previewSource, SourceError } from './source.js';

const revisionPattern = /^[a-f0-9]{64}$/;
const validRevision = revision => typeof revision === 'string' && revision.length === 64 && revisionPattern.test(revision);

/** Immutable source registry. Use a dedicated directory, shared by all callers. */
export class SourceRegistry {
  #directory;
  #additions;

  constructor(directory) {
    if (typeof directory !== 'string' || !isAbsolute(directory)) {
      throw new TypeError('Source registry requires an absolute data directory.');
    }
    this.#directory = directory;
    this.#additions = new Records(join(directory, 'spark-additions'));
  }

  async register(text, expectedRevision) {
    const { source, revision } = previewSource(text);
    if (!validRevision(expectedRevision) || revision !== expectedRevision) {
      throw new SourceError('SOURCE_CHANGED', 'Source differs from the confirmed preview.');
    }
    if (isNativeExampleId(source.id) && source.id !== nativeExampleId(source)) throw readOnlyExampleError();
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
      const { source, revision } = await this.latestById(id);
      result.push({ id, revision, name: source.name });
    }
    return result;
  }

  async get(reference) {
    const { id, revision: expectedRevision } = reference ?? {};
    if (!isSourceId(id) || !validRevision(expectedRevision)) {
      throw new SourceError('INVALID_REFERENCE', 'A source ID and SHA-256 revision are required.');
    }
    const pinned = (await this.history(await this.#load(id), expectedRevision)).current;
    if (pinned.revision !== expectedRevision)
      throw new SourceError('SOURCE_CHANGED', `Source "${id}" does not match its pinned revision.`);
    return pinned.source;
  }

  // Old packages appended Sparks under the parent content hash. Keep those revisions
  // readable. New edits have numbered successors so restoring old content cannot form a cycle.
  async history(origin, stopAt) {
    let current = origin;
    while (current.revision !== stopAt) {
      const addition = await this.#additions.get(current.revision);
      if (!addition) break;
      current = previewSource(JSON.stringify({ ...current.source, sparks: [...current.source.sparks, addition.spark] }));
      if (addition.revision !== current.revision)
        throw new SourceError('CORRUPT_SOURCE', 'Saved Spark revision does not match its contents.');
    }
    const versions = new Records(join(this.#directory, 'spark-versions', origin.source.id));
    let number = 1;
    while (current.revision !== stopAt) {
      const entry = await versions.get(String(number));
      if (!entry) break;
      if (entry.parent !== current.revision || entry.source.id !== origin.source.id)
        throw new SourceError('CORRUPT_SOURCE', 'Invalid Spark version chain.');
      current = previewSource(JSON.stringify(entry.source));
      number++;
    }
    return { current, versions, number };
  }

  async latestById(id) {
    if (!isSourceId(id)) throw new SourceError('INVALID_REFERENCE', 'A valid source ID is required.');
    return (await this.history(await this.#load(id))).current;
  }

  async latest(preview) {
    try { return await this.latestById(preview.source.id); }
    catch (error) { if (error.code !== 'SOURCE_NOT_FOUND') throw error; return preview; }
  }

  async appendSpark(reference, spark) {
    return this.changeSpark(reference, spark.id, spark, true);
  }

  async changeSpark(reference, sparkId, spark, append = false) {
    const pinned = await this.get(reference);
    if (isNativeExample(pinned)) throw readOnlyExampleError();
    if (!append && !this.canEditSpark(pinned, sparkId))
      throw new SourceError('READ_ONLY_SPARK', '请先另存为自己的火种再修改。');
    const origin = await this.#load(reference.id);
    for (;;) {
      const { current, versions, number } = await this.history(origin);
      const existing = current.source.sparks.find(item => item.id === sparkId);
      if (spark && spark.id !== sparkId) throw new SourceError('INVALID_SPARK', '火种 ID 不匹配。');
      if (spark && existing && contentRevision(existing) === contentRevision(spark)) return current;
      if (!append && !spark && !existing) return current;
      if (append && existing) throw new SourceError('SPARK_EXISTS', '该火种 ID 已用于其他配置。');
      if (!append) {
        const previous = pinned.sparks.find(item => item.id === sparkId);
        if (!existing || !previous || contentRevision(previous) !== contentRevision(existing))
          throw new SourceError('SOURCE_CHANGED', '火种已更改，请刷新后再编辑。');
        if (!spark && current.source.sparks.length === 1)
          throw new SourceError('LAST_SPARK', '火种源至少需要保留一个火种。');
      }
      const sparks = append ? [...current.source.sparks, spark] : current.source.sparks.flatMap(item =>
        item.id !== sparkId ? [item] : spark ? [spark] : []);
      const next = previewSource(JSON.stringify({ ...current.source, sparks }));
      try {
        await versions.put(String(number), { parent: current.revision, source: next.source }, { immutable: true });
        return next;
      } catch (error) { if (error.code !== 'CREATION_CONFLICT') throw error; }
    }
  }

  canEditSpark(source, sparkId) {
    return !isNativeExample(source) && (!['agency-agents', 'awesome-copilot'].includes(source.id) || sparkId.startsWith('copy-'));
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
