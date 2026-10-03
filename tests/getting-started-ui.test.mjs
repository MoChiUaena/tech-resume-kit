import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { startEditor } from '../src/app.mjs';
import { initializeProject } from '../src/files.mjs';
import { kitRoot } from '../src/render.mjs';
import { pdfExpectations } from '../scripts/pdf-expectations.mjs';

async function fixture(t, existing = false) {
  const outer = await mkdtemp(path.join(tmpdir(), 'tech-resume-start-ui-')), root = path.join(outer, '简历');
  if (existing) await initializeProject(root, 'campus');
  let app = await startEditor(root);
  const browser = await chromium.launch({ channel: 'chromium' }), page = await browser.newPage({ viewport: { width: 1500, height: 1050 } });
  const errors = [], external = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    if (!['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)) { external.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  t.after(async () => {
    await browser.close(); await app.close(); const actual = await realpath(outer);
    assert.ok(actual.startsWith(path.join(await realpath(tmpdir()), 'tech-resume-start-ui-')));
    await rm(actual, { recursive: true, force: true, maxRetries: 3 });
  });
  await page.goto(app.url); await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
  return { root, page, errors, external, get app() { return app; }, async restart() { await app.close(); app = await startEditor(root); await page.goto(app.url); await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 }); } };
}

test('a new user chooses a starter, navigates form sections and downloads the actual PDF without external requests', async t => {
  const f = await fixture(t), { page } = f;
  const qa = path.join(kitRoot, 'tmp/pdfs/getting-started'); await mkdir(qa, { recursive: true });
  assert.equal(await page.locator('#start-banner').isVisible(), true);
  await page.locator('#start-choose').click(); await page.locator('#start-dialog[open]').waitFor();
  assert.equal(await page.locator('#start-name-field').isVisible(), false);
  await page.locator('#start-content').selectOption('campus');
  await page.screenshot({ path: path.join(qa, 'starter-desktop.png') });
  await page.setViewportSize({ width: 390, height: 760 });
  await page.screenshot({ path: path.join(qa, 'starter-small.png') });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const submitBounds = await page.locator('#start-submit').boundingBox(); assert.ok(submitBounds.x >= 0 && submitBounds.x + submitBounds.width <= 390);
  await page.locator('#start-submit').click(); await page.locator('#start-dialog').waitFor({ state: 'hidden' });
  await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
  assert.equal(await page.locator('#start-banner').isVisible(), false);
  assert.equal(await page.locator('#name').inputValue(), '奶龙');
  await page.setViewportSize({ width: 1500, height: 1050 });
  await page.locator('#guide-entries').click(); await page.locator('#entry-list [data-action=edit]').first().waitFor();
  assert.equal(await page.locator('#entry-manager').getAttribute('open'), '');
  await page.locator('#entry-list [data-action=edit]').first().click();
  assert.equal(await page.locator('#entry-dialog').isVisible(), true); await page.getByRole('button', { name: '关闭添加经历' }).click();
  await page.locator('#guide-content').click(); await page.locator('#content-list [data-section-id=skills]').waitFor();
  assert.equal(await page.locator('#content-manager').getAttribute('open'), '');
  await page.locator('#guide-layout').click(); assert.equal(await page.locator('#settings').isVisible(), true);
  assert.equal(await page.locator('#portrait-enabled').isChecked(), true); assert.equal(await page.locator('#schoolLogo-enabled').isChecked(), true);
  await page.getByRole('button', { name: '关闭设置' }).click();
  await page.locator('#guide-person').click(); await page.locator('#target').fill('Java 后端开发');
  await page.locator('#save-status').filter({ hasText: '已自动保存' }).waitFor();
  const saved = await f.app.project.read();
  await page.waitForFunction(revision => document.querySelector('#pdf-frame').src.includes(revision), saved.revision);
  await page.locator('#page-status').filter({ hasText: '1 页 · A4' }).waitFor({ timeout: 30000 });
  await page.frameLocator('#pdf-frame').locator('.pdf-page[data-rendered=true]').waitFor({ timeout: 30000 });
  await page.frameLocator('#pdf-frame').locator('.textLayer').filter({ hasText: 'Java 后端开发' }).waitFor({ timeout: 30000 });
  const result = await f.app.project.preview(); assert.equal(result.metrics.pageCount, 1); assert.equal(result.metrics.images.length, 2);
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#pdf-download').click()]);
  await download.saveAs(path.join(qa, 'starter-campus.pdf'));
  await writeFile(path.join(qa, 'starter-campus.expected.json'), JSON.stringify(pdfExpectations({ ...result, images: { portrait: true, schoolLogo: true } }, 1)));
  await page.frameLocator('#pdf-frame').locator('.pdf-page[data-rendered=true]').waitFor({ timeout: 30000 });
  await page.screenshot({ path: path.join(qa, 'editor-desktop.png') });
  await f.restart(); assert.equal(await page.locator('#start-banner').isVisible(), false);
  assert.equal(await page.locator('#target').inputValue(), 'Java 后端开发');
  assert.deepEqual(f.errors, []); assert.deepEqual(f.external, []);
});

