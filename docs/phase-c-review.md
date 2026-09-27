# 阶段 C：分页与边界内容核验

日期：2026-09-27。基于阶段 B 的 Markdown/YAML 输入、单一 HTML/CSS 主风格和本地 Chromium 导出，增加一页或两页的实际 PDF 分页。机器可读的检查结果见 [阶段 C 证据](phase-c-evidence.json)。

## 分页行为

- `page.maxPages` 为 1 或 2，默认 1；旧输入维持一页限制。工作经验示例明确设置 2，内容不足两页时不会强行加页。
- `check`、`preview` 和 `build` 都先让 Chromium 生成 PDF，再读取 **实际 PDF 页数** 执行上限检查，不用连续 HTML 高度猜测页数。需要第 3 页时明确报错，`--force` 也不会覆盖原文件。
- PDF 页边距中显示 `1 / 2`、`2 / 2` 和续页标识；页眉中的 Logo、照片只出现在首页。预览内嵌的就是同一 PDF，可翻页和缩放，输入出错后不继续提供旧 PDF。
- 章节标题及项目标题尽量跟随首条内容；长项目和长段落可以自然续页。正文沿用 10.5-11 pt 范围，不因内容增多而自动缩小。
- 对仅略超出一页的两页输出，提示末页可能偏空。该判断以内容高度估计，最终取舍以实际 PDF 为准。

## 真实样张

| 样张 | 页数 | 正文 | 图片 | 文本字段 | 标题跟随 | 链接 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 中文校招 `campus-ink-blue` | 1 | 10.5 pt | Logo + 独立照片 | 49 | 9 | 3 |
| AI 实习 `ai-intern-ink-blue` | 1 | 11 pt | 关闭两图 | 46 | 9 | 3 |
| 工作经验 `experienced-ink-blue` | 2 | 10.5 pt | 关闭两图 | 71 | 12 | 3 |

经验版的 TradeFlow 项目从第一页尾自然续到第二页。第一页保留项目标题、角色、技术栈和首条项目内容；第二页继续同一项目，之后进入另外两个项目、教育和其他信息，没有将整项工作挪到下一页留下大块空白。三份样张均为匿名合成资料，性能和评测指标不是实际业务数据。

## 边界矩阵

9 份边界 PDF 共 13 页，全部由同一渲染器生成，用 Poppler 渲染后逐页目视检查：

| 用例 | 页数 | 目的与结果 |
| --- | ---: | --- |
| `logo-only` | 1 | 只有右侧透明 Logo，姓名区自动收回照片空间 |
| `photo-only` | 1 | 证件照移到右侧，无 Logo 占位洞 |
| `no-images` | 1 | 两张图全关，页眉不留空洞 |
| `short-content` | 1 | 起步文件少量内容，维持字号与层级，无额外空白页 |
| `oriented-photo` | 1 | JPEG 的 EXIF Orientation=6，照片显示正向，Logo 保持透明背景 |
| `long-title-link` | 2 | Java/C++/Spring Boot 混排、长项目标题与约 200 字符 URL 正常换行，链接目标完整 |
| `oversized-entry` | 2 | 同一项目的 36 个有序列表项连续续页，序号 1-36 完整，无截断、编号回绕或挤出左边界 |
| `oversized-paragraph` | 2 | 单一长段落跨页，所有文字和先后顺序保留 |
| `heading-boundary` | 2 | 前序内容接近页尾时，后续章节标题、项目标题和首段一起进入第二页 |

另有两种明确拒绝：内容超过两页；页眉长到无法在一页中容纳并跟随正文。原有测试还验证在这些失败条件下，已有 PDF 不被 `--force` 覆盖。

PDF 核验使用 pypdf 检查逐页文字、链接、页码和阅读顺序，使用 pdfplumber 检查文字及图片的物理边界，要求三个中文字体字重嵌入并具备 ToUnicode。三份正式样张与九份边界 PDF 合计 **17 页、550 个文本字段、87 处标题跟随检查**。样张 PDF 均为可选择文字，未将整页栅格化。

第一次边界渲染发现：两位数的有序列表标号超出左侧页边距，部分数字在视觉上被裁切。已根据标号位数调整列表缩进，重新生成并检查两页 PDF；36 个编号均完整显示。长项目标题、链接、第二页续接位置与证件照方向已分别目视核对。实际浏览器截图还确认本地预览展示了 PDF 的两页缩略图和翻页控件。

## 复现

```sh
npm ci
npx playwright install chromium
npm test
npm run sample
python -m pip install pypdf pdfplumber
python -X utf8 scripts/verify-pdf.py
python scripts/render-pdfs.py
npm run qa:boundaries
python -X utf8 scripts/verify-pdf.py --directory tmp/pdfs/boundary
python scripts/render-pdfs.py --directory tmp/pdfs/boundary --dpi 110
python scripts/collect-qa-report.py
```

最后一条命令默认将 `visualReviewConfirmed` 写为 `false`；只有逐页看过输出后才加 `--reviewed`。边界 PDF 和临时截图放在被 Git 忽略的 `tmp/pdfs/boundary`，可按上面命令重建。公开仓库只保存三份匿名样张与汇总证据，不保存个人填写目录。

当前只验收 A4 的一页和两页排版。日历语义、全部 Unicode 字符和所有 PDF 阅读器/ATS 不是本轮保证范围；复杂表格、嵌套列表和 Markdown 内嵌图片仍不属于已定义的输入子集。匿名 CI 位于 `.github/workflows/verify.yml`，工作台可用接口见 `docs/workbench-handoff.md`。
