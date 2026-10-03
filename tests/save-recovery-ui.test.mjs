import { openAdvancedEditor } from './helpers/advanced-editor.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { startEditor } from '../src/app.mjs';
import { kitRoot } from '../src/render.mjs';

async function fixture(t) {
  const outer = await mkdtemp(path.join(tmpdir(), 'tech-resume-save-recovery-')), directory = path.join(outer, '填写资料');
  const app = await startEditor(directory), browser = await chromium.launch({ channel: 'chromium' });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1050 } }), errors = [], external = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url()) && new URL(request.url()).hostname !== '127.0.0.1') external.push(request.url()); });
  t.after(async () => {
    await browser.close(); await app.close(); const actual = await realpath(outer);
    assert.ok(actual.startsWith(path.join(await realpath(tmpdir()), 'tech-resume-save-recovery-')));
    await rm(actual, { recursive: true, force: true, maxRetries: 3 });
  });
  await page.goto(app.url); await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
  return { app, page, directory, errors, external };
}

test('a transient autosave failure keeps the current input visible and retries into the same resume', async t => {
  const { page, directory, errors, external } = await fixture(t);
  const sourceFile = path.join(directory, 'resume.md'), original = await readFile(sourceFile, 'utf8');
  let failing = true;
  await page.route('**/api/save', route => failing ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'WRITE', message: '暂时无法写入文件，请重试' } }) }) : route.continue());
  await page.getByLabel('姓名', { exact: true }).fill('自动保存恢复样例');
  await page.locator('#save-status').filter({ hasText: '保存失败' }).waitFor();
  assert.equal(await page.locator('#save-error').count(), 1);
  assert.equal(await page.locator('#save-error').isVisible(), true);
  assert.match(await page.locator('#save-error-message').innerText(), /暂时无法写入文件/);
  assert.match(await page.locator('#page-status').innerText(), /上次预览/);
  assert.equal(await page.locator('#pdf-download').isDisabled(), true);
  assert.equal(await page.getByLabel('姓名', { exact: true }).inputValue(), '自动保存恢复样例');
  assert.equal(await readFile(sourceFile, 'utf8'), original);
  const qa = path.join(kitRoot, 'tmp/ui/save-recovery'); await mkdir(qa, { recursive: true });
  await page.screenshot({ path: path.join(qa, 'desktop-save-error.png') });
  await page.setViewportSize({ width: 390, height: 760 }); await page.locator('#save-error').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(qa, 'small-save-error.png') });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const retryBounds = await page.locator('#save-retry').boundingBox(); assert.ok(retryBounds.x >= 0 && retryBounds.x + retryBounds.width <= 390);
  await Promise.all([page.waitForResponse(response => response.url().endsWith('/api/save') && response.status() === 503), page.locator('#save-retry').click()]);
  await page.locator('#save-retry:not([disabled])').waitFor();
  assert.equal(await page.locator('#save-error').isVisible(), true);
  assert.equal(await readFile(sourceFile, 'utf8'), original);
  failing = false;
  await page.locator('#save-retry').click(); await page.locator('#save-error').waitFor({ state: 'hidden' });
  await page.locator('#save-status').filter({ hasText: '已自动保存' }).waitFor();
  await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
  assert.match(await readFile(sourceFile, 'utf8'), /自动保存恢复样例/);
  await page.reload(); await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
  assert.equal(await page.getByLabel('姓名', { exact: true }).inputValue(), '自动保存恢复样例');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
});

