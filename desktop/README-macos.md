# Markdown 简历 · macOS 启动包

1. 选择 Apple Silicon（arm64）或 Intel（x64）包，完整解压。
2. 打开 **启动简历.command**，在浏览器填写简历。
3. 点击 **下载 PDF**；页面中的“退出”会保存并关闭应用。

包内提供 Node、Chromium、中文字体和依赖，不需要 npm 安装。支持 macOS 14 或更新版本；签名与公证尚未完成，首次打开请按系统提示确认来源。

资料默认保存在 `~/Library/Application Support/TechResumeKit/data`，更新时使用同一位置。“简历库管理”提供回收站和整库 ZIP，“数据与更新”可以更换数据位置。下载新版后在新目录打开启动脚本，原程序和资料可保留。

“检查环境.command”核验运行组件并尝试启动 Chromium；该检查不会创建简历库。日常编辑与 PDF 导出可断网使用。
