import { isDeepStrictEqual } from 'node:util';
import { parseDocument, isSeq, stringify } from 'yaml';

function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

function updateNodes(document, before, after, path = []) {
  if (isDeepStrictEqual(before, after)) return;
  if (Array.isArray(before) && Array.isArray(after)) {
    const sequence = document.getIn(path, true);
    if (!isSeq(sequence)) { document.setIn(path, after); return; }
    for (let index = 0; index < Math.min(before.length, after.length); index++) updateNodes(document, before[index], after[index], [...path, index]);
    for (let index = before.length - 1; index >= after.length; index--) document.deleteIn([...path, index]);
    for (let index = before.length; index < after.length; index++) sequence.add(document.createNode(after[index]));
  } else if (isRecord(before) && isRecord(after)) {
    for (const key of Object.keys(before)) if (!Object.hasOwn(after, key)) document.deleteIn([...path, key]);
    for (const [key, value] of Object.entries(after)) {
      if (Object.hasOwn(before, key)) updateNodes(document, before[key], value, [...path, key]);
      else document.setIn([...path, key], value);
    }
  } else document.setIn(path, after);
}

export function saveStructuredSource(source, previousFront, nextFront, nextBody) {
  const bom = source.startsWith('\uFEFF') ? '\uFEFF' : '';
  const plain = source.slice(bom.length);
  const match = /^---(\r?\n)([\s\S]*?)\r?\n---(\r?\n|$)/.exec(plain);
  if (!match || !isRecord(previousFront)) return `---\n${stringify(nextFront)}---\n\n${nextBody.replace(/^\s*\n/, '')}`;

  const newline = match[1], previousBody = plain.slice(match[0].length);
  const content = text => text.replace(/\r\n?/g, '\n').replace(/^\s*\n/, '');
  const editedBody = content(nextBody);
  const body = content(previousBody) === editedBody ? previousBody : newline + editedBody.replace(/\n/g, newline);
  if (isDeepStrictEqual(previousFront, nextFront)) return bom + match[0] + body;

  const document = parseDocument(match[2], { uniqueKeys: true, version: '1.2' });
  updateNodes(document, previousFront, nextFront);
  const yaml = document.toString({ lineWidth: 0 }).replace(/\n$/, '').replace(/\n/g, newline);
  return `${bom}---${newline}${yaml}${newline}---${match[3]}${body}`;
}
