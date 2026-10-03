const $ = id => document.getElementById(id);

export function wireSectionOrder({ request, settle, edited, managed, operationPayload, acceptState, getState, isClean, errorUI }) {
  let sequence = 0, sections = [], order = [], renameChoice, cache;
  function invalidate() {
    sequence++; cache = undefined; sections = []; order = [];
    $('order-list').replaceChildren(); $('order-reset').disabled = true;
    $('order-status').textContent = '打开设置后读取当前简历的章节…';
  }
  function needsRefresh() { const state = getState(); return !cache || cache.resumeId !== state?.resumeId || cache.source !== state?.source; }
  function render() {
    $('order-list').replaceChildren();
    for (const [index, id] of order.entries()) {
      const section = sections.find(item => item.id === id);
      const row = document.createElement('div'); row.className = 'order-row'; row.dataset.sectionId = id; row.setAttribute('role', 'listitem');
      const title = document.createElement('span'); title.textContent = section?.title || id;
      const actions = document.createElement('div'); actions.className = 'order-actions';
      const rename = document.createElement('button'); rename.dataset.action = 'rename'; rename.textContent = '改名';
      rename.setAttribute('aria-label', `修改${title.textContent}章节名称`);
      rename.addEventListener('click', async () => {
        try {
          await settle();
          const state = getState(); renameChoice = { resumeId: state.resumeId, revision: state.revision, sectionId: id };
          $('section-title').value = title.textContent; $('section-title-error').hidden = true;
          $('section-title-dialog').showModal(); $('section-title').focus(); $('section-title').select();
        } catch (error) { $('order-status').textContent = `暂时无法修改章节名称：${error.message}`; }
      });
      actions.append(rename);
      for (const [action, change, label] of [['up', -1, '上移'], ['down', 1, '下移']]) {
        const button = document.createElement('button'); button.dataset.action = action; button.textContent = action === 'up' ? '↑' : '↓';
        button.setAttribute('aria-label', `${label}${title.textContent}`); button.disabled = index + change < 0 || index + change >= order.length;
        button.addEventListener('click', () => {
          const moved = [...order]; [moved[index], moved[index + change]] = [moved[index + change], moved[index]];
          order = moved; getState().layout.sectionOrder = [...moved]; edited(); render();
          const next = $('order-list').children[index + change];
          (next?.querySelector(`[data-action="${action}"]:not(:disabled)`) || next?.querySelector('button:not(:disabled)'))?.focus({ preventScroll: true });
        });
        actions.append(button);
      }
      row.append(title, actions); $('order-list').append(row);
    }
    $('order-reset').disabled = !getState()?.layout?.sectionOrder;
    $('order-status').textContent = '改名保留章节内容；使用箭头调整顺序，更换信息编排会恢复预设顺序。';
  }
  async function refresh({ saveFirst = true } = {}) {
    invalidate(); const requested = sequence;
    $('order-status').textContent = '正在读取章节…';
    try {
      if (saveFirst) await settle();
      if (requested !== sequence || !$('settings').open) return;
      if (!isClean()) { $('order-status').textContent = '请先修正并保存当前修改，再调整章节。'; return; }
      const state = getState(); if (!state) return;
      const result = await request(`/api/section-order?resumeId=${state.resumeId}&revision=${state.revision}`);
      if (requested !== sequence || !$('settings').open) return;
      if (!isClean()) { $('order-status').textContent = '请先修正并保存当前修改，再调整章节。'; return; }
      if (getState().resumeId !== result.resumeId || getState().revision !== result.revision) { refresh({ saveFirst }); return; }
      sections = result.sections; order = result.order; cache = { resumeId: state.resumeId, source: state.source }; render();
    } catch (error) {
      if (requested !== sequence) return;
      $('order-status').textContent = `暂时无法调整章节：${error.message}`;
      $('order-reset').disabled = !isClean() || !getState()?.layout?.sectionOrder;
    }
  }
  $('order-reset').addEventListener('click', async () => {
    const state = getState(); if (!state?.layout?.sectionOrder) return;
    delete state.layout.sectionOrder; edited(); await refresh();
  });
  $('section-title-dialog').addEventListener('close', () => renameChoice = undefined);
  $('section-title').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); $('section-title-submit').click(); } });
  $('section-title-submit').addEventListener('click', async () => {
    if (!renameChoice) return;
    $('section-title-error').hidden = true;
    try {
      const choice = renameChoice;
      await managed(async () => {
        const state = getState();
        if (choice.resumeId !== state.resumeId || choice.revision !== state.revision) throw new Error('正文或简历已变化，请关闭弹窗后重新选择章节');
        acceptState(await request('/api/sections/rename', { ...operationPayload(), sectionId: choice.sectionId, title: $('section-title').value }));
      });
      $('section-title-dialog').close();
    } catch (error) { errorUI.dialog('section', error); }
  });
  return { refresh, invalidate, needsRefresh };
}
