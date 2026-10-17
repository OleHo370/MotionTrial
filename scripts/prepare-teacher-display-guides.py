"""Separate approximate teaching illustrations, never MediaPipe observations.

Palm placements were visually reviewed on the specified original source PNGs.
They are approximately +/-5 source pixels, not measured tracking ground truth.
The reviewed intervals interpolate illustration positions only; raw observations
and every assessment reference remain untouched.
"""
from pathlib import Path
import hashlib
import json
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'public/practice-media/recut-six'
OUT = ROOT / 'artifacts/teacher-point-visibility-review'
data = json.loads((BASE / 'master.poses.json').read_text(encoding='utf8'))
samples = {sample['sourceFrameIndex']: sample for sample in data['samples']}
reviewed = [
    # Source frame, lower LEFT palm, raised RIGHT palm. UNMIRRORED 450x360.
    (480, (245, 199), (225, 94)),
    (486, (233, 202), (234, 96)),
    (492, (222, 205), (240, 99)),
    (498, (212, 205), (244, 103)),
    (504, (213, 208), (248, 108)),
    (510, (215, 210), (253, 112)),
    (516, (224, 209), (260, 116)),
    (520, (232, 205), (266, 120)),
    (524, (241, 198), (274, 124)),
]
for frame, *_ in reviewed:
    image = BASE / 'inference-frames' / f'frame-{frame:06d}.png'
    if hashlib.sha256(image.read_bytes()).hexdigest() != samples[frame]['inputPngSha256']:
        raise ValueError(f'The reviewed source image changed: {frame}')

provenance = (
    'Approximate palm-center illustration placed by visual review of exact '
    'original 450x360 source PNGs. Unmirrored anatomical identity. '
    'Approximately +/-5 source pixels; not measured ground truth or MediaPipe '
    'inference. Linear interpolation between these reviewed illustration keys '
    'is display only and must never become assessment evidence.'
)
annotations = {
    'schemaVersion': 'teacher-display-guides-v1',
    **{key: data[key] for key in ['sourceSha256', 'sourceClipSha256', 'width', 'height', 'fps']},
    'sourceId': 'master',
    'displayOnly': True,
    'assessmentEligible': False,
    'provenance': provenance,
    'tracks': [
        {
            'index': index,
            'label': label,
            'provenance': provenance,
            'reason': reason,
            'keyframes': [
                {'sourceFrameIndex': row[0], 'x': row[column][0] / data['width'],
                 'y': row[column][1] / data['height'],
                 'inputPngSha256': samples[row[0]]['inputPngSha256']}
                for row in reviewed
            ],
        }
        for index, column, label, reason in [
            (33, 1, 'Left palm guide',
             'The recorded left hand drifts onto the sleeve/torso, then loses reliable finger support.'),
            (34, 2, 'Right palm guide',
             'The recorded raised right hand drifts downward despite high model visibility.'),
        ]
    ],
}
(BASE / 'teacher-display-guides.json').write_text(json.dumps(annotations, indent=2) + '\n', encoding='utf8')

# Review artifact: nine actual source images with only approximate guide marks.
sheet = Image.new('RGB', (450 * 3, 390 * 3), '#f3f5ef')
draw = ImageDraw.Draw(sheet)
for number, (frame, left, right) in enumerate(reviewed):
    x, y = number % 3 * 450, number // 3 * 390
    sheet.paste(Image.open(BASE / 'inference-frames' / f'frame-{frame:06d}.png'), (x, y + 30))
    draw.text((x + 8, y + 8), f'Frame {frame} | APPROXIMATE GUIDES, NOT TRACKING', fill='#183d31')
    for point, color, label in [(left, '#42dfd0', 'LH guide'), (right, '#ffc968', 'RH guide')]:
        px, py = point[0] + x, point[1] + y + 30
        draw.ellipse((px - 6, py - 6, px + 6, py + 6), outline=color, width=2)
        draw.ellipse((px - 1, py - 1, px + 1, py + 1), fill=color)
        draw.text((px + 9, py + 1), label, fill=color, stroke_width=1, stroke_fill='#173d31')
OUT.mkdir(parents=True, exist_ok=True)
sheet.save(OUT / 'reviewed-palm-guides.png')
print('Wrote separate display-only guides: 2 hands x 9 visually reviewed source frames.')
