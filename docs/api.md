# 安装与调用 API

从 [GitHub Release](https://github.com/MoChiUaena/tech-resume-kit/releases/latest) 下载 `tech-resume-kit-0.11.1.tgz`，在自己的 Node.js 项目中安装：

```sh
npm install ./tech-resume-kit-0.11.1.tgz
npx playwright install chromium
npx tech-resume init --dir my-resume --template blank
```

需要 Node.js 22.13+，公共入口为 ESM，附带 TypeScript 类型声明。代码与字体随包提供，首次下载依赖和浏览器后可以离线导出。当前通过 GitHub 分发，没有发布到 npm 注册表。

源码版本的 `initializeProject(directory, template, { theme })` 支持十种起步内容，模板 ID 见 [README 模板目录](../README.md#示例与命令)。例如 `await initializeProject('./my-resume', 'frontend', { theme: 'minimal-mono' })`；TypeScript 可使用 `StarterTemplateId` 和 `ResumeThemeId` 类型。外观 ID 见 [README 外观目录](../README.md#外观模板)，省略主题时保留起步内容自身的配置。现有 v0.11.1 下载包支持 `blank`、`campus`、`experience`，新增岗位模板随后续版本分发。

## JavaScript / TypeScript

```js
import { writeFile } from 'node:fs/promises';
import { loadResume, renderResume, inspectAndExport } from 'tech-resume-kit';

const loaded = await loadResume('./my-resume/resume.md');
const rendered = await renderResume(loaded.document, loaded.layout, loaded);
const result = await inspectAndExport(rendered, { pdf: true });
await writeFile('./resume.pdf', result.buffer, { flag: 'wx' });
console.log(result.metrics.pageCount, result.warnings);
```

工作台等调用方也可直接传入套件模型 `renderResume(document, layout, { assetBase })`。`assetBase` 是运行时本地图片目录；模型里只保存相对图片路径。`renderResume` 校验结构和素材，`inspectAndExport` 检查真实 PDF 的页数、字体、离线资源和横向溢出。省略 `{ pdf: true }` 时仍检查实际分页，但不返回 PDF 字节。

入口还导出 `parseResume`、`parseResumeJson`、`loadResumeJson`、`initializeProject` 和 `ResumeError`。模型版本仍为 `0.2.0`，结构见[内容模型](content-model.md)。布局可省略可选参数，`schemaVersion` 必须填写。

自 v0.9.0 起提供 `convertWorkbenchResume` 与 `loadWorkbenchResume`，显式转换工作台版本 2、3、4，并返回章节映射和版式差异报告。接口随正式 TGZ 提供；使用方法见[工作台接入](workbench-handoff.md)。

## JSON 命令接口

JSON 文件采用标准 JSON，不含注释、重复字段或尾逗号：

```json
{
  "document": {
    "schemaVersion": "0.2.0",
    "person": { "name": "填写姓名", "target": "后端开发", "contacts": [{ "text": "name@example.com", "href": "mailto:name@example.com" }] },
    "sections": [{ "id": "skills", "title": "技能", "kind": "skills", "items": [{ "label": "Java", "text": "填写掌握的技能与使用场景。" }] }]
  },
  "layout": { "schemaVersion": "0.2.0" }
}
```

更完整的双图校招输入见 `examples/json/resume.json`。

```sh
npx tech-resume export-json my-resume/resume.md --out my-resume/resume.json
npx tech-resume check-json my-resume/resume.json --json
npx tech-resume build-json my-resume/resume.json --out resume.pdf --json
```

图片默认相对 JSON 文件；使用 `--assets /local/image-directory` 可显式指定素材基目录。`export-json` 自动调整相对图片路径，使输出 JSON 换到其他目录后仍指向原图。JSON 不自动复制图片，跨电脑共享时需要同时携带素材目录。API 的 `loadResumeJson(file, { assetBase })` 采用相同规则。

`--json` 将成功或失败作为 stdout 中的单个 JSON 对象输出，提示放入 `warnings`，失败退出码为 1。预览服务不支持此选项。调用方无需解析中文日志：

```json
{"ok":false,"command":"build-json","error":{"code":"EXISTS","message":"文件已存在；请换输出路径，或确认后使用 --force 覆盖","file":"/local/resume.pdf"}}
```

成功结果包含 `ok`、`command`、`input`、`output`（导出时）、`warnings`、`sections`、`bodyPt` 和 `metrics`；`metrics.pageCount` 为实际 PDF 页数。常见错误码：`INPUT` 字段校验、`JSON` 语法、`MODEL` 不兼容模型、`CONVERSION` 工作台转换需要补充映射或明确处理差异、`CLI` 命令参数、`EXISTS` 输出已存在、`BROWSER` 浏览器不可用、`LAYOUT` 排版问题、`OVERFLOW` 超过页数上限、`NETWORK` 外部资源请求。
