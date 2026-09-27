# v0.3.0 - 首个公开版本

面向中文 Java 后端和 AI / Agent 应用岗位的 Markdown 简历模板套件。填写 `resume.md`，在独立的 `layout.yaml` 中设置页边距、信息顺序和学校 Logo/证件照，通过本地 Chromium 预览并导出可选择文字的 PDF。

包含校招、AI 实习和两页工作经验三份完整的匿名 PDF 样张；共享一个单栏墨蓝主风格。长项目可自然续页，章节标题跟随首条内容。超过配置的一页或两页上限会报错，不自动缩小字体，也不覆盖已有 PDF。内置 `init`、`check`、`preview`、`build` 命令；预览显示实际生成的 PDF。

验证：14 项自动测试通过；三份公开样张和九组边界内容共 17 页，核对 550 个文本字段、87 处标题跟随位置以及字体嵌入、链接和图片。PDF 与页面截图都由仓库中的匿名合成资料生成，照片来源与许可见 `assets/README.md`。

使用要求：Node.js 22+。首次 `npm ci` 和 `npx playwright install chromium` 需要联网；准备好后可在本地断网生成。当前接受 A4 一页或两页，内容模型仍是接口草案 `0.2.0`；不承诺所有 ATS 或 PDF 阅读器的解析效果。

完整安装和命令示例见 README；与本地简历工作台的接口见 `docs/workbench-handoff.md`。
