import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resumeThemes, applyResumeTheme } from '../src/resume-themes.mjs';
import { initializeProject } from '../src/files.mjs';
import { loadResume } from '../src/input.mjs';
import { renderResume, kitRoot } from '../src/render.mjs';
import { inspectAndExport } from '../src/export.mjs';
import { openLibrary } from '../src/library.mjs';
import { pdfExpectations } from '../scripts/pdf-expectations.mjs';

async function temporary(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'tech-resume-theme-'));
  t.after(async () => { const actual = await realpath(root); assert.ok(actual.startsWith(path.join(await realpath(tmpdir()), 'tech-resume-theme-'))); await rm(actual, { recursive: true, force: true, maxRetries: 3 }); });
  return root;
}

test('six visual themes preserve the same complete content and images in offline one-page and two-page PDFs', async () => {
  const single = await loadResume(path.join(kitRoot, 'templates/java-backend/resume.md'));
  const long = await loadResume(path.join(kitRoot, 'examples/experienced/resume.md'));
  const qa = path.join(kitRoot, 'tmp/pdfs/themes'); await mkdir(qa, { recursive: true });
  assert.equal(resumeThemes.length, 6); assert.equal(new Set(resumeThemes.map(theme => theme.id)).size, 6);
  for (const theme of resumeThemes) {
    for (const [kind, loaded, pages] of [['single', single, 1], ['long', long, 2]]) {
      const layout = applyResumeTheme(loaded.layout, theme.id);
      assert.equal(layout.accent, theme.accent);
      assert.deepEqual(layout.images, loaded.layout.images);
      assert.deepEqual(layout.sectionOrder, loaded.layout.sectionOrder);
      const rendered = await renderResume(loaded.document, layout, loaded);
      assert.deepEqual(rendered.document, loaded.document);
      const result = await inspectAndExport(rendered, { pdf: true });
      assert.equal(result.metrics.pageCount, pages, theme.id + '/' + kind);
      assert.equal(result.metrics.networkRequests.length, 0);
      assert.equal(result.metrics.outOfBounds.length, 0);
      assert.equal(result.metrics.overlap, false);
      assert.ok(Math.abs(parseFloat(result.metrics.bodySize) - loaded.layout.bodyPt * 96 / 72) < 0.001, 'Keep the selected body size');
      const stem = theme.id + '-' + kind;
      await writeFile(path.join(qa, stem + '.pdf'), result.buffer);
      await writeFile(path.join(qa, stem + '.expected.json'), JSON.stringify(pdfExpectations(rendered, pages), null, 2));
    }
  }
});

test('legacy layouts normalize to ink-blue and explicitly selecting it preserves the existing rendering', async () => {
  const loaded = await loadResume(path.join(kitRoot, 'resume.md'));
  const legacy = structuredClone(loaded.layout); delete legacy.theme;
  const normal = await renderResume(loaded.document, loaded.layout, loaded);
  const fromLegacy = await renderResume(loaded.document, legacy, loaded);
  assert.equal(fromLegacy.layout.theme, 'ink-blue');
  assert.equal(fromLegacy.html, normal.html);
  const explicit = await renderResume(loaded.document, applyResumeTheme(loaded.layout, 'ink-blue'), loaded);
  assert.equal(explicit.html, normal.html);
});

test('standalone init changes only theme settings and retains copied content, portrait and school Logo', async t => {
  const root = await temporary(t), original = await readFile(path.join(kitRoot, 'templates/java-backend/resume.md'), 'utf8');
  for (const theme of resumeThemes) {
    const directory = await initializeProject(path.join(root, theme.id), 'java-backend', { theme: theme.id });
    const loaded = await loadResume(path.join(directory, 'resume.md'));
    assert.equal(await readFile(path.join(directory, 'resume.md'), 'utf8'), original);
    assert.equal(loaded.layout.theme, theme.id); assert.equal(loaded.layout.accent, theme.accent);
    assert.equal(loaded.layout.images.portrait.widthMm / loaded.layout.images.portrait.heightMm, 23 / 31);
    for (const asset of Object.values(loaded.document.assets)) assert.ok((await readFile(path.join(directory, asset.src))).length > 0);
  }
});

test('initial blank content and independent new resumes retain selected styles across reopening without replacing original content', async t => {
  const root = await temporary(t); let library = await openLibrary(path.join(root, 'data'));
  t.after(() => library.close());
  const original = await library.read();
  let state = await library.startFromTemplate({ ...original, mode: 'initial', template: 'blank', theme: 'warm-labels' });
  assert.equal(state.source, original.source); assert.equal(state.layout.theme, 'warm-labels');
  assert.equal(state.gettingStarted.welcome, false); const originalId = state.resumeId;
  state = await library.create({ ...state, name: '独立目录风格', template: 'java-backend', theme: 'forest-rail' });
  assert.equal(state.layout.theme, 'forest-rail'); assert.equal(state.front.person.name, '奶龙');
  const source = state.source;
  await library.close(); library = await openLibrary(path.join(root, 'data')); state = await library.read();
  assert.equal(state.layout.theme, 'forest-rail'); assert.equal(state.source, source);
  state = await library.switchResume({ ...state, targetId: originalId });
  assert.equal(state.source, original.source); assert.equal(state.layout.theme, 'warm-labels');
});

test('unknown and path-like styles fail before creating a directory or replacing an initial resume', async t => {
  const root = await temporary(t);
  for (const theme of ['../ink-blue', '__proto__', 'unknown', null]) {
    const target = path.join(root, 'invalid');
    await assert.rejects(initializeProject(target, 'campus', { theme }), /风格|theme/);
    await assert.rejects(access(target), error => error.code === 'ENOENT');
  }
  const library = await openLibrary(path.join(root, 'data')); t.after(() => library.close());
  const state = await library.read();
  await assert.rejects(library.startFromTemplate({ ...state, mode: 'initial', template: 'campus', theme: '__proto__' }), /风格|theme/);
  assert.deepEqual(await library.read(), state);
  const backups = await library.backups(state.resumeId);
  await assert.rejects(library.useTemplate({ ...state, template: 'campus', theme: '__proto__' }), /风格|theme/);
  assert.deepEqual(await library.backups(state.resumeId), backups);
  assert.deepEqual(await library.read(), state);
});
