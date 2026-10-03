import { starterTemplates } from './starter-templates.mjs';

export function fillTemplateSelect(select, placeholder) {
  const current = select.value;
  select.replaceChildren();
  if (placeholder) { const option = document.createElement('option'); option.value = ''; option.textContent = placeholder; option.disabled = true; select.append(option); }
  for (const category of [...new Set(starterTemplates.map(template => template.category))]) {
    const group = document.createElement('optgroup'); group.label = category;
    for (const template of starterTemplates.filter(item => item.category === category)) {
      const option = document.createElement('option'); option.value = template.id; option.textContent = template.label;
      group.append(option);
    }
    select.append(group);
  }
  select.value = starterTemplates.some(template => template.id === current) ? current : placeholder ? '' : 'blank';
}
