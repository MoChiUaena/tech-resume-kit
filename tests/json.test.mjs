import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { loadResume, parseResumeJson, loadResumeJson, renderResume, initializeProject, ResumeError } from '../src/index.mjs';
import { kitRoot } from '../src/render.mjs';
const exec = promisify(execFile), cli = path.join(kitRoot, 'src/cli.mjs');

test('strict JSON keeps the Markdown model and reports duplicate fields and source locations', async () => {
  const loaded = await loadResume(path.join(kitRoot, 'resume.md'));
  const source = JSON.stringify({ document: loaded.document, layout: loaded.layout }, null, 2);
  const json = parseResumeJson('\uFEFF' + source, '输入.json');
  assert.deepEqual(json.document, loaded.document); assert.deepEqual(json.layout, loaded.layout);
  const bad = JSON.parse(source); bad.layout.bodyPt = 9;
  assert.throws(() => parseResumeJson(JSON.stringify(bad, null, 2), '输入.json'), error => error instanceof ResumeError && error.field === 'layout.bodyPt' && error.line > 1 && error.file === '输入.json');
  assert.throws(() => parseResumeJson('{\n"document": {},\n"document": {}\n}'), error => error.code === 'JSON' && error.line === 3 && error.field === 'document');
  for (const text of ['{"document":{},}', '// comment\n{}', '', '{} {}']) assert.throws(() => parseResumeJson(text), error => error.code === 'JSON');
  assert.throws(() => parseResumeJson('{"schemaVersion":2,"content":{}}'), error => error.code === 'MODEL');
  bad.layout.bodyPt = 10.5; bad.document.person.contacts[0].href = 'javascript:alert(1)';
  assert.throws(() => parseResumeJson(JSON.stringify(bad)), /链接只支持/);
});

test('JSON export rebases images; machine CLI results and failures preserve the previous PDF', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'tech-resume-json-'));
  t.after(async () => { const actual = await realpath(root); assert.ok(actual.startsWith(path.join(await realpath(tmpdir()), 'tech-resume-json-'))); await rm(actual, { recursive: true, force: true }); });
  const project = await initializeProject(path.join(root, '我的 简历'));
  const file = path.join(project, '交换 数据', 'resume.json'), output = path.join(root, '我的 输出.pdf');
  const exported = await exec(process.execPath, [cli, 'export-json', path.join(project, 'resume.md'), '--out', file, '--json'], { windowsHide: true });
  assert.equal(JSON.parse(exported.stdout).ok, true); assert.equal(exported.stderr, '');
  const loaded = await loadResumeJson(file);
  assert.match(loaded.document.assets.portrait.src, /^\.\.\/assets\//);
  assert.equal(Object.keys((await renderResume(loaded.document, loaded.layout, loaded)).images).length, 2);
  const result = await exec(process.execPath, [cli, 'build-json', file, '--out', output, '--json'], { windowsHide: true });
  const built = JSON.parse(result.stdout); assert.equal(built.metrics.pageCount, 1); assert.equal(built.metrics.offline, true); assert.equal(result.stderr, '');
  const original = await readFile(output);
  await assert.rejects(exec(process.execPath, [cli, 'build-json', file, '--out', output, '--json'], { windowsHide: true }), error => error.code === 1 && JSON.parse(error.stdout).error.code === 'EXISTS' && error.stderr === '');
  await writeFile(file, '{"schemaVersion":2}');
  await assert.rejects(exec(process.execPath, [cli, 'build-json', file, '--out', output, '--force', '--json'], { windowsHide: true }), error => JSON.parse(error.stdout).error.code === 'MODEL');
  assert.deepEqual(await readFile(output), original);
  await assert.rejects(exec(process.execPath, [cli, 'check-json', '--json'], { windowsHide: true }), error => JSON.parse(error.stdout).error.code === 'CLI');
});
