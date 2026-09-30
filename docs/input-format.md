# 输入格式 0.2.0

日常编辑仅需 `resume.md` 与 `layout.yaml`。文件采用 UTF-8；Windows CRLF 和 UTF-8 BOM 均可读取。当前源码开发版的表单编辑会保留未改的正文、YAML 注释和原文件换行方式。

## 顶部元数据

```yaml
---
schemaVersion: 0.2.0
person:
  name: 你的姓名
  target: Java 后端开发实习生
  label: 2027 届本科
  availability: 杭州 / 上海 · 每周 5 天
  contacts:
    - text: your.name@example.com
      href: mailto:your.name@example.com
    - text: 项目主页
      href: https://example.com/project
assets:
  schoolLogo:
    src: assets/logo.png
    alt: 学校名称与标识
  portrait:
    src: assets/photo.jpg
    alt: 个人证件照
notice: 可选的页脚说明
---
```

必填字段为 `schemaVersion`、`person.name`、`person.target`、至少一个联系方式。`label`、`availability`、`notice` 和 `assets` 可省略。联系方式最多六项，`href` 允许 `http://`、`https://`、`mailto:`、`tel:`。未提供图片时应在版式配置中保持关闭。

日期、电话等值请用引号包围，保证是字符串。未知字段和重复 YAML 键会报错，避免拼写错误被静默忽略。不支持 YAML 锚点、别名或自定义标签。

## 章节

标题格式为 `## 中文标题 {#稳定id .类型}`。ID 以小写字母开头，后面只允许小写字母、数字、连字符，且不能重复。类型允许以下三种。

### entries：教育、实习、工作、项目

每项用 `### 条目标题` 开始，随后必须紧跟一个 `yaml` 或 `yml` 代码块。

````markdown
## 教育背景 {#education .entries}

### 我的学校

```yaml
date: "2023.09 - 2027.06（预计）"
subtitle: 计算机科学与技术 · 本科
```

主修课程：数据结构、操作系统、数据库系统。

- 可以用列表补充与岗位相关的信息。

列表之后也可以继续写普通段落，顺序会保留。
````

条目的 `date` 必填，`subtitle` 和 `stack` 可选。条目必须有至少一个非空段落或列表项。日期目前校验为非空字符串，允许“至今”“预计”等写法，不执行日历推断。

### skills：技能组

```markdown
## 专业技能 {#skills .skills}

- **Java 后端**：熟悉集合、线程池，使用 Spring Boot 开发接口。
- **工程实践**：使用 Git、Docker 和自动化测试。
```

每项必须以 `**技能名**：` 或 `**技能名**:` 开始；后面是非空说明。技能名称以纯文本表达，说明支持加粗与行内链接。

### lines：其他信息或普通内容

```markdown
## 荣誉与其他 {#additional .lines}

**英语**：能够阅读英文技术文档。

1. 支持单层有序列表。
2. 也支持普通无序列表与段落。
```

## 支持的正文语法

- 普通段落，段落间空一行；普通换行合并为自然流动的文本。
- 单层无序列表、有序列表；保留有序列表的起始编号。
- `**加粗**`、行内代码、`[显示文字](https://example.com)`。
- 链接目标允许 HTTP(S)、邮箱与电话协议；不会因为正文中存在链接就访问该网址。

不支持 HTML、Markdown 内嵌图片、引用式链接定义、嵌套列表、引用块、表格、分隔线和正文代码块。条目后的 YAML 是唯一允许的代码块。标题使用纯文本，不需要填写 H1，姓名由元数据渲染。

## 排序和图片

默认章节 ID 包括 `education`、`skills`、`internship`、`experience`、`projects`、`additional`。没有显式 `sectionOrder` 时，预设排序匹配这些 ID，其余 ID 按源文件顺序追加。显式排序必须完整列出全部 ID，不会因此删除章节。

图片路径相对 Markdown 所在目录；可通过 `../` 引用邻接目录中的本地资产，不支持网络 URL 或绝对路径。字体仍从套件的资源目录加载，因此把填写目录移到仓库之外也能工作。`init` 会将两张示例图片一同复制到填写目录；本地 JPEG/PNG 的扩展名、内容格式、尺寸和解码情况会检查。

配置的 `images.<名称>.enabled` 必须是布尔值。`slot` 为 `start` / `end`，`align` 为 `top` / `center` / `bottom`，图片宽高允许 10-40 mm，页眉间距允许 2-8 mm。关闭的图片不读取、不渲染，不留下占位；配置启用却缺少资产时会给出具体错误。

## 错误示例

```text
resume.md:62 [sections.2.entries.0.date]：需要非空文本（日期、电话请加引号），请检查字段是否填写及类型
layout.yaml:7 [bodyPt]：不能为空，或数值不得小于 10.5
resume.md:18 [assets.schoolLogo]：学校 Logo路径不存在或不可读：assets/logo.png
```

行号指向字段值或所在条目。`check` 还会在 Chromium 中测量实际布局并生成 PDF 计数，明确报告横向溢出或实际需要的页数。错误会返回非零退出码，不会悄悄缩小字号或覆盖旧 PDF。

## 一页与两页

`page.maxPages` 允许 1 或 2，默认 1。设置 2 仅允许自然分页，不会为短内容强行加一页。`preset` 控制信息顺序，`maxPages` 独立控制导出上限。

长项目和段落可跨页；标题尽量跟随首条内容。有序列表按实际序号位数预留缩进，长链接允许换行，原始链接目标保留。对于过长、无法在一页容纳并跟随正文的页眉或标题，导出会给出明确错误。图片仅出现在首页，续页保留简短标识和页码。

本地 preview 显示实际生成的 PDF；页数超过上限时显示错误并暂停提供旧 PDF。若仅略超出一页，会根据内容高度给出末页可能偏空的提示，最终以实际预览为准。
