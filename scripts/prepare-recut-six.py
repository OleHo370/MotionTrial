"""Prepare an exact, gap-free six-category recut of source 24.mp4 frames 0..524.

All outputs are new. The original videos, saved observations and old manifests
are read-only inputs. Genuine MediaPipe extraction is a separate explicit step.
"""
from pathlib import Path
from fractions import Fraction
import hashlib
import json

import av
import cv2
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parents[1] / '24.mp4'
OUT = ROOT / 'public/practice-media/recut-six'
REVIEW = ROOT / 'artifacts/recut-six-review'
SOURCE_SHA = '2d62941ddebe1a75febee4423d0040d021a4247440e248f40d7ea1c69b17fab6'
FPS = 30
TOTAL_FRAMES = 525
CROP = {'x': 50, 'y': 0, 'width': 450, 'height': 360}
DISPLAY_CROP = {'x': .22, 'y': .12, 'width': .64, 'height': .86}
CUTS = [0, 195, 285, 399, 435, 465, 525]
STEPS = [
    ('first-three-01', 'Open the left stance', 'Lift your left foot, step left, and settle into the open stance.', 'left-step', [27]),
    ('first-three-02', 'Raise both hands', 'Slide both hands forward and upward to the demonstrated height.', 'raise', [15, 16]),
    ('first-three-03', 'Lower both hands', 'Bend gently and slide both hands down to the demonstrated end position.', 'lower', [15, 16]),
    ('first-six-04', 'Turn and open the hands', 'Turn with the teacher and open both hands along the demonstrated paths.', 'open', [15, 16]),
    ('first-six-05', 'Circle and gather the hands', 'Circle both hands into the demonstrated high-and-low preparation.', 'circle', [15, 16]),
    ('first-six-06', 'Lift and extend the left heel', 'Lift your left foot and extend the heel forward with the teacher.', 'left-heel', [27]),
]


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf8')


def encode(frames, path, first, last):
    """Encode the exact half-open source-frame partition without resampling."""
    temporary = path.with_suffix('.preparing.mp4')
    container = av.open(str(temporary), mode='w', options={'movflags': '+faststart'})
    stream = container.add_stream('libx264', rate=FPS)
    stream.width, stream.height = CROP['width'], CROP['height']
    stream.pix_fmt = 'yuv420p'
    stream.time_base = Fraction(1, FPS)
    # Intra-only cuts make every playback boundary seekable without keyframe drift.
    stream.options = {'crf': '15', 'preset': 'fast', 'g': '1', 'bf': '0'}
    try:
        for index in range(first, last):
            frame = av.VideoFrame.from_ndarray(frames[index], format='bgr24')
            frame.pts = index - first
            frame.time_base = Fraction(1, FPS)
            for packet in stream.encode(frame):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)
    finally:
        container.close()
    temporary.replace(path)
    with av.open(str(path)) as encoded:
        decoded = list(encoded.decode(video=0))
        if len(decoded) != last - first:
            raise RuntimeError(f'{path.name}: encoded frame count differs from exact partition')
        timestamps = [float(frame.time) for frame in decoded]
        if any(abs(value - i / FPS) > 1e-7 for i, value in enumerate(timestamps)):
            raise RuntimeError(f'{path.name}: encoded timestamps are not exact 30 fps')
    return {'frameCount': last - first, 'durationSeconds': (last - first) / FPS,
            'decodedFirstTimeSeconds': timestamps[0], 'decodedLastTimeSeconds': timestamps[-1],
            'sha256': digest(path), 'bytes': path.stat().st_size}


