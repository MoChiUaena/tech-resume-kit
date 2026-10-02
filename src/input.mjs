import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseDocument, LineCounter, visit } from 'yaml';
import { ResumeError } from './errors.mjs';
import { markdown, validateInline, validateLink } from './markdown.mjs';
import { documentSchema, frontmatterSchema, entrySchema, layoutSchema, validate, resolveSectionOrder } from './schema.mjs';

export function readYaml(source, file, offset = 0, locations = new Map(), prefix = '') {
  const lineCounter = new LineCounter();
  const parsed = parseDocument(source, { lineCounter, uniqueKeys: true, version: '1.2' });
  const error = parsed.errors[0] || parsed.warnings[0];
  if (error) throw new ResumeError(`YAML 格式错误：${error.message.split('\n')[0]}`, { file, line: offset + lineCounter.linePos(error.pos[0]).line, field: prefix });
  visit(parsed, { Alias() { throw new ResumeError('不支持 YAML 锚点引用，请直接填写字段', { file, line: offset + 1, field: prefix }); } });
  const data = parsed.toJS({ maxAliasCount: 0 });
  function record(value, keys = []) {
    const node = keys.length ? parsed.getIn(keys, true) : parsed.contents;
    locations.set([prefix, ...keys].filter(key => key !== '').join('.'), { file, line: offset + lineCounter.linePos(node?.range?.[0] || 0).line });
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) record(child, [...keys, Array.isArray(value) ? Number(key) : key]);
  }
  record(data);
  return data;
}

