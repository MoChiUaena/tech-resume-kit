import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { PDFDocument } from 'pdf-lib';
import { layoutSchema, validate } from '../src/schema.mjs';
import { initializeProject } from '../src/files.mjs';
import { kitRoot, renderResume } from '../src/render.mjs';
import { loadResume } from '../src/input.mjs';
import { inspectAndExport } from '../src/export.mjs';

const exec = promisify(execFile);

test('existing configs keep one page by default; the page cap only accepts one or two', () => {
  assert.equal(validate(layoutSchema, { schemaVersion: '0.2.0' }, new Map()).page.maxPages, 1);
  for (const maxPages of [0, 1.5, 3]) assert.throws(() => validate(layoutSchema, { schemaVersion: '0.2.0', page: { maxPages } }, new Map()));
  assert.equal(validate(layoutSchema, { schemaVersion: '0.2.0', page: { maxPages: 2 } }, new Map()).page.maxPages, 2);
});

test('the complete experience example yields two physical PDF pages without shrinking text', async () => {
  const loaded = await loadResume(path.join(kitRoot, 'examples/experienced/resume.md'));
  const rendered = await renderResume(loaded.document, loaded.layout, loaded);
  const result = await inspectAndExport(rendered, { pdf: true });
  assert.equal(result.metrics.pageCount, 2);
  assert.equal(result.metrics.bodySize, '14px');
  assert.equal((await PDFDocument.load(result.buffer)).getPageCount(), 2);
  const onePage = { ...loaded.layout, page: { ...loaded.layout.page, maxPages: 1 } };
  await assert.rejects(inspectAndExport(await renderResume(loaded.document, onePage, loaded)), error => error.code === 'OVERFLOW' && /需要 2 页/.test(error.message));
});

test('experience starter can export; exceeding its two-page cap preserves the previous PDF even with force', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'tech-resume-pages-'));
  t.after(async () => {
    const actual = await realpath(root);
    assert.ok(actual.startsWith(path.join(await realpath(tmpdir()), 'tech-resume-pages-')));
    await rm(actual, { recursive: true, force: true });
  });
  const project = await initializeProject(path.join(root, '工作简历'), 'experience');
  const input = path.join(project, 'resume.md');
  const output = path.join(root, 'resume.pdf');
  const cli = path.join(kitRoot, 'src/cli.mjs');
  await exec(process.execPath, [cli, 'build', input, '--out', output], { windowsHide: true });
  const original = await readFile(output);
  await writeFile(input, (await readFile(input, 'utf8')) + '\n\n' + Array(120).fill('这段额外经历不能通过缩小字号或裁切隐藏，超过两页时必须明确拒绝导出。').join('\n\n'));
  await assert.rejects(exec(process.execPath, [cli, 'build', input, '--out', output, '--force'], { windowsHide: true }), error => /超出2 页上限/.test(error.stderr));
  assert.deepEqual(await readFile(output), original);
});
