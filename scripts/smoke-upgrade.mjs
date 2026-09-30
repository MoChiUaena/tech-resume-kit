import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { fileHash, inventory } from '../src/storage.mjs';
import { loadResume } from '../src/index.mjs';
import { pdfExpectations } from './pdf-expectations.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), exec = promisify(execFile);
assert.equal(process.platform, 'win32');
const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
const baseline = JSON.parse(await readFile(path.join(root, 'scripts/upgrade-baseline.json'), 'utf8'));
assert.match(baseline.version, /^\d+\.\d+\.\d+$/); assert.match(baseline.sha256, /^[0-9a-f]{64}$/);
assert.equal(baseline.archive, `tech-resume-windows-x64-${baseline.version}.zip`);
const oldArchive = path.join(root, 'tmp/upgrade-baselines', `v${baseline.version}`, baseline.archive);
assert.equal(await fileHash(oldArchive), baseline.sha256, 'Use the exact published baseline archive; local rebuilds are not the published download');
const newArchive = path.join(root, 'tmp/packages', `tech-resume-windows-x64-${version}.zip`);
const candidateSha256 = await fileHash(newArchive);
const outer = await realpath(await mkdtemp(path.join(tmpdir(), 'tech-resume-release-upgrade-'))), qa = path.join(root, 'tmp/pdfs/upgrade');
const settingsFile = path.join(outer, '用户设置/settings.json'), data = path.join(outer, '用户设置/data');
let child, browser, url, token;
const getState = async () => (await fetch(url + 'api/state')).json();
const post = async (endpoint, body) => {
  const response = await fetch(url + endpoint, { method: 'POST', headers: { Origin: url.slice(0, -1), 'X-Resume-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result;
};
async function start(program) {
  url = token = undefined;
  child = spawn(path.join(program, '启动简历.exe'), ['--no-open', '--settings', settingsFile], { cwd: program, windowsHide: true, stdio: 'ignore', env: { ...process.env, HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9', PLAYWRIGHT_BROWSERS_PATH: path.join(outer, 'missing-browser-cache') } });
  const sessionFile = path.join(data, 'app-session.local.json');
  for (let i = 0; i < 150; i++) {
    try {
      const session = JSON.parse(await readFile(sessionFile, 'utf8'));
      const html = await (await fetch(session.url)).text();
      const matched = /name="resume-token" content="([a-f0-9]+)"/.exec(html);
      if (matched) { url = session.url; token = matched[1]; return; }
    } catch {}
    if (child.exitCode !== null) throw new Error('Upgrade launcher exited before startup');
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Upgrade startup timed out');
}
async function stop() {
  if (!url || !token) return;
  await post('api/exit', {});
  if (child.exitCode === null) await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Upgrade shutdown timed out')), 10000); child.once('exit', code => { clearTimeout(timer); assert.equal(code, 0); resolve(); }); });
  url = token = undefined;
}
const resumeRoot = state => state.resumeId === 'legacy' ? data : path.join(data, 'resumes', state.resumeId);
async function equivalent(state, expected, imageHashes) {
  assert.equal(state.body, expected.body); assert.deepEqual(state.layout, expected.layout);
  const front = structuredClone(state.front);
  for (const [key, asset] of Object.entries(front.assets || {})) {
    assert.equal(await fileHash(path.join(resumeRoot(state), asset.src)), imageHashes[key]);
    asset.src = expected.front.assets[key].src;
  }
  assert.deepEqual(front, expected.front);
}
async function wholeBackup(state) {
  const response = await fetch(url + `library.zip?${new URLSearchParams({ resumeId: state.resumeId, revision: state.revision, libraryRevision: state.libraryRevision })}`);
  assert.equal(response.status, 200); return Buffer.from(await response.arrayBuffer());
}
async function restoreWhole(bytes) {
  const state = await getState();
  const raw = async endpoint => {
    const response = await fetch(url + endpoint, { method: 'POST', headers: { Origin: url.slice(0, -1), 'X-Resume-Token': token, 'X-Resume-Id': state.resumeId, 'X-Resume-Revision': state.revision }, body: bytes });
    const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result;
  };
  const proof = await raw('api/library/inspect');
  return raw(`api/library/restore-upload?${new URLSearchParams({ libraryRevision: state.libraryRevision, sha256: proof.sha256 })}`);
}
async function exportPdf(state, stem, pages) {
  const response = await fetch(url + `document.pdf?${new URLSearchParams({ resumeId: state.resumeId, revision: state.revision })}`);
  assert.equal(response.status, 200); await writeFile(path.join(qa, stem + '.pdf'), Buffer.from(await response.arrayBuffer()));
  const loaded = await loadResume(path.join(resumeRoot(state), 'resume.md'));
  const images = Object.fromEntries(Object.entries(loaded.layout.images).filter(([key, setting]) => setting.enabled && loaded.document.assets[key]).map(([key]) => [key, true]));
  await writeFile(path.join(qa, stem + '.expected.json'), JSON.stringify(pdfExpectations({ ...loaded, images }, pages)));
}
try {
  await mkdir(qa, { recursive: true });
  for (const archive of [oldArchive, newArchive]) await exec(process.env.TECH_RESUME_PYTHON || 'python', ['-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert all(".." not in n.split("/") and not n.startswith("/") for n in z.namelist()); z.extractall(sys.argv[2])', archive, outer], { windowsHide: true, timeout: 120000 });
  const oldProgram = path.join(outer, `tech-resume-windows-x64-${baseline.version}`), program = path.join(outer, `tech-resume-windows-x64-${version}`);
  await start(oldProgram);
  let state = await getState();
  state = await post('api/template', { ...state, template: 'campus' });
  await post('api/backup', state);
  state = await post('api/resumes/duplicate', { ...state, name: '后端实习申请' });
  state.front.person.target = 'Java 后端开发实习生';
  state = await post('api/save', { resumeId: state.resumeId, revision: state.revision, front: state.front, body: state.body, layout: state.layout });
  const manual = await post('api/backup', state), selected = state.resumeId, oldState = state;
  const images = Object.fromEntries(await Promise.all(Object.entries(state.front.assets).map(async ([key, asset]) => [key, await fileHash(path.join(resumeRoot(state), asset.src))])));
  state = await post('api/resumes/create', { ...state, name: '工作经验申请', template: 'experience' });
  await post('api/backup', state);
  state = await post('api/resumes/create', { ...state, name: '旧版已删除', template: 'blank' });
  const trashed = state.resumeId;
  state = await post('api/resumes/trash', state);
  state = await post('api/resumes/switch', { ...state, targetId: selected });
  const libraryBytes = await wholeBackup(state);
  await stop();
  const before = await inventory(data), beforeSettings = await readFile(settingsFile);
  const untouched = before.filter(file => !file.name.startsWith(`resumes/${selected}/`) && !file.name.startsWith(`history/${selected}/`) && !['library.json', 'trash.json'].includes(file.name));
  await start(program);
  const info = await (await fetch(url + 'api/app-info')).json(); assert.equal(info.version, version); assert.equal(info.storage.directory, data);
  assert.deepEqual(await inventory(data), before); assert.deepEqual(await readFile(settingsFile), beforeSettings);
  state = await getState(); assert.equal(state.resumeId, selected); assert.equal(state.resumes.length, 3); assert.equal(state.trash[0].id, trashed);
  assert.equal(state.gettingStarted.welcome, false); await equivalent(state, oldState, images);
  assert.ok((await (await fetch(url + `api/history?resumeId=${selected}`)).json()).backups.some(entry => entry.id === manual.id));
  await exportPdf(state, 'upgraded-original', 1);
  browser = await chromium.launch({ executablePath: path.join(program, 'runtime/browsers/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe'), headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1050 } }), errors = [], remote = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { if (new URL(route.request().url()).hostname !== '127.0.0.1') { remote.push(route.request().url()); return route.abort(); } return route.continue(); });
  await page.goto(url); await page.frameLocator('#pdf-frame').locator('.pdf-page[data-rendered=true]').waitFor({ timeout: 30000 });
  assert.equal(await page.locator('#start-banner').isVisible(), false);
  await page.screenshot({ path: path.join(qa, 'upgrade-existing.png') });
  await page.locator('#guide-content').click();
  await page.locator('#content-list [data-section-id=skills] [data-action=edit]').first().click();
  await page.locator('#content-text').fill('使用 Spring Boot 设计接口，维护 **事务校验** 与集成测试。');
  await page.locator('#content-submit').click(); await page.locator('#content-dialog').waitFor({ state: 'hidden' });
  await page.locator('#guide-layout').click(); await page.locator('#max-pages').selectOption('2');
  await page.locator('#order-list [data-section-id=education] [data-action=rename]').click();
  await page.locator('#section-title').fill('求学经历'); await page.locator('#section-title-submit').click();
  await page.locator('#section-title-dialog').waitFor({ state: 'hidden' });
  await page.locator('#order-list [data-section-id=education]').filter({ hasText: '求学经历' }).waitFor();
  await page.locator('#order-list [data-section-id=education] [data-action=down]').click();
  await page.waitForFunction(() => document.querySelector('#order-list .order-row')?.dataset.sectionId === 'skills');
  await page.locator('#save-status').filter({ hasText: '已自动保存' }).waitFor();
  await page.getByRole('button', { name: '关闭设置' }).click();
  await page.locator('#guide-content').click(); await page.locator('#content-lines-add').click();
  await page.locator('#content-title').fill('协作实践');
  await page.locator('#content-text').fill('在示例项目中整理接口约定、问题复现步骤和测试记录，参与代码审阅并记录方案取舍；保持文档与实现一致，便于团队复核修改。'.repeat(6));
  await page.locator('#content-submit').click(); await page.locator('#content-dialog').waitFor({ state: 'hidden' });
  state = await getState(); const edited = state;
  assert.match(state.source, /## 求学经历 \{#education \.entries\}/);
  assert.deepEqual(state.layout.sectionOrder.slice(0, 2), ['skills', 'education']);
  await page.waitForFunction(revision => document.querySelector('#pdf-frame').src.includes(revision), state.revision);
  await page.frameLocator('#pdf-frame').locator('.pdf-page[data-page="2"][data-rendered=true]').waitFor({ timeout: 30000 });
  assert.equal(state.layout.bodyPt, oldState.layout.bodyPt); assert.equal(state.layout.page.maxPages, 2);
  await exportPdf(state, 'upgraded-edited', 2); await page.screenshot({ path: path.join(qa, 'upgrade-forms.png') });
  assert.deepEqual(remote, []); assert.deepEqual(errors, []);
  await browser.close(); browser = null;
  for (const file of untouched) assert.equal(await fileHash(path.join(data, file.name)), file.sha256, file.name);
  state = await post('api/restore', { ...state, backupId: manual.id }); await equivalent(state, oldState, images);
  state = await post('api/save', { resumeId: state.resumeId, revision: state.revision, front: edited.front, body: edited.body, layout: edited.layout });
  const beforeWhole = state;
  state = await restoreWhole(libraryBytes); await equivalent(state, oldState, images);
  assert.equal(state.trash[0].id, trashed); assert.equal(state.resumes.length, 3);
  const currentBackup = await fetch(url + `library-before-restore.zip?backupId=${state.libraryBackupBeforeRestore.backupId}`);
  assert.equal(currentBackup.status, 200);
  state = await restoreWhole(Buffer.from(await currentBackup.arrayBuffer())); await equivalent(state, beforeWhole, images);
  const expected = state; await stop(); const afterEdits = await inventory(data);
  await start(oldProgram);
  const backwards = await getState(); await equivalent(backwards, expected, images);
  assert.match(backwards.source, /## 求学经历 \{#education \.entries\}/);
  assert.deepEqual(backwards.layout.sectionOrder.slice(0, 2), ['skills', 'education']);
  assert.equal(backwards.resumes.length, 3); assert.equal(backwards.trash[0].id, trashed);
  assert.equal((await (await fetch(url + 'api/preview')).json()).pageCount, 2); await stop();
  assert.deepEqual(await inventory(data), afterEdits);
  await start(program); state = await getState(); await equivalent(state, expected, images);
  assert.equal(state.resumeId, selected); assert.equal(state.gettingStarted.welcome, false); assert.equal(state.trash[0].id, trashed);
  await exportPdf(state, 'upgraded-reopened', 2); await stop();
  const report = { schemaVersion: 1, from: baseline.version, to: version, baselineArchiveSha256: baseline.sha256, candidateArchiveSha256: candidateSha256, publishedOldPackage: true, checkedFiles: before.length, untouchedFilesAfterEditing: untouched.length, sameDataDirectory: true, originalFilesVerified: true, oldVersionCanReopen: true, recycleBinSurvivesRollback: true, multipleResumes: true, resumeCount: 3, trashCount: 1, selectedResumePreserved: true, imagesAndHistoryPreserved: true, existingLibrarySkipsWelcome: true, formChangesPreserved: true, sectionOrderPersisted: true, sectionTitlePersisted: true, singleBackupRestored: true, wholeLibraryRestored: true, offlinePdfViewer: true, restartPersistence: true, pdfPages: [1, 2, 2] };
  await writeFile(path.join(root, 'tmp/packages/upgrade-smoke.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`Published v${baseline.version} → v${version}: ${before.length} original files verified; forms, images/history, single/whole backups, old-program reopening and restart passed.`);
} finally {
  await browser?.close(); await stop().catch(() => {});
  if (child?.pid && child.exitCode === null) await exec('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
  const actual = await realpath(outer); assert.ok(actual.startsWith(path.join(await realpath(tmpdir()), 'tech-resume-release-upgrade-'))); await rm(actual, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
