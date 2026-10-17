"""Prepare four verified opening stages without changing either source MP4."""
from pathlib import Path
import argparse
import hashlib
import json
import cv2

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description='Prepare four local practice stages; source videos are read only.')
parser.add_argument('--source', type=Path, default=ROOT.parents[1] / '太极拳最简入门_起势示范节选.mp4')
parser.add_argument('--long-source', type=Path, default=ROOT.parents[1] / '太极拳入门_起势完整教学_5分17秒.mp4')
parser.add_argument('--activate', action='store_true', help='Also replace the legacy active playlist; normally only rebuild the opening library entry.')
arguments = parser.parse_args()
OUT = ROOT / 'public/practice-media'
OUT.mkdir(parents=True, exist_ok=True)


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def prepare(identifier, source, expected_size, start, end, crop, title, description, selection):
    source = source.resolve()
    capture = cv2.VideoCapture(str(source))
    if not capture.isOpened():
        raise RuntimeError(f'Cannot decode {source.name}')
    fps = capture.get(cv2.CAP_PROP_FPS)
    source_size = (int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)), int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT)))
    source_duration = capture.get(cv2.CAP_PROP_FRAME_COUNT) / fps if fps > 0 else 0
    if source_size != expected_size or source_duration < end:
        capture.release()
        raise RuntimeError(f'Unexpected source dimensions/duration for {source.name}')
    destination = OUT / f'{identifier}.webm'
    temporary = OUT / f'{identifier}.preparing.webm'
    writer = cv2.VideoWriter(str(temporary), cv2.VideoWriter_fourcc(*'VP80'), 30, (520, 660))
    if not writer.isOpened():
        capture.release()
        raise RuntimeError('This OpenCV installation needs a VP8 encoder.')
    x, y, width, height = crop
    try:
        next_source_frame = round(start * fps)
        capture.set(cv2.CAP_PROP_POS_FRAMES, next_source_frame)
        decoded_frame_number = next_source_frame - 1
        frame = None
        for frame_number in range(120):
            source_frame = round((start + frame_number / 120 * (end - start)) * fps)
            while decoded_frame_number < source_frame:
                ok, frame = capture.read()
                decoded_frame_number += 1
                if not ok:
                    raise RuntimeError(f'Cannot decode frame {source_frame} from {source.name}')
            writer.write(cv2.resize(frame[y:y + height, x:x + width], (520, 660), interpolation=cv2.INTER_CUBIC))
    finally:
        capture.release()
        writer.release()
    check = cv2.VideoCapture(str(temporary))
    actual_fps = check.get(cv2.CAP_PROP_FPS)
    actual_duration = check.get(cv2.CAP_PROP_FRAME_COUNT) / actual_fps if actual_fps else 0
    check.release()
    if abs(actual_duration - 4.0) > 0.05:
        raise RuntimeError(f'Unexpected encoded duration: {actual_duration}')
    temporary.replace(destination)
    manifest = {
        'id': identifier, 'src': f'/practice-media/{identifier}.webm', 'referencePoseSrc': f'/practice-media/{identifier}.poses.json', 'title': title,
        'description': description, 'sourceFile': source.name, 'sourceDurationSeconds': source_duration,
        'startSeconds': start, 'endSeconds': end, 'durationSeconds': actual_duration,
        'sourcePlaybackRate': (end - start) / actual_duration, 'sourceSegmentSeconds': end - start,
        'crop': {'x': x, 'y': y, 'width': width, 'height': height}, 'width': 520, 'height': 660,
        'selectionReason': selection,
        'focusJoints': [27] if identifier in ['action-02', 'action-03'] else [15, 16],
        'provenance': 'User-provided prerecorded instructor video; actual MediaPipe reference inference runs in the browser.',
        'audio': False, 'opencvVersion': cv2.__version__, 'sourceSha256': digest(source),
        'sha256': digest(destination),
    }
    (OUT / f'{identifier}.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: manifest[key] for key in ['id', 'title', 'startSeconds', 'endSeconds', 'durationSeconds', 'sha256']}, ensure_ascii=True), flush=True)
    return manifest


# Preserve the exact already-approved arm clip rather than re-encoding it.
original_video = OUT / 'action-01.webm'
original_metadata = OUT / 'action-01.json'
if original_video.exists() and original_metadata.exists():
    arms = json.loads(original_metadata.read_text(encoding='utf-8'))
    if digest(original_video) != arms['sha256']:
        raise RuntimeError('Existing approved arm clip does not match its recorded checksum; preserving it for inspection.')
else:
    arms = prepare('action-01', arguments.source, (1122, 540), 6.5, 8.5, (430, 130, 260, 330),
        'Lift both arms forward', 'Begin in the open stance with arms lowered, then lift both arms forward.',
        'The previously approved bilateral arm-lifting transition, isolated to the central instructor at half source speed.')

arms = {**arms, 'referencePoseSrc': '/practice-media/action-01.poses.json', 'focusJoints': [15, 16], 'description': 'Begin in the open stance with arms lowered. Lift both arms forward with the instructor.'}
(OUT / 'action-01.json').write_text(json.dumps(arms, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
foot = prepare('action-02', arguments.long_source, (2244, 1080), 82, 85, (760, 140, 700, 888),
    'Lift the left foot', 'Begin with feet together. Follow the instructor as the left foot lifts and begins to move outward.',
    'The visible left-foot lifting phase immediately before the step opens; full-body frontal view.')
step = prepare('action-03', arguments.long_source, (2244, 1080), 85, 96, (760, 140, 700, 888),
    'Step out to the left', 'Begin with your left foot lifted as shown. Lower it to the side and settle into the open stance.',
    'The consecutive outward foot placement and settling phase, ending before the arms rise.')
press = prepare('action-04', arguments.long_source, (2244, 1080), 114, 129, (760, 140, 700, 888),
    'Press both hands down', 'Begin with both arms raised. Follow both hands downward toward the waist while the knees soften.',
    'The complete visible hand-lowering phase. Palm orientation is not scored by the pose matcher.')
playlist = {
    'id': 'opening-sequence-v1', 'title': 'Four stages of the opening',
    'description': 'Lift the left foot, step into the open stance, lift both arms, then press both hands down.',
    'provenance': 'Four stages selected from the two user-provided recordings; not four different tai chi forms.',
    'clips': [foot, step, arms, press],
}
(OUT / 'opening-playlist.json').write_text(json.dumps(playlist, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
if arguments.activate:
    (OUT / 'playlist.json').write_text(json.dumps(playlist, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('Prepared playlist with four stages; original arm video and source MP4s preserved.', flush=True)

