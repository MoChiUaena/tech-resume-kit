const $ = id => document.getElementById(id);
export function wireLibrary({ request, managed, settle, operationPayload, acceptState, getState, toast }) {
  let trashChoice, restoreChoice, libraryChoice;
  function error(message) { $('library-error').textContent = message; $('library-error').hidden = !message; }
  const context = () => ({ ...operationPayload() });
  function check(choice) {
    const now = context();
    if (Object.keys(now).some(key => now[key] !== choice[key])) throw new Error('简历库已变化，请关闭弹窗后重新操作');
  }
  async function download(url, filename) {
    const response = await fetch(url);
    if (!response.ok) { const result = await response.json(); throw new Error(result.error?.message || '备份下载失败'); }
    const href = URL.createObjectURL(await response.blob()), link = document.createElement('a');
    link.href = href; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(href), 5000);
  }
  function render() {
    const state = getState(); if (!state) return;
    $('library-current').textContent = `当前：${state.resumeName} · ${state.resumes.length} 份在用简历`;
    $('resume-trash').disabled = state.resumes.length <= 1;
    $('library-trash-count').textContent = `回收站 · ${state.trash?.length || 0} 份`;
    $('library-trash-list').replaceChildren();
    for (const item of state.trash || []) {
      const row = document.createElement('div'); row.className = 'history-item'; row.dataset.trashId = item.id;
      const info = document.createElement('div'), title = document.createElement('strong'), detail = document.createElement('small'), button = document.createElement('button');
      title.textContent = item.name; detail.textContent = `${new Date(item.deletedAt).toLocaleString()} 移入`; info.append(title, detail);
      button.textContent = '恢复'; button.setAttribute('aria-label', `恢复 ${item.name}`);
      button.addEventListener('click', () => {
        restoreChoice = { ...context(), targetId: item.id }; let name = item.name, index = 2;
        while (getState().resumes.some(resume => resume.name === name)) name = `${item.name.slice(0, 48)} 恢复 ${index++}`;
        $('trash-restore-name').value = name; $('trash-restore-error').hidden = true; $('trash-restore-dialog').showModal();
      });
      row.append(info, button); $('library-trash-list').append(row);
    }
    $('library-trash-empty').hidden = !!state.trash?.length;
    $('library-before-download').hidden = !state.libraryBackupBeforeRestore;
    $('library-backup-warning').hidden = !state.libraryBackupWarning; $('library-backup-warning').textContent = state.libraryBackupWarning || '';
  }
  $('library-open').addEventListener('click', async () => { try { await settle(); error(''); render(); $('library-dialog').showModal(); } catch (failure) { toast(failure.message); } });
  $('resume-trash').addEventListener('click', () => {
    trashChoice = context(); $('resume-trash-name').textContent = `将“${getState().resumeName}”移入回收站，正文、图片和历史保留。`;
    $('resume-trash-error').hidden = true; $('resume-trash-dialog').showModal();
  });
  $('resume-trash-cancel').addEventListener('click', () => $('resume-trash-dialog').close());
  $('resume-trash-confirm').addEventListener('click', async () => {
    try { await managed(async () => { check(trashChoice); acceptState(await request('/api/resumes/trash', trashChoice)); }); $('resume-trash-dialog').close(); toast('已移入回收站，可随时恢复。'); }
    catch (failure) { $('resume-trash-error').textContent = failure.message; $('resume-trash-error').hidden = false; }
  });
  $('trash-restore-cancel').addEventListener('click', () => $('trash-restore-dialog').close());
  $('trash-restore-confirm').addEventListener('click', async () => {
    try { await managed(async () => { check(restoreChoice); acceptState(await request('/api/resumes/restore-trash', { ...restoreChoice, name: $('trash-restore-name').value })); }); $('trash-restore-dialog').close(); toast('已恢复到简历列表，正文、图片和历史都已保留。'); }
    catch (failure) { $('trash-restore-error').textContent = failure.message; $('trash-restore-error').hidden = false; }
  });
  $('library-export').addEventListener('click', async () => {
    try { error(''); await managed(() => download(`/library.zip?${new URLSearchParams(context())}`, '简历整库备份.zip')); }
    catch (failure) { error(failure.message); }
  });
  $('library-before-download').addEventListener('click', async () => {
    try { error(''); await managed(() => download(`/library-before-restore.zip?backupId=${getState().libraryBackupBeforeRestore.backupId}`, '恢复前简历整库.zip')); }
    catch (failure) { error(failure.message); }
  });
  $('library-import').addEventListener('change', async event => {
    const file = event.target.files[0]; event.target.value = ''; if (!file) return;
    try {
      error(''); if (file.size > 128000000) throw new Error('整库 ZIP 请控制在 128 MB 以内');
      let summary; await managed(async () => { summary = await request('/api/library/inspect', file, true); });
      libraryChoice = { ...context(), file, sha256: summary.sha256 };
      $('library-restore-summary').textContent = `备份包含 ${summary.resumeCount} 份在用简历、${summary.trashCount} 份回收站资料和 ${summary.fileCount} 个文件。恢复后选中“${summary.activeName}”。`;
      $('library-restore-date').textContent = `备份时间：${new Date(summary.createdAt).toLocaleString()}`;
      $('library-restore-error').hidden = true; $('library-restore-dialog').showModal();
    } catch (failure) { error(failure.message); }
  });
  $('library-restore-cancel').addEventListener('click', () => { libraryChoice = undefined; $('library-restore-dialog').close(); });
  $('library-restore-confirm').addEventListener('click', async () => {
    if (!libraryChoice) return;
    try {
      await managed(async () => { check(libraryChoice); const query = new URLSearchParams({ sha256: libraryChoice.sha256, libraryRevision: libraryChoice.libraryRevision }); acceptState(await request(`/api/library/restore-upload?${query}`, libraryChoice.file, true)); });
      libraryChoice = undefined; $('library-restore-dialog').close(); toast('整库已恢复，原库 ZIP 可在“简历库管理”下载。');
    } catch (failure) { $('library-restore-error').textContent = failure.message; $('library-restore-error').hidden = false; }
  });
  $('library-restore-dialog').addEventListener('close', () => libraryChoice = undefined);
  return { render };
}
