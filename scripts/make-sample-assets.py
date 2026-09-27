"""Author the fictional school logo; crop a public-domain synthetic portrait.

One-time asset preparation, not part of the Node/PDF build dependency chain.
The original portrait and its provenance are described in assets/README.md.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
FONT = ROOT / 'assets/fonts/ResumeSansSC-SemiBold.ttf'
OUT = ROOT / 'assets/images'

# Original geometric emblem: open book + three flowing river strokes.
logo = Image.new('RGBA', (1000, 730), (255, 255, 255, 0))
draw = ImageDraw.Draw(logo)
ink = '#233e54'
draw.ellipse((322, 30, 678, 386), outline=ink, width=9)
draw.ellipse((340, 48, 660, 368), outline=ink, width=2)
draw.line([(399, 137), (455, 151), (500, 182), (545, 151), (601, 137)], fill=ink, width=9, joint='curve')
draw.line([(399, 137), (399, 261), (457, 274), (500, 299), (543, 274), (601, 261), (601, 137)], fill=ink, width=9, joint='curve')
draw.line([(500, 182), (500, 299)], fill=ink, width=7)
for dx in (0, 31, 62):
    draw.line([(431+dx, 190), (431+dx, 236), (448+dx, 251)], fill=ink, width=6, joint='curve')
font = ImageFont.truetype(str(FONT), 100)
draw.text((500, 440), '澄川理工大学', font=font, fill=ink, anchor='mt')
small = ImageFont.truetype(str(FONT), 32)
draw.text((500, 591), 'CHENGCHUAN INSTITUTE', font=small, fill=ink, anchor='mt')
logo.save(OUT / 'chengchuan-logo.png')

source = ROOT / 'tmp/pdfs/portrait-source.png'
if source.exists():
    # Third, front-facing generated model in the source contact sheet.
    portrait = Image.open(source).convert('RGB').crop((2820, 140, 3433, 1104))
    portrait = ImageOps.fit(portrait, (690, 930), Image.Resampling.LANCZOS, centering=(0.5, 0.35))
    portrait.save(OUT / 'synthetic-portrait.jpg', quality=95, subsampling=0)
print('Fictional logo and synthetic portrait prepared.')
