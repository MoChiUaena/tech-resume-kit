import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { convertWorkbenchResume, loadWorkbenchResume, parseResumeJson, loadResumeJson, renderResume, inspectAndExport } from '../src/index.mjs';
import { kitRoot } from '../src/render.mjs';
import { markdown } from '../src/markdown.mjs';
import { pdfExpectations } from '../scripts/pdf-expectations.mjs';

const exec = promisify(execFile), cli = path.join(kitRoot, 'src/cli.mjs');
const file = path.join(kitRoot, 'examples/workbench/resume.json'), optionsFile = path.join(kitRoot, 'examples/workbench/conversion.json');
const fixture = async () => ({ input: JSON.parse(await readFile(file, 'utf8')), options: JSON.parse(await readFile(optionsFile, 'utf8')) });

test('workbench 2/3/4 conversion preserves IDs in the report, metadata, order, literal text and bold without changing inputs', async () => {
  const { input, options } = await fixture(), original = structuredClone(input), originalOptions = structuredClone(options);
  const converted = convertWorkbenchResume(input, options);
  assert.deepEqual(input, original); assert.deepEqual(options, originalOptions);
  assert.equal(converted.document.person.name, '奶龙'); assert.equal(converted.document.person.label, input.content.location);
  assert.equal(converted.document.person.contacts[0].text, input.content.phone);
  assert.equal(converted.document.person.contacts[0].href, 'tel:13800000000');
  assert.deepEqual(converted.document.sections.map(section => section.title), input.content.sections.map(section => section.title));
  assert.equal(converted.document.sections[3].entries[0].subtitle, input.content.sections[3].entries[0].meta);
  assert.equal(converted.document.sections[1].entries[0].date, undefined);
  assert.equal(converted.report.sections[0].sourceId, input.content.sections[0].id);
  assert.equal(converted.report.sections[0].entryIds[0], 'education-entry');
  assert.deepEqual(converted.layout.sectionOrder, converted.document.sections.map(section => section.id));
  input.content.sections[0].entries[0].bullets = ['**重点 C++ / Spring Boot**；<img src=x onerror=alert(1)> &amp; _斜体_ `code` [链接](https://example.invalid) \\。'];
  const result = convertWorkbenchResume(input, options), text = result.document.sections[0].entries[0].blocks[0].items[0];
  const children = markdown.parseInline(text, {})[0].children;
  assert.equal(children.filter(token => token.type === 'strong_open').length, 1);
  assert.ok(!children.some(token => ['link_open', 'html_inline', 'code_inline', 'em_open', 'image'].includes(token.type)));
  assert.equal(children.filter(token => token.type === 'text').map(token => token.content).join(''), input.content.sections[0].entries[0].bullets[0].replace('**重点 C++ / Spring Boot**', '重点 C++ / Spring Boot'));
  for (const [source, plain] of [['**Java / Spring Boot：**熟悉', 'Java / Spring Boot：熟悉'], ['前**（后端）**后', '前（后端）后'], ['**A****B**', 'AB'], ['**  A  **', '  A  '], ['**<>**x', '<>x'], ['a**x**b', 'axb']]) {
    input.content.sections[0].entries[0].bullets = [source];
    const tokens = markdown.parseInline(convertWorkbenchResume(input, options).document.sections[0].entries[0].blocks[0].items[0], {})[0].children;
    assert.equal(tokens.filter(token => token.type === 'strong_open').length, 1, source);
    // The model trims outer whitespace consistently with the existing input schema.
    assert.equal(tokens.filter(token => token.type === 'text').map(token => token.content).join('').trim(), plain.trim(), source);
  }
  for (const version of [2, 3, 4]) {
    const legacy = structuredClone(original); legacy.schemaVersion = version;
    if (version === 2) delete legacy.layout.presentation;
    assert.equal(convertWorkbenchResume(legacy, options).report.sourceSchemaVersion, version);
  }
});

test('conversion refuses guessing, missing assets, unprepared crops, unknown fields, duplicate IDs and incompatible models', async () => {
  const { input, options } = await fixture();
  assert.throws(() => convertWorkbenchResume(input, {}), error => error.field === 'layout');
  for (const version of [1, 5, '0.2.0']) assert.throws(() => convertWorkbenchResume({ ...input, schemaVersion: version }, options), error => error.code === 'CONVERSION');
  assert.throws(() => convertWorkbenchResume({ document: input }, options), /单份 document/);
  for (const version of [2, 3, 4, 5]) assert.throws(() => parseResumeJson(JSON.stringify({ ...input, schemaVersion: version })), error => error.code === 'MODEL');
  const missing = structuredClone(options); delete missing.assets.portrait;
  assert.throws(() => convertWorkbenchResume(input, missing), error => error.code === 'CONVERSION' && error.field === 'layout.photo.id');
  const wrong = structuredClone(options); wrong.assets.portrait.id = options.assets.schoolLogo.id;
  assert.throws(() => convertWorkbenchResume(input, wrong), /ID 与源数据不一致/);
  const cropped = structuredClone(input); cropped.layout.photo.zoom = 1.5;
  assert.throws(() => convertWorkbenchResume(cropped, options), /先将效果合成/);
  const prepared = structuredClone(options); prepared.assets.portrait.prepared = true;
  assert.equal(convertWorkbenchResume(cropped, prepared).layout.images.portrait.enabled, true);
  const external = structuredClone(options); external.assets.portrait.src = 'https://example.invalid/photo.jpg';
  assert.throws(() => convertWorkbenchResume(input, external), /本地相对路径/);
  const extra = structuredClone(input); extra.content.sections[0].privateNote = 'unknown';
  assert.throws(() => convertWorkbenchResume(extra, options), error => error.field.endsWith('privateNote'));
  const duplicate = structuredClone(input); duplicate.content.sections[1].id = duplicate.content.sections[0].id;
  assert.throws(() => convertWorkbenchResume(duplicate, options), /章节 ID 重复/);
  const noContact = structuredClone(input); noContact.content.email = ''; noContact.content.phone = '';
  assert.throws(() => convertWorkbenchResume(noContact, options), /至少填写电话或邮箱/);
});

