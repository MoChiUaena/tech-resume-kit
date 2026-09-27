import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseResume, readYaml, loadResume } from '../src/input.mjs';
import { validate, layoutSchema, resolveSectionOrder } from '../src/schema.mjs';
import { inline } from '../src/markdown.mjs';

const source = await readFile(new URL('../resume.md', import.meta.url), 'utf8');

test('Markdown retains every field of the reviewed phase A document', async () => {
  const original = JSON.parse(await readFile(new URL('../examples/campus.resume.json', import.meta.url), 'utf8'));
  original.schemaVersion = '0.2.0';
  for (const section of original.sections) {
    if (section.kind === 'entries') for (const entry of section.entries) {
      entry.blocks = (entry.lines || []).map(text => ({ type: 'paragraph', text }));
      if (entry.bullets) entry.blocks.push({ type: 'list', ordered: false, items: entry.bullets });
      delete entry.lines; delete entry.bullets;
    }
    if (section.kind === 'lines') { section.blocks = section.lines.map(text => ({ type: 'paragraph', text })); delete section.lines; }
  }
  assert.deepEqual(parseResume(source).document, original);
});

test('entry metadata errors name the source file, field and line', () => {
  const wrong = source.replace('date: 2026.06 - 2026.09', 'date: 123');
  assert.notEqual(wrong, source);
  const line = wrong.split('\n').findIndex(line => line === 'date: 123') + 1;
  assert.throws(() => parseResume(wrong, 'my-resume.md'), error => error.file === 'my-resume.md' && error.line === line && error.field === 'sections.2.entries.0.date');
});

test('YAML duplicate keys, aliases and unknown settings are explicit errors', () => {
  assert.throws(() => readYaml('x: 1\nx: 2', 'layout.yaml'), /YAML 格式错误/);
  assert.throws(() => readYaml('x: &a hi\ny: *a', 'layout.yaml'), /锚点/);
  const locations = new Map();
  const data = readYaml('schemaVersion: 0.2.0\nbodyPt: 9\n', 'layout.yaml', 0, locations);
  assert.throws(() => validate(layoutSchema, data, locations), error => error.file === 'layout.yaml' && error.line === 2 && error.field === 'bodyPt');
  assert.throws(() => validate(layoutSchema, { schemaVersion: '0.2.0', bodyFontSize: 11 }, new Map()), /不支持的字段/);
});

test('section IDs and explicit order cannot silently drop content', async () => {
  assert.throws(() => parseResume(source.replace('{#projects .entries}', '{#education .entries}')), /ID 重复/);
  const { document, layout } = await loadResume(fileURLToPath(new URL('../resume.md', import.meta.url)));
  assert.throws(() => resolveSectionOrder(document, { ...layout, sectionOrder: ['skills'] }), /全部章节/);
  delete layout.sectionOrder;
  layout.preset = 'experience';
  const order = resolveSectionOrder(document, layout);
  assert.equal(order[0], 'skills');
  assert.deepEqual(new Set(order), new Set(document.sections.map(section => section.id)));
});

test('paragraphs after lists retain their reading order', () => {
  const changed = source.replace('## 荣誉与其他 {#additional .lines}', '## 荣誉与其他 {#additional .lines}\n\n1. 第一步\n2. 第二步\n\n完成后查看[说明](https://example.com/guide)。');
  const blocks = parseResume(changed).document.sections.at(-1).blocks;
  assert.equal(blocks[0].type, 'list');
  assert.equal(blocks[0].ordered, true);
  assert.equal(blocks[1].text, '完成后查看[说明](https://example.com/guide)。');
});

test('unsupported nesting, raw HTML, inline images and active links are rejected', () => {
  assert.throws(() => parseResume(source.replace('GPA **3.72 / 4.00**', '<img src="https://example.com/a.png"> GPA **3.72 / 4.00**')), /HTML/);
  assert.throws(() => inline('![photo](https://example.com/photo.png)'), /图片/);
  assert.throws(() => inline('[打开](javascript:alert%281%29)'), /链接/);
  assert.throws(() => parseResume(source + '\n- 一级\n  - 二级\n'), /嵌套/);
  assert.throws(() => parseResume(source + '\n\n[参考][ref]\n\n[ref]: https://example.com\n'), /引用式链接/);
  assert.match(inline('使用 **Java** 与 [文档](https://example.com)'), /<strong>Java<\/strong>/);
  assert.match(inline('使用 [文档](https://example.com)'), /href="https:\/\/example.com"/);
});
