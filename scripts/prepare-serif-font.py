"""Prepare three redistributable static Noto Serif SC weights for Chromium PDF.

Usage: python scripts/prepare-serif-font.py path/to/NotoSerifSC-VF.ttf
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
SOURCE_SHA256 = "a4aed9985a5916fbf6690456f8732a9fccd517938e353165d4142b4f11a39280"
source = Path(sys.argv[1])
source_bytes = source.read_bytes()
if hashlib.sha256(source_bytes).hexdigest() != SOURCE_SHA256:
    raise ValueError("Noto Serif SC source does not match the recorded version")
font = TTFont(source)

# Skia may map a shared Chinese glyph to a compatibility radical in PDF text.
# Remove only radical aliases whose exact glyph remains mapped to a Han character.
cmap = font.getBestCmap()
han_by_glyph = {}
for codepoint, glyph in cmap.items():
    if 0x4E00 <= codepoint <= 0x9FFF:
        han_by_glyph.setdefault(glyph, codepoint)
aliases = {}
for codepoint, glyph in cmap.items():
    if not 0x2E80 <= codepoint <= 0x2FFF:
        continue
    canonical = unicodedata.normalize("NFKC", chr(codepoint))
    if len(canonical) == 1 and ord(canonical) != codepoint and cmap.get(ord(canonical)) == glyph:
        aliases[codepoint] = ord(canonical)
    elif glyph in han_by_glyph:
        aliases[codepoint] = han_by_glyph[glyph]
for table in font["cmap"].tables:
    if table.isUnicode():
        for codepoint in aliases:
            table.cmap.pop(codepoint, None)

outputs = []
for weight, style in [(400, "Regular"), (600, "SemiBold"), (700, "Bold")]:
    print(f"Preparing static serif {style}...", flush=True)
    instance = instantiateVariableFont(font, {"wght": weight}, inplace=False, optimize=True)
    names = {
        1: "Resume Serif SC", 2: style, 3: f"ResumeSerifSC-{style}-2.02",
        4: f"Resume Serif SC {style}", 6: f"ResumeSerifSC-{style}",
        16: "Resume Serif SC", 17: style,
    }
    for name_id, value in names.items():
        instance["name"].setName(value, name_id, 3, 1, 0x409)
        instance["name"].setName(value, name_id, 1, 0, 0)
    instance["OS/2"].usWeightClass = weight
    target = ROOT / "assets/fonts" / f"ResumeSerifSC-{style}.ttf"
    instance.save(target)
    outputs.append({"file": target.name, "weight": weight, "sha256": hashlib.sha256(target.read_bytes()).hexdigest()})
    print(f"Saved {target.name}", flush=True)

report = {
    "upstreamFamily": "Noto Serif SC",
    "upstreamVersion": "2.02;241114204558;non-release",
    "sourceSha256": SOURCE_SHA256,
    "license": "SIL Open Font License 1.1",
    "changes": "Static weight instances; new family name; removed duplicate compatibility radical cmap aliases. No outline design changes.",
    "removedAliases": {f"U+{key:04X}": f"U+{value:04X}" for key, value in aliases.items()},
    "outputs": outputs,
}
(ROOT / "assets/fonts/provenance-serif.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf8")