test('retrying a conflict preserves the local input and the externally changed file until explicit reload', async t => {
  const { page, app, directory, errors } = await fixture(t);
  const original = await app.project.read(), sourceFile = path.join(directory, 'resume.md');
  const externalSource = original.source.replace(original.front.person.name, '其他窗口姓名');
  await writeFile(sourceFile, externalSource);
  await page.getByLabel('姓名', { exact: true }).fill('本页未保存姓名');
  await page.locator('#save-status').filter({ hasText: '保存失败' }).waitFor();
  await page.locator('#save-error:not([hidden])').waitFor();
  assert.match(await page.locator('#save-error-message').innerText(), /其他窗口|修改/);
  await Promise.all([page.waitForResponse(response => response.url().endsWith('/api/save') && response.status() === 409), page.locator('#save-retry').click()]);
  await page.locator('#save-retry:not([disabled])').waitFor();
  assert.equal(await page.getByLabel('姓名', { exact: true }).inputValue(), '本页未保存姓名');
  assert.equal(await readFile(sourceFile, 'utf8'), externalSource);
  assert.equal(await page.locator('#save-error').isVisible(), true);
  page.once('dialog', dialog => dialog.accept()); await openAdvancedEditor(page); await page.locator('#reload').click();
  await page.waitForFunction(() => document.querySelector('#name').value === '其他窗口姓名');
  assert.equal(await page.locator('#save-error').isVisible(), false);
  assert.equal(await readFile(sourceFile, 'utf8'), externalSource);
  assert.deepEqual(errors, []);
});

for (const outcome of ['failure', 'success']) test(`reload uses the final file state after an in-flight save returns ${outcome}`, async t => {
  const { page, app, directory, errors } = await fixture(t), original = await app.project.read();
  let releaseSave, enteredSave, first = true;
  const entered = new Promise(resolve => enteredSave = resolve), gate = new Promise(resolve => releaseSave = resolve);
  await page.route('**/api/save', async route => {
    if (!first) return route.continue();
    first = false; enteredSave(); await gate;
    return outcome === 'failure' ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: '延迟返回的保存失败' } }) }) : route.continue();
  });
  await page.getByLabel('姓名', { exact: true }).fill('在途保存姓名'); await entered;
  page.once('dialog', dialog => dialog.accept()); await openAdvancedEditor(page); await page.locator('#reload').click();
  await page.waitForFunction(name => document.querySelector('#reload').disabled || document.querySelector('#name').value === name, original.front.person.name);
  const response = page.waitForResponse(result => result.url().endsWith('/api/save') && result.status() === (outcome === 'failure' ? 503 : 200));
  releaseSave(); await response; await page.locator('#save-retry:not([disabled])').waitFor({ state: 'attached' });
  const expectedName = outcome === 'failure' ? original.front.person.name : '在途保存姓名';
  assert.equal(await page.getByLabel('姓名', { exact: true }).inputValue(), expectedName);
  assert.equal(await page.locator('#save-error').isVisible(), false);
  assert.match(await page.locator('#save-status').innerText(), /已载入/);
  const loaded = await app.project.read(); assert.equal(loaded.front.person.name, expectedName);
  await page.getByLabel('姓名', { exact: true }).fill('载入后继续填写');
  await page.locator('#save-status').filter({ hasText: '已自动保存' }).waitFor();
  assert.match(await readFile(path.join(directory, 'resume.md'), 'utf8'), /载入后继续填写/);
  assert.deepEqual(errors, []);
});

test('a failed reload before the autosave timer fires exposes a recoverable unsaved draft', async t => {
  const { page, directory, errors } = await fixture(t), sourceFile = path.join(directory, 'resume.md');
  const original = await readFile(sourceFile, 'utf8');
  await page.route('**/api/state', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: '暂时无法读取资料' } }) }));
  page.once('dialog', dialog => dialog.accept());
  const response = page.waitForResponse(result => result.url().endsWith('/api/state') && result.status() === 503);
  await page.evaluate(() => {
    const name = document.querySelector('#name'); name.value = '重新载入失败后保留';
    name.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#reload').click();
  });
  await response; await page.locator('#reload:not([disabled])').waitFor();
  assert.equal(await page.locator('#save-error').isVisible(), true);
  assert.match(await page.locator('#save-error-message').innerText(), /重新载入|读取资料/);
  assert.match(await page.locator('#save-status').innerText(), /未保存/);
  assert.equal(await page.getByLabel('姓名', { exact: true }).inputValue(), '重新载入失败后保留');
  assert.equal(await readFile(sourceFile, 'utf8'), original);
  await page.locator('#save-retry').click(); await page.locator('#save-error').waitFor({ state: 'hidden' });
  await page.locator('#save-status').filter({ hasText: '已自动保存' }).waitFor();
  assert.match(await readFile(sourceFile, 'utf8'), /重新载入失败后保留/);
  assert.deepEqual(errors, []);
});
