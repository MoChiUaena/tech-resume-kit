import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openLibrary } from '../src/library.mjs';
import { initializeProject } from '../src/files.mjs';

async function fixture(t, existing = false) {
  const outer = await mkdtemp(path.join(tmpdir(), 'tech-resume-start-')), root = path.join(outer, 'data');
  if (existing) await initializeProject(root, 'campus');
  let library = await openLibrary(root, { historyIntervalMs: 0 });
  t.after(async () => {
    await library.close(); const actual = await realpath(outer);
    assert.ok(actual.startsWith(path.join(await realpath(tmpdir()), 'tech-resume-start-')));
    await rm(actual, { recursive: true, force: true, maxRetries: 3 });
  });
  return { root, get library() { return library; }, async restart() { await library.close(); library = await openLibrary(root, { historyIntervalMs: 0 }); return library.read(); } };
}

test('a new library offers starter choices until chosen or dismissed, preserving preferences and blank content across restart', async t => {
  const f = await fixture(t), original = await f.library.read();
  assert.equal(original.gettingStarted.welcome, true);
  assert.equal((await f.restart()).gettingStarted.welcome, true);
  const preferencesFile = path.join(f.root, 'editor-preferences.local.json');
  const prefs = JSON.parse(await readFile(preferencesFile));
  await writeFile(preferencesFile, JSON.stringify({ ...prefs, futurePreference: 'preserve' })); await f.restart();
  const dismissed = await f.library.dismissGettingStarted(await f.library.read());
  assert.equal(dismissed.source, original.source); assert.equal(dismissed.config, original.config);
  assert.equal((await f.restart()).gettingStarted.welcome, false);
  assert.equal(JSON.parse(await readFile(preferencesFile)).futurePreference, 'preserve');
  await assert.rejects(f.library.startFromTemplate({ ...dismissed, mode: 'initial', template: 'campus' }), error => error.code === 'CONFLICT');
  const begun = await fixture(t), blank = await begun.library.read();
  blank.front.person.name = '开始填写';
  const edited = await begun.library.save({ ...blank, front: blank.front, body: blank.body });
  await begun.library.save({ ...edited, source: blank.source });
  assert.equal((await begun.restart()).gettingStarted.welcome, false);
});

test('choosing a campus starter keeps both independent images and history; a second window cannot replace it again', async t => {
  const f = await fixture(t), original = await f.library.read();
  const selected = await f.library.startFromTemplate({ ...original, mode: 'initial', template: 'campus' });
  assert.equal(selected.front.person.name, '奶龙'); assert.equal(selected.gettingStarted.welcome, false);
  assert.deepEqual(Object.keys(selected.front.assets).sort(), ['portrait', 'schoolLogo']);
  assert.ok((await f.library.backups(selected.resumeId)).some(backup => backup.kind === 'template'));
  await assert.rejects(f.library.startFromTemplate({ ...original, mode: 'initial', template: 'experience' }), error => error.code === 'CONFLICT');
  const persisted = await f.restart(); assert.equal(persisted.source, selected.source);
  assert.equal(persisted.gettingStarted.welcome, false);
});

test('existing, externally modified and imported libraries never offer replacement; starter creation leaves original files unchanged', async t => {
  const existing = await fixture(t, true), before = await existing.library.read();
  assert.equal(before.gettingStarted.welcome, false);
  await assert.rejects(existing.library.startFromTemplate({ ...before, mode: 'initial', template: 'blank' }), error => error.code === 'CONFLICT');
  const created = await existing.library.startFromTemplate({ ...before, mode: 'create', template: 'experience', name: '工作申请' });
  assert.equal(created.resumes.length, 2); assert.notEqual(created.resumeId, before.resumeId);
  assert.equal(created.layout.preset, 'experience'); assert.equal(created.layout.page.maxPages, 2);
  assert.equal(await readFile(path.join(existing.root, 'resume.md'), 'utf8'), before.source);
  const fresh = await fixture(t), initial = await fresh.library.read();
  await writeFile(path.join(fresh.root, 'resume.md'), initial.source.replace('你的姓名', '已有填写'));
  const current = await fresh.library.read(); assert.equal(current.gettingStarted.welcome, false);
  await assert.rejects(fresh.library.startFromTemplate({ ...initial, mode: 'initial', template: 'campus' }), error => error.code === 'CONFLICT');
  await assert.rejects(fresh.library.startFromTemplate({ ...current, mode: 'initial', template: 'campus' }), error => error.code === 'CONFLICT');
  const backup = await fresh.library.exportLibrary(current);
  await fresh.library.restoreLibrary({ ...current, sha256: (await fresh.library.inspectLibrary(backup.buffer)).sha256 }, backup.buffer);
  assert.equal((await fresh.restart()).gettingStarted.welcome, false);
});
