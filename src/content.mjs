import { parseResume } from './input.mjs';
import { markdown, validateInline } from './markdown.mjs';
import { resolveSectionOrder } from './schema.mjs';
import { ResumeError } from './errors.mjs';

const normalized = text => text.replace(/\r\n?/g, '\n');
function inspect(source) {
  const parsed = parseResume(source), lines = [], offsets = [];
  for (const match of source.matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/g)) {
    offsets.push(match.index); lines.push(match[1].replace(/^\uFEFF/, ''));
    if (!match[2]) break;
  }
  const offset = line => offsets[line] ?? source.length, bodyLine = lines.indexOf('---', 1) + 1;
  const tokens = markdown.parse(lines.slice(bodyLine).join('\n'), {});
  const sections = parsed.document.sections.map((section, index) => {
    const startLine = parsed.locations.get(`sections.${index}`).line - 1;
    const start = offset(startLine), end = index + 1 < parsed.document.sections.length ? offset(parsed.locations.get(`sections.${index + 1}`).line - 1) : source.length;
    const heading = tokens.find(token => token.type === 'heading_open' && token.tag === 'h2' && token.map[0] + bodyLine === startLine);
    const contentStart = offset(heading.map[1] + bodyLine), raw = source.slice(contentStart, end);
    const content = raw.replace(/^(?:\r\n|\r|\n)+|(?:\r\n|\r|\n)+$/g, '');
    const items = section.kind === 'skills' ? tokens.filter(token => token.type === 'list_item_open' && offset(token.map[0] + bodyLine) >= contentStart && offset(token.map[0] + bodyLine) < end).map((token, itemIndex) => {
      const itemStart = offset(token.map[0] + bodyLine), itemEnd = Math.min(offset(token.map[1] + bodyLine), end);
      const body = source.slice(itemStart, itemEnd).replace(/(?:\r\n|\r|\n)[\s]*$/, '');
      return { ...section.items[itemIndex], index: itemIndex, start: itemStart, end: itemEnd, contentEnd: itemStart + body.length };
    }) : [];
    return { ...section, start, end, contentStart, content, items };
  });
  return { document: parsed.document, sections };
}
export function listResumeContent(source) {
  return inspect(source).sections.filter(section => section.kind !== 'entries').map(section => ({
    id: section.id, title: section.title, kind: section.kind,
    ...(section.kind === 'skills' ? { items: section.items.map(({ index, label, text }) => ({ index, label, text })) } : { content: section.content }),
  }));
}
function line(value, name) {
  if (typeof value !== 'string' || !value.trim() || /[\r\n\x00]/.test(value) || value.length > 120) throw new ResumeError(`请填写同一行的${name}，最多 120 个字符`);
  return value.trim();
}
function content(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200000 || value.includes('\x00')) throw new ResumeError('请填写内容，最多 200000 个字符');
  return normalized(value).trim();
}
function separated(raw, eol) {
  const endings = raw.match(/(?:\r\n|\r|\n)+$/)?.[0] || '';
  return raw + eol.repeat(Math.max(0, 2 - normalized(endings).length));
}
function skill(input, eol) {
  const label = line(input?.label, '技能分组名称'), text = content(input?.text);
  if (label.includes('*')) throw new ResumeError('技能分组名称不包含星号，加粗由工具自动处理');
  validateInline(text, { field: 'text' });
  return { label, text, raw: `- **${label}**：${text.replace(/\n/g, eol + '  ')}${eol}` };
}

