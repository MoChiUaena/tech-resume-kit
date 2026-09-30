import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { listResumeContent, changeResumeContent, renameResumeSectionTitle } from '../src/content.mjs';
import { parseResume } from '../src/input.mjs';
import { kitRoot } from '../src/render.mjs';
import { insertResumeEntry } from '../app/entries.mjs';
const sample = await readFile(path.join(kitRoot, 'templates/blank/resume.md'), 'utf8');
const front = sample.slice(0, sample.indexOf('\n---', 4) + 4);
const skills = '## 专业能力 {#custom-skills .skills}\n\n* **Java**: 熟悉 **并发**，参考 [文档](https://example.com)。\n  使用线程池。\n\n- **Java**：另一项同名技能。\n';
const lines = '## 其他 {#other .lines}\n\n开头段落。\n\n3. 第三项\n4. 第四项\n\n结尾 **说明**。\n';
const source = front + '\n\n' + skills + '\n' + lines;
const layout = { sectionOrder: ['other', 'custom-skills'], preset: 'campus' };
const change = (action, index, input) => changeResumeContent(source, layout, { kind: 'skills', action, sectionId: 'custom-skills', index, input });

test('skills and additional forms list custom sections and preserve unchanged CRLF/BOM Markdown', () => {
  const listed = listResumeContent(source);
  assert.equal(listed[0].id, 'custom-skills'); assert.equal(listed[0].items.length, 2);
  assert.equal(listed[1].content, lines.slice(lines.indexOf('开头')).trimEnd());
  assert.equal(change('edit', 0, listed[0].items[0]).source, source);
  const windows = '\uFEFF' + source.replace(/\n/g, '\r\n'), original = listResumeContent(windows);
  assert.equal(changeResumeContent(windows, layout, { kind: 'skills', action: 'edit', sectionId: 'custom-skills', index: 0, input: original[0].items[0] }).source, windows);
  assert.equal(changeResumeContent(windows, layout, { kind: 'lines', action: 'edit', sectionId: 'other', input: { content: original[1].content } }).source, windows);
  const renamed = changeResumeContent(windows, layout, { kind: 'lines', action: 'edit', sectionId: 'other', input: { title: '开源贡献', content: original[1].content } });
  assert.equal(renamed.source, windows.replace('## 其他 {#other .lines}', '## 开源贡献 {#other .lines}'));
  assert.deepEqual(renamed.layout.sectionOrder, layout.sectionOrder);
  assert.equal(parseResume(renamed.source).document.sections[1].title, '开源贡献');
});

test('section title editing changes only the heading text across section kinds and line endings', async () => {
  const campus = await readFile(path.join(kitRoot, 'resume.md'), 'utf8');
  const campusLayout = { preset: 'campus', sectionOrder: ['education', 'skills', 'internship', 'projects', 'additional'] };
  const renamedEducation = renameResumeSectionTitle(campus, campusLayout, { sectionId: 'education', title: '求学经历' });
  assert.equal(renamedEducation.source, campus.replace('## 教育背景 {#education .entries}', '## 求学经历 {#education .entries}'));
  assert.deepEqual(renamedEducation.layout, campusLayout);
  assert.equal(parseResume(renamedEducation.source).document.sections.find(section => section.id === 'education').title, '求学经历');
  const renamedSkills = renameResumeSectionTitle(campus, campusLayout, { sectionId: 'skills', title: '技术能力' });
  assert.equal(renamedSkills.source, campus.replace('## 专业技能 {#skills .skills}', '## 技术能力 {#skills .skills}'));
  const windows = '\uFEFF' + source.replace('## 其他 {#other .lines}', '## 其他  {#other .lines}  ').replace(/\n/g, '\r\n');
  const renamedLines = renameResumeSectionTitle(windows, layout, { sectionId: 'other', title: '开源贡献' });
  assert.equal(renamedLines.source, windows.replace('## 其他  {#other .lines}  ', '## 开源贡献  {#other .lines}  '));
  assert.deepEqual(renamedLines.layout, layout);
  assert.equal(renameResumeSectionTitle(windows, layout, { sectionId: 'other', title: '其他' }).source, windows);
  assert.throws(() => renameResumeSectionTitle(source, layout, { sectionId: 'other', title: ' ' }), /章节名称/);
  assert.throws(() => renameResumeSectionTitle(source, layout, { sectionId: 'missing', title: '新标题' }), error => error.code === 'CONFLICT');
});

