"""Render actual decoded 24b.mp4 source frames for manual semantic cut review."""
from pathlib import Path
import argparse
import cv2
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--start', type=float, default=0)
parser.add_argument('--end', type=float, default=278.066667)
parser.add_argument('--step', type=float, default=1)
parser.add_argument('--name', default='seconds')
args = parser.parse_args()
out = ROOT / 'artifacts' / 'source-24b-review'
out.mkdir(parents=True, exist_ok=True)
cap = cv2.VideoCapture(str(ROOT.parents[1] / '24b.mp4'))
times = []
t = args.start
while t < args.end:
    times.append(t)
    t += args.step
for page in range((len(times) + 31) // 32):
    group = times[page * 32:(page + 1) * 32]
    sheet = Image.new('RGB', (4 * 480, ((len(group) + 3) // 4) * 294), 'white')
    draw = ImageDraw.Draw(sheet)
    for n, t in enumerate(group):
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ok, frame = cap.read()
        if not ok:
            raise RuntimeError(f'Cannot decode frame at {t}s')
        x, y = (n % 4) * 480, (n // 4) * 294
        sheet.paste(Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)).resize((480, 270)), (x, y))
        draw.text((x + 5, y + 273), f'{t:.3f}s', fill='black')
    destination = out / f'{args.name}-{page + 1:02}.jpg'
    sheet.save(destination, quality=95)
    print(destination)
cap.release()
