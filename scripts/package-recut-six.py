"""Package only the six new continuous teaching clips and their cut manifest."""
from pathlib import Path
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FOLDER = ROOT / 'public/practice-media/recut-six'
manifest = json.loads((FOLDER / 'manifest.json').read_text('utf8'))
lines = [
    'Six continuous categories from 24.mp4',
    f"Selected scope: original frames {manifest['steps'][0]['sourceStartFrame']} through {manifest['steps'][-1]['sourceEndFrameExclusive']-1}, 30 fps, {manifest['steps'][0]['sourceStartSeconds']:.1f}-{manifest['steps'][-1]['sourceEndSeconds']:.1f} seconds.",
    'The six half-open ranges cover every frame exactly once. No source motion is omitted.',
    'The opening title is excluded. Clip 1 and practice playback begin directly at neutral instructor frame 15.',
    'Each interior target boundary is the first original frame of the following clip.',
    'The practice page uses one continuous master for identical framing and seamless boundary holds.',
    'Actual teacher tracking and its limitations are separate from the video cuts.',
    '',
]
output = FOLDER / 'six-continuous-clips.zip'
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_STORED) as archive:
    for step in manifest['steps']:
        path = ROOT / ('public' + step['clipSrc'])
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != step['clipSha256']:
            raise RuntimeError(f'Clip changed: {path.name}')
        archive.write(path, path.name)
        lines.append(f"{path.name}: {step['sourceStartSeconds']:.4f}-{step['sourceEndSeconds']:.4f} s | {step['sourceStartFrame']}:{step['sourceEndFrameExclusive']} | {step['title']}")
    archive.write(FOLDER / 'manifest.json', 'manifest.json')
    archive.writestr('README.txt', '\n'.join(lines) + '\n')
with zipfile.ZipFile(output) as archive:
    assert len([name for name in archive.namelist() if name.endswith('.mp4')]) == 6
    assert archive.testzip() is None
print(json.dumps({'path': str(output), 'bytes': output.stat().st_size, 'clips': 6}))
