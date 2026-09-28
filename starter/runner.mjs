import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';

const toolkit = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const project = path.dirname(toolkit);
const cli = path.join(toolkit, 'src/cli.mjs');
const input = path.join(project, 'resume.md'), config = path.join(project, 'layout.yaml');
function run(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: toolkit, stdio: 'inherit', windowsHide: true, ...options });
    child.once('error', reject); child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`命令未完成（${code ?? signal}）`)));
  });
}
function openBrowser(url) {
  const [executable, args] = process.platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  const child = spawn(executable, args, { stdio: 'ignore', windowsHide: true });
  child.on('error', () => console.log(`请在浏览器打开：${url}`));
}
try {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('请先安装 Node.js 22 或更高版本。');
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { 'with-deps': { type: 'boolean' }, port: { type: 'string' }, 'no-open': { type: 'boolean' } } });
  const [command, ...extra] = positionals;
  const allowed = { install: ['with-deps'], preview: ['port', 'no-open'], build: [], check: [] }[command];
  if (!allowed || extra.length || Object.keys(values).some(key => !allowed.includes(key))) throw new Error('使用 install / preview [--port 4173] / build / check；install 在 Linux 可加 --with-deps。');
  if (command === 'install') {
    if (process.platform === 'win32') await run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm ci --omit=dev']);
    else await run('npm', ['ci', '--omit=dev']);
    await run(process.execPath, [path.join(toolkit, 'node_modules/playwright/cli.js'), 'install', ...(values['with-deps'] ? ['--with-deps'] : []), 'chromium']);
    await run(process.execPath, [cli, 'check', input, '--config', config]);
    console.log('安装完成。编辑 resume.md，运行预览或导出入口。');
  } else {
    if (!existsSync(path.join(toolkit, 'node_modules/playwright/cli.js'))) throw new Error('请先运行安装入口（01-install.cmd 或 install.sh）。');
    const args = [cli, command, input, '--config', config];
    if (command === 'build') {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      args.push('--out', path.join(project, 'output', `resume-${stamp}-${randomUUID().slice(0, 8)}.pdf`));
    }
    if (command === 'preview') {
      args.push('--port', values.port || '4173');
      const child = spawn(process.execPath, args, { cwd: project, stdio: ['inherit', 'pipe', 'inherit'], windowsHide: true });
      let received = '', opened = false;
      child.stdout.on('data', data => {
        process.stdout.write(data); received += data;
        const url = received.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
        if (url && !opened && !values['no-open']) { opened = true; openBrowser(url); }
      });
      for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
      await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 || code === null ? resolve() : reject(new Error('预览启动失败，请查看上述错误。'))); });
    } else await run(process.execPath, args, { cwd: project });
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
