import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, realpath, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { parse, stringify } from 'yaml';
import { initializeProject } from '../src/files.mjs';
import { startEditor } from '../src/app.mjs';
import { parseResume } from '../src/input.mjs';
import { kitRoot } from '../src/render.mjs';
import { pdfExpectations } from '../scripts/pdf-expectations.mjs';

async function fixture(t, transform = source => source) {
  const outer = await mkdtemp(path.join(tmpdir(), 'tech-resume-form-filling-')), root = path.join(outer, '资料');
  await initializeProject(root, 'campus');
  await writeFile(path.join(root, 'resume.md'), transform(await readFile(path.join(root, 'resume.md'), 'utf8')));
  const layout = parse(await readFile(path.join(root, 'layout.yaml'), 'utf8')); layout.page.maxPages = 2;
  await writeFile(path.join(root, 'layout.yaml'), stringify(layout));
  const app = await startEditor(root), browser = await chromium.launch({ channel: 'chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => {
    await browser.close(); await app.close();
    const actual = await realpath(outer); assert.ok(actual.startsWith(path.join(await realpath(tmpdir()), 'tech-resume-form-filling-')));
    await rm(actual, { recursive: true, force: true, maxRetries: 3 }); assert.deepEqual(errors, []);
  });
  await page.goto(app.url);
  await page.locator('#save-status').filter({ hasText: '已载入本地文件' }).waitFor();
  return { app, page };
}
const ready = page => page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });

test('form filling keeps Markdown optional through edits, additions, resume switching and PDF download', async t => {
  const { app, page } = await fixture(t); await ready(page);
  assert.equal(await page.locator('#body').isVisible(), false);
  await page.getByLabel('姓名', { exact: true }).fill('填写流程示例');
  await page.locator('#save-status').filter({ hasText: '已自动保存' }).waitFor(); await ready(page);
  await page.locator('#guide-entries').click();
  await page.getByRole('button', { name: '编辑 澄川理工大学', exact: true }).click();
  await page.getByLabel('学校名称', { exact: true }).fill('示例工程大学');
  await page.locator('#entry-submit').click(); await page.locator('#entry-dialog').waitFor({ state: 'hidden' }); await ready(page);
  await page.locator('#entry-work').click();
  await page.getByLabel('公司名称', { exact: true }).fill('示例科技公司');
  await page.locator('#entry-date').fill('2026.06 - 2026.09');
  await page.locator('#entry-details').fill('开发接口并编写测试。');
  await page.locator('#entry-submit').click(); await page.locator('#entry-dialog').waitFor({ state: 'hidden' }); await ready(page);
  assert.equal(await page.locator('#body').isVisible(), false);
  assert.equal(await page.locator('#entry-manager').getAttribute('open'), '');
  const original = await app.project.read();
  assert.match(original.source, /示例工程大学/); assert.match(original.source, /示例科技公司/);
  await page.locator('#resume-copy').click(); await page.locator('#resume-name').fill('填写副本'); await page.locator('#resume-submit').click();
  await page.locator('#resume-dialog').waitFor({ state: 'hidden' }); await ready(page);
  const copy = await app.project.read();
  await page.locator('#advanced-editor > summary').click(); assert.equal(await page.locator('#body').isVisible(), true);
  await page.locator('#resume-select').selectOption(original.resumeId); await ready(page);
  assert.equal(await page.locator('#body').isVisible(), false); assert.equal((await app.project.read()).source, original.source);
  await page.locator('#resume-select').selectOption(copy.resumeId); await ready(page);
  assert.equal(await page.locator('#body').isVisible(), false);
  const qa = path.join(kitRoot, 'tmp/pdfs/form-filling'); await mkdir(qa, { recursive: true });
  const result = await app.project.preview();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#pdf-download').click()]);
  await download.saveAs(path.join(qa, 'form-filled-campus.pdf'));
  assert.deepEqual(await readFile(path.join(qa, 'form-filled-campus.pdf')), result.buffer);
  assert.equal(result.metrics.pageCount, 2);
  await writeFile(path.join(qa, 'form-filled-campus.expected.json'), JSON.stringify(pdfExpectations({ ...result, images: { portrait: true, schoolLogo: true } }, 2)));
});

