"""Render every page with Poppler; no PDF pages are silently omitted."""
import argparse
from pathlib import Path
import subprocess
import os
from pypdf import PdfReader

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--directory', type=Path, default=root / 'output/pdf')
parser.add_argument('--dpi', type=int, default=150)
args = parser.parse_args()
assert 72 <= args.dpi <= 300
for pdf in sorted(args.directory.glob('*.pdf')):
    count = len(PdfReader(pdf).pages)
    command = ['pdftoppm', '-r', str(args.dpi), '-png']
    if count == 1:
        command += ['-singlefile']
    command += [str(pdf), str(pdf.with_suffix(''))]
    subprocess.run(command, check=True, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    print(f'{pdf.name}: rendered all {count} pages at {args.dpi} DPI', flush=True)
