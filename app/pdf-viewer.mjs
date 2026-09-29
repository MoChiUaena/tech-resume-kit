import { getDocument, GlobalWorkerOptions, TextLayer } from '/pdfjs/pdf.mjs';

const $ = id => document.getElementById(id);
GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.mjs';
let documentTask, documentPdf, source, serial = 0, pageNumber = 1, resizeTimer, rendering = false;
const activeTasks = new Set();
function notify(type, extra = {}) { if (window.parent !== window) window.parent.postMessage({ type, source, ...extra }, location.origin); }
function controls(ready) { $('zoom').disabled = !ready; $('page-prev').disabled = !ready || pageNumber <= 1; $('page-next').disabled = !ready || pageNumber >= (documentPdf?.numPages || 1); }
function fail(error) {
  rendering = false;
  $('loading').hidden = true; $('page-list').replaceChildren(); $('viewer-error').hidden = false; controls(false);
  const message = error.message || '预览暂时无法显示，请重新显示或打开 PDF。';
  $('error-message').textContent = message; $('page-number').textContent = '显示失败'; notify('resume-pdf-error', { message });
}
function parseSource() {
  const value = new URLSearchParams(location.search).get('file');
  if (!value || value.length > 2000) throw new Error('预览地址不正确');
  const url = new URL(value, location.origin);
  if (url.origin !== location.origin || url.username || url.password || url.hash || !['/document.pdf', '/__document.pdf'].includes(url.pathname)) throw new Error('预览仅支持本机生成的简历 PDF');
  return url.pathname + url.search;
}
function updatePageNumber() {
  const pages = [...document.querySelectorAll('.pdf-page')]; if (!pages.length) return;
  const top = $('pages').getBoundingClientRect().top;
  const current = pages.find(page => page.getBoundingClientRect().bottom > top + 25) || pages.at(-1);
  pageNumber = Number(current.dataset.page); $('page-number').textContent = `${pageNumber} / ${documentPdf.numPages}`; controls(!rendering);
}
async function links(page, viewport, container) {
  for (const annotation of await page.getAnnotations({ intent: 'display' })) {
    if (annotation.subtype !== 'Link' || !annotation.url || !Array.isArray(annotation.rect)) continue;
    let url; try { url = new URL(annotation.url); } catch { continue; }
    if (!['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) continue;
    const box = [...viewport.convertToViewportPoint(annotation.rect[0], annotation.rect[1]), ...viewport.convertToViewportPoint(annotation.rect[2], annotation.rect[3])], link = document.createElement('a');
    link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.setAttribute('aria-label', annotation.url);
    link.style.left = `${Math.min(box[0], box[2])}px`; link.style.top = `${Math.min(box[1], box[3])}px`;
    link.style.width = `${Math.abs(box[2] - box[0])}px`; link.style.height = `${Math.abs(box[3] - box[1])}px`; container.append(link);
  }
}
async function render() {
  if (!documentPdf) return;
  const generation = ++serial;
  const desiredPage = pageNumber;
  rendering = true;
  for (const task of activeTasks) task.cancel(); activeTasks.clear(); controls(false);
  $('viewer-error').hidden = true; $('loading').hidden = false; $('page-list').replaceChildren();
  const fit = $('zoom').value === 'fit', width = Math.max(100, $('pages').clientWidth - (window.innerWidth <= 380 ? 16 : 28));
  try {
    for (let index = 1; index <= documentPdf.numPages; index++) {
      const page = await documentPdf.getPage(index); if (generation !== serial) return;
      const base = page.getViewport({ scale: 1 }), scale = fit ? width / base.width : Number($('zoom').value) * 96 / 72;
      const viewport = page.getViewport({ scale }), paper = document.createElement('section'), canvas = document.createElement('canvas'), text = document.createElement('div'), annotations = document.createElement('div');
      paper.className = 'pdf-page'; paper.dataset.page = index; paper.setAttribute('aria-label', `第 ${index} 页`);
      paper.style.width = `${viewport.width}px`; paper.style.height = `${viewport.height}px`; paper.style.setProperty('--scale-factor', scale);
      const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(8_000_000 / (viewport.width * viewport.height)));
      canvas.width = Math.ceil(viewport.width * ratio); canvas.height = Math.ceil(viewport.height * ratio); canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`; canvas.setAttribute('aria-hidden', 'true');
      text.className = 'textLayer'; annotations.className = 'link-layer'; paper.append(canvas, text, annotations); $('page-list').append(paper);
      const painting = page.render({ canvasContext: canvas.getContext('2d'), viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0], background: '#ffffff' });
      const selection = new TextLayer({ textContentSource: page.streamTextContent(), container: text, viewport });
      activeTasks.add(painting); activeTasks.add(selection);
      await Promise.all([painting.promise, selection.render(), links(page, viewport, annotations)]);
      activeTasks.delete(painting); activeTasks.delete(selection); if (generation !== serial) return;
      paper.dataset.rendered = 'true';
    }
    rendering = false; $('loading').hidden = true; document.querySelector(`.pdf-page[data-page="${desiredPage}"]`)?.scrollIntoView({ block: 'start' }); updatePageNumber(); notify('resume-pdf-ready', { pageCount: documentPdf.numPages });
  } catch (error) { if (generation === serial && error.name !== 'RenderingCancelledException' && error.name !== 'AbortException') fail(error); }
}
async function load() {
  ++serial; for (const task of activeTasks) task.cancel(); activeTasks.clear();
  await documentTask?.destroy(); documentPdf = undefined; pageNumber = 1; controls(false); $('viewer-error').hidden = true; $('loading').hidden = false;
  try {
    source = parseSource(); $('open-pdf').href = source; $('open-pdf').hidden = false;
    const response = await fetch(source, { cache: 'no-store' });
    if (!response.ok) {
      let message = 'PDF 未能载入，请重新生成预览。';
      if (response.headers.get('content-type')?.includes('application/json')) message = (await response.json()).error?.message || message;
      else message = (await response.text()).slice(0, 1000) || message;
      throw new Error(message);
    }
    documentTask = getDocument({ data: new Uint8Array(await response.arrayBuffer()), cMapUrl: '/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdfjs/standard_fonts/', wasmUrl: '/pdfjs/wasm/', useSystemFonts: false, isEvalSupported: false, enableXfa: false });
    documentPdf = await documentTask.promise;
    if (documentPdf.numPages > 2) throw new Error('简历预览最多支持两页');
    await render();
  } catch (error) { fail(error); }
}
for (const [id, delta] of [['page-prev', -1], ['page-next', 1]]) $(id).addEventListener('click', () => { document.querySelector(`.pdf-page[data-page="${pageNumber + delta}"]`)?.scrollIntoView({ block: 'start' }); updatePageNumber(); });
$('pages').addEventListener('scroll', updatePageNumber, { passive: true });
$('zoom').addEventListener('change', render); $('retry').addEventListener('click', load);
new ResizeObserver(() => { if ($('zoom').value === 'fit' && documentPdf) { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 120); } }).observe($('pages'));
window.addEventListener('pagehide', () => { for (const task of activeTasks) task.cancel(); documentTask?.destroy(); });
load();
