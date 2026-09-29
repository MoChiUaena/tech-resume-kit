import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, realpath, rm, readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { loadResume, initializeProject } from '../src/index.mjs';
import { pdfExpectations } from './pdf-expectations.mjs';

assert.equal(process.platform, 'darwin');
const exec = promisify(execFile), root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
const name = `tech-resume-macos-app-${process.arch}-${version}`;
const proof = JSON.parse(await readFile(path.join(root, `tmp/packages/${name}.validation.json`), 'utf8'));
assert.equal(proof.bundleIntegrityVerified, true);
const outer = await realpath(await mkdtemp(path.join(tmpdir(), 'tech-resume-mac-app-')));
let child, browser, url, token;
const stop = async () => {
  if (url) await fetch(url + 'api/exit', { method: 'POST', headers: { Origin: url.slice(0, -1), 'X-Resume-Token': token, 'Content-Type': 'application/json' }, body: '{}' });
  if (child?.exitCode === null) await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Native app did not exit')), 15000);
    child.once('exit', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error('Native app exit: ' + code)); });
  });
};
try {
  await exec('/usr/bin/ditto', ['-x', '-k', path.join(root, `tmp/packages/${name}.zip`), outer]);
  const app = path.join(outer, '中文 & 技术简历.app'); await rename(path.join(outer, 'TechResumeKit.app'), app);
  const resources = path.join(app, 'Contents/Resources'), launcher = path.join(app, 'Contents/MacOS/TechResumeLauncher');
  await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  const fake = path.join(outer, 'fake-bin'); await mkdir(fake);
  for (const command of ['node', 'npm', 'npx']) await writeFile(path.join(fake, command), '#!/bin/sh\nexit 77\n', { mode: 0o755 });
  const env = { ...process.env, PATH: fake + ':/usr/bin:/bin', HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9', PLAYWRIGHT_BROWSERS_PATH: path.join(outer, 'missing-browser') };
  const settings = path.join(outer, '用户资料/settings.json'), sessionFile = path.join(outer, '用户资料/data/app-session.local.json');
  await initializeProject(path.join(outer, '用户资料/data'), 'campus');
  const checked = await exec(launcher, ['--check', '--settings', settings], { env, timeout: 40000 });
  assert.match(checked.stdout, /环境检查通过/);
  const args = ['--no-open', '--settings', settings];
  async function launch() {
    child = spawn(launcher, args, { env, stdio: 'ignore' });
    for (let i = 0; i < 150; i++) {
      try {
        const session = JSON.parse(await readFile(sessionFile, 'utf8'));
        url = session.url;
        token = /name="resume-token" content="([a-f0-9]+)"/.exec(await (await fetch(url)).text())[1];
        return session;
      } catch {}
      if (child.exitCode !== null) throw new Error('Native app stopped before startup: ' + child.exitCode);
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error('Native app startup timed out');
  }
  const session = await launch();
  assert.ok((await exec('/bin/ps', ['-ww', '-p', String(session.pid), '-o', 'command='])).stdout.includes(path.join(resources, 'runtime/bin/node')));
  const second = await exec(launcher, args, { env, timeout: 40000 }); assert.match(second.stdout, /127\.0\.0\.1/);
  assert.equal(JSON.parse(await readFile(sessionFile, 'utf8')).pid, session.pid);
  const versions = JSON.parse(await readFile(path.join(resources, 'runtime/versions.json'), 'utf8'));
  browser = await chromium.launch({ executablePath: path.join(resources, 'runtime', versions.chromiumExecutable) });
  const page = await browser.newPage({ viewport: { width: 1400, height: 980 } });
  const remote = [], errors = [];
  page.on('request', request => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(url).origin) remote.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url); const viewer = page.frameLocator('#pdf-frame');
  await viewer.locator('.pdf-page[data-rendered=true]').waitFor({ timeout: 30000 });
  await page.locator('#name').fill('奶龙应用验证');
  await viewer.locator('.textLayer').filter({ hasText: '奶龙应用验证' }).waitFor({ timeout: 30000 });
  const state = await (await fetch(url + 'api/state')).json();
  const pdf = await fetch(url + `document.pdf?revision=${state.revision}&resumeId=${state.resumeId}`); assert.equal(pdf.status, 200);
  const qa = path.join(root, 'tmp/pdfs/macos-app'); await mkdir(qa, { recursive: true });
  await writeFile(path.join(qa, 'native-app.pdf'), Buffer.from(await pdf.arrayBuffer()));
  const loaded = await loadResume(path.join(outer, '用户资料/data/resume.md'));
  const images = Object.fromEntries(Object.entries(loaded.layout.images).filter(([, value]) => value.enabled).map(([key]) => [key, true]));
  await writeFile(path.join(qa, 'native-app.expected.json'), JSON.stringify(pdfExpectations({ ...loaded, images }, 1)));
  await page.screenshot({ path: path.join(qa, `macos-${process.arch}-app.png`) });
  assert.deepEqual(remote, []); assert.deepEqual(errors, []);
  await browser.close(); browser = null; await stop();
  await launch(); assert.equal((await (await fetch(url + 'api/state')).json()).front.person.name, '奶龙应用验证'); await stop();
  await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  await writeFile(path.join(app, 'Contents/Info.plist'), Buffer.from((await readFile(path.join(app, 'Contents/Info.plist'))).toString().replace('Tech Resume Kit', 'Tampered Resume')));
  await assert.rejects(exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]));
  await writeFile(path.join(root, `tmp/packages/${name}.smoke.json`), JSON.stringify({ version, arch: process.arch, nativeApp: true, packageRuntimes: true, singleton: true, offlinePdf: true, restartPersistence: true, bundleUnchangedByEditing: true, tamperingRejected: true }, null, 2));
  console.log(`macOS ${process.arch}: native app, offline PDF, restart and resource integrity checks passed.`);
} finally {
  await browser?.close(); await stop().catch(() => {});
  if (child?.exitCode === null) child.kill('SIGTERM');
  const actual = await realpath(outer); assert.ok(actual.startsWith(path.join(await realpath(tmpdir()), 'tech-resume-mac-app-')));
  await rm(actual, { recursive: true, force: true, maxRetries: 5 });
}
