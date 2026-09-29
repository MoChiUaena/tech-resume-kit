import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { kitRoot } from './render.mjs';

const pdfjsRoot = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
const viewerPolicy = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' blob: data:; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'none'";

export async function createPdfViewerAssets() {
  const resources = new Map([
    ['/pdf-viewer.html', [path.join(kitRoot, 'app/pdf-viewer.html'), 'text/html; charset=utf-8']],
    ['/pdf-viewer.mjs', [path.join(kitRoot, 'app/pdf-viewer.mjs'), 'text/javascript; charset=utf-8']],
    ['/pdf-viewer.css', [path.join(kitRoot, 'app/pdf-viewer.css'), 'text/css; charset=utf-8']],
    ['/pdfjs/pdf.mjs', [path.join(pdfjsRoot, 'build/pdf.mjs'), 'text/javascript; charset=utf-8']],
    ['/pdfjs/pdf.worker.mjs', [path.join(pdfjsRoot, 'build/pdf.worker.mjs'), 'text/javascript; charset=utf-8']],
    ['/pdfjs/pdf_viewer.css', [path.join(pdfjsRoot, 'web/pdf_viewer.css'), 'text/css; charset=utf-8']],
    ['/pdfjs/LICENSE', [path.join(pdfjsRoot, 'LICENSE'), 'text/plain; charset=utf-8']],
  ]);
  for (const [directory, pattern] of [['cmaps', /\.bcmap$/], ['standard_fonts', /\.(?:ttf|pfb)$/], ['wasm', /\.(?:wasm|js)$/], ['iccs', /\.icc$/]]) {
    for (const entry of await readdir(path.join(pdfjsRoot, directory), { withFileTypes: true })) {
      if (!entry.isFile() || !pattern.test(entry.name)) continue;
      const type = entry.name.endsWith('.wasm') ? 'application/wasm' : entry.name.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/octet-stream';
      resources.set(`/pdfjs/${directory}/${entry.name}`, [path.join(pdfjsRoot, directory, entry.name), type]);
    }
  }
  return async (pathname, response) => {
    if (!resources.has(pathname)) return false;
    const [filename, type] = resources.get(pathname);
    response.setHeader('Content-Security-Policy', viewerPolicy);
    response.writeHead(200, { 'Content-Type': type }); response.end(await readFile(filename));
    return true;
  };
}
