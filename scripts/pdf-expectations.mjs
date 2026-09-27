import { markdown } from '../src/markdown.mjs';

export function pdfExpectations(rendered, pages) {
  const fields = [], links = new Set(), headings = [];
  const plain = text => markdown.parseInline(text, {})[0].children.filter(token => ['text', 'code_inline', 'softbreak', 'hardbreak'].includes(token.type)).map(token => token.type.endsWith('break') ? ' ' : token.content).join('');
  const add = (text, rich = false) => {
    if (!text) return;
    fields.push(rich ? plain(text) : text);
    if (rich) for (const token of markdown.parseInline(text, {})[0].children) if (token.type === 'link_open') links.add(token.attrGet('href'));
  };
  const addBlocks = blocks => blocks.forEach(block => block.type === 'paragraph' ? add(block.text, true) : block.items.forEach(text => add(text, true)));
  const first = blocks => plain(blocks[0].type === 'paragraph' ? blocks[0].text : blocks[0].items[0]);
  const { document, layout } = rendered;
  for (const key of ['name', 'label', 'target', 'availability']) add(document.person[key]);
  for (const contact of document.person.contacts) { add(contact.text); links.add(contact.href); }
  for (const id of layout.sectionOrder) {
    const section = document.sections.find(section => section.id === id);
    add(section.title);
    const nextText = section.entries?.[0].title || section.items?.[0].label || first(section.blocks);
    headings.push({ title: section.title, next: nextText.slice(0, 20), kind: 'section' });
    for (const entry of section.entries || []) {
      for (const key of ['title', 'subtitle', 'date', 'stack']) add(entry[key]);
      headings.push({ title: entry.title, next: first(entry.blocks).slice(0, 20), kind: 'entry' });
      addBlocks(entry.blocks);
    }
    for (const item of section.items || []) { add(item.label); add(item.text, true); }
    if (section.blocks) addBlocks(section.blocks);
  }
  add(document.notice);
  return { pages, fields, headings, links: [...links], imageCount: Object.keys(rendered.images).length, marginMm: layout.page.marginMm, sectionOrder: [document.person.name, ...layout.sectionOrder.map(id => document.sections.find(section => section.id === id).title)] };
}
