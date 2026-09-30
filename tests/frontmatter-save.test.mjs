import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { initializeProject } from '../src/files.mjs';
import { openProject } from '../src/project.mjs';
import { parseResume } from '../src/input.mjs';
import { kitRoot } from '../src/render.mjs';
import { pdfExpectations } from '../scripts/pdf-expectations.mjs';

test('form saves preserve annotated front matter, original body and CRLF while updating fields and assets', async t => {
  const outer = await mkdtemp(path.join(tmpdir(), 'tech-resume-frontmatter-')), directory = path.join(outer, '简历');
  await initializeProject(directory, 'campus');
  t.after(async () => {
    const actual = await realpath(outer);
    assert.ok(actual.startsWith(path.join(await realpath(tmpdir()), 'tech-resume-frontmatter-')));
    await rm(actual, { recursive: true, force: true, maxRetries: 3 });
  });
  const sourceFile = path.join(directory, 'resume.md'), original = await readFile(sourceFile, 'utf8');
  const annotated = '\uFEFF' + original.replace(/\r?\n/g, '\r\n')
    .replace('schemaVersion: 0.2.0', 'schemaVersion: 0.2.0 # 版本备注')
    .replace('  name: 奶龙', '  # 姓名备注\r\n  name: "奶龙" # 显示备注')
    .replace('href: mailto:zhixia.lin@example.com', 'href: mailto:zhixia.lin@example.com # 邮箱备注')
    .replace('src: assets/images/chengchuan-logo.png', 'src: assets/images/chengchuan-logo.png # 校徽备注');
  await writeFile(sourceFile, annotated);
  const project = await openProject(directory), initial = await project.read();
  const originalImages = Object.fromEntries(await Promise.all(Object.entries(initial.front.assets).map(async ([key, asset]) => [key, await readFile(path.join(directory, asset.src))])));
  const front = structuredClone(initial.front); front.person.name = '示例名';
  let saved = await project.save({ revision: initial.revision, front, body: initial.body.replace(/\r\n/g, '\n'), layout: initial.layout });
  assert.ok(saved.source.startsWith('\uFEFF---\r\n'));
  for (const note of ['版本备注', '姓名备注', '显示备注', '邮箱备注', '校徽备注']) assert.ok(saved.source.includes(note), note);
  assert.equal(saved.body, initial.body);
  assert.ok(!/(?<!\r)\n/.test(saved.source), 'Original CRLF line endings should remain intact');
  assert.equal(parseResume(saved.source).document.person.name, '示例名');
  await assert.rejects(project.save({ revision: initial.revision, front, body: initial.body, layout: initial.layout }), error => error.code === 'CONFLICT');

  const preview = await project.preview(); assert.equal(preview.metrics.pageCount, 1);
  assert.equal(preview.metrics.images.length, 2);
  const qa = path.join(kitRoot, 'tmp/pdfs/frontmatter-save'); await mkdir(qa, { recursive: true });
  await writeFile(path.join(qa, 'annotated-campus.pdf'), preview.buffer);
  await writeFile(path.join(qa, 'annotated-campus.expected.json'), JSON.stringify(pdfExpectations({ ...preview, images: { portrait: true, schoolLogo: true } }, 1)));

  const layout = structuredClone(saved.layout); layout.page.marginMm = 16;
  let next = await project.save({ revision: saved.revision, front: structuredClone(saved.front), body: saved.body.replace(/\r\n/g, '\n'), layout });
  assert.equal(next.source, saved.source, 'A layout-only change must not rewrite resume.md');
  saved = next;
  next = await project.save({ revision: saved.revision, front: structuredClone(saved.front), body: saved.body.replace(/\r\n/g, '\n').replace('### 澄川理工大学', '### 校名示例'), layout: saved.layout });
  assert.ok(next.source.startsWith(saved.source.slice(0, saved.source.indexOf('## 教育背景'))));
  assert.ok(next.body.includes('### 校名示例'));
  assert.ok(!/(?<!\r)\n/.test(next.source));
  saved = next;

  const expanded = structuredClone(saved.front);
  expanded.person.contacts.push({ text: '项目主页', href: 'https://example.com/project' });
  expanded.assets.schoolLogo.alt = '示例学校 Logo';
  next = await project.save({ revision: saved.revision, front: expanded, body: saved.body.replace(/\r\n/g, '\n'), layout: saved.layout });
  for (const note of ['版本备注', '姓名备注', '显示备注', '邮箱备注', '校徽备注']) assert.ok(next.source.includes(note), note);
  assert.ok(next.source.includes('https://example.com/project'));
  assert.equal(next.front.assets.schoolLogo.alt, '示例学校 Logo');
  assert.equal(next.body, saved.body);
  for (const [key, asset] of Object.entries(next.front.assets)) assert.deepEqual(await readFile(path.join(directory, asset.src)), originalImages[key]);
  expanded.person.contacts.pop();
  const reduced = await project.save({ revision: next.revision, front: expanded, body: next.body.replace(/\r\n/g, '\n'), layout: next.layout });
  assert.equal(reduced.front.person.contacts.length, initial.front.person.contacts.length);
  assert.ok(reduced.source.includes('邮箱备注'));
});
