"""Review the next three small movements from the unchanged user-supplied 24.mp4."""
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
OUT = ROOT / 'public/practice-media/next-three'
REVIEW = ROOT / 'artifacts/next-three-review'
JOINTS = [15, 16, 27, 28]
TORSO = [11, 12, 23, 24]
STEPS = [
    {'id': 'first-six-04', 'title': 'Turn and open the hands', 'cue': 'Turn with the teacher and open both hands along the demonstrated paths.', 'sourceStartSeconds': 13.3, 'sourceEndSeconds': 14.5, 'focusJoints': [15, 16], 'motion': 'open'},
    {'id': 'first-six-05', 'title': 'Circle and gather the hands', 'cue': 'Circle both hands into the demonstrated high-and-low preparation.', 'sourceStartSeconds': 14.5, 'sourceEndSeconds': 15.5, 'focusJoints': [15, 16], 'motion': 'circle'},
    {'id': 'first-six-06', 'title': 'Lift and extend the left heel', 'cue': 'Lift your left foot and extend the heel forward with the teacher.', 'sourceStartSeconds': 15.5, 'sourceEndSeconds': 17.5, 'focusJoints': [27], 'motion': 'left-heel'},
]


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def contact_sheet(capture):
    times = [13 + index / 2 for index in range(17)]
    sheet = Image.new('RGB', (1600, 344 * 5), '#ffffff')
    draw = ImageDraw.Draw(sheet)
    for index, seconds in enumerate(times):
        capture.set(cv2.CAP_PROP_POS_FRAMES, round(seconds * 30))
        ok, frame = capture.read()
        if not ok:
            raise RuntimeError(f'Cannot read source frame at {seconds:.3f}s')
        image = Image.fromarray(cv2.cvtColor(frame[:, 50:500], cv2.COLOR_BGR2RGB))
        image.thumbnail((400, 320))
        x, y = index % 4 * 400, index // 4 * 344
        sheet.paste(image, (x + (400 - image.width) // 2, y))
        draw.text((x + 8, y + 324), f'24.mp4 | source {seconds:.3f}s', fill='#111111')
    output = REVIEW / 'source-continuation-contact.jpg'
    sheet.save(output, quality=95)
    print(output, flush=True)


def encode(capture, output, first, last):
    temporary = output.with_suffix('.preparing.mp4')
    container = av.open(str(temporary), mode='w', options={'movflags': '+faststart'})
    stream = container.add_stream('libx264', rate=30)
    stream.width, stream.height = 450, 360
    stream.pix_fmt = 'yuv420p'
    stream.options = {'crf': '19', 'preset': 'fast'}
    capture.set(cv2.CAP_PROP_POS_FRAMES, first)
    try:
        for index in range(last - first):
            ok, frame = capture.read()
            if not ok:
                raise RuntimeError(f'Cannot decode source frame {first + index}')
            video_frame = av.VideoFrame.from_ndarray(frame[:, 50:500], format='bgr24')
            video_frame.pts = index
            for packet in stream.encode(video_frame):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)
    finally:
        container.close()
    temporary.replace(output)


def screenshot(capture, frame_index, output):
    capture.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
    ok, frame = capture.read()
    if not ok or not cv2.imwrite(str(output), frame[:, 50:500], [cv2.IMWRITE_JPEG_QUALITY, 96]):
        raise RuntimeError(f'Cannot create source screenshot {output.name}')


def visible(point):
    return point is not None and point['visibility'] >= 0.65 and 0 <= point['x'] <= 1 and 0 <= point['y'] <= 1


def normalized(sample, index):
    points = {p['index']: p for p in sample['landmarks']}
    if not all(visible(points.get(joint)) for joint in TORSO + [index]):
        return None
    hip = ((points[23]['x'] + points[24]['x']) * 1.25 / 2, (points[23]['y'] + points[24]['y']) / 2)
    shoulder = ((points[11]['x'] + points[12]['x']) * 1.25 / 2, (points[11]['y'] + points[12]['y']) / 2)
    scale = ((shoulder[0] - hip[0]) ** 2 + (shoulder[1] - hip[1]) ** 2) ** 0.5
    if scale < 0.025:
        return None
    point = points[index]
    return ((point['x'] * 1.25 - hip[0]) / scale, (point['y'] - hip[1]) / scale)


def endpoint(samples, index):
    valid = [(sample, normalized(sample, index)) for sample in samples]
    valid = [(sample, point) for sample, point in valid if point is not None]
    if len(valid) < 2:
        return {'valid': False, 'trustedSupportCount': len(valid), 'observationCount': len(samples), 'selected': None}
    selected, position = min(valid, key=lambda pair: sum(((pair[1][0] - other[1][0]) ** 2 + (pair[1][1] - other[1][1]) ** 2) ** 0.5 for other in valid))
    point = next(p for p in selected['landmarks'] if p['index'] == index)
    return {'valid': True, 'trustedSupportCount': len(valid), 'observationCount': len(samples),
            'selected': {'sourceTimeSeconds': selected['sourceTimeSeconds'], 'originalObservationSrc': selected['originalObservationSrc'],
                         'sourceClipTimeMs': selected['sourceClipTimeMs'], 'point': point, 'bodyNormalized': {'x': position[0], 'y': position[1]}},
            'supportSourceTimes': [sample['sourceTimeSeconds'] for sample, _ in valid]}


def audit_step(step, observations):
    start, end = step['sourceStartSeconds'], step['sourceEndSeconds']
    samples = [sample for sample in observations if start <= sample['sourceTimeSeconds'] < end]
    joints = []
    for index in JOINTS:
        points = [next((p for p in sample['landmarks'] if p['index'] == index), None) for sample in samples]
        start_window = [s for s in samples if s['sourceTimeSeconds'] < start + 0.25]
        end_window = [s for s in samples if s['sourceTimeSeconds'] >= end - 0.25]
        joints.append({'index': index, 'required': index in step['focusJoints'], 'visibleCount': sum(visible(p) for p in points),
                       'sampleCount': len(samples), 'visibilityCoverage': sum(visible(p) for p in points) / max(1, len(samples)),
                       'minimumVisibility': min(p['visibility'] for p in points if p), 'maximumVisibility': max(p['visibility'] for p in points if p),
                       'startEndpoint': endpoint(start_window, index), 'endEndpoint': endpoint(end_window, index)})
    valid_reference = all(joint['startEndpoint']['valid'] and joint['endEndpoint']['valid'] for joint in joints if joint['required'])
    return {**step, 'sampleCount': len(samples), 'torsoVisibleCount': sum(all(visible(next((p for p in sample['landmarks'] if p['index'] == i), None)) for i in TORSO) for sample in samples),
            'allFourPointAudit': joints, 'referenceEndpointsUsable': valid_reference,
            'note': 'Named required anatomical joints are selected from the demonstrated movement, not from which joint is easiest to track. Missing endpoints remain unknown.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--review-only', action='store_true')
    args = parser.parse_args()
    REVIEW.mkdir(parents=True, exist_ok=True)
    source_sha = digest(SOURCE)
    observations, provenance, originals = [], [], {}
    for identifier in ['24-01', '24-02']:
        meta = json.loads((ROOT / f'public/practice-media/{identifier}.json').read_text('utf8'))
        poses = json.loads((ROOT / f'public/practice-media/{identifier}.poses.json').read_text('utf8'))
        encoded_sha = digest(ROOT / f'public/practice-media/{identifier}.mp4')
        if meta['sourceSha256'] != source_sha or encoded_sha != meta['sha256'] or encoded_sha != poses['sourceClipSha256']:
            raise RuntimeError(f'Cannot reuse {identifier}: the source/clip/observation checksums disagree.')
        originals[identifier] = {'meta': meta, 'poses': poses, 'sha256': encoded_sha}
        provenance.append({'clipId': identifier, 'originalObservationSrc': f'/practice-media/{identifier}.poses.json',
                           'originalObservationSha256': digest(ROOT / f'public/practice-media/{identifier}.poses.json'),
                           'sourceClipSha256': encoded_sha, 'sourceSha256': source_sha,
                           'sourceStartSeconds': meta['startSeconds'], 'sourceEndSeconds': meta['endSeconds'], 'modelSha256': poses['modelSha256']})
        for sample in poses['samples']:
            source_time = meta['startSeconds'] + sample['tMs'] / 1000
            if 13 <= source_time < 21.1:
                observations.append({**sample, 'sourceTimeSeconds': source_time, 'sourceClipTimeMs': sample['tMs'],
                                     'originalObservationSrc': f'/practice-media/{identifier}.poses.json', 'sourceClipSha256': encoded_sha})
    capture = cv2.VideoCapture(str(SOURCE))
    if capture.get(cv2.CAP_PROP_FPS) != 30 or capture.get(cv2.CAP_PROP_FRAME_WIDTH) != 640 or capture.get(cv2.CAP_PROP_FRAME_HEIGHT) != 360:
        raise RuntimeError('Unexpected source video dimensions or frame rate.')
    contact_sheet(capture)
    print(f'Confirmed actual supplied 24.mp4 SHA256 {source_sha} and both existing encoded-clip observation hashes.', flush=True)
    audit = {'schemaVersion': 'next-three-source-audit-v1', 'sourceSha256': source_sha, 'provenance': provenance,
             'sourceReview': 'Final teaching boundaries:13.3-14.5s turn and open both hands;14.5-15.5s circle and gather both hands;15.5-17.5s lift and extend the anatomical left heel. Later bow-stance hand separation is deferred because its left-wrist start is occluded.',
             'qualityRules': {'visibilityThreshold': 0.65, 'endpointWindowSeconds': 0.25, 'minimumEndpointActualObservations': 2,
                              'torsoAnchors': TORSO, 'noCoordinateInterpolation': True},
             'steps': [audit_step(step, observations) for step in STEPS],
             'originalObservationsChanged': False, 'newInferencePerformed': False,
             'editorialJoinGap': {'sourceStartSeconds': 13.0, 'sourceEndSeconds': 13.3, 'reason': 'The original three steps end at13.0s. The next step begins at the exact13.3s boundary of the matching24-02 encoded inference clip. The0.3s editorial join is omitted, not interpolated.'},
             'risks': ['The left wrist is occluded in profile around16.3-18.2s. The left-heel step semantically requires ankle27; its optional wrist15 guide remains unknown when hidden. The later two-hand bow-stance step is deferred rather than assigning it to the easier wrist.',
                       'Designed straight game guides cannot claim to reproduce the full circular arm path or measure weight transfer.',
                       '13.0-13.3s was reviewed from24-01 observations but is deliberately omitted from teaching. The new three steps use only24-02 observations. Each original encoded inference clip SHA is retained.']}
    (REVIEW / 'source-continuation-audit.json').write_text(json.dumps(audit, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    if args.review_only:
        capture.release()
        return
    OUT.mkdir(parents=True, exist_ok=True)
    base = json.loads((ROOT / 'public/practice-media/first-three/manifest.json').read_text('utf8'))
    parting = originals['24-02']
    shutil.copyfile(ROOT / 'public/practice-media/24-02.mp4', OUT / 'parting.mp4')
    poses = parting['poses']
    copied_samples = []
    for sample in poses['samples']:
        frame = min(round(sample['tMs'] / 1000 * 30), round(poses['durationMs'] / 1000 * 30) - 1)
        copied_samples.append({**sample, 'sourceTimeSeconds': 13.3 + sample['tMs'] / 1000,
                               'frameIndex': frame, 'sourceFrameIndex': frame + 399})
    pose_data = {'schemaVersion': 'first-three-recorded-pose-v1', 'view': 'front', 'formNumber': 2, 'fps': 30,
                 'width': 450, 'height': 360, 'sampleRateHz': poses['sampleRateHz'], 'durationMs': poses['durationMs'],
                 'sourceSha256': source_sha, 'sourceClipSha256': parting['sha256'], 'modelSha256': poses['modelSha256'],
                 'originalObservationSrc': '/practice-media/24-02.poses.json',
                 'originalObservationSha256': digest(ROOT / 'public/practice-media/24-02.poses.json'),
                 'sourceStartSeconds': 13.3, 'sourceEndSeconds': 37.7,
                 'frameIndexPrecision': 'Estimated from recorded presentation timestamps; original cached observations do not carry exact decoded frame IDs.',
                 'timeMapping': 'sample.tMs is unchanged and relative to the byte-identical parting.mp4; sourceTimeSeconds =13.3+tMs/1000.',
                 'provenance': poses['provenance'] + ' All original observations copied exactly, with timestamp provenance added; no interpolation or new inference.',
                 'samples': copied_samples}
    (OUT / 'parting.poses.json').write_text(json.dumps(pose_data, separators=(',', ':')) + '\n', encoding='utf8')
    new_steps = []
    for number, step in enumerate(STEPS, start=4):
        start, end = step['sourceStartSeconds'], step['sourceEndSeconds']
        first, last = round(start * 30), round(end * 30)
        clip, start_image, end_image = f'step-{number:02}.mp4', f'step-{number:02}-start.jpg', f'step-{number:02}-end.jpg'
        encode(capture, OUT / clip, first, last)
        screenshot(capture, first, OUT / start_image)
        screenshot(capture, last - 1, OUT / end_image)
        quality = audit_step(step, observations)
        new_steps.append({**step, 'sourceId': 'parting', 'startSeconds': round(start - 13.3, 6), 'endSeconds': round(end - 13.3, 6),
                          'sourceStartFrame': first, 'sourceEndFrameExclusive': last, 'durationSeconds': round(end - start, 6),
                          'referenceVisibilityThreshold': 0.65,
                          'screenshots': {'start': f'/practice-media/next-three/{start_image}', 'end': f'/practice-media/next-three/{end_image}'},
                          'screenshotSourceTimes': {'start': first / 30, 'end': (last - 1) / 30},
                          'clipSrc': f'/practice-media/next-three/{clip}', 'clipSha256': digest(OUT / clip),
                          'clipProvenance': 'Optional demonstration cut freshly encoded from original24.mp4. Player uses the byte-identical parting.mp4; real pose observations belong to that original encoded inference clip, not this new demonstration cut.',
                          'quality': quality,
                          'boundaryEvidence': 'Original source half-second contact-sheet review and actual source start/end screenshots. Editorial transition precision approximately0.5seconds.'})
    video = {'src': '/practice-media/next-three/parting.mp4', 'width': 450, 'height': 360, 'fps': 30,
             'durationSeconds': 24.4, 'sha256': parting['sha256'], 'sourceStartSeconds': 13.3, 'sourceEndSeconds': 37.7,
             'sourceCropPixels': {'x': 50, 'y': 0, 'width': 450, 'height': 360},
             'provenance': 'Byte-for-byte copy of the existing24-02.mp4 inference clip. Only the first4.2seconds are used by the new three-step continuation.'}
    manifest = {'schemaVersion': 'first-six-teaching-v1', 'title': 'First six movements', 'source': base['source'],
                'sources': [{'id': 'opening', 'video': base['video'], 'poseSrc': base['poseSrc'], 'displayCrop': base['displayCrop'], 'observationVisibilityThreshold': 0.45},
                            {'id': 'parting', 'video': video, 'poseSrc': '/practice-media/next-three/parting.poses.json',
                             'displayCrop': {'x': 0.22, 'y': 0.12, 'width': 0.64, 'height': 0.86}, 'observationVisibilityThreshold': 0.65}],
                'steps': [{**step, 'sourceId': 'opening'} for step in base['steps']] + new_steps,
                'editorialJoinGap': audit['editorialJoinGap'], 'orientation': base['orientation'],
                'rules': {'stepCount': 6, 'sourceTeachingEndSeconds': 17.5,
                          'observationSampling': 'Real recorded12Hz MediaPipe observations from two independently inferred original encoded clips. No frame interpolation, joint substitutions, or re-inference.',
                          'scope': 'Three approved opening movements plus three conservative continuation microsteps. The later bow-stance hand separation is intentionally deferred because the recorded left-wrist start is occluded.'}}
    (OUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    preparation = {**audit, 'schemaVersion': 'next-three-source-preparation-v1', 'selectedSteps': new_steps,
                   'partingClipSha256': digest(OUT / 'parting.mp4'), 'partingObservationCount': len(copied_samples),
                   'sourceDataUnchanged': True, 'firstThreeAssetsUnchanged': True,
                   'files': [{'src': f'/practice-media/next-three/{p.name}', 'sha256': digest(p), 'bytes': p.stat().st_size} for p in sorted(OUT.iterdir()) if p.is_file()]}
    (REVIEW / 'source-preparation.json').write_text(json.dumps(preparation, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    capture.release()
    if digest(SOURCE) != source_sha or digest(ROOT / 'public/practice-media/24-02.mp4') != parting['sha256']:
        raise RuntimeError('A protected source checksum changed while preparing new assets.')
    print(f'Prepared next-three assets: byte-identical parting clip, all{len(copied_samples)} real observations,3demonstration cuts,6source screenshots,6-step manifest.', flush=True)
    print(OUT / 'manifest.json', flush=True)


if __name__ == '__main__':
    main()
