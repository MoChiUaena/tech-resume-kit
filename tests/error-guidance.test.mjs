import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseResume } from '../src/input.mjs';
import { insertResumeEntry } from '../app/entries.mjs';
import { changeResumeEntry } from '../src/entries.mjs';
import { changeResumeContent } from '../src/content.mjs';
import { readYaml } from '../src/input.mjs';
function failure(action) { try { action(); } catch (error) { return error; } assert.fail('Expected validation failure'); }
const original = await readFile(new URL('../resume.md', import.meta.url), 'utf8'), layout = readYaml(await readFile(new URL('../layout.yaml', import.meta.url), 'utf8'));
test('actual parser errors resolve to form fields and unknown metadata resolves to its complete source line', async () => {
  const { describeEditorError } = await import('../app/error-guidance.mjs');
  const context = { source: original, sourceMode: false, clean: true };
  const name = failure(() => parseResume(original.replace('name: 奶龙', 'name: ""')));
  const result = describeEditorError(name, context); assert.equal(result.target.id, 'name'); assert.match(result.message, /姓名/);
  const source = original.replace('locale: zh-CN', 'locale: zh-CN\nunsupported: true'), unknown = failure(() => parseResume(source));
  const full = describeEditorError(unknown, { ...context, source }); assert.deepEqual(full.target, { type: 'source', line: 4 });
  const constructorSource = original.replace('locale: zh-CN', 'locale: zh-CN\nconstructor: true'), constructorError = failure(() => parseResume(constructorSource));
  assert.deepEqual(describeEditorError(constructorError, { ...context, source: constructorSource }).target, { type: 'source', line: 4 });
  for (const key of ['preset', 'accent', 'bodyPt']) {
    const bad = original.replace('locale: zh-CN', `locale: zh-CN\n${key}: unexpected`), error = failure(() => parseResume(bad));
    assert.deepEqual(describeEditorError(error, { ...context, source: bad }).target, { type: 'source', line: 4 });
    assert.deepEqual(describeEditorError(error, { ...context, source: bad, sourceMode: true }).target, { type: 'line', line: 4 });
  }
  assert.equal(describeEditorError(unknown, { ...context, source, clean: false }).target, null);
  const empty = original.slice(0, original.indexOf('\n---\n') + 5), noSections = failure(() => parseResume(empty));
  assert.deepEqual(describeEditorError(noSections, { ...context, source: empty, body: '' }).target, { type: 'control', id: 'body' });
  assert.deepEqual(describeEditorError(noSections, { ...context, source: empty, sourceMode: true }).target, { type: 'end' });
});
test('line selection handles textarea offsets, empty lines, BOM and invalid locations without guessing', async () => {
  const { lineSelection } = await import('../app/error-guidance.mjs');
  assert.deepEqual(lineSelection('\uFEFFa\n\n中😀\n', 3), { start: 4, end: 7 });
  assert.deepEqual(lineSelection('one\ntwo\n', 2), { start: 4, end: 7 });
  for (const line of [0, -1, '2', 9, NaN]) assert.equal(lineSelection('one\ntwo', line), null);
});
test('configuration files and out-of-range field paths never point to an unrelated resume line or contact', async () => {
  const { describeEditorError } = await import('../app/error-guidance.mjs');
  const context = { source: original, sourceMode: false, clean: true };
  const config = describeEditorError({ message: '参数不正确', file: 'C:\\data\\layout.yaml', line: 4, field: 'header.gapMm' }, context);
  assert.equal(config.target, null); assert.match(config.hint, /版式配置/);
  assert.equal(describeEditorError({ message: '字段错误', field: 'person.contacts.999.href' }, context).target, null);
  assert.equal(describeEditorError({ message: '字段错误', line: '5', field: ['person.name'] }, context).target, null);
});
test('filesystem errors retain structured causes and receive an actionable localized explanation', async () => {
  const { serializeEditorError } = await import('../src/errors.mjs');
  const { describeEditorError } = await import('../app/error-guidance.mjs');
  const serialized = serializeEditorError(Object.assign(new Error('ENOSPC: disk full'), { code: 'ENOSPC' }));
  assert.equal(serialized.code, 'EXECUTION'); assert.equal(serialized.cause, 'ENOSPC'); assert.match(serialized.message, /空间/);
  const view = describeEditorError({ message: serialized.message, details: serialized }, { origin: 'save' }); assert.match(view.hint, /空间|磁盘/); assert.equal(view.target, null);
});
test('entry and content validation carry explicit field identities for their dialog focus', () => {
  const body = original.slice(original.indexOf('\n---\n') + 5);
  assert.equal(failure(() => insertResumeEntry(body, { kind: 'project', title: '标题', date: '', details: '正文' }, layout)).field, 'date');
  assert.equal(failure(() => changeResumeEntry(original, layout, { action: 'edit', sectionId: 'projects', index: 0, input: { title: '', date: '2026', content: '正文' } })).field, 'title');
  assert.equal(failure(() => changeResumeContent(original, layout, { kind: 'skills', action: 'add', input: { label: '', text: '正文' } })).field, 'label');
});
