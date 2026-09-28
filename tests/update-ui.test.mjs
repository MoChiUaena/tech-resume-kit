import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import { chromium } from 'playwright';
import { createUpdater } from '../src/updates.mjs';
import { startEditor } from '../src/app.mjs';
import { openStorage } from '../src/storage.mjs';
import { kitRoot } from '../src/render.mjs';

test('a small browser can pause and resume updates while the dialog close button stays visible', async t => {
  const outer = await realpath(await mkdtemp(path.join(tmpdir(), 'tech-resume-update-ui-'))), settingsFile = path.join(outer, '用户设置/settings.json'), programDirectory = path.join(outer, '程序');
  const digest = bytes => createHash('sha256').update(bytes).digest('hex'), node = Buffer.from('fixture runtime'), prefix = 'tech-resume-windows-x64-0.8.0/';
  const files = { '启动简历.exe': Buffer.from('fixture, never launched'), 'runtime/node.exe': node, 'runtime/versions.json': Buffer.from(JSON.stringify({ kit: '0.8.0', nodeExeSha256: digest(node) })), 'toolkit/package.json': Buffer.from('{"version":"0.8.0"}'), 'toolkit/src/app.mjs': Buffer.from('// fixture'), 'toolkit/readme.txt': Buffer.alloc(300000, 'a') };
  const buffer = Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([name, bytes]) => [prefix + name, bytes])), { level: 0 })), cut = Math.floor(buffer.length / 2);
  const archiveName = 'tech-resume-windows-x64-0.8.0.zip';
  const metadata = { tag_name: 'v0.8.0', draft: false, prerelease: false, assets: [archiveName, 'SHA256SUMS.txt'].map(name => ({ name, size: name === archiveName ? buffer.length : 150, browser_download_url: `https://github.com/MoChiUaena/tech-resume-kit/releases/download/v0.8.0/${name}` })) };
  let requests = 0;
  const fetcher = async (url, options) => {
    if (url.endsWith('/latest')) return new Response(JSON.stringify(metadata));
    if (url.endsWith('/SHA256SUMS.txt')) return new Response(`${digest(buffer)}  ${archiveName}\n`);
    requests++;
    if (options.headers.Range) {
      assert.equal(options.headers.Range, `bytes=${cut}-`); assert.equal(options.headers['If-Range'], '"ui-v1"');
      return new Response(buffer.subarray(cut), { status: 206, headers: { 'Content-Range': `bytes ${cut}-${buffer.length - 1}/${buffer.length}`, ETag: '"ui-v1"' } });
    }
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(buffer.subarray(0, cut)); options.signal.addEventListener('abort', () => controller.error(options.signal.reason), { once: true }); }, pull() { return new Promise(() => {}); } }), { headers: { ETag: '"ui-v1"' } });
  };
  let app, browser;
  t.after(async () => { await browser?.close(); await app?.close(); const actual = await realpath(outer); assert.ok(actual.startsWith(path.join(await realpath(tmpdir()), 'tech-resume-update-ui-'))); await rm(actual, { recursive: true, force: true, maxRetries: 3 }); });
  await mkdir(programDirectory); const storage = await openStorage({ settingsFile, programDirectory });
  const updater = await createUpdater({ version: '0.7.0-dev.3', home: storage.home, programDirectory, supported: true, fetcher });
  app = await startEditor(storage.root, { storage, updater, historyIntervalMs: 0 }); browser = await chromium.launch({ channel: 'chromium' });
  const page = await browser.newPage({ viewport: { width: 640, height: 740 } }), errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(app.url); await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 }); await page.locator('#system-open').click();
  await page.locator('#update-check').click(); await page.locator('#update-prepare:not([hidden])').waitFor(); await page.locator('#update-prepare').click();
  await page.locator('#update-pause:not([hidden])').waitFor();
  for (let i = 0; i < 100 && updater.status().received !== cut; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(updater.status().received, cut); await page.locator('#update-pause').click();
  await page.waitForFunction(() => document.querySelector('#update-message').textContent.includes('下载已暂停'));
  assert.equal(await page.locator('#update-prepare').textContent(), '继续下载新版'); assert.equal(updater.status().phase, 'paused');
  const dialog = page.locator('#system-dialog'); await dialog.evaluate(element => { element.scrollTop = element.scrollHeight; });
  const box = await dialog.boundingBox(), close = await page.getByRole('button', { name: '关闭数据与更新' }).boundingBox();
  assert.ok(close.y >= box.y && close.y < box.y + 90, 'Close must stay at the top of a scrolled dialog');
  const qa = path.join(kitRoot, 'tmp/pdfs/updates'); await mkdir(qa, { recursive: true }); await page.screenshot({ path: path.join(qa, 'paused-small-window.png') });
  await page.locator('#update-prepare').click(); await page.locator('#update-activate:not([hidden])').waitFor({ timeout: 10000 });
  assert.equal(updater.status().phase, 'ready'); assert.equal(requests, 2); assert.equal(await page.locator('#update-check').isDisabled(), true);
  await page.screenshot({ path: path.join(qa, 'ready-small-window.png') });
  await page.getByRole('button', { name: '关闭数据与更新' }).click(); assert.equal(await dialog.isVisible(), false);
  await page.reload(); await page.locator('#system-open').click(); await page.locator('#update-activate:not([hidden])').waitFor();
  assert.equal(await page.locator('#update-prepare').isVisible(), false); assert.deepEqual(errors, []);
});
