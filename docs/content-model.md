# 内容模型与接口

`ResumeDocument` 与 `LayoutConfig` 的 `schemaVersion` 均为 `0.2.0`。GitHub v0.8.0 提供可安装 TGZ、公共 ESM 入口和 TypeScript 类型声明，见[调用接口](api.md)。与阶段 A 的 `0.1.0` 相比，条目和普通章节改用 `blocks`，以保留“段落 → 列表 → 段落”的原始阅读顺序。0.1.0 JSON 仅作为回归基准，不能直接传入新版渲染器。

## ResumeDocument

```ts
type Block =
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; start?: number; items: string[] };

type Entry = {
  title: string;
  date?: string;
  subtitle?: string;
  stack?: string;
  blocks: Block[];
};

type Section =
  | { id: string; title: string; kind: 'entries'; entries: Entry[] }
  | { id: string; title: string; kind: 'skills'; items: { label: string; text: string }[] }
  | { id: string; title: string; kind: 'lines'; blocks: Block[] };

type ResumeDocument = {
  schemaVersion: '0.2.0';
  locale: 'zh-CN';
  person: {
    name: string; target: string; label?: string; availability?: string;
    contacts: { text: string; href: string }[];
  };
  assets: {
    schoolLogo?: { src: string; alt: string };
    portrait?: { src: string; alt: string };
  };
  sections: Section[];
  notice?: string;
};
```

标题、联系方式显示文本与元数据是纯文本；`Block.text`、`Block.items` 与技能说明使用受限 Markdown 行内语法，渲染时再次校验。数组保留内容顺序。日期不从标题或空格中猜测，图片不写开发者电脑的绝对路径。

main 的 `0.9.0-dev.1` 允许结构化 JSON 条目省略 `date`，适用于没有日期的技能组及工作台的完整元信息。Markdown 条目的日期规则保持不变，已发布 v0.8.0 的结构化条目仍需要 `date`。

## LayoutConfig

```ts
type ImageLayout = {
  enabled: boolean;
  widthMm: number; heightMm: number;
  slot: 'start' | 'end';
  align: 'top' | 'center' | 'bottom';
};

type LayoutConfig = {
  schemaVersion: '0.2.0';
  theme: 'ink-blue';
  preset: 'campus' | 'experience';
  page: { size: 'A4'; marginMm: number; maxPages: 1 | 2 };
  bodyPt: number; lineHeight: number; namePt: number; accent: string;
  sectionOrder?: string[];
  header: { gapMm: number };
  spacing: { sectionMm: number; entryMm: number };
  images: { schoolLogo: ImageLayout; portrait: ImageLayout };
};
```

上面展示归一化后的完整模型；YAML 中可省略有默认值的参数。阶段 C 新增可选 `page.maxPages`，省略时为 1；内容模型仍使用 0.2.0，既有输入不必修改。Zod 校验定义位于 `src/schema.mjs`，是字段和取值范围的实现来源。显式章节顺序优先于预设，且必须包含全部 ID。

## 本地调用

```js
import { loadResume, renderResume, inspectAndExport } from 'tech-resume-kit';

const input = await loadResume('personal/my-resume/resume.md');
const rendered = await renderResume(input.document, input.layout, input);
const { buffer, metrics } = await inspectAndExport(rendered, { pdf: true });
```

- `loadResume(inputPath, configPath?)` 读取 Markdown 与 YAML，返回模型、源位置、输入路径及 `assetBase`。
- `parseResume(source, filename?)` 不读磁盘，返回 `document` 与源位置 `locations`。
- `renderResume(document, layout, { assetBase, locations?, layoutLocations? })` 直接消费结构化数据，返回 `html`、归一化模型、图像信息和分辨率提示。工作台可以跳过 Markdown 解析，传入相同结构及本地资产目录。
- `inspectAndExport(rendered, { pdf: false })` 验证真实浏览器布局和实际 PDF 页数；内部仍生成 PDF 以准确计数，`pdf: true` 才向调用方返回 Buffer。同时返回 `warnings` 和含 `pageCount`、`maxPages`、纸张尺寸的 `metrics`。该函数不写最终输出文件，临时 HTML 在完成后清理。
- `ResumeError` 携带可选的 `file`、`line`、`field` 与 `code`。输入错误和布局错误返回中文说明。

字体和模板属于套件资源；`assetBase` 是调用上下文，不存入 ResumeDocument。输出覆盖、预览服务和 CLI 选项不混入渲染模型。当前支持一页或两页，超过配置上限会报错；浏览器自然分页，段落和长项目可续页。工作台接入方式见 [交接说明](workbench-handoff.md)，JSON 命令和包安装方式见[调用接口](api.md)。
