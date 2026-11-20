import { constants } from 'node:fs';
import { mkdir, lstat, open, readdir, rename, link, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { contentRevision } from './source.js';
import { ForgingError } from './records.js';

export const COUNCIL_TYPES = {
  prd: 'PRD',
  spec: 'Spec',
  design: 'Design Doc',
  rfc: 'RFC',
  adr: 'ADR',
  sop: 'SOP',
  runbook: 'Runbook',
  checklist: 'Checklist',
  notice: 'Notice',
  pitfalls: 'Pitfalls',
  troubleshooting: 'Troubleshooting Guide',
  reference: 'Technical Reference',
  handoff: 'Handoff',
  postmortem: 'Postmortem',
  report: 'Work Report',
};
export const MAX_DOCUMENT_BYTES = 256 * 1024;
export function documentName(name) {
  if (
    typeof name !== 'string' ||
    name.length > 240 ||
    !name ||
    name
      .split('/')
      .some(
        (part) => !part || part === '.' || part === '..' || !/^[\p{L}\p{N} _.-]+$/u.test(part)
      ) ||
    !/\.(md|txt)$/i.test(name)
  )
    throw new ForgingError(
      'INVALID_DOCUMENT',
      'Use a relative .md or .txt path without traversal.'
    );
  return name;
}
export function workspaceFor(forging, id) {
  return forging.ctx.workspaceRegistry.list().find((item) => item.sessionIds.includes(id));
}
export function councilPath(forging, id) {
  const workspace = workspaceFor(forging, id);
  return workspace ? join(workspace.path, '.session-forging', 'council') : null;
}
export function councilPrompt(forging, id) {
  const config = forging.known.get(id)?.binding.spark.council,
    path = councilPath(forging, id);
  if (!config?.enabled || !path) return '';
  return `Project council documents: ${path}. When useful, use your ordinary file tools to create, update or remove durable project documents. Prefer these types: ${config.types.map((type) => COUNCIL_TYPES[type]).join(', ') || 'none proactively'}. This is a soft preference: explicit user requests may use other document types. Read relevant existing documents first; avoid duplicate reports. This directory does not replace Team tasks and does not require broadcasts or progress reports.`;
}
async function directory(root, relative = '', create = false) {
  // The workspace itself may be a user-selected symlink; children may not redirect this surface.
  const base = dirname(dirname(root));
  let current = base;
  for (const part of ['.session-forging', 'council', ...relative.split('/').filter(Boolean)]) {
    current = join(current, part);
    if (create)
      await mkdir(current).catch((error) => {
        if (error.code !== 'EEXIST') throw error;
      });
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new ForgingError('INVALID_COUNCIL_PATH', 'Council directories must not be links.');
  }
  return current;
}
async function read(root, name) {
  await directory(root, dirname(name) === '.' ? '' : dirname(name));
  const file = await open(join(root, name), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_DOCUMENT_BYTES)
      throw new ForgingError(
        'INVALID_DOCUMENT',
        'Document must be a text file of at most 256 KiB.'
      );
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      await file.readFile()
    );
    return { name, text, revision: contentRevision(text) };
  } finally {
    await file.close();
  }
}
async function authorizedCouncilPath(forging, id) {
  if (!(await forging.view(id))) throw new ForgingError('NOT_FORGED', 'Select a forged Session.');
  if (!forging.known.get(id)?.binding.spark.council?.enabled)
    throw new ForgingError('FEATURE_UNAVAILABLE', '此会话未获授权。');
  return councilPath(forging, id);
}
export async function councilList(forging, id) {
  const root = await authorizedCouncilPath(forging, id);
  if (!root) return { path: null, files: [] };
  const files = [];
  const walk = async (relative = '', depth = 0) => {
    if (depth > 8) throw new ForgingError('COUNCIL_TOO_LARGE', 'Council nesting exceeds 8 levels.');
    const dir = await directory(root, relative);
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const name = relative ? relative + '/' + entry.name : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await walk(name, depth + 1);
      else if (entry.isFile() && /\.(md|txt)$/i.test(name)) files.push(name);
      if (files.length > 500)
        throw new ForgingError('COUNCIL_TOO_LARGE', 'Council exceeds 500 documents.');
    }
  };
  try {
    await walk();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return { path: root, files: files.sort() };
}
export async function councilDocument(forging, input) {
  const { sessionId, name, action = 'read', text, revision } = input;
  const root = await authorizedCouncilPath(forging, sessionId);
  if (!root) throw new ForgingError('WORKSPACE_NOT_FOUND', 'Council requires a native Workspace.');
  documentName(name);
  if (action === 'read') return read(root, name);
  if (
    !['write', 'delete'].includes(action) ||
    (action === 'write' &&
      (typeof text !== 'string' || Buffer.byteLength(text) > MAX_DOCUMENT_BYTES))
  )
    throw new ForgingError('INVALID_DOCUMENT', 'Invalid document operation or size.');
  let current;
  try {
    current = await read(root, name);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if ((current?.revision ?? null) !== revision)
    throw new ForgingError('DOCUMENT_CHANGED', 'Document changed; reload before saving.');
  if (action === 'delete') {
    if (current) await unlink(join(root, name));
    return null;
  }
  const parent = await directory(root, dirname(name) === '.' ? '' : dirname(name), true);
  const temporary = join(parent, '.' + randomUUID());
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(text);
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    // A new name must not overwrite an independently-created document.
    if (!current) await link(temporary, join(root, name));
    else await rename(temporary, join(root, name));
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
  return read(root, name);
}
