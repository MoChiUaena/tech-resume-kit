import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, realpath, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { zipSync, unzipSync } from 'fflate';
import { openLibrary } from '../src/library.mjs';
import { initializeProject } from '../src/files.mjs';
import { captureLibraryBackup, decodeLibraryBackup, restoreLibraryBackup } from '../src/library-backup.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
function repack(files) {
  delete files['library-backup.json'];
  const entries = Object.entries(files).map(([name, content]) => ({ name, size: content.length, sha256: sha(content) })).sort((a, b) => a.name.localeCompare(b.name));
  return Buffer.from(zipSync({ ...files, 'library-backup.json': Buffer.from(JSON.stringify({ schemaVersion: 1, kind: 'tech-resume-library', createdAt: new Date().toISOString(), files: entries, fingerprint: sha(JSON.stringify(entries)) })) }));
}
async function fixture(t) {
  const outer = await mkdtemp(path.join(tmpdir(), 'tech-resume-whole-library-')), root = path.join(outer, '中文 简历库');
  await initializeProject(root, 'campus'); const library = await openLibrary(root, { historyIntervalMs: 0 });
  t.after(async () => { await library.close(); const actual = await realpath(outer); assert.ok(actual.startsWith(path.join(await realpath(tmpdir()), 'tech-resume-whole-library-'))); await rm(actual, { recursive: true, force: true, maxRetries: 5 }); });
  return { outer, root, library };
}
async function populated(library) {
  const initial = await library.read(), copy = await library.duplicate({ ...initial, name: '校招副本' });
  let state = await library.trashResume(copy);
  state = await library.create({ ...state, name: '两页工作经验', template: 'experience' });
  await library.createBackup(state); return { initial, copy, state };
}

test('soft deletion retains every document, image and history; restoration handles name collisions and survives restart', async t => {
  const { root, library } = await fixture(t), initial = await library.read();
  const copy = await library.duplicate({ ...initial, name: '校招副本' }), history = await library.backups(copy.resumeId);
  const photo = await readFile(path.join(root, 'resumes', copy.resumeId, copy.front.assets.portrait.src));
  const deleted = await library.trashResume(copy); assert.equal(deleted.resumeId, initial.resumeId); assert.equal(deleted.trash.length, 1);
  assert.equal(await readFile(path.join(root, 'resumes', copy.resumeId, 'resume.md'), 'utf8'), copy.source);
  await assert.rejects(library.save(copy), error => error.code === 'CONFLICT');
  let state = await library.create({ ...deleted, name: '校招副本', template: 'blank' });
  await assert.rejects(library.restoreTrash({ ...state, targetId: copy.resumeId, name: '校招副本' }), /名称已经存在/);
  state = await library.restoreTrash({ ...state, targetId: copy.resumeId, name: '校招副本 恢复' });
  assert.equal(state.trash.length, 0); assert.equal(state.resumes.length, 3);
  state = await library.switchResume({ ...state, targetId: copy.resumeId });
  assert.equal(state.source, copy.source); assert.deepEqual(await library.backups(state.resumeId), history);
  assert.deepEqual(await readFile(path.join(root, 'resumes', copy.resumeId, state.front.assets.portrait.src)), photo);
  await library.close(); const reopened = await openLibrary(root, { historyIntervalMs: 0 });
  try { const current = await reopened.read(); assert.equal(current.resumeId, copy.resumeId); assert.equal(current.resumeName, '校招副本 恢复'); assert.equal(current.source, copy.source); } finally { await reopened.close(); }
});

test('the last active resume stays available and old library revisions cannot trash or restore data', async t => {
  const { library } = await fixture(t), initial = await library.read();
  await assert.rejects(library.trashResume(initial), /至少保留一份/);
  await assert.rejects(library.trashResume({ ...initial, libraryRevision: undefined }), error => error.code === 'CONFLICT');
  let state = await library.duplicate({ ...initial, name: '另一份' });
  const old = state; state = await library.trashResume(state);
  await assert.rejects(library.restoreTrash({ ...state, libraryRevision: old.libraryRevision, targetId: old.resumeId, name: '找回' }), error => error.code === 'CONFLICT');
  await assert.rejects(library.restoreTrash({ ...state, targetId: '../outside', name: '找回' }), error => error.code === 'CONFLICT');
  assert.equal((await library.read()).resumes.length, 1);
});

