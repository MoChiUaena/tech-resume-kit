#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadResume } from './input.mjs';
import { renderResume } from './render.mjs';
import { inspectAndExport } from './export.mjs';
import { ResumeError } from './errors.mjs';
import { ensureNewOutput, savePdf, initializeProject } from './files.mjs';
import { startPreview } from './preview.mjs';

const help = `tech-resume-kit - 本地中文简历

  npm run init -- --dir personal/my-resume [--template campus|experience|blank]
  npm run check -- [resume.md] [--config layout.yaml]
  npm run preview -- [resume.md] [--config layout.yaml] [--port 4173]
  npm run build -- [resume.md] [--config layout.yaml] [--out personal/output/resume.pdf] [--force]

默认读取 resume.md；配置默认取 Markdown 同目录的 layout.yaml。
check 包括 Markdown、字段、图片与实际 PDF 分页检查，page.maxPages 可设为 1 或 2。
preview 仅监听 127.0.0.1，显示实际 PDF，保存 Markdown、配置或图片后自动刷新。
build 默认拒绝覆盖已有 PDF，--force 才会替换；不缩小字号、不上传资料。
`;

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    help: { type: 'boolean', short: 'h' }, config: { type: 'string', short: 'c' }, out: { type: 'string', short: 'o' }, force: { type: 'boolean' },
    port: { type: 'string' }, dir: { type: 'string' }, template: { type: 'string' },
  } });
  if (values.help || !positionals.length) console.log(help);
  else {
    const [command, input = 'resume.md', ...extra] = positionals;
    if (extra.length) throw new ResumeError('位置参数过多；带空格的文件路径请用引号包围');
    const allowed = { init: ['dir', 'template'], check: ['config'], preview: ['config', 'port'], build: ['config', 'out', 'force'] }[command];
    if (!allowed) throw new ResumeError(`未知命令 ${command}；使用 --help 查看用法`);
    for (const key of Object.keys(values)) if (!allowed.includes(key)) throw new ResumeError(`${command} 不支持 --${key}`);
    if (command === 'init') {
      if (positionals.length > 1) throw new ResumeError('init 使用 --dir 指定目录');
      const target = await initializeProject(values.dir || 'personal/my-resume', values.template || 'campus');
      console.log(`已创建起步文件：${target}\n编辑 resume.md 和 layout.yaml 后运行 check / preview / build。`);
    } else if (command === 'preview') {
      const port = values.port === undefined ? 4173 : Number(values.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ResumeError('port 必须为 1 到 65535 的整数');
      const preview = await startPreview(input, values.config, port);
      console.log(`本地预览：${preview.url}\n保存文件后自动刷新；按 Ctrl+C 停止。`);
      for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { preview.server.close(); preview.server.closeAllConnections(); });
    } else {
      const output = path.resolve(values.out || 'personal/output/resume.pdf');
      if (command === 'build') {
        if (path.extname(output).toLowerCase() !== '.pdf') throw new ResumeError('输出文件扩展名必须为 .pdf', { file: output });
        await ensureNewOutput(output, values.force);
      }
      const loaded = await loadResume(input, values.config);
      const rendered = await renderResume(loaded.document, loaded.layout, loaded);
      const result = await inspectAndExport(rendered, { pdf: command === 'build' });
      for (const warning of result.warnings) console.warn(`提示：${warning}`);
      if (command === 'build') { await savePdf(output, result.buffer, values.force); console.log(`已生成：${output}`); }
      console.log(`检查通过：${rendered.document.sections.length} 个章节，${result.metrics.images.length} 张图片；正文 ${rendered.layout.bodyPt} pt，${result.metrics.pageCount} 页 A4；离线资源检查通过。`);
    }
  }
} catch (error) {
  console.error(error instanceof ResumeError ? error.toString() : `执行失败：${error.message}`);
  process.exitCode = 1;
}
