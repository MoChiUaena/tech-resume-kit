import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { initializeProject } from '../src/files.mjs';
import { startEditor } from '../src/app.mjs';

test('sliders, quick choices and group resets remain editable and preserve resume content', async t => {
  const outer = await mkdtemp(path.join(tmpdir(), 'tech-resume-sliders-'));
  const directory = path.join(outer, 'data');
  await initializeProject(directory, 'campus');
  const app = await startEditor(directory);
  const browser = await chromium.launch({ channel: 'chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  t.after(async () => {
    await browser.close(); await app.close();
    const actual = await realpath(outer);
    assert.ok(actual.startsWith(path.join(await realpath(tmpdir()), 'tech-resume-sliders-')));
    await rm(actual, { recursive: true, force: true });
  });
  await page.goto(app.url);
  await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
  const original = await app.project.read();
  await page.locator('#settings-open').click();
  await page.locator('#body-size-range').waitFor({ timeout: 3000 });
  await page.locator('#body-size-range').focus();
  await page.keyboard.press('ArrowRight');
  await page.locator('#save-status').filter({ hasText: '已自动保存' }).waitFor({ timeout: 30000 });
  assert.equal((await app.project.read()).layout.bodyPt, 10.51);
  assert.equal(await page.locator('#body-size').inputValue(), '10.51');

  await page.locator('[data-density-choice="compact"]').click();
  await page.locator('#margin-horizontal-range').focus();
  await page.keyboard.press('ArrowLeft');
  await page.locator('#save-status').filter({ hasText: '已自动保存' }).waitFor({ timeout: 30000 });
  let state = await app.project.read();
  assert.equal(state.layout.density, 'compact');
  assert.equal(state.layout.page.marginHorizontalMm, 14.99);
  assert.equal(await page.locator('#margin-horizontal').inputValue(), '14.99');

  await page.locator('#spacing-reset').click();
  await page.locator('#text-reset').click();
  await page.locator('#style-reset').click();
  await page.locator('#images-reset').click();
  await page.locator('#save-status').filter({ hasText: '已自动保存' }).waitFor({ timeout: 30000 });
  state = await app.project.read();
  assert.equal(state.source, original.source);
  assert.deepEqual(state.front.assets, original.front.assets);
  assert.equal(state.layout.page.marginMm, 15);
  assert.equal(state.layout.page.marginHorizontalMm, undefined);
  assert.equal(state.layout.bodyPt, 10.5);
  assert.equal(state.layout.lineHeight, 1.36);
  assert.equal(state.layout.density, 'standard');
  assert.equal(state.layout.images.portrait.widthMm, 23);
  assert.equal(state.layout.images.schoolLogo.widthMm, 34);
  await page.setViewportSize({ width: 390, height: 820 });
  await page.locator('[data-settings-target="settings-spacing"]').click();
  await page.locator('#margin-horizontal-range').scrollIntoViewIfNeeded();
  const sliderBounds = await page.locator('#margin-horizontal-range').boundingBox();
  assert.ok(sliderBounds.x >= 0 && sliderBounds.x + sliderBounds.width <= 390);
  await page.locator('[data-settings-target="settings-images"]').click();
  await page.locator('#images-reset').scrollIntoViewIfNeeded();
  const imageResetBounds = await page.locator('#images-reset').boundingBox();
  assert.ok(imageResetBounds.x >= 0 && imageResetBounds.x + imageResetBounds.width <= 390);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByRole('button', { name: '关闭设置' }).click();
  await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
});

test('saved fractional body and margin values remain exact in both selects and sliders', async t => {
  const outer = await mkdtemp(path.join(tmpdir(), 'tech-resume-slider-precision-'));
  const directory = path.join(outer, 'data');
  await initializeProject(directory, 'blank');
  const app = await startEditor(directory);
  const browser = await chromium.launch({ channel: 'chromium' });
  const page = await browser.newPage();
  t.after(async () => {
    await browser.close(); await app.close();
    const actual = await realpath(outer);
    assert.ok(actual.startsWith(path.join(await realpath(tmpdir()), 'tech-resume-slider-precision-')));
    await rm(actual, { recursive: true, force: true });
  });
  const initial = await app.project.read();
  const layout = structuredClone(initial.layout);
  layout.bodyPt = 10.63;
  layout.page.marginHorizontalMm = 14.25;
  layout.page.marginTopMm = 12.75;
  await app.project.save({ ...initial, layout });
  await page.goto(app.url);
  await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
  await page.locator('#settings-open').click();
  for (const [id, value] of [['body-size', '10.63'], ['margin-horizontal', '14.25'], ['margin-top', '12.75']]) {
    assert.equal(await page.locator('#' + id).inputValue(), value);
    assert.equal(await page.locator('#' + id + '-range').inputValue(), value);
  }
});
