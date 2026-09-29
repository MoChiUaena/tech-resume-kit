import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseStrictJson } from './json-source.mjs';
import { z } from 'zod';
import { documentSchema, layoutSchema, validate, resolveSectionOrder } from './schema.mjs';
import { validateLink } from './markdown.mjs';
import { ResumeError } from './errors.mjs';

const envelopeSchema = z.object({ document: documentSchema, layout: layoutSchema }).strict();
export function parseResumeJson(source, file = 'resume.json') {
  const { input, locations: allLocations } = parseStrictJson(source, file);
  if (typeof input?.schemaVersion === 'number' || typeof input?.document?.schemaVersion === 'number') throw new ResumeError('这是工作台数据；请使用 convertWorkbenchResume 或 convert-workbench 显式转换成套件的 { document, layout }', { file, field: 'schemaVersion', code: 'MODEL' });
  const { document, layout } = validate(envelopeSchema, input, allLocations);
  const under = prefix => new Map([...allLocations].filter(([key]) => key === prefix || key.startsWith(prefix + '.')).map(([key, value]) => [key.slice(prefix.length + 1), value]));
  const locations = under('document'), layoutLocations = under('layout');
  layout.sectionOrder = resolveSectionOrder(document, layout, layoutLocations);
  for (const [index, contact] of document.person.contacts.entries()) {
    const field = `person.contacts.${index}.href`;
    validateLink(contact.href, { ...locations.get(field), field });
  }
  return { document, layout, locations, layoutLocations };
}
export async function loadResumeJson(inputPath, { assetBase } = {}) {
  const inputFile = path.resolve(inputPath);
  let source;
  try { source = await readFile(inputFile, 'utf8'); } catch { throw new ResumeError('JSON 文件无法读取，请检查路径', { file: inputFile }); }
  return { ...parseResumeJson(source, inputFile), inputFile, assetBase: path.resolve(assetBase || path.dirname(inputFile)) };
}