test('skill editing, copying, sorting and adding preserve the rest of the original source', () => {
  const edited = change('edit', 1, { label: 'C++', text: '使用 **标准库** 与 [文档](https://example.com/cpp)。' });
  assert.ok(edited.source.startsWith(front + '\n\n' + skills.slice(0, skills.indexOf('- **Java**'))));
  assert.ok(edited.source.endsWith('\n' + lines));
  const model = parseResume(source).document.sections[0].items;
  assert.deepEqual(parseResume(change('duplicate', 0).source).document.sections[0].items, [model[0], model[0], model[1]]);
  assert.deepEqual(parseResume(change('down', 0).source).document.sections[0].items, [model[1], model[0]]);
  assert.equal(change('down', 0).source, change('up', 1).source);
  const added = change('add', undefined, { label: 'AI 应用', text: '使用检索和工具调用。' });
  assert.equal(parseResume(added.source).document.sections[0].items.length, 3);
  assert.ok(added.source.endsWith(lines));
});

test('deletion and creation maintain all section IDs, explicit ordering and the final remaining chapter', () => {
  const one = change('delete', 0);
  const none = changeResumeContent(one.source, one.layout, { kind: 'skills', action: 'delete', sectionId: 'custom-skills', index: 0 });
  assert.deepEqual(none.layout.sectionOrder, ['other']); assert.ok(none.source.endsWith(lines));
  assert.throws(() => changeResumeContent(none.source, none.layout, { kind: 'lines', action: 'delete', sectionId: 'other' }), /至少保留一个章节/);
  const added = changeResumeContent(none.source, none.layout, { kind: 'skills', action: 'add', input: { label: 'Java', text: '填写能力。' } });
  assert.deepEqual(added.layout.sectionOrder, ['skills', 'other']);
  const extra = changeResumeContent(source, layout, { kind: 'lines', action: 'add', input: { title: '开源贡献', content: '参与接口和测试。' } });
  assert.equal(parseResume(extra.source).document.sections.at(-1).title, '开源贡献');
  assert.equal(extra.layout.sectionOrder.length, 3);
});

test('additional content keeps mixed paragraphs and ordered lists and rejects structural injections', () => {
  const content = '更新后的开头。\n\n3. **第三项**\n4. [第四项](https://example.com)\n\n结尾段落。';
  const updated = changeResumeContent(source, layout, { kind: 'lines', action: 'edit', sectionId: 'other', input: { content } });
  assert.ok(updated.source.startsWith(source.slice(0, source.indexOf('## 其他'))));
  assert.deepEqual(parseResume(updated.source).document.sections[1].blocks.map(block => block.type), ['paragraph','list','paragraph']);
  const renamed = changeResumeContent(source, layout, { kind: 'lines', action: 'edit', sectionId: 'other', input: { title: '开源贡献', content } });
  assert.equal(parseResume(renamed.source).document.sections[1].title, '开源贡献');
  assert.deepEqual(parseResume(renamed.source).document.sections[1].blocks, parseResume(updated.source).document.sections[1].blocks);
  assert.throws(() => changeResumeContent(source, layout, { kind: 'lines', action: 'edit', sectionId: 'other', input: { title: ' ', content } }), /章节名称/);
  assert.throws(() => changeResumeContent(source, layout, { kind: 'lines', action: 'edit', sectionId: 'other', input: { content: content + '\n\n## 偷加章节 {#injected .lines}\n\n内容' } }), /不应添加章节标题/);
  assert.throws(() => change('edit', 0, { label: 'Java', text: '文字\n\n- **新增**：绕过表单' }), /其他条目|嵌套|普通段落|不支持/);
  assert.throws(() => change('edit', 0, { label: 'Java', text: '<img src=x>' }), /HTML/);
  assert.throws(() => change('up', 0), /第一项/);
  assert.throws(() => change('edit', 99, {}), error => error.code === 'CONFLICT');
});

test('working experience is added from the same form conventions and preserves existing body order', () => {
  const inserted = insertResumeEntry(source.slice(front.length), { kind: 'work', title: '示例团队', subtitle: '后端开发', date: '2024.06 - 至今', details: '设计服务接口。' });
  const model = parseResume(front + '\n' + inserted.body).document;
  assert.equal(model.sections.find(section => section.id === 'experience').entries[0].subtitle, '后端开发');
});
