import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, realpath, readFile, readdir, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import { startEditor } from '../src/app.mjs';
import { kitRoot } from '../src/render.mjs';
import { pdfExpectations } from '../scripts/pdf-expectations.mjs';
import { writeFile } from 'node:fs/promises';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'tech-resume-editor-'));
  const app = await startEditor(path.join(root, '我的 简历'));
  t.after(async () => { await app.close(); const actual = await realpath(root); assert.ok(actual.startsWith(path.join(await realpath(tmpdir()), 'tech-resume-editor-'))); await rm(actual, { recursive: true, force: true, maxRetries: 3 }); });
  return app;
}
test('editor protects local writes and stale edits, and malformed Markdown remains recoverable', async t => {
  const app = await fixture(t), state = await (await fetch(app.url + 'api/state')).json();
  const html = await (await fetch(app.url)).text(), token = /name="resume-token" content="([a-f0-9]+)"/.exec(html)[1];
  const post = (payload, headers = {}) => fetch(app.url + 'api/save', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(payload) });
  assert.equal((await post({})).status, 403);
  assert.equal((await fetch(app.url + 'resume.md')).status, 404);
  const headers = { Origin: app.url.slice(0, -1), 'X-Resume-Token': token };
  const saved = await post({ revision: state.revision, source: '---\nperson: [\n---\n', layout: state.layout }, headers);
  assert.equal(saved.status, 200);
  const broken = await saved.json(); assert.equal(broken.front, null); assert.ok(broken.frontError);
  assert.equal((await fetch(app.url + 'document.pdf')).status, 422);
  assert.equal((await post({ revision: state.revision, source: state.source, layout: state.layout }, headers)).status, 409);
  assert.equal((await post({ revision: broken.revision, source: state.source, layout: state.layout }, headers)).status, 200);
  assert.equal((await fetch(app.url + 'document.pdf')).status, 200);
});

test('browser editor autosaves, exports actual PDFs, recovers from errors and backs up template changes', async t => {
  const app = await fixture(t), browser = await chromium.launch({ channel: 'chromium' }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1500, height: 960 } });
  const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(app.url);
  await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
  await page.getByLabel('姓名', { exact: true }).fill('通用求职者');
  await page.waitForFunction(() => document.querySelector('#save-status').textContent === '已自动保存');
  await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
  assert.match(await readFile(path.join(app.project.root, 'resume.md'), 'utf8'), /通用求职者/);
  await page.reload(); await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
  assert.equal(await page.getByLabel('姓名', { exact: true }).inputValue(), '通用求职者');
  const original = await page.locator('#body').inputValue(); await page.locator('#body').fill(original + '\n\n> 不支持的引用\n');
  await page.locator('#preview-error:not([hidden])').waitFor({ timeout: 30000 }); assert.equal(await page.locator('#pdf-frame').isVisible(), false); assert.equal(await page.locator('#pdf-download').isDisabled(), true);
  await page.locator('#body').fill(original); await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
  await page.locator('#template').selectOption('campus'); await page.getByRole('button', { name: '备份并切换' }).click();
  await page.waitForFunction(() => document.querySelector('#name').value === '奶龙');
  await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
  assert.equal((await readdir(path.join(app.project.root, 'backups'))).length, 1);
  await page.getByRole('button', { name: '版式与图片' }).click();
  await page.locator('#portrait-upload').setInputFiles(path.join(kitRoot, 'assets/images/nailong-avatar.jpg'));
  await page.waitForFunction(() => document.querySelector('#save-status').textContent === '已自动保存');
  await page.getByRole('button', { name: '关闭设置' }).click();
  await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
  const result = await app.project.preview(); assert.equal(result.metrics.images.length, 2); assert.equal(result.metrics.pageCount, 1);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '下载 PDF', exact: true }).click()]);
  assert.match(download.suggestedFilename(), /奶龙.*\.pdf$/);
  const directory = path.join(kitRoot, 'tmp/pdfs/editor'); await mkdir(directory, { recursive: true });
  const target = path.join(directory, 'editor-campus.pdf'); await download.saveAs(target);
  assert.equal((await PDFDocument.load(await readFile(target))).getPageCount(), 1);
  await writeFile(path.join(directory, 'editor-campus.expected.json'), JSON.stringify(pdfExpectations({ ...result, images: Object.fromEntries(result.metrics.images.map(image => [image.asset, true])) }, 1)));
  await page.waitForTimeout(1400); await page.screenshot({ path: path.join(directory, 'editor-screen.png') });
  assert.deepEqual(pageErrors, []);
});
