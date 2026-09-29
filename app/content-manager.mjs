const $ = id => document.getElementById(id);

export function wireContent({ request, managed, settle, operationPayload, acceptState, getState, isSourceMode, isClean, toast }) {
  let sequence = 0, editChoice, deleteChoice, listed;
  function invalidate() {
    sequence++; listed = undefined;
    for (const button of $('content-list').querySelectorAll('button')) button.disabled = true;
    $('content-list-status').textContent = isSourceMode() ? '返回正文编辑后，可填写技能与补充信息。' : '保存后自动更新内容列表。';
    $('content-list-status').hidden = false;
  }
  function checkChoice(choice) {
    const state = getState();
    if (isSourceMode() || choice.resumeId !== state.resumeId || choice.revision !== state.revision) throw new Error('正文或简历已变化，请关闭弹窗后重新选择内容');
  }
  async function change(choice, action, input) {
    await managed(async () => {
      checkChoice(choice);
      acceptState(await request('/api/content/change', { ...operationPayload(), kind: choice.kind, sectionId: choice.sectionId, index: choice.index, action, input }));
    });
  }
  function openEditor(choice) {
    checkChoice(choice); editChoice = choice;
    const adding = choice.action === 'add', skills = choice.kind === 'skills';
    $('content-dialog-title').textContent = skills ? (adding ? '添加技能' : '编辑技能') : (adding ? '添加补充章节' : `编辑${choice.title}`);
    $('content-section-field').hidden = !skills || !adding || !listed?.sections.some(section => section.kind === 'skills');
    $('content-section').replaceChildren();
    for (const section of listed?.sections.filter(section => section.kind === 'skills') || []) {
      const option = document.createElement('option'); option.value = section.id; option.textContent = section.title; $('content-section').append(option);
    }
    $('content-section').value = choice.sectionId || $('content-section').options[0]?.value || '';
    $('content-label-field').hidden = !skills; $('content-title-field').hidden = skills || !adding;
    $('content-label').value = choice.label || ''; $('content-title').value = adding ? '其他信息' : choice.title || '';
    $('content-text-label').textContent = skills ? '掌握的技术与使用场景' : '补充内容';
    $('content-text').value = skills ? choice.text || '' : choice.content || '';
    $('content-text').placeholder = skills ? '例如：使用 Spring Boot 设计 REST API，熟悉事务与输入校验。' : '填写语言能力、证书、开源贡献等信息，可直接写普通段落。';
    $('content-help').textContent = skills ? '分组名称由工具排版，可直接填写普通文字，也支持加粗和链接。' : '可直接填写普通段落；已有的列表、加粗与链接会保留。';
    $('content-error').hidden = true; $('content-submit').textContent = adding ? '添加到简历' : '保存修改';
    $('content-dialog').showModal(); (skills ? $('content-label') : $('content-text')).focus();
  }
  async function refresh() {
    if (isSourceMode() || !isClean()) { invalidate(); return; }
    const current = ++sequence, { resumeId, revision } = getState();
    $('content-list-status').textContent = '正在读取技能与补充信息…'; $('content-list-status').hidden = false;
    for (const button of $('content-list').querySelectorAll('button')) button.disabled = true;
    try {
      const result = await request(`/api/content?resumeId=${resumeId}&revision=${revision}`);
      if (current !== sequence || getState().resumeId !== resumeId || getState().revision !== revision || !isClean() || isSourceMode()) return;
      listed = result; $('content-list').replaceChildren();
      const skills = result.sections.reduce((count, section) => count + (section.items?.length || 0), 0), extra = result.sections.filter(section => section.kind === 'lines').length;
      $('content-manager-summary').textContent = `技能与补充信息 · ${skills} 组技能 · ${extra} 个补充章节`;
      $('content-list-status').hidden = result.sections.length > 0; $('content-list-status').textContent = '使用上方按钮添加技能或补充信息。';
      for (const section of result.sections) {
        const group = document.createElement('section'); group.className = 'entry-group'; group.dataset.sectionId = section.id;
        const heading = document.createElement('h3'); heading.textContent = section.title; group.append(heading);
        const rows = section.kind === 'skills' ? section.items : [{ title: section.title, content: section.content }];
        for (const item of rows) {
          const row = document.createElement('div'); row.className = 'entry-row'; row.dataset.contentIndex = item.index ?? 0;
          const info = document.createElement('div'), name = document.createElement('strong'), text = document.createElement('small');
          name.textContent = item.label || section.title; text.textContent = item.text || item.content; info.append(name, text);
          const choice = { resumeId, revision, kind: section.kind, sectionId: section.id, title: section.title, ...item };
          const actions = document.createElement('div'); actions.className = 'entry-actions';
          const options = section.kind === 'skills' ? [['edit','编辑'],['duplicate','复制'],['up','↑'],['down','↓'],['delete','删除']] : [['edit','编辑'],['delete','删除']];
          for (const [action, label] of options) {
            const button = document.createElement('button'); button.textContent = label; button.dataset.action = action;
            button.setAttribute('aria-label', `${{ up:'上移', down:'下移' }[action] || label} ${item.label || section.title}`);
            button.disabled = action === 'up' && item.index === 0 || action === 'down' && item.index === section.items.length - 1;
            button.addEventListener('click', async () => {
              try {
                if (action === 'edit') { openEditor(choice); return; }
                if (action === 'delete') {
                  checkChoice(choice); deleteChoice = choice;
                  $('content-delete-description').textContent = `删除“${item.label || section.title}”前会保存完整备份${section.kind === 'skills' && section.items.length === 1 ? '，并移除空的技能章节' : ''}。`;
                  $('content-delete-error').hidden = true; $('content-delete-dialog').showModal(); return;
                }
                await change(choice, action);
              } catch (error) { toast(error.message); }
            });
            actions.append(button);
          }
          row.append(info, actions); group.append(row);
        }
        $('content-list').append(group);
      }
    } catch (error) {
      if (current !== sequence) return;
      listed = undefined; $('content-list').replaceChildren(); $('content-manager-summary').textContent = '技能与补充信息';
      $('content-list-status').textContent = `暂时无法读取：${error.message}。修正正文后自动更新。`;
    }
  }
  for (const [id, kind] of [['content-skill-add','skills'],['content-lines-add','lines']]) $(id).addEventListener('click', async () => {
    try {
      if (isSourceMode()) throw new Error('请先返回正文编辑');
      await settle(); await refresh();
      if (!listed || listed.revision !== getState().revision) throw new Error('请先修正正文并等待内容载入');
      const { resumeId, revision } = getState();
      openEditor({ resumeId, revision, kind, action: 'add' });
    } catch (error) { toast(error.message); }
  });
  $('content-submit').addEventListener('click', async () => {
    if (!editChoice) return;
    try {
      const skills = editChoice.kind === 'skills';
      const choice = { ...editChoice, ...(skills && editChoice.action === 'add' ? { sectionId: $('content-section').value || undefined } : {}) };
      await change(choice, choice.action || 'edit', skills ? { label: $('content-label').value, text: $('content-text').value } : { title: $('content-title').value, content: $('content-text').value });
      $('content-dialog').close();
    } catch (error) { $('content-error').textContent = error.message; $('content-error').hidden = false; }
  });
  $('content-dialog').addEventListener('close', () => editChoice = undefined);
  $('content-delete-cancel').addEventListener('click', () => $('content-delete-dialog').close());
  $('content-delete-dialog').addEventListener('close', () => deleteChoice = undefined);
  $('content-delete-confirm').addEventListener('click', async () => {
    if (!deleteChoice) return;
    try { await change(deleteChoice, 'delete'); $('content-delete-dialog').close(); toast('已删除，可从“备份与恢复”找回原内容。'); }
    catch (error) { $('content-delete-error').textContent = error.message; $('content-delete-error').hidden = false; }
  });
  return { refresh, invalidate };
}
