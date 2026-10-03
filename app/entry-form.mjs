const labels = {
  education: ['教育经历', '学校名称', '专业 / 学历', '在校时间', '课程、成绩与奖项'],
  internship: ['实习经历', '公司名称', '实习岗位', '实习时间', '工作内容与成果'],
  work: ['工作经历', '公司名称', '岗位 / 职责', '任职时间', '工作内容与成果'],
  project: ['项目经历', '项目名称', '负责角色', '项目时间', '项目目标、做法与成果'],
};
const sectionKinds = { education: 'education', internship: 'internship', experience: 'work', projects: 'project' };
const $ = id => document.getElementById(id);

export function entryKindForSection(sectionId) { return Object.hasOwn(sectionKinds, sectionId) ? sectionKinds[sectionId] : undefined; }

export function configureEntryForm(kind, { editing = false, stack = '' } = {}) {
  const [name, title, subtitle, date, details] = labels[kind] || ['经历', '名称', '专业 / 岗位 / 职责', '时间', '经历内容'];
  $('entry-dialog-title').textContent = `${editing ? '编辑' : '添加'}${name}`;
  $('entry-title-label').textContent = title; $('entry-subtitle-label').textContent = subtitle;
  $('entry-date-label').textContent = date;
  $('entry-details-label').textContent = details + (editing ? '' : '，每行一条');
  $('entry-stack-field').hidden = kind === 'education' && !stack;
  $('entry-date').placeholder = kind === 'education' ? '例如：2023.09 - 2027.06（预计）' : '例如：2025.03 - 2025.06';
  $('entry-details').maxLength = editing ? 200000 : 10000; $('entry-details').rows = editing ? 8 : 4;
  $('entry-details').placeholder = kind === 'education' ? '填写相关课程、成绩或奖项。' : '填写你负责的工作、关键做法和结果。';
  $('entry-content-help').hidden = false;
  $('entry-content-help').textContent = editing ? '可直接填写普通文字；已有段落、列表、加粗和链接可继续保留。' : '直接填写普通文字，每行一个要点，工具会自动排成列表。';
}
