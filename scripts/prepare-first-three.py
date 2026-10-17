"""Review and prepare a separate first-three-step teaching proof from 24.mp4 only."""
from pathlib import Path
import argparse
import hashlib
import json
import shutil
import av
import cv2
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parents[1] / '24.mp4'
OUT = ROOT / 'public' / 'practice-media' / 'first-three'
REVIEW = ROOT / 'artifacts' / 'first-three-review'
FPS = 30
CROP = (50, 0, 450, 360)
STEPS = [
    ('first-three-01', 'Open the left stance', 'Lift your left foot, step left, and settle into the open stance.', 1.0, 6.5, [27]),
    ('first-three-02', 'Raise both hands', 'Slide both hands forward and upward to the demonstrated height.', 6.5, 9.5, [15, 16]),
    ('first-three-03', 'Lower both hands', 'Bend gently and slide both hands down to the demonstrated end position.', 9.5, 13.0, [15, 16]),
]


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def contact_sheet(capture, times, output, crop=None):
    width, height, columns = 320, 180, 6
    sheet = Image.new('RGB', (width * columns, 204 * ((len(times) + columns - 1) // columns)), '#ffffff')
    draw = ImageDraw.Draw(sheet)
    for n, seconds in enumerate(times):
        capture.set(cv2.CAP_PROP_POS_FRAMES, round(seconds * 30))
        ok, frame = capture.read()
        if not ok:
            raise RuntimeError(f'Cannot decode source at {seconds:.3f}s')
        frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        if crop:
            x, y, w, h = crop
            frame = frame[y:y + h, x:x + w]
        image = Image.fromarray(frame)
        image.thumbnail((width, height))
        x, y = n % columns * width, n // columns * 204
        sheet.paste(image, (x + (width - image.width) // 2, y + (height - image.height) // 2))
        draw.text((x + 6, y + 184), f'Source 24.mp4 | {seconds:.3f}s', fill='#111111')
    sheet.save(output, quality=95)


def encode(capture, output, first, last, crop):
    temporary = output.with_suffix('.preparing.mp4')
    container = av.open(str(temporary), mode='w', options={'movflags': '+faststart'})
    stream = container.add_stream('libx264', rate=FPS)
    stream.width, stream.height = crop[2:]
    stream.pix_fmt = 'yuv420p'
    stream.options = {'crf': '19', 'preset': 'fast'}
    capture.set(cv2.CAP_PROP_POS_FRAMES, first)
    x, y, width, height = crop
    try:
        for index in range(last - first):
            ok, frame = capture.read()
            if not ok:
                raise RuntimeError(f'Cannot decode source frame {first + index}')
            video_frame = av.VideoFrame.from_ndarray(frame[y:y + height, x:x + width], format='bgr24')
            video_frame.pts = index
            for packet in stream.encode(video_frame):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)
    finally:
        container.close()
    temporary.replace(output)


def screenshot(capture, source_frame, output):
    capture.set(cv2.CAP_PROP_POS_FRAMES, source_frame)
    ok, frame = capture.read()
    if not ok:
        raise RuntimeError(f'Cannot decode screenshot frame {source_frame}')
    x, y, width, height = CROP
    if not cv2.imwrite(str(output), frame[y:y + height, x:x + width], [cv2.IMWRITE_JPEG_QUALITY, 96]):
        raise RuntimeError(f'Cannot write screenshot {output.name}')


def point_quality(samples, focus):
    result = {}
    for index in focus:
        points = [next((p for p in s['landmarks'] if p['index'] == index), None) for s in samples if s['status'] == 'pose']
        visible = [p for p in points if p is not None and p['visibility'] >= 0.65 and 0 <= p['x'] <= 1 and 0 <= p['y'] <= 1]
        result[str(index)] = {'observedCount': len(points), 'visibleCount': len(visible), 'coverage': len(visible) / max(1, len(samples)),
                              'minimumVisibility': min((p['visibility'] for p in points if p), default=None),
                              'maximumVisibility': max((p['visibility'] for p in points if p), default=None)}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--review-only', action='store_true')
    parser.add_argument('--refresh-step', type=int, choices=[1, 2, 3], help='Refresh only this new step clip/end screenshot and metadata; retain existing new source videos.')
    args = parser.parse_args()
    REVIEW.mkdir(parents=True, exist_ok=True)
    source_sha = digest(SOURCE)
    existing = json.loads((ROOT / 'public/practice-media/24-01.json').read_text('utf8'))
    if existing['sourceSha256'] != source_sha:
        raise RuntimeError('Existing 24-01 provenance differs from the supplied 24.mp4. Do not reuse its poses.')
    capture = cv2.VideoCapture(str(SOURCE))
    fps, frames = capture.get(cv2.CAP_PROP_FPS), int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    width, height = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)), int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    if fps != 30 or width != 640 or height != 360:
        raise RuntimeError(f'Unexpected source video properties: {fps}, {width}x{height}')
    if not args.refresh_step:
        contact_sheet(capture, list(range(30)), REVIEW / 'source-first-30-contact.jpg')
        contact_sheet(capture, [t / 2 for t in range(2, 28)], REVIEW / 'source-opening-half-seconds.jpg', (50, 0, 450, 360))
    print(f'Source SHA256: {source_sha}; {width}x{height}, {fps}fps, {frames} frames', flush=True)
    print(REVIEW / 'source-first-30-contact.jpg', flush=True)
    print(REVIEW / 'source-opening-half-seconds.jpg', flush=True)
    if args.review_only:
        capture.release()
        return
    # Visual contact-sheet review: opening stance 1.0-6.5s, bilateral raise
    # 6.5-9.5s, bilateral lowering 9.5-13.0s. The remainder of the first 30s
    # already enters Part the Wild Horse's Mane and is not mislabeled as opening.
    OUT.mkdir(parents=True, exist_ok=True)
    existing_clip = ROOT / 'public/practice-media/24-01.mp4'
    existing_poses = ROOT / 'public/practice-media/24-01.poses.json'
    pose_bytes_sha = digest(existing_poses)
    pose_data = json.loads(existing_poses.read_text('utf8'))
    existing_clip_sha = digest(existing_clip)
    if existing_clip_sha != existing['sha256'] or pose_data['sourceClipSha256'] != existing_clip_sha:
        raise RuntimeError('The existing real pose observations do not match the exact 24-01 encoded clip.')
    if existing['startSeconds'] != 1.0 or existing['endSeconds'] != 13.3 or (pose_data['width'], pose_data['height']) != CROP[2:]:
        raise RuntimeError('Unexpected old opening timing or crop; re-review before reuse.')
    if not args.refresh_step:
        shutil.copyfile(existing_clip, OUT / 'opening.mp4')
        encode(capture, OUT / 'first-30-seconds.mp4', 0, 900, (0, 0, width, height))
    elif digest(OUT / 'opening.mp4') != existing_clip_sha or not (OUT / 'first-30-seconds.mp4').is_file():
        raise RuntimeError('A partial refresh needs the already-prepared, matching new source videos.')
    copied_samples = []
    for sample in pose_data['samples']:
        estimated_frame = min(round(sample['tMs'] / 1000 * FPS), round(pose_data['durationMs'] / 1000 * FPS) - 1)
        copied_samples.append({**sample, 'sourceTimeSeconds': 1 + sample['tMs'] / 1000,
                               'frameIndex': estimated_frame, 'sourceFrameIndex': estimated_frame + FPS})
    data = {'schemaVersion': 'first-three-recorded-pose-v1', 'view': 'front', 'formNumber': 1,
            'fps': FPS, 'width': CROP[2], 'height': CROP[3], 'sampleRateHz': pose_data['sampleRateHz'],
            'durationMs': pose_data['durationMs'], 'sourceSha256': source_sha, 'sourceClipSha256': existing_clip_sha,
            'modelSha256': pose_data['modelSha256'], 'originalObservationSrc': '/practice-media/24-01.poses.json',
            'originalObservationSha256': pose_bytes_sha, 'sourceStartSeconds': 1.0, 'sourceEndSeconds': 13.3,
            'frameIndexPrecision': 'Estimated from recorded presentation timestamp; original cached observations have no exact decoded frame IDs.',
            'timeMapping': 'Original sample.tMs remains relative to the unchanged opening.mp4. sourceTimeSeconds = 1 + tMs / 1000.',
            'provenance': pose_data['provenance'] + ' Exact observations reused without coordinate changes or interpolation, matched by clip SHA256.',
            'samples': copied_samples}
    (OUT / 'opening.poses.json').write_text(json.dumps(data, separators=(',', ':')) + '\n', encoding='utf8')
    steps = []
    for n, (identifier, title, cue, start, end, focus) in enumerate(STEPS, start=1):
        first, last = round(start * FPS), round(end * FPS)
        clip_name, start_name, end_name = f'step-{n:02}.mp4', f'step-{n:02}-start.jpg', f'step-{n:02}-end.jpg'
        if not args.refresh_step or args.refresh_step == n:
            encode(capture, OUT / clip_name, first, last, CROP)
            if not args.refresh_step or not (OUT / start_name).is_file():
                screenshot(capture, first, OUT / start_name)
            screenshot(capture, last - 1, OUT / end_name)
        observations = [s for s in copied_samples if start <= s['sourceTimeSeconds'] < end]
        steps.append({'id': identifier, 'title': title, 'cue': cue, 'startSeconds': start - 1, 'endSeconds': end - 1,
                      'motion': ['left-step', 'raise', 'lower'][n - 1],
                      'sourceStartSeconds': start, 'sourceEndSeconds': end, 'sourceStartFrame': first, 'sourceEndFrameExclusive': last,
                      'focusJoints': focus, 'durationSeconds': end - start,
                      'screenshots': {'start': f'/practice-media/first-three/{start_name}', 'end': f'/practice-media/first-three/{end_name}'},
                      'screenshotSourceTimes': {'start': first / FPS, 'end': (last - 1) / FPS},
                      'clipSrc': f'/practice-media/first-three/{clip_name}', 'clipSha256': digest(OUT / clip_name),
                      'quality': {'visibilityThreshold': 0.65, 'sampleCount': len(observations), 'statusCounts': {status: sum(s['status'] == status for s in observations) for status in ['pose', 'no_pose', 'inference_error']},
                                  'focusPoints': point_quality(observations, focus)},
                      'boundaryEvidence': 'Visually reviewed original-source 0.5-second contact sheet and original start/end frames. Editorial transition; approximately 0.5-second precision.'})
    manifest = {'schemaVersion': 'first-three-teaching-v1', 'title': 'First three movements',
                'source': {'file': '24.mp4', 'src': '/practice-media/first-three/first-30-seconds.mp4', 'sha256': source_sha,
                           'excerptSha256': digest(OUT / 'first-30-seconds.mp4'), 'startSeconds': 0, 'endSeconds': 30,
                           'fps': FPS, 'width': width, 'height': height, 'sourceFrames': frames},
                'video': {'src': '/practice-media/first-three/opening.mp4', 'width': CROP[2], 'height': CROP[3], 'fps': FPS,
                          'durationSeconds': 12.3, 'sha256': existing_clip_sha, 'sourceStartSeconds': 1.0, 'sourceEndSeconds': 13.3,
                          'sourceCropPixels': dict(zip(['x', 'y', 'width', 'height'], CROP)),
                          'provenance': 'Byte-for-byte copy of existing 24-01.mp4, matching its existing real MediaPipe observations.'},
                'poseSrc': '/practice-media/first-three/opening.poses.json',
                'displayCrop': {'x': 0.37, 'y': 0.12, 'width': 0.44, 'height': 0.86},
                'orientation': {'sourceMirrored': False, 'defaultDisplayMirror': True, 'anatomicalIndicesUnchanged': True},
                'rules': {'stepCount': 3, 'teachingEndSeconds': 12.0, 'sourceTeachingEndSeconds': 13.0,
                          'openingTailNote': 'The unchanged opening clip is 12.3 seconds long; teaching stops at clip time 12.0 seconds before the next preparation.',
                          'observationSampling': 'Existing real recorded 12 Hz MediaPipe Lite observations; no 30 fps pose interpolation.',
                          'gameGuides': 'Straight paths between actual observed endpoints, separate from full movement correctness.',
                          'precisionNote': 'Sample timestamps come from recorded clip presentation times; derived frame indices are estimates.'},
                'steps': steps}
    (OUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    audit = {'schemaVersion': 'first-three-source-review-v1', 'sourceFile': str(SOURCE), 'sourceSha256': source_sha,
             'existingClipSha256': existing_clip_sha, 'originalObservationSha256': pose_bytes_sha,
             'sourceFrontLibraryExcluded': 'source-front-* refers to a different source SHA and is not used.',
             'contactSheets': ['source-first-30-contact.jpg', 'source-opening-half-seconds.jpg'],
             'sourceReview': '0.0s title card; 1.0s neutral standing; 2-5s left stance opening; 7-9.5s both hands rise; 9.5-13.0s both hands lower with knee bend. Teaching ends at source13.0s; the copied opening clip retains its original13.3s end and all149 observations. The first30s remainder enters the following form.',
             'teachingRange': {'sourceStartSeconds': 1.0, 'sourceEndSeconds': 13.0, 'openingEndSeconds': 12.0,
                               'openingClipDurationSeconds': 12.3, 'openingObservationCount': len(copied_samples)},
             'steps': steps, 'originalObservationsChanged': False, 'newInferencePerformed': False,
             'files': [{'src': f'/practice-media/first-three/{p.name}', 'sha256': digest(p), 'bytes': p.stat().st_size} for p in sorted(OUT.iterdir()) if p.is_file()]}
    (REVIEW / 'source-preparation.json').write_text(json.dumps(audit, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    capture.release()
    if digest(SOURCE) != source_sha or digest(existing_clip) != existing_clip_sha or digest(existing_poses) != pose_bytes_sha:
        raise RuntimeError('A protected source checksum changed during preparation.')
    print('Prepared first-30-second excerpt, byte-identical opening, three cuts, six source screenshots, and unchanged real pose copies.', flush=True)
    print(OUT / 'manifest.json', flush=True)


if __name__ == '__main__':
    main()
