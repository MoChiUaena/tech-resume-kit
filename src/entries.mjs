import { parseDocument } from 'yaml';
import { parseResume } from './input.mjs';
import { markdown } from './markdown.mjs';
import { resolveSectionOrder } from './schema.mjs';
import { ResumeError } from './errors.mjs';

function inspect(source) {
  const parsed = parseResume(source), lines = [], offsets = [];
  for (const match of source.matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/g)) {
    offsets.push(match.index); lines.push(match[1].replace(/^\uFEFF/, ''));
    if (!match[2]) break;
  }
  const offset = line => offsets[line] ?? source.length;
  const bodyLine = lines.indexOf('---', 1) + 1;
  const tokens = markdown.parse(lines.slice(bodyLine).join('\n'), {});
  const headings = tokens.filter(token => token.type === 'heading_open' && token.tag === 'h3');
  let headingIndex = 0;
  const sections = parsed.document.sections.map((section, sectionIndex) => {
    const start = offset(parsed.locations.get(`sections.${sectionIndex}`).line - 1);
    const end = sectionIndex + 1 < parsed.document.sections.length ? offset(parsed.locations.get(`sections.${sectionIndex + 1}`).line - 1) : source.length;
    const entries = (section.entries || []).map((entry, index) => {
      const heading = headings[headingIndex++], meta = tokens[tokens.indexOf(heading) + 3];
      const entryStart = offset(heading.map[0] + bodyLine);
      const entryEnd = index + 1 < section.entries.length ? offset(headings[headingIndex].map[0] + bodyLine) : end;
      const contentStart = offset(parsed.locations.get(`sections.${sectionIndex}.entries.${index}.blocks.0`).line - 1);
      const content = source.slice(contentStart, entryEnd).replace(/(?:\r\n|\r|\n)+$/, '');
      return { ...entry, sectionId: section.id, index, content, start: entryStart, end: entryEnd,
        headingEnd: offset(heading.map[1] + bodyLine), metaStart: offset(meta.map[0] + bodyLine + 1),
        metaEnd: offset(meta.map[1] + bodyLine - 1), contentStart, contentEnd: contentStart + content.length };
    });
    return { ...section, start, end, entries };
  });
  return { document: parsed.document, sections };
}

export function listResumeEntries(source) {
  return inspect(source).sections.filter(section => section.kind === 'entries').map(section => ({
    id: section.id, title: section.title,
    entries: section.entries.map(({ sectionId, index, title, date, subtitle, stack, content }) => ({ sectionId, index, title, date, subtitle, stack, content })),
  }));
}

function line(value, label, required = false, field) {
  if (typeof value !== 'string' || /[\r\n\x00]/.test(value)) throw new ResumeError(`${label}需要写在同一行`, { field });
  const text = value.trim();
  if (required && !text) throw new ResumeError(`请填写${label}`, { field });
  return text;
}
const normalized = value => value.replace(/\r\n?/g, '\n');
function separated(raw, eol) {
  const endings = raw.match(/(?:\r\n|\r|\n)+$/)?.[0] || '';
  const count = normalized(endings).length;
  return raw + eol.repeat(Math.max(0, 2 - count));
}

export function changeResumeEntry(source, layout, { action, sectionId, index, input }) {
  const { document, sections } = inspect(source), section = sections.find(item => item.id === sectionId && item.kind === 'entries');
  if (!Number.isInteger(index) || !section?.entries[index]) throw new ResumeError('经历条目已变化，请重新载入', { code: 'CONFLICT' });
  const entry = section.entries[index], raw = source.slice(entry.start, entry.end), eol = source.includes('\r\n') ? '\r\n' : '\n';
  let updated, nextLayout = structuredClone(layout);
  if (action === 'edit') {
    const title = line(input?.title, '名称', true, 'title'), date = line(input?.date, '时间', true, 'date');
    const subtitle = line(input?.subtitle ?? '', '专业或职责', false, 'subtitle'), stack = line(input?.stack ?? '', '技术栈', false, 'stack');
    if (typeof input?.content !== 'string' || !input.content.trim()) throw new ResumeError('请填写经历正文', { field: 'content' });
    const patches = [];
    if (title !== entry.title) patches.push({ start: entry.start, end: entry.headingEnd, value: `### ${title}${eol}` });
    const values = { date, subtitle, stack };
    if (Object.entries(values).some(([key, value]) => value !== (entry[key] || ''))) {
      const yaml = parseDocument(source.slice(entry.metaStart, entry.metaEnd));
      for (const [key, value] of Object.entries(values)) {
        if (value === (entry[key] || '')) continue;
        if (value) yaml.set(key, value); else yaml.delete(key);
      }
      patches.push({ start: entry.metaStart, end: entry.metaEnd, value: yaml.toString().replace(/\n/g, eol) });
    }
    if (normalized(input.content) !== normalized(entry.content)) patches.push({ start: entry.contentStart, end: entry.contentEnd, value: normalized(input.content).replace(/\n/g, eol).replace(/(?:\r\n|\n)+$/, '') });
    updated = source;
    for (const patch of patches.sort((a, b) => b.start - a.start)) updated = updated.slice(0, patch.start) + patch.value + updated.slice(patch.end);
  } else if (action === 'duplicate') {
    updated = source.slice(0, entry.start) + separated(raw, eol) + raw + source.slice(entry.end);
  } else if (action === 'up' || action === 'down') {
    const neighbor = section.entries[index + (action === 'up' ? -1 : 1)];
    if (!neighbor) throw new ResumeError(action === 'up' ? '已经是本章节第一条经历' : '已经是本章节最后一条经历');
    const [first, second] = action === 'up' ? [neighbor, entry] : [entry, neighbor];
    updated = source.slice(0, first.start) + separated(source.slice(second.start, second.end), eol) + source.slice(first.start, first.end) + source.slice(second.end);
  } else if (action === 'delete') {
    if (section.entries.length === 1) {
      if (sections.length === 1) throw new ResumeError('请至少保留一个章节，可以先添加其他经历');
      updated = source.slice(0, section.start) + source.slice(section.end);
      if (nextLayout.sectionOrder) nextLayout.sectionOrder = nextLayout.sectionOrder.filter(id => id !== sectionId);
    } else updated = source.slice(0, entry.start) + source.slice(entry.end);
  } else throw new ResumeError('请选择编辑、复制、上移、下移或删除');
  const after = parseResume(updated).document;
  if (action === 'edit' && (after.sections.length !== document.sections.length || after.sections.some((item, i) => item.id !== document.sections[i].id || item.kind !== document.sections[i].kind || item.entries?.length !== document.sections[i].entries?.length))) {
    throw new ResumeError('经历正文请使用段落或单层列表，不要添加章节或经历标题');
  }
  resolveSectionOrder(after, nextLayout);
  return { source: updated, layout: nextLayout };
}
