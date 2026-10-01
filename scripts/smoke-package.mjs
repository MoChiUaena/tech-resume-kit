import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { pdfExpectations } from './pdf-expectations.mjs';
import { chromium } from 'playwright';
const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const packages = path.join(root, 'tmp/packages'), qa = path.join(root, 'tmp/pdfs/install');
const outside = await mkdtemp(path.join(tmpdir(), 'tech-resume-安装 验证-'));
const npmCli = process.env.npm_execpath;
assert.ok(npmCli?.endsWith('.js'), 'Run this with npm run test:package');
const run = (binary, args, options = {}) => exec(binary, args, { cwd: outside, windowsHide: true, maxBuffer: 2_000_000, timeout: 180_000, ...options });
let preview;
try {
  await mkdir(qa, { recursive: true });
  await writeFile(path.join(outside, 'package.json'), '{"private":true,"type":"module"}\n');
  await run(process.execPath, [npmCli, 'install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', path.join(packages, `tech-resume-kit-${pkg.version}.tgz`)]);
  const installed = path.join(outside, 'node_modules/tech-resume-kit');
  const cli = path.join(installed, 'src/cli.mjs');
  const help = await run(process.execPath, [npmCli, 'exec', '--offline', '--no', '--', 'tech-resume', '--help']);
  assert.match(help.stdout, /build-json/);
  await writeFile(path.join(outside, 'probe.mjs'), `
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { initializeProject, loadResume, loadWorkbenchResume, renderResume, inspectAndExport } from 'tech-resume-kit';
for (const [template, pages] of [['campus',1],['blank',1],['experience',2]]) {
  await initializeProject(template, template);
  const loaded = await loadResume(template + '/resume.md');
  const rendered = await renderResume(loaded.document, loaded.layout, loaded);
  const result = await inspectAndExport(rendered, { pdf: true });
  assert.equal(result.metrics.pageCount, pages);
  assert.equal(Buffer.from(result.buffer).subarray(0,5).toString(), '%PDF-');
  assert.equal(result.metrics.networkRequests.length, 0);
  if (template === 'campus') await writeFile('api-result.json', JSON.stringify({ document: rendered.document, layout: rendered.layout, images: Object.fromEntries(Object.keys(rendered.images).map(key => [key, true])) }));
}
const converted = await loadWorkbenchResume('node_modules/tech-resume-kit/examples/workbench/resume.json', undefined, {optionsFile:'node_modules/tech-resume-kit/examples/workbench/conversion.json'});
const convertedPdf = await inspectAndExport(await renderResume(converted.document, converted.layout, converted), {pdf:true});
assert.equal(convertedPdf.metrics.pageCount,1); assert.equal(convertedPdf.metrics.images.length,2);
assert.equal(converted.report.sourceSchemaVersion,4);
const { startEditor } = await import('./node_modules/tech-resume-kit/src/app.mjs');
const editor = await startEditor(path.resolve('editor-data'));
try {
  const state = await (await fetch(editor.url + 'api/state')).json();
  assert.equal(state.gettingStarted.welcome, true);
  const module = await fetch(editor.url + 'getting-started.mjs');
  assert.equal(module.status, 200); assert.match(await module.text(), /wireGettingStarted/);
  const naming = await fetch(editor.url + 'filename.mjs');
  assert.equal(naming.status, 200); assert.match(await naming.text(), /resumeFilename/);
  const ordering = await fetch(editor.url + 'section-order.mjs');
  assert.equal(ordering.status, 200); assert.match(await ordering.text(), /wireSectionOrder/);
  const html = await (await fetch(editor.url)).text();
  const token = /name="resume-token" content="([a-f0-9]+)"/.exec(html)[1];
  const response = await fetch(editor.url + 'api/getting-started/start', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: editor.url.slice(0,-1), 'X-Resume-Token': token }, body: JSON.stringify({ ...state, mode: 'initial', template: 'blank' }) });
  assert.equal(response.status, 200); const chosen = await response.json(); assert.equal(chosen.gettingStarted.welcome, false);
  const draftFront = structuredClone(chosen.front); draftFront.person.name = '独立安装草稿';
  const draft = await fetch(editor.url + 'api/draft-backup', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: editor.url.slice(0,-1), 'X-Resume-Token': token }, body: JSON.stringify({ resumeId: chosen.resumeId, baseSource: chosen.source, front: draftFront, body: chosen.body, layout: chosen.layout }) });
  assert.equal(draft.status, 200); assert.ok(draft.headers.get('content-type').includes('application/zip'));
  const { decodeBackup } = await import('./node_modules/tech-resume-kit/src/backup.mjs');
  assert.match(decodeBackup(Buffer.from(await draft.arrayBuffer())).source, /独立安装草稿/);
  assert.equal((await editor.project.read()).source, chosen.source);
} finally { await editor.close(); }
`);
  await run(process.execPath, [path.join(outside, 'probe.mjs')]);
  await writeFile(path.join(outside, 'types.mts'), `
import { renderResume, inspectAndExport, parseResumeJson, convertWorkbenchResume, loadWorkbenchResume, ResumeError, type ResumeDocument, type LayoutConfig, type WorkbenchDocument, type WorkbenchConversionReport } from 'tech-resume-kit';
const document: ResumeDocument = { schemaVersion: '0.2.0', person: { name: '填写姓名', target: '开发', contacts: [{text:'a@example.com', href:'mailto:a@example.com'}] }, sections: [{id:'skills',title:'技能',kind:'skills',items:[{label:'Java',text:'测试'}]}] };
const layout: LayoutConfig = {schemaVersion:'0.2.0'};
const rendered = await renderResume(document, layout);
const result = await inspectAndExport(rendered, {pdf:true});
const bytes: Uint8Array = result.buffer;
const count: number = result.metrics.pageCount;
const width: number | undefined = rendered.images.portrait?.width;
const parsed = parseResumeJson('{}');
const error = new ResumeError('字段错误', {code:'INPUT'}).toJSON();
declare const workbench: WorkbenchDocument;
const converted = convertWorkbenchResume(workbench,{layout});
const report: WorkbenchConversionReport = converted.report;
const loaded = await loadWorkbenchResume('workbench.json',undefined,{optionsFile:'conversion.json'});
const date: string | undefined = converted.document.sections[0].kind === 'entries' ? converted.document.sections[0].entries[0].date : undefined;
// @ts-expect-error incompatible workbench model
const bad: ResumeDocument = {schemaVersion:2};
`);
  await run(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--strict', '--noEmit', '--module', 'nodenext', '--target', 'es2022', '--lib', 'es2022', path.join(outside, 'types.mts')]);
  const exchanged = path.join(outside, '交换/resume.json'), jsonPdf = path.join(outside, 'json-output.pdf');
  await run(process.execPath, [cli, 'export-json', path.join(outside, 'campus/resume.md'), '--out', exchanged]);
  const built = JSON.parse((await run(process.execPath, [cli, 'build-json', exchanged, '--out', jsonPdf, '--json'])).stdout);
  assert.equal(built.metrics.pageCount, 1); assert.equal(built.metrics.images.length, 2);
  await copyFile(jsonPdf, path.join(qa, 'installed-json.pdf'));
  const apiModel = JSON.parse(await readFile(path.join(outside, 'api-result.json'), 'utf8'));
  await writeFile(path.join(qa, 'installed-json.expected.json'), JSON.stringify(pdfExpectations(apiModel, 1)));
  console.log('Installed TGZ: CLI bin, ESM API, TypeScript, all three starters, getting-started editor and JSON PDF passed.');
  const zipPath = path.join(packages, `tech-resume-starter-${pkg.version}.zip`);
  await run(process.env.TECH_RESUME_PYTHON || 'python', ['-X', 'utf8', '-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert all(".." not in n.split("/") and not n.startswith("/") for n in z.namelist()); z.extractall(sys.argv[2])', zipPath, outside]);
  const starter = path.join(outside, `tech-resume-starter-${pkg.version}`), runner = path.join(starter, 'toolkit/starter/runner.mjs');
  const launch = async (file, command) => {
    if (process.platform === 'win32') {
      const bat = path.join(starter, file);
      assert.ok(!/["%&|<>^]/.test(bat));
      return run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', file], { cwd: starter, env: { ...process.env, TECH_RESUME_NO_PAUSE: '1' } });
    }
    const sh = { install: 'install.sh', build: 'export-pdf.sh' }[command];
    return run('sh', [path.join(starter, sh)]);
  };
  await launch('01-install.cmd', 'install');
  await launch('03-export-pdf.cmd', 'build');
  await launch('03-export-pdf.cmd', 'build');
  const exports = await readdir(path.join(starter, 'output'));
  assert.equal(exports.filter(name => name.endsWith('.pdf')).length, 2);
  await copyFile(path.join(starter, 'output', exports[0]), path.join(qa, 'starter-blank.pdf'));
  const loadedBlank = await run(process.execPath, ['--input-type=module', '-e', `import {loadResume} from 'tech-resume-kit'; import {writeFile} from 'node:fs/promises'; const r=await loadResume(process.argv[1]); await writeFile('blank-model.json',JSON.stringify(r));`, path.join(starter, 'resume.md')]);
  assert.equal(loadedBlank.stderr, '');
  const blankModel = JSON.parse(await readFile(path.join(outside, 'blank-model.json'), 'utf8'));
  await writeFile(path.join(qa, 'starter-blank.expected.json'), JSON.stringify(pdfExpectations({ ...blankModel, images: {} }, 1)));
  const socket = createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve)); const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  preview = spawn(process.execPath, [runner, 'preview', '--port', String(port), '--no-open'], { cwd: outside, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    let output = ''; const timer = setTimeout(() => reject(new Error('Starter preview startup timed out')), 30_000);
    preview.stdout.on('data', data => { output += data; if (output.includes(`http://127.0.0.1:${port}`)) { clearTimeout(timer); resolve(); } });
    preview.once('error', reject); preview.once('exit', code => { clearTimeout(timer); reject(new Error(`Starter preview stopped: ${code}`)); });
  });
  const address = `http://127.0.0.1:${port}`;
  assert.equal((await (await fetch(address + '/__status')).json()).valid, true);
  assert.equal((await fetch(address + '/__document.pdf')).headers.get('content-type'), 'application/pdf');
  const browser = await chromium.launch({ channel: 'chromium' });
  try {
    const page = await browser.newPage(); await page.goto(address);
    await page.frameLocator('iframe').locator('.pdf-page[data-rendered="true"]').waitFor({ timeout: 30000 });
    assert.match(await page.frameLocator('iframe').locator('.textLayer').innerText(), /你的姓名/);
  } finally { await browser.close(); }
  console.log('Starter ZIP: real install/export launchers, unique output filenames and local PDF preview passed.');
  await writeFile(path.join(packages, 'smoke-report.json'), JSON.stringify({ version: pkg.version, platform: process.platform, packageApi: true, types: true, cliJson: true, allStarters: true, gettingStarted: true, launchers: true, preview: true, pagesReviewedSeparately: ['installed-json', 'starter-blank'] }, null, 2) + '\n');
} finally {
  if (preview?.pid) {
    if (process.platform === 'win32') await run('taskkill', ['/PID', String(preview.pid), '/T', '/F']).catch(() => {});
    else { preview.kill('SIGTERM'); await new Promise(resolve => preview.once('exit', resolve)); }
  }
  const actual = await realpath(outside);
  assert.ok(actual.startsWith(path.join(await realpath(tmpdir()), 'tech-resume-安装 验证-')));
  await rm(actual, { recursive: true, force: true, maxRetries: 4, retryDelay: 500 });
}
