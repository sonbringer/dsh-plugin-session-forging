/** Transient UI notices; no messages or private events are added to native history. */
export class ForkNotices {
  constructor() { this.values = new Map(); this.listeners = new Set(); this.revision = 0; this.closed = false; }
  publish(sessionId, message) {
    this.values.set(sessionId, { revision: ++this.revision, message });
    for (const listener of [...this.listeners]) listener();
  }
  close() { this.closed = true; for (const listener of [...this.listeners]) listener(); }
  read(sessionId, after, signal) {
    signal?.throwIfAborted();
    const current = () => this.values.get(sessionId) ?? { revision: 0, message: null };
    if (after === null || after > this.revision) return Promise.resolve({ revision: current().revision, message: null });
    if (current().revision > after || this.closed) return Promise.resolve(this.closed ? null : current());
    return new Promise((resolve, reject) => {
      const clean = () => { clearTimeout(timer); this.listeners.delete(changed); signal?.removeEventListener('abort', aborted); };
      const changed = () => { if (this.closed || current().revision > after) { clean(); resolve(this.closed ? null : current()); } };
      const aborted = () => { clean(); reject(signal.reason); };
      const timer = setTimeout(() => { clean(); resolve({ revision: current().revision, message: null }); }, 30000);
      this.listeners.add(changed);
      signal?.addEventListener('abort', aborted, { once: true });
      if (signal?.aborted) aborted(); else changed();
    });
  }
}
