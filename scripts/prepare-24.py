"""Prepare the 24 caption-identified forms at their reviewed movement transitions.

Reads the original MP4 without modifying it. All cuts use source frames at 30 fps;
each MP4 retains its source duration and speed. Boundary decisions are editorial
judgments in a continuous routine, not assertions of a physiologically exact instant.
"""
from pathlib import Path
import argparse
import hashlib
import json
import shutil
import av
import cv2
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public' / 'practice-media'
REVIEW = ROOT / 'artifacts' / 'source-24-review'
CROP = (50, 0, 450, 360)
FPS = 30

# Reviewed against the full-frame 1-second contact sheets and the adjacent
# movement frames. Captions identify forms but often appear after preparation.
FORMS = [
    (1.0, '起势', 'Opening', 'Step into the open stance, raise both arms, then lower both hands.', [15, 16, 27, 28], 'Start from the visible standing preparation after the title card.'),
    (13.3, '左右野马分鬃', "Part the Wild Horse's Mane", 'Follow all three alternating steps and arm separations.', [15, 16, 27, 28], 'The opening hand press finishes; the torso begins to turn and gather for the first parting step.'),
    (37.7, '白鹤亮翅', 'White Crane Spreads Its Wings', 'Gather the rear foot, transfer weight, and separate the arms into the crane posture.', [15, 16, 27, 28], 'The third parting stance is complete; the rear foot begins its gathering step.'),
    (43.7, '左右搂膝拗步', 'Brush Knee and Push', 'Follow the alternating brush-knee steps and forward pushes.', [15, 16, 27, 28], 'The crane posture settles; the raised arm begins to circle into the first brush-knee preparation.'),
    (70.0, '手挥琵琶', 'Play the Lute', 'Gather the stance, shift weight back, and bring both hands into the lute posture.', [15, 16, 27, 28], 'The last brush-knee push finishes; the rear foot begins the small gathering step.'),
    (75.5, '左右倒卷肱', 'Repulse Monkey', 'Follow the alternating backward steps and hand pushes.', [15, 16, 27, 28], 'The lute posture has formed; the rear arm begins to open for the first backward step.'),
    (98.0, '左揽雀尾', "Grasp the Bird's Tail - Left", 'Turn into the left sequence, then follow ward-off, rollback, press, and push.', [15, 16, 27, 28], 'The final backward push resolves; both arms begin to open and gather for the left sequence.'),
    (119.0, '右揽雀尾', "Grasp the Bird's Tail - Right", 'Turn into the right sequence, then follow ward-off, rollback, press, and push.', [15, 16, 27, 28], 'The left push finishes; the body begins the turn and arm opening toward the opposite side.'),
    (143.0, '单鞭', 'Single Whip', 'Turn, form the arm shape, step out, and finish the single-whip stance.', [15, 16, 27, 28], 'The right push has finished; the torso and hands begin to turn into single whip.'),
    (152.0, '云手', 'Wave Hands Like Clouds', 'Follow all of the lateral steps while both arms circle across the body.', [15, 16, 27, 28], 'The single-whip stance is complete; weight starts to shift and the front arm begins its cloud-hand circle.'),
    (170.3, '单鞭', 'Single Whip Again', 'Gather from cloud hands, step out, and finish another single-whip stance.', [15, 16, 27, 28], 'The final cloud-hands gathering step finishes; the hands begin to form the next single-whip preparation.'),
    (176.0, '高探马', 'High Pat on the Horse', 'Shift back from single whip, gather the foot, and reach forward with the upper hand.', [15, 16, 27, 28], 'The second single-whip push is complete; the rear foot begins to gather for high pat.'),
    (181.0, '右蹬脚', 'Right Heel Kick', 'Step through, gather the hands and right knee, then extend and recover the right heel kick.', [15, 16, 28], 'The high-pat reach is complete; the arms begin the crossing-and-lifting preparation for the kick.'),
    (190.8, '双峰贯耳', 'Twin Fists Strike the Ears', 'Recover the right knee, step down, and bring both fists forward together.', [15, 16, 28], 'The right heel retracts after the kick; the arms begin opening for the downward step and paired strike.'),
    (196.0, '转身左蹬脚', 'Turn and Left Heel Kick', 'Turn around, gather the left knee, then extend and recover the left heel kick.', [15, 16, 27], 'The paired-fist strike is complete; the hands open and the body begins its turning preparation.'),
    (204.7, '左下势独立', 'Left Snake Creeps Down and Golden Rooster', 'Lower into the left sweeping stance, rise, and finish balanced on one leg.', [15, 16, 27, 28], 'The left heel retracts; the arms gather and the leg starts lowering toward the low sweeping stance.'),
    (214.7, '右下势独立', 'Right Snake Creeps Down and Golden Rooster', 'Turn into the right sweeping stance, rise, and finish balanced on one leg.', [15, 16, 27, 28], 'The first one-leg posture is complete; the raised leg lowers and the hands turn toward the opposite low stance.'),
    (227.0, '左右穿梭', 'Work at Shuttles', 'Follow both diagonal steps, overhead arm arcs, and forward hand pushes.', [15, 16, 27, 28], 'The second one-leg posture is complete; the raised leg begins the diagonal step for shuttles.'),
    (241.5, '海底针', 'Needle at the Sea Bottom', 'Gather the rear foot, shift back, then lower the body and reach downward.', [15, 16, 27, 28], 'The second shuttle push is complete; the rear foot gathers and the body begins to turn and lower.'),
    (247.0, '闪通背', 'Fan Through the Back', 'Rise from the low reach, step forward, and separate the arms into the final posture.', [15, 16, 27, 28], 'The downward needle reach reaches its low point; the body begins to rise and the arms begin to separate.'),
    (251.0, '转身搬拦捶', 'Turn, Deflect, Parry, and Punch', 'Turn, follow the deflecting and parrying steps, then finish with the forward punch.', [15, 16, 27, 28], 'The fan-through-back extension is complete; the body begins its turn for the deflecting sequence.'),
    (263.0, '如封似闭', 'Apparent Close-Up', 'Open the hands after the punch, shift back, then press both hands forward.', [15, 16], 'The punch is complete; the open hand begins to move beneath the punching forearm.'),
    (269.3, '十字手', 'Cross Hands', 'Turn to the front, open the arms, gather the stance, and cross both hands at chest height.', [15, 16, 27, 28], 'The forward press is complete; the torso begins to turn to the front as both arms open.'),
    (277.5, '收势', 'Closing', 'Separate and lower the hands, bring the feet together, and return to standing.', [15, 16, 27, 28], 'The crossed-hand posture is complete; the hands begin to uncross and settle before lowering.'),
]
END = 286.8  # Last standing frames retained; terminal black frames excluded.
# Principal visible movement evidence. Keeping both ankles mandatory in every
# form would reject side-on/occluded legs even when the arm sequence is visible.
FOCUS = {number: [15, 16] for number in range(1, 25)}
FOCUS[2] = [16]
FOCUS[3] = [16]
for number in [4, 5, 7, 12, 14, 16]:
    FOCUS[number] = [16, 27, 28]
