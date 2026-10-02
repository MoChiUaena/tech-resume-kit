# macOS 原生应用包

v0.11.0 提供 Intel 和 Apple Silicon 的 `TechResumeKit.app`。运行所需的 Node、Chromium、字体和模板随包提供，用户无需安装 Node 或 npm，也无需开发者账号。

解压对应芯片的 `tech-resume-macos-app-芯片-版本.zip`，双击 `TechResumeKit.app`，在打开的本地页面填写资料并下载 PDF。应用可以放入 Applications；首次打开按 macOS 的来源确认提示操作。

资料继续保存在 `~/Library/Application Support/TechResumeKit/data`，设置位于同目录的 `settings.json`；更新程序时保留这份数据位置。正文、图片、回收站和历史均在数据目录，应用包只存运行资源。页面的“退出”会保存并关闭服务。

[v0.11.0 正式发布页](https://github.com/MoChiUaena/tech-resume-kit/releases/tag/v0.11.0)提供两个芯片的应用 ZIP，也保留 `.command` 启动包。

## 从源码构建

在对应芯片的 macOS 14+ 环境运行，需要 Xcode 命令行工具：

```sh
npm ci
npx playwright install chromium --only-shell
npm run package:release
npm run package:posix
npm run package:macos-app
npm run test:macos-app
```

输出 ZIP、SHA-256 和验证报告位于 `tmp/packages/`。构建使用系统自带工具封装和校验本地资源，不需要证书或账号配置。CI 检查中文与空格路径、包内运行组件、重复打开、离线 PDF、保存后的资源完整性、重启保留与篡改拒绝。
