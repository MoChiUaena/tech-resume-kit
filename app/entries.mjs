const sections = {
  education: { id: 'education', title: '教育背景' },
  internship: { id: 'internship', title: '实习经历' },
  work: { id: 'experience', title: '工作经历' },
  project: { id: 'projects', title: '项目经历' },
};
const presets = {
  campus: ['education', 'skills', 'internship', 'experience', 'projects', 'additional'],
  experience: ['skills', 'experience', 'internship', 'projects', 'education', 'additional'],
};

function oneLine(value, label, required = false) {
  const text = String(value || '').trim();
  if (required && !text) throw new Error(`请填写${label}`);
  if (/[\r\n\x00]/.test(text)) throw new Error(`${label}需要写在同一行`);
  return text;
}

function scanSections(body) {
  const result = []; let offset = 0, fence;
  for (const line of body.split('\n')) {
    const code = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (code) {
      if (!fence) fence = { character: code[1][0], length: code[1].length };
      else if (code[1][0] === fence.character && code[1].length >= fence.length && !code[2].trim()) fence = undefined;
    } else if (!fence && /^ {0,3}##\s+/.test(line)) {
      const match = /^ {0,3}##\s+(.+?)\s+\{#([a-z][a-z0-9-]*)\s+\.(entries|skills|lines)\}\s*$/.exec(line);
      result.push({ offset, id: match?.[2], kind: match?.[3] });
    }
    offset += line.length + 1;
  }
  if (fence) throw new Error('正文中有未结束的代码块，请补齐结束标记后再添加经历');
  return result;
}

export function insertResumeEntry(body, input, layout = {}) {
  const target = sections[input.kind];
  if (!target) throw new Error('请选择教育、实习、工作或项目经历');
  body = body.replace(/\r\n?/g, '\n');
  const title = oneLine(input.title, '名称', true), date = oneLine(input.date, '时间', true);
  const subtitle = oneLine(input.subtitle, '专业或职责'), stack = oneLine(input.stack, '技术栈');
  const details = String(input.details || '').split(/\r?\n/).map(line => line.trim().replace(/^[-•]\s*/, '')).filter(Boolean);
  if (!details.length) throw new Error('请至少填写一条经历要点');
  const found = scanSections(body), matching = found.filter(section => section.id === target.id);
  if (matching.length > 1) throw new Error(`正文中有重复的 ${target.title}，请先合并章节`);
  if (matching[0] && matching[0].kind !== 'entries') throw new Error(`${target.title}不是经历章节，请先修正章节标记`);
  const order = presets[layout.preset] || presets.campus;
  let position, newSection = !matching.length, anchor;
  if (matching.length) {
    const index = found.indexOf(matching[0]); position = found[index + 1]?.offset ?? body.length;
  } else {
    anchor = found.find(section => (order.indexOf(section.id) < 0 ? 100 : order.indexOf(section.id)) > order.indexOf(target.id));
    position = anchor?.offset ?? body.length;
  }
  const yaml = [subtitle ? `subtitle: ${JSON.stringify(subtitle)}` : '', `date: ${JSON.stringify(date)}`, stack ? `stack: ${JSON.stringify(stack)}` : ''].filter(Boolean).join('\n');
  const entry = `### ${title}\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n\n${details.map(line => `- ${line}`).join('\n')}\n`;
  const fragment = `${newSection ? `## ${target.title} {#${target.id} .entries}\n\n` : ''}${entry}`;
  const prefix = body.slice(0, position).replace(/\s*$/, ''), suffix = body.slice(position).replace(/^\s*/, '');
  const insertionStart = prefix.length + (prefix ? 2 : 0);
  const updated = `${prefix}${prefix ? '\n\n' : ''}${fragment}${suffix ? `\n${suffix}` : ''}`;
  let sectionOrder = layout.sectionOrder?.slice();
  if (newSection && sectionOrder && !sectionOrder.includes(target.id)) {
    const index = anchor?.id ? sectionOrder.indexOf(anchor.id) : -1;
    sectionOrder.splice(index < 0 ? sectionOrder.length : index, 0, target.id);
  }
  return { body: updated, sectionId: target.id, sectionOrder, selectionStart: insertionStart, selectionEnd: insertionStart + fragment.length };
}
