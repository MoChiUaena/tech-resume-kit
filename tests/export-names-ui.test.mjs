import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import { initializeProject } from '../src/files.mjs';
import { startEditor } from '../src/app.mjs';

test('PDF and Markdown downloads distinguish independent resumes with the same person name', async t => {
  const outer = await mkdtemp(path.join(tmpdir(), 'tech-resume-export-names-'));
  const directory = path.join(outer, '两份简历'); await initializeProject(directory, 'campus');
  const app = await startEditor(directory), browser = await chromium.launch({ channel: 'chromium' });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => {
    await browser.close(); await app.close(); const actual = await realpath(outer);
    assert.ok(actual.startsWith(path.join(await realpath(tmpdir()), 'tech-resume-export-names-')));
    await rm(actual, { recursive: true, force: true, maxRetries: 3 });
  });
  await page.goto(app.url); await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
  async function exportNames() {
    const [pdf] = await Promise.all([page.waitForEvent('download'), page.locator('#pdf-download').click()]);
    assert.equal((await PDFDocument.load(await readFile(await pdf.path()))).getPageCount(), 1);
    const [markdown] = await Promise.all([page.waitForEvent('download'), page.locator('#markdown-download').click()]);
    assert.match((await readFile(await markdown.path(), 'utf8')), /^---\n/);
    return { pdf: pdf.suggestedFilename(), markdown: markdown.suggestedFilename() };
  }
  assert.deepEqual(await exportNames(), { pdf: '奶龙-我的简历.pdf', markdown: '奶龙-我的简历.md' });
  await page.locator('#resume-create').click();
  await page.locator('#resume-name').fill('Java 校招');
  await page.locator('#resume-template').selectOption('campus');
  await page.locator('#resume-submit').click(); await page.locator('#resume-dialog').waitFor({ state: 'hidden' });
  await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
  assert.equal(await page.locator('#name').inputValue(), '奶龙');
  assert.deepEqual(await exportNames(), { pdf: '奶龙-Java 校招.pdf', markdown: '奶龙-Java 校招.md' });
  await page.locator('#resume-rename').click(); await page.locator('#resume-name').fill('AI / 申请');
  await page.locator('#resume-submit').click(); await page.locator('#resume-dialog').waitFor({ state: 'hidden' });
  await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
  assert.deepEqual(await exportNames(), { pdf: '奶龙-AI ／ 申请.pdf', markdown: '奶龙-AI ／ 申请.md' });
  await page.reload(); await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
  assert.deepEqual(await exportNames(), { pdf: '奶龙-AI ／ 申请.pdf', markdown: '奶龙-AI ／ 申请.md' });
  await page.locator('#history-open').click(); await page.locator('#history-dialog[open]').waitFor();
  const [backup] = await Promise.all([page.waitForEvent('download'), page.locator('#backup-export').click()]);
  assert.equal(backup.suggestedFilename(), 'AI ／ 申请-完整备份.zip');
  assert.equal((await readFile(await backup.path())).subarray(0, 2).toString(), 'PK');
  assert.deepEqual(errors, []);
});


async function exportFixture(t) {
  const outer = await mkdtemp(path.join(tmpdir(), 'tech-resume-export-consistency-'));
  const directory = path.join(outer, '导出验证'); await initializeProject(directory, 'campus');
  const app = await startEditor(directory), browser = await chromium.launch({ channel: 'chromium' });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => {
    await browser.close(); await app.close(); const actual = await realpath(outer);
    assert.ok(actual.startsWith(path.join(await realpath(tmpdir()), 'tech-resume-export-consistency-')));
    await rm(actual, { recursive: true, force: true, maxRetries: 3 });
  });
  await page.goto(app.url); await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
  return { app, page, directory, errors };
}

async function pauseExport(page) {
  let release, entered, intercepted = false;
  const started = new Promise(resolve => entered = resolve), gate = new Promise(resolve => release = resolve);
  await page.route(url => url.pathname === '/api/preview' || url.pathname === '/document.pdf' && url.searchParams.has('download'), async route => {
    if (intercepted) return route.continue();
    intercepted = true; entered(); await gate; await route.continue();
  });
  return { started, release };
}

