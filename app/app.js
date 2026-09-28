const $ = id => document.getElementById(id), token = document.querySelector('meta[name=resume-token]').content;
let state, tick = 0, savedTick = 0, busy = false, pending = false, timer, previewSequence = 0, sourceMode = false;
async function request(url, data, raw = false) {
  const options = data === undefined ? {} : { method: 'POST', headers: { 'X-Resume-Token': token, ...(raw ? {} : { 'Content-Type': 'application/json' }) }, body: raw ? data : JSON.stringify(data) };
  const response = await fetch(url, options), result = await response.json();
  if (!response.ok) { const error = new Error(result.error?.message || '操作失败'); error.code = result.error?.code; error.details = result.error; throw error; }
  return result;
}
function toast(text) { $('toast').textContent = text; $('toast').hidden = false; setTimeout(() => $('toast').hidden = true, 5000); }
function edited() { tick++; $('save-status').textContent = '正在保存…'; $('page-status').textContent = '正在更新'; $('pdf-download').disabled = true; clearTimeout(timer); timer = setTimeout(save, 700); }
function renderContacts() {
  $('contacts').replaceChildren();
  if (sourceMode) { $('contact-add').disabled = true; return; }
  for (const [index, contact] of (state.front?.person?.contacts || []).entries()) {
    const row = document.createElement('div'); row.className = 'contact-row';
    const select = document.createElement('select'); select.setAttribute('aria-label', `联系方式 ${index + 1} 类型`);
    for (const [key, text] of [['email', '邮箱'], ['phone', '电话'], ['url', '链接']]) { const option = document.createElement('option'); option.value = key; option.textContent = text; select.append(option); }
    select.value = contact.href.startsWith('mailto:') ? 'email' : contact.href.startsWith('tel:') ? 'phone' : 'url';
    const input = document.createElement('input'); input.value = contact.text; input.setAttribute('aria-label', `联系方式 ${index + 1} 显示内容`);
    const link = document.createElement('input'); link.value = contact.href; link.className = 'contact-link'; link.placeholder = 'https://example.com'; link.setAttribute('aria-label', `联系方式 ${index + 1} 链接地址`); link.hidden = select.value !== 'url';
    function update() { contact.text = input.value; contact.href = select.value === 'email' ? `mailto:${input.value.trim()}` : select.value === 'phone' ? `tel:${input.value.replace(/\s/g, '')}` : link.value; edited(); }
    input.addEventListener('input', update); link.addEventListener('input', update); select.addEventListener('change', () => { link.hidden = select.value !== 'url'; update(); });
    const remove = document.createElement('button'); remove.textContent = '×'; remove.setAttribute('aria-label', `删除联系方式 ${index + 1}`); remove.disabled = state.front.person.contacts.length === 1;
    remove.addEventListener('click', () => { state.front.person.contacts.splice(index, 1); renderContacts(); edited(); });
    row.append(select, input, remove, link); $('contacts').append(row);
  }
  $('contact-add').disabled = sourceMode || state.front.person.contacts.length >= 6;
}
function populate() {
  const person = state.front?.person;
  sourceMode = !person || typeof person.name !== 'string' || typeof person.target !== 'string' || !Array.isArray(person.contacts) || !person.contacts.length || !person.contacts.every(contact => typeof contact?.text === 'string' && typeof contact?.href === 'string');
  $('person-fields').hidden = sourceMode; $('contacts').hidden = sourceMode;
  for (const field of ['name', 'target', 'label', 'availability']) $(field).value = state.front?.person?.[field] || '';
  $('body').value = sourceMode ? state.source : state.body; renderContacts();
  $('body').setSelectionRange(0, 0); $('body').scrollTop = 0;
  $('source-mode').textContent = sourceMode ? '返回正文编辑' : '完整 Markdown';
  $('preset').value = state.layout.preset; $('max-pages').value = state.layout.page.maxPages; $('body-size').value = state.layout.bodyPt; $('margin').value = state.layout.page.marginMm; $('accent').value = state.layout.accent;
  for (const key of ['portrait', 'schoolLogo']) { const asset = state.front?.assets?.[key]; $(`${key}-enabled`).checked = state.layout.images[key].enabled; $(`${key}-enabled`).disabled = !asset; $(`${key}-file`).textContent = asset ? asset.src.split('/').at(-1) : '尚未选择'; }
}
async function refreshPreview(revision, expectedTick = tick) {
  const sequence = ++previewSequence; $('page-status').textContent = '正在排版…'; $('pdf-download').disabled = true;
  try {
    const result = await request(`/api/preview?revision=${revision}`);
    if (sequence !== previewSequence || tick !== expectedTick) return;
    $('pdf-frame').src = `/document.pdf?revision=${result.revision}#view=FitH`;
    $('pdf-frame').hidden = false; $('preview-placeholder').hidden = true; $('preview-error').hidden = true;
    $('page-status').textContent = `${result.pageCount} 页 · A4`; $('pdf-download').disabled = false;
    $('preview-note').hidden = !result.warnings.length; $('preview-note').textContent = result.warnings.join(' ');
  } catch (error) {
    if (sequence !== previewSequence || tick !== expectedTick) return;
    $('pdf-frame').hidden = true; $('pdf-frame').removeAttribute('src'); $('preview-placeholder').hidden = true; $('preview-note').hidden = true;
    $('preview-error').hidden = false; $('preview-error').textContent = [error.details?.line ? `第 ${error.details.line} 行` : '', error.details?.field ? `字段 ${error.details.field}` : '', error.message].filter(Boolean).join('\n'); $('page-status').textContent = '需要调整内容';
  }
}
async function save() {
  if (busy) { pending = true; return; } if (tick === savedTick) return;
  busy = true; const captured = tick;
  try {
    const payload = { revision: state.revision, layout: state.layout, ...(sourceMode ? { source: $('body').value } : { front: state.front, body: $('body').value }) };
    const result = await request('/api/save', payload); state.revision = result.revision; state.source = result.source; savedTick = captured;
    $('save-status').textContent = '已自动保存';
    if (tick === captured) refreshPreview(result.revision, captured); else pending = true;
  } catch (error) { $('save-status').textContent = '保存失败'; toast(error.message); pending = false; }
  finally { busy = false; if (pending && tick !== savedTick) { pending = false; save(); } }
}
async function settle() { clearTimeout(timer); await save(); while (busy) await new Promise(resolve => setTimeout(resolve, 60)); if (tick !== savedTick) throw new Error('内容尚未保存，请先修正保存错误'); }
function download(contents, filename, type) { const blob = new Blob([contents], { type }); const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
for (const input of document.querySelectorAll('[data-person]')) input.addEventListener('input', () => { const key = input.dataset.person; if (input.value || ['name', 'target'].includes(key)) state.front.person[key] = input.value; else delete state.front.person[key]; edited(); });
$('body').addEventListener('input', edited);
$('source-mode').addEventListener('click', async () => {
  try {
    await settle(); state = await request('/api/state');
    if (sourceMode) populate();
    else { sourceMode = true; $('body').value = state.source; $('person-fields').hidden = true; $('contacts').hidden = true; $('contact-add').disabled = true; $('source-mode').textContent = '返回正文编辑'; }
  } catch (error) { toast(error.message); }
});
$('contact-add').addEventListener('click', () => { state.front.person.contacts.push({ text: '', href: 'mailto:' }); renderContacts(); edited(); });
$('settings-open').addEventListener('click', () => $('settings').showModal());
for (const [id, apply] of Object.entries({ preset: value => { state.layout.preset = value; delete state.layout.sectionOrder; }, 'max-pages': value => state.layout.page.maxPages = Number(value), 'body-size': value => state.layout.bodyPt = Number(value), margin: value => state.layout.page.marginMm = Number(value), accent: value => state.layout.accent = value })) $(id).addEventListener('change', event => { apply(event.target.value); edited(); });
for (const key of ['portrait', 'schoolLogo']) {
  $(`${key}-enabled`).addEventListener('change', event => { state.layout.images[key].enabled = event.target.checked; edited(); });
  $(`${key}-upload`).addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    try { if (file.size > 5_000_000) throw new Error('图片请控制在 5 MB 以内'); if (sourceMode) throw new Error('请先返回正文编辑，再选择图片'); const asset = await request(`/api/image/${key}`, file, true); state.front.assets ||= {}; state.front.assets[key] = asset; state.layout.images[key].enabled = true; $(`${key}-enabled`).checked = true; $(`${key}-enabled`).disabled = false; $(`${key}-file`).textContent = file.name; edited(); } catch (error) { toast(error.message); } event.target.value = '';
  });
}
$('markdown-download').addEventListener('click', async () => { try { await settle(); download(state.source, `${state.front?.person?.name || '我的'}-简历.md`, 'text/markdown;charset=utf-8'); } catch (error) { toast(error.message); } });
$('pdf-download').addEventListener('click', async () => { try { await settle(); await request(`/api/preview?revision=${state.revision}`); const a = document.createElement('a'); a.href = `/document.pdf?revision=${state.revision}&download=1`; a.download = 'resume.pdf'; a.click(); } catch (error) { toast(error.message); } });
$('reload').addEventListener('click', async () => { if (tick !== savedTick && !confirm('重新载入会放弃尚未保存的修改，继续吗？')) return; try { state = await request('/api/state'); tick = savedTick = 0; populate(); $('save-status').textContent = '已载入本地文件'; refreshPreview(state.revision); } catch (error) { toast(error.message); } });
$('import').addEventListener('change', async event => { const file = event.target.files[0]; if (!file) return; if (!confirm('导入将替换当前内容。请先导出 Markdown 备份，继续吗？')) return; try { await settle(); state = await request('/api/save', { revision: state.revision, source: await file.text(), layout: state.layout }); tick = savedTick = 0; populate(); refreshPreview(state.revision); } catch (error) { toast(error.message); } event.target.value = ''; });
$('template').addEventListener('change', () => $('replace-dialog').showModal());
$('replace-cancel').addEventListener('click', () => $('replace-dialog').close());
$('replace-confirm').addEventListener('click', async () => { try { await settle(); state = await request('/api/template', { revision: state.revision, template: $('template').value }); tick = savedTick = 0; populate(); $('replace-dialog').close(); refreshPreview(state.revision); toast('已切换，原内容已备份'); } catch (error) { toast(error.message); } });
$('exit').addEventListener('click', async () => { try { await settle(); await request('/api/exit', {}); document.body.replaceChildren(); const note = document.createElement('p'); note.textContent = '已保存并退出，可以关闭此页面。'; document.body.append(note); } catch (error) { toast(error.message); } });
document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save(); } });
window.addEventListener('beforeunload', event => { if (tick !== savedTick) { event.preventDefault(); event.returnValue = ''; } });
setInterval(() => fetch('/api/ping').catch(() => { $('save-status').textContent = '应用已退出，请重新启动'; }), 20_000);
request('/api/state').then(result => { state = result; populate(); $('save-status').textContent = '已载入本地文件'; refreshPreview(state.revision); }).catch(error => { $('save-status').textContent = '载入失败'; $('preview-error').hidden = false; $('preview-error').textContent = error.message; });