test('direct filling and blank starter choices persist across restarts, and full Markdown mode keeps navigation safe', async t => {
  const direct = await fixture(t);
  await direct.page.locator('#start-direct').click(); await direct.page.locator('#start-banner').waitFor({ state: 'hidden' });
  assert.equal(await direct.page.locator('#name').inputValue(), '你的姓名');
  await direct.restart(); assert.equal(await direct.page.locator('#start-banner').isVisible(), false);
  await direct.page.locator('#source-mode').click(); await direct.page.locator('#guide-person:disabled').waitFor();
  assert.equal(await direct.page.locator('#guide-entries').isDisabled(), true); assert.equal(await direct.page.locator('#guide-content').isDisabled(), true);
  await direct.page.locator('#source-mode').click(); await direct.page.locator('#guide-person:not([disabled])').waitFor();
  const blank = await fixture(t);
  const original = await readFile(path.join(blank.root, 'resume.md'), 'utf8');
  await blank.page.locator('#start-choose').click(); await blank.page.locator('#start-submit').click();
  await blank.page.locator('#start-dialog').waitFor({ state: 'hidden' });
  assert.equal(await readFile(path.join(blank.root, 'resume.md'), 'utf8'), original);
  await blank.restart(); assert.equal(await blank.page.locator('#start-banner').isVisible(), false);
  assert.deepEqual(direct.errors, []); assert.deepEqual(blank.errors, []);
});

test('existing users can create a separate starter; invalid names and external edits leave original content intact', async t => {
  const f = await fixture(t, true), { page } = f;
  const original = await readFile(path.join(f.root, 'resume.md'), 'utf8');
  assert.equal(await page.locator('#start-banner').isVisible(), false);
  await page.locator('#start-open').click(); assert.equal(await page.locator('#start-name-field').isVisible(), true);
  await page.locator('#start-name').fill('我的简历'); await page.locator('#start-submit').click();
  await page.locator('#start-error:not([hidden])').waitFor(); assert.match(await page.locator('#start-error').innerText(), /名称已经存在/);
  assert.equal(await page.locator('#start-name').inputValue(), '我的简历');
  await page.locator('#start-name').fill('经验版'); await page.locator('#start-content').selectOption('experience'); await page.locator('#start-submit').click();
  await page.locator('#start-dialog').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('#resume-select').selectedOptions[0]?.textContent === '经验版');
  await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
  assert.equal(await page.locator('#resume-select option').count(), 2);
  assert.equal(await readFile(path.join(f.root, 'resume.md'), 'utf8'), original);
  await f.restart(); assert.equal(await page.locator('#start-banner').isVisible(), false);
  await page.locator('#start-open').click();
  const current = await f.app.project.read(), file = path.join(f.root, 'resumes', current.resumeId, 'resume.md');
  const changed = current.source.replace(current.front.person.name, '外部编辑示例'); await writeFile(file, changed);
  await page.locator('#start-submit').click();
  await page.waitForFunction(() => !document.querySelector('#start-error').hidden && /切换|修改/.test(document.querySelector('#start-error').textContent));
  assert.equal(await page.locator('#start-dialog').isVisible(), true); assert.equal(await page.locator('#resume-select option').count(), 2);
  assert.equal(await readFile(file, 'utf8'), changed); assert.deepEqual(f.errors, []);
});
