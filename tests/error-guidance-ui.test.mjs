import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, realpath, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { initializeProject } from '../src/files.mjs';
import { startEditor } from '../src/app.mjs';
import { kitRoot } from '../src/render.mjs';

async function fixture(t, transform = source => source) {
  const outer = await mkdtemp(path.join(tmpdir(), 'tech-resume-guidance-')), root = path.join(outer, '资料'); await initializeProject(root, 'campus');
  const source = await readFile(path.join(root, 'resume.md'), 'utf8'); await writeFile(path.join(root, 'resume.md'), transform(source));
  const app = await startEditor(root, { historyIntervalMs: 0 }), browser = await chromium.launch({ channel: 'chromium' });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1050 } }), errors = [], external = [];
  page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
  page.on('request', request => { if (/^https?:/.test(request.url()) && new URL(request.url()).hostname !== '127.0.0.1') external.push(request.url()); });
  t.after(async () => { await browser.close(); await app.close(); const actual = await realpath(outer); assert.ok(actual.startsWith(path.join(await realpath(tmpdir()), 'tech-resume-guidance-'))); await rm(actual, { recursive: true, force: true, maxRetries: 3 }); assert.deepEqual(errors, []); assert.deepEqual(external, []); });
  await page.goto(app.url); await page.locator('#save-status').filter({ hasText: '已载入本地文件' }).waitFor();
  return { root, app, page };
}
const ready = page => page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
const issue = page => page.locator('#preview-error:not([hidden])').waitFor({ timeout: 30000 });

