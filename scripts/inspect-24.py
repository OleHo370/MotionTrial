"""Render timestamped contact sheets of the user-provided 24.mp4 for boundary review."""
from pathlib import Path
import argparse
import cv2
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--start', type=float, default=0)
parser.add_argument('--end', type=float, default=287.366667)
parser.add_argument('--step', type=float, default=10)
parser.add_argument('--name', default='overview')
parser.add_argument('--crop', type=int, nargs=4)
args = parser.parse_args()
out = ROOT / 'artifacts' / 'source-24-review'
out.mkdir(parents=True, exist_ok=True)
cap = cv2.VideoCapture(str(ROOT.parents[1] / '24.mp4'))
times = []
t = args.start
while t < args.end:
    times.append(t)
    t += args.step
for page in range((len(times) + 29) // 30):
    group = times[page * 30:(page + 1) * 30]
    sheet = Image.new('RGB', (5 * 320, ((len(group) + 4) // 5) * 204), '#ffffff')
    draw = ImageDraw.Draw(sheet)
    for n, t in enumerate(group):
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ok, frame = cap.read()
        if not ok:
            continue
        frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        if args.crop:
            cx, cy, cw, ch = args.crop
            frame = frame[cy:cy + ch, cx:cx + cw]
        x, y = (n % 5) * 320, (n // 5) * 204
        sheet.paste(Image.fromarray(frame).resize((320, 180)), (x, y))
        draw.text((x + 5, y + 183), f'{t:.3f}s  {int(t)//60:02}:{t%60:06.3f}', fill='#000000')
    path = out / f'{args.name}-{page + 1:02}.jpg'
    sheet.save(path, quality=94)
    print(path)
cap.release()
