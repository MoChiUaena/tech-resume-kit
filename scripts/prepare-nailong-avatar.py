"""Crop the user-selected local source image to the resume's 23:31 photo slot.

Source URL and rights information are recorded in assets/README.md. Download
the source to tmp/pdfs/nailong-selected-original.jpg before running this script.
Normal offline builds use the checked-in cropped image and do not run this.
"""
from pathlib import Path
from PIL import Image, ImageOps

root = Path(__file__).resolve().parents[1]
source = root / 'tmp/pdfs/nailong-selected-original.jpg'
destination = root / 'assets/images/nailong-avatar.jpg'
if not source.exists():
    raise SystemExit('缺少原图：tmp/pdfs/nailong-selected-original.jpg；来源见 assets/README.md')
with Image.open(source) as original:
    if original.format != 'JPEG':
        raise SystemExit('原图不是 JPEG')
    portrait = ImageOps.fit(original.convert('RGB'), (690, 930), method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))
    portrait.save(destination, format='JPEG', quality=94, subsampling=0)
print(f'已生成竖版头像：{destination}（690 × 930，比例 23:31）')
