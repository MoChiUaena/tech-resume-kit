import { resumeThemes } from './resume-themes.mjs';

export function fillThemeSelect(select) {
  const current = select.value;
  select.replaceChildren();
  for (const theme of resumeThemes) {
    const option = document.createElement('option'); option.value = theme.id; option.textContent = theme.label;
    select.append(option);
  }
  select.value = resumeThemes.some(theme => theme.id === current) ? current : 'ink-blue';
}

export function fillThemeGallery(fieldset, onPreview) {
  const legend = document.createElement('legend'); legend.textContent = '1 选择外观模板';
  fieldset.replaceChildren(legend);
  for (const theme of resumeThemes) {
    const card = document.createElement('div'), label = document.createElement('label'), input = document.createElement('input'), preview = document.createElement('img');
    card.className = 'theme-card';
    const body = document.createElement('span'), title = document.createElement('strong'), description = document.createElement('small');
    input.id = 'start-theme-' + theme.id; input.type = 'radio'; input.name = 'start-theme'; input.value = theme.id;
    input.checked = theme.id === 'ink-blue';
    preview.src = theme.preview; preview.alt = theme.label + '实际简历版面预览'; preview.width = 380; preview.height = 538;
    title.textContent = theme.label; description.textContent = theme.description;
    body.append(preview, title, description); label.append(input, body);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'theme-preview-button';
    button.dataset.themePreview = theme.id; button.textContent = '查看完整效果'; button.setAttribute('aria-label', '查看' + theme.label + '完整效果');
    button.addEventListener('click', () => onPreview(theme.id, id => { document.getElementById('start-theme-' + id).checked = true; }));
    card.append(label, button); fieldset.append(card);
  }
}
