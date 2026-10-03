import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { initializeProject } from '../src/files.mjs';
import { startEditor } from '../src/app.mjs';
import { kitRoot } from '../src/render.mjs';
import { pdfExpectations } from '../scripts/pdf-expectations.mjs';
import { resumeThemes } from '../src/resume-themes.mjs';

async function fixture(t) {
  const outer = await realpath(await mkdtemp(path.join(tmpdir(), 'tech-resume-layout-options-'))), directory = path.join(outer, '简历');
  await initializeProject(directory, 'campus');
  const f = { outer, directory, app: await startEditor(directory), errors: [], remote: [] };
  t.after(async () => {
    await f.browser?.close(); await f.app?.close();
    const actual = await realpath(outer);
    assert.ok(actual.startsWith(path.join(await realpath(tmpdir()), 'tech-resume-layout-options-')));
    await rm(actual, { recursive: true, force: true, maxRetries: 3 });
  });
  const initial = await f.app.project.read(), layout = structuredClone(initial.layout);
  layout.page.maxPages = 2;
  layout.namePt = 23.2; layout.lineHeight = 1.333; layout.spacing.sectionMm = 4.15;
  await f.app.project.save({ ...initial, layout });
  f.original = await f.app.project.read();
  f.source = await readFile(path.join(directory, 'resume.md'));
  f.browser = await chromium.launch({ channel: 'chromium' });
  f.page = await f.browser.newPage({ viewport: { width: 1440, height: 1080 } });
  f.page.on('pageerror', error => f.errors.push(error.message));
  await f.page.route('**/*', route => {
    if (new URL(route.request().url()).hostname !== '127.0.0.1') { f.remote.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  await f.page.goto(f.app.url);
  await f.page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
  await f.page.locator('#settings-open').click();
  assert.equal(await f.page.getByText('更多排版选项', { exact: true }).count(), 1, 'The existing settings dialog must expose the additional layout options');
  return f;
}

const controls = [
  ['name-size', '姓名字号', 'namePt', '23.2', '24'],
  ['line-height', '行距', 'lineHeight', '1.333', '1.25'],
  ['section-spacing', '章节间距', 'spacing.sectionMm', '4.15', '3'],
];

test('more layout options start folded, preserve existing fractional values and do not save when merely opened', async t => {
  const f = await fixture(t), { page } = f;
  assert.equal(await page.locator('#advanced-layout').evaluate(element => element.open), false);
  await page.getByText('更多排版选项', { exact: true }).click();
  for (const [id, , , value] of controls) assert.equal(await page.locator('#' + id).inputValue(), value);
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  assert.equal((await f.app.project.read()).revision, f.original.revision);
  assert.deepEqual(await readFile(path.join(f.directory, 'resume.md')), f.source);
  assert.deepEqual((await f.app.project.read()).layout, f.original.layout);
  assert.deepEqual(f.errors, []); assert.deepEqual(f.remote, []);
});

test('chosen layout values persist across restart and resume switching; all six styles export the same unchanged content and images', async t => {
  const f = await fixture(t), { page } = f;
  await page.getByText('更多排版选项', { exact: true }).click();
  for (const [id, , , , value] of controls) await page.locator('#' + id).selectOption(value);
  await page.locator('#save-status').filter({ hasText: '已自动保存' }).waitFor();
  const saved = await f.app.project.read(), expected = structuredClone(f.original.layout);
  expected.namePt = 24; expected.lineHeight = 1.25; expected.spacing.sectionMm = 3;
  assert.deepEqual(saved.layout, expected);
  assert.deepEqual(await readFile(path.join(f.directory, 'resume.md')), f.source);
  assert.deepEqual(saved.front.assets, f.original.front.assets);
  const qa = path.join(kitRoot, 'tmp/pdfs/layout-options'); await mkdir(qa, { recursive: true });
  for (const theme of resumeThemes) {
    await page.locator('#visual-theme').selectOption(theme.id);
    await page.locator('#save-status').filter({ hasText: '已自动保存' }).waitFor();
    const preview = await f.app.project.preview();
    assert.equal(preview.layout.namePt, 24); assert.equal(preview.layout.lineHeight, 1.25); assert.equal(preview.layout.spacing.sectionMm, 3);
    assert.equal(preview.metrics.images.length, 2); assert.equal(preview.metrics.overlap, false);
    assert.deepEqual(preview.metrics.outOfBounds, []); assert.deepEqual(preview.metrics.networkRequests, []);
    await writeFile(path.join(qa, theme.id + '.pdf'), preview.buffer);
    await writeFile(path.join(qa, theme.id + '.expected.json'), JSON.stringify(pdfExpectations({ ...preview, images: { portrait: true, schoolLogo: true } }, preview.metrics.pageCount)));
  }
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await f.app.close(); f.app = undefined; f.app = await startEditor(f.directory);
  await page.goto(f.app.url); await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
  await page.locator('#settings-open').click();
  await page.getByText('更多排版选项', { exact: true }).click();
  for (const [id, , , , value] of controls) assert.equal(await page.locator('#' + id).inputValue(), value);
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.locator('#resume-create').click(); await page.locator('#resume-name').fill('另一份简历');
  await page.locator('#resume-template').selectOption('blank'); await page.locator('#resume-submit').click();
  await page.locator('#resume-dialog').waitFor({ state: 'hidden' });
  await page.locator('#settings-open').click();
  assert.equal(await page.locator('#name-size').inputValue(), '23');
  assert.equal(await page.locator('#line-height').inputValue(), '1.36');
  assert.equal(await page.locator('#section-spacing').inputValue(), '3.5');
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.locator('#resume-select').selectOption(f.original.resumeId);
  await page.locator('#settings-open').click();
  for (const [id, , , , value] of controls) assert.equal(await page.locator('#' + id).inputValue(), value);
  assert.deepEqual(await readFile(path.join(f.directory, 'resume.md')), f.source);
  assert.deepEqual(f.errors, []); assert.deepEqual(f.remote, []);
});

test('layout validation errors locate and unfold their controls on a narrow screen', async t => {
  const f = await fixture(t), { page } = f;
  await page.setViewportSize({ width: 390, height: 820 });
  await page.getByText('更多排版选项', { exact: true }).click();
  for (const [id, label, field, original, valid] of controls) {
    let active = true;
    await page.route('**/api/save', route => active ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INPUT', file: 'layout.yaml', field, message: '数值超出允许范围' } }) }) : route.continue());
    await page.locator('#' + id).selectOption(valid);
    await page.locator('#save-error:not([hidden])').waitFor({ timeout: 10000 });
    assert.match(await page.locator('#save-error-message').textContent(), new RegExp(label));
    await page.getByText('更多排版选项', { exact: true }).click();
    await page.getByRole('button', { name: '关闭设置', exact: true }).click();
    await page.locator('#save-locate').click();
    assert.equal(await page.locator('#advanced-layout').evaluate(element => element.open), true);
    assert.equal(await page.locator('#' + id).evaluate(element => document.activeElement === element), true);
    assert.equal(await page.locator('#' + id).getAttribute('aria-invalid'), 'true');
    active = false;
    await page.locator('#' + id).selectOption(original);
    await page.locator('#save-status').filter({ hasText: '已自动保存' }).waitFor();
    assert.equal(await page.locator('#' + id).getAttribute('aria-invalid'), null);
  }
  for (const [id] of controls) {
    await page.locator('#' + id).scrollIntoViewIfNeeded();
    const bounds = await page.locator('#' + id).boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
  }
  const qa = path.join(kitRoot, 'tmp/ui/layout-options'); await mkdir(qa, { recursive: true });
  await page.screenshot({ path: path.join(qa, 'settings-mobile.png') });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(await readFile(path.join(f.directory, 'resume.md')), f.source);
  assert.deepEqual(f.errors, []); assert.deepEqual(f.remote, []);
});

test('image error navigation after switching resumes loads the current chapters and cannot save another resume chapter IDs', async t => {
  const f = await fixture(t), { page } = f;
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.locator('#resume-create').click(); await page.locator('#resume-name').fill('独立空白简历');
  await page.locator('#resume-template').selectOption('blank'); await page.locator('#resume-submit').click();
  await page.locator('#resume-dialog').waitFor({ state: 'hidden' });
  await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
  const blank = await f.app.project.read(), front = structuredClone(blank.front), layout = structuredClone(blank.layout);
  front.assets.portrait = { src: 'missing-portrait.jpg', alt: '缺失照片验证' }; layout.images.portrait.enabled = true;
  await f.app.project.save({ resumeId: blank.resumeId, revision: blank.revision, front, body: blank.body, layout });
  await page.reload(); await page.locator('#preview-error:not([hidden])').waitFor({ timeout: 30000 });
  await page.locator('#resume-select').selectOption(f.original.resumeId);
  await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
  await page.locator('#settings-open').click();
  await page.waitForFunction(() => document.querySelectorAll('#order-list .order-row').length === 5);
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.locator('#resume-select').selectOption(blank.resumeId);
  await page.locator('#preview-error:not([hidden])').waitFor({ timeout: 30000 });
  await page.locator('#preview-locate').click();
  await page.locator('#order-list .order-row').first().waitFor();
  assert.deepEqual(await page.locator('#order-list .order-row').evaluateAll(rows => rows.map(row => row.dataset.sectionId)), ['education', 'skills', 'projects', 'additional']);
  await page.locator('#portrait-enabled').uncheck();
  await page.locator('#save-status').filter({ hasText: '已自动保存' }).waitFor();
  await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
  await page.locator('#order-list [data-section-id="education"] [data-action="down"]').click();
  await page.locator('#save-status').filter({ hasText: '已自动保存' }).waitFor();
  assert.deepEqual((await f.app.project.read()).layout.sectionOrder, ['skills', 'education', 'projects', 'additional']);
  assert.equal((await f.app.project.preview()).metrics.pageCount, 1);
  assert.deepEqual(await readFile(path.join(f.directory, 'resume.md')), f.source);
  assert.deepEqual(f.errors, []); assert.deepEqual(f.remote, []);
});
