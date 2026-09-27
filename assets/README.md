# 素材来源与许可

## 学校 Logo

`images/chengchuan-logo.png`：本项目自制虚构校徽，书本和水流线条组成几何标识，文字为“澄川理工大学”。不对应真实学校，不使用真实学校商标。透明 PNG，1000 × 730。生成源为 `scripts/make-sample-assets.py`，按项目 MIT 许可分发。

## 独立证件照示例

`images/synthetic-portrait.jpg`：从 Wikimedia Commons 的 AI 合成实验图中裁切出正面人像，使用独立 JPEG 文件展示证件照槽位；并非真实候选人或本次新生成的人像。

- [来源页](https://commons.wikimedia.org/w/index.php?curid=137957588)
- 来源标题：Realistic photographs of model wearing dress with bull's eye pattern, medium close up shot, inside studio, plain empty background
- 来源说明：Auto1111 / Stable Diffusion 生成的人像实验；署名元数据为 Auto1111- AI Art maker。
- 来源许可标记：Public domain / PD-algorithm，`AttributionRequired: false`；2026-09-27 读取。
- 原始图尺寸：4864 × 1166。取第三个正面人物，裁切矩形为 `(2820, 140, 3433, 1104)`，再按 23:31 比例裁切缩放至 690 × 930。
- 本项目没有使用真实人物照片，也没有将来源图声明为原创。
- 来源元数据快照：`images/portrait-source.json`。最终 PDF 内注明 AI 合成人像。

正常构建直接使用本地成品，不需要访问来源网站。重新制作图片时，按元数据中的 `url` 下载原始 PNG 到 `tmp/pdfs/portrait-source.png`，安装 Pillow 后运行 `python scripts/make-sample-assets.py`。该脚本只进行几何绘制及常规裁切缩放，不调用图像生成 API。

## 中文字体

上游：Noto Sans SC；版本 `2.04;241114210130;non-release`。原始文件取自本机已安装的 `NotoSansSC-VF.ttf`，其内嵌许可声明为 SIL Open Font License 1.1。许可全文从 [Google Fonts 的 Noto Sans SC 目录](https://github.com/google/fonts/tree/main/ofl/notosanssc) 保存至 `fonts/OFL.txt`。

可重建的处理记录见 `fonts/provenance.json`，包括输入及输出 SHA-256：

1. 通过 fontTools 4.61.1 将原可变字体实例化为 400、600、700 三个固定字重。
2. 仅删除与常用汉字共用同一字形的兼容部首 cmap 别名，含可通过 NFKC 对应的部首，以及没有 NFKC 分解但共用字形的补充部首。保留汉字和字形设计，避免 Chromium 选取错误的 ToUnicode 映射。
3. 将衍生字体重命名为 **Resume Sans SC**；保留上游版权和 OFL 许可。

字形未按样张字符裁成小子集，保留完整原始字形集；上述重复部首别名除外。PDF 导出时由 Chromium 嵌入实际使用的字形。此处不宣称覆盖全部 Unicode 字符。

正常构建仅需三个成品字体，不需要 fontTools。重新处理上游字体：

```sh
python -m pip install fonttools==4.61.1
python scripts/prepare-fonts.py path/to/NotoSansSC-VF.ttf
```

字体文件始终按 OFL 分发；代码的 MIT 许可不会替换或扩张字体、人像的许可范围。
