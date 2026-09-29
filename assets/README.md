# 素材来源与许可

## 学校 Logo

`images/chengchuan-logo.png`：本项目自制虚构校徽，书本和水流线条组成几何标识，文字为“澄川理工大学”。不对应真实学校，不使用真实学校商标。透明 PNG，1000 × 730。生成源为 `scripts/make-sample-assets.py`，按项目 MIT 许可分发。

## 当前校招样张的奶龙头像

`images/nailong-avatar.jpg`：用户选择的“白底正面”奶龙角色头像，独立于右上角学校 Logo，按 23:31 比例裁成 690 × 930 JPEG，供简历左侧照片槽位使用。

- [图片所在的 B 站用户页](https://space.bilibili.com/3546596904012366)：账户名“奶龙吃鸡腿”；[所选原图](https://i2.hdslb.com/bfs/face/187e2071d9518932ff7bf4afc7562f9fb1804fcc.jpg)。账户头像不等于账户拥有角色或图片版权。
- 原图为 512 × 512 JPEG，SHA-256：`ED0456EC51BB30566F7ECB07BE690D8B6AA85719FABF0586FB7CB2E115F3833D`；裁好的成品 SHA-256：`BC8AB90AA8BB65BAC7023ACAA05D5C0868F84AE5A66760B9EF8B4063E96F293F`。
- 用 `scripts/prepare-nailong-avatar.py` 居中裁切、缩放，原图需先保存到被 Git 忽略的 `tmp/pdfs/nailong-selected-original.jpg`。成品中不嵌入从来源网站下载的元数据。
- B 站用户头像页面没有提供可确认的再分发许可；奶龙角色图和这张头像**不属于**本项目的 MIT 许可。公开样张按用户明确要求展示，后续采用该图进行再分发时需要自行确认权利。

## 保留的原合成人像素材

`images/synthetic-portrait.jpg`：从 Wikimedia Commons 的 AI 合成实验图中裁切出正面人像，使用独立 JPEG 文件展示证件照槽位；并非真实候选人或本次新生成的人像。

- [来源页](https://commons.wikimedia.org/w/index.php?curid=137957588)
- 来源标题：Realistic photographs of model wearing dress with bull's eye pattern, medium close up shot, inside studio, plain empty background
- 来源说明：Auto1111 / Stable Diffusion 生成的人像实验；署名元数据为 Auto1111- AI Art maker。
- 来源许可标记：Public domain / PD-algorithm，`AttributionRequired: false`；2026-09-27 读取。
- 原始图尺寸：4864 × 1166。取第三个正面人物，裁切矩形为 `(2820, 140, 3433, 1104)`，再按 23:31 比例裁切缩放至 690 × 930。
- 本项目没有使用真实人物照片，也没有将来源图声明为原创。
- 来源元数据快照：`images/portrait-source.json`。该素材目前保留用于照片方向和边界验证；当前校招 PDF 使用上面的奶龙头像。

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

字体文件始终按 OFL 分发；代码的 MIT 许可不会替换或扩张字体、人像及奶龙头像的许可范围。

离线 PDF 预览使用 PDF.js `6.3.289`，按 Apache-2.0 分发；上游文件及 `LICENSE` 随 npm 依赖保留。预览在本机读取 PDF，字体、CMap 和解码资源不依赖在线服务。
