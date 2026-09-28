# 使用入口的参考与封装

2026-09-28 根据以下 GitHub 项目的 README 比较使用流程：

| 项目 | 使用方式 | 对本项目的启发 |
| --- | --- | --- |
| [Oh My CV](https://github.com/Renovamen/oh-my-cv) | 浏览器 Markdown 编辑、实时预览、PDF 导出、本地保存 | 将编辑、预览与下载放在同一个页面 |
| [mdnice/markdown-resume](https://github.com/mdnice/markdown-resume) | 在线 Markdown 排版与 PDF 导出 | 把日常版式调整变成界面操作 |
| [junian/markdown-resume](https://github.com/junian/markdown-resume) | 本地优先编辑、图片管理、导入导出 | 保留本地资料与源 Markdown |
| [CyC2018/Markdown-Resume](https://github.com/CyC2018/Markdown-Resume) | 修改 Markdown、配置 Typora 主题、导出 HTML 后打印 | 编辑器与导出工具的安装步骤仍有门槛 |
| [markdown-resume-js](https://github.com/c0bra/markdown-resume-js) | npm 命令、wkhtmltopdf、另设自动刷新 | 保留 CLI 给开发者，普通用户用封装入口 |

v0.5.0 提供 Windows 10 / 11 x64 免安装 ZIP，包含启动程序、Node.js、锁定的 Chromium、依赖和字体。用户完整解压后双击启动，在本地页面填写基本信息、编辑 Markdown、设置图片和下载实际 PDF。

页面与启动程序为本项目实现；参考使用流程，未复制其他项目的代码或 CSS。导出继续使用既有 HTML/CSS 与 Chromium 路径，Markdown、模型和 API 保持兼容。Windows 包的构建和独立启动验证见 `npm run package:windows` 与 `npm run test:windows`。
