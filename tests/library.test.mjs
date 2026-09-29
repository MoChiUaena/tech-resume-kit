import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { zipSync, unzipSync } from 'fflate';
import { stringify } from 'yaml';
import { openLibrary } from '../src/library.mjs';
import { openProject } from '../src/project.mjs';
import { initializeProject } from '../src/files.mjs';
import { kitRoot } from '../src/render.mjs';
import { decodeBackup } from '../src/backup.mjs';

async function fixture(t, template = 'blank') {
  const outer = await mkdtemp(path.join(tmpdir(), 'tech-resume-library-')), root = path.join(outer, '我的 简历');
  await initializeProject(root, template);
  const library = await openLibrary(root, { historyIntervalMs: 0 });
  t.after(async () => { await library.close(); const actual = await realpath(outer); assert.ok(actual.startsWith(path.join(await realpath(tmpdir()), 'tech-resume-library-'))); await rm(actual, { recursive: true, force: true, maxRetries: 3 }); });
  return { root, outer, library };
}

test('entry changes reject stale revisions, persist across restart and restore deletion without changing other resumes', async t => {
  const { root, library } = await fixture(t, 'campus');
  const original = await library.read();
  let copy = await library.duplicate({ ...original, name: '经历管理测试' });
  const listed = await library.entries(copy.resumeId, copy.revision);
  const education = listed.sections.find(section => section.id === 'education').entries[0];
  copy = await library.changeEntry({ ...copy, action: 'edit', sectionId: 'education', index: 0, input: { ...education, date: '2023.09 - 2027.07' } });
  await assert.rejects(library.changeEntry({ ...original, action: 'delete', sectionId: 'education', index: 0 }), error => error.code === 'CONFLICT');
  await assert.rejects(library.entries(copy.resumeId, listed.revision), error => error.code === 'CONFLICT');
  const beforeDelete = copy;
  copy = await library.changeEntry({ ...copy, action: 'delete', sectionId: 'education', index: 0 });
  assert.ok(!copy.body.includes('{#education .entries}'));
  const backup = (await library.backups(copy.resumeId)).find(item => item.kind === 'entry');
  assert.equal(backup.label, '删除经历前');
  copy = await library.restore({ ...copy, backupId: backup.id }); assert.equal(copy.source, beforeDelete.source);
  for (const key of ['portrait', 'schoolLogo']) assert.deepEqual(await readFile(path.join(root, 'resumes', copy.resumeId, copy.front.assets[key].src)), await readFile(path.join(root, original.front.assets[key].src)));
  await library.close();
  const reopened = await openLibrary(root, { historyIntervalMs: 0 });
  try {
    const persisted = await reopened.read(); assert.equal(persisted.source, beforeDelete.source);
    const old = await reopened.switchResume({ ...persisted, targetId: original.resumeId }); assert.equal(old.source, original.source);
    await assert.rejects(reopened.changeEntry({ ...copy, action: 'delete', sectionId: 'education', index: 0 }), error => error.code === 'CONFLICT');
  } finally { await reopened.close(); }
});

test('legacy files stay in place; multiple resumes persist their selected document across restart', async t => {
  const { root, library } = await fixture(t);
  const before = await readFile(path.join(root, 'resume.md'));
  let original = await library.read(); assert.equal(original.resumeId, 'legacy');
  assert.deepEqual(await readFile(path.join(root, 'resume.md')), before);
  let second = await library.create({ ...original, name: 'Java 实习', template: 'blank' });
  second.front.person.name = 'Java 示例'; second = await library.save({ resumeId: second.resumeId, revision: second.revision, layout: second.layout, front: second.front, body: second.body });
  await library.rename({ ...second, name: 'Java 校招' });
  await library.close();
  const reopened = await openLibrary(root, { historyIntervalMs: 0 });
  const current = await reopened.read(); assert.equal(current.resumeName, 'Java 校招'); assert.equal(current.front.person.name, 'Java 示例');
  const old = await reopened.switchResume({ ...current, targetId: original.resumeId }); assert.deepEqual(await readFile(path.join(root, 'resume.md')), before);
  assert.equal(old.resumes.length, 2); await reopened.close();
});

test('duplicate owns its images and a stale tab cannot overwrite an identical clone', async t => {
  const { root, library } = await fixture(t, 'campus');
  const original = await library.read();
  const clone = await library.duplicate({ ...original, name: 'AI 申请版' });
  for (const key of ['portrait','schoolLogo']) {
    const copied = path.join(root, 'resumes', clone.resumeId, clone.front.assets[key].src);
    assert.deepEqual(await readFile(copied), await readFile(path.join(root, original.front.assets[key].src)));
  }
  await assert.rejects(library.save({ ...original, source: original.source, layout: original.layout }), error => error.code === 'CONFLICT');
  clone.front.person.name = 'AI 示例'; await library.save({ resumeId: clone.resumeId, revision: clone.revision, layout: clone.layout, front: clone.front, body: clone.body });
  const active = await library.read(); const old = await library.switchResume({ ...active, targetId: original.resumeId });
  assert.equal(old.front.person.name, '奶龙');
});

