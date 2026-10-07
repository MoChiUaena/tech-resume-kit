const fields = { 'person.name': ['name', '姓名'], 'person.target': ['target', '目标岗位'], 'person.label': ['label', '毕业届别 / 学历'], 'person.availability': ['availability', '城市 / 到岗时间'] };
const layoutFields = { theme: 'visual-theme', preset: 'preset', 'page.maxPages': 'max-pages', bodyPt: 'body-size', 'page.marginMm': 'margin', 'page.marginHorizontalMm': 'margin-horizontal', 'page.marginTopMm': 'margin-top', 'page.marginBottomMm': 'margin-bottom', accent: 'accent', namePt: 'name-size', lineHeight: 'line-height', 'spacing.sectionMm': 'section-spacing', 'spacing.entryMm': 'entry-spacing', density: 'density', fontFamily: 'font-family', 'header.align': 'header-align', 'header.contactStyle': 'contact-style', 'images.portrait.slot': 'portrait-slot' };
const layoutLabels = { namePt: '姓名字号', lineHeight: '行距', 'spacing.sectionMm': '章节间距', 'spacing.entryMm': '条目间距', bodyPt: '正文大小', 'page.marginMm': '统一页边距', 'page.marginHorizontalMm': '左右页边距', 'page.marginTopMm': '上边距', 'page.marginBottomMm': '下边距', density: '版面密度', fontFamily: '字体', 'header.align': '姓名与联系信息对齐', 'header.contactStyle': '联系方式展示', 'images.portrait.slot': '照片位置' };
const causes = { ENOSPC: '先尝试下载未保存草稿，释放磁盘空间后再重试。', EACCES: '先保留当前输入，检查数据目录的访问权限后再重试。', EPERM: '先保留当前输入，检查数据目录的访问权限或文件占用后再重试。', EROFS: '数据目录是只读的，请检查目录权限后再重试。', EBUSY: '关闭占用资料文件的程序后再重试；当前输入可先尝试下载为草稿。', ENOENT: '请确认资料文件和数据目录仍在原位置，当前输入先保留为草稿。' };
const own = (object, key) => typeof key === 'string' && Object.hasOwn(object, key) ? object[key] : undefined;
export function lineSelection(text, line) {
  if (typeof text !== 'string' || !Number.isSafeInteger(line) || line < 1) return null;
  let start = 0; for (let index = 1; index < line; index++) { const next = text.indexOf('\n', start); if (next < 0) return null; start = next + 1; }
  const next = text.indexOf('\n', start); return { start, end: next < 0 ? text.length : next };
}
export function describeEditorError(error, context = {}) {
  const data = error?.details || error || {}, field = typeof data.field === 'string' ? data.field : '', line = Number.isSafeInteger(data.line) && data.line > 0 ? data.line : undefined;
  const message = typeof error?.message === 'string' ? error.message : typeof error === 'string' ? error : '操作未完成';
  const file = typeof data.file === 'string' ? data.file.replaceAll('\\', '/').split('/').at(-1) : '';
  const person = own(fields, field), setting = own(layoutFields, field), cause = own(causes, data.cause);
  let target = null, label = person?.[1], hint = context.origin === 'save' ? '当前输入仍保留。可先尝试下载草稿，再重试保存。' : '请修正对应内容后等待预览更新。';
  if (data.code === 'CONFLICT') return { message, hint: '先下载未保存草稿，再重新载入确认其他窗口或文件的修改；不会自动覆盖。', target };
  if (cause) return { message, hint: cause, target };
  if (data.code === 'OVERFLOW') return { message, hint: '可精简内容、调整版式或明确允许两页；正文不会自动缩小。', target };
  if (data.reason === 'EMPTY_BODY' && (!file || file === 'resume.md')) return { message: `经历正文\n${message}`, hint: '请使用上方表单添加至少一个章节，或填写带章节标记的 Markdown。', target: context.sourceMode ? { type: 'end' } : { type: 'control', id: 'body' } };
  if (file === 'layout.yaml' || !file && setting) {
    if (setting) target = { type: 'layout', id: setting };
    label = own(layoutLabels, field) || label;
    hint = own(layoutLabels, field) ? '请到“版式与图片”调整对应设置，选择后会自动保存。' : '请检查版式配置中的对应设置，再尝试预览。';
  } else if (!file || file === 'resume.md') {
    if (context.sourceMode && line) target = { type: 'line', line };
    else if (person) target = { type: 'control', id: person[0] };
    else if (/^person\.contacts\.([0-5])\.(text|href)$/.test(field)) {
      const match = /^person\.contacts\.([0-5])\.(text|href)$/.exec(field); target = { type: 'contact', index: Number(match[1]), part: match[2] }; label = `第 ${target.index + 1} 项联系方式${target.part === 'href' ? '地址' : '显示内容'}`;
      hint = '填写有效的邮箱、电话或以 https:// 开头的链接；显示文字和链接地址分别填写。';
    } else if (/^assets\.(portrait|schoolLogo)(?:\.|$)/.test(field)) {
      const key = /^assets\.(portrait|schoolLogo)/.exec(field)[1]; target = { type: 'image', key }; label = key === 'portrait' ? '证件照' : '学校 Logo'; hint = '到“版式与图片”重新选择有效的 PNG / JPEG，或按需要关闭该图片。';
    } else if (line && typeof context.source === 'string') {
      const source = context.source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'), header = /^---\n[\s\S]*?\n---(?:\n|$)/.exec(source), offset = header ? header[0].split('\n').length - 1 : 0;
      if (line > offset && header) {
        const savedBody = source.slice(header[0].length), currentBody = typeof context.body === 'string' ? context.body.replace(/\r\n?/g, '\n') : savedBody;
        const savedCore = savedBody.trimStart(), currentCore = currentBody.trimStart(), selection = lineSelection(savedBody, line - offset);
        if (savedCore === currentCore && selection) {
          const at = selection.start + (currentBody.length - currentCore.length) - (savedBody.length - savedCore.length);
          if (at >= 0 && at <= currentBody.length) target = { type: 'line', line: currentBody.slice(0, at).split('\n').length };
        }
      }
      else if (context.clean) target = { type: 'source', line };
      hint = target?.type === 'source' ? '问题位于顶部元数据，可查看完整 Markdown 并修正对应行。' : '请修正 Markdown 的对应行，保留章节标记和单层列表结构。';
    }
  }
  return { message: [line ? `第 ${line} 行` : '', label || field, message].filter(Boolean).join('\n'), hint, target };
}
export function wireErrorGuidance({ getContext, openSettings, showSource }) {
  const $ = id => document.getElementById(id), records = new Map(), marked = new Map();
  function paintMark(element, mark) {
    if (mark.owners.size) { element.setAttribute('aria-invalid', 'true'); element.setAttribute('aria-describedby', [mark.previous['aria-describedby'], ...mark.owners.values()].filter(Boolean).join(' ')); }
    else { for (const [attribute, value] of Object.entries(mark.previous)) { if (value === null) element.removeAttribute(attribute); else element.setAttribute(attribute, value); } marked.delete(element); }
  }
  function clear(channel) {
    records.delete(channel); const guide = $(`${channel}-guidance`); if (guide) guide.hidden = true;
    for (const [element, mark] of marked) if (mark.owners.delete(channel)) paintMark(element, mark);
    if (['portrait', 'schoolLogo', 'crop'].includes(channel)) { const error = $(`${channel}-error`); error.hidden = true; error.textContent = ''; }
  }
  function invalidate(channel) {
    records.delete(channel); const button = $(`${channel}-locate`); if (button) button.hidden = true;
    for (const [element, mark] of marked) if (mark.owners.delete(channel)) paintMark(element, mark);
  }
  function mark(element, channel, description) {
    if (!element) return;
    if (!marked.has(element)) marked.set(element, { owners: new Map(), previous: { 'aria-invalid': element.getAttribute('aria-invalid'), 'aria-describedby': element.getAttribute('aria-describedby') } });
    const entry = marked.get(element); entry.owners.set(channel, description); paintMark(element, entry);
  }
  function control(target) {
    if (target.type === 'control' || target.type === 'layout') return $(target.id);
    if (target.type === 'image') return $(`${target.key}-picker`);
    if (['line', 'source', 'end'].includes(target.type)) return $('body');
    if (target.type === 'contact') { const row = $('contacts').children[target.index]; if (!row) return null; return target.part === 'href' && row.querySelector('select').value === 'url' ? row.querySelector('.contact-link') : row.querySelector('input:not(.contact-link)'); }
  }
  function fresh(record) { const now = getContext(); return now.resumeId && now.resumeId === record.context.resumeId && now.revision === record.context.revision && now.tick === record.context.tick && !now.actionBusy; }
  function reveal(element) { let parent = element.parentElement; while (parent) { if (parent.tagName === 'DETAILS') parent.open = true; parent = parent.parentElement; } element.scrollIntoView({ block: 'center' }); element.focus(); }
  function locate(channel) {
    const record = records.get(channel); if (!record || !fresh(record)) { clear(channel); return; }
    const target = describeEditorError(record.error, getContext()).target; if (!target) return;
    if (target.type === 'source') { if (!getContext().clean) return; showSource(); }
    if (['image', 'layout'].includes(target.type)) openSettings();
    const element = control(target); if (!element || element.disabled || element.hidden) return;
    if (target.type === 'end') { reveal(element); element.setSelectionRange(element.value.length, element.value.length); element.scrollTop = element.scrollHeight; }
    else if (target.type === 'line' || target.type === 'source') {
      const selection = lineSelection(element.value, target.line); if (!selection) return;
      reveal(element); element.setSelectionRange(selection.start, selection.end);
      const height = parseFloat(getComputedStyle(element).lineHeight) || 24; element.scrollTop = Math.max(0, (target.line - 1) * height - element.clientHeight / 3);
    } else reveal(element);
    mark(element, channel, channel === 'save' ? 'save-error-message' : 'preview-error');
  }
  for (const channel of ['save', 'preview']) {
    const guide = document.createElement('div'); guide.id = `${channel}-guidance`; guide.className = 'error-guidance'; guide.hidden = true;
    const hint = document.createElement('p'); hint.id = `${channel}-hint`; const button = document.createElement('button'); button.id = `${channel}-locate`; button.textContent = '定位到问题'; button.addEventListener('click', () => locate(channel));
    guide.append(hint, button); $(channel === 'save' ? 'save-error-message' : 'preview-error').after(guide);
  }
  for (const key of ['portrait', 'schoolLogo']) {
    const input = $(`${key}-upload`), picker = input.parentElement; picker.id = `${key}-picker`; picker.tabIndex = 0; picker.setAttribute('role', 'button');
    picker.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key) && !input.disabled) { event.preventDefault(); input.click(); } });
    const error = document.createElement('p'); error.id = `${key}-error`; error.className = 'form-error image-error'; error.setAttribute('role', 'alert'); error.hidden = true; $(`${key}-file`).after(error);
  }
  const cropError = document.createElement('p'); cropError.id = 'crop-error'; cropError.className = 'form-error'; cropError.setAttribute('role', 'alert'); cropError.hidden = true; $('crop-apply').parentElement.before(cropError);
  function show(channel, error) {
    clear(channel); const context = getContext(), view = describeEditorError(error, { ...context, origin: channel });
    $(channel === 'save' ? 'save-error-message' : 'preview-error').textContent = view.message;
    $(`${channel}-hint`).textContent = view.hint; $(`${channel}-locate`).hidden = !view.target || !context.resumeId; $(`${channel}-guidance`).hidden = false;
    records.set(channel, { error, context });
  }
  function dialog(kind, error) {
    const dialogId = kind === 'section' ? 'section-title-dialog' : `${kind}-dialog`; if (!$(dialogId)?.open) return;
    clear(kind); const data = error?.details || error, field = data?.field;
    const ids = { entry: { title: 'entry-title', subtitle: 'entry-subtitle', date: 'entry-date', stack: 'entry-stack', content: 'entry-details', details: 'entry-details' }, content: { label: 'content-label', title: 'content-title', text: 'content-text', content: 'content-text' }, section: { title: 'section-title' } };
    const group = own(ids, kind); if (!group) return;
    const errorId = kind === 'section' ? 'section-title-error' : `${kind}-error`; $(errorId).textContent = error.message; $(errorId).hidden = false;
    const element = $(own(group, field)); if (element && !element.disabled && !element.closest('[hidden]')) { mark(element, kind, errorId); reveal(element); }
  }
  function image(key, error, crop = false) {
    clear(key); const label = key === 'portrait' ? '证件照' : '学校 Logo';
    if (crop) { clear('crop'); $('crop-error').textContent = `照片更新未完成：${error.message}。可再次点击“保存照片”重试，或取消裁剪。`; $('crop-error').hidden = false; return; }
    $(`${key}-error`).textContent = `${label}更新未完成：${error.message}。请检查文件后重新选择，支持 PNG / JPEG、最大 5 MB。`; $(`${key}-error`).hidden = false; mark($(`${key}-picker`), key, `${key}-error`);
  }
  for (const [kind, id] of [['entry', 'entry-dialog'], ['content', 'content-dialog'], ['section', 'section-title-dialog']]) { $(id).addEventListener('input', () => clear(kind)); $(id).addEventListener('close', () => clear(kind)); }
  $('crop-dialog').addEventListener('close', () => clear('crop'));
  return { show, dialog, image, clear, invalidate, clearAll: () => { for (const channel of ['save', 'preview', 'entry', 'content', 'section', 'portrait', 'schoolLogo', 'crop']) clear(channel); } };
}