def sheet(frames, indices, path, columns=5):
    width, height = 300, 240
    sheet_image = Image.new('RGB', (width * columns, (height + 28) * ((len(indices) + columns - 1) // columns)), 'white')
    draw = ImageDraw.Draw(sheet_image)
    for i, frame_index in enumerate(indices):
        image = Image.fromarray(cv2.cvtColor(frames[frame_index], cv2.COLOR_BGR2RGB))
        image.thumbnail((width, height))
        x, y = i % columns * width, i // columns * (height + 28)
        sheet_image.paste(image, (x + (width - image.width) // 2, y))
        draw.text((x + 5, y + height + 4), f'Frame {frame_index} | {frame_index / FPS:.4f}s', fill='black')
    sheet_image.save(path, quality=96)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    REVIEW.mkdir(parents=True, exist_ok=True)
    png_dir = OUT / 'inference-frames'
    png_dir.mkdir(exist_ok=True)
    if digest(SOURCE) != SOURCE_SHA:
        raise RuntimeError('Original 24.mp4 hash does not match reviewed source')
    capture = cv2.VideoCapture(str(SOURCE))
    source_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    if (capture.get(cv2.CAP_PROP_FPS), capture.get(cv2.CAP_PROP_FRAME_WIDTH), capture.get(cv2.CAP_PROP_FRAME_HEIGHT)) != (30, 640, 360):
        raise RuntimeError('Unexpected source video dimensions/frame rate')
    frames = []
    try:
        for index in range(TOTAL_FRAMES):
            ok, frame = capture.read()
            if not ok:
                raise RuntimeError(f'Could not decode exact source frame {index}')
            frames.append(frame[CROP['y']:CROP['y'] + CROP['height'], CROP['x']:CROP['x'] + CROP['width']].copy())
    finally:
        capture.release()

    master = encode(frames, OUT / 'master.mp4', 0, TOTAL_FRAMES)
    schedule = []
    for index in sorted(set(range(0, TOTAL_FRAMES, 2)) | set(CUTS[1:-1]) | {15, TOTAL_FRAMES - 1}):
        png = png_dir / f'frame-{index:06}.png'
        if not cv2.imwrite(str(png), frames[index], [cv2.IMWRITE_PNG_COMPRESSION, 6]):
            raise RuntimeError(f'Could not write {png}')
        schedule.append({'frameIndex': index, 'sourceFrameIndex': index, 'tMs': index / FPS * 1000,
                         'sourceTimeSeconds': index / FPS, 'pngSrc': f'/practice-media/recut-six/inference-frames/{png.name}',
                         'pngSha256': digest(png), 'width': CROP['width'], 'height': CROP['height'],
                         'inferenceEligible': index >= 15, 'role': 'practice' if index >= 15 else 'intro'})
    schedule_metadata = {'schemaVersion': 'recut-six-exact-frame-schedule-v1', 'sourceFile': '24.mp4',
                         'sourceSha256': SOURCE_SHA, 'sourceCropPixels': CROP, 'fps': FPS,
                         'width': CROP['width'], 'height': CROP['height'], 'masterSha256': master['sha256'],
                         'sourceStartFrame': 0, 'sourceEndFrameExclusive': TOTAL_FRAMES,
                         'sampleRateHz': 15, 'sampleCount': len(schedule), 'frames': schedule,
                         'practiceStartFrame': 15, 'inferenceSampleCount': sum(frame['inferenceEligible'] for frame in schedule),
                         'samplingPolicy': 'Every second exact source decoded frame (15 Hz), plus neutral practice start frame15, every interior cut frame and final frame524. PNGs are lossless cropped source frames, not inferred or interpolated observations.',
                         'endpointPolicy': 'Each interior boundary uses exactly frameN for both preceding end and following start. Last endpoint is actual final frame524; frame525 is outside the excerpt.',
                         'introPolicy': 'Keep all opening frames in master/clip1, but do not infer title frames0..14 or use them as pose targets. Start continuous VIDEO inference at neutral frame15.'}
    write_json(OUT / 'schedule.json', schedule_metadata)

    steps = []
    for i, (identifier, title, cue, motion, focus) in enumerate(STEPS):
        first, last = CUTS[i:i + 2]
        reference_start = 15 if i == 0 else first
        endpoint = last if i < len(STEPS) - 1 else TOTAL_FRAMES - 1
        clip = OUT / f'step-{i + 1:02}.mp4'
        encoded = encode(frames, clip, first, last)
        start_image = OUT / f'step-{i + 1:02}-start.png'
        end_image = OUT / f'step-{i + 1:02}-end.png'
        if not cv2.imwrite(str(start_image), frames[reference_start]) or not cv2.imwrite(str(end_image), frames[endpoint]):
            raise RuntimeError(f'Could not write step{i + 1} exact boundary PNG')
        steps.append({'id': identifier, 'title': title, 'cue': cue, 'motion': motion, 'focusJoints': focus,
                      'sourceId': 'master', 'startSeconds': first / FPS, 'endSeconds': last / FPS,
                      'sourceStartSeconds': first / FPS, 'sourceEndSeconds': last / FPS,
                      'sourceStartFrame': first, 'sourceEndFrameExclusive': last,
                      'durationSeconds': (last - first) / FPS,
                      'referenceStartFrame': reference_start, 'referenceEndFrame': endpoint,
                      'referenceStartSeconds': reference_start / FPS, 'referenceEndSeconds': endpoint / FPS,
                      'practiceStartSeconds': reference_start / FPS,
                      'teacherFreezeSeconds': endpoint / FPS,
                      'referenceVisibilityThreshold': .45 if i < 3 else .65,
                      'observationVisibilityThreshold': .45 if i < 3 else .65,
                      'clipSrc': f'/practice-media/recut-six/{clip.name}', 'clipSha256': encoded['sha256'],
                      'clipFrameCount': encoded['frameCount'],
                      'screenshots': {'start': f'/practice-media/recut-six/{start_image.name}', 'end': f'/practice-media/recut-six/{end_image.name}'},
                      'screenshotSourceFrames': {'start': reference_start, 'end': endpoint},
                      'screenshotSourceTimes': {'start': reference_start / FPS, 'end': endpoint / FPS},
                      'boundaryEvidence': 'Exact decoded source-frame identity. Interior reference ending frame is shared with the following start; encoded playback partitions remain half-open with no dropped or duplicated frames.',
                      'clipProvenance': 'Independent demonstration cut encoded from this exact contiguous source-frame range. Player uses one continuous master; observations must come from the lossless PNG schedule.'})
    source_video = {'src': '/practice-media/recut-six/master.mp4', 'width': CROP['width'], 'height': CROP['height'],
                    'fps': FPS, 'frameCount': TOTAL_FRAMES, 'durationSeconds': TOTAL_FRAMES / FPS,
                    'sha256': master['sha256'], 'sourceStartSeconds': 0, 'sourceEndSeconds': TOTAL_FRAMES / FPS,
                    'sourceStartFrame': 0, 'sourceEndFrameExclusive': TOTAL_FRAMES,
                    'sourceCropPixels': CROP,
                    'provenance': 'One continuous 30fps master encoded from every original source frame0 through524, in order. No omitted frames, temporal resampling, inserted motion, or model reset at teaching cuts.'}
    manifest = {'schemaVersion': 'recut-six-teaching-v1', 'title': 'Six continuous movements',
                'source': {'file': '24.mp4', 'sha256': SOURCE_SHA, 'src': source_video['src'],
                           'excerptSha256': master['sha256'], 'startSeconds': 0, 'endSeconds': TOTAL_FRAMES / FPS,
                           'fps': FPS, 'width': 640, 'height': 360, 'sourceFrames': source_frames,
                           'sourceDurationSeconds': source_frames / FPS,
                           'scope': 'All frames of the current first-six-category sample,0–17.5s. The remainder of the287.3667s original is outside this lesson.'},
                'sources': [{'id': 'master', 'video': source_video,
                             'poseSrc': '/practice-media/recut-six/master.poses.json',
                             'displayCrop': DISPLAY_CROP, 'observationVisibilityThreshold': .65}],
                'steps': steps, 'cutFrames': CUTS, 'scheduleSrc': '/practice-media/recut-six/schedule.json',
                'orientation': {'sourceMirrored': False, 'defaultDisplayMirror': True, 'anatomicalIndicesUnchanged': True},
                'rules': {'stepCount': 6, 'sourceTeachingStartSeconds': 0, 'sourceTeachingEndSeconds': TOTAL_FRAMES / FPS,
                          'noOmittedFrames': True, 'singleSourceTimeline': True, 'constantDisplayCrop': True,
                          'observationSampling': 'Requires fresh genuine local MediaPipe inference on exact lossless PNG frames at15Hz plus exact boundary frames. No archived observations relabeled as new inference.',
                          'initialTitleCard': 'Original opening title card remains in master and clip1. Practice/reference starts explicitly at neutral teacher frame15(0.5s); title poses are never used as standing targets.',
                          'referenceBoundaryPolicy': 'Same actual source frame at both sides of every interior cut. Last endpoint is final decodable frame524.'}}
    write_json(OUT / 'manifest.json', manifest)
    sheet(frames, list(range(0, TOTAL_FRAMES, 15)) + [TOTAL_FRAMES - 1], REVIEW / 'recut-full-half-seconds.jpg')
    sheet(frames, [frame for cut in CUTS[1:-1] for frame in (cut - 1, cut)], REVIEW / 'recut-cut-frame-pairs.jpg')
    sheet(frames, [0, 2, 4, 6, 8, 10, 12, 14, 16, 18], REVIEW / 'recut-initial-frames.jpg')
    report = {'schemaVersion': 'recut-six-preparation-review-v1', 'sourceSha256': SOURCE_SHA,
              'originalSourceUnchanged': digest(SOURCE) == SOURCE_SHA, 'newInferencePerformed': False,
              'sourceFrameRange': [0, TOTAL_FRAMES], 'sourceEndFrameExclusive': True,
              'all525FramesCoveredExactlyOnce': sum(step['clipFrameCount'] for step in steps) == TOTAL_FRAMES,
              'cutFrames': CUTS, 'master': master, 'inferenceScheduleCount': len(schedule),
              'allInteriorCutFramesScheduled': all(cut in {frame['frameIndex'] for frame in schedule} for cut in CUTS[1:-1]),
              'steps': steps, 'manifestSha256': digest(OUT / 'manifest.json'),
              'reviewContactSheets': ['recut-full-half-seconds.jpg', 'recut-cut-frame-pairs.jpg', 'recut-initial-frames.jpg'],
              'protectedAssets': 'Original source, old manifests, old videos, archived poses and all previous pages are untouched. This script writes onlyrecut-six assets andrecut-six-review artifacts.'}
    write_json(REVIEW / 'source-preparation.json', report)
    if not report['originalSourceUnchanged'] or not report['all525FramesCoveredExactlyOnce']:
        raise RuntimeError('Source preservation or partition coverage failed')
    print(json.dumps({'master': master, 'cutFrames': CUTS, 'exactFrameScheduleCount': len(schedule),
                      'manifest': str(OUT / 'manifest.json'), 'sourcePreserved': True}, indent=2), flush=True)


if __name__ == '__main__':
    main()
