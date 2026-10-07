import { findResumeTheme } from './resume-themes.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const text = value => typeof value === 'string' && new TextEncoder().encode(value).length <= 500000;
  const finite = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
  const layout = payload.layout;
  const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(field => fields.includes(field));
  if (!exact(layout, ['schemaVersion', 'theme', 'preset', 'page', 'density', 'fontFamily', 'bodyPt', 'lineHeight', 'namePt', 'accent', 'sectionOrder', 'header', 'spacing', 'images']) || !exact(layout.page, ['size', 'marginMm', 'marginHorizontalMm', 'marginTopMm', 'marginBottomMm', 'maxPages']) || !exact(layout.header, ['gapMm', 'align', 'contactStyle']) || !exact(layout.spacing, ['sectionMm', 'entryMm']) || !exact(layout.images, ['portrait', 'schoolLogo'])) return false;
  if (!layout || layout.schemaVersion !== '0.2.0' || !['campus', 'experience'].includes(layout.preset) || !findResumeTheme(layout.theme) || layout.page?.size !== 'A4' || ![1, 2].includes(layout.page.maxPages) || !finite(layout.page.marginMm, 9, 18) || ['marginHorizontalMm', 'marginTopMm', 'marginBottomMm'].some(key => layout.page[key] !== undefined && !finite(layout.page[key], 8, 25)) || layout.density !== undefined && !['standard', 'compact'].includes(layout.density) || layout.fontFamily !== undefined && !['sans', 'serif'].includes(layout.fontFamily) || !finite(layout.bodyPt, 9.5, 11.5) || !finite(layout.namePt, 20, 24) || !finite(layout.lineHeight, 1.15, 1.5) || !/^#[0-9a-f]{6}$/i.test(layout.accent) || !finite(layout.header?.gapMm, 2, 8) || layout.header.align !== undefined && !['theme', 'left', 'center', 'spread'].includes(layout.header.align) || layout.header.contactStyle !== undefined && !['plain', 'labeled'].includes(layout.header.contactStyle) || !finite(layout.spacing?.sectionMm, 1.2, 5) || !finite(layout.spacing?.entryMm, 1.2, 5)) return false;
  for (const key of ['portrait', 'schoolLogo']) { const image = layout.images?.[key]; if (!exact(image, ['enabled', 'widthMm', 'heightMm', 'slot', 'align']) || typeof image.enabled !== 'boolean' || !finite(image.widthMm, 10, 40) || !finite(image.heightMm, 10, 40) || !['start', 'end'].includes(image.slot) || !['top', 'center', 'bottom'].includes(image.align)) return false; }
  if (layout.sectionOrder !== undefined && (!Array.isArray(layout.sectionOrder) || !layout.sectionOrder.length || !layout.sectionOrder.every(value => typeof value === 'string' && /^[a-z][a-z0-9-]*$/.test(value)))) return false;
  if (typeof payload.source === 'string') return text(payload.source);
  const front = payload.front, person = front?.person;
  if (!text(payload.baseSource) || !text(payload.body) || !person || !text(person.name) || !text(person.target) || !Array.isArray(person.contacts) || !person.contacts.length || person.contacts.length > 6 || !person.contacts.every(contact => text(contact?.text) && text(contact?.href))) return false;
  for (const key of ['portrait', 'schoolLogo']) if (front.assets?.[key] !== undefined && (!text(front.assets[key]?.src) || !text(front.assets[key]?.alt))) return false;
  return new TextEncoder().encode(JSON.stringify(payload)).length <= 1999000;
}
export function wireDraftRecovery({ request, getState, getPayload, isClean, applyDraft, toast }) {
  const $ = id => document.getElementById(id), prefix = 'tech-resume-draft:';
  const token = document.querySelector('meta[name=resume-token]').content;
  const writers = new Map(); let current, consumed, pending, timer, queue = Promise.resolve(), generation = 0, choices = [], deferred;
  const key = record => `${prefix}${record.scope}:${record.resumeId}:${record.id}`;
  const same = (a, b) => a && b && a.scope === b.scope && a.resumeId === b.resumeId && a.id === b.id;
  function status(message) { $('draft-status').textContent = message; $('draft-status').hidden = !message; }
  function cache(record) {
    try { localStorage.setItem(key(record), JSON.stringify(record)); return true; }
    catch { status('浏览器暂存不可用，正在尝试保存本地草稿文件。'); return false; }
  }
  function removeCache(record) {
    try { const existing = JSON.parse(localStorage.getItem(key(record)) || 'null'); if (existing?.sequence <= record.sequence) localStorage.removeItem(key(record)); } catch { /* File copies remain independent of browser storage. */ }
  }
  function cached(scope, resumeId) {
    const result = [];
    try {
      for (let index = 0; index < localStorage.length; index++) {
        const name = localStorage.key(index); if (!name?.startsWith(`${prefix}${scope}:${resumeId}:`)) continue;
        try {
          const item = JSON.parse(localStorage.getItem(name));
          if (item?.scope !== scope || item.resumeId !== resumeId || key(item) !== name || typeof item.id !== 'string' || !uuid.test(item.id) || !Number.isSafeInteger(item.sequence) || item.sequence < 1 || typeof item.baseRevision !== 'string' || !/^[0-9a-f]{64}$/.test(item.baseRevision) || item.cleared !== undefined && typeof item.cleared !== 'boolean' || item.cleared !== true && (!validPayload(item.payload) || typeof item.updatedAt !== 'string' || !Number.isFinite(Date.parse(item.updatedAt)))) throw new Error();
          result.push(item);
        } catch { status('部分浏览器草稿无法读取，原记录已保留。'); }
      }
    } catch { /* The file store still provides recovery when browser storage is disabled. */ }
    return result;
  }
  function enqueue(action) {
    const result = queue.then(action);
    queue = result.catch(() => {}); return result;
  }
  function persist(record) {
    return enqueue(async () => {
      try {
        const result = await request('/api/drafts/write', record);
        if (!result.stored) removeCache(record);
        if (same(current, record) && current.sequence === record.sequence) status(result.stored ? '草稿已暂存到本地。' : '');
      } catch (error) { if (same(current, record)) status(`草稿文件暂存失败：${error.message}。重启前可下载未保存草稿。`); }
    });
  }
  async function flush() { clearTimeout(timer); const latest = pending; pending = undefined; if (latest) persist(latest); await queue; }
  function render() {
    const state = getState(), candidate = choices.find(item => item.id === $('draft-choice').value) || choices[0];
    const clean = isClean(); $('draft-resume').disabled = !clean || !candidate; $('draft-delete').disabled = !clean || !candidate;
    $('draft-recovery').hidden = !choices.length || deferred === `${state?.draftScope}:${state?.resumeId}`;
    if (candidate) $('draft-description').textContent = (candidate.conflict ? '正式文件已发生变化。恢复后会保留冲突检查，请先确认内容；也可下载草稿另行恢复。' : '发现上次未保存的输入。选择恢复后回到编辑区，继续按原规则自动保存。') + (clean ? '' : ' 当前页面还有未保存修改，请先保存或下载后再恢复其他草稿。');
  }
  function capture() {
    const state = getState(); if (!state?.draftScope) return;
    const writerKey = `${state.draftScope}:${state.resumeId}`;
    let writer = writers.get(writerKey); if (!writer) { writer = { id: crypto.randomUUID(), sequence: 0 }; writers.set(writerKey, writer); }
    current = { scope: state.draftScope, resumeId: state.resumeId, id: writer.id, sequence: ++writer.sequence, baseRevision: state.revision, updatedAt: new Date().toISOString(), payload: structuredClone(getPayload()) };
    cache(current); pending = current; clearTimeout(timer); timer = setTimeout(flush, 150); render();
  }
  function clearRecord(record) {
    if (!record) return Promise.resolve();
    const tombstone = { scope: record.scope, resumeId: record.resumeId, id: record.id, sequence: record.sequence, baseRevision: record.baseRevision, cleared: true };
    try { const existing = JSON.parse(localStorage.getItem(key(record)) || 'null'); if (!existing || existing.sequence <= record.sequence) cache(tombstone); } catch { /* Clearing the file record remains available. */ }
    return enqueue(async () => { try { const result = await request('/api/drafts/clear', tombstone); removeCache(tombstone); return result; } catch (error) { status(`草稿清理尚未完成：${error.message}`); } });
  }
  function saved(record) {
    if (!record) return;
    if (same(current, record)) {
      if (current.sequence > record.sequence) capture();
      else { current = undefined; if (same(pending, record) && pending.sequence <= record.sequence) pending = undefined; status(''); }
    }
    clearRecord(record);
    if (consumed) { clearRecord(consumed); consumed = undefined; }
    queue.then(review);
  }
  function abandon() {
    clearTimeout(timer); pending = undefined;
    if (current) clearRecord(current); current = undefined;
    if (consumed) clearRecord(consumed); consumed = undefined;
  }
  async function review() {
    const state = getState(); if (!state?.draftScope) return;
    const turn = ++generation, { draftScope: scope, resumeId } = state;
    choices = []; $('draft-choice').replaceChildren(); render();
    const locals = cached(scope, resumeId), combined = new Map();
    for (const item of locals) {
      if (item.cleared !== true) combined.set(item.id, { ...item, conflict: item.baseRevision !== state.revision });
      try {
        const result = await enqueue(() => request(`/api/drafts/${item.cleared === true ? 'clear' : 'write'}`, item));
        if (item.cleared === true || !result.stored) { removeCache(item); combined.delete(item.id); }
      } catch { /* Preserve the browser copy for this origin when the file store cannot be reached. */ }
    }
    let warning = '';
    try {
      const result = await request('/api/drafts/list', { scope, resumeId }); warning = result.warning;
      for (const item of result.drafts) if (!combined.has(item.id) || combined.get(item.id).sequence < item.sequence) combined.set(item.id, item);
    } catch (error) { warning = `草稿文件暂时无法读取：${error.message}`; }
    if (turn !== generation || getState()?.draftScope !== scope || getState()?.resumeId !== resumeId) return;
    choices = [...combined.values()].filter(item => !same(item, current) && validPayload(item.payload)).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    const selected = $('draft-choice').value; $('draft-choice').replaceChildren();
    for (const item of choices) { const option = document.createElement('option'); option.value = item.id; option.textContent = `${new Date(item.updatedAt).toLocaleString()} · ${item.payload.front?.person?.name || '完整 Markdown 草稿'}`; $('draft-choice').append(option); }
    if (choices.some(item => item.id === selected)) $('draft-choice').value = selected;
    if (warning) status(warning); render();
  }
  $('draft-choice').addEventListener('change', render);
  $('draft-later').addEventListener('click', () => { const state = getState(); deferred = `${state.draftScope}:${state.resumeId}`; render(); });
  $('draft-resume').addEventListener('click', () => {
    const candidate = choices.find(item => item.id === $('draft-choice').value), state = getState();
    if (!candidate || !isClean() || candidate.scope !== state?.draftScope || candidate.resumeId !== state?.resumeId) return;
    if (!validPayload(candidate.payload)) { status('这个草稿无法读取，原记录已保留。'); return; }
    try { applyDraft(structuredClone(candidate)); consumed = candidate; choices = choices.filter(item => item.id !== candidate.id); }
    catch (error) { status(`草稿未恢复：${error.message}`); toast('草稿无法回填，原内容已保留。'); }
    render();
  });
  $('draft-delete').addEventListener('click', async () => {
    const candidate = choices.find(item => item.id === $('draft-choice').value), state = getState();
    if (!candidate || !isClean() || candidate.scope !== state?.draftScope || candidate.resumeId !== state?.resumeId || !confirm('删除这个未保存草稿？已保存的简历和其他草稿保持不变。')) return;
    $('draft-delete').disabled = true; await clearRecord(candidate); await review();
  });
  window.addEventListener('pagehide', () => {
    if (!current) return;
    const body = JSON.stringify(current); if (new TextEncoder().encode(body).length > 60000) return;
    fetch('/api/drafts/write', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', 'X-Resume-Token': token }, body }).catch(() => {});
  });
  return { capture, flush, saved, abandon, review, render, token: () => current && { ...current } };
}
