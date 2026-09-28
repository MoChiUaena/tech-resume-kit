#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadResume } from './input.mjs';
import { loadResumeJson } from './json.mjs';
import { renderResume } from './render.mjs';
import { inspectAndExport } from './export.mjs';
import { ResumeError } from './errors.mjs';
import { ensureNewOutput, savePdf, saveFile, initializeProject } from './files.mjs';
import { assetPath } from './assets.mjs';
import { startPreview } from './preview.mjs';

const help = `tech-resume-kit - 本地中文简历

  tech-resume init --dir personal/my-resume [--template campus|experience|blank]
  tech-resume check [resume.md] [--config layout.yaml] [--json]
  tech-resume preview [resume.md] [--config layout.yaml] [--port 4173]
  tech-resume build [resume.md] [--config layout.yaml] [--out resume.pdf] [--force] [--json]
  tech-resume export-json [resume.md] --out resume.json [--config layout.yaml] [--force] [--json]
  tech-resume check-json resume.json [--assets directory] [--json]
  tech-resume build-json resume.json [--assets directory] [--out resume.pdf] [--force] [--json]

源码目录也可使用 node src/cli.mjs <命令>，或 npm run check / preview / build -- <参数>。
Markdown 默认读取 resume.md 和同目录 layout.yaml。
JSON 输入为 { "document": ResumeDocument, "layout": LayoutConfig }，图片默认相对 JSON 文件。
check 包括字段、图片与实际 PDF 分页检查，page.maxPages 可设为 1 或 2。
preview 仅监听 127.0.0.1，显示实际 PDF，保存文件后自动刷新。
build 默认拒绝覆盖已有 PDF；--force 才替换。--json 将结果或错误作为单个 JSON 对象输出。
`;
const machine = process.argv.slice(2).includes('--json');
let command;
function success(result, human) {
  if (machine) console.log(JSON.stringify({ ok: true, command, ...result }));
  else console.log(human);
}
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    help: { type: 'boolean', short: 'h' }, config: { type: 'string', short: 'c' }, out: { type: 'string', short: 'o' }, force: { type: 'boolean' },
    port: { type: 'string' }, dir: { type: 'string' }, template: { type: 'string' }, assets: { type: 'string' }, json: { type: 'boolean' },
  } });
  if (values.help || !positionals.length) { command = 'help'; success({ help }, help); }
  else {
    const [action, input = 'resume.md', ...extra] = positionals;
    command = action;
    if (extra.length) throw new ResumeError('位置参数过多；带空格的文件路径请用引号包围', { code: 'CLI' });
    const allowed = {
      init: ['dir', 'template', 'json'], check: ['config', 'json'], preview: ['config', 'port'], build: ['config', 'out', 'force', 'json'],
      'export-json': ['config', 'out', 'force', 'json'], 'check-json': ['assets', 'json'], 'build-json': ['assets', 'out', 'force', 'json'],
    }[command];
    if (!allowed) throw new ResumeError(`未知命令 ${command}；使用 --help 查看用法`, { code: 'CLI' });
    for (const key of Object.keys(values)) if (!allowed.includes(key)) throw new ResumeError(`${command} 不支持 --${key}`, { code: 'CLI' });
    if (command === 'init') {
      if (positionals.length > 1) throw new ResumeError('init 使用 --dir 指定目录', { code: 'CLI' });
      const target = await initializeProject(values.dir || 'personal/my-resume', values.template || 'campus');
      success({ directory: target }, `已创建起步文件：${target}\n编辑 resume.md 和 layout.yaml 后运行 check / preview / build。`);
    } else if (command === 'preview') {
      const port = values.port === undefined ? 4173 : Number(values.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ResumeError('port 必须为 1 到 65535 的整数', { code: 'CLI' });
      const preview = await startPreview(input, values.config, port);
      console.log(`本地预览：${preview.url}\n保存文件后自动刷新；按 Ctrl+C 停止。`);
      for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { preview.server.close(); preview.server.closeAllConnections(); });
    } else {
      const jsonInput = command === 'check-json' || command === 'build-json';
      const build = command === 'build' || command === 'build-json';
      const exportJson = command === 'export-json';
      if (jsonInput && positionals.length < 2) throw new ResumeError(`${command} 需要指定 JSON 文件`, { code: 'CLI' });
      if (exportJson && !values.out) throw new ResumeError('export-json 需要 --out 指定 JSON 输出文件', { code: 'CLI' });
      const output = build || exportJson ? path.resolve(values.out || 'personal/output/resume.pdf') : undefined;
      if (output) {
        const extension = exportJson ? '.json' : '.pdf';
        if (path.extname(output).toLowerCase() !== extension) throw new ResumeError(`输出文件扩展名必须为 ${extension}`, { file: output, code: 'CLI' });
        await ensureNewOutput(output, values.force);
      }
      const loaded = jsonInput ? await loadResumeJson(input, { assetBase: values.assets }) : await loadResume(input, values.config);
      if (exportJson) {
        const document = structuredClone(loaded.document);
        for (const [key, asset] of Object.entries(document.assets)) {
          const relative = path.relative(path.dirname(output), assetPath(loaded.assetBase, asset.src));
          if (path.isAbsolute(relative)) throw new ResumeError('JSON 与素材位于不同磁盘，无法生成相对路径；请将 JSON 导出到素材所在磁盘', { file: output, field: `assets.${key}.src` });
          asset.src = relative.split(path.sep).join('/');
        }
        await saveFile(output, JSON.stringify({ document, layout: loaded.layout }, null, 2) + '\n', values.force);
        success({ input: loaded.inputFile, output }, `已导出 JSON：${output}`);
      } else {
        const rendered = await renderResume(loaded.document, loaded.layout, loaded);
        const result = await inspectAndExport(rendered, { pdf: build });
        if (build) await savePdf(output, result.buffer, values.force);
        if (!machine) for (const warning of result.warnings) console.warn(`提示：${warning}`);
        success({ input: loaded.inputFile, output, warnings: result.warnings, sections: rendered.document.sections.length, bodyPt: rendered.layout.bodyPt, metrics: result.metrics },
          `${build ? `已生成：${output}\n` : ''}检查通过：${rendered.document.sections.length} 个章节，${result.metrics.images.length} 张图片；正文 ${rendered.layout.bodyPt} pt，${result.metrics.pageCount} 页 A4；离线资源检查通过。`);
      }
    }
  }
} catch (error) {
  if (machine) console.log(JSON.stringify({ ok: false, command, error: error instanceof ResumeError ? error.toJSON() : { code: 'EXECUTION', message: error.message } }));
  else console.error(error instanceof ResumeError ? error.toString() : `执行失败：${error.message}`);
  process.exitCode = 1;
}