test('legacy resume deletion keeps root files and a interrupted catalogue pair is rolled back on restart', async t => {
  const { root, library } = await fixture(t), initial = await library.read();
  const second = await library.duplicate({ ...initial, name: '另一份' });
  let state = await library.switchResume({ ...second, targetId: 'legacy' });
  state = await library.trashResume(state); assert.equal(state.resumeId, second.resumeId);
  assert.equal(await readFile(path.join(root, 'resume.md'), 'utf8'), initial.source);
  const catalogue = JSON.parse(await readFile(path.join(root, 'library.json'), 'utf8')), trash = JSON.parse(await readFile(path.join(root, 'trash.json'), 'utf8'));
  await library.close();
  await writeFile(path.join(root, 'catalog-pending.local.json'), JSON.stringify({ schemaVersion: 1, catalog: catalogue, trash, hadTrash: true }));
  await writeFile(path.join(root, 'library.json'), JSON.stringify({ ...catalogue, resumes: [...catalogue.resumes, initial.resumes[0]] }));
  const restarted = await openLibrary(root, { historyIntervalMs: 0 });
  try { const current = await restarted.read(); assert.equal(current.resumes.length, 1); assert.equal(current.trash[0].id, 'legacy'); await assert.rejects(access(path.join(root, 'catalog-pending.local.json'))); } finally { await restarted.close(); }
});

test('whole ZIP restores all resumes, trash, photos, history and active choice onto another installation byte for byte', async t => {
  const { outer, root, library } = await fixture(t); const { copy, state } = await populated(library);
  const exported = await library.exportLibrary(state), decoded = decodeLibraryBackup(exported.buffer);
  const summary = await library.inspectLibrary(exported.buffer); assert.equal(summary.resumeCount, 2); assert.equal(summary.trashCount, 1); assert.equal(summary.activeName, '两页工作经验');
  const otherRoot = path.join(outer, '另一台电脑'), other = await openLibrary(otherRoot, { historyIntervalMs: 0 });
  try {
    const before = await other.read(), original = await captureLibraryBackup(otherRoot);
    let restored = await other.restoreLibrary({ ...before, sha256: summary.sha256 }, exported.buffer);
    assert.equal(restored.resumeId, state.resumeId); assert.equal(restored.resumes.length, 2); assert.equal(restored.trash[0].id, copy.resumeId);
    for (const [name, content] of Object.entries(decoded.files)) assert.deepEqual(await readFile(path.join(otherRoot, name)), content, name);
    const previous = await other.exportBeforeRestore(restored.libraryBackupBeforeRestore.backupId);
    assert.equal(decodeLibraryBackup(previous).manifest.fingerprint, original.manifest.fingerprint);
    const inspection = await other.inspectLibrary(previous); restored = await other.restoreLibrary({ ...restored, sha256: inspection.sha256 }, previous);
    assert.equal(restored.source, before.source); assert.equal(restored.resumes.length, 1); assert.equal(restored.trash.length, 0);
  } finally { await other.close(); }
  const after = await library.read(); assert.equal(after.source, state.source); assert.ok((await captureLibraryBackup(root)).manifest.files.some(file => file.name.startsWith('history/')));
});

test('unfinished Markdown drafts and damaged historical metadata are preserved as data in the whole ZIP', async t => {
  const { outer, root, library } = await fixture(t), initial = await library.read();
  let state = await library.duplicate({ ...initial, name: '未完成草稿' });
  state = await library.save({ ...state, source: '---\nperson: [\n---\n\n未完成正文' });
  const history = await library.backups(state.resumeId); await writeFile(path.join(root, 'history', state.resumeId, `${history[0].id}.json`), 'broken history metadata');
  const exported = await library.exportLibrary(state), other = await openLibrary(path.join(outer, '草稿恢复'), { historyIntervalMs: 0 });
  try { const before = await other.read(), restored = await other.restoreLibrary({ ...before, sha256: sha(exported.buffer) }, exported.buffer); assert.equal(restored.source, state.source); assert.equal(restored.front, null); assert.equal(await readFile(path.join(other.root, 'history', state.resumeId, `${history[0].id}.json`), 'utf8'), 'broken history metadata'); } finally { await other.close(); }
});

test('bad ZIP paths, excessive expanded files, hash changes and a single-resume ZIP never change the current library', async t => {
  const { root, library } = await fixture(t), state = await library.read(), snapshot = await library.exportLibrary(state), baseline = snapshot.manifest.fingerprint;
  const files = unzipSync(snapshot.buffer); files['resume.md'] = Buffer.from('篡改后的正文');
  const candidates = [Buffer.from('invalid ZIP'), Buffer.from(zipSync(files)), Buffer.from(zipSync({ '../outside.txt': Buffer.from('禁止写出') })), Buffer.from(zipSync({ 'assets/CON.png': Buffer.from('x') })), Buffer.from(zipSync({ 'resume.md': Buffer.alloc(500001) }))];
  const single = await library.createBackup(state); candidates.push((await library.exportBackup(state.resumeId, single.id)).buffer);
  const current = await library.read(), clean = await captureLibraryBackup(root);
  for (const buffer of candidates) await assert.rejects(library.restoreLibrary({ ...current, sha256: sha(buffer) }, buffer));
  await assert.rejects(library.restoreLibrary({ ...current, sha256: '0'.repeat(64) }, snapshot.buffer), /备份文件发生变化/);
  assert.equal((await captureLibraryBackup(root)).manifest.fingerprint, clean.manifest.fingerprint); assert.ok(baseline);
});

