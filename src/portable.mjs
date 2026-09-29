import { readFile, realpath } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify, parseArgs } from 'node:util';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const hashFile = async file => { const hash = createHash('sha256'); for await (const bytes of createReadStream(file)) hash.update(bytes); return hash.digest('hex'); };
export async function inspectPortable(program, { platform = process.platform, arch = process.arch } = {}) {
  const root = await realpath(program);
  const versions = JSON.parse(await readFile(path.join(root, 'runtime/versions.json'), 'utf8'));
  const kit = JSON.parse(await readFile(path.join(root, 'toolkit/package.json'), 'utf8'));
  if (!['darwin', 'linux'].includes(platform) || !['x64', 'arm64'].includes(arch) || versions.platform !== platform || versions.arch !== arch) throw new Error('请选择与这台电脑系统和芯片对应的启动包。');
  const folder = platform === 'darwin' ? `chrome-headless-shell-mac-${arch}` : arch === 'x64' ? 'chrome-headless-shell-linux64' : 'chrome-headless-shell-linux-arm64';
  const browserRelative = `browsers/chromium_headless_shell-1243/${folder}/chrome-headless-shell`;
  if (versions.kit !== kit.version || versions.node !== '24.18.0' || versions.playwright !== '1.63.0' || versions.chromiumHeadlessRevision !== '1243' || versions.chromiumExecutable !== browserRelative) throw new Error('程序和运行组件版本不匹配，请完整解压同一份启动包。');
  const node = path.join(root, 'runtime/bin/node'), browser = path.join(root, 'runtime', browserRelative);
  for (const [file, expected] of [[node, versions.nodeBinarySha256], [browser, versions.chromiumBinarySha256]]) {
    if (!/^[0-9a-f]{64}$/.test(expected || '') || await hashFile(file) !== expected) throw new Error('运行组件校验失败，请重新下载并完整解压启动包。');
  }
  return { root, versions, node, browser };
}
async function environmentError(error, browser) {
  if (process.platform !== 'linux') return 'Chromium 无法启动。请完整解压与芯片对应的包，并检查系统的打开提示。';
  let missing = [];
  try { const result = await promisify(execFile)('/usr/bin/ldd', [browser]); missing = result.stdout.split('\n').filter(line => line.includes('not found')).map(line => line.trim().split(' ')[0]); } catch {}
  return missing.length ? `缺少 Linux 系统库：${missing.join('、')}。请按使用说明安装 Ubuntu 系统依赖，再运行“检查环境.sh”。` : `Chromium 无法启动，请运行“检查环境.sh”检查系统组件。${error.message.split('\n')[0]}`;
}
async function main(args) {
  const { values } = parseArgs({ args, options: { check: { type: 'boolean' }, dir: { type: 'string' }, settings: { type: 'string' }, port: { type: 'string' }, 'no-open': { type: 'boolean' }, 'idle-seconds': { type: 'string' } } });
  const program = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const runtime = await inspectPortable(program);
  if (await realpath(process.execPath) !== await realpath(runtime.node)) throw new Error('请使用包内的启动脚本打开程序。');
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(runtime.root, 'runtime/browsers');
  process.env.TECH_RESUME_PORTABLE = '1';
  const { chromium } = await import('playwright');
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { throw new Error(await environmentError(error, runtime.browser)); }
  finally { await browser?.close(); }
  if (values.check) { console.log(`环境检查通过：${runtime.versions.kit} · ${runtime.versions.platform}/${runtime.versions.arch} · 包内 Node 与 Chromium`); return; }
  const forwarded = args.filter(arg => arg !== '--check');
  const child = spawn(runtime.node, [path.join(runtime.root, 'toolkit/src/app.mjs'), '--desktop', runtime.root, '--idle-seconds', '300', ...forwarded], { stdio: 'inherit', env: process.env });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); resolve(); }); });
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