export function parseResume(source, file = 'resume.md') {
  const lines = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  if (lines[0] !== '---') throw new ResumeError('文件开头需要 YAML 元数据，以 --- 开始和结束', { file, line: 1 });
  const end = lines.indexOf('---', 1);
  if (end < 0) throw new ResumeError('顶部 YAML 缺少结束标记 ---', { file, line: 1 });
  const locations = new Map();
  const front = readYaml(lines.slice(1, end).join('\n'), file, 1, locations);
  const document = { ...validate(frontmatterSchema, front, locations), sections: [] };
  const environment = {};
  const bodyLines = lines.slice(end + 1);
  const tokens = markdown.parse(bodyLines.join('\n'), environment);
  if (Object.keys(environment.references || {}).length) {
    const referenceLine = bodyLines.findIndex(line => /^\s*\[[^\]]+\]:/.test(line));
    throw new ResumeError('不支持引用式链接定义，请使用 [文字](https://example.com) 形式的行内链接', { file, line: end + 2 + Math.max(0, referenceLine) });
  }
  const where = (token, field) => ({ file, line: (token.map?.[0] || 0) + end + 2, field });
  const remember = (field, token) => locations.set(field, where(token, field));
  let section, entry, sectionPath, entryPath;
  let index = 0;
  function error(message, token = tokens[index]) { throw new ResumeError(message, where(token)); }
  function paragraph(at) {
    const token = tokens[at + 1];
    if (tokens[at]?.type !== 'paragraph_open' || token?.type !== 'inline' || tokens[at + 2]?.type !== 'paragraph_close') error('此处需要一个普通 Markdown 段落', tokens[at]);
    validateInline(token.content, where(token));
    return { text: token.content, next: at + 3 };
  }
  function list(at) {
    const opening = tokens[at];
    const ordered = opening.type === 'ordered_list_open';
    const close = ordered ? 'ordered_list_close' : 'bullet_list_close';
    const items = [];
    let cursor = at + 1;
    while (tokens[cursor]?.type !== close) {
      if (tokens[cursor]?.type !== 'list_item_open') error('只支持单层列表', tokens[cursor] || opening);
      const item = paragraph(cursor + 1);
      if (tokens[item.next]?.type !== 'list_item_close') error('列表项只支持一个段落；请拆成独立条目，不要嵌套列表', tokens[item.next]);
      items.push(item.text);
      cursor = item.next + 1;
    }
    return { block: { type: 'list', ordered, ...(ordered ? { start: Number(opening.attrGet('start') || 1) } : {}), items }, next: cursor + 1 };
  }
  while (index < tokens.length) {
    const token = tokens[index];
    if (token.type === 'heading_open' && token.tag === 'h2') {
      const match = /^(.*?)\s+\{#([a-z][a-z0-9-]*)\s+\.(entries|skills|lines)\}$/.exec(tokens[index + 1].content);
      if (!match) error('章节标题格式：## 教育背景 {#education .entries}；类型可选 entries、skills、lines');
      if (document.sections.some(section => section.id === match[2])) error(`章节 ID 重复：${match[2]}`);
      const collection = { entries: 'entries', skills: 'items', lines: 'blocks' }[match[3]];
      section = { id: match[2], title: match[1].trim(), kind: match[3], [collection]: [] };
      sectionPath = `sections.${document.sections.length}`;
      remember(sectionPath, token);
      document.sections.push(section);
      entry = undefined;
      index += 3;
      continue;
    }
    if (!section) error('正文从二级章节标题开始，例如 ## 教育背景 {#education .entries}');
    if (token.type === 'heading_open' && token.tag === 'h3') {
      if (section.kind !== 'entries') error('只有 entries 章节允许三级条目标题');
      const title = tokens[index + 1].content;
      const meta = tokens[index + 3];
      if (meta?.type !== 'fence' || !['yaml', 'yml'].includes(meta.info.trim())) error('条目标题后需要 yaml 代码块，填写 date、subtitle，可选 stack');
      entryPath = `${sectionPath}.entries.${section.entries.length}`;
      remember(entryPath, token);
      const data = readYaml(meta.content, file, where(meta).line, locations, entryPath);
      entry = { title, ...validate(entrySchema, data, locations, entryPath), blocks: [] };
      section.entries.push(entry);
      index += 4;
      continue;
    }
    if (section.kind === 'entries' && !entry) error('entries 章节需要 ### 条目名称，以及日期和角色信息');
    let block, next;
    if (token.type === 'paragraph_open') { const result = paragraph(index); block = { type: 'paragraph', text: result.text }; next = result.next; }
    else if (['bullet_list_open', 'ordered_list_open'].includes(token.type)) { const result = list(index); block = result.block; next = result.next; }
    else error('不支持此 Markdown 结构；请使用二/三级标题、普通段落、单层列表、加粗和链接');
    if (section.kind === 'skills') {
      if (block.type !== 'list' || block.ordered) error('skills 章节使用列表：- **技能名**：技能说明');
      for (const text of block.items) {
        const match = /^\*\*([^*]+)\*\*\s*[：:]\s*(.+)$/s.exec(text);
        if (!match) error('技能格式：- **Java 后端**：熟悉集合、线程池与 Spring Boot');
        const itemPath = `${sectionPath}.items.${section.items.length}`;
        remember(itemPath, token);
        section.items.push({ label: match[1].trim(), text: match[2].trim() });
      }
    } else {
      const target = entry || section;
      remember(`${entry ? entryPath : sectionPath}.blocks.${target.blocks.length}`, token);
      target.blocks.push(block);
    }
    index = next;
  }
  if (!document.sections.length) throw new ResumeError('请至少填写一个简历章节', { file, line: end + 2, field: 'sections', reason: 'EMPTY_BODY' });
  const result = validate(documentSchema, document, locations);
  for (const [index, contact] of result.person.contacts.entries()) validateLink(contact.href, { ...locations.get(`person.contacts.${index}.href`), field: `person.contacts.${index}.href` });
  return { document: result, locations };
}

export async function loadResume(inputPath, configPath) {
  const inputFile = path.resolve(inputPath);
  const configFile = path.resolve(configPath || path.join(path.dirname(inputFile), 'layout.yaml'));
  async function read(file) {
    try { return await readFile(file, 'utf8'); } catch { throw new ResumeError('文件无法读取，请检查路径', { file }); }
  }
  const parsed = parseResume(await read(inputFile), inputFile);
  const layoutLocations = new Map();
  const layoutData = readYaml(await read(configFile), configFile, 0, layoutLocations);
  const layout = validate(layoutSchema, layoutData, layoutLocations);
  layout.sectionOrder = resolveSectionOrder(parsed.document, layout, layoutLocations);
  return { ...parsed, layout, layoutLocations, inputFile, configFile, assetBase: path.dirname(inputFile) };
}
