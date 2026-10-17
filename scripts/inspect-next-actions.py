"""Read-only contact sheets for selecting user-authorized subsequent clips."""
from pathlib import Path
import cv2
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
source = ROOT.parents[1] / '太极拳入门_起势完整教学_5分17秒.mp4'
out = ROOT / 'artifacts' / 'practice-source'
out.mkdir(parents=True, exist_ok=True)
cap = cv2.VideoCapture(str(source))
for label, times in [('long-after-lift', range(120, 141)), ('long-front-after', range(186, 213)), ('long-ending', range(270, 316, 2))]:
    sheet = Image.new('RGB', (4 * 380, ((len(times) + 3) // 4) * 230), '#e4eaef')
    for index, seconds in enumerate(times):
        cap.set(cv2.CAP_PROP_POS_MSEC, seconds * 1000)
        ok, frame = cap.read()
        if not ok: raise RuntimeError(f'Cannot decode {seconds}')
        picture = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        picture.thumbnail((360, 200))
        tile = Image.new('RGB', (380, 230), '#f7f8fa')
        tile.paste(picture, ((380 - picture.width) // 2, 22))
        ImageDraw.Draw(tile).text((12, 5), f'{seconds:.1f} s', fill='#14263d')
        sheet.paste(tile, ((index % 4) * 380, (index // 4) * 230))
    sheet.save(out / f'{label}.png')
    print(out / f'{label}.png')
cap.release()
