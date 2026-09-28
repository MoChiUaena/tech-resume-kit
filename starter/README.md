# 开始填写简历

先解压整个 ZIP，安装 Node.js 22 或更高版本。首次安装需要联网下载依赖和 Chromium；之后预览和导出在本地运行。

Windows：

1. 双击 `01-install.cmd`，等安装完成。
2. 用文本编辑器修改根目录 `resume.md`，版式参数在 `layout.yaml`。
3. 双击 `02-preview.cmd`，浏览器显示实际 PDF；保存文件后自动更新。
4. 双击 `03-export-pdf.cmd`，PDF 存入 `output/`，每次生成新文件。

macOS / Linux：

```sh
sh install.sh
# Linux 缺少浏览器系统依赖时使用：sh install.sh --with-deps
sh preview.sh
sh export-pdf.sh
```

照片和校徽的填写方式见 `assets/README.md`。预览端口被占用时，运行 `02-preview.cmd --port 4174` 或 `sh preview.sh --port 4174`。关闭预览终端或按 Ctrl+C 停止服务。

`resume.md` 中的提示可自行替换或删除。章节 ID 用于排序；保留标题末尾的 `{#education .entries}` 等标记。工具与字体资源在 `toolkit/`；日常填写只需修改根目录的两份文件和图片。
