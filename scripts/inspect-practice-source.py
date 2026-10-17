from pathlib import Path
import cv2, json
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
out = ROOT / 'artifacts' / 'practice-source'
out.mkdir(parents=True, exist_ok=True)
sources = sorted(ROOT.parents[1].glob('*.mp4'), key=lambda p: p.stat().st_size)
metadata = []
for number, source in enumerate(sources):
    cap = cv2.VideoCapture(str(source))
    fps = cap.get(cv2.CAP_PROP_FPS)
    duration = cap.get(cv2.CAP_PROP_FRAME_COUNT) / fps
    times = list(range(0, int(duration), 1 if duration < 30 else 20))
    thumbs = []
    for sec in times:
        cap.set(cv2.CAP_PROP_POS_MSEC, sec * 1000)
        ok, frame = cap.read()
        if not ok: continue
        rgb = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        rgb.thumbnail((360, 200))
        tile = Image.new('RGB', (380, 230), '#f7f8fa')
        tile.paste(rgb, ((380-rgb.width)//2, 22))
        ImageDraw.Draw(tile).text((12, 5), f'{sec:.1f} s', fill='#14263d')
        thumbs.append(tile)
    sheet = Image.new('RGB', (4*380, ((len(thumbs)+3)//4)*230), '#e4eaef')
    for i, tile in enumerate(thumbs): sheet.paste(tile, ((i%4)*380, (i//4)*230))
    sheet.save(out / f'source-{number+1}-contact.png')
    metadata.append({'source': str(source), 'durationSeconds': duration, 'fps': fps,
      'width': cap.get(cv2.CAP_PROP_FRAME_WIDTH), 'height': cap.get(cv2.CAP_PROP_FRAME_HEIGHT)})
    cap.release()
(out/'sources.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(metadata, ensure_ascii=True, indent=2))
