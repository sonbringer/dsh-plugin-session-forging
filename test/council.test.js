import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { councilDocument, councilList, documentName } from '../src/council.js';

test('shared documents preserve external edits and allow types beyond soft preferences', async () => {
  const root = await mkdtemp(join(tmpdir(), 'forging-council-'));
  const f = {
    known: new Map(['one','two'].map(id => [id, {binding:{spark:{council:{enabled:true}}}}])),
    view: async () => ({}),
    ctx: {
      workspaceRegistry: { list: () => [{ id: 'w', path: root, sessionIds: ['one', 'two'] }] },
    },
  };
  try {
    const doc = await councilDocument(f, {
      sessionId: 'one',
      name: 'other/自由笔记.md',
      action: 'write',
      text: 'one',
      revision: null,
    });
    assert.equal((await councilDocument(f, { sessionId: 'two', name: doc.name })).text, 'one');
    const { path, files } = await councilList(f, 'two');
    assert.deepEqual(files, [doc.name]);
    await writeFile(join(path, doc.name), 'external');
    await assert.rejects(
      councilDocument(f, {
        sessionId: 'one',
        name: doc.name,
        action: 'delete',
        revision: doc.revision,
      }),
      { code: 'DOCUMENT_CHANGED' }
    );
    const latest = await councilDocument(f, { sessionId: 'two', name: doc.name });
    await councilDocument(f, {
      sessionId: 'two',
      name: doc.name,
      action: 'delete',
      revision: latest.revision,
    });
    assert.deepEqual((await councilList(f, 'one')).files, []);
    await symlink(root, join(path, 'escape'));
    await assert.rejects(
      councilDocument(f, {
        sessionId: 'one',
        name: 'escape/test.md',
        action: 'write',
        text: 'no',
        revision: null,
      }),
      { code: 'INVALID_COUNCIL_PATH' }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('document names cannot escape the shared directory', () => {
  for (const name of ['../x.md', '/x.md', 'a//x.md', 'a/../../x.md', 'x.js', 'x\\y.md'])
    assert.throws(() => documentName(name));
  assert.equal(documentName('01-design/ADR 001.md'), '01-design/ADR 001.md');
});
