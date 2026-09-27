"""Derive the EXIF test fixture from the existing public-domain synthetic image."""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
output = root / 'tests/fixtures'
output.mkdir(parents=True, exist_ok=True)
image = Image.open(root / 'assets/images/synthetic-portrait.jpg').convert('RGB')
rotated = image.transpose(Image.Transpose.ROTATE_90)
exif = Image.Exif()
exif[274] = 6  # Viewers rotate stored pixels clockwise to recover the original.
rotated.save(output / 'portrait-orientation-6.jpg', quality=95, exif=exif)