test('full backup restores both image bytes and layout and preserves a version to undo the restore', async t => {
  const { root, library } = await fixture(t, 'campus');
  const initial = await library.read(), backup = await library.createBackup(initial);
  const originalPhoto = await readFile(path.join(root, initial.front.assets.portrait.src));
  await writeFile(path.join(root, initial.front.assets.portrait.src), await readFile(path.join(kitRoot, 'assets/images/synthetic-portrait.jpg')));
  initial.front.person.name = '修改后的名字'; initial.layout.bodyPt = 11;
  const edited = await library.save({ resumeId: initial.resumeId, revision: initial.revision, layout: initial.layout, front: initial.front, body: initial.body });
  const restored = await library.restore({ ...edited, backupId: backup.id });
  assert.equal(restored.front.person.name, '奶龙'); assert.equal(restored.layout.bodyPt, 10.5);
  assert.deepEqual(await readFile(path.join(root, restored.front.assets.portrait.src)), originalPhoto);
  const history = await library.backups(restored.resumeId); const undo = history.find(item => item.kind === 'restore'); assert.ok(undo);
  const undone = await library.restore({ ...restored, backupId: undo.id }); assert.equal(undone.front.person.name, '修改后的名字'); assert.equal(undone.layout.bodyPt, 11);
});

test('exported ZIP restores on a separate installation without the original source image directory', async t => {
  const { root, outer, library } = await fixture(t, 'campus');
  const state = await library.read(), backup = await library.createBackup(state), exported = await library.exportBackup(state.resumeId, backup.id);
  const otherRoot = path.join(outer, '另一台 电脑'), other = await openLibrary(otherRoot, { historyIntervalMs: 0 });
  const target = await other.read(), restored = await other.restore(target, exported.buffer);
  assert.equal(restored.front.person.name, state.front.person.name);
  assert.deepEqual(await readFile(path.join(otherRoot, restored.front.assets.schoolLogo.src)), await readFile(path.join(root, state.front.assets.schoolLogo.src)));
  await other.close();
});

test('corrupt or unsafe archives are rejected before any current content is changed', async t => {
  const { library } = await fixture(t);
  const state = await library.read(), snapshot = await library.createBackup(state), exported = await library.exportBackup(state.resumeId, snapshot.id);
  const files = unzipSync(exported.buffer);
  files['resume.md'] = Buffer.from('篡改后的内容');
  const bad = Buffer.from(zipSync(files));
  await assert.rejects(library.restore(state, bad), error => error.code === 'BACKUP');
  await assert.rejects(library.restore(state, Buffer.from(zipSync({ '../outside.txt': Buffer.from('禁止写入') }))), error => error.code === 'BACKUP');
  await assert.rejects(library.restore(state, Buffer.from('invalid ZIP')), error => error.code === 'BACKUP');
  assert.equal((await library.read()).source, state.source);
  const huge = Buffer.alloc(500001); assert.throws(() => decodeBackup(Buffer.from(zipSync({ 'resume.md': huge }))), error => error.code === 'BACKUP');
});

test('automatic history skips unchanged content; switching captures recent edits', async t => {
  const { library } = await fixture(t);
  let state = await library.read(); const initialCount = (await library.backups(state.resumeId)).length;
  state.front.person.name = '自动版本示例'; state = await library.save({ resumeId: state.resumeId, revision: state.revision, layout: state.layout, front: state.front, body: state.body });
  await library.autoCheckpoint(); assert.equal((await library.backups(state.resumeId)).length, initialCount + 1);
  await library.autoCheckpoint(); assert.equal((await library.backups(state.resumeId)).length, initialCount + 1);
  state.front.person.name = '切换前版本'; state = await library.save({ resumeId: state.resumeId, revision: state.revision, layout: state.layout, front: state.front, body: state.body });
  const id = state.resumeId; const second = await library.create({ ...state, name: '另一份', template: 'blank' });
  await library.switchResume({ ...second, targetId: id }); const history = await library.backups(id); assert.equal(history.length, initialCount + 2);
});

test('an interrupted two-file save is completed from the private journal on restart', async t => {
  const { root, library } = await fixture(t);
  const state = await library.read(), source = state.source.replace('你的姓名', '恢复保存示例');
  const layout = { ...state.layout, bodyPt: 11 };
  await writeFile(path.join(root, 'write-pending.local.json'), JSON.stringify({ version: 1, source, config: stringify(layout) }));
  await writeFile(path.join(root, 'resume.md'), source);
  const project = await openProject(root), recovered = await project.read();
  assert.match(recovered.source, /恢复保存示例/); assert.equal(recovered.layout.bodyPt, 11);
});