test('education editing hides an empty stack and preserves existing Markdown formatting', async t => {
  const { app, page } = await fixture(t); await ready(page);
  const before = parseResume((await app.project.read()).source).document.sections.find(section => section.id === 'education').entries[0];
  await page.locator('#guide-entries').click(); await page.getByRole('button', { name: '编辑 澄川理工大学', exact: true }).click();
  assert.equal(await page.locator('#entry-stack').isVisible(), false);
  await page.locator('#entry-date').fill('2023.09 - 2027.07（预计）');
  await page.locator('#entry-submit').click(); await page.locator('#entry-dialog').waitFor({ state: 'hidden' }); await ready(page);
  const after = parseResume((await app.project.read()).source).document.sections.find(section => section.id === 'education').entries[0];
  assert.deepEqual(after.blocks, before.blocks); assert.equal(after.date, '2023.09 - 2027.07（预计）');
});

test('a slow entry save does not pull focus away after the user switches to basic information', async t => {
  const { app, page } = await fixture(t); await ready(page);
  let entered, release;
  const started = new Promise(resolve => entered = resolve), gate = new Promise(resolve => release = resolve);
  await page.route('**/api/save', async route => { entered(); await gate; await route.continue(); });
  try {
    await page.locator('#entry-work').click(); await page.locator('#entry-title').fill('保存时序示例');
    await page.locator('#entry-date').fill('2026.06 - 2026.09'); await page.locator('#entry-details').fill('验证保存期间可以继续切换填写位置。');
    await page.locator('#entry-submit').click(); await started;
    await page.locator('#guide-person').click(); assert.equal(await page.locator('#name').evaluate(element => document.activeElement === element), true);
    release(); await page.locator('#save-status').filter({ hasText: '已自动保存' }).waitFor(); await ready(page);
    assert.equal(await page.locator('#person-card').getAttribute('open'), '');
    assert.equal(await page.locator('#name').evaluate(element => document.activeElement === element), true);
    assert.match((await app.project.read()).source, /保存时序示例/);
  } finally { release(); }
});

test('education with an existing stack and custom entry sections remain editable without losing data', async t => {
  const { app, page } = await fixture(t, source => source.replace(/(\{#education \.entries\}[\s\S]*?```yaml\n)/, '$1stack: 课程工具\n').replace('{#projects .entries}', '{#research .entries}'));
  await ready(page); await page.locator('#guide-entries').click();
  await page.getByRole('button', { name: '编辑 澄川理工大学', exact: true }).click();
  assert.equal(await page.locator('#entry-stack').isVisible(), true); assert.equal(await page.locator('#entry-stack').inputValue(), '课程工具');
  await page.locator('#entry-subtitle').fill('软件工程 · 本科'); await page.locator('#entry-submit').click();
  await page.locator('#entry-dialog').waitFor({ state: 'hidden' }); await ready(page);
  assert.equal(parseResume((await app.project.read()).source).document.sections[0].entries[0].stack, '课程工具');
  await page.locator('[data-section-id=research] [data-action=edit]').first().click();
  const details = await page.locator('#entry-details').inputValue();
  await page.locator('#entry-title').fill('自定义研究项目'); await page.locator('#entry-submit').click();
  await page.locator('#entry-dialog').waitFor({ state: 'hidden' }); await ready(page);
  assert.match((await app.project.read()).source, /自定义研究项目/);
  await page.locator('[data-section-id=research] [data-action=edit]').first().click(); assert.equal(await page.locator('#entry-details').inputValue(), details);
});

test('error location unfolds advanced editing and source fallback stays visible without rewriting metadata', async t => {
  const { app, page } = await fixture(t); await ready(page);
  assert.equal(await page.locator('#body').isVisible(), false);
  await page.locator('#advanced-editor > summary').click();
  const body = await page.locator('#body').inputValue(), invalid = '## 缺少章节标记';
  await page.locator('#body').fill(body + '\n' + invalid + '\n');
  await page.locator('#preview-error:not([hidden])').waitFor({ timeout: 30000 });
  const beforeLocate = (await app.project.read()).source;
  await page.locator('#advanced-editor > summary').click();
  await page.locator('#preview-locate').click(); assert.equal(await page.locator('#body').isVisible(), true);
  assert.equal(await page.locator('#body').evaluate(element => element.value.slice(element.selectionStart, element.selectionEnd)), invalid);
  assert.equal((await app.project.read()).source, beforeLocate);
  const fallback = await fixture(t, source => source.replace('locale: zh-CN', 'locale: zh-CN\nunsupported: true'));
  await fallback.page.locator('#preview-error:not([hidden])').waitFor({ timeout: 30000 });
  const untouched = (await fallback.app.project.read()).source;
  await fallback.page.locator('#preview-locate').click(); assert.equal(await fallback.page.locator('#body').isVisible(), true);
  assert.equal((await fallback.app.project.read()).source, untouched);
});
