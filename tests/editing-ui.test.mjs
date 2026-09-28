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