test('hidden and empty content is reported; untitled entries remain literal paragraphs and page breaks require an explicit choice', async () => {
  const { input, options } = await fixture();
  input.content.sections[1].visible = false;
  input.content.sections[0].entries.push({ id: 'empty', title: '', meta: '', bulleted: true, bullets: [''] });
  input.content.sections[2].pageBreakBefore = true;
  assert.throws(() => convertWorkbenchResume(input, options), error => error.code === 'CONVERSION' && error.field.endsWith('pageBreakBefore'));
  options.pageBreaks = 'natural';
  const converted = convertWorkbenchResume(input, options);
  assert.equal(converted.document.sections.length, 4);
  assert.deepEqual(converted.report.omitted.map(value => value.reason), ['empty', 'hidden']);
  assert.ok(converted.warnings.some(value => value.includes('强制分页改为自然分页')));
  assert.equal(converted.document.sections.at(-1).kind, 'lines');
  const empty = structuredClone(input); empty.content.sections[0].entries = [];
  assert.throws(() => convertWorkbenchResume(empty, options), /没有内容/);
});

test('converted dual-image, image-free and two-page workbench samples generate offline PDFs with the same main style', async () => {
  const { input, options } = await fixture(), qa = path.join(kitRoot, 'tmp/pdfs/workbench');
  await mkdir(qa, { recursive: true });
  for (const [name, images, pages] of [['campus', true, 1], ['no-images', false, 1], ['two-page', false, 2]]) {
    const source = structuredClone(input), config = structuredClone(options);
    if (!images) {
      source.layout.photo.visible = false; source.layout.logo.visible = false;
      delete config.assets;
    }
    if (pages === 2) {
      config.layout.page.maxPages = 2;
      source.content.sections[3].entries[0].bullets.push(...Array.from({ length: 22 }, (_, i) => `工程细节 ${i + 1}：将接口、数据和页面分开维护，核对输入快照、错误处理、离线资源与导出结果。使用中文和 English 技术名词描述可复现的步骤，保留列表与段落顺序，并检查换行和页面边界。`));
    }
    const converted = convertWorkbenchResume(source, config);
    const rendered = await renderResume(converted.document, converted.layout, { assetBase: path.dirname(optionsFile) });
    const result = await inspectAndExport(rendered, { pdf: true });
    assert.equal(result.metrics.pageCount, pages); assert.equal(result.metrics.networkRequests.length, 0);
    assert.equal(result.metrics.images.length, images ? 2 : 0); assert.deepEqual(result.metrics.outOfBounds, []);
    if (images) {
      const portrait = result.metrics.images.find(image => image.asset === 'portrait'), logo = result.metrics.images.find(image => image.asset === 'schoolLogo');
      assert.ok(portrait.right <= result.metrics.identity.x + 1); assert.ok(logo.x >= result.metrics.identity.right - 1);
      assert.ok(Math.abs(portrait.width / portrait.height - 23 / 31) < 0.01);
    }
    await writeFile(path.join(qa, `${name}.pdf`), result.buffer);
    await writeFile(path.join(qa, `${name}.expected.json`), JSON.stringify(pdfExpectations(rendered, pages), null, 2));
  }
});

test('conversion CLI rebases assets outside the checkout, reports JSON locations and never overwrites the source or a good output on failure', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'tech-resume-workbench-'));
  t.after(async () => { const actual = await realpath(root); assert.ok(actual.startsWith(path.join(await realpath(tmpdir()), 'tech-resume-workbench-'))); await rm(actual, { recursive: true, force: true }); });
  const original = await readFile(file), source = path.join(root, '工作台 数据.json'), configured = path.join(root, '转换选项.json');
  const { options } = await fixture();
  const assetBase = path.dirname(optionsFile);
  await writeFile(source, original); await writeFile(configured, JSON.stringify(options, null, 2));
  const target = path.join(root, '交换 数据/resume.json');
  const args = [cli, 'convert-workbench', source, '--options', configured, '--assets', assetBase, '--out', target, '--json'];
  const converted = JSON.parse((await exec(process.execPath, args, { windowsHide: true })).stdout);
  assert.equal(converted.ok, true); assert.equal(converted.conversion.sourceSchemaVersion, 4);
  assert.deepEqual(await readFile(source), original);
  const loaded = await loadResumeJson(target);
  assert.equal(Object.keys((await renderResume(loaded.document, loaded.layout, loaded)).images).length, 2);
  const before = await readFile(target);
  await writeFile(configured, '{\n"layout": {},\n"layout": {}\n}');
  await assert.rejects(exec(process.execPath, [...args, '--force'], { windowsHide: true }), error => error.code === 1 && JSON.parse(error.stdout).error.code === 'JSON' && JSON.parse(error.stdout).error.line === 3 && error.stderr === '');
  assert.deepEqual(await readFile(target), before);
  await assert.rejects(exec(process.execPath, [cli, 'convert-workbench', source, '--options', configured, '--out', source, '--force', '--json'], { windowsHide: true }), error => JSON.parse(error.stdout).error.code === 'CLI');
  assert.deepEqual(await readFile(source), original);
  const loadedSource = await loadWorkbenchResume(file, undefined, { optionsFile });
  assert.equal(loadedSource.assetBase, path.dirname(optionsFile));
});
