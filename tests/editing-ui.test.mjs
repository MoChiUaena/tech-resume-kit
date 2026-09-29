import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { imageSize } from 'image-size';
import { startEditor } from '../src/app.mjs';
import { kitRoot } from '../src/render.mjs';
import { initializeProject } from '../src/files.mjs';
import { pdfExpectations } from '../scripts/pdf-expectations.mjs';
import { parseResume } from '../src/input.mjs';

async function fixture(t, template = 'blank') {
  const outer = await mkdtemp(path.join(tmpdir(), 'tech-resume-editing-')), directory = path.join(outer, '编辑体验');
  await initializeProject(directory, template); const app = await startEditor(directory);
  const browser = await chromium.launch({ channel: 'chromium' }), page = await browser.newPage({ viewport: { width: 1500, height: 1040 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  t.after(async () => { await browser.close(); await app.close(); const actual = await realpath(outer); assert.ok(actual.startsWith(path.join(await realpath(tmpdir()), 'tech-resume-editing-'))); await rm(actual, { recursive: true, force: true, maxRetries: 3 }); });
  await page.goto(app.url); await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
  const qa = path.join(kitRoot, 'tmp/pdfs/editing'); await mkdir(qa, { recursive: true });
  return { app, page, errors, qa };
}

test('portrait crop cancels safely and persists a movable, rotated 23:31 portrait through backup and reload', async t => {
  const { app, page, errors, qa } = await fixture(t, 'campus');
  const before = await app.project.read(), originalPath = path.join(app.project.root, before.front.assets.portrait.src), originalBytes = await readFile(originalPath);
  await page.locator('#settings-open').click();
  await page.locator('#portrait-upload').setInputFiles(path.join(kitRoot,'assets/images/synthetic-portrait.jpg'));
  await page.locator('#crop-dialog[open]').waitFor(); await page.locator('#crop-cancel').click();
  assert.equal((await app.project.read()).revision, before.revision);
  await page.locator('#crop-existing').click(); await page.locator('#crop-dialog[open]').waitFor();
  const pixels = () => page.locator('#crop-canvas').evaluate(canvas => canvas.toDataURL());
  const initial = await pixels(); await page.locator('#crop-rotate-right').click(); assert.notEqual(await pixels(), initial);
  await page.locator('#crop-rotate-left').click(); assert.equal(await pixels(), initial);
  await page.locator('#crop-zoom').evaluate(slider => { slider.value = '1.5'; slider.dispatchEvent(new Event('input', { bubbles: true })); });
  const box = await page.locator('#crop-canvas').boundingBox(); await page.mouse.move(box.x + box.width/2,box.y + box.height/2); await page.mouse.down(); await page.mouse.move(box.x + box.width/2 + 20,box.y + box.height/2 + 25); await page.mouse.up();
  assert.notEqual(await pixels(), initial);
  await page.locator('#crop-reset').click(); assert.equal(await pixels(), initial);
  await page.locator('#crop-zoom').evaluate(slider => { slider.value = '1.15'; slider.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.screenshot({ path: path.join(qa, 'photo-crop.png') });
  await page.locator('#crop-apply').click(); await page.locator('#crop-dialog').waitFor({ state:'hidden' });
  await page.getByRole('button',{name:'关闭设置'}).click(); await page.locator('#pdf-download:not([disabled])').waitFor({ timeout:30000 });
  const after = await app.project.read(), croppedBytes = await readFile(path.join(app.project.root,after.front.assets.portrait.src)), dimensions = imageSize(croppedBytes);
  assert.equal(dimensions.width,690); assert.equal(dimensions.height,930); assert.notEqual(after.front.assets.portrait.src,before.front.assets.portrait.src);
  assert.deepEqual(await readFile(originalPath),originalBytes);
  const history = await app.project.backups(after.resumeId); assert.ok(history.some(item=>item.kind==='photo'));
  await page.reload(); await page.locator('#pdf-download:not([disabled])').waitFor({ timeout:30000 }); assert.equal((await app.project.read()).front.assets.portrait.src,after.front.assets.portrait.src);
  const result = await app.project.preview(); assert.equal(result.metrics.images.length,2); assert.equal(result.metrics.pageCount,1);
  await writeFile(path.join(qa,'cropped-campus.pdf'),result.buffer); await writeFile(path.join(qa,'cropped-campus.expected.json'),JSON.stringify(pdfExpectations({...result,images:Object.fromEntries(result.metrics.images.map(item=>[item.asset,true]))},1)));
  await page.locator('#settings-open').click(); await page.locator('#crop-existing').click(); await page.locator('#crop-dialog[open]').waitFor(); await page.locator('#crop-cancel').click();
  assert.deepEqual(errors,[]);
});

test('entry dialogs create education, internship and project content without duplicate sections', async t => {
  const { app, page, errors, qa } = await fixture(t);
  for (const [kind,title,date,details] of [
    ['education','示例工程大学','2023.09 - 2027.06（预计）','学习计算机科学，完成课程设计。'],
    ['internship','示例科技公司','2026.06 - 2026.09','负责 API 开发。\n参与接口测试与性能分析。'],
    ['project','团队知识库助手','2026.03 - 2026.06','设计文档检索与工具调用流程。\n编写测试并记录结果。'],
  ]) {
    await page.locator(`#entry-${kind}`).click(); await page.locator('#entry-dialog[open]').waitFor();
    await page.locator('#entry-title').fill(title); await page.locator('#entry-date').fill(date); await page.locator('#entry-details').fill(details);
    if (kind === 'project') await page.locator('#entry-stack').fill('Python · FastAPI');
    await page.locator('#entry-submit').click(); await page.locator('#entry-dialog').waitFor({ state:'hidden' }); await page.locator('#pdf-download:not([disabled])').waitFor({ timeout:30000 });
  }
  const result = await app.project.preview(), ids = result.document.sections.map(section=>section.id);
  assert.deepEqual(ids,['education','skills','internship','projects','additional']);
  assert.equal(result.document.sections.find(section=>section.id==='education').entries.length,2);
  assert.equal(result.document.sections.find(section=>section.id==='projects').entries.length,2);
  assert.equal(result.document.sections.find(section=>section.id==='internship').entries[0].title,'示例科技公司');
  await page.reload(); await page.locator('#pdf-download:not([disabled])').waitFor({ timeout:30000 }); assert.match(await page.locator('#body').inputValue(),/团队知识库助手/);
  await page.locator('#entry-project').click(); await page.locator('#entry-title').fill('未填写时间'); await page.locator('#entry-details').fill('测试要点');
  const revision = (await app.project.read()).revision; await page.locator('#entry-submit').click(); await page.locator('#entry-error:not([hidden])').waitFor(); assert.equal((await app.project.read()).revision,revision);
  await page.locator('#entry-date').fill('2026.01 - 至今'); await page.screenshot({path:path.join(qa,'entry-form.png')});
  await page.getByRole('button',{name:'关闭添加经历'}).click();
  await writeFile(path.join(qa,'quick-entries.pdf'),result.buffer); await writeFile(path.join(qa,'quick-entries.expected.json'),JSON.stringify(pdfExpectations({...result,images:{}},1)));
  assert.deepEqual(errors,[]);
});

test('entry manager edits, copies, sorts and restores deletion while preserving the campus PDF and images', async t => {
  const { app, page, errors, qa } = await fixture(t, 'campus');
  await page.locator('#entry-manager-summary').click(); assert.equal(await page.locator('.info-card').evaluate(details => details.open), false);
  const group = id => page.locator(`.entry-group[data-section-id="${id}"]`);
  const rows = id => group(id).locator('.entry-row');
  const action = (id, index, name) => rows(id).nth(index).locator(`[data-action="${name}"]`);
  await group('education').waitFor();
  const original = await app.project.read(), originalDocument = parseResume(original.source).document;
  const photo = await readFile(path.join(app.project.root, original.front.assets.portrait.src));
  await action('education', 0, 'edit').click();
  const content = await page.locator('#entry-details').inputValue(); assert.ok(!content.startsWith('- ')); assert.match(content, /GPA/);
  await page.locator('#entry-date').fill('2023.09 - 2027.07（预计）');
  await page.screenshot({ path: path.join(qa, 'entry-edit.png') });
  await page.locator('#entry-submit').click(); await page.locator('#entry-dialog').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('[data-section-id=education] small')?.textContent.includes('2027.07'));
  const updated = parseResume((await app.project.read()).source).document;
  assert.deepEqual(updated.sections[0].entries[0].blocks, originalDocument.sections[0].entries[0].blocks);
  await action('projects', 0, 'duplicate').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-section-id=projects] .entry-row').length === 3);
  const copied = parseResume((await app.project.read()).source).document.sections.find(section => section.id === 'projects').entries;
  assert.deepEqual(copied[0], copied[1]);
  await action('projects', 2, 'up').click();
  await page.waitForFunction(() => document.querySelector('[data-section-id=projects] [data-entry-index="1"] strong')?.textContent.startsWith('DocPilot'));
  await action('projects', 1, 'down').click();
  await page.waitForFunction(() => document.querySelector('[data-section-id=projects] [data-entry-index="2"] strong')?.textContent.startsWith('DocPilot'));
  await action('projects', 1, 'delete').click(); await page.locator('#entry-delete-confirm').click();
  await page.locator('#entry-delete-dialog').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.querySelectorAll('[data-section-id=projects] .entry-row').length === 2);
  await action('projects', 1, 'up').click();
  await page.waitForFunction(() => document.querySelector('[data-section-id=projects] strong')?.textContent.startsWith('DocPilot'));
  const beforeDelete = await app.project.read();
  await action('internship', 0, 'delete').click(); assert.match(await page.locator('#entry-delete-description').textContent(), /最后一条/);
  await page.locator('#entry-delete-cancel').click(); assert.equal((await app.project.read()).revision, beforeDelete.revision);
  await action('internship', 0, 'delete').click(); await page.locator('#entry-delete-confirm').click();
  await page.locator('#entry-delete-dialog').waitFor({ state: 'hidden' }); await group('internship').waitFor({ state: 'hidden' });
  assert.ok(!(await app.project.read()).body.includes('{#internship .entries}'));
  await page.locator('#history-open').click();
  const history = page.locator('.history-item').filter({ hasText: '删除经历前' }).first(); await history.waitFor();
  await history.getByRole('button', { name: '恢复', exact: true }).click(); await page.locator('#restore-confirm').click();
  await page.locator('#restore-dialog').waitFor({ state: 'hidden' }); await page.getByRole('button', { name: '关闭备份与恢复' }).click();
  await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
  const restored = await app.project.read(); assert.equal(restored.body, beforeDelete.body); assert.deepEqual(restored.layout, beforeDelete.layout);
  assert.deepEqual(restored.front.person, beforeDelete.front.person);
  for (const key of ['portrait', 'schoolLogo']) assert.deepEqual(await readFile(path.join(app.project.root, restored.front.assets[key].src)), await readFile(path.join(app.project.root, beforeDelete.front.assets[key].src)));
  assert.equal(restored.front.person.name, '奶龙'); assert.deepEqual(await readFile(path.join(app.project.root, restored.front.assets.portrait.src)), photo);
  const result = await app.project.preview(); assert.equal(result.metrics.pageCount, 1); assert.equal(result.metrics.images.length, 2);
  const viewer = page.frameLocator('#pdf-frame'); await viewer.locator('.pdf-page[data-rendered=true]').waitFor({ timeout: 30000 });
  await page.locator('#toast').waitFor({ state: 'hidden' });
  await page.locator('#entry-list').evaluate(list => list.scrollTop = 0);
  await page.screenshot({ path: path.join(qa, 'entry-manager.png') });
  const editorFits = await page.locator('.editor-panel').evaluate(panel => { const help = panel.querySelector('.editor-help').getBoundingClientRect(); return help.bottom <= panel.getBoundingClientRect().bottom; });
  assert.equal(editorFits, true);
  await writeFile(path.join(qa, 'managed-campus.pdf'), result.buffer);
  await writeFile(path.join(qa, 'managed-campus.expected.json'), JSON.stringify(pdfExpectations({ ...result, images: Object.fromEntries(result.metrics.images.map(item => [item.asset, true])) }, 1)));
  await app.close(); const restarted = await startEditor(app.project.root); t.after(() => restarted.close());
  await page.goto(restarted.url); await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
  assert.equal((await restarted.project.read()).source, restored.source); await page.locator('#entry-manager-summary').click(); await group('projects').waitFor();
  assert.match(await rows('projects').first().textContent(), /DocPilot/); assert.deepEqual(errors, []);
});

test('entry forms refuse invalid edits and stale external changes and refresh after manual Markdown changes', async t => {
  const { app, page, errors } = await fixture(t);
  await page.locator('#entry-manager-summary').click();
  const row = page.locator('[data-section-id=projects] .entry-row').first(); await row.waitFor();
  await row.locator('[data-action=edit]').click();
  let before = await app.project.read();
  await page.locator('#entry-details').fill('> 不支持的引用'); await page.locator('#entry-submit').click();
  await page.locator('#entry-error:not([hidden])').waitFor(); assert.equal((await app.project.read()).revision, before.revision);
  await page.locator('#entry-details').fill('第一段。\n\n1. **设计接口**\n2. [说明](https://example.com)\n\n最后一段。');
  await page.locator('#entry-submit').click(); await page.locator('#entry-dialog').waitFor({ state: 'hidden' });
  await row.locator('[data-action=edit]:not([disabled])').waitFor(); await row.locator('[data-action=edit]').click();
  before = await app.project.read();
  const external = await app.project.save({ ...before, source: before.source.replace('第一段。', '外部编辑保留。') });
  await page.locator('#entry-title').fill('不应覆盖外部修改'); await page.locator('#entry-submit').click();
  await page.locator('#entry-error:not([hidden])').waitFor(); assert.match(await page.locator('#entry-error').textContent(), /切换或修改/);
  assert.equal((await app.project.read()).source, external.source);
  await page.getByRole('button', { name: '关闭添加经历' }).click(); await page.locator('#reload').click();
  await row.locator('[data-action=edit]:not([disabled])').waitFor(); await row.locator('[data-action=edit]').click();
  assert.match(await page.locator('#entry-details').inputValue(), /外部编辑保留/); await page.getByRole('button', { name: '关闭添加经历' }).click();
  const body = await page.locator('#body').inputValue(); await page.locator('#body').fill(body.replace('外部编辑保留。', '手动修改后保留。'));
  await row.locator('[data-action=edit]:not([disabled])').waitFor(); await row.locator('[data-action=edit]').click();
  assert.match(await page.locator('#entry-details').inputValue(), /手动修改后保留/); await page.getByRole('button', { name: '关闭添加经历' }).click();
  await page.locator('#source-mode').click(); await row.locator('[data-action=edit]:disabled').waitFor();
  await page.locator('#source-mode').click(); await row.locator('[data-action=edit]:not([disabled])').waitFor();
  await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 }); assert.deepEqual(errors, []);
});
