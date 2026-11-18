import { createHash } from 'node:crypto';
import Ajv from 'ajv';
import schema from '../schemas/source.schema.json' with { type: 'json' };

export const MAX_SOURCE_BYTES = 256 * 1024;
const validate = new Ajv({ allErrors: true, strict: true, ownProperties: true }).compile(schema);
const idPattern = new RegExp(schema.definitions.id.pattern);

export const isSourceId = value => typeof value === 'string'
  && value.length <= schema.definitions.id.maxLength && idPattern.test(value);

export class SourceError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'SourceError';
    this.code = code;
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

export const contentRevision = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

/** Validate a JSON manifest without writing, resolving tools or rendering Persona. */
export function previewSource(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_SOURCE_BYTES) {
    throw new SourceError('INVALID_SOURCE', 'Source must be JSON text of at most 256 KiB.');
  }
  let source;
  try {
    source = JSON.parse(text);
  } catch (cause) {
    throw new SourceError('INVALID_SOURCE', 'Source is not valid JSON.', { cause });
  }
  if (!validate(source)) {
    const error = new SourceError('INVALID_SOURCE', 'Source does not match schema v1.');
    error.issues = structuredClone(validate.errors);
    throw error;
  }

  const ids = new Set();
  for (const [index, spark] of source.sparks.entries()) {
    const fail = message => { throw new SourceError('INVALID_SOURCE', `/sparks/${index}: ${message}`); };
    if (ids.has(spark.id)) fail('Spark IDs must be unique.');
    ids.add(spark.id);
    if (Boolean(spark.cog.provider) !== Boolean(spark.cog.model)) {
      fail('Set provider and model together, or leave both empty.');
    }
    for (const [, variable] of spark.persona.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
      if (!['provider', 'model'].includes(variable)) fail(`Unknown Persona variable: ${variable}`);
    }
    const { maxStepsPerTurn: limit, wrapUpSteps: wrap, finalReplySteps: reply } = spark.energon.steps;
    if (limit === null ? wrap !== 0 || reply !== 0 : reply > wrap || wrap > limit) {
      fail('Require 0 ≤ finalReplySteps ≤ wrapUpSteps ≤ maxStepsPerTurn; unlimited reserves must be 0.');
    }
    const { maxTurnDurationMs: duration, wrapUpLeadTimeMs: lead } = spark.energon;
    if (duration === null ? lead !== 0 : lead >= duration) {
      fail('wrapUpLeadTimeMs must be below maxTurnDurationMs; unlimited lead time must be 0.');
    }
  }

  const encoded = JSON.stringify(canonical(source));
  if (Buffer.byteLength(encoded, 'utf8') > MAX_SOURCE_BYTES) {
    throw new SourceError('INVALID_SOURCE', 'Normalized source exceeds 256 KiB.');
  }
  const revision = contentRevision(source);
  return { source, revision };
}
