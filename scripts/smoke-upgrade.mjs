import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { fileHash, inventory } from '../src/storage.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), exec = promisify(execFile);
assert.equal(process.platform, 'win32');
const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
const oldArchive = path.join(root, 'tmp/packages/tech-resume-windows-x64-0.6.0.zip');
assert.equal(await fileHash(oldArchive), 'f8cb3f013475473630f55e81c39349139b4ed033849ebb23230a7a515be86987', 'Use the published v0.6.0 package');
const outer = await realpath(await mkdtemp(path.join(tmpdir(), 'tech-resume-release-upgrade-')));
let child, browser, url, token;
const post = async (endpoint, body) => {
  const response = await fetch(url + endpoint, { method: 'POST', headers: { Origin: url.slice(0, -1), 'X-Resume-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result;
};
async function start(program, args, sessionFile) {
  child = spawn(path.join(program, '启动简历.exe'), args, { cwd: program, windowsHide: true, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try {
      const session = JSON.parse(await readFile(sessionFile, 'utf8'));
      url = session.url; token = /name="resume-token" content="([a-f0-9]+)"/.exec(await (await fetch(url)).text())[1]; return;
    } catch {}
    if (child.exitCode !== null) throw new Error('Upgrade launcher exited before startup');
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Upgrade startup timed out');
}
async function stop() {
  await post('api/exit', {});
  if (child.exitCode === null) await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Upgrade shutdown timed out')), 10000); child.once('exit', code => { clearTimeout(timer); assert.equal(code, 0); resolve(); }); });
}
try {
  for (const archive of [oldArchive, path.join(root, 'tmp/packages', `tech-resume-windows-x64-${version}.zip`)]) {
    await exec(process.env.TECH_RESUME_PYTHON || 'python', ['-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert all(".." not in n.split("/") and not n.startswith("/") for n in z.namelist()); z.extractall(sys.argv[2])', archive, outer], { windowsHide: true, timeout: 120000 });
  }
  const oldProgram = path.join(outer, 'tech-resume-windows-x64-0.6.0'), oldData = path.join(oldProgram, 'my-resume');
  await start(oldProgram, ['--no-open'], path.join(oldData, 'app-session.local.json'));
  let state = await (await fetch(url + 'api/state')).json();
  state = await post('api/template', { resumeId: state.resumeId, revision: state.revision, template: 'campus' });
  state.front.person.name = '升级迁移校招样例';
  state = await post('api/save', { resumeId: state.resumeId, revision: state.revision, front: state.front, body: state.body, layout: state.layout });
  await post('api/backup', { resumeId: state.resumeId, revision: state.revision });
  state = await post('api/resumes/duplicate', { resumeId: state.resumeId, revision: state.revision, name: '后端实习申请' });
  state.front.person.name = '升级迁移实习样例';
  state = await post('api/save', { resumeId: state.resumeId, revision: state.revision, front: state.front, body: state.body, layout: state.layout });
  await post('api/backup', { resumeId: state.resumeId, revision: state.revision });
  const selected = state.resumeId; await stop();
  const before = await inventory(oldData), settingsFile = path.join(outer, '用户设置/settings.json'), data = path.join(outer, '用户设置/data'), program = path.join(outer, `tech-resume-windows-x64-${version}`);
  await start(program, ['--no-open', '--settings', settingsFile], path.join(data, 'app-session.local.json'));
  const info = await (await fetch(url + 'api/app-info')).json(); assert.equal(info.version, version); assert.equal(info.storage.directory, data);
  assert.ok(info.storage.lastMigration.verified); assert.equal(info.storage.lastMigration.fileCount, before.length);
  assert.deepEqual(await inventory(oldData), before); assert.deepEqual(await inventory(data), before); assert.deepEqual(await inventory(path.join(info.storage.lastMigration.backup, 'data')), before);
  state = await (await fetch(url + 'api/state')).json(); assert.equal(state.resumeId, selected); assert.equal(state.resumes.length, 2); assert.equal(state.front.person.name, '升级迁移实习样例');
  const history = await (await fetch(url + `api/history?resumeId=${selected}`)).json(); assert.ok(history.backups.some(entry => entry.kind === 'manual'));
  browser = await chromium.launch({ executablePath: path.join(program, 'runtime/browsers/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe'), headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 980 } }); await page.goto(url);
  await page.frameLocator('#pdf-frame').locator('.pdf-page[data-rendered="true"]').waitFor({ timeout: 30000 });
  assert.match(await page.frameLocator('#pdf-frame').locator('.textLayer').innerText(), /升级迁移实习样例/);
  const qa = path.join(root, 'tmp/pdfs/release'); await mkdir(qa, { recursive: true }); await page.screenshot({ path: path.join(qa, 'v0.6-to-v0.7.png') });
  await browser.close(); browser = null; await stop();
  await start(program, ['--no-open', '--settings', settingsFile], path.join(data, 'app-session.local.json'));
  state = await (await fetch(url + 'api/state')).json(); assert.equal(state.resumeId, selected); assert.equal(state.front.person.name, '升级迁移实习样例'); await stop();
  await writeFile(path.join(root, 'tmp/packages/upgrade-smoke.json'), JSON.stringify({ from: '0.6.0', to: version, publishedOldPackage: true, checkedFiles: before.length, originalDirectoryPreserved: true, wholeLibraryCopyVerified: true, migrationBackupVerified: true, multipleResumes: true, selectedResumePreserved: true, imagesAndHistoryPreserved: true, offlinePdfViewer: true, restartPersistence: true }, null, 2));
  console.log(`Published v0.6.0 → v${version}: ${before.length} files verified, two resumes, images/history/selection, offline preview and restart passed.`);
} finally {
  await browser?.close();
  if (url && token) await post('api/exit', {}).catch(() => {});
  if (child?.pid && child.exitCode === null) await exec('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
  const actual = await realpath(outer); assert.ok(actual.startsWith(path.join(await realpath(tmpdir()), 'tech-resume-release-upgrade-'))); await rm(actual, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
