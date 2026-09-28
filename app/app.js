const $ = id => document.getElementById(id), token = document.querySelector('meta[name=resume-token]').content;
let state, tick = 0, savedTick = 0, busy = false, pending = false, timer, previewSequence = 0, sourceMode = false, actionBusy = false, resumeAction, restoreChoice, previewReady = false;
const pendingUploads = new Set();
async function request(url, data, raw = false) {
  const options = data === undefined ? {} : { method: 'POST', headers: { 'X-Resume-Token': token, ...(raw ? { 'X-Resume-Id': state.resumeId, 'X-Resume-Revision': state.revision } : { 'Content-Type': 'application/json' }) }, body: raw ? data : JSON.stringify({ resumeId: state?.resumeId, ...data }) };
  const response = await fetch(url, options), result = await response.json();
  if (!response.ok) { const error = new Error(result.error?.message || '操作失败'); error.code = result.error?.code; error.details = result.error; throw error; }
  return result;
}
function toast(text) { $('toast').textContent = text; $('toast').hidden = false; setTimeout(() => $('toast').hidden = true, 5000); }
function edited() { if (actionBusy) return; tick++; previewReady = false; $('save-status').textContent = '正在保存…'; $('page-status').textContent = '正在更新'; $('pdf-download').disabled = true; clearTimeout(timer); timer = setTimeout(save, 700); }
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
  $('resume-select').replaceChildren();
  for (const resume of state.resumes || []) { const option = document.createElement('option'); option.value = resume.id; option.textContent = resume.name; $('resume-select').append(option); }
  $('resume-select').value = state.resumeId;
  $('template').value = '';
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
  const sequence = ++previewSequence, resumeId = state.resumeId; previewReady = false; $('page-status').textContent = '正在排版…'; $('pdf-download').disabled = true;
  try {
    const result = await request(`/api/preview?revision=${revision}&resumeId=${resumeId}`);
    if (sequence !== previewSequence || tick !== expectedTick || state.resumeId !== resumeId) return;
    $('pdf-frame').src = `/document.pdf?revision=${result.revision}&resumeId=${resumeId}#view=FitH`;
    $('pdf-frame').hidden = false; $('preview-placeholder').hidden = true; $('preview-error').hidden = true;
    $('page-status').textContent = `${result.pageCount} 页 · A4`; previewReady = true; $('pdf-download').disabled = false;
    $('preview-note').hidden = !result.warnings.length; $('preview-note').textContent = result.warnings.join(' ');
  } catch (error) {
    if (sequence !== previewSequence || tick !== expectedTick || state.resumeId !== resumeId) return;
    $('pdf-frame').hidden = true; $('pdf-frame').removeAttribute('src'); $('preview-placeholder').hidden = true; $('preview-note').hidden = true;
    $('preview-error').hidden = false; $('preview-error').textContent = [error.details?.line ? `第 ${error.details.line} 行` : '', error.details?.field ? `字段 ${error.details.field}` : '', error.message].filter(Boolean).join('\n'); $('page-status').textContent = '需要调整内容';
  }
}
async function save() {
  if (busy) { pending = true; return; } if (tick === savedTick) return;
  busy = true; const captured = tick;
  try {
    const payload = { resumeId: state.resumeId, revision: state.revision, layout: state.layout, ...(sourceMode ? { source: $('body').value } : { front: state.front, body: $('body').value }) };
    const result = await request('/api/save', payload); state.revision = result.revision; state.source = result.source; savedTick = captured;
    $('save-status').textContent = '已自动保存';
    if (tick === captured) refreshPreview(result.revision, captured); else pending = true;
  } catch (error) { $('save-status').textContent = '保存失败'; toast(error.message); pending = false; }
  finally { busy = false; if (pending && tick !== savedTick) { pending = false; save(); } }
}
async function settle() { await Promise.all([...pendingUploads]); clearTimeout(timer); await save(); while (busy) await new Promise(resolve => setTimeout(resolve, 60)); if (tick !== savedTick) throw new Error('内容尚未保存，请先修正保存错误'); }
async function managed(action) {
  if (actionBusy) return;
  await settle(); if (actionBusy) return; actionBusy = true;
  const controls = [...document.querySelectorAll('input,select,textarea,button')].map(element => [element, element.disabled]);
  for (const [element] of controls) element.disabled = true;
  try { return await action(); }
  finally {
    actionBusy = false; for (const [element, disabled] of controls) if (element.isConnected) element.disabled = disabled;
    $('pdf-download').disabled = !previewReady;
    for (const key of ['portrait','schoolLogo']) $(`${key}-enabled`).disabled = !state.front?.assets?.[key];
    $('contact-add').disabled = sourceMode || state.front.person.contacts.length >= 6;
  }
}
function acceptState(result) { state = result; tick = savedTick = 0; previewSequence++; $('pdf-frame').hidden = true; $('pdf-frame').removeAttribute('src'); populate(); $('save-status').textContent = '已载入本地文件'; $('pdf-download').disabled = true; refreshPreview(state.revision); }
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
    const resumeId = state.resumeId;
    const upload = (async () => { if (file.size > 5_000_000) throw new Error('图片请控制在 5 MB 以内'); if (sourceMode) throw new Error('请先返回正文编辑，再选择图片'); const asset = await request(`/api/image/${key}`, file, true); if (state.resumeId !== resumeId) return; state.front.assets ||= {}; state.front.assets[key] = asset; state.layout.images[key].enabled = true; $(`${key}-enabled`).checked = true; $(`${key}-enabled`).disabled = false; $(`${key}-file`).textContent = file.name; edited(); })();
    pendingUploads.add(upload); try { await upload; } catch (error) { toast(error.message); } finally { pendingUploads.delete(upload); event.target.value = ''; }
  });
}
$('markdown-download').addEventListener('click', async () => { try { await settle(); download(state.source, `${state.front?.person?.name || '我的'}-简历.md`, 'text/markdown;charset=utf-8'); } catch (error) { toast(error.message); } });
$('pdf-download').addEventListener('click', async () => { try { await settle(); await request(`/api/preview?revision=${state.revision}&resumeId=${state.resumeId}`); const a = document.createElement('a'); a.href = `/document.pdf?revision=${state.revision}&resumeId=${state.resumeId}&download=1`; a.download = 'resume.pdf'; a.click(); } catch (error) { toast(error.message); } });
$('reload').addEventListener('click', async () => { if (tick !== savedTick && !confirm('重新载入会放弃尚未保存的修改，继续吗？')) return; try { state = await request('/api/state'); tick = savedTick = 0; populate(); $('save-status').textContent = '已载入本地文件'; refreshPreview(state.revision); } catch (error) { toast(error.message); } });
$('import').addEventListener('change', async event => { const file = event.target.files[0]; if (!file) return; if (!confirm('导入前会先备份当前内容，继续吗？')) return; try { await managed(async () => acceptState(await request('/api/save', { revision: state.revision, source: await file.text(), layout: state.layout, importing: true }))); } catch (error) { toast(error.message); } event.target.value = ''; });
$('template').addEventListener('change', () => $('replace-dialog').showModal());
$('replace-cancel').addEventListener('click', () => { $('replace-dialog').close(); $('template').value = ''; });
$('replace-confirm').addEventListener('click', async () => { try { await managed(async () => { acceptState(await request('/api/template', { revision: state.revision, template: $('template').value })); $('replace-dialog').close(); }); toast('已切换，原内容与图片已备份'); } catch (error) { toast(error.message); } });
$('exit').addEventListener('click', async () => { try { await settle(); await request('/api/exit', {}); document.body.replaceChildren(); const note = document.createElement('p'); note.textContent = '已保存并退出，可以关闭此页面。'; document.body.append(note); } catch (error) { toast(error.message); } });
document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save(); } });
window.addEventListener('beforeunload', event => { if (tick !== savedTick) { event.preventDefault(); event.returnValue = ''; } });
setInterval(() => fetch('/api/ping').catch(() => { $('save-status').textContent = '应用已退出，请重新启动'; }), 20_000);
request('/api/state').then(result => { state = result; populate(); $('save-status').textContent = '已载入本地文件'; refreshPreview(state.revision); }).catch(error => { $('save-status').textContent = '载入失败'; $('preview-error').hidden = false; $('preview-error').textContent = error.message; });

