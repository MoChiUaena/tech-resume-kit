import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { initializeProject } from '../src/files.mjs';
import { startEditor } from '../src/app.mjs';
import { decodeBackup } from '../src/backup.mjs';
import { parseResume } from '../src/input.mjs';
import { inventory } from '../src/storage.mjs';
import { kitRoot } from '../src/render.mjs';

async function fixture(t) {
  const outer = await mkdtemp(path.join(tmpdir(), 'tech-resume-draft-ui-')), directory = path.join(outer, '当前资料');
  await initializeProject(directory, 'campus');
  const source = await readFile(path.join(directory, 'resume.md'), 'utf8');
  await writeFile(path.join(directory, 'resume.md'), '\uFEFF' + source.replace('schemaVersion: 0.2.0', 'schemaVersion: 0.2.0 # 页面填写说明').replace(/\n/g, '\r\n'));
  const app = await startEditor(directory, { historyIntervalMs: 0 }), browser = await chromium.launch({ channel: 'chromium' });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1050 } }), errors = [], external = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url()) && new URL(request.url()).hostname !== '127.0.0.1') external.push(request.url()); });
  t.after(async () => {
    await browser.close(); await app.close(); const actual = await realpath(outer);
    assert.ok(actual.startsWith(path.join(await realpath(tmpdir()), 'tech-resume-draft-ui-')));
    await rm(actual, { recursive: true, force: true, maxRetries: 3 });
  });
  await page.goto(app.url); await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
  return { outer, directory, app, browser, page, errors, external, original: await app.project.read() };
}

test('a conflicting page downloads a restorable draft without saving or overwriting the external file', async t => {
  const { outer, directory, app, browser, page, errors, external, original } = await fixture(t);
  const sourceFile = path.join(directory, 'resume.md'), externalSource = original.source.replace(original.front.person.name, '外部已保存姓名');
  await writeFile(sourceFile, externalSource);
  let saves = 0; page.on('request', request => { if (request.url().endsWith('/api/save')) saves++; });
  await page.getByLabel('姓名', { exact: true }).fill('页面未保存草稿');
  await page.locator('#settings-open').click(); await page.locator('#max-pages').selectOption('2'); await page.locator('#margin').selectOption('16');
  await page.getByRole('button', { name: '关闭设置' }).click();
  await page.locator('#body').fill(original.body + '\r\n未保存的项目复盘说明。\r\n');
  await page.locator('#save-status').filter({ hasText: '保存失败' }).waitFor();
  await page.locator('#save-retry:not([disabled])').waitFor();
  assert.equal(await page.locator('#save-draft').count(), 1);
  const qa = path.join(kitRoot, 'tmp/ui/draft-backup'); await mkdir(qa, { recursive: true });
  await page.screenshot({ path: path.join(qa, 'desktop-draft.png') });
  await page.setViewportSize({ width: 390, height: 760 }); await page.locator('#save-error').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(qa, 'small-draft.png') });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const bounds = await page.locator('#save-draft').boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
  const before = await inventory(directory), saveCount = saves;
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#save-draft').click()]);
  assert.match(download.suggestedFilename(), /未保存草稿\.zip$/);
  const archive = path.join(outer, '草稿.zip'); await download.saveAs(archive);
  const decoded = decodeBackup(await readFile(archive)), model = parseResume(decoded.source).document;
  assert.equal(model.person.name, '页面未保存草稿'); assert.match(decoded.source, /未保存的项目复盘说明/);
  assert.match(decoded.source, /# 页面填写说明/); assert.ok(decoded.source.startsWith('\uFEFF---\r\n'));
  assert.equal(decoded.layout.page.maxPages, 2); assert.equal(decoded.layout.page.marginMm, 16);
  for (const asset of Object.values(model.assets)) assert.deepEqual(decoded.files[asset.src], await readFile(path.join(directory, asset.src)));
  assert.equal(saves, saveCount); assert.deepEqual(await inventory(directory), before);
  assert.equal((await app.project.read()).source, externalSource); assert.equal(await page.locator('#save-error').isVisible(), true);
  const other = await startEditor(path.join(outer, '另一个安装目录'), { historyIntervalMs: 0 });
  try {
    const targetPage = await browser.newPage(); await targetPage.goto(other.url); await targetPage.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
    await targetPage.locator('#history-open').click(); await targetPage.locator('#history-dialog[open]').waitFor(); await targetPage.locator('#backup-import').setInputFiles(archive);
    await targetPage.locator('#restore-dialog[open]').waitFor(); await targetPage.locator('#restore-confirm').click();
    await targetPage.waitForFunction(() => document.querySelector('#name').value === '页面未保存草稿');
    await targetPage.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
    const restored = await other.project.read(); assert.equal(restored.layout.page.marginMm, 16); assert.match(restored.body, /未保存的项目复盘说明/);
    assert.ok(restored.source.includes('# 页面填写说明')); assert.ok(restored.source.startsWith('\uFEFF---\r\n'));
    const preview = await other.project.preview(); assert.equal(preview.metrics.images.length, 2); assert.ok(preview.metrics.pageCount <= 2);
  } finally { await other.close(); }
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
});

test('full-source mode exports an unfinished Markdown draft exactly when saving fails', async t => {
  const { outer, directory, page, original, errors } = await fixture(t);
  await page.locator('#source-mode').click();
  await page.waitForFunction(() => document.querySelector('#body').value.startsWith('\uFEFF---') || document.querySelector('#body').value.startsWith('---'));
  await page.route('**/api/save', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: '保存暂时不可用' } }) }));
  const source = '\uFEFF---\nperson: [\n---\n未完成的正文。\n';
  await page.locator('#body').fill(source); await page.locator('#save-status').filter({ hasText: '保存失败' }).waitFor();
  const before = await inventory(directory);
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#save-draft').click()]);
  const archive = path.join(outer, '完整源文件草稿.zip'); await download.saveAs(archive);
  const decoded = decodeBackup(await readFile(archive)); assert.equal(decoded.source, source);
  for (const asset of Object.values(original.front.assets)) assert.deepEqual(decoded.files[asset.src], await readFile(path.join(directory, asset.src)));
  assert.deepEqual(await inventory(directory), before); assert.equal(await page.locator('#body').inputValue(), source);
  assert.deepEqual(errors, []);
});
