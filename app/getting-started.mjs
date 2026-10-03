import { fillTemplateSelect } from './template-picker.mjs';
import { fillThemeGallery } from './theme-picker.mjs';

const $ = id => document.getElementById(id);

export function wireGettingStarted({ request, managed, settle, operationPayload, acceptState, getState, isSourceMode, toast, openSettings }) {
  fillThemeGallery(document.querySelector('#start-dialog .theme-options'));
  fillTemplateSelect($('start-content'));
  let choice;
  function refresh() {
    $('start-banner').hidden = !getState()?.gettingStarted?.welcome;
    for (const id of ['guide-person', 'guide-entries', 'guide-content']) $(id).disabled = isSourceMode();
  }
  function focusSection(id, target) {
    const section = $(id); section.open = true;
    section.scrollIntoView({ block: 'start', behavior: 'smooth' }); $(target).focus({ preventScroll: true });
  }
  async function open() {
    try {
      await settle();
      const state = getState(), initial = state.gettingStarted?.welcome === true;
      choice = { ...operationPayload(), mode: initial ? 'initial' : 'create' };
      $('start-title').textContent = initial ? '选一个喜欢的外观' : '从模板新建简历';
      $('start-name-field').hidden = initial;
      let name = '新简历', index = 2;
      while (state.resumes.some(resume => resume.name === name)) name = `新简历 ${index++}`;
      $('start-name').value = name;
      $('start-help').textContent = '先选外观，再选空白或样张内容。预览使用相同内容，方便比较版式。';
      $('start-submit').textContent = initial ? '开始填写' : '新建并填写';
      const theme = document.getElementById('start-theme-' + state.layout.theme) || $('start-theme-ink-blue');
      theme.checked = true; $('start-content').value = 'blank'; $('start-error').hidden = true;
      $('start-dialog').showModal(); theme.focus();
    } catch (error) { toast(error.message); }
  }
  $('start-open').addEventListener('click', open);
  $('start-choose').addEventListener('click', open);
  $('start-direct').addEventListener('click', async () => {
    try {
      await managed(async () => acceptState(await request('/api/getting-started/dismiss', operationPayload())));
      focusSection('person-card', 'name');
    } catch (error) { toast(error.message); }
  });
  $('start-submit').addEventListener('click', async () => {
    $('start-error').hidden = true;
    const input = { ...choice, template: $('start-content').value, theme: document.querySelector('input[name=start-theme]:checked').value, name: $('start-name').value };
    try {
      await managed(async () => {
        acceptState(await request('/api/getting-started/start', input)); $('start-dialog').close();
      });
      focusSection('person-card', 'name');
    } catch (error) { $('start-error').textContent = error.message; $('start-error').hidden = false; }
  });
  $('guide-person').addEventListener('click', () => focusSection('person-card', 'name'));
  $('guide-entries').addEventListener('click', () => focusSection('entry-manager', 'entry-manager-summary'));
  $('guide-content').addEventListener('click', () => focusSection('content-manager', 'content-manager-summary'));
  $('guide-layout').addEventListener('click', openSettings);
  return { refresh };
}