test('PDF export keeps the chosen resume stable until the complete file is ready', async t => {
  const { app, page, errors } = await exportFixture(t);
  const firstId = await page.locator('#resume-select').inputValue();
  await page.locator('#resume-create').click(); await page.locator('#resume-name').fill('第二份岗位');
  await page.locator('#resume-template').selectOption('campus'); await page.locator('#resume-submit').click();
  await page.locator('#resume-dialog').waitFor({ state: 'hidden' });
  await page.locator('#name').fill('第二份样张');
  await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
  await page.locator('#resume-select').selectOption(firstId);
  await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
  const current = await (await fetch(app.url + 'api/state')).json(); assert.equal(current.resumeId, firstId);
  const preview = await fetch(app.url + `document.pdf?resumeId=${firstId}&revision=${current.revision}`); assert.equal(preview.status, 200);
  const previewBytes = Buffer.from(await preview.arrayBuffer());
  const paused = await pauseExport(page), downloaded = page.waitForEvent('download'); downloaded.catch(() => {});
  try {
    await page.locator('#pdf-download').click(); await paused.started;
    assert.equal(await page.locator('#resume-select').isDisabled(), true, 'Changing resumes while a PDF export is waiting must be prevented');
    assert.equal(await page.locator('#name').isDisabled(), true, 'Editing while a PDF export is waiting must be prevented');
    assert.equal(await page.locator('#pdf-download').isDisabled(), true);
    paused.release();
    const pdf = await downloaded;
    assert.equal(pdf.suggestedFilename(), '奶龙-我的简历.pdf');
    const pdfBytes = await readFile(await pdf.path());
    assert.deepEqual(pdfBytes, previewBytes, 'The download must contain the chosen preview, not another resume with a matching filename');
    assert.equal((await PDFDocument.load(pdfBytes)).getPageCount(), 1);
    await page.locator('#pdf-download:not([disabled])').waitFor();
    assert.equal(await page.locator('#resume-select').inputValue(), firstId);
    assert.equal(await page.locator('#name').isEnabled(), true);
    const qa = path.resolve('tmp/pdfs/export'); await mkdir(qa, { recursive: true });
    await pdf.saveAs(path.join(qa, 'consistent-campus.pdf'));
    await page.screenshot({ path: path.join(qa, 'export-completed.png') });
    assert.deepEqual(errors, []);
  } finally { paused.release(); }
});

test('a PDF export rejected after an external edit shows the conflict and restores controls without downloading an error file', async t => {
  const { page, directory, errors } = await exportFixture(t);
  const paused = await pauseExport(page), downloads = [];
  page.on('download', download => downloads.push(download));
  try {
    await page.locator('#pdf-download').click(); await paused.started;
    const input = path.join(directory, 'resume.md'), before = await readFile(input, 'utf8');
    const changed = before.replace('奶龙', '外部编辑样张'); assert.notEqual(changed, before);
    await writeFile(input, changed, 'utf8'); paused.release();
    await page.locator('#toast:not([hidden])').filter({ hasText: /修改|载入|冲突/ }).waitFor();
    await page.locator('#pdf-download:not([disabled])').waitFor();
    assert.equal(await page.locator('#resume-select').isEnabled(), true);
    assert.equal(await page.locator('#name').inputValue(), '奶龙');
    assert.equal(await readFile(input, 'utf8'), changed);
    assert.equal(downloads.length, 0);
    assert.deepEqual(errors, []);
  } finally { paused.release(); }
});


test('editing a name in full Markdown gives PDF and Markdown downloads the saved source name', async t => {
  const { page, errors } = await exportFixture(t);
  await page.locator('#source-mode').click();
  const source = await page.locator('#body').inputValue(), changed = source.replace('奶龙', '源文件样张');
  assert.notEqual(changed, source); await page.locator('#body').fill(changed);
  await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
  const [pdf] = await Promise.all([page.waitForEvent('download'), page.locator('#pdf-download').click()]);
  assert.equal(pdf.suggestedFilename(), '源文件样张-我的简历.pdf');
  assert.equal((await PDFDocument.load(await readFile(await pdf.path()))).getPageCount(), 1);
  const [markdown] = await Promise.all([page.waitForEvent('download'), page.locator('#markdown-download').click()]);
  assert.equal(markdown.suggestedFilename(), '源文件样张-我的简历.md');
  assert.equal(await readFile(await markdown.path(), 'utf8'), changed);
  assert.deepEqual(errors, []);
});


test('source-mode switching protects input while loading and restores controls after success or failure', async t => {
  const { page, errors, app } = await exportFixture(t);
  await page.locator('#source-mode').click(); await page.locator('#person-fields').waitFor({ state: 'hidden' });
  const source = await page.locator('#body').inputValue(), changed = source.replace('奶龙', '模式切换样张');
  await page.locator('#body').fill(changed);
  await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
  let releaseState, enteredState;
  const entered = new Promise(resolve => enteredState = resolve), gate = new Promise(resolve => releaseState = resolve);
  await page.route('**/api/state', async route => { const response = await route.fetch(); enteredState(); await gate; await route.fulfill({ response }); });
  await page.locator('#source-mode').click(); await entered;
  try {
    for (const id of ['body', 'source-mode', 'pdf-download', 'markdown-download', 'resume-select']) assert.equal(await page.locator('#' + id).isDisabled(), true, id + ' must stay disabled during mode loading');
    await page.keyboard.press('Control+s');
    assert.equal((await app.project.read()).source, changed);
  } finally { releaseState(); }
  await page.locator('#person-fields').waitFor({ state: 'visible' });
  await page.locator('#source-mode:not([disabled])').waitFor();
  assert.equal(await page.locator('#name').inputValue(), '模式切换样张');
  assert.equal(await page.locator('#body').isDisabled(), false);
  await page.unroute('**/api/state');
  await page.route('**/api/state', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: '模式载入暂时失败' } }) }));
  await page.locator('#source-mode').click();
  await page.locator('#toast').filter({ hasText: '模式载入暂时失败' }).waitFor({ state: 'visible' });
  await page.locator('#source-mode:not([disabled])').waitFor();
  assert.equal(await page.locator('#person-fields').isVisible(), true);
  assert.equal(await page.locator('#name').inputValue(), '模式切换样张');
  assert.equal(await page.locator('#body').isDisabled(), false);
  assert.equal((await app.project.read()).source, changed);
  assert.deepEqual(errors, []);
});


