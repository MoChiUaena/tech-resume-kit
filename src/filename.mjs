const substitutions = { '<': '＜', '>': '＞', ':': '：', '"': '＂', '/': '／', '\\': '＼', '|': '｜', '?': '？', '*': '＊' };

export function safeFilenamePart(value, fallback = '未命名') {
  const clean = [...String(value ?? '').normalize('NFC').trim()
    .replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, character => substitutions[character] || '')
    .replace(/\s+/g, ' ').replace(/[. ]+$/g, '')].slice(0, 60).join('');
  return clean || fallback;
}

export function resumeFilename(personName, resumeName, extension) {
  if (!['pdf', 'md'].includes(extension)) throw new TypeError('Unsupported resume export format');
  return `${safeFilenamePart(personName, '我的')}-${safeFilenamePart(resumeName, '简历')}.${extension}`;
}
