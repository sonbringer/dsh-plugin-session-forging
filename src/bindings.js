import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, rename, rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';
import { contentRevision, MAX_SOURCE_BYTES, previewSource } from './source.js';
import schema from '../schemas/source.schema.json' with { type: 'json' };

const soulLimit = schema.definitions.spark.properties.soul.maxLength;
const digest = text => createHash('sha256').update(text).digest('hex');

export class BindingError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'BindingError';
    this.code = code;
  }
}

async function readLimited(path, maxBytes) {
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new Error('Invalid file size or type.');
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.readFile());
  } finally { await file.close(); }
}

async function writeSynced(path, text) {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(text, 'utf8'); await file.sync(); } finally { await file.close(); }
}

async function syncDirectory(path) {
  if (process.platform === 'win32') return;
  const directory = await open(path, 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

/** Prepares sidecar files; native Session creation and ownership remain Host responsibilities. */
export class SessionBindings {
  #directory;
  #sources;

  constructor(directory, sources) {
    if (typeof directory !== 'string' || !isAbsolute(directory) || typeof sources?.get !== 'function') {
      throw new TypeError('SessionBindings requires an absolute directory and a source registry.');
    }
    this.#directory = directory;
    this.#sources = sources;
  }

  #path(sessionId) {
    if (typeof sessionId !== 'string' || !sessionId.trim() || !sessionId.isWellFormed() || sessionId.length > 256 || /[\u0000-\u001f]/.test(sessionId)) {
      throw new BindingError('INVALID_SESSION_ID', 'Session ID must be valid Unicode text of at most 256 characters without control characters.');
    }
    return join(this.#directory, `session-${digest(sessionId)}`);
  }

  async #checkDirectory(directory) {
    try {
      if (!(await lstat(directory)).isDirectory()) throw new BindingError('CORRUPT_BINDING', 'Binding path must be a directory, not a link or file.');
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }

  async #validate(snapshot) {
    if (Object.keys(snapshot).sort().join(',') !== 'sessionId,source,spark'
      || Object.keys(snapshot.source ?? {}).sort().join(',') !== 'id,revision') {
      throw new BindingError('INVALID_BINDING', 'Binding must contain a Session ID, source reference and Spark.');
    }
    this.#path(snapshot.sessionId);
    const source = await this.#sources.get(snapshot.source);
    if (!source.sparks.some(spark => spark.id === snapshot.spark?.id)) {
      throw new BindingError('SPARK_NOT_FOUND', 'Spark does not belong to the pinned source.');
    }
    previewSource(JSON.stringify({ ...source, sparks: [snapshot.spark] }));
    if (!snapshot.spark.soul.isWellFormed()) {
      throw new BindingError('INVALID_SOUL', 'Soul must be valid Unicode so its file preserves the exact text.');
    }
  }

  async prepare(input) {
    const { sessionId, source, sparkId, spark: override } = structuredClone(input);
    const destination = this.#path(sessionId);
    const origin = await this.#sources.get(source);
    const original = origin.sparks.find(spark => spark.id === sparkId);
    if (!original || (override !== undefined && override?.id !== sparkId)) {
      throw new BindingError('SPARK_NOT_FOUND', 'Select a Spark from the pinned source before applying edits.');
    }
    const snapshot = { sessionId, source: { id: source.id, revision: source.revision }, spark: override ?? original };
    await this.#validate(snapshot);
    const revision = contentRevision(snapshot);
    const existing = async () => {
      const binding = await this.get(sessionId);
      if (binding.revision !== revision) throw new BindingError('BINDING_EXISTS', 'Session already has a different fixed configuration.');
      return binding;
    };
    if (await this.#checkDirectory(destination)) return existing();

    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    const staging = await mkdtemp(join(this.#directory, '.preparing-'));
    let published = false;
    try {
      await writeSynced(join(staging, 'binding.json'), JSON.stringify({ formatVersion: 1, revision, snapshot }));
      await writeSynced(join(staging, 'soul.md'), snapshot.spark.soul);
      await syncDirectory(staging);
      try {
        // Registered directories are nonempty: rename cannot replace a competing binding.
        await rename(staging, destination);
      } catch (error) {
        if (['EEXIST', 'ENOTEMPTY'].includes(error.code)) return await existing();
        throw error;
      }
      published = true;
      await syncDirectory(this.#directory);
    } catch (cause) {
      if (published) throw new BindingError('BINDING_WRITE_UNCERTAIN', 'Binding was published, but durability could not be confirmed. Reopen and inspect it.', { cause });
      throw cause;
    } finally {
      await rm(staging, { recursive: true, force: true }).catch(() => {});
    }
    return this.get(sessionId);
  }

  async get(sessionId) {
    const directory = this.#path(sessionId);
    if (!await this.#checkDirectory(directory)) throw new BindingError('BINDING_NOT_FOUND', 'Session has no prepared binding.');
    let record;
    try {
      record = JSON.parse(await readLimited(join(directory, 'binding.json'), MAX_SOURCE_BYTES + 4096));
      if (record?.formatVersion !== 1 || Object.keys(record).sort().join(',') !== 'formatVersion,revision,snapshot'
        || record.snapshot?.sessionId !== sessionId || contentRevision(record.snapshot) !== record.revision) {
        throw new Error('Binding integrity check failed.');
      }
    } catch (cause) {
      throw new BindingError('CORRUPT_BINDING', 'Binding is incomplete, invalid or modified.', { cause });
    }
    await this.#validate(record.snapshot);
    const { spark } = record.snapshot;
    return {
      ...record.snapshot, revision: record.revision,
      creation: { persona: spark.persona, soul: spark.soul },
      soulPath: join(directory, 'soul.md'),
    };
  }

  async readSoul(sessionId) {
    const { soulPath } = await this.get(sessionId);
    try {
      const text = await readLimited(soulPath, soulLimit * 4);
      if ([...text].length > soulLimit) throw new Error('Soul exceeds its character limit.');
      return text;
    } catch (cause) {
      throw new BindingError('SOUL_UNAVAILABLE', 'Soul is missing, unreadable or invalid; no cached text was used.', { cause });
    }
  }
}
