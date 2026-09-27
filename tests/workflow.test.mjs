import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { get } from 'node:http';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import { loadResume } from '../src/input.mjs';
import { renderResume, kitRoot } from '../src/render.mjs';
import { inspectAndExport } from '../src/export.mjs';
import { initializeProject } from '../src/files.mjs';
import { startPreview } from '../src/preview.mjs';
import { prepareImages } from '../src/assets.mjs';

const exec = promisify(execFile);
const cli = path.join(kitRoot, 'src/cli.mjs');
async function temporary(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'tech-resume-test-'));
  t.after(async () => {
    const actual = await realpath(root);
    assert.ok(actual.startsWith(path.join(await realpath(tmpdir()), 'tech-resume-test-')));
    await rm(actual, { recursive: true, force: true });
  });
  return root;
}
const loadMain = () => loadResume(path.join(kitRoot, 'resume.md'));

test('image toggles reclaim space; slots, sizes and config parameters apply without editing HTML', async () => {
  const loaded = await loadMain();
  const results = [];
  for (const enabled of [[true, true], [true, false], [false, true], [false, false]]) {
    const layout = structuredClone(loaded.layout);
    layout.images.portrait.enabled = enabled[0];
    layout.images.schoolLogo.enabled = enabled[1];
    if (enabled[0] && !enabled[1]) layout.images.portrait.slot = 'end';
    const rendered = await renderResume(loaded.document, layout, loaded);
    const { metrics } = await inspectAndExport(rendered);
    assert.equal(metrics.images.length, enabled.filter(Boolean).length);
    assert.equal(metrics.overlap, false);
    assert.deepEqual(metrics.outOfBounds, []);
    if (enabled[0] && !enabled[1]) assert.ok(metrics.images[0].x >= metrics.identity.right);
    results.push(metrics);
  }
  assert.ok(results[3].identity.width > results[0].identity.width + 150);
  assert.equal(results[3].identity.x, 0);
  const variant = structuredClone(loaded.layout);
  variant.images.portrait.enabled = false;
  variant.images.schoolLogo.enabled = false;
  variant.namePt = 24; variant.accent = '#36564b'; variant.page.marginMm = 16;
  variant.sectionOrder = [...variant.sectionOrder].reverse();
  const rendered = await renderResume(loaded.document, variant, loaded);
  assert.match(rendered.html, /--accent:#36564b/);
  const { metrics } = await inspectAndExport(rendered);
  assert.equal(metrics.sections[0].title, '荣誉与其他');
});

test('missing, mislabeled or out-of-range images produce actionable errors', async t => {
  const root = await temporary(t);
  const loaded = await loadMain();
  const document = structuredClone(loaded.document);
  document.assets.schoolLogo.src = 'not-found.png';
  await assert.rejects(prepareImages(document, loaded.layout, loaded), error => /学校 Logo路径不存在/.test(error.message) && error.field === 'assets.schoolLogo');
  await writeFile(path.join(root, 'wrong.jpg'), await readFile(path.join(kitRoot, 'assets/images/chengchuan-logo.png')));
  document.assets.schoolLogo.src = 'wrong.jpg';
  const layout = structuredClone(loaded.layout); layout.images.portrait.enabled = false;
  await assert.rejects(prepareImages(document, layout, { assetBase: root }), /扩展名与文件内容不一致/);
  layout.images.schoolLogo.enabled = false;
  assert.equal(Object.keys((await prepareImages(document, layout, { assetBase: root })).images).length, 0);
  const wrongConfig = structuredClone(loaded.layout); wrongConfig.images.schoolLogo.widthMm = 100;
  await assert.rejects(renderResume(loaded.document, wrongConfig, loaded), /不得大于 40/);
});

test('edited input and copied assets work outside the repository; existing PDF is preserved', async t => {
  const root = await temporary(t);
  const project = await initializeProject(path.join(root, '我的 简历'));
  await assert.rejects(initializeProject(project), /文件已存在/);
  const input = path.join(project, 'resume.md');
  const edited = (await readFile(input, 'utf8')).replaceAll('奶龙', '周予宁');
  assert.notEqual(edited, await readFile(input, 'utf8'));
  await writeFile(input, edited);
  const output = path.join(root, '我的输出.pdf');
  const built = await exec(process.execPath, [cli, 'build', input, '--out', output], { cwd: root, windowsHide: true });
  assert.match(built.stdout, /检查通过/);
  const original = await readFile(output);
  assert.equal(original.subarray(0, 5).toString(), '%PDF-');
  await assert.rejects(exec(process.execPath, [cli, 'build', input, '--out', output], { cwd: root, windowsHide: true }), error => /文件已存在/.test(error.stderr));
  assert.deepEqual(await readFile(output), original);
  const rebuilt = await exec(process.execPath, [cli, 'build', input, '--out', output, '--force'], { cwd: root, windowsHide: true });
  assert.match(rebuilt.stdout, /已生成/);
  const beforeFailure = await readFile(output);
  await writeFile(input, edited + '\n\n' + Array(80).fill('额外经历内容。').join('\n\n'));
  await assert.rejects(exec(process.execPath, [cli, 'build', input, '--out', output, '--force'], { cwd: root, windowsHide: true }), error => /超出一页/.test(error.stderr));
  assert.deepEqual(await readFile(output), beforeFailure);
});

test('blank starter is valid with both images disabled', async t => {
  const root = await temporary(t);
  const project = await initializeProject(path.join(root, 'blank'), 'blank');
  const loaded = await loadResume(path.join(project, 'resume.md'));
  const result = await inspectAndExport(await renderResume(loaded.document, loaded.layout, loaded));
  assert.equal(result.metrics.images.length, 0);
  assert.equal(result.metrics.sections.length, 4);
});

test('preview updates in an actual browser and recovers from an input error', async t => {
  const root = await temporary(t);
  const project = await initializeProject(path.join(root, 'preview'), 'blank');
  const input = path.join(project, 'resume.md');
  const source = await readFile(input, 'utf8');
  const preview = await startPreview(input, undefined, 0);
  t.after(() => { preview.server.closeAllConnections(); preview.server.close(); });
  assert.equal(preview.server.address().address, '127.0.0.1');
  assert.equal((await fetch(preview.url + '/resume.md')).status, 404);
  const foreignHostStatus = await new Promise((resolve, reject) => {
    get(preview.url, { headers: { Host: 'foreign.example' } }, response => {
      response.resume(); response.on('end', () => resolve(response.statusCode));
    }).on('error', reject);
  });
  assert.equal(foreignHostStatus, 403);
  const browser = await chromium.launch({ channel: 'chromium' });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(preview.url);
  await page.getByRole('heading', { name: '你的姓名', exact: true }).waitFor();
  await writeFile(input, source.replace('你的姓名', '预览刷新成功'));
  await page.getByRole('heading', { name: '预览刷新成功', exact: true }).waitFor({ timeout: 15000 });
  await writeFile(input, source.replace('schemaVersion: 0.2.0', 'schemaVersion: 9.9.9'));
  await page.locator('.preview-error').waitFor({ timeout: 15000 });
  assert.match(await page.locator('.preview-error').innerText(), /schemaVersion/);
  await writeFile(input, source);
  await page.getByRole('heading', { name: '你的姓名', exact: true }).waitFor({ timeout: 15000 });
  assert.equal((await (await fetch(preview.url + '/__status')).json()).valid, true);
  assert.match(await page.locator('iframe').getAttribute('src'), /__document\.pdf/);
  const config = path.join(project, 'layout.yaml');
  await writeFile(config, (await readFile(config, 'utf8')) + '\npage:\n  maxPages: 2\n');
  const added = Array.from({ length: 30 }, (_, i) => `预览分页段落 ${i + 1}：保存内容后，应显示实际 PDF 的分页和文字。`).join('\n\n');
  await writeFile(input, source + '\n\n' + added);
  await page.waitForFunction(() => document.querySelector('#preview-status')?.textContent.startsWith('2 页'), undefined, { timeout: 20000 });
  const pdfResponse = await fetch(preview.url + '/__document.pdf');
  assert.equal(pdfResponse.headers.get('content-type'), 'application/pdf');
  assert.equal((await PDFDocument.load(await pdfResponse.arrayBuffer())).getPageCount(), 2);
  // A screenshot helps the phase C visual review verify the native PDF frame.
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(kitRoot, 'tmp/pdfs/preview-two-pages.png') });
  await writeFile(input, source + '\n\n' + Array(5).fill(added).join('\n\n'));
  await page.locator('.preview-error').waitFor({ timeout: 30000 });
  assert.match(await page.locator('.preview-error').innerText(), /超出2 页上限/);
  assert.equal((await fetch(preview.url + '/__document.pdf')).status, 422);
});
