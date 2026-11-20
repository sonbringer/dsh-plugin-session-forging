import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Records, ForgingError } from './records.js';

export const SOUL_CONTEXT = 'session-forging:soul';
const INTRO = 'Session-local soul: prefer this document to other memory for this session’s preferences and working agreements. Current user instructions and newer evidence still apply. Other context sources remain available.';
export const soulRevision = text => createHash('sha256').update(text, 'utf8').digest('hex');

export function encodeSoul(binding, text) {
  return INTRO + '\n' + JSON.stringify({ version: 2, sessionId: binding.sessionId,
    bindingRevision: binding.revision, soulRevision: soulRevision(text) }) + '\n\n' + text;
}

export function decodeSoul(text) {
  try {
    const prefix = INTRO + '\n', separator = text.indexOf('\n\n', prefix.length);
    if (!text.startsWith(prefix) || separator < 0) throw Error('Invalid soul framing.');
    const metadata = JSON.parse(text.slice(prefix.length, separator));
    const content = text.slice(separator + 2);
    if (![1, 2].includes(metadata.version) || metadata.soulRevision !== soulRevision(content)) throw Error('Invalid soul snapshot.');
    return { ...metadata, text: content };
  } catch (cause) { throw new ForgingError('INVALID_SOUL_SNAPSHOT', 'Request soul snapshot is missing or modified.', { cause }); }
}

/** Version records are derived from frozen native requests, never from a pre-read. */
export class ForgingContext {
  constructor(forging, directory) {
    this.forging = forging;
    this.directory = directory;
    this.versions = new Records(join(directory, 'souls'));
  }

  render(id) {
    const plan = this.forging.known.get(id);
    if (!plan || this.forging.closing) throw new ForgingError('NOT_FORGED', 'Session forging is unavailable.');
    return encodeSoul(plan.binding, this.forging.bindings.readSoulSync(id));
  }

  requests(id) { return new Records(join(this.directory, 'requests', soulRevision(id))); }

  async history(id) {
    const binding = await this.forging.view(id);
    if (!binding) throw new ForgingError('NOT_FORGED', 'Session has no forging binding.');
    const own = (await this.requests(id).list()).map(item => item.value);
    if (own.some(record => record.sessionId !== id || record.bindingRevision !== binding.bindingRevision)) {
      throw new ForgingError('ANCHOR_BINDING_MISMATCH', 'Captured request belongs to another binding.');
    }
    return [...(this.forging.known.get(id)?.fork?.captures ?? []), ...own];
  }

  async admit(options) {
    const id = options.sessionId, plan = this.forging.known.get(id);
    if (!plan) return;
    options.signal?.throwIfAborted();
    const latest = options.messages.findLast(message => message.source?.kind === 'runtime-context');
    const sections = latest?.source?.sections?.filter(section => section.name === SOUL_CONTEXT) ?? [];
    if (sections.length !== 1) throw new ForgingError('SOUL_NOT_ADMITTED', 'The current request must include this Session’s soul exactly once.');
    const snapshot = decodeSoul(sections[0].text);
    if (snapshot.sessionId !== id || snapshot.bindingRevision !== plan.binding.revision || (snapshot.version === 1 && snapshot.soulPath !== plan.binding.soulPath)) {
      throw new ForgingError('SOUL_BINDING_MISMATCH', 'Request soul belongs to a different fixed binding.');
    }
    const session = this.forging.ctx.sessions.get(id);
    const events = session?.snapshotEvents();
    const step = events?.findLast(event => event.type === 'step/start');
    const context = events?.findLast(event => event.type === 'user/message' && event.data.source?.kind === 'runtime-context');
    const recorded = context?.data.source.sections?.find(section => section.name === SOUL_CONTEXT);
    if (!step || recorded?.text !== sections[0].text) throw new ForgingError('SOUL_LOG_MISMATCH', 'Request soul does not match native committed context.');
    await this.forging.ctx.sessions.flush(session);
    await this.versions.put(snapshot.soulRevision, { text: snapshot.text }, { immutable: true });
    const requestSeq = events.at(-1).seq;
    const record = { sessionId: id, bindingRevision: plan.binding.revision, soulRevision: snapshot.soulRevision,
      requestSeq, stepSeq: step.seq, soulEventSeq: context.seq, turn: step.data.turn, step: step.data.step,
      model: { provider: options.provider, model: options.model, ...(options.reasoningEffort === undefined ? {} : { reasoningEffort: options.reasoningEffort }) } };
    await this.requests(id).put('request-' + requestSeq, record, { immutable: true });
    options.signal?.throwIfAborted();
  }

  async at(id, atSeq) {
    if (!Number.isSafeInteger(atSeq) || atSeq < 0) throw new ForgingError('INVALID_ANCHOR', 'Anchor must be a native event sequence.');
    const binding = await this.forging.view(id);
    if (!binding) throw new ForgingError('NOT_FORGED', 'Session has no forging binding.');
    const observed = await this.forging.observe(id);
    try {
      if (!observed?.events.some(event => event.seq === atSeq)) throw new ForgingError('INVALID_ANCHOR', 'Anchor does not exist in native history.');
    } finally { observed?.[Symbol.dispose](); }
    const records = await this.history(id);
    const record = records.filter(item => item.requestSeq <= atSeq)
      .sort((a, b) => b.requestSeq - a.requestSeq)[0];
    if (!record) throw new ForgingError('ANCHOR_NOT_FOUND', 'No admitted forging request exists at this anchor.');
    const version = await this.versions.get(record.soulRevision);
    if (!version || soulRevision(version.text) !== record.soulRevision) throw new ForgingError('SOUL_VERSION_MISSING', 'Captured soul version is missing or modified.');
    return { ...record, soul: version.text };
  }
}
