import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, realpath, rm, cp } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { initializeProject } from '../src/files.mjs';
import { openLibrary } from '../src/library.mjs';
import { startEditor } from '../src/app.mjs';

async function fixture(t) {
  const outer = await mkdtemp(path.join(tmpdir(), 'tech-resume-auto-drafts-')), root = path.join(outer, '资料');
  await initializeProject(root, 'campus');
  let library = await openLibrary(root, { historyIntervalMs: 0 });
  t.after(async () => { await library.close(); const actual = await realpath(outer); assert.ok(actual.startsWith(path.join(await realpath(tmpdir()), 'tech-resume-auto-drafts-'))); await rm(actual, { recursive: true, force: true, maxRetries: 3 }); });
  return { root, outer, get library() { return library; }, reopen: async () => { await library.close(); library = await openLibrary(root, { historyIntervalMs: 0 }); return library; } };
}
function snapshot(state, name = '未保存姓名', id = randomUUID(), sequence = 1) {
  const front = structuredClone(state.front); front.person.name = name;
  return { scope: state.draftScope, resumeId: state.resumeId, id, sequence, baseRevision: state.revision, payload: { baseSource: state.source, front, body: state.body, layout: state.layout } };
}
test('automatic drafts survive reopening without changing saved source, layout or history', async t => {
  const f = await fixture(t), initial = await f.library.read(), draft = snapshot(initial);
  const source = await readFile(path.join(f.root, 'resume.md')), layout = await readFile(path.join(f.root, 'layout.yaml')), history = await f.library.backups(initial.resumeId);
  await f.library.writeDraft(draft); await f.reopen();
  const recovered = await f.library.listDrafts({ scope: initial.draftScope, resumeId: initial.resumeId });
  assert.equal(recovered.drafts.length, 1); assert.equal(recovered.drafts[0].payload.front.person.name, '未保存姓名');
  assert.equal(recovered.drafts[0].baseRevision, initial.revision); assert.equal(recovered.drafts[0].conflict, false);
  assert.deepEqual(await readFile(path.join(f.root, 'resume.md')), source); assert.deepEqual(await readFile(path.join(f.root, 'layout.yaml')), layout);
  assert.deepEqual(await f.library.backups(initial.resumeId), history);
});
test('sequences isolate windows, preserve newer edits and prevent delayed resurrection after a clear', async t => {
  const f = await fixture(t), state = await f.library.read(), a = snapshot(state, '窗口 A'), b = snapshot(state, '窗口 B');
  await f.library.writeDraft(a); await f.library.writeDraft(b);
  const newer = snapshot(state, '窗口 A 新输入', a.id, 2); await f.library.writeDraft(newer);
  await f.library.writeDraft(a); await f.library.clearDraft(a);
  let items = (await f.library.listDrafts({ scope: state.draftScope, resumeId: state.resumeId })).drafts;
  assert.equal(items.find(item => item.id === a.id).payload.front.person.name, '窗口 A 新输入');
  await f.library.clearDraft(newer); await f.library.writeDraft(newer);
  items = (await f.library.listDrafts({ scope: state.draftScope, resumeId: state.resumeId })).drafts;
  assert.deepEqual(items.map(item => item.id), [b.id]);
  await f.library.writeDraft(snapshot(state, '窗口 A 继续输入', a.id, 3));
  assert.equal((await f.library.listDrafts({ scope: state.draftScope, resumeId: state.resumeId })).drafts.length, 2);
});
test('external edits and another active resume do not overwrite or hide the old resume draft', async t => {
  const f = await fixture(t), state = await f.library.read(), draft = snapshot(state);
  await f.library.writeDraft(draft);
  const external = state.source.replace(state.front.person.name, '外部正式姓名'); await writeFile(path.join(f.root, 'resume.md'), external);
  let items = (await f.library.listDrafts({ scope: state.draftScope, resumeId: state.resumeId })).drafts;
  assert.equal(items[0].conflict, true);
  await assert.rejects(f.library.save({ resumeId: state.resumeId, revision: draft.baseRevision, ...draft.payload }), /修改|载入/);
  assert.equal(await readFile(path.join(f.root, 'resume.md'), 'utf8'), external);
  const current = await f.library.read(); const second = await f.library.create({ ...current, name: '另一份', template: 'blank' });
  assert.deepEqual((await f.library.listDrafts({ scope: second.draftScope, resumeId: second.resumeId })).drafts, []);
  assert.equal((await f.library.listDrafts({ scope: state.draftScope, resumeId: state.resumeId })).drafts[0].id, draft.id);
  await assert.rejects(f.library.writeDraft({ ...draft, scope: '0'.repeat(64) }), /目录|资料|位置/);
});
test('unfinished full source is exact; invalid records are rejected and damaged files leave other drafts readable', async t => {
  const f = await fixture(t), state = await f.library.read(), draft = snapshot(state);
  draft.payload = { source: '\uFEFF---\r\nperson: [\r\n---\r\n没有写完\r\n', layout: state.layout };
  await f.library.writeDraft(draft);
  await assert.rejects(f.library.writeDraft({ ...draft, id: '../outside' }), /草稿/);
  await assert.rejects(f.library.writeDraft({ ...draft, sequence: -1 }), /草稿/);
  await assert.rejects(f.library.writeDraft({ ...draft, baseRevision: [state.revision] }), /版本|草稿/);
  await assert.rejects(f.library.writeDraft({ ...draft, payload: { ...draft.payload, source: '中'.repeat(170000) } }), /500 KB|草稿/);
  const folder = path.join(f.root, 'editor-drafts.local.d'); await writeFile(path.join(folder, `${randomUUID()}.json`), '{bad');
  const list = await f.library.listDrafts({ scope: state.draftScope, resumeId: state.resumeId });
  assert.equal(list.drafts[0].payload.source, draft.payload.source); assert.match(list.warning, /无法读取|损坏/);
  assert.equal((await readdir(folder)).length, 2);
});
test('draft API requires the session origin and token, and survives an app restart on a new port', async t => {
  const f = await fixture(t); await f.library.close(); let app = await startEditor(f.root, { historyIntervalMs: 0 });
  t.after(async () => app.close());
  const state = await (await fetch(app.url + 'api/state')).json(), draft = snapshot(state);
  const html = await (await fetch(app.url)).text(), token = /name="resume-token" content="([^"]+)"/.exec(html)[1];
  const post = (base, action, record, sessionToken = token) => fetch(base + 'api/drafts/' + action, { method: 'POST', headers: { Origin: base.slice(0, -1), 'X-Resume-Token': sessionToken, 'Content-Type': 'application/json' }, body: JSON.stringify(record) });
  assert.equal((await post(app.url, 'write', draft, 'wrong')).status, 403);
  assert.equal((await post(app.url, 'write', draft)).status, 200);
  const firstPort = app.url; await app.close(); app = await startEditor(f.root, { historyIntervalMs: 0 });
  assert.notEqual(app.url, firstPort);
  const newToken = /name="resume-token" content="([^"]+)"/.exec(await (await fetch(app.url)).text())[1];
  const list = await (await post(app.url, 'list', { scope: state.draftScope, resumeId: state.resumeId }, newToken)).json();
  assert.equal(list.drafts[0].payload.front.person.name, '未保存姓名');
});
test('directory copies retain recovery but single and whole-library ZIPs exclude editor draft sidecars', async t => {
  const f = await fixture(t), state = await f.library.read(); await f.library.writeDraft(snapshot(state));
  const { decodeLibraryBackup } = await import('../src/library-backup.mjs');
  const exported = await f.library.exportLibrary(await f.library.read());
  assert.equal(Object.keys(decodeLibraryBackup(exported.buffer).files).some(name => name.includes('editor-drafts')), false);
  const target = path.join(f.outer, '迁移资料'); await cp(f.root, target, { recursive: true });
  const moved = await openLibrary(target, { historyIntervalMs: 0 });
  try { const current = await moved.read(); assert.notEqual(current.draftScope, state.draftScope); assert.equal((await moved.listDrafts({ scope: current.draftScope, resumeId: current.resumeId })).drafts[0].payload.front.person.name, '未保存姓名'); }
  finally { await moved.close(); }
});
test('invalid timestamp types are quarantined without blocking a different draft', async t => {
  const f = await fixture(t), state = await f.library.read(), damaged = snapshot(state), good = snapshot(state, '可恢复的另一份草稿');
  await f.library.writeDraft(damaged); await f.library.writeDraft(good);
  const filename = path.join(f.root, 'editor-drafts.local.d', `${damaged.id}.json`), stored = JSON.parse(await readFile(filename, 'utf8'));
  stored.updatedAt = ['2026-10-01T00:00:00Z']; await writeFile(filename, JSON.stringify(stored));
  const list = await f.library.listDrafts({ scope: state.draftScope, resumeId: state.resumeId });
  assert.deepEqual(list.drafts.map(item => item.id), [good.id]); assert.match(list.warning, /无法读取/);
});
test('a malformed sidecar cleared flag is quarantined without deleting its snapshot', async t => {
  const f = await fixture(t), state = await f.library.read(), draft = snapshot(state);
  await f.library.writeDraft(draft); const filename = path.join(f.root, 'editor-drafts.local.d', `${draft.id}.json`), record = JSON.parse(await readFile(filename, 'utf8'));
  record.cleared = 'false'; await writeFile(filename, JSON.stringify(record));
  const list = await f.library.listDrafts({ scope: state.draftScope, resumeId: state.resumeId });
  assert.deepEqual(list.drafts, []); assert.match(list.warning, /无法读取/); assert.match(await readFile(filename, 'utf8'), /未保存姓名/);
});
test('a newly initialized resume keeps automatic editor records out of Git', async t => {
  const f = await fixture(t), state = await f.library.read(), draft = snapshot(state); await f.library.writeDraft(draft);
  execFileSync('git', ['init', '--quiet', f.root]);
  const relative = `editor-drafts.local.d/${draft.id}.json`;
  assert.equal(execFileSync('git', ['-C', f.root, 'check-ignore', '--', relative], { encoding: 'utf8' }).trim(), relative);
});
