# 跨平台启动包

正式下载目前为 Windows v0.7.0。macOS / Linux 开发包在通过 CI 后，可从对应 Actions 运行的 Artifacts 下载。解压 Artifact 的 ZIP，再解压其中的 `.tar.gz`；包内包含 Node、Chromium、字体和依赖，不需要安装 Node 或 npm。

| 平台 | 包名中的标记 | 启动入口 | CI 验证环境 |
| --- | --- | --- | --- |
| macOS Apple Silicon | `macos-arm64` | `启动简历.command` | macOS 15 ARM64 |
| macOS Intel | `macos-x64` | `启动简历.command` | macOS 15 Intel |
| Linux x64 | `linux-x64` | `./启动简历.sh` | Ubuntu 24.04 x64 |
| Linux ARM64 | `linux-arm64` | `./启动简历.sh` | Ubuntu 24.04 ARM64 |

macOS 要求 14 或更新版本，签名与公证尚未完成，首次打开按系统提示确认来源。Linux 需要常见的 Chromium 系统库；Ubuntu 的安装命令在包内 `使用说明.md`。环境准备好后，编辑和 PDF 导出可断网使用。

“检查环境”脚本核验组件并尝试启动 Chromium，不创建简历资料。资料继续使用平台默认位置，或 `--settings` / `--dir` 指定的位置。换程序目录时，使用同一份数据位置设置即可；回收站、图片、历史和当前选择都会保留。

构建与验证命令为 `npm run package:release`、`npm run package:posix`、`npm run test:posix`，在对应系统和芯片的机器上运行。CI 使用真实脚本启动，验证中文与空格路径、忽略全局 Node/npm 和浏览器缓存、离线 PDF、旧库迁入、整库恢复与重启。开发包附 SHA-256 和验证 JSON，CI Artifact 保留 7 天。

Windows 的正式升级验收使用已发布且核验 SHA-256 的 v0.7.0 包：生成多份简历与历史，打开新版后核对所有原文件，再验证旧程序重新打开与新版回收站保留。命令为 `npm run test:upgrade`。
