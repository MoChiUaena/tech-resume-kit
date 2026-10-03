import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { imageSize } from 'image-size';
import { fileHash } from '../src/storage.mjs';
import { loadResume } from '../src/index.mjs';
import { decodeBackup } from '../src/backup.mjs';
import { decodeLibraryBackup } from '../src/library-backup.mjs';
import { pdfExpectations } from './pdf-expectations.mjs';

assert.equal(process.platform, 'win32');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), exec = promisify(execFile);
const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
const archive = path.join(root, 'tmp/packages', `tech-resume-windows-x64-${version}.zip`), archiveSha256 = await fileHash(archive);
const outer = await realpath(await mkdtemp(path.join(tmpdir(), 'tech-resume-user-journey-'))), qa = path.join(root, 'tmp/pdfs/user-journey');
const program = path.join(outer, `tech-resume-windows-x64-${version}`), data = path.join(outer, '用户设置/data'), settings = path.join(outer, '用户设置/settings.json');
let child, launcherError, browser, page, url, token; const errors = [], remote = [], steps = [];
const resumeRoot = state => state.resumeId === 'legacy' ? data : path.join(data, 'resumes', state.resumeId);
const state = async () => (await fetch(url + 'api/state')).json();
async function start() {
  const system = process.env.SystemRoot || 'C:\\Windows';
  launcherError = undefined;
  child = spawn(path.join(program, '启动简历.exe'), ['--no-open', '--settings', settings], { cwd: outer, windowsHide: true, stdio: 'ignore', env: { ...process.env, PATH: path.join(system, 'System32'), PLAYWRIGHT_BROWSERS_PATH: path.join(outer, '不存在的浏览器缓存'), HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9' } });
  child.once('error', error => { launcherError = error; });
  url = token = undefined;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (launcherError) throw launcherError;
    try { const session = JSON.parse(await readFile(path.join(data, 'app-session.local.json'), 'utf8')); const html = await (await fetch(session.url)).text(); const match = /name="resume-token" content="([a-f0-9]+)"/.exec(html); if (match) { url = session.url; token = match[1]; return; } } catch {}
    if (child.exitCode !== null || child.signalCode) throw new Error('Portable user journey startup failed');
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Portable user journey startup timed out');
}
async function stop() {
  if (!url || !token) return;
  const response = await fetch(url + 'api/exit', { method: 'POST', headers: { Origin: url.slice(0, -1), 'X-Resume-Token': token, 'Content-Type': 'application/json' }, body: '{}' }); assert.equal(response.status, 200);
  if (child.exitCode === null && !child.signalCode) await new Promise((resolve, reject) => {
    const finish = error => { clearTimeout(timer); child.removeListener('exit', onExit); child.removeListener('error', onError); error ? reject(error) : resolve(); };
    const onExit = (code, signal) => finish(code === 0 ? undefined : new Error(`Portable user journey exited with ${signal || code}`));
    const onError = error => finish(error);
    const timer = setTimeout(() => finish(new Error('Portable user journey exit timed out')), 10000);
    child.once('exit', onExit); child.once('error', onError);
  });
  else assert.equal(child.exitCode, 0, 'Portable user journey exited before shutdown completed');
  url = token = undefined;
}
async function openPage() {
  page = await browser.newPage({ viewport: { width: 1500, height: 1050 } }); page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
  await page.route('**/*', route => { if (/^https?:/.test(route.request().url()) && new URL(route.request().url()).hostname !== '127.0.0.1') { remote.push(route.request().url()); return route.abort(); } return route.continue(); });
  await page.goto(url); await rendered();
}
async function rendered() {
  const current = await state(); await page.waitForFunction(revision => document.querySelector('#pdf-frame').src.includes(revision), current.revision);
  await page.frameLocator('#pdf-frame').locator('.pdf-page[data-rendered=true]').first().waitFor({ timeout: 30000 });
}
const saved = () => page.locator('#save-status').filter({ hasText: '已自动保存' }).waitFor({ timeout: 30000 });
async function capture(stem, description) { await page.locator('#toast').waitFor({ state: 'hidden', timeout: 10000 }); await page.screenshot({ path: path.join(qa, stem + '.png') }); steps.push({ screenshot: stem + '.png', description, passed: true }); }
async function download(id, filename) { const [result] = await Promise.all([page.waitForEvent('download'), page.locator(id).click()]); const file = path.join(outer, filename); await result.saveAs(file); return file; }
async function exportPdf(stem) {
  await rendered(); const current = await state(); const file = await download('#pdf-download', stem + '.pdf');
  await writeFile(path.join(qa, stem + '.pdf'), await readFile(file));
  const loaded = await loadResume(path.join(resumeRoot(current), 'resume.md'));
  const images = Object.fromEntries(Object.entries(loaded.layout.images).filter(([key, image]) => image.enabled && loaded.document.assets[key]).map(([key]) => [key, true]));
  await writeFile(path.join(qa, stem + '.expected.json'), JSON.stringify(pdfExpectations({ ...loaded, images }, 1)));
}
try {
  await mkdir(qa, { recursive: true });
  await exec(process.env.TECH_RESUME_PYTHON || 'python', ['-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert all(".." not in n.split("/") and not n.startswith("/") for n in z.namelist()); z.extractall(sys.argv[2])', archive, outer], { windowsHide: true, timeout: 120000 });
  await start(); browser = await chromium.launch({ executablePath: path.join(program, 'runtime/browsers/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe'), headless: true });
  await openPage(); assert.equal(await page.locator('#start-banner').isVisible(), true);
  await page.locator('#start-choose').click(); await page.locator('#start-content').selectOption('campus'); await capture('01-template', '首次启动选择奶龙校招起步内容');
  await page.locator('#start-submit').click(); await page.locator('#start-dialog').waitFor({ state: 'hidden' }); await rendered();
  assert.equal(await page.locator('#name').inputValue(), '奶龙');
  await page.locator('#name').fill(''); await page.locator('#preview-error:not([hidden])').waitFor({ timeout: 30000 }); await page.locator('#preview-locate').click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'name'); await capture('02-validation', '错误提示定位到姓名输入，其他字段保留');
  await page.locator('#name').fill('奶龙'); await page.locator('#target').fill('Java 后端校招（流程样例）'); await saved(); await rendered();
  await page.locator('#settings-open').click(); await page.locator('#portrait-upload').setInputFiles(path.join(program, 'toolkit/assets/images/nailong-avatar.jpg')); await page.locator('#crop-dialog[open]').waitFor();
  await capture('03-portrait', '使用独立的 23:31 证件照裁剪槽位');
  await page.locator('#crop-apply').click(); await page.locator('#crop-dialog').waitFor({ state: 'hidden' }); await saved();
  const logoResponse = page.waitForResponse(response => response.url().endsWith('/api/image/schoolLogo') && response.status() === 200);
  await page.locator('#schoolLogo-upload').setInputFiles(path.join(program, 'toolkit/assets/images/chengchuan-logo.png')); await logoResponse; await saved();
  await page.getByRole('button', { name: '关闭设置' }).click(); await rendered();
  let current = await state(); assert.notEqual(current.front.assets.portrait.src, current.front.assets.schoolLogo.src);
  const dimensions = imageSize(await readFile(path.join(resumeRoot(current), current.front.assets.portrait.src))); assert.equal(dimensions.width / dimensions.height, 23 / 31);
  await exportPdf('journey-edited'); await capture('04-editor', '填写、照片和学校 Logo 保存后，预览与下载使用同一 PDF');
  const target = current.front.person.target;
  await page.locator('#history-open').click(); await page.locator('#history-dialog[open]').waitFor(); await capture('05-backup', '导出包含文字、版式和图片的单份备份');
  const backup = await download('#backup-export', '单份备份.zip'); assert.equal(decodeBackup(await readFile(backup)).manifest.missingAssets.length, 0);
  await page.getByRole('button', { name: '关闭备份与恢复' }).click(); await page.locator('#target').fill('备份后更改的岗位'); await saved();
  await page.locator('#history-open').click(); await page.locator('#history-dialog[open]').waitFor(); await page.locator('#backup-import').setInputFiles(backup);
  await page.locator('#restore-dialog[open]').waitFor(); await page.locator('#restore-confirm').click(); await page.locator('#restore-dialog').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '关闭备份与恢复' }).click(); await rendered(); assert.equal((await state()).front.person.target, target);
  current = await state(); const sourceFile = path.join(resumeRoot(current), 'resume.md'), externalSource = current.source.replace(current.front.person.target, '外部另一个已保存岗位'); await writeFile(sourceFile, externalSource);
  await page.locator('#target').fill('页面仍未保存的申请岗位'); await page.locator('#save-status').filter({ hasText: '保存失败' }).waitFor();
  assert.match(await page.locator('#save-hint').innerText(), /草稿.*重新载入/); await capture('06-conflict', '外部修改冲突保留页面输入和处理提示');
  const draftZip = await download('#save-draft', '未保存草稿.zip'); assert.match(decodeBackup(await readFile(draftZip)).source, /页面仍未保存的申请岗位/); assert.equal(await readFile(sourceFile, 'utf8'), externalSource);
  await page.close(); await stop(); await start(); await openPage(); await page.locator('#draft-recovery:not([hidden])').waitFor(); await capture('07-recovery', '重新打开程序后提供独立草稿恢复选择');
  await page.locator('#draft-resume').click(); await page.locator('#save-status').filter({ hasText: '保存失败' }).waitFor(); assert.equal(await page.locator('#target').inputValue(), '页面仍未保存的申请岗位'); assert.equal(await readFile(sourceFile, 'utf8'), externalSource);
  await page.locator('#reload').click(); await page.waitForFunction(() => document.querySelector('#target').value === '外部另一个已保存岗位');
  await page.locator('#history-open').click(); await page.locator('#history-dialog[open]').waitFor(); await page.locator('#backup-import').setInputFiles(draftZip);
  await page.locator('#restore-dialog[open]').waitFor(); await page.locator('#restore-confirm').click(); await page.locator('#restore-dialog').waitFor({ state: 'hidden' }); await page.getByRole('button', { name: '关闭备份与恢复' }).click();
  await rendered(); assert.equal((await state()).front.person.target, '页面仍未保存的申请岗位'); await exportPdf('journey-recovered'); await capture('08-recovered', '明确从 ZIP 恢复草稿后，文字和两张独立图片仍可导出');
  await page.locator('#resume-copy').click(); await page.locator('#resume-name').fill('奶龙后端版本'); await page.locator('#resume-submit').click(); await page.locator('#resume-dialog').waitFor({ state: 'hidden' }); await rendered();
  assert.equal((await state()).resumes.length, 2);
  await page.locator('#library-open').click(); await page.locator('#library-dialog[open]').waitFor(); const libraryZip = await download('#library-export', '整库备份.zip');
  assert.equal(decodeLibraryBackup(await readFile(libraryZip)).catalog.resumes.length, 2); await page.getByRole('button', { name: '关闭简历库管理' }).click();
  await page.locator('#target').fill('整库恢复前的临时更改'); await saved(); await page.locator('#library-open').click(); await page.locator('#library-dialog[open]').waitFor(); await page.locator('#library-import').setInputFiles(libraryZip);
  await page.locator('#library-restore-dialog[open]').waitFor(); await capture('09-library', '整库恢复确认展示替换范围并保留恢复前副本');
  await page.locator('#library-restore-confirm').click(); await page.locator('#library-restore-dialog').waitFor({ state: 'hidden' }); await page.getByRole('button', { name: '关闭简历库管理' }).click(); await rendered();
  current = await state(); assert.equal(current.front.person.target, '页面仍未保存的申请岗位'); assert.equal(current.resumes.length, 2); assert.ok(current.libraryBackupBeforeRestore);
  await exportPdf('journey-library-restored'); await page.setViewportSize({ width: 390, height: 760 }); await page.locator('#person-card').scrollIntoViewIfNeeded(); await capture('10-small', '390px 小屏可访问填写与管理入口'); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.close(); await stop(); await start(); await openPage(); const final = await state(); assert.equal(final.resumeId, current.resumeId); assert.equal(final.front.person.target, current.front.person.target); assert.equal(await page.locator('#start-banner').isVisible(), false);
  assert.deepEqual(errors, []); assert.deepEqual(remote, []); await page.close(); await stop();
  await writeFile(path.join(root, 'tmp/packages/user-journey-smoke.json'), JSON.stringify({ schemaVersion: 1, version, archiveSha256, firstLaunch: true, starterChosen: true, formValidationLocated: true, portraitRatio: '23:31', independentLogo: true, pdfDownloads: 3, singleBackupRestored: true, conflictPreserved: true, draftZipRestored: true, draftSurvivedRestart: true, wholeLibraryRestored: true, restartPersistence: true, smallScreen: true, noNodeInPath: true, offlineProxy: true, noRemoteRequests: true, steps }, null, 2) + '\n');
  console.log('Windows user journey passed: first start, filling, images, PDF, conflict, restart draft recovery and single/whole backup restore.');
} finally {
  await browser?.close(); await stop().catch(() => {});
  if (child?.pid && child.exitCode === null) await exec('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
  const actual = await realpath(outer); assert.ok(actual.startsWith(path.join(await realpath(tmpdir()), 'tech-resume-user-journey-'))); await rm(actual, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
