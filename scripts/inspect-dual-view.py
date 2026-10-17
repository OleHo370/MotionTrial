"""Decode timestamped source contact sheets for the user-supplied paired videos."""
from pathlib import Path
import cv2
from PIL import Image, ImageDraw
import json
import hashlib

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts' / 'dual-view-review'
OUT.mkdir(parents=True, exist_ok=True)

for name in ['front', 'back']:
    source = ROOT.parents[1] / f'{name}.mp4'
    cap = cv2.VideoCapture(str(source))
    fps = cap.get(cv2.CAP_PROP_FPS)
    frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = frames / fps
    props = dict(file=str(source), fps=fps, frames=frames, durationSeconds=duration,
                 width=int(cap.get(3)), height=int(cap.get(4)),
                 sha256=hashlib.sha256(source.read_bytes()).hexdigest())
    (OUT / f'{name}-source.json').write_text(json.dumps(props, indent=2), encoding='utf-8')
    for first in range(0, int(duration), 30):
        times = [t for t in range(first, first + 30) if t < duration]
        sheet = Image.new('RGB', (5 * 384, 6 * 240), 'white')
        draw = ImageDraw.Draw(sheet)
        for i, t in enumerate(times):
            cap.set(cv2.CAP_PROP_POS_FRAMES, round(t * fps))
            ok, frame = cap.read()
            if not ok:
                raise RuntimeError(f'Failed source frame {name} {t}')
            x, y = i % 5 * 384, i // 5 * 240
            sheet.paste(Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)).resize((384, 216)), (x, y))
            draw.text((x + 5, y + 219), f'{name} {t:.1f}s', fill='black')
        sheet.save(OUT / f'{name}-{first:03}-{min(first+29,int(duration)):03}.jpg', quality=92)
    cap.release()
    print(json.dumps(props), flush=True)