test('preview errors locate the correct person field and remove stale highlights after editing', async t => {
  const { page, app } = await fixture(t); await ready(page);
  await page.getByLabel('姓名', { exact: true }).fill(''); await issue(page);
  assert.match(await page.locator('#preview-error').innerText(), /姓名/);
  await page.locator('#person-card').evaluate(element => element.open = false);
  const source = (await app.project.read()).source; await page.locator('#preview-locate').click();
  assert.equal(await page.getByLabel('姓名', { exact: true }).getAttribute('aria-invalid'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'name'); assert.equal((await app.project.read()).source, source);
  const qa = path.join(kitRoot, 'tmp/ui/error-guidance'); await mkdir(qa, { recursive: true }); await page.screenshot({ path: path.join(qa, 'desktop-field.png') });
  await page.setViewportSize({ width: 390, height: 760 }); await page.locator('#preview-error').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(qa, 'small-field.png') });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByLabel('姓名', { exact: true }).fill('改正后的姓名');
  assert.notEqual(await page.getByLabel('姓名', { exact: true }).getAttribute('aria-invalid'), 'true'); assert.equal(await page.locator('#preview-locate').isVisible(), false);
  await page.locator('#save-status').filter({ hasText: '已自动保存' }).waitFor(); await ready(page);
});
test('invalid contact links locate their address input rather than another contact', async t => {
  const { page } = await fixture(t); await ready(page);
  const row = page.locator('#contacts .contact-row').nth(2), address = row.locator('.contact-link'); await address.fill('javascript:alert(1)'); await issue(page);
  await page.locator('#preview-locate').click(); assert.equal(await address.evaluate(element => document.activeElement === element), true);
  assert.equal(await address.getAttribute('aria-invalid'), 'true'); assert.equal(await page.locator('#contacts .contact-row').nth(0).locator('input:not(.contact-link)').getAttribute('aria-invalid'), null);
});
for (const prefix of ['', '\n\n\n']) test(`body errors select the source line with ${prefix.length} extra blank lines and CRLF metadata`, async t => {
  const { page, app } = await fixture(t, source => '\uFEFF' + source.replace(/\n/g, '\r\n')); await ready(page);
  const body = await page.locator('#body').inputValue(), invalid = '## 缺少章节标记'; await page.locator('#body').fill(prefix + body + '\n' + invalid + '\n'); await issue(page);
  const before = (await app.project.read()).source, expected = (await page.locator('#body').inputValue()).indexOf(invalid);
  await page.locator('#preview-locate').click();
  assert.equal(await page.locator('#body').evaluate(element => element.selectionStart), expected); assert.equal(await page.locator('#body').evaluate(element => element.selectionEnd), expected + invalid.length);
  assert.equal((await app.project.read()).source, before); assert.equal(await page.locator('#person-fields').isVisible(), true);
});
test('unknown metadata locates full Markdown as a view change without saving or dropping fields', async t => {
  const { page, app } = await fixture(t, source => source.replace('locale: zh-CN', 'locale: zh-CN\nunsupported: true')); await issue(page);
  const before = (await app.project.read()).source; let saves = 0; page.on('request', request => { if (request.url().endsWith('/api/save')) saves++; });
  await page.locator('#preview-locate').click(); assert.equal(await page.locator('#person-fields').isVisible(), false);
  const selected = await page.locator('#body').evaluate(element => element.value.slice(element.selectionStart, element.selectionEnd)); assert.equal(selected, 'unsupported: true');
  assert.equal(saves, 0); assert.equal((await app.project.read()).source, before);
});
test('a YAML syntax error in full-source mode selects the exact line without rewriting the document', async t => {
  const { page, app } = await fixture(t); await ready(page); await page.locator('#source-mode').click();
  await page.waitForFunction(() => document.querySelector('#person-fields').hidden);
  const source = '\uFEFF---\nperson: [\n---\n待完成的正文\n'; await page.locator('#body').fill(source); await issue(page);
  const before = (await app.project.read()).source; await page.locator('#preview-locate').click();
  assert.equal(await page.locator('#body').evaluate(element => element.value.slice(element.selectionStart, element.selectionEnd)), 'person: [');
  assert.equal((await app.project.read()).source, before); assert.equal(await page.locator('#body').inputValue(), source);
});
test('save conflicts and failed writes keep specific guidance alongside draft download', async t => {
  const { page, app, root } = await fixture(t); await ready(page); const original = await app.project.read();
  const external = original.source.replace(original.front.person.name, '外部姓名'); await writeFile(path.join(root, 'resume.md'), external);
  await page.getByLabel('姓名', { exact: true }).fill('未保存的本页姓名'); await page.locator('#save-status').filter({ hasText: '保存失败' }).waitFor();
  assert.match(await page.locator('#save-hint').innerText(), /草稿.*重新载入|重新载入.*草稿/); assert.equal(await page.locator('#save-draft').isVisible(), true);
  await page.getByLabel('姓名', { exact: true }).fill('继续保留的本页姓名'); assert.equal(await page.locator('#save-hint').isVisible(), true); assert.match(await page.locator('#save-hint').innerText(), /重新载入/);
  assert.equal(await readFile(path.join(root, 'resume.md'), 'utf8'), external);
  await page.route('**/api/save', route => route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: { code: 'EXECUTION', cause: 'ENOSPC', message: '空间不足' } }) }));
  await page.locator('#save-retry').click(); await page.locator('#save-retry:not([disabled])').waitFor(); assert.match(await page.locator('#save-hint').innerText(), /空间|磁盘/);
  assert.equal(await page.getByLabel('姓名', { exact: true }).inputValue(), '继续保留的本页姓名');
});
test('invalid images have persistent local guidance and a failed crop stays available for retry', async t => {
  const { page, app } = await fixture(t); await ready(page); const original = await app.project.read();
  await page.locator('#settings-open').click();
  await page.locator('#schoolLogo-upload').setInputFiles({ name: '损坏.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
  await page.locator('#schoolLogo-error:not([hidden])').waitFor(); assert.match(await page.locator('#schoolLogo-error').innerText(), /PNG|JPEG|图片/);
  assert.deepEqual((await app.project.read()).front.assets, original.front.assets);
  await page.locator('#portrait-upload').setInputFiles(path.join(kitRoot, 'assets/images/nailong-avatar.jpg')); await page.locator('#crop-dialog[open]').waitFor();
  await page.route('**/api/image/portrait', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: '图片暂时无法写入' } }) }));
  await page.locator('#crop-apply').click(); await page.locator('#crop-error:not([hidden])').waitFor(); assert.match(await page.locator('#crop-error').innerText(), /重试|再.*保存/);
  assert.equal(await page.locator('#crop-dialog').isVisible(), true); assert.deepEqual((await app.project.read()).front.assets, original.front.assets);
});
test('entry and skill validation focus their own fields while keeping typed content', async t => {
  const { page } = await fixture(t); await ready(page); await page.locator('#entry-project').click();
  await page.locator('#entry-title').fill('保留项目名'); await page.locator('#entry-details').fill('保留经历正文'); await page.locator('#entry-submit').click();
  await page.locator('#entry-error:not([hidden])').waitFor(); assert.equal(await page.evaluate(() => document.activeElement.id), 'entry-date'); assert.equal(await page.locator('#entry-title').inputValue(), '保留项目名');
  await page.getByRole('button', { name: '关闭添加经历' }).click(); await page.locator('#content-manager > summary').click(); await page.locator('#content-skill-add').click(); await page.locator('#content-text').fill('保留技能描述'); await page.locator('#content-submit').click();
  await page.locator('#content-error:not([hidden])').waitFor(); assert.equal(await page.evaluate(() => document.activeElement.id), 'content-label'); assert.equal(await page.locator('#content-text').inputValue(), '保留技能描述');
});
test('a validation response after closing a dialog does not mark a newly opened entry', async t => {
  const { page } = await fixture(t); await ready(page); await page.locator('#entry-manager > summary').click();
  await page.getByRole('button', { name: '编辑 CampusHub 校园活动预约平台', exact: true }).click();
  let release, entered; const gate = new Promise(resolve => release = resolve), started = new Promise(resolve => entered = resolve);
  await page.route('**/api/entries/change', async route => { entered(); await gate; await route.continue(); });
  await page.locator('#entry-title').fill(''); await page.locator('#entry-submit').click(); await started;
  await page.keyboard.press('Escape'); await page.locator('#entry-dialog').waitFor({ state: 'hidden' });
  const response = page.waitForResponse(result => result.url().endsWith('/api/entries/change') && result.status() === 422); release(); await response;
  await page.locator('#entry-submit:not([disabled])').waitFor({ state: 'attached' });
  await page.getByRole('button', { name: '编辑 CampusHub 校园活动预约平台', exact: true }).click();
  assert.equal(await page.locator('#entry-title').getAttribute('aria-invalid'), null); assert.equal(await page.locator('#entry-title').inputValue(), 'CampusHub 校园活动预约平台');
});
test('a late failed image request does not replace guidance for a newer successful selection', async t => {
  const { page, app } = await fixture(t); await ready(page); await page.locator('#settings-open').click();
  let release, entered, first = true; const gate = new Promise(resolve => release = resolve), started = new Promise(resolve => entered = resolve);
  await page.route('**/api/image/schoolLogo', async route => { if (!first) return route.continue(); first = false; entered(); await gate; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: '旧的图片失败' } }) }); });
  await page.locator('#schoolLogo-upload').setInputFiles({ name: '旧的损坏.png', mimeType: 'image/png', buffer: Buffer.from('broken') }); await started;
  const uploaded = page.waitForResponse(response => response.url().endsWith('/api/image/schoolLogo') && response.status() === 200);
  await page.locator('#schoolLogo-upload').setInputFiles(path.join(kitRoot, 'assets/images/chengchuan-logo.png')); await uploaded;
  await page.locator('#save-status').filter({ hasText: '已自动保存' }).waitFor(); const chosen = (await app.project.read()).front.assets.schoolLogo;
  const failed = page.waitForResponse(response => response.url().endsWith('/api/image/schoolLogo') && response.status() === 503); release(); await failed;
  assert.equal(await page.locator('#schoolLogo-error').isVisible(), false); assert.deepEqual((await app.project.read()).front.assets.schoolLogo, chosen);
});
test('an empty document locates the body or full-source end rather than unrelated metadata', async t => {
  const { page, app } = await fixture(t); await ready(page); await page.locator('#body').fill(''); await issue(page);
  const before = (await app.project.read()).source; await page.locator('#preview-locate').click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'body'); assert.equal(await page.locator('#person-fields').isVisible(), true);
  assert.equal((await app.project.read()).source, before);
  await page.locator('#source-mode').click(); await page.waitForFunction(() => document.querySelector('#person-fields').hidden);
  await page.locator('#preview-locate').click();
  assert.equal(await page.locator('#body').evaluate(element => element.selectionStart === element.value.length && element.selectionEnd === element.value.length), true);
  assert.equal((await app.project.read()).source, before);
});