FOCUS[8] = [15, 27, 28]
for number in [17, 18, 19, 20]:
    FOCUS[number] = [15, 27, 28]
FOCUS[21] = [16, 27, 28]
FOCUS[22] = [16]
FOCUS[13] = [28]
FOCUS[15] = [27]


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=ROOT.parents[1] / '24.mp4')
    parser.add_argument('--review-only', action='store_true')
    parser.add_argument('--metadata-only', action='store_true', help='Refresh metadata after focus changes without changing encoded video bytes.')
    args = parser.parse_args()
    source = args.source.resolve()
    OUT.mkdir(parents=True, exist_ok=True)
    REVIEW.mkdir(parents=True, exist_ok=True)
    capture = cv2.VideoCapture(str(source))
    actual_fps = capture.get(cv2.CAP_PROP_FPS)
    frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    dimensions = (int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)), int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT)))
    if actual_fps != FPS or dimensions != (640, 360) or frames != 8621:
        raise RuntimeError(f'Unexpected source properties: {actual_fps}, {dimensions}, {frames}')
    source_hash = digest(source)
    cuts = [round(row[0] * FPS) for row in FORMS] + [round(END * FPS)]
    manifests = []
    boundary_rows = []
    for number, row in enumerate(FORMS, start=1):
        _, chinese, title, description, focus, evidence = row
        start_frame, end_frame = cuts[number - 1], cuts[number]
        identifier = f'24-{number:02}'
        start, end = start_frame / FPS, end_frame / FPS
        manifest = {
            'id': identifier, 'src': f'/practice-media/{identifier}.mp4',
            'referencePoseSrc': f'/practice-media/{identifier}.poses.json',
            'title': title, 'description': description, 'formNumber': number,
            'chineseTitle': chinese, 'sourceFile': source.name,
            'sourceDurationSeconds': frames / FPS,
            'startSeconds': start, 'endSeconds': end,
            'startFrame': start_frame, 'endFrameExclusive': end_frame,
            'durationSeconds': (end_frame - start_frame) / FPS,
            'sourcePlaybackRate': 1, 'sourceSegmentSeconds': (end_frame - start_frame) / FPS,
            'crop': dict(zip(['x', 'y', 'width', 'height'], CROP)),
            'width': CROP[2], 'height': CROP[3], 'fps': FPS,
            'focusJoints': FOCUS[number], 'selectionReason': evidence,
            'boundaryEvidence': 'Manually reviewed source movement transition; source caption identifies the form. Captions may appear after preparation starts.',
            'boundaryPrecision': 'Editorial continuous-routine transition, reviewed to approximately 0.5 seconds; frame indices are exact encoding cuts.',
            'provenance': 'User-provided 24.mp4 instructor recording. MediaPipe reference landmarks are inferred from this clip in the browser; no fabricated landmarks.',
            'audio': False, 'codec': 'h264', 'pixelFormat': 'yuv420p',
            'sourceSha256': source_hash,
        }
        if not args.review_only and not args.metadata_only:
            destination = OUT / f'{identifier}.mp4'
            temporary = OUT / f'{identifier}.preparing.mp4'
            output = av.open(str(temporary), mode='w', options={'movflags': '+faststart'})
            stream = output.add_stream('libx264', rate=FPS)
            stream.width, stream.height = CROP[2:]
            stream.pix_fmt = 'yuv420p'
            stream.options = {'crf': '19', 'preset': 'fast'}
            capture.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
            x, y, width, height = CROP
            try:
                for frame_index in range(end_frame - start_frame):
                    ok, frame = capture.read()
                    if not ok:
                        raise RuntimeError(f'Cannot decode {source.name} at frame {start_frame + frame_index}')
                    video_frame = av.VideoFrame.from_ndarray(frame[y:y + height, x:x + width], format='bgr24')
                    video_frame.pts = frame_index
                    for packet in stream.encode(video_frame):
                        output.mux(packet)
                for packet in stream.encode():
                    output.mux(packet)
            finally:
                output.close()
            check = cv2.VideoCapture(str(temporary))
            encoded_frames = int(check.get(cv2.CAP_PROP_FRAME_COUNT))
            encoded_fps = check.get(cv2.CAP_PROP_FPS)
            check.release()
            if encoded_frames != end_frame - start_frame or abs(encoded_fps - FPS) > 0.001:
                raise RuntimeError(f'Unexpected encode: {identifier}: {encoded_frames} frames at {encoded_fps}')
            temporary.replace(destination)
            manifest['sha256'] = digest(destination)
            manifest['bytes'] = destination.stat().st_size
            (OUT / f'{identifier}.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            print(f'{identifier}: {start:.3f}-{end:.3f}s ({manifest["durationSeconds"]:.3f}s)', flush=True)
        elif args.metadata_only:
            destination = OUT / f'{identifier}.mp4'
            if not destination.exists():
                raise RuntimeError(f'Missing encoded clip for metadata refresh: {identifier}')
            check = cv2.VideoCapture(str(destination))
            encoded_properties = (int(check.get(cv2.CAP_PROP_FRAME_COUNT)), check.get(cv2.CAP_PROP_FPS),
                                  int(check.get(cv2.CAP_PROP_FRAME_WIDTH)), int(check.get(cv2.CAP_PROP_FRAME_HEIGHT)))
            check.release()
            if encoded_properties != (end_frame - start_frame, FPS, CROP[2], CROP[3]):
                raise RuntimeError(f'Existing clip differs from current cut/crop; re-encode required: {identifier}: {encoded_properties}')
            manifest['sha256'] = digest(destination)
            manifest['bytes'] = destination.stat().st_size
            (OUT / f'{identifier}.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        manifests.append(manifest)
        boundary_rows.append({'formNumber': number, 'id': identifier, 'chineseTitle': chinese, 'title': title,
                              'startSeconds': start, 'endSeconds': end, 'startFrame': start_frame,
                              'endFrameExclusive': end_frame, 'durationSeconds': manifest['durationSeconds'],
                              'entryEvidence': evidence})

    # At each new form, show source context before / at / after the selected cut.
    for page in range(3):
        group = boundary_rows[page * 8:(page + 1) * 8]
        sheet = Image.new('RGB', (3 * 480, len(group) * 294), 'white')
        draw = ImageDraw.Draw(sheet)
        for row_index, row in enumerate(group):
            for column, offset in enumerate([-0.5, 0, 0.5]):
                t = max(0, row['startSeconds'] + offset)
                capture.set(cv2.CAP_PROP_POS_FRAMES, round(t * FPS))
                ok, frame = capture.read()
                if ok:
                    frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    x, y = column * 480, row_index * 294
                    sheet.paste(Image.fromarray(frame).resize((480, 270)), (x, y))
                    draw.text((x + 4, y + 272), f'{row["id"]} {t:.3f}s  cut {offset:+.1f}s', fill='black')
        sheet.save(REVIEW / f'boundaries-{page + 1:02}.jpg', quality=94)
    capture.release()
    audit = {
        'sourceFile': source.name, 'sourceSha256': source_hash, 'sourceDimensions': list(dimensions),
        'sourceFps': FPS, 'sourceFrames': frames, 'sourceDurationSeconds': frames / FPS,
        'crop': dict(zip(['x', 'y', 'width', 'height'], CROP)),
        'cropReason': 'Fixed main-instructor region retains the full original height and visible whole-body movement range. A 34-pixel edge of the corner inset remains to preserve the main instructor\'s furthest extended hand; no complete secondary person is retained. Output is not stretched.',
        'excluded': [{'startSeconds': 0, 'endSeconds': 1, 'reason': 'Title card / initial cut into the standing preparation.'},
                     {'startSeconds': END, 'endSeconds': frames / FPS, 'reason': 'Terminal standing tail and black frames.'}],
        'boundaryPolicy': 'Consecutive semantic forms, including their preparation and natural transitions; not equal-duration cuts. Adjacent forms share an exact cut with no duplicated or lost routine frames.',
        'uncertainty': 'A continuous tai chi routine has no hard stop between forms. Entry instants are manually selected editorial transitions, approximately 0.5-second precision. Source captions are delayed relative to some preparation movements.',
        'forms': boundary_rows,
    }
    (REVIEW / 'boundaries.json').write_text(json.dumps(audit, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    lines = ['# 24.mp4 cut review', '', 'Source: 640 x 360, 30 fps, 8621 frames, 287.366667 seconds.', '',
             'All cuts are contiguous, at source speed. The title card and terminal black frames are excluded.',
             'The source captions identify each form. Cut instants use the completed prior posture and next preparation, not delayed caption onset.',
             'Continuous movement makes boundaries editorial; review precision is approximately 0.5 seconds. Frame indices in boundaries.json are exact.', '',
             '| Form | English title | Source start (s) | Source end (s) | Duration (s) | Entry evidence |',
             '| --- | --- | ---: | ---: | ---: | --- |']
    for row in boundary_rows:
        lines.append(f'| {row["formNumber"]:02} | {row["title"]} | {row["startSeconds"]:.3f} | {row["endSeconds"]:.3f} | {row["durationSeconds"]:.3f} | {row["entryEvidence"]} |')
    lines += ['', 'Contact sheets:', '- overview-01.jpg: source sampled every 10 seconds.',
              '- seconds-01.jpg to seconds-10.jpg: source sampled every second.',
              '- crop-review-01.jpg to crop-review-04.jpg: superseded candidate crop sampled every 3 seconds.',
              '- final-crop-review-01.jpg to final-crop-review-10.jpg: final full-height crop sampled every second.',
              '- boundaries-01.jpg to boundaries-03.jpg: source cut context at -0.5 / 0 / +0.5 seconds.', '']
    (REVIEW / 'BOUNDARIES.md').write_text('\n'.join(lines), encoding='utf-8')
    if not args.review_only:
        playlist_path = OUT / 'playlist.json'
        backup = OUT / 'opening-playlist.json'
        if playlist_path.exists() and not backup.exists():
            shutil.copyfile(playlist_path, backup)
        playlist = {
            'id': 'tai-chi-24-v1', 'title': '24-Form Tai Chi',
            'description': 'Follow the 24 named forms from the supplied recording, at the original speed and with movement-based boundaries.',
            'provenance': '24 caption-identified semantic forms from user-provided 24.mp4. Boundaries manually reviewed; continuous transitions have approximately 0.5-second editorial precision.',
            'sourceFile': source.name, 'sourceSha256': source_hash, 'clips': manifests,
        }
        (OUT / '24-playlist.json').write_text(json.dumps(playlist, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        playlist_path.write_text(json.dumps(playlist, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        if digest(source) != source_hash:
            raise RuntimeError('Source checksum changed during processing.')
        print('Prepared 24 original-speed clips; source checksum unchanged.', flush=True)


if __name__ == '__main__':
    main()
