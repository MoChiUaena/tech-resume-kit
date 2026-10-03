import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { startEditor } from '../src/app.mjs';
import { kitRoot } from '../src/render.mjs';
import { resumeThemes } from '../src/resume-themes.mjs';

test('all six full PDF previews zoom offline without creating or modifying a resume; style selection is explicit and focus returns', async t => {
  const outer = await realpath(await mkdtemp(path.join(tmpdir(), 'tech-resume-full-preview-')));
  const app = await startEditor(path.join(outer, 'data'));
  const browser = await chromium.launch({ channel: 'chromium' }), page = await browser.newPage({ viewport: { width: 1480, height: 1120 } });
  const errors = [], remote = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { if (new URL(route.request().url()).origin !== new URL(app.url).origin) { remote.push(route.request().url()); return route.abort(); } return route.continue(); });
  t.after(async () => { await browser.close(); await app.close(); const actual = await realpath(outer); assert.ok(actual.startsWith(path.join(await realpath(tmpdir()), 'tech-resume-full-preview-'))); await rm(actual, { recursive: true, force: true, maxRetries: 3 }); });
  const qa = path.join(kitRoot, 'tmp/ui/full-theme-preview'); await mkdir(qa, { recursive: true });
  await page.goto(app.url); await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
  const original = await app.project.read();
  await page.locator('#start-choose').click();
  for (const theme of resumeThemes) {
    const button = page.locator('[data-theme-preview="' + theme.id + '"]');
    await button.click(); await page.locator('#theme-preview-dialog[open]').waitFor({ timeout: 3000 });
    const viewer = page.frameLocator('#theme-preview-frame');
    await viewer.locator('.pdf-page[data-rendered=true]').waitFor({ timeout: 30000 });
    assert.match(await viewer.locator('.textLayer').innerText(), /奶龙/);
    assert.equal(await viewer.locator('.link-layer a').count(), 2);
    assert.equal(await page.locator('#start-theme-ink-blue').isChecked(), true);
    assert.deepEqual(await app.project.read(), original);
    if (theme.id === 'slate-banner') {
      const width = await viewer.locator('.pdf-page > canvas').evaluate(canvas => canvas.width);
      await viewer.getByLabel('PDF 缩放').selectOption('1.25'); await viewer.locator('.pdf-page[data-rendered=true]').waitFor();
      assert.ok(await viewer.locator('.pdf-page > canvas').evaluate(canvas => canvas.width) > width);
      await viewer.getByLabel('PDF 缩放').selectOption('fit'); await viewer.locator('.pdf-page[data-rendered=true]').waitFor();
      await page.screenshot({ path: path.join(qa, 'full-preview-desktop.png') });
      await page.setViewportSize({ width: 390, height: 820 }); await viewer.locator('.pdf-page[data-rendered=true]').waitFor();
      const resizedFrame = await (await page.locator('#theme-preview-frame').elementHandle()).contentFrame();
      await resizedFrame.waitForFunction(() => { const pages=document.getElementById('pages'); return pages.scrollWidth <= pages.clientWidth + 1 && document.querySelector('.pdf-page')?.dataset.rendered === 'true'; });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.ok(await viewer.locator('#pages').evaluate(element => element.scrollWidth <= element.clientWidth + 1));
      await page.screenshot({ path: path.join(qa, 'full-preview-mobile.png') });
      await page.setViewportSize({ width: 1480, height: 1120 });
    }
    await viewer.locator('#pages').focus();
    await page.keyboard.press('Escape'); await page.locator('#theme-preview-dialog').waitFor({ state: 'hidden', timeout: 5000 });
    assert.equal(await button.evaluate(element => document.activeElement === element), true);
    assert.equal(await page.locator('#start-dialog').isVisible(), true);
  }
  await page.locator('[data-theme-preview="forest-rail"]').click();
  await page.frameLocator('#theme-preview-frame').locator('.pdf-page[data-rendered=true]').waitFor();
  await page.locator('#theme-preview-use').click();
  assert.equal(await page.locator('#start-theme-forest-rail').isChecked(), true);
  assert.deepEqual(await app.project.read(), original);
  await page.getByRole('button', { name: '关闭起步模板', exact: true }).click();
  await page.locator('#resume-create').click(); await page.locator('#resume-theme').selectOption('warm-labels');
  await page.locator('#resume-theme-preview').click(); await page.frameLocator('#theme-preview-frame').locator('.pdf-page[data-rendered=true]').waitFor();
  await page.frameLocator('#theme-preview-frame').getByLabel('PDF 缩放').focus(); await page.keyboard.press('Escape');
  await page.locator('#theme-preview-dialog').waitFor({ state: 'hidden', timeout: 5000 });
  assert.equal(await page.locator('#resume-dialog').isVisible(), true);
  assert.equal(await page.locator('#resume-theme-preview').evaluate(element => document.activeElement === element), true);
  assert.deepEqual(await app.project.read(), original);
  await page.locator('#resume-theme-preview').click(); await page.frameLocator('#theme-preview-frame').locator('.pdf-page[data-rendered=true]').waitFor();
  await page.locator('#theme-preview-use').click(); assert.equal(await page.locator('#resume-theme').inputValue(), 'warm-labels');
  assert.deepEqual(await app.project.read(), original);
  assert.deepEqual(errors, []); assert.deepEqual(remote, []);
});

test('the viewer rejects unknown bundle paths, queries and external PDF URLs before requesting them', async t => {
  const outer=await realpath(await mkdtemp(path.join(tmpdir(),'tech-resume-full-reject-')));
  const app=await startEditor(path.join(outer,'data')), browser=await chromium.launch({channel:'chromium'}), page=await browser.newPage();
  const requested=[]; page.on('request', request => requested.push(request.url()));
  t.after(async()=>{await browser.close();await app.close();const actual=await realpath(outer);assert.ok(actual.startsWith(path.join(await realpath(tmpdir()),'tech-resume-full-reject-')));await rm(actual,{recursive:true,force:true,maxRetries:3});});
  for (const source of ['/theme-previews/unknown.pdf','/theme-previews/ink-blue.pdf?override=1','https://example.com/theme.pdf']) {
    requested.length=0; await page.goto(app.url+'pdf-viewer.html?file='+encodeURIComponent(source));
    await page.locator('#viewer-error:not([hidden])').waitFor();
    assert.ok(!requested.some(url => url===source || url===new URL(source,app.url).href));
  }
});
