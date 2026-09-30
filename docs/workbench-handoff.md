# 本地简历工作台接入

自 v0.9.0 起的正式 TGZ 提供以下转换接口，可从下载包或源码调用；`npm run package:release` 也可生成本地 TGZ。套件内容与版式模型仍为 `schemaVersion: "0.2.0"`。

工作台使用数值版本 2、3、4；版本 4 新增 `card/rail` 模板。转换器按 `local-resume` 提交 `ff19758` 的 `ResumeDocument`、`ResumeDraft.ImageSlot` 和 `RichText` 规则实现。只读取单份 `document`，不接收外层简历记录、整库备份或预览 HTML。

## Node.js 调用

```js
import { convertWorkbenchResume, renderResume, inspectAndExport } from 'tech-resume-kit';

const converted = convertWorkbenchResume(workbenchDocument, {
  layout: { schemaVersion: '0.2.0', preset: 'campus', page: { maxPages: 2 } },
  assets: {
    portrait: { id: workbenchDocument.layout.photo.id, src: 'photo.jpg', prepared: true },
    schoolLogo: { id: workbenchDocument.layout.logo.id, src: 'logo.png', prepared: true },
  },
});
const rendered = await renderResume(converted.document, converted.layout, { assetBase: '/local/assets' });
const result = await inspectAndExport(rendered, { pdf: true });
// result.buffer：PDF 字节；result.metrics.pageCount：实际页数。
// converted.report / converted.warnings：转换结果与差异，交给界面展示。
```

`layout` 必须明确提供，表示选择套件的墨蓝版式。不会把工作台的字号、字体、模板和页边距悄悄裁到套件范围。可调范围见[内容模型](content-model.md)。图片开关沿用源可见状态；尺寸和左右槽位默认沿用源设置，也可在目标 `layout.images` 中明确填写。未知字段和不支持的版本会被拒绝。

## 内容与图片规则

| 工作台输入 | 转换结果 |
| --- | --- |
| `name / headline` | `person.name / target` |
| `location` | 姓名旁的 `person.label` |
| `phone / email` | 原显示文字与电话、邮箱链接；至少需要一项 |
| 章节和条目顺序 | 原顺序；套件 ID 为 `workbench-1` 等，报告保留原 ID 与条目 ID |
| 标题与完整 `meta` | 标题和 `subtitle`；不猜测或拆分日期、学历、技术栈 |
| `bulleted: true / false` | 单层列表 / 顺序段落 |
| `**加粗**` | 保留加粗；HTML、网址、其他标记保留为普通文字 |
| 空标题或只有标题的条目 | 转为普通章节块，保留其余文字 |
| 隐藏章节、完全空条目 | 不进入 PDF，在 `report.omitted` 中列出；输入文件不修改 |
| 可见但完全空的章节 | 报错，请填写内容或隐藏章节 |
| `pageBreakBefore: true` | 默认报错；选择 `pageBreaks: "natural"` 才改为自然分页，并给出提示 |

素材 ID 不能当作磁盘路径。调用方先将匹配 ID 的图片准备到本地，再用 `assets.portrait / schoolLogo` 映射，`src` 仅接受相对 PNG/JPEG 路径，不访问工作台数据库或下载图片。

原图直接映射时必须与套件的适配方式和位置一致：照片为 `cover`、`positionX: 50 / positionY: 42`；Logo 为 `contain`、`100 / 0`，均无旋转和缩放。其他适配、位置、旋转、缩放需先合成为完整图片帧，再设置 `prepared: true`。这表示调用方已经处理效果，不是让转换器丢弃裁剪参数。照片建议合成为 23:31，Logo 完整帧可保留透明背景。

`report` 包含源/目标模型版本、章节与条目 ID 映射、未进入输出的项目，以及模板、字体、字号、间距、页边距等版式差异。此接口用于套件 PDF 导出，尚不提供写回工作台的逆向转换。原工作台数据应继续由工作台保存。

## JSON 命令

完整匿名输入和转换选项位于 `examples/workbench/`。图片路径默认相对转换选项文件；可用 `--assets` 指定其他本地目录。输出会重新计算相对图片路径，且不会覆盖输入或选项文件。

```sh
node src/cli.mjs convert-workbench examples/workbench/resume.json --options examples/workbench/conversion.json --out personal/converted/resume.json --json
node src/cli.mjs build-json personal/converted/resume.json --out personal/converted/resume.pdf --json
```

转换只检查模型和映射规则；`build-json` 继续检查本地图片、实际 PDF 页数与排版。`--json` 输出单个对象，包含 `ok`、`warnings` 和 `conversion` 报告；失败退出码为 1，保留已有输出。源和选项的 JSON 错误提供文件、行号与字段。

Java 可用 `ProcessBuilder` 将命令与参数分别放入数组，再执行 `build-json`。套件侧已验证双图校招、无图和两页转换样张；工作台的调用按钮、图片合成和服务连接仍由工作台项目接入，本仓库不改其代码、依赖或分支。
