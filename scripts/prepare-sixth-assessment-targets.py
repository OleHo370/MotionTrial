"""Author a separate video-reviewed GAME rubric for clip 6, not observations.

These are deliberate teaching targets for assessment of a learner's live
observations. They are not recovered teacher landmarks, measured ground truth,
or an upgrade to any MediaPipe visibility/presence value. The display-only
annotation file and original pose archive are not changed or imported.
"""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'public/practice-media/recut-six'
raw = json.loads((BASE / 'master.poses.json').read_text(encoding='utf8'))
samples = {sample['sourceFrameIndex']: sample for sample in raw['samples']}
# Re-reviewed original 450x360 unmirrored images: lower LEFT / raised RIGHT palm.
keys = [
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
for frame, *_ in keys:
    path = BASE / 'inference-frames' / f'frame-{frame:06d}.png'
    if hashlib.sha256(path.read_bytes()).hexdigest() != samples[frame]['inputPngSha256']:
        raise ValueError(f'Reviewed source image changed: {frame}')

provenance = (
    'Video-reviewed authored teaching targets for the four-point imitation game. '
    'Palm placement is approximate (+/-5 source pixels) from exact hash-verified '
    'source images, not measured ground truth or MediaPipe inference. '
    'Target interpolation specifies a practice path/timeline, not missing '
    'tracking. Learner evidence must still be fresh same-side MediaPipe data.'
)
spec = {
    'schemaVersion': 'sixth-practice-targets-v1',
    'version': 'sixth-reviewed-four-point-rubric-v1',
    'referenceEvidenceKind': 'mixed-reviewed-teaching-targets',
    **{key: raw[key] for key in ['sourceSha256', 'sourceClipSha256', 'width', 'height', 'fps']},
    'stepId': 'first-six-06',
    'startFrame': 465,
    'endFrame': 524,
    'provenance': provenance,
    'learnerPolicy': 'All four current anatomical learner controls are required. Missing, stale or low-confidence learner data cannot pass.',
    'leftFootPolicy': 'Use independently supported genuine recorded left-foot observations at the unchanged 0.65 source threshold.',
    'rightFootPolicy': 'Maintain the previous designated planted-foot teaching target through this clip.',
    'tracks': [
        {'index': index, 'provenance': provenance,
         'keyframes': [
             {'sourceFrameIndex': row[0], 'x': row[column][0] / raw['width'],
              'y': row[column][1] / raw['height'],
              'inputPngSha256': samples[row[0]]['inputPngSha256']}
             for row in keys
         ]}
        for index, column in [(33, 1), (34, 2)]
    ],
}
(BASE / 'clip-06-assessment-targets.json').write_text(json.dumps(spec, indent=2) + '\n', encoding='utf8')
print('Wrote explicit clip-6 teaching rubric; raw observations and display guides are unchanged.')
