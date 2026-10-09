# 贡献指南

欢迎报告问题、改进模板或修复功能。请让每个 PR 聚焦一个可验证的改动，并使用匿名样张。

## 报告问题

在 [Issues](https://github.com/MoChiUaena/tech-resume-kit/issues) 中说明系统与版本、复现步骤、预期结果和实际结果。若涉及排版，请附匿名 PDF 或截图，并说明所选外观、页数、字体和字号。提交日志前请检查并移除姓名、联系方式、照片及本地路径。

## 本地开发

需要 Node.js 22.13+。在仓库根目录运行：

```sh
npm ci
npx playwright install chromium
npm test
```

改动导出或分页时，再运行 `npm run qa:boundaries`，并按[维护说明](docs/maintaining.md)检查生成的 PDF。改动启动包或随包资源时，运行：

```sh
npm run package:release
npm run test:package
```

macOS、Linux 和 Windows 的实际启动检查由 CI 在对应平台运行。提交 PR 时说明修改后的行为、验证命令和仍需关注的边界情况。

## 资料保护

请只提交仓库内的匿名模板和测试数据。不要提交个人简历、证件照、电话、邮箱、私有 PDF 或数据目录；本地练习可放在已忽略的 `personal/`、`private/` 或 `my-resume/` 中。新增截图与演示素材也应使用匿名信息，并在需要时注明来源与许可。

代码遵循仓库的 [MIT 许可](LICENSE)；字体和图片的许可见[素材说明](assets/README.md)。