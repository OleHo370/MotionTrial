"""Prepare the user's 24b.mp4 as manually reviewed natural-duration forms.

This source has no form captions. The standard 24-form sequence was identified
from the actual movements in one-second decoded contact sheets. Cut instants are
editorial continuous-motion transitions, approximately 0.5-second precision.
Original files, existing 24.mp4 clips and the active playlist are never replaced.
"""
from pathlib import Path
import argparse
import hashlib
import importlib.util
import json
import av
import cv2
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public' / 'practice-media'
REVIEW = ROOT / 'artifacts' / 'source-24b-review'
FPS = 30
WIDTH, HEIGHT = 640, 360
SOURCE_SHA256 = '0df0f0cf436a94385e20157e647aba7624b0a625407bd605d33b6a578f40cc22'
STARTS = [5.0, 14.5, 38.0, 44.5, 66.8, 72.3, 91.7, 109.3,
          129.5, 139.5, 157.2, 164.0, 168.5, 178.5, 182.5, 191.5,
          203.5, 217.5, 233.5, 238.5, 242.5, 254.3, 259.5, 267.5]
END = 274.0
EVIDENCE = [
    'Retain standing preparation immediately before the left foot lifts and opens the stance.',
    'The opening hand press resolves; the torso begins turning to gather the first parting step.',
    'The third wild-horse parting is complete; the rear foot starts gathering for crane.',
    'The crane posture settles; the rear arm begins circling for the first brush-knee step.',
    'The third brush-knee push finishes; the rear foot gathers and weight shifts back for lute.',
    'The lute posture is established; the rear arm starts opening for the first backward step.',
    'The final backward push resolves; the torso turns and the hands gather for left ward-off.',
    'The left push resolves; the weight shifts back and the torso starts turning toward the right sequence.',
    'The right push resolves; the hands and torso start the turn toward single whip.',
    'Single-whip extension settles; weight starts moving laterally and the front hand begins its cloud arc.',
    'The final cloud-hand gathering step resolves; the arms begin forming the second single whip.',
    'The second single-whip stance settles; the rear foot gathers for high pat.',
    'The high-pat reach resolves; the hands cross and start lifting for the right kick.',
    'The right heel starts retracting; the arms gather downward for the paired-fist step.',
    'The paired-fist strike finishes; the hands open as the body begins the turn for the left kick.',
    'The left heel has retracted; the raised leg starts lowering toward the first low sweeping stance.',
    'The first golden-rooster balance settles; the raised leg lowers and hands turn for the opposite low stance.',
    'The second golden-rooster balance settles; the raised foot begins the first diagonal shuttle step.',
    'The second shuttle push resolves; the rear foot gathers and the body starts lowering for needle.',
    'The needle reach reaches its low point; the body begins rising and the arms separate for fan.',
    'The fan-through-back extension resolves; the torso and rear hand begin the turn for deflection.',
    'The final punch resolves; the open hand begins travelling beneath the punching forearm.',
    'The forward press resolves; the torso turns to the front and both arms open for cross hands.',
    'The crossed-hand posture settles; the wrists uncross and start lowering for closing.',
]
# Named forms/descriptions use the same standard order as the retained source,
# while cut times, source properties, full-frame pixels and inference are new.
spec = importlib.util.spec_from_file_location('retained_24_metadata', ROOT / 'scripts' / 'prepare-24.py')
original = importlib.util.module_from_spec(spec)
spec.loader.exec_module(original)
# Source-specific visible principal chains, audited with actual recorded-frame
# inference. Hidden limbs are unknown, never zero or fabricated. All 12 actual
# joint observations remain available to render the reference skeleton.
FOCUS = {
    1: [15, 16, 27, 28], 2: [16, 27, 28], 3: [16, 27, 28],
    4: [16, 27, 28], 5: [16, 28], 6: [16, 27, 28], 7: [16, 27, 28],
    8: [15, 27, 28], 9: [15, 16, 27, 28], 10: [15, 16, 27, 28],
    11: [16, 27, 28], 12: [16, 27, 28], 13: [28], 14: [16, 27, 28],
    15: [27], 16: [15, 27], 17: [15, 27, 28], 18: [15, 27, 28],
    19: [15, 27], 20: [15, 27], 21: [16, 27, 28], 22: [16],
    23: [15, 16, 27, 28], 24: [15, 16, 27, 28],
}
TRACKING_NOTES = {
    1: 'Both wrists and both ankles supply observed arm-lift, hand-lowering and stance evidence. Pose does not measure palm or finger orientation.',
    2: 'The right wrist and both ankles are observed. The far left wrist is frequently occluded and is not independently assessed.',
    3: 'The right wrist and both ankles are the visible focus; the far left wrist is occluded. Left-leg observations are intermittent and missing frames remain unknown.',
    4: 'The visible right wrist and both stepping ankles are assessed. The far left arm is frequently hidden and cannot be independently verified.',
    5: 'The right wrist and right ankle are observed. The left wrist and left leg chain are frequently hidden in this side/back view.',
    6: 'The visible right wrist and both backward-stepping ankles supply evidence. The far left wrist is frequently hidden; body travel and exact backward direction are not reliably measured by this body-centred matcher.',
    7: 'The right wrist and both ankles are observed through the left sequence. The far left wrist is occluded and is not independently assessed.',
    8: 'The left wrist and both ankles are observed through the right sequence. The far right wrist is frequently hidden and is not independently assessed.',
    9: 'Both wrists and both ankles are observed. Pose does not verify the hooked-hand shape, palm orientation or fingers.',
    10: 'Both wrists and both lateral-stepping ankles are observed through the repeated cloud-hand cycles. Finger and palm details are not measured.',
    11: 'The visible right wrist and both ankles are assessed; the far left wrist is frequently occluded. Pose does not verify the hooked-hand shape.',
    12: 'The right wrist and both ankles are observed in this rear/side view. The far left wrist is hidden and is not independently assessed.',
    13: 'The right kicking ankle is the reliable principal focus. Far-arm visibility and the supporting-leg chain are intermittent; hand shapes are not independently assessed.',
    14: 'The right wrist and both ankles supply visible step-and-strike evidence. The left fist is hidden, so paired-fist symmetry and fist shape cannot be verified.',
    15: 'The left kicking ankle is the reliable principal focus after the turn. Both wrist chains are frequently occluded and are not independently assessed.',
    16: 'The visible left wrist and left ankle are assessed through lowering and rising. The opposite wrist and right leg chain are frequently hidden in the low stance.',
    17: 'The left wrist and both ankles are observed through the second low stance and balance. The right wrist lacks consistent phase tracking and is not independently assessed.',
    18: 'The left wrist and both diagonal-stepping ankles supply evidence. The right wrist is frequently hidden; right-ankle observations are intermittent.',
    19: 'The visible left wrist and left ankle are assessed through the low reach. The opposite wrist and right leg chain are frequently hidden.',
    20: 'The visible left wrist and left ankle are assessed while rising. The opposite wrist and right leg chain are intermittent and are not independently assessed.',
    21: 'The visible right wrist and both ankles are assessed through the turn and punch. The far left wrist is frequently hidden; fist shape is not measured.',
    22: 'The visible right wrist supplies the principal hand-sequence evidence. The left wrist overlaps or is hidden and cannot be independently verified.',
    23: 'Both wrists and both ankles supply observed turning, gathering and crossed-hand evidence. Pose does not measure palm orientation.',
    24: 'Both wrists and both ankles supply observed hand-lowering and feet-gathering evidence. The closing salute after the routine is excluded.',
}


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as file:
        for block in iter(lambda: file.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=ROOT.parents[1] / '24b.mp4')
    parser.add_argument('--metadata-only', action='store_true')
    args = parser.parse_args()
    source = args.source.resolve()
    OUT.mkdir(parents=True, exist_ok=True)
    REVIEW.mkdir(parents=True, exist_ok=True)
    source_hash = digest(source)
    if source_hash != SOURCE_SHA256:
        raise RuntimeError('24b.mp4 differs from the visually audited source.')
    capture = cv2.VideoCapture(str(source))
    properties = (capture.get(cv2.CAP_PROP_FPS), int(capture.get(cv2.CAP_PROP_FRAME_COUNT)),
                  int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)), int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT)))
    if properties != (FPS, 8342, WIDTH, HEIGHT):
        raise RuntimeError(f'Unexpected source properties: {properties}')
    cuts = [round(time * FPS) for time in STARTS + [END]]
    manifests, rows = [], []
    for index in range(24):
        number = index + 1
        start_frame, end_frame = cuts[index:index + 2]
        frame_count = end_frame - start_frame
        identifier = f'24b-{number:02}'
        destination = OUT / f'{identifier}.mp4'
        if not args.metadata_only:
            temporary = OUT / f'{identifier}.preparing.mp4'
            output = av.open(str(temporary), mode='w', options={'movflags': '+faststart'})
            stream = output.add_stream('libx264', rate=FPS)
            stream.width, stream.height = WIDTH, HEIGHT
            stream.pix_fmt = 'yuv420p'
            stream.options = {'crf': '19', 'preset': 'fast'}
            capture.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
            try:
                for frame_index in range(frame_count):
                    ok, frame = capture.read()
                    if not ok:
                        raise RuntimeError(f'Cannot decode source frame {start_frame + frame_index}')
                    video_frame = av.VideoFrame.from_ndarray(frame, format='bgr24')
                    video_frame.pts = frame_index
                    for packet in stream.encode(video_frame):
                        output.mux(packet)
                for packet in stream.encode():
                    output.mux(packet)
            finally:
                output.close()
            temporary.replace(destination)
        check = cv2.VideoCapture(str(destination))
        encoded = (int(check.get(cv2.CAP_PROP_FRAME_COUNT)), check.get(cv2.CAP_PROP_FPS),
                   int(check.get(cv2.CAP_PROP_FRAME_WIDTH)), int(check.get(cv2.CAP_PROP_FRAME_HEIGHT)))
        # Decode every output frame so container metadata alone cannot pass QA.
        decoded = 0
        while True:
            ok, _ = check.read()
            if not ok:
                break
            decoded += 1
        check.release()
        if encoded != (frame_count, FPS, WIDTH, HEIGHT) or decoded != frame_count:
            raise RuntimeError(f'Invalid clip {identifier}: {encoded}, decoded {decoded}')
        _, chinese, title, description, _, _ = original.FORMS[index]
        start, end = start_frame / FPS, end_frame / FPS
        manifest = {
            'id': identifier, 'src': f'/practice-media/{identifier}.mp4',
            'referencePoseSrc': f'/practice-media/{identifier}.poses.json',
            'title': title, 'description': description, 'formNumber': number, 'chineseTitle': chinese,
            'sourceFile': source.name, 'sourceDurationSeconds': 8342 / FPS,
            'startSeconds': start, 'endSeconds': end, 'startFrame': start_frame,
            'endFrameExclusive': end_frame, 'durationSeconds': frame_count / FPS,
            'sourcePlaybackRate': 1, 'sourceSegmentSeconds': frame_count / FPS,
            'crop': {'x': 0, 'y': 0, 'width': WIDTH, 'height': HEIGHT},
            'width': WIDTH, 'height': HEIGHT, 'fps': FPS, 'focusJoints': FOCUS[number],
            'trackingNotes': TRACKING_NOTES[number],
            'selectionReason': EVIDENCE[index],
            'boundaryEvidence': 'Actual one-second source frames manually reviewed in standard 24-form order. This recording has no form captions.',
            'boundaryPrecision': 'Editorial continuous-motion transition, approximately 0.5 seconds; exact encoding frames retained.',
            'provenance': 'User-provided 24b.mp4, one instructor, full original frame. Recorded reference observations use actual local MediaPipe inference, never live camera data.',
            'audio': False, 'codec': 'h264', 'pixelFormat': 'yuv420p',
            'sourceSha256': source_hash, 'sha256': digest(destination), 'bytes': destination.stat().st_size,
        }
        (OUT / f'{identifier}.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        manifests.append(manifest)
        rows.append({**manifest, 'decodedFrames': decoded})
        print(f'{identifier}: {start:.3f}-{end:.3f}s, {frame_count} fully decoded frames', flush=True)
    for page in range(3):
        group = rows[page * 8:(page + 1) * 8]
        sheet = Image.new('RGB', (3 * 480, len(group) * 294), 'white')
        draw = ImageDraw.Draw(sheet)
        for row_index, row in enumerate(group):
            for column, offset in enumerate([-0.5, 0, 0.5]):
                t = row['startSeconds'] + offset
                capture.set(cv2.CAP_PROP_POS_FRAMES, round(t * FPS))
                ok, frame = capture.read()
                if not ok:
                    raise RuntimeError(f'Cannot decode cut context at {t}s')
                x, y = column * 480, row_index * 294
                sheet.paste(Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)).resize((480, 270)), (x, y))
                draw.text((x + 4, y + 273), f'{row["id"]} {t:.3f}s ({offset:+.1f}s)', fill='black')
        sheet.save(REVIEW / f'boundaries-{page + 1:02}.jpg', quality=95)
    capture.release()
    playlist = {
        'id': 'tai-chi-24b-v1', 'title': '24-Form Tai Chi · 24b',
        'description': 'Single-instructor indoor routine, original speed, full frame, individually reviewed movement transitions.',
        'provenance': 'Standard 24-form sequence visually identified from user-provided 24b.mp4. No source captions; boundaries are editorial with approximately 0.5-second precision.',
        'sourceFile': source.name, 'sourceSha256': source_hash, 'clips': manifests,
    }
    (OUT / '24b-playlist.json').write_text(json.dumps(playlist, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    audit = {'sourceFile': source.name, 'sourceSha256': source_hash, 'sourceFrames': 8342,
             'sourceDimensions': [WIDTH, HEIGHT], 'sourceFps': FPS, 'sourceDurationSeconds': 8342 / FPS,
             'boundaryPolicy': playlist['provenance'], 'cropPolicy': 'Full frame retains all moving-camera/full-body source context.',
             'excluded': [{'startSeconds': 0, 'endSeconds': STARTS[0], 'reason': 'Initial still standing.'},
                          {'startSeconds': END, 'endSeconds': 8342 / FPS, 'reason': 'Routine complete; closing salute and recording tail.'}],
             'forms': rows, 'retainedFrames': sum(row['decodedFrames'] for row in rows),
             'retainedSeconds': END - STARTS[0], 'allClipsFullyDecoded': True}
    (REVIEW / 'validation.json').write_text(json.dumps(audit, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    lines = ['# 24b.mp4 semantic boundary review', '', playlist['provenance'], '',
             'Source: 640 x 360, 30 fps, 8342 frames, 278.066667 seconds. Full original frame retained.',
             'All 24 clips are contiguous between 5.0 and 274.0 seconds, at original speed; every output frame decoded successfully.',
             'The initial still standing and final salute are excluded. Original files and retained playlists are preserved.', '',
             '| Form | Chinese title | Source start (s) | Source end (s) | Duration (s) | Entry evidence |',
             '| --- | --- | ---: | ---: | ---: | --- |']
    for row in rows:
        lines.append(f'| {row["formNumber"]:02} | {row["chineseTitle"]} | {row["startSeconds"]:.3f} | {row["endSeconds"]:.3f} | {row["durationSeconds"]:.3f} | {row["selectionReason"]} |')
    lines.extend(['', 'Contact sheets: seconds-01.jpg through seconds-09.jpg show source frames every second; boundaries-01.jpg through boundaries-03.jpg show -0.5 / at / +0.5 seconds around each cut.', '',
                  'A continuous routine has no hard stops between forms. These boundaries are reviewable editorial judgments; this is not an expert-certified biomechanics segmentation.', ''])
    (REVIEW / 'BOUNDARIES.md').write_text('\n'.join(lines), encoding='utf-8')
    if digest(source) != source_hash:
        raise RuntimeError('Source changed while processing.')
    print('24b: all 24 original-speed clips fully decoded; original source checksum unchanged.', flush=True)


if __name__ == '__main__':
    main()
