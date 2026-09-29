import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { documentSchema, layoutSchema, validate, resolveSectionOrder } from './schema.mjs';
import { parseStrictJson } from './json-source.mjs';
import { assetPath, imageLabels } from './assets.mjs';
import { ResumeError, locationFor } from './errors.mjs';

const nonempty = max => z.string().min(1).max(max).refine(value => value.trim().length > 0);
const text = max => z.string().max(max);
const uuid = z.string().regex(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
const imageSlot = z.object({
  id: uuid.nullable(), visible: z.boolean(), widthMm: z.number().int().min(16).max(36), heightMm: z.number().int().min(16).max(42),
  fit: z.enum(['cover', 'contain']), quarterTurns: z.number().int().min(0).max(3), zoom: z.number().min(1).max(2),
  positionX: z.number().int().min(0).max(100), positionY: z.number().int().min(0).max(100),
}).strict();
const presentation = z.object({
  language: z.enum(['zh', 'en']), accentColor: z.string().regex(/^#[0-9a-f]{6}$/i), alignment: z.enum(['left', 'center', 'justify']),
  contactStyle: z.enum(['labels', 'icons', 'plain']), headingStyle: z.enum(['template', 'line', 'bar', 'plain']),
  marginHorizontalMm: z.number().int().min(8).max(32), marginTopMm: z.number().int().min(8).max(32), marginBottomMm: z.number().int().min(8).max(32),
  entryGapMm: z.number().min(0).max(8), paragraphGapMm: z.number().min(0).max(4),
}).strict();
const sourceSchema = z.object({
  schemaVersion: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  content: z.object({
    name: nonempty(30), headline: text(70), email: text(100), phone: text(30), location: text(40),
    sections: z.array(z.object({
      id: nonempty(50), type: z.enum(['education', 'experience', 'project', 'skills', 'custom']), title: nonempty(40),
      visible: z.boolean(), pageBreakBefore: z.boolean(), entries: z.array(z.object({
        id: nonempty(50), title: text(80), meta: text(120), bulleted: z.boolean(), bullets: z.array(text(800)).max(30),
      }).strict()).max(15),
    }).strict()).max(20),
  }).strict(),
  layout: z.object({
    template: z.enum(['classic', 'banner', 'card', 'rail']), font: z.enum(['sans', 'serif']), fontSize: z.number().min(9).max(12),
    lineHeight: z.number().min(1.2).max(2), sectionGapMm: z.number().int().min(0).max(12), marginMm: z.number().int().min(12).max(22),
    swapImages: z.boolean(), photo: imageSlot, logo: imageSlot, presentation: presentation.optional(),
  }).strict(),
}).strict();
const mappingSchema = z.object({ id: uuid, src: z.string().min(1), alt: z.string().trim().min(1).optional(), prepared: z.boolean().default(false) }).strict();
const optionsSchema = z.object({
  layout: layoutSchema, assets: z.object({ portrait: mappingSchema.optional(), schoolLogo: mappingSchema.optional() }).strict().default({}),
  pageBreaks: z.literal('natural').optional(),
}).strict();

// Workbench RichText renders only **bold**; escape every other punctuation mark.
const literal = value => value.replace(/[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/g, '\\$&');
function richText(value) {
  const parts = [];
  const add = (bold, text) => {
    if (!text) return;
    if (parts.at(-1)?.bold === bold) parts.at(-1).text += text;
    else parts.push({ bold, text });
  };
  let end = 0;
  for (const match of value.matchAll(/\*\*([^*\n]+)\*\*/g)) {
    add(false, value.slice(end, match.index));
    const text = match[1], trimmed = text.trim();
    if (trimmed) {
      const start = text.indexOf(trimmed);
      add(false, text.slice(0, start)); add(true, trimmed); add(false, text.slice(start + trimmed.length));
    } else add(false, text);
    end = match.index + match[0].length;
  }
  add(false, value.slice(end));
  return parts.map((part, index) => {
    if (part.bold) return '**' + literal(part.text) + '**';
    // Entities at the boundary keep punctuation-ending bold valid before Chinese text.
    // They decode to the original characters, without inserting visible or hidden text.
    const characters = [...part.text];
    return characters.map((character, i) => (i === 0 && parts[index - 1]?.bold) || (i === characters.length - 1 && parts[index + 1]?.bold)
      ? `&#${character.codePointAt(0)};` : literal(character)).join('');
  }).join('');
}

export function convertWorkbenchResume(input, options, context = {}) {
  const locations = context.locations || new Map(), optionLocations = context.optionLocations || new Map();
  const fail = (message, field) => { throw new ResumeError(message, { ...locationFor(locations, field), field, code: 'CONVERSION' }); };
  if (![2, 3, 4].includes(input?.schemaVersion)) fail('仅支持工作台 schemaVersion 2、3、4 的单份 document；请勿传入简历记录或整库备份', 'schemaVersion');
  const source = validate(sourceSchema, input, locations);
  if (source.schemaVersion < 4 && !['classic', 'banner'].includes(source.layout.template)) fail('schemaVersion 2、3 只支持 classic / banner 模板', 'layout.template');
  if (source.schemaVersion >= 3 && !source.layout.presentation) fail('schemaVersion 3、4 需要 presentation 版式字段', 'layout.presentation');
  const opts = validate(optionsSchema, options, optionLocations);
  const report = { sourceSchemaVersion: source.schemaVersion, targetSchemaVersion: '0.2.0', sections: [], omitted: [], layoutChanges: [] };
  const warnings = ['已按明确选择的墨蓝套件版式转换；原工作台数据仍保留在输入文件中。'];
  const layout = opts.layout, sections = [], seenSections = new Set();
  for (const [index, section] of source.content.sections.entries()) {
    const field = `content.sections.${index}`;
    if (seenSections.has(section.id)) fail(`章节 ID 重复：${section.id}`, field + '.id');
    seenSections.add(section.id);
    const seenEntries = new Set();
    for (const [entryIndex, entry] of section.entries.entries()) {
      if (seenEntries.has(entry.id)) fail(`条目 ID 重复：${entry.id}`, `${field}.entries.${entryIndex}.id`);
      seenEntries.add(entry.id);
    }
    if (!section.visible) { report.omitted.push({ field, id: section.id, reason: 'hidden' }); continue; }
    if (section.pageBreakBefore) {
      if (opts.pageBreaks !== 'natural') fail('此章节设置了强制分页；套件使用自然分页。请在转换选项中明确设置 pageBreaks: "natural"，或在源数据中移除强制分页', field + '.pageBreakBefore');
      warnings.push(`“${section.title}”的强制分页改为自然分页。`);
      report.layoutChanges.push({ field: field + '.pageBreakBefore', from: true, to: 'natural' });
    }
    const converted = [];
    for (const [entryIndex, entry] of section.entries.entries()) {
      const blocks = entry.bullets.filter(value => value.trim()).map(richText);
      if (!entry.title.trim() && !entry.meta.trim() && !blocks.length) {
        report.omitted.push({ field: `${field}.entries.${entryIndex}`, id: entry.id, reason: 'empty' }); continue;
      }
      converted.push({ source: entry, blocks: entry.bulleted && blocks.length ? [{ type: 'list', ordered: false, items: blocks }] : blocks.map(text => ({ type: 'paragraph', text })) });
    }
    if (!converted.length) fail(`可见章节“${section.title}”没有内容；请填写条目或将章节隐藏`, field + '.entries');
    const id = `workbench-${index + 1}`, titled = converted.every(entry => entry.source.title.trim() && entry.blocks.length);
    if (titled) sections.push({ id, title: section.title, kind: 'entries', entries: converted.map(({ source: entry, blocks }) => ({
      title: entry.title, ...(entry.meta.trim() ? { subtitle: entry.meta } : {}), blocks,
    })) });
    else {
      const blocks = [];
      for (const entry of converted) {
        if (entry.source.title.trim()) blocks.push({ type: 'paragraph', text: '**' + literal(entry.source.title.trim()) + '**' });
        if (entry.source.meta.trim()) blocks.push({ type: 'paragraph', text: literal(entry.source.meta) });
        blocks.push(...entry.blocks);
      }
      sections.push({ id, title: section.title, kind: 'lines', blocks });
    }
    report.sections.push({ sourceId: section.id, targetId: id, kind: titled ? 'entries' : 'lines', entryIds: converted.map(entry => entry.source.id) });
  }
  if (!sections.length) fail('没有可见且有内容的章节，无法生成简历', 'content.sections');
  if (report.omitted.length) warnings.push(`转换报告记录了 ${report.omitted.length} 个隐藏章节或空条目；原数据未修改。`);
  const content = source.content;
  if (!content.headline.trim()) fail('求职方向为空，请先填写 headline', 'content.headline');
  const contacts = [];
  if (content.phone.trim()) contacts.push({ text: content.phone, href: 'tel:' + encodeURIComponent(content.phone.replace(/\s/g, '')).replaceAll('%2B', '+') });
  if (content.email.trim()) contacts.push({ text: content.email, href: 'mailto:' + encodeURIComponent(content.email.trim()).replaceAll('%40', '@') });
  if (!contacts.length) fail('请至少填写电话或邮箱；转换不会生成虚构的联系方式', 'content');
  const assets = {};
  for (const [key, sourceKey] of [['portrait', 'photo'], ['schoolLogo', 'logo']]) {
    const slot = source.layout[sourceKey], mapped = opts.assets[key], enabled = slot.visible && slot.id !== null;
    const originalConfig = options.layout.images?.[key] || {};
    if (originalConfig.enabled !== undefined && originalConfig.enabled !== enabled) fail(`${imageLabels[key]}的目标开关与源可见状态不一致；请在源数据中明确修改开关`, `layout.${sourceKey}.visible`);
    layout.images[key] = { ...layout.images[key], enabled,
      widthMm: originalConfig.widthMm ?? slot.widthMm, heightMm: originalConfig.heightMm ?? slot.heightMm,
      slot: originalConfig.slot ?? ((key === 'portrait') !== source.layout.swapImages ? 'start' : 'end'),
    };
    if (mapped && mapped.id !== slot.id) fail(`${imageLabels[key]}的素材映射 ID 与源数据不一致`, `layout.${sourceKey}.id`);
    if (enabled && !mapped) fail(`${imageLabels[key]}缺少本地素材映射；请通过 assets.${key} 提供匹配的 id、src`, `layout.${sourceKey}.id`);
    if (!mapped) continue;
    assetPath(context.assetBase || '.', mapped.src, { field: `assets.${key}.src` });
    if (!/\.(png|jpe?g)$/i.test(mapped.src)) fail(`${imageLabels[key]}仅支持本地 PNG / JPEG`, `layout.${sourceKey}.id`);
    // Match the existing template positions; every other transform must be baked into the mapped image.
    const [x, y] = key === 'portrait' ? [50, 42] : [100, 0];
    const needsPrepared = slot.fit !== (key === 'portrait' ? 'cover' : 'contain') || slot.quarterTurns !== 0 || slot.zoom !== 1 || slot.positionX !== x || slot.positionY !== y;
    if (enabled && needsPrepared && !mapped.prepared) fail(`${imageLabels[key]}包含裁剪、旋转或不同适配模式；请先将效果合成到本地图片，再设置 assets.${key}.prepared: true`, `layout.${sourceKey}`);
    assets[key] = { src: mapped.src, alt: mapped.alt || imageLabels[key] };
  }
  const document = validate(documentSchema, { schemaVersion: '0.2.0', person: {
    name: content.name, target: content.headline, ...(content.location.trim() ? { label: content.location } : {}), contacts,
  }, assets, sections });
  const normalized = validate(layoutSchema, layout, optionLocations, 'layout');
  normalized.sectionOrder = resolveSectionOrder(document, normalized);
  const changed = (field, from, to) => { if (JSON.stringify(from) !== JSON.stringify(to)) report.layoutChanges.push({ field, from, to }); };
  for (const [key, target] of [['template', normalized.theme], ['font', 'ResumeSansSC'], ['fontSize', normalized.bodyPt], ['lineHeight', normalized.lineHeight], ['sectionGapMm', normalized.spacing.sectionMm], ['marginMm', normalized.page.marginMm]]) changed(`layout.${key}`, source.layout[key], target);
  if (source.layout.presentation) {
    const values = { language: 'zh', accentColor: normalized.accent, alignment: 'left', contactStyle: 'plain', headingStyle: 'line', marginHorizontalMm: normalized.page.marginMm, marginTopMm: normalized.page.marginMm, marginBottomMm: normalized.page.marginMm, entryGapMm: normalized.spacing.entryMm, paragraphGapMm: 'template' };
    for (const [key, target] of Object.entries(values)) changed(`layout.presentation.${key}`, source.layout.presentation[key], target);
  }
  for (const [key, sourceKey] of [['portrait', 'photo'], ['schoolLogo', 'logo']]) {
    for (const property of ['widthMm', 'heightMm']) changed(`layout.${sourceKey}.${property}`, source.layout[sourceKey][property], normalized.images[key][property]);
  }
  return { document, layout: normalized, report, warnings };
}

export async function loadWorkbenchResume(inputPath, options, { assetBase, optionsFile } = {}) {
  if (options !== undefined && optionsFile) throw new ResumeError('请只提供转换选项对象或 optionsFile，不能同时提供', { field: 'optionsFile', code: 'CONVERSION' });
  const inputFile = path.resolve(inputPath), base = path.resolve(assetBase || path.dirname(optionsFile || inputFile));
  const read = async file => {
    try { return parseStrictJson(await readFile(file, 'utf8'), file); }
    catch (error) { if (error instanceof ResumeError) throw error; throw new ResumeError('JSON 文件无法读取，请检查路径', { file }); }
  };
  const source = await read(inputFile);
  const configured = optionsFile ? await read(path.resolve(optionsFile)) : { input: options, locations: new Map() };
  return { ...convertWorkbenchResume(source.input, configured.input, { locations: source.locations, optionLocations: configured.locations, assetBase: base }), inputFile, assetBase: base };
}
