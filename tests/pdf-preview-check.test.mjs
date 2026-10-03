import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { waitForCanvasPreview } from '../scripts/pdf-preview-check.mjs';

let browser;
before(async () => { browser = await chromium.launch({ channel: 'chromium' }); });
after(async () => { await browser.close(); });

async function fixture(t) {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.setContent(`<span id="page-status">1 页 · A4</span><div id="preview-error" hidden>保存失败</div>
    <iframe id="pdf-frame" srcdoc="<span id='page-number'>1 / 1</span><div id='viewer-error' hidden><span id='error-message'>PDF 无法显示</span></div><section class='pdf-page' data-rendered='true'><canvas></canvas><div class='textLayer'>毕业时间 2027.07</div></section>"></iframe>`);
  await page.frameLocator('#pdf-frame').locator('.textLayer').waitFor();
  return page;
}

test('a redraw starting after readiness was observed does not invalidate that successful observation', async t => {
  const page = await fixture(t);
  const observedPage = {
    evaluate: page.evaluate.bind(page),
    async waitForFunction(...args) {
      const result = await page.waitForFunction(...args);
      // Use a real DOM transition at the exact wait/snapshot boundary where
      // fit-width rendering can clear the marker while retaining a text layer.
      await page.evaluate(() => document.querySelector('#pdf-frame').contentDocument.querySelector('.pdf-page').removeAttribute('data-rendered'));
      return result;
    },
  };
  await assert.doesNotReject(() => waitForCanvasPreview(observedPage, '2027.07'));
  assert.equal(await page.frameLocator('#pdf-frame').locator('.pdf-page').getAttribute('data-rendered'), null);
});

test('a visible parent error still rejects a rendered PDF preview', async t => {
  const page = await fixture(t);
  await page.evaluate(() => { document.querySelector('#preview-error').hidden = false; });
  await assert.rejects(waitForCanvasPreview(page), /Portable PDF preview failed:.*保存失败/);
});

test('a visible viewer error still rejects a rendered PDF preview', async t => {
  const page = await fixture(t);
  await page.evaluate(() => { document.querySelector('#pdf-frame').contentDocument.querySelector('#viewer-error').hidden = false; });
  await assert.rejects(waitForCanvasPreview(page), /Portable PDF preview failed:.*PDF 无法显示/);
});

for (const surface of ['parent', 'viewer']) {
  test(`a visible ${surface} error cannot pass when its message is empty`, async t => {
    const page = await fixture(t);
    await page.evaluate(surface => {
      const box = surface === 'parent' ? document.querySelector('#preview-error') : document.querySelector('#pdf-frame').contentDocument.querySelector('#viewer-error');
      box.hidden = false; box.textContent = '';
    }, surface);
    await assert.rejects(waitForCanvasPreview(page), /Portable PDF preview failed:/);
  });
}

for (const scenario of ['unfinished-canvas', 'obsolete-text']) {
  test(`${scenario} cannot pass the preview check and retains timeout diagnostics`, async t => {
    const page = await fixture(t);
    if (scenario === 'unfinished-canvas') await page.evaluate(() => document.querySelector('#pdf-frame').contentDocument.querySelector('.pdf-page').removeAttribute('data-rendered'));
    const boundedPage = {
      evaluate: page.evaluate.bind(page),
      waitForFunction: (callback, arg, options) => page.waitForFunction(callback, arg, { ...options, timeout: 250 }),
    };
    await assert.rejects(waitForCanvasPreview(boundedPage, scenario === 'obsolete-text' ? '2028.07' : '2027.07'), error => {
      assert.match(error.message, /Portable PDF preview timed out:/);
      assert.match(error.message, /"ready":false/);
      assert.match(error.message, /"textLayers":1/);
      assert.match(error.message, /"viewerStatus":"1 \/ 1"/);
      assert.equal(error.cause.name, 'TimeoutError');
      return true;
    });
  });
}
