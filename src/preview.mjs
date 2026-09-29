import { createServer } from 'node:http';
import { stat } from 'node:fs/promises';
import { loadResume } from './input.mjs';
import { renderResume } from './render.mjs';
import { inspectAndExport } from './export.mjs';
import { assetPath } from './assets.mjs';
import { escapeHtml } from './markdown.mjs';
import { ResumeError } from './errors.mjs';
import path from 'node:path';
import { createPdfViewerAssets } from './pdf-viewer.mjs';

function previewShell(result, revision, error) {
  const script = `<script>
const currentRevision = ${revision};
setInterval(async () => { try { const status = await (await fetch('/__status', {cache:'no-store'})).json(); if (status.revision !== currentRevision) location.reload(); } catch {} }, 1000);
</script>`;
  const title = error ? '简历输入需要修正' : result.name;
  const chrome = `<style>html,body{height:100%;margin:0}body{display:flex;flex-direction:column;background:#e9edf0;font:14px/1.5 sans-serif;color:#445965}.preview-bar{background:#fff;border-bottom:1px solid #d8e0e5;padding:10px 24px;display:flex;align-items:center;gap:24px;flex-wrap:wrap}.preview-bar h1{font-size:16px;margin:0}.preview-bar a{color:#233e54}.preview-error{margin:40px auto;max-width:820px;padding:0 24px;white-space:pre-wrap;color:#9b3128}iframe{border:0;width:100%;flex:1;min-height:0}</style><header class="preview-bar"><h1>${escapeHtml(title)}</h1><span id="preview-status">${error ? '修改文件后自动重试' : `${result.metrics.pageCount} 页 A4 · 实际 PDF · 保存后自动刷新`}</span>${error ? '' : `<a href="/__document.pdf?v=${revision}" target="_blank" rel="noopener">打开 PDF</a>`}</header>`;
  const warnings = result?.warnings.length ? `<aside style="padding:8px 24px;background:#fff8e9;color:#765019">${result.warnings.map(escapeHtml).join('<br>')}</aside>` : '';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} - 本地预览</title></head><body>${chrome}${warnings}${error ? `<pre class="preview-error">${escapeHtml(error)}</pre>` : `<iframe title="简历 PDF 预览" src="/pdf-viewer.html?file=${encodeURIComponent('/__document.pdf?v=' + revision)}"></iframe>`}${script}</body></html>`;
}

export async function startPreview(input, config, port = 4173) {
  const servePdfViewer = await createPdfViewerAssets();
  let files = [path.resolve(input), path.resolve(config || path.join(path.dirname(input), 'layout.yaml'))];
  // A restarted preview must have a new revision so tabs from an earlier
  // server instance refresh even when the input files have not changed.
  let signature, revision = Date.now(), result, error, refreshing;
  async function fingerprint() {
    return JSON.stringify(await Promise.all(files.map(async file => {
      try { const info = await stat(file); return [file, info.mtimeMs, info.size]; }
      catch { return [file, null]; }
    })));
  }
  async function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const latest = await fingerprint();
      if (latest === signature) return;
      try {
        const loaded = await loadResume(input, config);
        files = [loaded.inputFile, loaded.configFile];
        for (const [key, asset] of Object.entries(loaded.document.assets)) if (loaded.layout.images[key].enabled) files.push(assetPath(loaded.assetBase, asset.src));
        const rendered = await renderResume(loaded.document, loaded.layout, loaded);
        result = { ...await inspectAndExport(rendered, { pdf: true }), name: rendered.document.person.name };
        error = undefined;
      } catch (caught) { error = caught instanceof ResumeError ? caught.toString() : `预览失败：${caught.message}`; result = undefined; }
      // Keep the pre-read signature: an edit during rendering must trigger
      // another refresh instead of being mistaken for an already-rendered edit.
      signature = latest;
      revision++;
    })();
    try { await refreshing; } finally { refreshing = undefined; }
  }
  await refresh();
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'SAMEORIGIN');
    if (request.headers.host !== `127.0.0.1:${server.address().port}`) { response.writeHead(403); response.end('Local preview only'); return; }
    // No directory listing or arbitrary-file endpoint; never listen on a LAN interface.
    const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
    if (request.method !== 'GET') { response.writeHead(404); response.end('Not found'); return; }
    try {
      if (await servePdfViewer(pathname, response)) return;
      if (!['/', '/__status', '/__document.pdf'].includes(pathname)) { response.writeHead(404); response.end('Not found'); return; }
      await refresh();
      if (pathname === '/__status') {
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.end(JSON.stringify({ revision, valid: !error, pageCount: result?.metrics.pageCount }));
      } else if (pathname === '/__document.pdf') {
        if (error) { response.writeHead(422, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end(error); return; }
        response.setHeader('Content-Type', 'application/pdf');
        response.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(result.name + '.pdf')}`);
        response.end(result.buffer);
      } else {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(previewShell(result, revision, error));
      }
    } catch { response.writeHead(500); response.end('Preview unavailable'); }
  });
  await new Promise((resolve, reject) => {
    server.once('error', err => reject(new ResumeError(err.code === 'EADDRINUSE' ? `端口 ${port} 已占用，请使用 --port 换一个端口` : `预览服务启动失败：${err.message}`)));
    server.listen(port, '127.0.0.1', resolve);
  });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
