# 安装包签名与公证

公开 v0.8.0 的 Windows EXE 未签名，macOS 包未签名、公证。main 开发版提供签名构建入口和 macOS 原生 `.app`，尚未产出正式证书签名包。

## macOS 应用包

在 macOS Intel 或 Apple Silicon 上运行：

```sh
npm ci
npx playwright install chromium --only-shell
npm run package:release
npm run package:posix
npm run package:macos-app
npm run test:macos-app
```

输出 `tech-resume-macos-app-芯片-版本-adhoc.zip`。解压后为 `TechResumeKit.app`，双击在浏览器打开简历；可移入 Applications。Node、Chromium、代码和字体位于应用内部，资料沿用 `~/Library/Application Support/TechResumeKit/data` 与同目录的设置文件，不写入应用包。

此开发包使用临时签名检查完整性，文件名保留 `adhoc`，验证报告中的 `developerId / notarized / gatekeeperAccepted` 均为 false。它不是 Developer ID 签名包。CI 在两个架构上检查包内运行组件、中文及空格路径、离线 PDF、重启保留、编辑后的资源完整性和篡改拒绝。

## Windows 本地签名

需要 Windows SDK SignTool 和可使用私钥的代码签名证书。先设置环境变量：

| 变量 | 用途 |
| --- | --- |
| `TECH_RESUME_WINDOWS_SIGNING=required` | 必须签名并验证后才生成 ZIP |
| `TECH_RESUME_WIN_CERT_THUMBPRINT` | 预期证书的 40 位 SHA-1 指纹，用于选择身份；文件与时间戳摘要仍使用 SHA-256 |
| `TECH_RESUME_WIN_CERT_PATH` | 可选 PFX 路径；省略时使用 CurrentUser/My 中的指定证书 |
| `TECH_RESUME_WIN_CERT_PASSWORD` | 导入 PFX 的密码，通过环境提供 |
| `TECH_RESUME_SIGNTOOL` | 可选 SignTool 路径；省略时从 PATH 或 Windows SDK 定位 |
| `TECH_RESUME_WIN_TIMESTAMP` | 可选 HTTPS RFC 3161 服务，默认为 DigiCert 时间戳服务 |

运行 `npm run package:release` 和 `npm run package:windows`。构建核对证书用途、有效期与私钥，签后检查受信身份、时间戳和实际 EXE 摘要。新导入的证书在结束时移除；已有证书不导入、不删除。`required` 失败时不退回未签名 ZIP，原输出保留。默认模式仍为 `unsigned`。

## Developer ID 与公证

正式模式仅接受稳定版本，需 Developer ID Application 证书及 App Store Connect API 密钥：

| 变量 | 用途 |
| --- | --- |
| `TECH_RESUME_MAC_CERT_PATH / PASSWORD / SHA1` | P12 路径、密码与预期证书指纹 |
| `APPLE_TEAM_ID` | 证书对应的团队 ID |
| `APPLE_API_KEY_PATH / KEY_ID / ISSUER_ID` | P8 文件、密钥 ID 与签发者 ID |

运行 `npm run package:macos-app -- --mode notarized`。证书导入临时钥匙串；先签嵌套原生代码，再更新运行组件摘要，最后签完整应用。正式签名启用 Hardened Runtime 和安全时间戳，Node 与 Chromium 配置 JIT 权限。

只有 Apple 返回 `Accepted`、票据装订和校验成功，并通过 Gatekeeper 检查后，才输出不带 `adhoc` 的应用 ZIP。失败不会把开发包当作正式包。报告记录实际状态、请求 ID 与 SHA-256，不记录密码、密钥内容或证书文件。

## GitHub 构建入口

`Build signed packages for review` 只支持手动触发。输入准确的候选提交与 Verify run ID；候选须已合入 main、具有签名工具、版本稳定，并通过同一提交的六项 Verify 检查。签名作业使用 `release-signing` 环境，可在仓库设置中配置该环境的审批规则。

| 环境配置 | 名称 |
| --- | --- |
| Windows secrets | `WINDOWS_SIGN_CERT_BASE64`、`WINDOWS_SIGN_CERT_PASSWORD` |
| Windows variables | `WINDOWS_SIGN_CERT_THUMBPRINT` |
| macOS secrets | `MAC_SIGN_CERT_BASE64`、`MAC_SIGN_CERT_PASSWORD`、`APPLE_API_KEY_BASE64` |
| macOS variables | `MAC_SIGN_CERT_SHA1`、`APPLE_TEAM_ID`、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER_ID` |

证书和 P8 文件以 Base64 写入对应 secret，指纹和 ID 写入 variable。凭据缺失时在构建前失败；解码文件与临时钥匙串均有清理步骤。当前仓库未配置这些凭据，正式签名与公证尚未验证。

工作流仅上传供检查的签名文件与证据，保留 7 天，不创建或公开 Release。现有草稿组装流程继续处理未签名的便携包；正式签名产物需要按验证报告单独交付。发布主题、说明和实际测试数量由候选输入与 CI 结果确定，见[维护说明](maintaining.md)。

参考：[Microsoft SignTool](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool)、[Apple 公证要求](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)、[Apple 自定义公证流程](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)。
