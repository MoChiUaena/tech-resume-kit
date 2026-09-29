import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { listResumeEntries, changeResumeEntry } from '../src/entries.mjs';
import { parseResume } from '../src/input.mjs';
import { kitRoot } from '../src/render.mjs';

const sample = await readFile(path.join(kitRoot, 'templates/blank/resume.md'), 'utf8');
const front = sample.slice(0, sample.indexOf('\n---', 4) + 4);
const first = '### 同名经历\n\n~~~yml\n# 日期备注\nsubtitle: "负责人"\ndate: >-\n  2025.01 - 2025.06\nstack: Java · SQL\n~~~\n\n普通段落，保留 **加粗** 和 [链接](https://example.com)。\n\n3. 第三步\n4. 第四步\n\n结尾段落。';
const second = '### 同名经历\n\n```yaml\ndate: "2026.01 - 至今"\n```\n\n- 另一条经历。';
const tail = '\n\n## 其他 {#additional .lines}\n\n**英语**：CET-6。\n';
const source = `${front}\n\n## 自定义经历 {#research .entries}\n\n${first}\n\n${second}${tail}`;
const layout = { preset: 'campus', sectionOrder: ['research', 'additional'] };
const change = (action, index = 0, input) => changeResumeEntry(source, layout, { action, sectionId: 'research', index, input });

test('entry listing supports custom IDs, working experience and mixed Markdown blocks', async () => {
  const sections = listResumeEntries(source);
  assert.equal(sections[0].id, 'research'); assert.equal(sections[0].entries.length, 2);
  assert.equal(sections[0].entries[0].date, '2025.01 - 2025.06');
  assert.equal(sections[0].entries[0].content, first.slice(first.indexOf('普通段落')));
  const experienced = listResumeEntries(await readFile(path.join(kitRoot, 'examples/experienced/resume.md'), 'utf8'));
  assert.equal(experienced.find(section => section.id === 'experience').entries.length, 2);
});

test('editing only selected fields preserves raw body, front matter, comments and other entries', () => {
  const entry = listResumeEntries(source)[0].entries[0];
  assert.equal(change('edit', 0, entry).source, source);
  const updated = change('edit', 0, { ...entry, title: '修改的名称', date: '2025.02 - 2025.07', stack: '' });
  assert.ok(updated.source.startsWith(front)); assert.ok(updated.source.endsWith(second + tail));
  assert.match(updated.source, /# 日期备注/); assert.match(updated.source, /~~~yml/);
  assert.ok(updated.source.includes(entry.content));
  const parsed = parseResume(updated.source).document.sections[0].entries[0];
  assert.equal(parsed.date, '2025.02 - 2025.07'); assert.equal(parsed.stack, undefined);
  assert.deepEqual(parsed.blocks, parseResume(source).document.sections[0].entries[0].blocks);
});

test('CRLF and BOM sources survive no-op editing and targeted field changes', () => {
  const windows = '\uFEFF' + source.replace(/\n/g, '\r\n'), entry = listResumeEntries(windows)[0].entries[1];
  assert.equal(changeResumeEntry(windows, layout, { action: 'edit', sectionId: 'research', index: 1, input: { ...entry, content: entry.content.replace(/\r\n/g, '\n') } }).source, windows);
  const result = changeResumeEntry(windows, layout, { action: 'edit', sectionId: 'research', index: 1, input: { ...entry, title: '新标题' } });
  assert.equal(result.source, windows.replace('### 同名经历\r\n\r\n```yaml', '### 新标题\r\n\r\n```yaml'));
});

test('copy and sorting address duplicate titles by index and preserve every content block', () => {
  const original = parseResume(source).document.sections[0].entries;
  const copied = change('duplicate').source;
  assert.deepEqual(parseResume(copied).document.sections[0].entries, [original[0], original[0], original[1]]);
  assert.ok(copied.endsWith(tail));
  const down = change('down').source, up = change('up', 1).source;
  assert.equal(down, up); assert.deepEqual(parseResume(down).document.sections[0].entries, [original[1], original[0]]);
  assert.ok(down.endsWith(tail));
  const end = `${front}\n\n## 经历 {#research .entries}\n\n${first}\n\n${second}`;
  for (const action of ['duplicate', 'up']) {
    const moved = changeResumeEntry(end, {}, { action, sectionId: 'research', index: 1 });
    assert.equal(parseResume(moved.source).document.sections[0].entries.length, action === 'duplicate' ? 3 : 2);
  }
});

test('deleting the last section entry removes the chapter and its explicit ordering ID', () => {
  const removed = change('delete'); assert.ok(removed.source.includes(second)); assert.ok(!removed.source.includes('普通段落'));
  const last = changeResumeEntry(removed.source, removed.layout, { action: 'delete', sectionId: 'research', index: 0 });
  assert.equal(last.source, front + '\n\n' + tail.replace(/^\n\n/, ''));
  assert.deepEqual(last.layout.sectionOrder, ['additional']); assert.deepEqual(layout.sectionOrder, ['research', 'additional']);
  const only = `${front}\n\n## 经历 {#research .entries}\n\n${second}`;
  assert.throws(() => changeResumeEntry(only, {}, { action: 'delete', sectionId: 'research', index: 0 }), /至少保留一个章节/);
});

test('edited body retains paragraphs and numbered lists and rejects injected entries or invalid Markdown', () => {
  const entry = listResumeEntries(source)[0].entries[1];
  const updated = change('edit', 1, { ...entry, content: '开头段落。\n\n1. **第一项**\n2. [文档](https://example.com)\n\n结尾段落。' });
  const blocks = parseResume(updated.source).document.sections[0].entries[1].blocks;
  assert.deepEqual(blocks.map(block => block.type), ['paragraph', 'list', 'paragraph']); assert.equal(blocks[1].ordered, true);
  assert.throws(() => change('edit', 1, { ...entry, content: entry.content + '\n\n' + second }), /不要添加章节或经历标题/);
  assert.throws(() => change('edit', 1, { ...entry, content: '> 不支持的结构' }), /不支持/);
  assert.throws(() => change('edit', 1, { ...entry, date: '' }), /时间/);
  assert.throws(() => change('up', 0), /第一条/); assert.throws(() => change('down', 1), /最后一条/);
  assert.throws(() => change('edit', 4, entry), error => error.code === 'CONFLICT');
  assert.throws(() => listResumeEntries(source + '\n```yaml\n'), /不支持/);
});
