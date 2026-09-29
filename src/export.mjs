import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ResumeError } from './errors.mjs';
import { imageLabels } from './assets.mjs';

export async function inspectAndExport(rendered, { pdf = false } = {}) {
  let browser;
  let temporaryDirectory;
  try {
    try { browser = await chromium.launch({ headless: true }); }
    catch { throw new ResumeError(process.env.TECH_RESUME_PORTABLE ? 'Chromium 无法启动，请运行包内“检查环境”脚本，并按使用说明检查系统组件' : 'Chromium 无法启动；首次使用请运行 npx playwright install chromium（Linux 还可能需要 --with-deps）', { code: 'BROWSER' }); }
    const context = await browser.newContext({ offline: true });
    const page = await context.newPage();
    const requests = [];
    page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    const { layout } = rendered;
    const contentWidthPx = (210 - layout.page.marginMm * 2) * 96 / 25.4;
    const contentHeightPx = (297 - layout.page.marginMm * 2) * 96 / 25.4;
    await page.setViewportSize({ width: Math.ceil(contentWidthPx), height: Math.ceil(contentHeightPx) });
    await page.emulateMedia({ media: 'print' });
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'tech-resume-'));
    const htmlFile = path.join(temporaryDirectory, 'resume.html');
    await writeFile(htmlFile, rendered.html, { mode: 0o600 });
    await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'load' });
    const broken = await page.evaluate(async () => {
      await document.fonts.ready;
      if (![400, 600, 700].every(weight => document.fonts.check(`${weight} 14px "Resume Sans"`))) return 'font';
      for (const image of document.images) {
        try { await image.decode(); } catch { return image.dataset.asset; }
      }
      return null;
    });
    if (broken) throw new ResumeError(broken === 'font' ? '中文字体未加载' : `${imageLabels[broken]}图片解码失败，请重新保存为 PNG/JPEG`, { field: broken === 'font' ? 'font' : `assets.${broken}` });
    const metrics = await page.evaluate(() => {
      const sheet = document.querySelector('.sheet');
      const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right }; };
      const sheetRect = rect(sheet);
      const overflow = [];
      for (const element of sheet.querySelectorAll('*')) {
        const r = rect(element);
        if (r.right > sheetRect.right + 1 || r.x < sheetRect.x - 1 || element.scrollWidth > element.clientWidth + 2 && getComputedStyle(element).display !== 'inline') overflow.push(element.textContent.slice(0, 40) || element.className);
      }
      const walker = document.createTreeWalker(sheet, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (!node.textContent.trim()) continue;
        const range = document.createRange(); range.selectNodeContents(node);
        for (const r of range.getClientRects()) if (r.right > sheetRect.right + 1 || r.left < sheetRect.x - 1) overflow.push(node.textContent.slice(0, 40));
      }
      const identity = rect(document.querySelector('.identity'));
      const images = [...document.images].map(image => ({ asset: image.dataset.asset, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, ...rect(image) }));
      const overlap = images.some(image => image.x < identity.right - 1 && image.right > identity.x + 1);
      const headingGroups = [...sheet.querySelectorAll('.resume-header,h2,.entry-heading')].map(element => {
        const stack = element.nextElementSibling?.matches('.stack') ? element.nextElementSibling.getBoundingClientRect().height : 0;
        return { label: element.textContent.trim().slice(0, 60), height: rect(element).height + stack + 2 * parseFloat(getComputedStyle(sheet).lineHeight) + 12 };
      });
      return { sheet: sheetRect, identity, images, overlap, outOfBounds: [...new Set(overflow)], headingGroups, sections: [...sheet.querySelectorAll('section')].map(section => ({ title: section.querySelector('h2').textContent, ...rect(section) })), bodySize: getComputedStyle(sheet).fontSize };
    });
    if (requests.length) throw new ResumeError('文档包含外部资源请求，无法离线导出', { code: 'NETWORK' });
    if (metrics.overlap) throw new ResumeError('顶部图片与姓名或联系方式重叠，请减小图片尺寸或间距', { field: 'images', code: 'LAYOUT' });
    if (metrics.outOfBounds.length) throw new ResumeError(`横向溢出：${metrics.outOfBounds[0]}；请缩短不可断行内容或调整页眉配置`, { code: 'LAYOUT' });
    const oversizedHeading = metrics.headingGroups.find(heading => heading.height > contentHeightPx);
    if (oversizedHeading) throw new ResumeError(`页眉或标题过长，无法在一页中容纳并跟随正文：${oversizedHeading.label}；请缩短该字段。`, { code: 'LAYOUT' });
    // Continuous DOM height does not include pagination constraints. Count the
    // actual Chromium PDF, including on `check`, instead of guessing its pages.
    const pdfBuffer = await page.pdf({ preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false, scale: 1, tagged: true, outline: true });
    const actualPdf = await PDFDocument.load(pdfBuffer);
    const pageCount = actualPdf.getPageCount();
    if (pageCount > layout.page.maxPages) {
      const limit = layout.page.maxPages === 1 ? '一页' : `${layout.page.maxPages} 页`;
      throw new ResumeError(`实际 PDF 需要 ${pageCount} 页，超出${limit}上限；请精简内容或调整间距${layout.page.maxPages === 1 ? '，需要两页时设置 page.maxPages: 2' : ''}。字号不会自动缩小，现有 PDF 不会被覆盖。`, { field: 'page.maxPages', code: 'OVERFLOW' });
    }
    const warnings = [...rendered.warnings];
    if (pageCount > 1 && metrics.sheet.height < (pageCount - 0.7) * contentHeightPx) warnings.push('末页可能偏空，请查看实际预览；可精简内容、缩短链接显示文字或调整间距。');
    return { buffer: pdf ? pdfBuffer : undefined, warnings, metrics: { browser: browser.version(), offline: true, networkRequests: requests, contentWidthPx, contentHeightPx, pageCount, maxPages: layout.page.maxPages, warnings, pageSizesPt: actualPdf.getPages().map(page => page.getSize()), ...metrics } };
  } finally {
    await browser?.close();
    if (temporaryDirectory) {
      await unlink(path.join(temporaryDirectory, 'resume.html')).catch(() => {});
      await rmdir(temporaryDirectory).catch(() => {});
    }
  }
}
