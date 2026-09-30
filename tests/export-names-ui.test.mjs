import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
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
