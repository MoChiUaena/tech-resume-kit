export function wireSystem({ request, managed, settle, operationPayload, acceptState }) {
  const $ = id => document.getElementById(id); let info, poll;
  const pauseButton = document.createElement('button'); pauseButton.id = 'update-pause'; pauseButton.textContent = '暂停下载'; pauseButton.hidden = true; $('update-prepare').after(pauseButton);
  const progress = document.createElement('progress'); progress.id = 'update-progress'; progress.max = 1; progress.hidden = true; progress.setAttribute('aria-label', '更新下载进度'); $('update-message').after(progress);
  const importOption = document.createElement('option'); importOption.value = 'import'; importOption.textContent = '迁入旧版 my-resume'; $('storage-mode').append(importOption);
  const sourceField = document.createElement('div'), sourceLabel = document.createElement('label'), sourceInput = document.createElement('input'), sourceBrowse = document.createElement('button'), candidates = document.createElement('datalist');
  sourceField.hidden = true; sourceLabel.className = 'dialog-field'; sourceLabel.textContent = '旧版 my-resume 文件夹'; sourceLabel.htmlFor = 'storage-source';
  sourceInput.id = 'storage-source'; sourceInput.autocomplete = 'off'; sourceInput.placeholder = '选择旧版程序中的 my-resume 文件夹'; candidates.id = 'legacy-directories'; sourceInput.setAttribute('list', candidates.id);
  sourceBrowse.id = 'storage-source-browse'; sourceBrowse.textContent = '选择旧版资料文件夹'; sourceBrowse.className = 'source-browse';
  sourceLabel.append(sourceInput); sourceField.append(sourceLabel, sourceBrowse, candidates); $('storage-mode').closest('label').after(sourceField);
  function error(message) { $('system-error').textContent = message; $('system-error').hidden = !message; }
  function renderUpdate(update) {
    $('update-current').textContent = `当前版本 ${info.version}`;
    const busy = ['downloading', 'verifying', 'extracting'].includes(update.phase);
    const messages = {
      idle: '点击检查获取最新正式版本。', available: `发现正式版 ${update.latestVersion}。`,
      current: update.latestVersion === info.version ? '当前已是最新正式版。' : `最新正式版为 ${update.latestVersion}，当前版本保留。`,
      downloading: `正在下载 ${((update.received || 0) / 1_000_000).toFixed(1)} / ${(update.total / 1_000_000).toFixed(1)} MB…`,
      verifying: '下载已完成，正在核验文件…', extracting: '文件校验通过，正在准备新版…', ready: `新版 ${update.latestVersion} 已准备完成。切换前会保存全部资料和整库副本。`, failed: update.error,
      paused: update.downloadComplete ? '安装包已下载，点击继续准备。' : `下载已暂停，已保留 ${((update.received || 0) / 1_000_000).toFixed(1)} MB，点击继续下载。`,
    };
    $('update-message').textContent = [messages[update.phase], update.warning].filter(Boolean).join(' ');
    $('update-check').disabled = busy || update.phase === 'ready';
    $('update-prepare').hidden = !update.supported || !['available', 'failed', 'paused'].includes(update.phase);
    $('update-prepare').textContent = update.downloadComplete ? '继续准备新版' : update.resumable ? '继续下载新版' : '下载并准备新版';
    $('update-activate').hidden = !update.supported || update.phase !== 'ready';
    pauseButton.hidden = !update.supported || !busy; pauseButton.textContent = update.phase === 'downloading' ? '暂停下载' : '暂停准备';
    progress.hidden = !busy && update.phase !== 'paused';
    if (update.phase === 'downloading' || update.phase === 'paused') progress.value = Math.min(1, (update.received || 0) / (update.total || 1)); else progress.removeAttribute('value');
    $('update-rollback').hidden = !update.rollbackDirectory;
    $('update-release').hidden = !update.releaseUrl;
    if (update.releaseUrl) $('update-release').href = update.releaseUrl;
    clearTimeout(poll);
    if (busy) poll = setTimeout(async () => { try { renderUpdate(await request('/api/updates/status')); } catch (failure) { error(failure.message); } }, 1000);
  }
  function renderApp(result) {
    info = result; $('storage-path').textContent = info.storage.directory;
    $('storage-controls').hidden = !info.storage.managed;
    $('storage-browse').hidden = !(info.directoryPicker ?? info.desktop);
    sourceBrowse.hidden = !(info.directoryPicker ?? info.desktop); candidates.replaceChildren();
    for (const directory of info.storage.legacyDirectories || []) { const option = document.createElement('option'); option.value = directory; candidates.append(option); }
    if (info.storage.legacyDirectories?.length === 1) sourceInput.value = info.storage.legacyDirectories[0];
    $('storage-help').textContent = info.storage.managed ? '所有简历、图片和历史保存在此处，更新程序后继续使用。' : '当前使用指定的数据目录；更换位置请修改启动命令中的 --dir。';
    const migration = info.storage.lastMigration;
    $('storage-result').hidden = !migration?.backup;
    $('storage-result').textContent = migration?.backup ? `已核对 ${migration.fileCount} 个文件。整库副本：${migration.backup}` : '';
    $('storage-backup-open').hidden = !(info.openDirectory ?? info.desktop) || !migration?.backup;
    $('storage-open').hidden = !(info.openDirectory ?? info.desktop);
    renderUpdate(info.updates);
  }
  $('system-open').addEventListener('click', async () => {
    try { await settle(); error(''); renderApp(await request('/api/app-info')); $('system-dialog').showModal(); } catch (failure) { error(failure.message); $('system-dialog').showModal(); }
  });
  $('storage-mode').addEventListener('change', () => {
    const mode = $('storage-mode').value; sourceField.hidden = mode !== 'import';
    $('storage-change').textContent = { move: '迁移并使用', existing: '打开简历库', import: '迁入并使用' }[mode];
    $('storage-action-help').textContent = mode === 'existing' ? '选择已有的数据文件夹，当前资料仍保留在原位置。' : '目标需为空。迁移前保留整库副本，原文件夹继续保留。';
  });
  $('storage-browse').addEventListener('click', async () => { try { error(''); await managed(async () => { const result = await request('/api/storage/browse', {}); if (result.directory) $('storage-target').value = result.directory; }); } catch (failure) { error(failure.message); } });
  sourceBrowse.addEventListener('click', async () => { try { error(''); await managed(async () => { const result = await request('/api/storage/browse', {}); if (result.directory) sourceInput.value = result.directory; }); } catch (failure) { error(failure.message); } });
  $('storage-change').addEventListener('click', async () => {
    try {
      error(''); let result;
      await managed(async () => { result = await request('/api/storage/change', { ...operationPayload(), directory: $('storage-target').value.trim(), mode: $('storage-mode').value, sourceDirectory: sourceInput.value.trim() }); acceptState(result.state); });
      renderApp(result.app); $('storage-target').value = '';
    } catch (failure) { error(failure.message); }
  });
  for (const [id, backup] of [['storage-open', false], ['storage-backup-open', true]]) $(id).addEventListener('click', async () => { try { error(''); await request('/api/storage/open', { backup }); } catch (failure) { error(failure.message); } });
  for (const [id, action] of [['update-check', 'check'], ['update-prepare', 'prepare']]) $(id).addEventListener('click', async () => {
    try { error(''); $(id).disabled = true; const result = await request(`/api/updates/${action}`, {}); $(id).disabled = false; renderUpdate(result); }
    catch (failure) { $(id).disabled = false; error(failure.message); }
    finally { if (id === 'update-prepare') $(id).disabled = false; }
  });
  pauseButton.addEventListener('click', async () => { try { error(''); pauseButton.disabled = true; renderUpdate(await request('/api/updates/pause', {})); } catch (failure) { error(failure.message); } finally { pauseButton.disabled = false; } });
  for (const [id, action] of [['update-activate', 'activate'], ['update-rollback', 'rollback']]) $(id).addEventListener('click', async () => {
    try {
      error(''); await managed(async () => { await request(`/api/updates/${action}`, operationPayload()); });
      clearTimeout(poll); document.body.replaceChildren(); const note = document.createElement('p'); note.textContent = '资料已保存，正在打开所选版本。若没有打开，请双击原来的启动简历.exe。'; document.body.append(note);
    } catch (failure) { error(failure.message); try { renderUpdate(await request('/api/updates/status')); } catch {} }
  });
}
