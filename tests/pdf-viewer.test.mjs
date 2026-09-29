import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { startEditor } from '../src/app.mjs';
import { initializeProject } from '../src/files.mjs';
import { kitRoot } from '../src/render.mjs';

async function fixture(t, template = 'campus') {
  const outer = await realpath(await mkdtemp(path.join(tmpdir(), 'tech-resume-pdf-viewer-'))), directory = path.join(outer, '简历');
  await initializeProject(directory, template); const app = await startEditor(directory);
  const browser = await chromium.launch({ channel: 'chromium' }), page = await browser.newPage({ viewport: { width: 1500, height: 1050 } }), errors = [], remote = [];
  page.on('pageerror', error => errors.push(error.message));
  const consoleErrors = []; page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('request', request => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(app.url).origin) remote.push(request.url()); });
  t.after(async () => { await browser.close(); await app.close(); const actual = await realpath(outer); assert.ok(actual.startsWith(path.join(await realpath(tmpdir()), 'tech-resume-pdf-viewer-'))); await rm(actual, { recursive: true, force: true, maxRetries: 3 }); });
  await page.goto(app.url); const viewer = page.frameLocator('#pdf-frame');
  try { await viewer.locator('.pdf-page[data-page="1"][data-rendered="true"]').waitFor({ timeout: 30000 }); }
  catch (error) { throw new Error(`${error.message}\nViewer: ${await viewer.locator('body').innerText()}\nErrors: ${JSON.stringify([...errors, ...consoleErrors])}`); }
  const qa = path.join(kitRoot, 'tmp/pdfs/viewer'); await mkdir(qa, { recursive: true });
  return { app, page, viewer, errors, remote, qa };
}
test('the offline viewer paints Chinese text and the portrait, and preserves selectable text and links', async t => {
  const { app, page, viewer, errors, remote, qa } = await fixture(t);
  assert.match(await viewer.locator('.textLayer').innerText(), /奶龙/);
  const pixels = await viewer.locator('.pdf-page > canvas').evaluate(canvas => {
    const rgba = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; let dark = 0, white = 0, yellow = 0, total = 0;
    for (let i = 0; i < rgba.length; i += 16) { const [r, g, b] = rgba.slice(i, i + 3); total++; if (r > 235 && g > 235 && b > 235) white++; if (r < 120 && g < 140 && b < 160) dark++; if (r > 180 && g > 140 && b < 130) yellow++; }
    return { dark: dark / total, white: white / total, yellow: yellow / total };
  });
  assert.ok(pixels.white > 0.6); assert.ok(pixels.dark > 0.01); assert.ok(pixels.yellow > 0.001, 'Nailong must be painted instead of a blank image slot');
  assert.equal(await viewer.locator('.link-layer a').count(), 3);
  assert.match(await viewer.locator('.link-layer a[href^="mailto:"]').getAttribute('href'), /example\.com/);
  const selected = await viewer.locator('.textLayer').evaluate(layer => { const range = document.createRange(); range.selectNodeContents(layer); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); const text = selection.toString(); selection.removeAllRanges(); return text; });
  assert.match(selected, /教育背景/); assert.match(selected, /奶龙/);
  await page.waitForFunction(() => document.querySelector('#page-status').textContent === '1 页 · A4');
  assert.ok(await viewer.locator('#pages').evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'Fit width must not require horizontal scrolling');
  await page.screenshot({ path: path.join(qa, 'campus-viewer.png') });
  await page.setViewportSize({ width: 790, height: 720 });
  await viewer.locator('.pdf-page[data-rendered="true"]').waitFor(); await page.screenshot({ path: path.join(qa, 'campus-narrow.png') });
  assert.deepEqual(remote, []); assert.deepEqual(errors, []);
  assert.equal((await fetch(app.url + 'pdfjs/LICENSE')).status, 200);
  assert.equal((await fetch(app.url + 'pdfjs/package.json')).status, 404);
});
test('the viewer paints both pages, switches pages and zooms, then replaces an obsolete document after editing', async t => {
  const { page, viewer, errors, remote, qa } = await fixture(t, 'experience');
  await viewer.locator('.pdf-page[data-page="2"][data-rendered="true"]').waitFor({ timeout: 30000 });
  assert.equal(await viewer.locator('.pdf-page').count(), 2);
  await viewer.getByRole('button', { name: '下一页', exact: true }).click();
  await viewer.locator('#page-number').filter({ hasText: '2 / 2' }).waitFor();
  await page.screenshot({ path: path.join(qa, 'experience-page-2.png') });
  await viewer.getByRole('button', { name: '上一页', exact: true }).click();
  await viewer.locator('#page-number').filter({ hasText: '1 / 2' }).waitFor();
  const width = await viewer.locator('canvas').first().evaluate(canvas => canvas.width);
  await viewer.getByLabel('PDF 缩放').selectOption('1.25'); await viewer.locator('.pdf-page[data-page="2"][data-rendered="true"]').waitFor();
  assert.ok(await viewer.locator('canvas').first().evaluate(canvas => canvas.width) > width);
  await viewer.getByLabel('PDF 缩放').selectOption('fit'); await viewer.locator('.pdf-page[data-page="2"][data-rendered="true"]').waitFor();
  await page.screenshot({ path: path.join(qa, 'experience-page-1.png') });
  await page.getByLabel('姓名', { exact: true }).fill('预览更新示例');
  await viewer.locator('.textLayer').first().filter({ hasText: '预览更新示例' }).waitFor({ timeout: 30000 });
  await viewer.locator('.pdf-page[data-page="2"][data-rendered="true"]').waitFor();
  assert.deepEqual(errors, []); assert.deepEqual(remote, []);
});
test('viewer source validation and explicit errors prevent external or broken PDF requests', async t => {
  const { app, page, remote } = await fixture(t);
  await page.goto(app.url + 'pdf-viewer.html?file=' + encodeURIComponent('https://example.com/document.pdf'));
  await page.locator('#viewer-error:not([hidden])').waitFor(); assert.match(await page.locator('#error-message').innerText(), /仅支持本机/);
  assert.deepEqual(remote, []);
  await page.goto(app.url + 'pdf-viewer.html?file=' + encodeURIComponent('/document.pdf?revision=obsolete'));
  await page.locator('#viewer-error:not([hidden])').waitFor(); assert.match(await page.locator('#error-message').innerText(), /修改|刷新|载入/);
  assert.equal(await page.getByRole('button', { name: '重新显示' }).isVisible(), true);
});
