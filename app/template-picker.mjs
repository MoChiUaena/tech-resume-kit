import { starterTemplates } from './starter-templates.mjs';

export function fillTemplateSelect(select) {
  const current = select.value;
  select.replaceChildren();
  for (const category of [...new Set(starterTemplates.map(template => template.category))]) {
    const group = document.createElement('optgroup'); group.label = category;
    for (const template of starterTemplates.filter(item => item.category === category)) {
      const option = document.createElement('option'); option.value = template.id; option.textContent = template.label;
      group.append(option);
    }
    select.append(group);
  }
  select.value = starterTemplates.some(template => template.id === current) ? current : 'blank';
}

export function fillStarterChoices(fieldset) {
  const legend = document.createElement('legend'); legend.textContent = '起步模板 · ' + starterTemplates.length + ' 种';
  fieldset.replaceChildren(legend);
  for (const template of starterTemplates) {
    const label = document.createElement('label'), input = document.createElement('input'), content = document.createElement('span');
    const title = document.createElement('strong'), detail = document.createElement('small'), description = document.createElement('p');
    input.id = 'start-' + template.id; input.type = 'radio'; input.name = 'start-template'; input.value = template.id;
    input.checked = template.id === 'blank';
    title.textContent = template.label; detail.textContent = template.subtitle; description.textContent = template.description;
    content.append(title, detail, description); label.append(input, content); fieldset.append(label);
  }
}
