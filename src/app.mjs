import { createServer } from 'node:http';
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { imageSize } from 'image-size';
import { openLibrary } from './library.mjs';
import { backupLimit } from './backup.mjs';
import { libraryBackupLimit } from './library-backup.mjs';
import { kitRoot } from './render.mjs';
import { ResumeError, serializeEditorError } from './errors.mjs';
import { openStorage, lockDirectory, snapshotLibrary, canonicalDirectory, assertInactive } from './storage.mjs';
import { createUpdater } from './updates.mjs';
import { createPdfViewerAssets } from './pdf-viewer.mjs';
import { resumeFilename, safeFilenamePart } from './filename.mjs';
import { resumeThemes } from './resume-themes.mjs';

export async function startEditor(directory, { port = 0, idleSeconds = 0, historyIntervalMs, storage, desktopDirectory, updater: suppliedUpdater } = {}) {
  await assertInactive(directory);
  let releaseLock = await lockDirectory(directory), project, updater, version, servePdfViewer;
  try {
    version = JSON.parse(await readFile(path.join(kitRoot, 'package.json'), 'utf8')).version;
    project = await openLibrary(directory, { historyIntervalMs });
    updater = suppliedUpdater || await createUpdater({ version, home: storage?.home || project.root, programDirectory: desktopDirectory });
    servePdfViewer = await createPdfViewerAssets();
  } catch (error) { await updater?.close().catch(() => {}); await project?.close().catch(() => {}); await releaseLock(); throw error; }
  const token = randomBytes(24).toString('hex');
  let lastSeen = Date.now(), url, closing = false;
  let mutations = Promise.resolve();
  function serialized(action) { const result = mutations.then(action); mutations = result.catch(() => {}); return result; }
  const appInfo = () => ({ version, storage: storage?.info() || { directory: project.root, managed: false }, desktop: !!desktopDirectory, directoryPicker: !!desktopDirectory && process.platform === 'win32', openDirectory: !!desktopDirectory && ['win32', 'darwin', 'linux'].includes(process.platform), updates: updater.status() });
  async function checkCurrent(payload) {
    const current = await project.read();
    if (payload.resumeId !== current.resumeId || payload.revision !== current.revision || payload.libraryRevision !== current.libraryRevision) throw new ResumeError('资料已经修改，请重新载入后再操作', { code: 'CONFLICT' });
  }
  async function changeStorage(payload) {
    if (!storage?.managed) throw new ResumeError('使用 --dir 启动时，请在启动参数中更换数据位置');
    await checkCurrent(payload);
    const previous = project, previousSession = sessionFile; let next, nextSession;
    const target = await canonicalDirectory(payload.directory), nextRelease = await lockDirectory(target);
    let stopped = false;
    try {
      await previous.close(); stopped = true;
      const prepared = await storage.prepare(target, payload.mode, payload.sourceDirectory);
      next = await openLibrary(prepared.directory, { historyIntervalMs }); await next.read();
      nextSession = path.join(next.root, 'app-session.local.json');
      await writeFile(nextSession, JSON.stringify({ pid: process.pid, url }), { mode: 0o600 });
      await storage.commit(next.root, prepared.backup ? prepared : null);
      project = next; sessionFile = nextSession;
      const oldRelease = releaseLock; releaseLock = nextRelease;
      await unlink(previousSession).catch(() => {}); await oldRelease().catch(error => console.error(error.message));
      return { state: await project.read(), app: appInfo(), migration: prepared };
    } catch (error) {
      await next?.close().catch(() => {}); await nextRelease?.();
      if (nextSession) await unlink(nextSession).catch(() => {});
      if (stopped) project = await openLibrary(previous.root, { historyIntervalMs }); throw error;
    }
  }
  async function pickDirectory() {
    if (!desktopDirectory || process.platform !== 'win32') throw new ResumeError('请直接填写完整文件夹路径');
    const resultFile = path.join(storage.home, `folder-${randomBytes(12).toString('hex')}.local.json`);
    try {
      await new Promise((resolve, reject) => {
        const helper = spawn(path.join(desktopDirectory, '启动简历.exe'), ['--pick-directory', resultFile], { windowsHide: true });
        helper.once('error', reject); helper.once('exit', code => code === 0 ? resolve() : reject(new ResumeError('文件夹选择未完成')));
      });
      return JSON.parse(await readFile(resultFile, 'utf8'));
    } finally { await unlink(resultFile).catch(() => {}); }
  }
  function launchProgram(directory, previous) {
    const args = ['--wait', '--settings', storage.configFile, ...(previous ? ['--update-from', previous] : [])];
    const child = spawn(path.join(directory, '启动简历.exe'), args, { detached: true, windowsHide: true, stdio: 'ignore' });
    child.once('error', error => { console.error(`新版启动失败：${error.message}；请打开原来的启动简历.exe。`); }); child.unref();
  }
  const staticFiles = { '/section-order.mjs': ['app/section-order.mjs', 'text/javascript; charset=utf-8'], '/filename.mjs': ['src/filename.mjs', 'text/javascript; charset=utf-8'], '/getting-started.mjs': ['app/getting-started.mjs', 'text/javascript; charset=utf-8'], '/': ['app/index.html', 'text/html; charset=utf-8'], '/app.js': ['app/app.js', 'text/javascript; charset=utf-8'], '/app.css': ['app/app.css', 'text/css; charset=utf-8'], '/crop.mjs': ['app/crop.mjs', 'text/javascript; charset=utf-8'], '/entries.mjs': ['app/entries.mjs', 'text/javascript; charset=utf-8'], '/entry-manager.mjs': ['app/entry-manager.mjs', 'text/javascript; charset=utf-8'], '/content-manager.mjs': ['app/content-manager.mjs', 'text/javascript; charset=utf-8'], '/library-manager.mjs': ['app/library-manager.mjs', 'text/javascript; charset=utf-8'], '/system.mjs': ['app/system.mjs', 'text/javascript; charset=utf-8'] };
  staticFiles['/draft-recovery.mjs'] = ['app/draft-recovery.mjs', 'text/javascript; charset=utf-8'];
  staticFiles['/error-guidance.mjs'] = ['app/error-guidance.mjs', 'text/javascript; charset=utf-8'];
  staticFiles['/starter-templates.mjs'] = ['src/starter-templates.mjs', 'text/javascript; charset=utf-8'];
  staticFiles['/template-picker.mjs'] = ['app/template-picker.mjs', 'text/javascript; charset=utf-8'];
  staticFiles['/resume-themes.mjs'] = ['src/resume-themes.mjs', 'text/javascript; charset=utf-8'];
  staticFiles['/theme-picker.mjs'] = ['app/theme-picker.mjs', 'text/javascript; charset=utf-8'];
  for (const theme of resumeThemes) {
    staticFiles[theme.preview] = ['app/theme-previews/' + theme.id + '.png', 'image/png'];
    staticFiles[theme.previewPdf] = ['app/theme-previews/' + theme.id + '.pdf', 'application/pdf'];
  }
  staticFiles['/theme-preview.mjs'] = ['app/theme-preview.mjs', 'text/javascript; charset=utf-8'];
  async function bytes(request, maximum) {
    const chunks = []; let size = 0;
    for await (const chunk of request) { size += chunk.length; if (size > maximum) throw new ResumeError(maximum === libraryBackupLimit ? '整库 ZIP 请控制在 128 MB 以内' : '文件太大；正文上限 500 KB，图片上限 5 MB', { code: 'SIZE' }); chunks.push(chunk); }
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
        if (await servePdfViewer(pathname, response)) { lastSeen = Date.now(); return; }
        if (pathname !== '/api/ping') await mutations;
        if (staticFiles[pathname]) {
          const [file, type] = staticFiles[pathname]; let contents = await readFile(path.join(kitRoot, file));
          if (pathname === '/') contents = Buffer.from(contents.toString().replace('__SESSION_TOKEN__', token));
          response.writeHead(200, { 'Content-Type': type }); response.end(contents); lastSeen = Date.now();
        } else if (pathname === '/api/state') { lastSeen = Date.now(); json(await project.read()); }
        else if (pathname === '/api/app-info') { lastSeen = Date.now(); json(appInfo()); }
        else if (pathname === '/api/entries') { lastSeen = Date.now(); json(await project.entries(requested.searchParams.get('resumeId'), requested.searchParams.get('revision'))); }
        else if (pathname === '/api/content') { lastSeen = Date.now(); json(await project.content(requested.searchParams.get('resumeId'), requested.searchParams.get('revision'))); }
        else if (pathname === '/api/section-order') { lastSeen = Date.now(); json(await project.sectionOrder(requested.searchParams.get('resumeId'), requested.searchParams.get('revision'))); }
        else if (pathname === '/api/updates/status') { lastSeen = Date.now(); json(updater.status()); }
        else if (pathname === '/api/ping') { lastSeen = Date.now(); json({ ok: true }); }
        else if (pathname === '/api/history') { lastSeen = Date.now(); json({ backups: await project.backups(requested.searchParams.get('resumeId')), warning: project.historyStatus() }); }
        else if (pathname === '/api/portrait') {
          const photo = await project.portrait(requested.searchParams.get('resumeId'), requested.searchParams.get('revision'));
          response.writeHead(200, { 'Content-Type': photo.type }); response.end(photo.buffer);
        }
        else if (pathname === '/backup.zip') {
          const backup = await project.exportBackup(requested.searchParams.get('resumeId'), requested.searchParams.get('backupId'));
          response.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(safeFilenamePart(backup.decoded.manifest.resumeName) + '-完整备份.zip')}` }); response.end(backup.buffer);
        }
        else if (pathname === '/library.zip' || pathname === '/library-before-restore.zip') {
          const payload = { resumeId: requested.searchParams.get('resumeId'), revision: requested.searchParams.get('revision'), libraryRevision: requested.searchParams.get('libraryRevision') };
          const buffer = pathname === '/library.zip' ? (await project.exportLibrary(payload)).buffer : await project.exportBeforeRestore(requested.searchParams.get('backupId'));
          response.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(pathname === '/library.zip' ? '简历整库备份.zip' : '恢复前简历整库.zip')}` }); response.end(buffer);
        }
        else if (pathname === '/api/preview' || pathname === '/document.pdf') {
          lastSeen = Date.now();
          const result = await project.preview(requested.searchParams.get('revision'), requested.searchParams.get('resumeId'));
          if (pathname === '/api/preview') json({ revision: result.revision, resumeId: result.resumeId, pageCount: result.metrics.pageCount, warnings: result.warnings });
          else {
            response.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `${requested.searchParams.has('download') ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(resumeFilename(result.name, result.resumeName, 'pdf'))}` }); response.end(result.buffer);
          }
        } else json({ error: { message: '页面不存在' } }, 404);
      } else if (request.method === 'POST') {
        if (request.headers.origin !== url.slice(0, -1) || request.headers['x-resume-token'] !== token) { json({ error: { message: '请求来源不正确，请重新打开应用' } }, 403); return; }
        lastSeen = Date.now();
        if (pathname === '/api/storage/browse') { json(await pickDirectory()); return; }
        await serialized(async () => {
        if (pathname.startsWith('/api/storage/') || pathname.startsWith('/api/updates/')) {
          let payload; try { payload = JSON.parse((await bytes(request, 10000)).toString('utf8')); } catch { throw new ResumeError('请求格式不正确'); }
          if (pathname === '/api/storage/change') json(await changeStorage(payload));
          else if (pathname === '/api/storage/open') {
            const target = payload.backup ? storage?.info().lastMigration?.backup : project.root;
            const opener = { win32: 'explorer.exe', darwin: 'open', linux: 'xdg-open' }[process.platform];
            if (!target || !opener) throw new ResumeError('请复制界面中的文件夹路径打开');
            spawn(opener, [target], { windowsHide: true }).on('error', () => {}); json({ ok: true });
          } else if (pathname === '/api/updates/check') json(await updater.check());
          else if (pathname === '/api/updates/prepare') json(updater.prepare());
          else if (pathname === '/api/updates/pause') json(await updater.pause());
          else if (pathname === '/api/updates/activate' || pathname === '/api/updates/rollback') {
            if (!storage?.managed || !desktopDirectory) throw new ResumeError('请在 Windows 免安装版中切换程序版本');
            await checkCurrent(payload); await project.flush();
            const backup = await snapshotLibrary(project.root, storage.backupRoot);
            const target = pathname.endsWith('/activate') ? await updater.activate(backup) : updater.status().rollbackDirectory;
            if (!target) throw new ResumeError('没有可返回的上一版本');
            await readFile(path.join(target, '启动简历.exe'));
            json({ ok: true, backup: backup.backup });
            setTimeout(() => close().then(() => launchProgram(target, pathname.endsWith('/activate') ? desktopDirectory : null)).catch(error => console.error(error.message)), 150);
          } else json({ error: { message: '接口不存在' } }, 404);
          return;
        }
        const actions = { '/api/getting-started/start': project.startFromTemplate, '/api/getting-started/dismiss': project.dismissGettingStarted, '/api/save': project.save, '/api/entries/change': project.changeEntry, '/api/content/change': project.changeContent, '/api/sections/rename': project.renameSectionTitle, '/api/template': project.useTemplate, '/api/resumes/create': project.create, '/api/resumes/duplicate': project.duplicate, '/api/resumes/rename': project.rename, '/api/resumes/trash': project.trashResume, '/api/resumes/restore-trash': project.restoreTrash, '/api/resumes/switch': project.switchResume, '/api/backup': project.createBackup, '/api/restore': project.restore };
        const draftActions = { '/api/drafts/write': project.writeDraft, '/api/drafts/clear': project.clearDraft, '/api/drafts/list': project.listDrafts };
        if (actions[pathname] || draftActions[pathname] || pathname === '/api/draft-backup') {
          if (request.headers['content-type']?.split(';')[0] !== 'application/json') throw new ResumeError('请求格式不正确');
          let payload; try { payload = JSON.parse((await bytes(request, 2_000_000)).toString('utf8')); } catch (error) { if (error instanceof ResumeError) throw error; throw new ResumeError('请求格式不正确'); }
          if (pathname === '/api/draft-backup') {
            const draft = await project.exportDraft(payload), filename = safeFilenamePart(draft.manifest.resumeName) + '-未保存草稿.zip';
            response.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`, 'X-Resume-Missing-Images': String(draft.manifest.missingAssets.length) });
            response.end(draft.buffer);
          } else json(await (draftActions[pathname] || actions[pathname])(payload));
        } else if (pathname === '/api/library/inspect' || pathname === '/api/library/restore-upload') {
          const buffer = await bytes(request, libraryBackupLimit);
          if (pathname === '/api/library/inspect') json(await project.inspectLibrary(buffer));
          else json(await project.restoreLibrary({ resumeId: request.headers['x-resume-id'], revision: request.headers['x-resume-revision'], libraryRevision: requested.searchParams.get('libraryRevision'), sha256: requested.searchParams.get('sha256') }, buffer));
        } else if (pathname === '/api/restore-upload') {
          const payload = { resumeId: request.headers['x-resume-id'], revision: request.headers['x-resume-revision'] };
          json(await project.restore(payload, await bytes(request, backupLimit)));
        } else if (pathname === '/api/image/portrait' || pathname === '/api/image/schoolLogo') {
          const content = await bytes(request, 5_000_000); let dimensions;
          try { dimensions = imageSize(content); } catch { throw new ResumeError('请选择有效的 PNG 或 JPEG 图片'); }
          if (!['png', 'jpg'].includes(dimensions.type) || !dimensions.width || !dimensions.height || dimensions.width > 20_000 || dimensions.height > 20_000) throw new ResumeError('请选择尺寸不超过 20000 像素的 PNG 或 JPEG 图片');
          const key = pathname.split('/').at(-1), extension = dimensions.type === 'jpg' ? 'jpg' : 'png';
          const src = `assets/${key}-${createHash('sha256').update(content).digest('hex').slice(0, 20)}.${extension}`;
          await project.storeImage(request.headers['x-resume-id'], src, content);
          json({ src, alt: key === 'portrait' ? '证件照' : '学校 Logo' });
        } else if (pathname === '/api/exit') { await project.flush(); json({ ok: true }); setTimeout(() => close().catch(() => {}), 150); }
        else json({ error: { message: '接口不存在' } }, 404);
        });
      } else json({ error: { message: '请求方式不支持' } }, 405);
    } catch (error) {
      const details = serializeEditorError(error);
      json({ error: details }, error.code === 'CONFLICT' ? 409 : 422);
    }
  });
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); }
  catch (error) { await updater.close(); await project.close(); await releaseLock(); throw error; }
  url = `http://127.0.0.1:${server.address().port}/`;
  let sessionFile = path.join(project.root, 'app-session.local.json');
  try { await writeFile(sessionFile, JSON.stringify({ pid: process.pid, url }), { mode: 0o600 }); }
  catch (error) {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await updater.close().catch(() => {}); await project.close().catch(() => {}); await releaseLock(); throw error;
  }
  let timer;
  async function close() {
    if (closing) return; closing = true; clearInterval(timer);
    try { await mutations; await updater.close(); await project.close(); } catch (error) { closing = false; throw error; }
    server.closeAllConnections(); server.close();
    try { const session = JSON.parse(await readFile(sessionFile, 'utf8')); if (session.url === url) await unlink(sessionFile); } catch {}
    await releaseLock();
  }
  if (idleSeconds) timer = setInterval(() => { if (Date.now() - lastSeen > idleSeconds * 1000) close().catch(() => {}); }, 10_000);
  return { server, get project() { return project; }, url, close };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { values } = parseArgs({ options: { dir: { type: 'string' }, port: { type: 'string' }, 'no-open': { type: 'boolean' }, 'idle-seconds': { type: 'string' }, settings: { type: 'string' }, desktop: { type: 'string' } } });
    const port = Number(values.port || 0), idleSeconds = Number(values['idle-seconds'] || 0);
    if (!Number.isInteger(port) || port < 0 || port > 65535 || !Number.isFinite(idleSeconds) || idleSeconds < 0) throw new ResumeError('启动参数不正确');
    const storage = await openStorage({ directory: values.dir && path.resolve(values.dir), settingsFile: values.settings, programDirectory: values.desktop || process.cwd() });
    let app;
    try { app = await startEditor(storage.root, { port, idleSeconds, storage, desktopDirectory: values.desktop }); }
    catch (error) {
      if (error.code !== 'IN_USE') throw error;
      const session = JSON.parse(await readFile(path.join(storage.root, 'app-session.local.json'), 'utf8'));
      if (!/^http:\/\/127\.0\.0\.1:\d+\/$/.test(session.url)) throw error;
      app = { url: session.url };
    }
    console.log(app.url);
    if (!values['no-open']) {
      const [binary, args] = process.platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', app.url]] : process.platform === 'darwin' ? ['open', [app.url]] : ['xdg-open', [app.url]];
      const browser = spawn(binary, args, { stdio: 'ignore', windowsHide: true }); browser.on('error', () => console.log(`请在浏览器打开 ${app.url}`));
    }
    if (app.close) for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.close().catch(error => console.error(error.message)));
  } catch (error) { console.error(error instanceof ResumeError ? error.toString() : error.message); process.exitCode = 1; }
}
