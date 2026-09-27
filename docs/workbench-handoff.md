# 本地简历工作台接入说明

模板套件版本：`0.3.0`；内容和版式模型的 `schemaVersion`：`0.2.0`。当前交接范围是可用接口与匿名样例，不提前合并工作台和模板仓库，也不修改工作台的代码或依赖。

工作台可以生成 `ResumeDocument` 和 `LayoutConfig`，直接调用 `src/render.mjs` 的 `renderResume(document, layout, { assetBase })`，无需先拼 Markdown。结构、默认值和取值范围见 [内容模型](content-model.md)，运行时定义位于 `src/schema.mjs`。`assetBase` 为本地图片目录；`assets.schoolLogo.src` 与 `assets.portrait.src` 是相对路径，二者独立开关。正文段落和列表按 `blocks` 顺序传入。

渲染结果交给 `src/export.mjs` 的 `inspectAndExport(rendered, { pdf: true })`，取得 PDF Buffer、页数、布局检查结果和提示。当前限制为 A4、一页或两页；超过 `page.maxPages` 时抛出 `ResumeError`。工作台可以接管输入表单、文件选择和输出保存；应复用套件的 CSS 与 PDF 导出路径，避免维护第二套近似排版。

接入前建议在独立分支验证：校招双图、无图 AI 样例、两页经验样例和已有个人数据的本地导出。个人资料留在工作台本地忽略目录，不进入模板套件的 CI、公开 PDF 或 GitHub 仓库。

本仓库保留 `npm run sample`、`npm test` 和 PDF 核验命令供工作台对照。正式跨仓库依赖方式和稳定版本策略需要两个项目协同决定；这个文档只说明当前可运行接口。
