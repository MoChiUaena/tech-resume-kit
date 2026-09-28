# 添加照片与学校 Logo

把本地 PNG/JPEG 放在本目录，在 `resume.md` 顶部将 `assets: {}` 替换为：

```yaml
assets:
  portrait:
    src: assets/portrait.jpg
    alt: 证件照
  schoolLogo:
    src: assets/school-logo.png
    alt: 学校 Logo
```

然后在 `layout.yaml` 中把对应的 `enabled: false` 改为 `true`。两张图可以独立开启。照片槽位默认 23 × 31 mm，建议使用相同比例的竖版图片；学校 Logo 在右上角，保持原图比例。仅使用一张图时，省略另一份图片配置即可。
