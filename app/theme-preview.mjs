import { findResumeTheme } from './resume-themes.mjs';

export function wireThemePreview() {
  const dialog = document.getElementById('theme-preview-dialog'), frame = document.getElementById('theme-preview-frame');
  const title = document.getElementById('theme-preview-title'), use = document.getElementById('theme-preview-use');
  let current, choose, opener;
  window.addEventListener('message', event => {
    if (!dialog.open || !current || event.origin !== location.origin || event.source !== frame.contentWindow || event.data?.type !== 'resume-pdf-escape' || event.data.source !== current.previewPdf) return;
    dialog.close();
  });
  dialog.addEventListener('close', () => {
    frame.src = 'about:blank'; current = undefined; choose = undefined;
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  });
  use.addEventListener('click', () => { if (current) choose?.(current.id); dialog.close(); });
  return {
    open(id, onChoose) {
      const theme = findResumeTheme(id); if (!theme) throw new RangeError('请选择有效的外观模板');
      current = theme; choose = onChoose; opener = document.activeElement;
      title.textContent = theme.label + ' · 完整效果';
      frame.src = '/pdf-viewer.html?file=' + encodeURIComponent(theme.previewPdf);
      dialog.showModal();
    },
  };
}
