import { parseTree, getNodeValue, printParseErrorCode } from 'jsonc-parser';
import { ResumeError } from './errors.mjs';

export function parseStrictJson(source, file = 'resume.json') {
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
  const locations = new Map();
  function record(node, keys = []) {
    locations.set(keys.join('.'), { file, line: lineAt(node.offset) });
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
  return { input: getNodeValue(tree), locations };
}
