import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadResume } from '../src/input.mjs';
import { renderResume, kitRoot } from '../src/render.mjs';
import { inspectAndExport } from '../src/export.mjs';
import { pdfExpectations } from './pdf-expectations.mjs';

const output = path.join(kitRoot, 'tmp/pdfs/boundary');
await mkdir(output, { recursive: true });
const main = await loadResume(path.join(kitRoot, 'resume.md'));
const short = await loadResume(path.join(kitRoot, 'templates/blank/resume.md'));
const mainCase = (stem, pages = 1) => ({ stem, pages, document: structuredClone(main.document), layout: structuredClone(main.layout), assetBase: main.assetBase });
const isolated = stem => {
  const test = mainCase(stem, 2);
  test.document.assets = {};
  test.layout.images.schoolLogo.enabled = false;
  test.layout.images.portrait.enabled = false;
  test.layout.page.maxPages = 2;
  test.document.notice = '边界验证 · 合成内容，不代表真实求职经历。';
  test.document.sections = [];
  delete test.layout.sectionOrder;
  return test;
};
const cases = [];
const logo = mainCase('logo-only'); logo.layout.images.portrait.enabled = false; cases.push(logo);
const photo = mainCase('photo-only'); photo.layout.images.schoolLogo.enabled = false; photo.layout.images.portrait.slot = 'end'; cases.push(photo);
const none = mainCase('no-images'); none.layout.images.schoolLogo.enabled = false; none.layout.images.portrait.enabled = false; cases.push(none);
cases.push({ stem: 'short-content', pages: 1, ...short });
const oriented = mainCase('oriented-photo'); oriented.document.assets.portrait.src = 'tests/fixtures/portrait-orientation-6.jpg'; cases.push(oriented);

const long = mainCase('long-title-link', 2);
long.layout.page.maxPages = 2;
const longEntry = long.document.sections.find(section => section.id === 'projects').entries[0];
longEntry.title = 'CampusHub 多租户校园活动预约与 Java/C++ 混合服务协作平台的跨系统消息补偿、配额控制和可追踪任务管理模块';
const url = 'https://example.com/projects/campushub/' + 'JavaCppSpringBootTaskRecovery'.repeat(6) + '/evaluation?scenario=200concurrent&documentVersion=202609';
longEntry.blocks.push({ type: 'paragraph', text: `评测记录：[${url}](${url})。以上 Java、C++、Spring Boot 与链接字符均须完整保留。` });
cases.push(long);

const entry = isolated('oversized-entry');
entry.document.sections = [{ id: 'projects', title: '超长项目验证', kind: 'entries', entries: [{ title: '一个允许跨页继续的完整项目', date: '2024.03 - 2026.09', subtitle: '后端负责人', stack: 'Java · C++ · Spring Boot', blocks: [{ type: 'list', ordered: true, start: 1, items: Array.from({ length: 36 }, (_, i) => `验证条目 ${String(i + 1).padStart(2, '0')}：基于 Java、C++ 和 Spring Boot 实现重试、幂等与可追踪恢复，并记录测试条件、失败原因与修复结果。`) }] }] }];
entry.extra = { firstPageMinimumBottomPt: 740 };
cases.push(entry);

const paragraph = isolated('oversized-paragraph');
const paragraphText = Array.from({ length: 60 }, (_, i) => `段落位置 ${String(i + 1).padStart(2, '0')}：这是连续段落中的分页验证文字，要求中文、技术术语和前后顺序在跨页后完整保留。`).join('');
paragraph.document.sections = [{ id: 'additional', title: '单个超长段落验证', kind: 'lines', blocks: [{ type: 'paragraph', text: paragraphText }] }];
paragraph.extra = { mustSpanPages: [paragraphText], firstPageMinimumBottomPt: 740 };
cases.push(paragraph);

const heading = isolated('heading-boundary');
heading.layout.sectionOrder = ['before', 'projects'];
heading.document.sections = [
  { id: 'before', title: '前序内容', kind: 'lines', blocks: Array.from({ length: 36 }, (_, i) => ({ type: 'paragraph', text: `前序内容 ${String(i + 1).padStart(2, '0')}：用于验证页尾空间变化时，后续标题仍与首段保持在同一页。` })) },
  { id: 'projects', title: '不能落单的章节标题', kind: 'entries', entries: [{ title: '不能与首段分开的项目标题', date: '2026.01 - 2026.09', subtitle: '边界验证', stack: 'Java · Spring Boot', blocks: [{ type: 'paragraph', text: '首段锚点：章节标题、项目标题与这段正文必须位于同一页，不能把标题单独遗留在上一页末尾。' }, { type: 'list', ordered: false, items: ['这一项验证标题之后的连续阅读。', '这一项验证后续列表仍然完整。'] }] }] },
];
heading.extra = { firstPageMinimumBottomPt: 730 };
cases.push(heading);

const results = [];
for (const test of cases) {
  const rendered = await renderResume(test.document, test.layout, { assetBase: test.assetBase });
  const { buffer, metrics } = await inspectAndExport(rendered, { pdf: true });
  assert.equal(metrics.pageCount, test.pages, `${test.stem}: unexpected page count`);
  const expected = { ...pdfExpectations(rendered, test.pages), ...test.extra };
  for (const [extension, value] of [['pdf', buffer], ['expected.json', JSON.stringify(expected, null, 2) + '\n'], ['metrics.json', JSON.stringify(metrics, null, 2) + '\n']]) await writeFile(path.join(output, `${test.stem}.${extension}`), value);
  results.push({ case: test.stem, pages: metrics.pageCount, imageCount: metrics.images.length, textFields: expected.fields.length, headings: expected.headings.length, result: 'passed' });
  console.log(`${test.stem}: ${metrics.pageCount} 页，${metrics.images.length} 张图片，待 PDF 文本/视觉复核。`);
}

const overflow = structuredClone(entry);
overflow.document.sections[0].entries[0].blocks[0].items.push(...Array(110).fill('额外内容：每个测试项目都需要保留，不能通过裁切或自动缩小字号隐藏超过两页的问题。'));
await assert.rejects(inspectAndExport(await renderResume(overflow.document, overflow.layout)), error => error.code === 'OVERFLOW' && /超出2 页上限/.test(error.message));
results.push({ case: 'over-two-pages', result: 'rejected-as-expected' });
const largeHeader = structuredClone(none);
largeHeader.document.person.name = '过长姓名'.repeat(300);
await assert.rejects(inspectAndExport(await renderResume(largeHeader.document, largeHeader.layout)), error => error.code === 'LAYOUT' && /页眉或标题过长/.test(error.message));
results.push({ case: 'oversized-header', result: 'rejected-as-expected' });
await writeFile(path.join(output, 'summary.json'), JSON.stringify(results, null, 2) + '\n');
console.log('边界构建通过。请继续运行 verify-pdf.py --directory tmp/pdfs/boundary，并渲染所有页面做视觉检查。');
