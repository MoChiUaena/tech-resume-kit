// Document appearance is independent of starter content and section order.
export const resumeThemes = Object.freeze([
  { id: 'ink-blue', label: '墨蓝经典', accent: '#233e54', description: '左侧照片、独立校徽与细线章节，层次清晰。' },
  { id: 'minimal-mono', label: '极简黑白', accent: '#25282b', description: '居中姓名、黑白层级与轻分隔，适合简洁投递。' },
  { id: 'slate-banner', label: '深蓝横幅', accent: '#243c54', description: '深色页眉、白色信息与色块标题，突出个人介绍。' },
  { id: 'forest-rail', label: '森林目录', accent: '#28624e', description: '章节标题独立在左，经历集中在右，阅读路径鲜明。' },
  { id: 'warm-labels', label: '暖橙标签', accent: '#984b2f', description: '暖色章节标签、技术栈底色与宽松留白，亲和明快。' },
  { id: 'graphite-grid', label: '灰阶商务', accent: '#3d474f', description: '灰底标题、整齐元信息与克制强调，适合正式材料。' },
].map(theme => Object.freeze({ ...theme, preview: '/theme-previews/' + theme.id + '.png', previewPdf: '/theme-previews/' + theme.id + '.pdf' })));

export const findResumeTheme = id => resumeThemes.find(theme => theme.id === id);

export function applyResumeTheme(layout, id) {
  const theme = findResumeTheme(id);
  if (!theme) throw new RangeError('未知视觉风格');
  return { ...layout, theme: theme.id, accent: theme.accent };
}
