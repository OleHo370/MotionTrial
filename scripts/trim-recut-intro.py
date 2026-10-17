"""Remove only the opening title from the first recut clip and preview.

Run after prepare-recut-six.py. Keep the master and its genuine observations
unchanged so every original frame ID and subsequent clip boundary stays exact.
"""
from pathlib import Path
import hashlib
import importlib.util
import json
import av

ROOT = Path(__file__).resolve().parents[1]
FOLDER = ROOT / 'public/practice-media/recut-six'
REVIEW = ROOT / 'artifacts/trim-intro-review'
FIRST = 15
LAST = 525
FPS = 30
spec = importlib.util.spec_from_file_location('recut_media', ROOT / 'scripts/prepare-recut-six.py')
media = importlib.util.module_from_spec(spec)
spec.loader.exec_module(media)
manifest = json.loads((FOLDER / 'manifest.json').read_text('utf8'))
preserved = [FOLDER / 'master.mp4', FOLDER / 'master.poses.json'] + [FOLDER / f'step-{i:02}.mp4' for i in range(2, 7)]
before = {str(path): media.digest(path) for path in preserved}

# Decode once with exact PTS from the preserved master. Frame IDs remain the
# original 24.mp4 IDs; no new inference, time remapping, or dropped movement.
with av.open(str(FOLDER / 'master.mp4')) as container:
    frames = [frame.to_ndarray(format='bgr24') for frame in container.decode(video=0)]
if len(frames) != LAST:
    raise RuntimeError('Unexpected preserved master length')
step = manifest['steps'][0]
first_clip = media.encode(frames, FOLDER / 'step-01.mp4', FIRST, step['sourceEndFrameExclusive'])
preview = media.encode(frames, FOLDER / 'demonstration.mp4', FIRST, LAST)
step.update(startSeconds=FIRST/FPS, sourceStartSeconds=FIRST/FPS, sourceStartFrame=FIRST,
            durationSeconds=(step['sourceEndFrameExclusive']-FIRST)/FPS,
            clipFrameCount=first_clip['frameCount'], clipSha256=first_clip['sha256'],
            clipProvenance='Starts directly on neutral instructor frame15. Only the opening title frames0–14 are excluded; all subsequent demonstration frames are retained.')
manifest['cutFrames'][0] = FIRST
manifest['rules'].update(sourceTeachingStartFrame=FIRST, sourceTeachingStartSeconds=FIRST/FPS,
                         noOmittedFrames=True,
                         initialTitleCard='Opening title frames0–14 are excluded from teaching clips and practice playback. The preserved master and exact-frame observations are unchanged.')
manifest['source']['scope'] = 'Practice clips cover all demonstration frames15–524 (0.5–17.5s). Only the opening title is excluded. The original full master is retained for observation provenance.'
manifest['demonstrationPreview'] = {'src':'/practice-media/recut-six/demonstration.mp4',
    'sha256':preview['sha256'], 'durationSeconds':preview['durationSeconds'],
    'frameCount':preview['frameCount'], 'sourceStartFrame':FIRST, 'sourceEndFrameExclusive':LAST}
media.write_json(FOLDER / 'manifest.json', manifest)
after = {str(path):media.digest(path) for path in preserved}
if before != after:
    raise RuntimeError('A protected master, observation archive, or later clip changed')
REVIEW.mkdir(parents=True, exist_ok=True)
media.write_json(REVIEW / 'media.json', {'removedTitleFrameRange':[0,FIRST],
    'firstTeachingFrame':FIRST, 'firstClip':first_clip, 'preview':preview,
    'teachingFrameCount':LAST-FIRST, 'cutFrames':manifest['cutFrames'],
    'preserved':before, 'allPreserved':before==after})
print(json.dumps({'firstClipFrames':first_clip['frameCount'], 'firstClipDuration':first_clip['durationSeconds'],
    'previewFrames':preview['frameCount'], 'teachingStartSeconds':FIRST/FPS, 'preserved':before==after}))