test('a failure after writes restores the original files and leaves a downloadable original archive', async t => {
  const { outer, root, library } = await fixture(t), target = await openLibrary(path.join(outer, '目标库'), { historyIntervalMs: 0 });
  await populated(library); const incoming = decodeLibraryBackup((await library.exportLibrary(await library.read())).buffer);
  try {
    const original = await captureLibraryBackup(target.root); let writes = 0;
    await assert.rejects(restoreLibraryBackup(target.root, incoming, { onWrite: () => { if (++writes === 4) throw new Error('模拟写入中断'); } }), /模拟写入中断/);
    assert.equal((await captureLibraryBackup(target.root)).manifest.fingerprint, original.manifest.fingerprint);
    await assert.rejects(access(path.join(target.root, 'library-restore-pending.local.json')));
  } finally { await target.close(); }
  assert.ok(root);
});

test('self-consistent archives still reject duplicate paths, file-directory conflicts and missing referenced images', async t => {
  const { library } = await fixture(t), state = await library.read(), exported = await library.exportLibrary(state);
  const original = unzipSync(exported.buffer), photo = original['assets/images/nailong-avatar.jpg'];
  const missing = { ...original }; delete missing['assets/images/nailong-avatar.jpg'];
  assert.throws(() => decodeLibraryBackup(repack(missing)), /图片缺失/);
  assert.throws(() => decodeLibraryBackup(repack({ ...original, 'assets/Photo.jpg': photo, 'assets/photo.jpg': photo })), /重复/);
  assert.throws(() => decodeLibraryBackup(repack({ ...original, 'assets/image.jpg': photo, 'assets/image.jpg/other.jpg': photo })), /路径冲突/);
  const catalogue = JSON.parse(Buffer.from(original['library.json']).toString('utf8')); catalogue.activeId = 'b82b3993-f076-4051-8179-cf35e3f53487';
  assert.throws(() => decodeLibraryBackup(repack({ ...original, 'library.json': Buffer.from(JSON.stringify(catalogue)) })), /列表或回收站/);
  assert.equal((await library.read()).revision, state.revision);
});

test('a process exiting halfway through whole restoration rolls back from its ZIP journal on restart', async t => {
  const { outer, root, library } = await fixture(t); await populated(library);
  const incoming = await library.exportLibrary(await library.read()), zipFile = path.join(outer, '待恢复.zip'); await writeFile(zipFile, incoming.buffer);
  const targetRoot = path.join(outer, '被中断的库'), target = await openLibrary(targetRoot, { historyIntervalMs: 0 }); await target.close();
  const original = await captureLibraryBackup(targetRoot), moduleUrl = new URL('../src/library-backup.mjs', import.meta.url).href;
  const program = `import {readFile} from 'node:fs/promises'; import {decodeLibraryBackup,restoreLibraryBackup} from ${JSON.stringify(moduleUrl)}; let writes=0; await restoreLibraryBackup(process.argv[1],decodeLibraryBackup(await readFile(process.argv[2])),{onWrite(){if(++writes===4)process.exit(23)}});`;
  await assert.rejects(promisify(execFile)(process.execPath, ['--input-type=module', '-e', program, targetRoot, zipFile], { windowsHide: true }), error => error.code === 23);
  await access(path.join(targetRoot, 'library-restore-pending.local.json'));
  const restarted = await openLibrary(targetRoot, { historyIntervalMs: 0 });
  try { assert.equal((await captureLibraryBackup(targetRoot)).manifest.fingerprint, original.manifest.fingerprint); assert.equal((await restarted.read()).resumes.length, 1); await assert.rejects(access(path.join(targetRoot, 'library-restore-pending.local.json'))); } finally { await restarted.close(); }
  assert.ok(root);
});

test('a damaged optional prior-restore record does not prevent local editing', async t => {
  const { root, library } = await fixture(t), before = await library.read(); await library.close();
  await writeFile(path.join(root, 'library-restore-state.json'), 'broken record'); const reopened = await openLibrary(root, { historyIntervalMs: 0 });
  try { const state = await reopened.read(); assert.equal(state.source, before.source); assert.ok(state.libraryBackupWarning); assert.equal(state.libraryBackupBeforeRestore, undefined); } finally { await reopened.close(); }
});