test('editing during a delayed draft checkpoint prevents mode switching from replacing newer input', async t => {
  const { page, app, errors } = await exportFixture(t);
  await page.locator('#source-mode').click(); await page.locator('#person-fields').waitFor({ state: 'hidden' });
  let releaseClear, enteredClear, first = true;
  const entered = new Promise(resolve => enteredClear = resolve), gate = new Promise(resolve => releaseClear = resolve);
  await page.route('**/api/drafts/clear', async route => { if (first) { first = false; enteredClear(); await gate; } await route.continue(); });
  const source = await page.locator('#body').inputValue(), saved = source.replace('奶龙', '已保存样张');
  await page.locator('#body').fill(saved); await entered;
  await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
  assert.equal((await app.project.read()).source, saved);
  const newer = saved.replace('已保存样张', '等待期间的新姓名');
  try {
    await page.locator('#source-mode').click();
    await page.locator('#body').fill(newer);
  } finally { releaseClear(); }
  await page.waitForFunction(() => !document.getElementById('person-fields').hidden || document.getElementById('toast').textContent.includes('内容尚未保存'));
  assert.equal(await page.locator('#body').inputValue(), newer, 'a delayed draft checkpoint must not let mode switching overwrite newer source');
  assert.equal(await page.locator('#person-fields').isVisible(), false);
  await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
  assert.equal((await app.project.read()).source, newer);
  await page.locator('#source-mode').click(); await page.locator('#person-fields').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#name').inputValue(), '等待期间的新姓名');
  assert.deepEqual(errors, []);
});


test('mode switching includes a school logo selected while waiting for an earlier draft checkpoint', async t => {
  const { page, app, errors, directory } = await exportFixture(t);
  const originalLogo = (await app.project.read()).front.assets.schoolLogo.src;
  const logo = await readFile(new URL('../assets/images/chengchuan-logo.png', import.meta.url));
  let releaseClear, enteredClear, releaseUpload, enteredUpload, releaseState, enteredState, first = true;
  const clearEntered = new Promise(resolve => enteredClear = resolve), clearGate = new Promise(resolve => releaseClear = resolve);
  const uploadEntered = new Promise(resolve => enteredUpload = resolve), uploadGate = new Promise(resolve => releaseUpload = resolve);
  const stateEntered = new Promise(resolve => enteredState = resolve), stateGate = new Promise(resolve => releaseState = resolve);
  await page.route('**/api/drafts/clear', async route => { if (first) { first = false; enteredClear(); await clearGate; } await route.continue(); });
  await page.route('**/api/image/schoolLogo', async route => { enteredUpload(); await uploadGate; await route.continue(); });
  await page.route('**/api/state', async route => { const response = await route.fetch(); enteredState(); await stateGate; await route.fulfill({ response }); });
  await page.locator('#name').fill('图片等待样张'); await clearEntered;
  await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
  try {
    await page.locator('#source-mode').click();
    await page.locator('#schoolLogo-upload').setInputFiles({ name: '等待期间的新校徽.png', mimeType: 'image/png', buffer: logo });
    await uploadEntered;
    const cleared = page.waitForResponse(response => response.url().endsWith('/api/drafts/clear'));
    releaseClear(); await (await cleared).finished();
    await Promise.race([stateEntered, new Promise(resolve => setTimeout(resolve, 250))]);
    releaseUpload();
    await page.locator('#schoolLogo-file').filter({ hasText: '等待期间的新校徽.png' }).waitFor({ state: 'attached' });
    releaseState();
    await page.locator('#person-fields').waitFor({ state: 'hidden' });
    await page.locator('#source-mode:not([disabled])').waitFor();
    await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
    const saved = await app.project.read();
    assert.notEqual(saved.front.assets.schoolLogo.src, originalLogo, 'the newly selected logo must remain referenced in the saved resume');
    assert.deepEqual(await readFile(path.join(directory, saved.front.assets.schoolLogo.src)), logo);
    assert.ok((await page.locator('#body').inputValue()).includes(saved.front.assets.schoolLogo.src));
    assert.equal(saved.front.person.name, '图片等待样张');
    assert.deepEqual(errors, []);
  } finally { releaseClear(); releaseUpload(); releaseState(); }
});
