#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { forkRequest } from './src/forks.js';

const usage = 'session-forging fork --url <DSH Web URL> --session <id> --at <eventSeq> --request-id <id>\nAuthentication: DSH_FORGING_TOKEN (the native Web launch token).';
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    url: { type: 'string' }, session: { type: 'string' }, at: { type: 'string' }, 'request-id': { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) console.log(usage);
  else {
    if (positionals.length !== 1 || positionals[0] !== 'fork' || !values.url || !/^\d+$/.test(values.at ?? '')) throw Error(usage);
    const input = forkRequest({ requestId: values['request-id'], sessionId: values.session, atSeq: Number(values.at) });
    const base = new URL(values.url);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw Error('Use the DSH Web origin URL without credentials or query parameters.');
    const token = process.env.DSH_FORGING_TOKEN;
    if (!token) throw Error('DSH_FORGING_TOKEN is required.');
    const control = new AbortController(), abort = () => control.abort(Error('Interrupted; retry with the same request-id to inspect the outcome.'));
    process.once('SIGINT', abort); process.once('SIGTERM', abort);
    const signal = AbortSignal.any([control.signal, AbortSignal.timeout(60000)]);
    try {
      // Native browser Cookie exchange uses the shared owner Peer, without a second Host or long-lived API Peer.
      const entry = new URL(base); entry.searchParams.set('token', token);
      const auth = await fetch(entry, { redirect: 'manual', signal });
      const cookie = auth.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ');
      if (auth.status !== 303 || !cookie) throw Error('Native DSH authentication failed (HTTP ' + auth.status + ').');
      const rpcId = randomUUID();
      const response = await fetch(new URL('api/sessionForging/fork', base), { method: 'POST', signal,
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ type: 'client-request', rpcId, method: 'sessionForging/fork', payload: { args: { input } } }),
      });
      if (!response.ok) throw Error('Native Gateway returned HTTP ' + response.status + '.');
      const envelope = await response.json();
      if (envelope.type !== 'server-response' || envelope.rpcId !== rpcId) throw Error('Invalid Gateway response.');
      if (!envelope.result?.ok) throw Error(envelope.result?.error?.message ?? 'Fork failed.');
      if (typeof envelope.result.value?.sessionId !== 'string') throw Error('Gateway did not return a Session identity.');
      console.log(JSON.stringify(envelope.result.value));
    } finally { process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort); }
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
