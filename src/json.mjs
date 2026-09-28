import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseTree, getNodeValue, printParseErrorCode } from 'jsonc-parser';
import { z } from 'zod';
import { documentSchema, layoutSchema, validate, resolveSectionOrder } from './schema.mjs';
import { validateLink } from './markdown.mjs';
import { ResumeError } from './errors.mjs';

const envelopeSchema = z.object({ document: documentSchema, layout: layoutSchema }).strict();
export function parseResumeJson(source, file = 'resume.json') {
  source = source.replace(/^\uFEFF/, '');
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1);
  function lineAt(offset) {
    let low = 0, high = starts.length;
    while (low + 1 < high) { const mid = Math.floor((low + high) / 2); if (starts[mid] <= offset) low = mid; else high = mid; }
    return low + 1;
  }
  const errors = [];
  const tree = parseTree(source, errors, { disallowComments: true, allowTrailingComma: false, allowEmptyContent: false });
  if (errors.length || !tree) {
    const error = errors[0];
    throw new ResumeError(`JSON 格式错误：${error ? printParseErrorCode(error.error) : '文件为空'}；使用标准 JSON，不含注释或尾逗号`, { file, line: lineAt(error?.offset || 0), code: 'JSON' });
  }
  const allLocations = new Map();
  function record(node, keys = []) {
    allLocations.set(keys.join('.'), { file, line: lineAt(node.offset) });
    if (node.type === 'object') {
      const seen = new Set();
      for (const property of node.children || []) {
        const [key, value] = property.children;
        if (seen.has(key.value)) throw new ResumeError(`JSON 字段重复：${key.value}`, { file, line: lineAt(key.offset), field: [...keys, key.value].join('.'), code: 'JSON' });
        seen.add(key.value); record(value, [...keys, key.value]);
      }
    } else if (node.type === 'array') (node.children || []).forEach((child, index) => record(child, [...keys, index]));
  }
  record(tree);
  const input = getNodeValue(tree);
  if (input?.schemaVersion === 2 || input?.document?.schemaVersion === 2) throw new ResumeError('这是工作台 schemaVersion 2 数据；请先转换成套件的 { document, layout }，两者的字段和版式范围不同', { file, field: 'schemaVersion', code: 'MODEL' });
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
