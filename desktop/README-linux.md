# Markdown 简历 · Linux 启动包

1. 选择 x64 或 ARM64 包，完整解压。
2. 在解压目录运行 `./启动简历.sh`，浏览器中填写简历。
3. 点击 **下载 PDF**；页面中的“退出”会保存并关闭应用。

包内提供 Node、Chromium、中文字体和依赖，不需要安装 Node 或 npm。当前验证系统为 Ubuntu 24.04。运行 `./检查环境.sh` 可核验运行组件和系统库，该检查不会创建简历库。

Ubuntu 缺少 Chromium 系统库时，可运行：

```sh
sudo apt-get install libnss3 libnspr4 libdbus-1-3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2t64 libpango-1.0-0 libcairo2
```

资料默认保存在 `~/.local/share/TechResumeKit/data`（支持 `XDG_DATA_HOME`），更新时使用同一位置。“简历库管理”提供回收站和整库 ZIP，“数据与更新”可以更换数据位置。下载新版后在新目录运行启动脚本，原程序和资料可保留。系统组件准备好后，编辑与 PDF 导出可断网使用。
