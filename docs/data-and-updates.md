# 数据位置与更新

“数据与更新”显示正在使用的数据目录。Windows 默认路径为 `%LOCALAPPDATA%\TechResumeKit\data`，位置设置在同级的 `settings.json`，所有程序版本共用这份设置。用 `--dir` 启动时直接使用指定位置。

数据目录包含 `library.json`、第一份简历的 `resume.md` / `layout.yaml`、`assets/`、`resumes/` 和 `history/`。旧版 `backups/` 和原图片也保留。复制整个数据文件夹可迁移整库；“备份与恢复”导出的 ZIP 仍对应当前一份简历。

“迁移当前全部简历”需要一个空目标文件夹。“打开已有简历库”直接使用所选资料。“迁入旧版 my-resume”将另一处旧资料复制到空目标，随后切换过去；当前库和旧资料都保留。首次启动也会识别程序旁及同级旧版下载目录里的 `my-resume`，只有一个候选且默认目录尚不存在时自动迁入。

迁移副本保存在 `%LOCALAPPDATA%\TechResumeKit\migrations\<ID>\data`，旁边的 `manifest.json` 记录原位置、文件大小和 SHA-256。复制前后逐文件核对，拒绝覆盖非空目录、相互嵌套的路径、目录链接和数据目录以外的图片引用。迁移中断或核对失败时，原文件保持可用，已创建的副本和暂存目录保留。

Windows 的更新入口只读取正式 Release；开发版不会因较旧正式版而降级。安装包与 `SHA256SUMS.txt` 来自项目正式仓库，有 GitHub 文件摘要时一并核对。包下载到设置文件夹中的 `updates/`，检查路径、大小、版本和 Node 校验值后准备到新目录。

“保存并打开新版”先保存当前库和整库副本，再关闭旧进程并打开新版。新程序读取同一份数据位置。启动失败时启动器尝试打开旧程序；新版中的“打开上一版本”也保留现有资料。`update-state.json` 记录两个程序位置及切换前副本。若后续版本升级了数据格式，应通过“打开已有简历库”选择副本中的 `data` 恢复。程序与副本均不自动删除。

维护者验证命令为 `npm test`、`npm run package:release`、`npm run test:package`、`npm run package:windows` 和 `npm run test:windows`。测试隔离设置目录，覆盖旧库迁移、跨程序目录启动、资料持久化、真实安装包解压及启动失败回退。SHA-256 用于下载完整性核验；Windows 代码签名仍待完成。