function operationPayload() { return { resumeId: state.resumeId, revision: state.revision, libraryRevision: state.libraryRevision }; }
function suggestedName(base) { let proposal = base, index = 2; while (state.resumes.some(resume => resume.name === proposal)) proposal = `${base} ${index++}`; return proposal; }
for (const [id, action] of [['resume-create','create'],['resume-copy','duplicate'],['resume-rename','rename']]) $(id).addEventListener('click', () => {
  resumeAction = action;
  $('resume-dialog-title').textContent = { create:'新建简历', duplicate:'复制简历', rename:'重命名简历' }[action];
  $('resume-submit').textContent = { create:'新建', duplicate:'复制', rename:'保存名称' }[action];
  $('resume-template-field').hidden = action !== 'create';
  $('resume-name').value = action === 'rename' ? state.resumeName : suggestedName(action === 'create' ? '新简历' : state.resumeName + ' 副本');
  $('resume-dialog-help').textContent = action === 'duplicate' ? '正文、版式和图片会复制到独立目录，原简历保持不变。' : action === 'rename' ? '只修改列表中的名称，简历内容保持不变。' : '新简历独立保存，当前内容保持不变。';
  $('resume-dialog').showModal(); $('resume-name').select();
});
$('resume-submit').addEventListener('click', async () => {
  try { await managed(async () => { const result = await request(`/api/resumes/${resumeAction}`, { ...operationPayload(), name: $('resume-name').value, template: $('resume-template').value }); acceptState(result); $('resume-dialog').close(); }); }
  catch (error) { toast(error.message); }
});
$('resume-select').addEventListener('change', async event => {
  const targetId = event.target.value;
  try { await managed(async () => acceptState(await request('/api/resumes/switch', { ...operationPayload(), targetId }))); }
  catch (error) { $('resume-select').value = state.resumeId; toast(error.message); }
});
function backupDownload(backupId) { const link = document.createElement('a'); link.href = `/backup.zip?resumeId=${state.resumeId}&backupId=${backupId}`; link.download = 'resume-backup.zip'; link.click(); }
async function loadHistory() {
  const resumeId = state.resumeId, result = await request(`/api/history?resumeId=${resumeId}`);
  if (resumeId !== state.resumeId) return;
  $('history-description').textContent = `${state.resumeName} · ${result.backups.length} 个版本`;
  if (result.warning) { $('history-description').textContent += ` · ${result.warning}`; $('history-description').classList.add('history-warning'); } else $('history-description').classList.remove('history-warning');
  $('history-list').replaceChildren();
  if (!result.backups.length) { const empty = document.createElement('p'); empty.className = 'history-empty'; empty.textContent = '还没有历史版本，点击“立即备份”保留当前内容。'; $('history-list').append(empty); }
  for (const backup of result.backups) {
    const item = document.createElement('div'); item.className = 'history-item'; item.setAttribute('role', 'listitem');
    const content = document.createElement('div'), heading = document.createElement('strong'), description = document.createElement('small');
    heading.textContent = new Date(backup.createdAt).toLocaleString(); description.textContent = `${backup.label} · ${(backup.size / 1024).toFixed(0)} KB`; content.append(heading, description);
    if (backup.missingAssets?.length) { const warning = document.createElement('small'); warning.className = 'history-warning'; warning.textContent = `${backup.missingAssets.length} 项图片未找到，已保存现有文件状态`; content.append(warning); }
    const buttons = document.createElement('div'); buttons.className = 'history-buttons';
    const downloadButton = document.createElement('button'); downloadButton.textContent = '下载'; downloadButton.addEventListener('click', () => backupDownload(backup.id));
    const restoreButton = document.createElement('button'); restoreButton.textContent = '恢复'; restoreButton.addEventListener('click', () => { restoreChoice = { backupId: backup.id, resumeId }; $('restore-description').textContent = `将“${state.resumeName}”恢复到 ${new Date(backup.createdAt).toLocaleString()} 的内容。`; $('restore-dialog').showModal(); });
    buttons.append(downloadButton, restoreButton); item.append(content, buttons); $('history-list').append(item);
  }
}
$('history-open').addEventListener('click', async () => { try { await settle(); await loadHistory(); $('history-dialog').showModal(); } catch (error) { toast(error.message); } });
$('backup-create').addEventListener('click', async () => { try { await managed(async () => { await request('/api/backup', operationPayload()); await loadHistory(); }); toast('已备份正文、版式和图片'); } catch (error) { toast(error.message); } });
$('backup-export').addEventListener('click', async () => { try { await managed(async () => { const backup = await request('/api/backup', operationPayload()); backupDownload(backup.id); await loadHistory(); }); } catch (error) { toast(error.message); } });
$('backup-import').addEventListener('change', async event => { const file = event.target.files[0]; if (!file) return; if (file.size > 32000000) { toast('备份文件请控制在 32 MB 以内'); return; } restoreChoice = { file, resumeId: state.resumeId }; $('restore-description').textContent = `将“${state.resumeName}”恢复为 ${file.name} 中的内容。`; $('restore-dialog').showModal(); });
$('restore-cancel').addEventListener('click', () => { $('restore-dialog').close(); $('backup-import').value = ''; });
$('restore-confirm').addEventListener('click', async () => {
  try { await managed(async () => { if (restoreChoice.resumeId !== state.resumeId) throw new Error('简历已经切换，请重新选择备份'); const result = restoreChoice.file ? await request('/api/restore-upload', restoreChoice.file, true) : await request('/api/restore', { ...operationPayload(), backupId: restoreChoice.backupId }); acceptState(result); $('restore-dialog').close(); $('backup-import').value = ''; await loadHistory(); }); toast('已恢复，恢复前的内容也已保留'); }
  catch (error) { toast(error.message); }
});
