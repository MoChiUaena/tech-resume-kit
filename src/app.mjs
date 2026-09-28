import { createServer } from 'node:http';
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { imageSize } from 'image-size';
import { openProject } from './project.mjs';
import { kitRoot } from './render.mjs';
import { ResumeError } from './errors.mjs';

export async function startEditor(directory, { port = 0, idleSeconds = 0 } = {}) {
  const project = await openProject(directory), token = randomBytes(24).toString('hex');
  let lastSeen = Date.now(), url, closing = false;
  const staticFiles = { '/': ['app/index.html', 'text/html; charset=utf-8'], '/app.js': ['app/app.js', 'text/javascript; charset=utf-8'], '/app.css': ['app/app.css', 'text/css; charset=utf-8'] };
  async function bytes(request, maximum) {
    const chunks = []; let size = 0;
    for await (const chunk of request) { size += chunk.length; if (size > maximum) throw new ResumeError('文件太大；正文上限 500 KB，图片上限 5 MB', { code: 'SIZE' }); chunks.push(chunk); }
    return Buffer.concat(chunks);
  }
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'SAMEORIGIN'); response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; frame-src 'self'; img-src 'self' data: blob:; object-src 'none'; connect-src 'self'; base-uri 'none'; frame-ancestors 'self'");
    const json = (data, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(data)); };
    if (request.headers.host !== `127.0.0.1:${server.address().port}`) { json({ error: { message: '仅支持本机访问' } }, 403); return; }
    const requested = new URL(request.url, url), pathname = requested.pathname;
    try {
      if (request.method === 'GET') {
        if (staticFiles[pathname]) {
          const [file, type] = staticFiles[pathname]; let contents = await readFile(path.join(kitRoot, file));
          if (pathname === '/') contents = Buffer.from(contents.toString().replace('__SESSION_TOKEN__', token));
          response.writeHead(200, { 'Content-Type': type }); response.end(contents); lastSeen = Date.now();
        } else if (pathname === '/api/state') { lastSeen = Date.now(); json(await project.read()); }
        else if (pathname === '/api/ping') { lastSeen = Date.now(); json({ ok: true }); }
        else if (pathname === '/api/preview' || pathname === '/document.pdf') {
          lastSeen = Date.now();
          const result = await project.preview(requested.searchParams.get('revision'));
          if (pathname === '/api/preview') json({ revision: result.revision, pageCount: result.metrics.pageCount, warnings: result.warnings });
          else {
            response.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `${requested.searchParams.has('download') ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(result.name + '-简历.pdf')}` }); response.end(result.buffer);
          }
        } else json({ error: { message: '页面不存在' } }, 404);
      } else if (request.method === 'POST') {
        if (request.headers.origin !== url.slice(0, -1) || request.headers['x-resume-token'] !== token) { json({ error: { message: '请求来源不正确，请重新打开应用' } }, 403); return; }
        lastSeen = Date.now();
        if (pathname === '/api/save' || pathname === '/api/template') {
          if (request.headers['content-type']?.split(';')[0] !== 'application/json') throw new ResumeError('请求格式不正确');
          let payload; try { payload = JSON.parse((await bytes(request, 2_000_000)).toString('utf8')); } catch (error) { if (error instanceof ResumeError) throw error; throw new ResumeError('请求格式不正确'); }
          const state = await (pathname === '/api/save' ? project.save(payload) : project.useTemplate(payload));
          json(state);
        } else if (pathname === '/api/image/portrait' || pathname === '/api/image/schoolLogo') {
          const content = await bytes(request, 5_000_000); let dimensions;
          try { dimensions = imageSize(content); } catch { throw new ResumeError('请选择有效的 PNG 或 JPEG 图片'); }
          if (!['png', 'jpg'].includes(dimensions.type) || !dimensions.width || !dimensions.height || dimensions.width > 20_000 || dimensions.height > 20_000) throw new ResumeError('请选择尺寸不超过 20000 像素的 PNG 或 JPEG 图片');
          const key = pathname.split('/').at(-1), extension = dimensions.type === 'jpg' ? 'jpg' : 'png';
          const src = `assets/${key}-${createHash('sha256').update(content).digest('hex').slice(0, 20)}.${extension}`;
          await mkdir(path.join(project.root, 'assets'), { recursive: true });
          await writeFile(path.join(project.root, src), content, { mode: 0o600 });
          json({ src, alt: key === 'portrait' ? '证件照' : '学校 Logo' });
        } else if (pathname === '/api/exit') { json({ ok: true }); setTimeout(close, 150); }
        else json({ error: { message: '接口不存在' } }, 404);
      } else json({ error: { message: '请求方式不支持' } }, 405);
    } catch (error) {
      const details = error instanceof ResumeError ? error.toJSON() : { code: 'EXECUTION', message: error.message };
      json({ error: details }, error.code === 'CONFLICT' ? 409 : 422);
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  url = `http://127.0.0.1:${server.address().port}/`;
  const sessionFile = path.join(project.root, 'app-session.local.json');
  await writeFile(sessionFile, JSON.stringify({ pid: process.pid, url }), { mode: 0o600 });
  let timer;
  async function close() {
    if (closing) return; closing = true; clearInterval(timer);
    server.closeAllConnections(); server.close();
    try { const session = JSON.parse(await readFile(sessionFile, 'utf8')); if (session.url === url) await unlink(sessionFile); } catch {}
  }
  if (idleSeconds) timer = setInterval(() => { if (Date.now() - lastSeen > idleSeconds * 1000) close(); }, 10_000);
  return { server, project, url, close };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { values } = parseArgs({ options: { dir: { type: 'string' }, port: { type: 'string' }, 'no-open': { type: 'boolean' }, 'idle-seconds': { type: 'string' } } });
    const port = Number(values.port || 0), idleSeconds = Number(values['idle-seconds'] || 0);
    if (!Number.isInteger(port) || port < 0 || port > 65535 || !Number.isFinite(idleSeconds) || idleSeconds < 0) throw new ResumeError('启动参数不正确');
    const app = await startEditor(values.dir || path.join(process.cwd(), 'my-resume'), { port, idleSeconds });
    console.log(app.url);
    if (!values['no-open']) {
      const [binary, args] = process.platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', app.url]] : process.platform === 'darwin' ? ['open', [app.url]] : ['xdg-open', [app.url]];
      const browser = spawn(binary, args, { stdio: 'ignore', windowsHide: true }); browser.on('error', () => console.log(`请在浏览器打开 ${app.url}`));
    }
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, app.close);
  } catch (error) { console.error(error instanceof ResumeError ? error.toString() : error.message); process.exitCode = 1; }
}
