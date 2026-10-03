import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { starterTemplates } from '../src/starter-templates.mjs';
import { initializeProject } from '../src/files.mjs';
import { loadResume } from '../src/input.mjs';
import { renderResume, kitRoot } from '../src/render.mjs';
import { inspectAndExport } from '../src/export.mjs';
import { openLibrary } from '../src/library.mjs';
import { pdfExpectations } from '../scripts/pdf-expectations.mjs';

const roles = ['frontend', 'java-backend', 'python-backend', 'ai-intern', 'data-analyst', 'qa-engineer', 'android'];
async function workspace(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'tech-resume-role-starters-'));
  t.after(async () => { const actual = await realpath(root); assert.ok(actual.startsWith(path.join(await realpath(tmpdir()), 'tech-resume-role-starters-'))); await rm(actual, { recursive: true, force: true, maxRetries: 3 }); });
  return root;
}

test('every advertised role initializes a standalone project and exports a complete offline one-page PDF', async t => {
  const root = await workspace(t), qa = path.join(kitRoot, 'tmp/pdfs/starter-templates');
  await mkdir(qa, { recursive: true });
  assert.equal(starterTemplates.length, 10);
  assert.equal(new Set(starterTemplates.map(item => item.id)).size, 10);
  for (const id of roles) {
    const template = starterTemplates.find(item => item.id === id); assert.ok(template, id);
    const directory = await initializeProject(path.join(root, id), id);
    const loaded = await loadResume(path.join(directory, 'resume.md'));
    assert.equal(loaded.document.person.name, '奶龙');
    assert.ok(loaded.document.person.target);
    assert.ok(loaded.document.sections.some(section => section.id === 'skills'));
    assert.ok(loaded.document.sections.some(section => section.id === 'projects'));
    assert.ok(loaded.document.person.contacts.every(contact => contact.href.includes('example.com')));
    assert.equal(loaded.layout.theme, 'ink-blue');
    const original = await readFile(path.join(directory, 'resume.md'), 'utf8');
    await assert.rejects(initializeProject(directory, 'blank'), /存在/);
    assert.equal(await readFile(path.join(directory, 'resume.md'), 'utf8'), original);
    for (const asset of Object.values(loaded.document.assets)) assert.ok((await readFile(path.join(directory, asset.src))).length > 0);
    const rendered = await renderResume(loaded.document, loaded.layout, loaded);
    const result = await inspectAndExport(rendered, { pdf: true });
    assert.equal(result.metrics.pageCount, 1, id);
    assert.equal(result.metrics.networkRequests.length, 0, id);
    await writeFile(path.join(qa, id + '.pdf'), result.buffer);
    await writeFile(path.join(qa, id + '.expected.json'), JSON.stringify(pdfExpectations(rendered, 1), null, 2));
  }
});

test('role selection uses the same catalog for initial setup and independent library creation, including image copies', async t => {
  const root = await workspace(t), directory = path.join(root, 'library');
  let library = await openLibrary(directory); t.after(() => library.close());
  let state = await library.read();
  state = await library.startFromTemplate({ ...state, mode: 'initial', template: 'java-backend' });
  assert.equal(state.gettingStarted.welcome, false);
  assert.match(state.front.person.target, /Java/);
  const firstId = state.resumeId, firstSource = state.source;
  for (const template of roles) {
    state = await library.create({ ...state, name: template, template });
    assert.notEqual(state.resumeId, firstId);
    assert.equal(state.front.person.name, '奶龙');
  }
  state = await library.switchResume({ ...state, targetId: firstId });
  assert.equal(state.source, firstSource);
  assert.equal(state.layout.images.portrait.heightMm / state.layout.images.portrait.widthMm, 31 / 23);
  await library.close(); library = await openLibrary(directory); state = await library.read();
  assert.equal(state.resumes.length, 8);
  assert.equal(state.source, firstSource);
  assert.match((await library.preview(state.revision, state.resumeId)).buffer.toString('latin1', 0, 5), /%PDF/);
});

test('unknown and path-like template identifiers fail before creating a destination or modifying a resume', async t => {
  const root = await workspace(t);
  for (const id of ['../campus', '__proto__', 'unknown', '', null]) {
    await assert.rejects(initializeProject(path.join(root, 'invalid'), id), /模板|template/);
  }
  const library = await openLibrary(path.join(root, 'library')); t.after(() => library.close());
  const state = await library.read();
  await assert.rejects(library.startFromTemplate({ ...state, mode: 'initial', template: '__proto__' }), /模板/);
  assert.deepEqual(await library.read(), state);
});
