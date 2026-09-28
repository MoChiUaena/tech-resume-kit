import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { openStorage, inventory, migrateLibrary, lockDirectory } from '../src/storage.mjs';
import { openLibrary } from '../src/library.mjs';
import { initializeProject } from '../src/files.mjs';
import { startEditor } from '../src/app.mjs';
import { kitRoot } from '../src/render.mjs';
import { pdfExpectations } from '../scripts/pdf-expectations.mjs';

async function fixture(t) {
  const outer = await mkdtemp(path.join(tmpdir(), 'tech-resume-storage-')), programDirectory = path.join(outer, '程序 旧版'), settingsFile = path.join(outer, '用户设置', 'settings.json');
  await mkdir(programDirectory);
  const cleanups = [];
  t.after(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); const actual = await realpath(outer); assert.ok(actual.startsWith(path.join(await realpath(tmpdir()), 'tech-resume-storage-'))); await rm(actual, { recursive: true, force: true, maxRetries: 3 }); });
  return { outer, programDirectory, settingsFile, cleanups };
}
async function legacyLibrary(programDirectory) {
  const directory = path.join(programDirectory, 'my-resume'); await initializeProject(directory, 'campus');
  const library = await openLibrary(directory, { historyIntervalMs: 0 });
  let state = await library.read(); state = await library.duplicate({ ...state, name: '第二份求职版' });
  state.front.person.name = '迁移验证'; state = await library.save({ resumeId: state.resumeId, revision: state.revision, front: state.front, body: state.body, layout: state.layout });
  await library.createBackup(state); await library.close(); return directory;
}
test('first managed startup copies and verifies the complete old library, including all photos and history', async t => {
  const { outer, programDirectory, settingsFile, cleanups } = await fixture(t), old = await legacyLibrary(programDirectory), before = await inventory(old);
  const storage = await openStorage({ programDirectory, settingsFile });
  assert.notEqual(storage.root, old); assert.deepEqual(await inventory(storage.root), before); assert.deepEqual(await inventory(old), before);
  const info = storage.info(); assert.equal(info.lastMigration.verified, true);
  assert.deepEqual(await inventory(path.join(info.lastMigration.backup, 'data')), before);
  const migrated = await openLibrary(storage.root, { historyIntervalMs: 0 }), state = await migrated.read();
  cleanups.push(() => migrated.close());
  assert.equal(state.resumes.length, 2); assert.equal(state.resumeName, '第二份求职版'); assert.equal(state.front.person.name, '迁移验证');
  assert.ok((await migrated.backups(state.resumeId)).some(item => item.kind === 'manual')); await migrated.close();
  const newProgram = path.join(outer, '另一个版本'); await mkdir(newProgram);
  const reopened = await openStorage({ programDirectory: newProgram, settingsFile });
  assert.equal(reopened.root, storage.root); assert.equal(reopened.info().lastMigration.backup, info.lastMigration.backup);
});
test('migration refuses occupied and nested destinations without touching the source', async t => {
  const { outer, programDirectory } = await fixture(t), old = await legacyLibrary(programDirectory), before = await inventory(old);
  const occupied = path.join(outer, '已有文件'); await mkdir(occupied); await writeFile(path.join(occupied, 'keep.txt'), '保留');
  await assert.rejects(migrateLibrary(old, occupied, path.join(outer, '副本')), /空文件夹/);
  await assert.rejects(migrateLibrary(old, path.join(old, 'nested'), path.join(outer, '副本')), /互相包含/);
  assert.equal(await readFile(path.join(occupied, 'keep.txt'), 'utf8'), '保留'); assert.deepEqual(await inventory(old), before);
  const sourceFile = path.join(old, 'resume.md'), source = await readFile(sourceFile, 'utf8');
  await writeFile(sourceFile, source.replace('assets/images/nailong-avatar.jpg', '../../outside.jpg'));
  await assert.rejects(migrateLibrary(old, path.join(outer, '新目录'), path.join(outer, '副本')), /数据目录外/);
});
test('one data directory can only be locked once, even through an alternate program', async t => {
  const { outer } = await fixture(t), directory = path.join(outer, '资料');
  const release = await lockDirectory(directory);
  try { await assert.rejects(lockDirectory(path.join(outer, '子目录', '..', '资料')), error => error.code === 'IN_USE'); }
  finally { await release(); }
  const again = await lockDirectory(directory); await again();
});
test('failed port binding releases the data lock so the same directory can restart', async t => {
  const { outer, cleanups } = await fixture(t), first = await startEditor(path.join(outer, '第一个库'), { historyIntervalMs: 0 });
  cleanups.push(() => first.close()); const secondDirectory = path.join(outer, '第二个库');
  await assert.rejects(startEditor(secondDirectory, { port: first.server.address().port, historyIntervalMs: 0 }), error => error.code === 'EADDRINUSE');
  const restarted = await startEditor(secondDirectory, { historyIntervalMs: 0 }); cleanups.push(() => restarted.close());
  assert.equal((await (await fetch(restarted.url + 'api/state')).json()).resumeId, 'legacy');
});
test('browser moves the whole library and switches existing libraries; restart and editing use the selected location', async t => {
  const { outer, programDirectory, settingsFile, cleanups } = await fixture(t); await legacyLibrary(programDirectory);
  const storage = await openStorage({ programDirectory, settingsFile }), app = await startEditor(storage.root, { storage, historyIntervalMs: 0 });
  const browser = await chromium.launch({ channel: 'chromium' });
  cleanups.push(async () => { await browser.close(); await app.close(); });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1040 } }), errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(app.url); await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
  const old = app.project.root, before = await inventory(old), original = await app.project.read();
  await page.locator('#system-open').click(); await page.locator('#system-dialog[open]').waitFor();
  assert.equal(await page.locator('#storage-path').textContent(), old);
  const target = path.join(outer, '我的新 资料'); await page.locator('#storage-target').fill(target); await page.locator('#storage-change').click();
  await page.waitForFunction(target => document.querySelector('#storage-path').textContent === target, target);
  assert.equal(app.project.root, target); assert.equal((await app.project.read()).resumeId, original.resumeId);
  assert.deepEqual(await inventory(old), before); assert.deepEqual(await inventory(target), before);
  const qa = path.join(kitRoot, 'tmp/pdfs/storage'); await mkdir(qa, { recursive: true }); await page.screenshot({ path: path.join(qa, 'data-directory.png') });
  await page.getByRole('button', { name: '关闭数据与更新' }).click();
  await page.getByLabel('姓名', { exact: true }).fill('新目录中保存'); await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
  assert.equal((await app.project.read()).front.person.name, '新目录中保存');
  const result = await app.project.preview();
  await writeFile(path.join(qa, 'migrated-campus.pdf'), result.buffer);
  await writeFile(path.join(qa, 'migrated-campus.expected.json'), JSON.stringify(pdfExpectations({ ...result, images: Object.fromEntries(result.metrics.images.map(image => [image.asset, true])) }, 1)));
  const oldLibrary = await openLibrary(old, { historyIntervalMs: 0 }); assert.equal((await oldLibrary.read()).front.person.name, '迁移验证'); await oldLibrary.close();
  const existing = path.join(outer, '已有简历库'); await initializeProject(existing, 'blank'); const other = await openLibrary(existing, { historyIntervalMs: 0 }); await other.close();
  await page.locator('#system-open').click(); await page.locator('#storage-mode').selectOption('existing'); await page.locator('#storage-target').fill(existing); await page.locator('#storage-change').click();
  await page.waitForFunction(target => document.querySelector('#storage-path').textContent === target, existing);
  assert.equal((await app.project.read()).front.person.name, '你的姓名');
  await page.getByRole('button', { name: '关闭数据与更新' }).click(); await page.reload(); await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
  assert.equal((await openStorage({ programDirectory, settingsFile })).root, existing);
  await page.locator('#system-open').click();
  const occupied = path.join(outer, '不能覆盖'); await mkdir(occupied); await writeFile(path.join(occupied, 'keep.txt'), '保留');
  await page.locator('#storage-mode').selectOption('move'); await page.locator('#storage-target').fill(occupied); await page.locator('#storage-change').click();
  await page.locator('#system-error:not([hidden])').waitFor(); assert.match(await page.locator('#system-error').textContent(), /空文件夹/);
  assert.equal(app.project.root, existing); assert.equal((await openStorage({ programDirectory, settingsFile })).root, existing);
  assert.equal(await readFile(path.join(occupied, 'keep.txt'), 'utf8'), '保留');
  const imported = path.join(outer, '迁入的旧库'); await page.locator('#storage-mode').selectOption('import');
  await page.locator('#storage-source').fill(path.join(programDirectory, 'my-resume')); await page.locator('#storage-target').fill(imported); await page.locator('#storage-change').click();
  await page.waitForFunction(target => document.querySelector('#storage-path').textContent === target, imported);
  assert.equal((await app.project.read()).front.person.name, '迁移验证'); assert.equal((await app.project.read()).resumes.length, 2);
  assert.equal((await openStorage({ programDirectory, settingsFile })).root, imported);
  assert.deepEqual(errors, []);
});
