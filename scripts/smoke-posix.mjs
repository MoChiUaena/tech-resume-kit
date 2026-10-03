import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath, rename, readlink, access } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { initializeProject } from '../src/files.mjs';
import { openLibrary } from '../src/library.mjs';
import { inventory } from '../src/storage.mjs';
import { pdfExpectations } from './pdf-expectations.mjs';
import { waitForCanvasPreview } from './pdf-preview-check.mjs';

assert.ok(['darwin', 'linux'].includes(process.platform));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), exec = promisify(execFile);
const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
const platform = process.platform === 'darwin' ? 'macos' : 'linux', arch = process.arch, extension = platform === 'macos' ? 'command' : 'sh';
const name = `tech-resume-${platform}-${arch}-${version}`, archive = path.join(root, 'tmp/packages', name + '.tar.gz');
const outer = await realpath(await mkdtemp(path.join(tmpdir(), 'tech-resume-posix-smoke-')));
let child, browser, url, token;
async function waitSession(sessionFile) {
  for (let i = 0; i < 100; i++) {
    try { const session = JSON.parse(await readFile(sessionFile, 'utf8')); url = session.url; token = /name="resume-token" content="([a-f0-9]+)"/.exec(await (await fetch(url)).text())[1]; return session; } catch {}
    if (child.exitCode !== null) throw new Error('Portable startup failed');
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Portable startup timed out');
}
const post = async (endpoint, payload) => {
  const response = await fetch(url + endpoint, { method: 'POST', headers: { Origin: url.slice(0, -1), 'X-Resume-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const state = await response.json(); assert.equal(response.status, 200, JSON.stringify(state)); return state;
};
async function stop() {
  await post('api/exit', {});
  if (child.exitCode === null) await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Shutdown timed out')), 10000); child.once('exit', code => { clearTimeout(timer); assert.equal(code, 0); resolve(); }); });
}
try {
  await exec(process.env.TECH_RESUME_PYTHON || 'python', ['-c', 'import sys,tarfile; t=tarfile.open(sys.argv[1]); assert all(m.name.split("/")[0]==sys.argv[3] and ".." not in m.name.split("/") for m in t.getmembers()); t.extractall(sys.argv[2],filter="data")', archive, outer, name], { timeout: 120000 });
  const program = path.join(outer, '中文 & 启动包'); assert.equal(path.dirname(program), outer);
  await rename(path.join(outer, name), program);
  const launcher = path.join(program, `启动简历.${extension}`), settingsFile = path.join(outer, '用户设置/settings.json'), data = path.join(outer, '用户设置/data'), sessionFile = path.join(data, 'app-session.local.json');
  const runtime = JSON.parse(await readFile(path.join(program, 'runtime/versions.json'), 'utf8'));
  assert.equal(runtime.platform, process.platform); assert.equal(runtime.arch, arch);
  const fake = path.join(outer, 'fake-bin'); await mkdir(fake);
  for (const command of ['node', 'npm', 'npx']) await writeFile(path.join(fake, command), '#!/bin/sh\nexit 77\n', { mode: 0o755 });
  const env = { ...process.env, PATH: fake + ':/usr/bin:/bin', PLAYWRIGHT_BROWSERS_PATH: path.join(outer, 'missing-cache'), HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9' };
  const check = await exec(launcher, ['--check', '--settings', settingsFile], { cwd: outer, env, timeout: 30000 }); assert.match(check.stdout, /环境检查通过/); await assert.rejects(access(settingsFile));
  const legacy = path.join(program, 'my-resume'); await initializeProject(legacy, 'campus');
  const library = await openLibrary(legacy, { historyIntervalMs: 0 });
  const initial = await library.read(), copy = await library.duplicate({ ...initial, name: '可找回样例' });
  let fixture = await library.trashResume(copy); fixture = await library.create({ ...fixture, name: '另一份简历', template: 'blank' });
  await library.switchResume({ ...fixture, targetId: initial.resumeId }); await library.close(); const before = await inventory(legacy);
  const args = ['--no-open', '--settings', settingsFile];
  child = spawn(launcher, args, { cwd: outer, env, stdio: 'ignore' }); const session = await waitSession(sessionFile);
  assert.deepEqual(await inventory(legacy), before); assert.deepEqual(await inventory(data), before);
  if (process.platform === 'linux') assert.equal(await readlink(`/proc/${session.pid}/exe`), path.join(program, 'runtime/bin/node'));
  else assert.ok((await exec('/bin/ps', ['-ww', '-p', String(session.pid), '-o', 'command='])).stdout.includes(path.join(program, 'runtime/bin/node')));
  const second = await exec(launcher, args, { cwd: outer, env, timeout: 30000 }); assert.match(second.stdout, /http:\/\/127\.0\.0\.1:/); assert.equal(JSON.parse(await readFile(sessionFile, 'utf8')).pid, session.pid);
  const info = await (await fetch(url + 'api/app-info')).json(); assert.equal(info.version, version); assert.equal(info.directoryPicker, false); assert.equal(info.openDirectory, true); assert.equal(info.updates.supported, false);
  let state = await (await fetch(url + 'api/state')).json(); assert.equal(state.resumes.length, 2); assert.equal(state.trash.length, 1);
  browser = await chromium.launch({ executablePath: path.join(program, 'runtime', runtime.chromiumExecutable), headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 980 } }), remote = [], errors = [];
  page.on('request', request => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(url).origin) remote.push(request.url()); }); page.on('pageerror', error => errors.push(error.message));
  await page.goto(url); const viewer = page.frameLocator('#pdf-frame'); await waitForCanvasPreview(page);
  assert.match(await viewer.locator('.textLayer').innerText(), /奶龙/);
  await page.locator('#system-open').click(); await page.locator('#system-dialog[open]').waitFor(); assert.equal(await page.locator('#storage-browse').isVisible(), false); assert.equal(await page.locator('#storage-open').isVisible(), true); await page.getByRole('button', { name: '关闭数据与更新' }).click();
  await page.locator('#entry-manager-summary').click(); await page.locator('[data-section-id=education] [data-action=edit]').click(); await page.locator('#entry-date').fill('2023.09 - 2027.07（预计）'); await page.locator('#entry-submit').click(); await page.locator('#entry-dialog').waitFor({ state: 'hidden' });
  await waitForCanvasPreview(page, '2027.07');
  state = await (await fetch(url + 'api/state')).json(); const pdf = await fetch(url + `document.pdf?revision=${state.revision}&resumeId=${state.resumeId}`); assert.equal(pdf.status, 200);
  const qa = path.join(root, 'tmp/pdfs/portable'); await mkdir(qa, { recursive: true });
  await writeFile(path.join(qa, 'portable-campus.pdf'), Buffer.from(await pdf.arrayBuffer()));
  const { parseResume } = await import('../src/input.mjs'); const { resolveSectionOrder } = await import('../src/schema.mjs');
  const document = parseResume(state.source).document; const layout = { ...state.layout, sectionOrder: resolveSectionOrder(document, state.layout) };
  await writeFile(path.join(qa, 'portable-campus.expected.json'), JSON.stringify(pdfExpectations({ document, layout, images: { portrait: true, schoolLogo: true } }, 1)));
  await page.screenshot({ path: path.join(qa, `${platform}-${arch}-editor.png`) });
  await page.locator('#library-open').click(); const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#library-export').click()]);
  const backupFile = path.join(outer, '整库.zip'); await download.saveAs(backupFile); await page.locator('#library-import').setInputFiles(backupFile); await page.locator('#library-restore-dialog[open]').waitFor(); await page.locator('#library-restore-confirm').click(); await page.locator('#library-restore-dialog').waitFor({ state: 'hidden' });
  assert.equal((await (await fetch(url + 'api/state')).json()).trash.length, 1);
  await page.getByRole('button', { name: '关闭简历库管理' }).click(); assert.deepEqual(remote, []); assert.deepEqual(errors, []);
  await browser.close(); browser = null; await stop();
  child = spawn(launcher, args, { cwd: outer, env, stdio: 'ignore' }); await waitSession(sessionFile);
  const restarted = await (await fetch(url + 'api/state')).json(); assert.equal(restarted.resumeId, initial.resumeId); assert.match(restarted.body, /2027.07/); assert.equal(restarted.resumes.length, 2); assert.equal(restarted.trash.length, 1); await stop();
  await writeFile(path.join(root, `tmp/packages/${platform}-${arch}-smoke.json`), JSON.stringify({ version, platform, arch, bundledNode: true, globalNodeUnused: true, independentBrowserCache: true, offlineProxy: true, environmentCheck: true, singleton: true, legacyCopyVerified: true, checkedLegacyFiles: before.length, multipleResumes: true, recycleBin: true, entryEditing: true, wholeLibraryRestore: true, portraitAndLogo: true, onePagePdf: true, offlineCanvasPreview: true, restartPersistence: true, cleanExit: true }, null, 2));
  console.log(`${platform}/${arch}: native launch, package runtimes, offline PDF, complete library migration, entry editing, ZIP restore and restart passed.`);
} finally {
  await browser?.close(); if (url && token) await post('api/exit', {}).catch(() => {});
  if (child?.pid && child.exitCode === null) child.kill('SIGTERM');
  const actual = await realpath(outer); assert.ok(actual.startsWith(path.join(await realpath(tmpdir()), 'tech-resume-posix-smoke-'))); await rm(actual, { recursive: true, force: true, maxRetries: 5 });
}
