"""Diagnostic contact sheet of genuine source images; never inference data."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'public/practice-media/recut-six/inference-frames'
OUT = ROOT / 'artifacts/teacher-point-visibility-review'
OUT.mkdir(parents=True, exist_ok=True)
frames = list(range(480, 525, 2))
width, height = 300, 270
sheet = Image.new('RGB', (width * 4, height * 6), '#f3f5ef')
draw = ImageDraw.Draw(sheet)
for number, frame in enumerate(frames):
    x, y = (number % 4) * width, (number // 4) * height
    source = Image.open(BASE / f'frame-{frame:06d}.png').convert('RGB')
    source.thumbnail((300, 240))
    sheet.paste(source, (x, y + 25))
    draw.text((x + 8, y + 6), f'Source frame {frame} | {frame / 30:.3f}s', fill='#183d31')
sheet.save(OUT / 'late-left-hand-source-review.png')
print(OUT / 'late-left-hand-source-review.png')
