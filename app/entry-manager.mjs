const $ = id => document.getElementById(id);

export function wireEntries({ request, managed, operationPayload, acceptState, getState, isSourceMode, isClean, toast, errorUI }) {
  let sequence = 0, editChoice, deleteChoice;
  function invalidate() {
    sequence++;
    for (const button of $('entry-list').querySelectorAll('button')) button.disabled = true;
    $('entry-list-status').textContent = isSourceMode() ? '返回正文编辑后，可管理已有经历。' : '保存后自动更新经历列表。';
    $('entry-list-status').hidden = false;
  }
  function checkChoice(choice) {
    const state = getState();
    if (isSourceMode() || choice.resumeId !== state.resumeId || choice.revision !== state.revision) throw new Error('正文或简历已变化，请关闭弹窗后重新选择经历');
  }
  async function change(choice, action, input) {
    await managed(async () => {
      checkChoice(choice);
      acceptState(await request('/api/entries/change', { ...operationPayload(), sectionId: choice.entry.sectionId, index: choice.entry.index, action, input }));
    });
  }
  function openEdit(choice) {
    try { checkChoice(choice); } catch (error) { toast(error.message); return; }
    editChoice = choice; const entry = choice.entry;
    $('entry-dialog').dataset.mode = 'edit';
    $('entry-dialog-title').textContent = '编辑经历'; $('entry-title-label').textContent = '名称'; $('entry-subtitle-label').textContent = '专业 / 岗位 / 职责';
    $('entry-details-label').textContent = '经历正文 · Markdown'; $('entry-stack-field').hidden = false;
    for (const [id, value] of Object.entries({ title: entry.title, subtitle: entry.subtitle, date: entry.date, stack: entry.stack, details: entry.content })) $(`entry-${id}`).value = value || '';
    $('entry-details').maxLength = 200000; $('entry-details').rows = 8;
    $('entry-details').placeholder = '用普通段落、- 列表或编号列表填写经历。';
    $('entry-content-help').hidden = false; $('entry-error').hidden = true; $('entry-submit').textContent = '保存修改';
    $('entry-dialog').showModal(); $('entry-title').focus();
  }
  async function refresh() {
    if (isSourceMode() || !isClean()) { invalidate(); return; }
    const current = ++sequence, { resumeId, revision } = getState();
    $('entry-list-status').textContent = '正在读取经历…'; $('entry-list-status').hidden = false;
    for (const button of $('entry-list').querySelectorAll('button')) button.disabled = true;
    try {
      const result = await request(`/api/entries?resumeId=${resumeId}&revision=${revision}`);
      if (current !== sequence || getState().resumeId !== resumeId || getState().revision !== revision || !isClean() || isSourceMode()) return;
      $('entry-list').replaceChildren();
      const count = result.sections.reduce((sum, section) => sum + section.entries.length, 0);
      $('entry-manager-summary').textContent = `管理已有经历 · ${count} 条`;
      $('entry-list-status').hidden = count > 0; $('entry-list-status').textContent = '还没有经历，使用上方按钮添加。';
      for (const section of result.sections) {
        const group = document.createElement('section'); group.className = 'entry-group'; group.dataset.sectionId = section.id;
        const heading = document.createElement('h3'); heading.textContent = section.title; group.append(heading);
        for (const entry of section.entries) {
          const row = document.createElement('div'); row.className = 'entry-row'; row.dataset.entryIndex = entry.index;
          const info = document.createElement('div'), title = document.createElement('strong'), date = document.createElement('small');
          title.textContent = entry.title; date.textContent = [entry.date, entry.subtitle].filter(Boolean).join(' · '); info.append(title, date);
          const actions = document.createElement('div'); actions.className = 'entry-actions';
          const choice = { resumeId, revision, entry, removeSection: section.entries.length === 1 };
          for (const [action, label] of [['edit', '编辑'], ['duplicate', '复制'], ['up', '↑'], ['down', '↓'], ['delete', '删除']]) {
            const button = document.createElement('button'); button.textContent = label; button.dataset.action = action;
            const actionName = { up: '上移', down: '下移' }[action] || label;
            button.setAttribute('aria-label', `${actionName} ${entry.title}`); button.title = actionName;
            button.disabled = action === 'up' && entry.index === 0 || action === 'down' && entry.index === section.entries.length - 1;
            button.addEventListener('click', async () => {
              if (action === 'edit') { openEdit(choice); return; }
              if (action === 'delete') {
                try { checkChoice(choice); } catch (error) { toast(error.message); return; }
                deleteChoice = choice; $('entry-delete-description').textContent = `“${entry.title}”${choice.removeSection ? '是本章节最后一条经历，删除时会同时移除该章节。' : '将从本章节移除。'}`;
                $('entry-delete-error').hidden = true; $('entry-delete-dialog').showModal(); return;
              }
              try { await change(choice, action); } catch (error) { toast(error.message); }
            });
            actions.append(button);
          }
          row.append(info, actions); group.append(row);
        }
        $('entry-list').append(group);
      }
    } catch (error) {
      if (current !== sequence) return;
      $('entry-list').replaceChildren(); $('entry-manager-summary').textContent = '管理已有经历';
      $('entry-list-status').textContent = `暂时无法读取经历：${error.message}。修正 Markdown 后自动更新。`;
    }
  }
  $('entry-submit').addEventListener('click', async () => {
    if ($('entry-dialog').dataset.mode !== 'edit' || !editChoice) return;
    try {
      await change(editChoice, 'edit', { title: $('entry-title').value, subtitle: $('entry-subtitle').value, date: $('entry-date').value, stack: $('entry-stack').value, content: $('entry-details').value });
      $('entry-dialog').close();
    } catch (error) { errorUI.dialog('entry', error); }
  });
  $('entry-dialog').addEventListener('close', () => editChoice = undefined);
  $('entry-delete-cancel').addEventListener('click', () => $('entry-delete-dialog').close());
  $('entry-delete-dialog').addEventListener('close', () => deleteChoice = undefined);
  $('entry-delete-confirm').addEventListener('click', async () => {
    if (!deleteChoice) return;
    try { await change(deleteChoice, 'delete'); $('entry-delete-dialog').close(); toast('已删除经历，可在“备份与恢复”还原删除前的内容。'); }
    catch (error) { $('entry-delete-error').textContent = error.message; $('entry-delete-error').hidden = false; }
  });
  return { refresh, invalidate };
}
