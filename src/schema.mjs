import { z } from 'zod';
import { ResumeError, locationFor } from './errors.mjs';

const text = z.string().trim().min(1);
const id = z.string().regex(/^[a-z][a-z0-9-]*$/);
const block = z.discriminatedUnion('type', [
  z.object({ type: z.literal('paragraph'), text }).strict(),
  z.object({ type: z.literal('list'), items: z.array(text).min(1), ordered: z.boolean(), start: z.number().int().positive().optional() }).strict(),
]);
export const entrySchema = z.object({ subtitle: text.optional(), date: text, stack: text.optional() }).strict();
const entry = entrySchema.extend({ title: text, blocks: z.array(block).min(1) });
const baseSection = { id, title: text };
const asset = z.object({ src: text, alt: text }).strict();
export const frontmatterSchema = z.object({
  schemaVersion: z.literal('0.2.0'),
  locale: z.literal('zh-CN').default('zh-CN'),
  person: z.object({
    name: text, target: text, label: text.optional(), availability: text.optional(),
    contacts: z.array(z.object({ text, href: text }).strict()).min(1).max(6),
  }).strict(),
  assets: z.object({ schoolLogo: asset.optional(), portrait: asset.optional() }).strict().default({}),
  notice: text.optional(),
}).strict();
export const documentSchema = frontmatterSchema.extend({
  sections: z.array(z.discriminatedUnion('kind', [
    z.object({ ...baseSection, kind: z.literal('entries'), entries: z.array(entry).min(1) }).strict(),
    z.object({ ...baseSection, kind: z.literal('skills'), items: z.array(z.object({ label: text, text }).strict()).min(1) }).strict(),
    z.object({ ...baseSection, kind: z.literal('lines'), blocks: z.array(block).min(1) }).strict(),
  ])).min(1),
}).strict();

const imageConfig = (defaults) => z.object({
  enabled: z.boolean().default(false),
  widthMm: z.number().min(10).max(40).default(defaults.widthMm),
  heightMm: z.number().min(10).max(40).default(defaults.heightMm),
  slot: z.enum(['start', 'end']).default(defaults.slot),
  align: z.enum(['top', 'center', 'bottom']).default('top'),
}).strict();
export const layoutSchema = z.object({
  schemaVersion: z.literal('0.2.0'),
  theme: z.literal('ink-blue').default('ink-blue'),
  preset: z.enum(['campus', 'experience']).default('campus'),
  page: z.object({ size: z.literal('A4').default('A4'), marginMm: z.number().min(14).max(17).default(15), maxPages: z.number().int().min(1).max(2).default(1) }).strict().prefault({}),
  bodyPt: z.number().min(10.5).max(11).default(10.5),
  lineHeight: z.number().min(1.25).max(1.5).default(1.36),
  namePt: z.number().min(20).max(24).default(23),
  accent: z.string().regex(/^#[0-9a-f]{6}$/i).default('#233e54'),
  sectionOrder: z.array(id).min(1).optional(),
  header: z.object({ gapMm: z.number().min(2).max(8).default(5) }).strict().prefault({}),
  spacing: z.object({ sectionMm: z.number().min(3).max(5).default(3.5), entryMm: z.number().min(2).max(5).default(3.2) }).strict().prefault({}),
  images: z.object({
    schoolLogo: imageConfig({ widthMm: 34, heightMm: 25, slot: 'end' }).prefault({}),
    portrait: imageConfig({ widthMm: 23, heightMm: 31, slot: 'start' }).prefault({}),
  }).strict().prefault({}),
}).strict();

export function validate(schema, input, locations, prefix = '') {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const field = [prefix, ...issue.path, ...(issue.code === 'unrecognized_keys' ? [issue.keys[0]] : [])].filter(value => value !== '').join('.');
  let message = '字段值不符合要求';
  if (issue.code === 'invalid_type') message = `需要${({ string: '非空文本（日期、电话请加引号）', number: '数字', boolean: 'true 或 false', array: '列表', object: '对象' })[issue.expected] || issue.expected}，请检查字段是否填写及类型`;
  else if (issue.code === 'too_small') message = `不能为空，或数值不得小于 ${issue.minimum}`;
  else if (issue.code === 'too_big') message = `数值或项目数量不得大于 ${issue.maximum}`;
  else if (issue.code === 'unrecognized_keys') message = `不支持的字段：${issue.keys.join(', ')}`;
  else if (issue.code === 'invalid_value') message = `只支持：${issue.values.map(value => JSON.stringify(value)).join(' / ')}`;
  else if (issue.code === 'invalid_format') message = field.endsWith('accent') ? '请填写六位颜色值，例如 "#233e54"' : 'ID 以小写字母开头，只能包含小写字母、数字和连字符';
  throw new ResumeError(message, { ...locationFor(locations, field), field });
}

export function resolveSectionOrder(document, layout, locations = new Map()) {
  const ids = document.sections.map(section => section.id);
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate) throw new ResumeError(`章节 ID 重复：${duplicate}`, { ...locationFor(locations, 'sections'), field: 'sections' });
  if (layout.sectionOrder) {
    if (layout.sectionOrder.length !== ids.length || new Set(layout.sectionOrder).size !== ids.length || layout.sectionOrder.some(id => !ids.includes(id))) {
      throw new ResumeError(`必须且仅包含全部章节 ID，不得重复：${ids.join(', ')}`, { ...locationFor(locations, 'sectionOrder'), field: 'sectionOrder' });
    }
    return layout.sectionOrder;
  }
  const preset = layout.preset === 'experience'
    ? ['skills', 'experience', 'internship', 'projects', 'education', 'additional']
    : ['education', 'skills', 'internship', 'experience', 'projects', 'additional'];
  return [...preset.filter(id => ids.includes(id)), ...ids.filter(id => !preset.includes(id))];
}
