import { resumeThemes, applyResumeTheme } from '../src/resume-themes.mjs';

// Keep these fixtures compact and fictional so wrapping, image slots and user
// settings can be checked independently of the legacy pagination stress cases.
export function themeBoundaryCases(baseline) {
  const cases = [], rejections = [];
  for (const theme of resumeThemes) {
    const make = caseId => {
      const layout = applyResumeTheme(structuredClone(baseline.layout), theme.id);
      layout.page.maxPages = 2;
      return { stem: `${theme.id}-${caseId}`, themeId: theme.id, caseId,
        document: structuredClone(baseline.document), layout, assetBase: baseline.assetBase };
    };

    const portrait = make('portrait-only');
    portrait.layout.images.schoolLogo.enabled = false;
    cases.push(portrait);
    const logo = make('logo-only');
    logo.layout.images.portrait.enabled = false;
    cases.push(logo);
    const neither = make('neither-image');
    neither.layout.images.schoolLogo.enabled = false;
    neither.layout.images.portrait.enabled = false;
    cases.push(neither);

    const header = make('long-header-contact');
    header.document.person.name = '欧阳司马诸葛合成边界测试者';
    header.document.person.target = 'Java 后端开发与分布式任务恢复、消息可靠性和跨系统服务协作方向的实习申请';
    const contactUrl = 'https://example.com/fictional-applicant/' + 'LongContactPortfolioReference'.repeat(7) + '?scenario=header-wrapping';
    header.document.person.contacts = [
      { text: 'boundary-fixture@example.com', href: 'mailto:boundary-fixture@example.com' },
      { text: contactUrl, href: contactUrl },
    ];
    cases.push(header);

    const project = make('long-project-chapter');
    const projects = project.document.sections.find(section => section.id === 'projects');
    projects.title = '项目实践与服务可靠性验证';
    projects.entries[0].title = 'CampusHub 校园预约与 Java 混合服务协作平台的跨系统消息补偿、配额控制和可追踪任务恢复模块';
    const projectUrl = 'https://example.com/fictional-project/campushub/' + 'JavaSpringBootTaskRecovery'.repeat(7) + '/evaluation?scenario=200concurrent&fixture=theme-boundary';
    projects.entries[0].blocks.push({ type: 'paragraph', text: `完整评测链接：[${projectUrl}](${projectUrl})。所有文字、路径和参数必须完整保留。` });
    cases.push(project);

    const selected = make('body-eleven-margin-seventeen');
    selected.layout.bodyPt = 11;
    selected.layout.page.marginMm = 17;
    cases.push(selected);

    const overflow = make('over-two-pages');
    overflow.document.sections.find(section => section.id === 'additional').blocks.push(
      ...Array.from({ length: 120 }, (_, i) => ({ type: 'paragraph', text: `合成验证 ${String(i + 1).padStart(3, '0')}：必须完整保留每段文字、测试条件与恢复记录，超过两页时明确拒绝，不能裁切内容或自动缩小用户选定的字号。` })),
    );
    overflow.errorCode = 'OVERFLOW';
    overflow.errorMessage = /超出2 页上限/;
    rejections.push(overflow);
    const oversizedHeader = make('oversized-header');
    oversizedHeader.layout.images.schoolLogo.enabled = false;
    oversizedHeader.layout.images.portrait.enabled = false;
    oversizedHeader.document.person.name = '合成超长姓名'.repeat(300);
    oversizedHeader.errorCode = 'LAYOUT';
    oversizedHeader.errorMessage = /页眉或标题过长/;
    rejections.push(oversizedHeader);
  }
  return { cases, rejections };
}
