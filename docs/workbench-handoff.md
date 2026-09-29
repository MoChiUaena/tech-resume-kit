# 本地简历工作台接入说明

套件版本 `0.8.0`，内容与版式模型 `schemaVersion: "0.2.0"`。GitHub Release 提供可安装的 TGZ，公共 ESM 入口和 TypeScript 类型声明见[调用接口](api.md)。

Node.js 调用方可直接使用 `renderResume(document, layout, { assetBase })`，再调用 `inspectAndExport(rendered, { pdf: true })` 取得 PDF 字节、真实页数和排版检查结果。Java 等调用方可用 `ProcessBuilder` 执行：

```text
node /installed/tech-resume-kit/src/cli.mjs build-json /local/resume.json --assets /local/assets --out /local/resume.pdf --json
```

参数应作为独立数组元素传入。stdout 为单个 JSON 对象，失败退出码为 1；输出已存在时默认拒绝覆盖。JSON 外层为 `{ document, layout }`，字段规则见[内容模型](content-model.md)。

目前工作台使用数值 `schemaVersion: 2`，包含 `content`、UUID 章节、非结构化 `meta`、`classic/banner` 布局和裁切参数；它与套件模型不同，不能直接传入。接入需要明确转换章节、条目日期、素材路径与图片布局，并提示套件范围之外的字号、行距等参数。套件遇到该模型会给出 `MODEL` 错误，不自动丢字段或调整参数。

套件侧接口与下载包已经提供，实际工作台转换与接入仍需在工作台项目完成。建议先用校招双图、无图和两页经验三类内容验证转换后的 PDF。
