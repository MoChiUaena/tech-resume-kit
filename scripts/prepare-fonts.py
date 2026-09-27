"""One-time preparation of redistributable static fonts for Chromium PDF.

Usage: python scripts/prepare-fonts.py path/to/NotoSansSC-VF.ttf
Requires fonttools==4.61.1. Normal builds use the checked-in outputs.
"""
from pathlib import Path
import hashlib
import json
import sys
import unicodedata
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parents[1]
source = Path(sys.argv[1])
out = ROOT / 'assets/fonts'
font = TTFont(source)
cmap = font.getBestCmap()
aliases = {}
han_by_glyph = {}
for codepoint, glyph in cmap.items():
    if 0x4E00 <= codepoint <= 0x9FFF:
        han_by_glyph.setdefault(glyph, codepoint)
for codepoint, glyph in cmap.items():
    canonical = unicodedata.normalize('NFKC', chr(codepoint))
    if not 0x2E80 <= codepoint <= 0x2FFF:
        continue
    if len(canonical) == 1 and ord(canonical) != codepoint and cmap.get(ord(canonical)) == glyph:
        aliases[codepoint] = ord(canonical)
    elif glyph in han_by_glyph:
        # CJK Radicals Supplement contains aliases such as U+2EC5/U+2EEC
        # that have no NFKC decomposition but share a glyph with 见/齐.
        aliases[codepoint] = han_by_glyph[glyph]
# Remove redundant Kangxi radical aliases only; preserve actual Han characters.
# Skia otherwise chooses the radical's Unicode when writing the PDF ToUnicode map.
for table in font['cmap'].tables:
    if table.isUnicode():
        for codepoint in aliases:
            table.cmap.pop(codepoint, None)
outputs = []
for weight, style in [(400, 'Regular'), (600, 'SemiBold'), (700, 'Bold')]:
    print(f'Preparing static {style}...', flush=True)
    instance = instantiateVariableFont(font, {'wght': weight}, inplace=False, optimize=True)
    for name_id, value in {1: 'Resume Sans SC', 2: style, 3: f'ResumeSansSC-{style}-2.04', 4: f'Resume Sans SC {style}', 6: f'ResumeSansSC-{style}', 16: 'Resume Sans SC', 17: style}.items():
        instance['name'].setName(value, name_id, 3, 1, 0x409)
        instance['name'].setName(value, name_id, 1, 0, 0)
    instance['OS/2'].usWeightClass = weight
    target = out / f'ResumeSansSC-{style}.ttf'
    instance.save(target)
    outputs.append({'file': target.name, 'weight': weight, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
    print(f'Saved {target.name}', flush=True)
report = {
    'upstreamFamily': 'Noto Sans SC',
    'upstreamVersion': '2.04;241114210130;non-release',
    'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
    'license': 'SIL Open Font License 1.1',
    'changes': 'Static weight instances; new family name; removed duplicate compatibility radical cmap aliases. No outline design changes.',
    'removedAliases': {f'U+{key:04X}': f'U+{value:04X}' for key, value in aliases.items()},
    'outputs': outputs
}
(out / 'provenance.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf8')