export function changeResumeContent(source, layout, { kind, action, sectionId, index, input }) {
  if (!['skills', 'lines'].includes(kind)) throw new ResumeError('请选择技能或补充信息');
  const before = inspect(source), sections = before.sections, eol = source.includes('\r\n') ? '\r\n' : '\n';
  let section = sections.find(section => section.id === sectionId), updated, nextLayout = structuredClone(layout), expectedCount;
  if (section && section.kind !== kind) throw new ResumeError('章节类型已变化，请重新载入', { code: 'CONFLICT' });
  if (action === 'add' && kind === 'lines' && sectionId) throw new ResumeError('新增补充章节不使用已有章节 ID');
  if (action === 'add' && kind === 'skills' && !sectionId) section = sections.find(section => section.id === 'skills' && section.kind === 'skills') || sections.find(section => section.kind === 'skills');
  if (section) sectionId = section.id;
  if (action === 'add' && !section) {
    if (sectionId) throw new ResumeError('目标章节已变化，请重新载入', { code: 'CONFLICT' });
    let id = kind === 'skills' ? 'skills' : 'additional', count = 2;
    while (sections.some(section => section.id === id)) id = `${kind === 'skills' ? 'skills' : 'additional'}-${count++}`;
    const title = kind === 'skills' ? '专业技能' : line(input?.title, '章节名称');
    const body = kind === 'skills' ? skill(input, eol).raw : content(input?.content).replace(/\n/g, eol) + eol;
    const preset = layout.preset === 'experience' ? ['skills','experience','internship','projects','education','additional'] : ['education','skills','internship','experience','projects','additional'];
    const rank = kind === 'skills' ? preset.indexOf('skills') : 100;
    const anchor = sections.find(section => (preset.indexOf(section.id) < 0 ? 100 : preset.indexOf(section.id)) > rank);
    const position = anchor?.start ?? source.length;
    updated = separated(source.slice(0, position), eol) + `## ${title} {#${id} .${kind}}${eol}${eol}` + separated(body, eol) + source.slice(position);
    if (nextLayout.sectionOrder) {
      const position = anchor ? nextLayout.sectionOrder.indexOf(anchor.id) : -1;
      nextLayout.sectionOrder.splice(position < 0 ? nextLayout.sectionOrder.length : position, 0, id);
    }
    expectedCount = kind === 'skills' ? 1 : undefined;
    sectionId = id;
  } else {
    if (!section) throw new ResumeError('章节已变化，请重新载入', { code: 'CONFLICT' });
    if (kind === 'lines') {
      if (action === 'edit') {
        if (typeof input?.content === 'string' && normalized(input.content) === normalized(section.content)) return { source, layout: nextLayout };
        const next = content(input?.content);
        if (next === normalized(section.content)) return { source, layout: nextLayout };
        updated = source.slice(0, section.contentStart) + eol + next.replace(/\n/g, eol) + eol.repeat(2) + source.slice(section.end);
      } else if (action !== 'delete') throw new ResumeError('补充信息支持编辑或删除');
    } else {
      if (action === 'add') {
        const added = skill(input, eol);
        updated = separated(source.slice(0, section.end), eol) + added.raw + eol + source.slice(section.end);
        expectedCount = section.items.length + 1;
      } else {
        if (!Number.isInteger(index) || !section.items[index]) throw new ResumeError('技能条目已变化，请重新载入', { code: 'CONFLICT' });
        const item = section.items[index], raw = source.slice(item.start, item.end);
        expectedCount = section.items.length;
        if (action === 'edit') {
          const next = skill(input, eol);
          if (next.label === item.label && next.text === normalized(item.text)) return { source, layout: nextLayout };
          updated = source.slice(0, item.start) + next.raw.replace(/(?:\r\n|\n)$/, '') + source.slice(item.contentEnd);
        } else if (action === 'duplicate') { updated = source.slice(0, item.start) + separated(raw, eol) + raw + source.slice(item.end); expectedCount++; }
        else if (action === 'up' || action === 'down') {
          const neighbor = section.items[index + (action === 'up' ? -1 : 1)];
          if (!neighbor) throw new ResumeError(action === 'up' ? '已经是第一项技能' : '已经是最后一项技能');
          const [first, second] = action === 'up' ? [neighbor, item] : [item, neighbor];
          updated = source.slice(0, first.start) + separated(source.slice(second.start, second.end), eol) + source.slice(first.start, first.end) + source.slice(second.end);
        } else if (action === 'delete') {
          expectedCount--;
          if (section.items.length > 1) updated = source.slice(0, item.start) + source.slice(item.end);
        } else throw new ResumeError('请选择添加、编辑、复制、移动或删除');
      }
    }
    if (action === 'delete' && !updated) {
      if (sections.length === 1) throw new ResumeError('请至少保留一个章节，可以先添加其他内容');
      updated = source.slice(0, section.start) + source.slice(section.end);
      if (nextLayout.sectionOrder) nextLayout.sectionOrder = nextLayout.sectionOrder.filter(id => id !== section.id);
    }
  }
  const after = parseResume(updated).document;
  const removed = action === 'delete' && !after.sections.some(section => section.id === sectionId), added = action === 'add' && !before.document.sections.some(section => section.id === sectionId);
  const oldIds = before.document.sections.filter(section => !removed || section.id !== sectionId).map(section => section.id);
  const newIds = after.sections.filter(section => !added || section.id !== sectionId).map(section => section.id);
  if (JSON.stringify(oldIds) !== JSON.stringify(newIds) || after.sections.some(section => before.document.sections.find(previous => previous.id === section.id)?.kind && section.kind !== before.document.sections.find(previous => previous.id === section.id).kind) || (kind === 'skills' && !removed && after.sections.find(section => section.id === sectionId)?.items.length !== expectedCount)) {
    throw new ResumeError('内容不应添加章节标题或其他条目；请通过表单新增');
  }
  resolveSectionOrder(after, nextLayout);
  return { source: updated, layout: nextLayout };
}
