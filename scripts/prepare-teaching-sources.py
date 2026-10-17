"""Prepare reviewed, original-speed single-person teaching references.

Only source-* assets and artifacts/teaching-review are written. Originals, the
opening practice assets, and the existing default playlist remain unchanged.
"""
from pathlib import Path
from datetime import datetime, timezone
import argparse
import hashlib
import json
import subprocess
import sys

import cv2
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT.parents[1] / "source-videos"
OUT = ROOT / "public" / "practice-media"
REVIEW = ROOT / "artifacts" / "teaching-review"
FPS = 30
FRONT_CROP = (400, 180, 1120, 840)

# Editorial boundaries were reviewed in the source at half-second intervals,
# with additional quarter-second samples around the punch/closing transitions.
# These are semantic transitions in a continuous routine, not fixed time slices.
FRONT_CUTS = [
    5.0, 18.5, 43.5, 49.0, 75.5, 80.5, 102.0, 121.8,
    144.2, 155.0, 173.5, 178.7, 184.5, 192.0, 196.5, 204.2,
    214.5, 226.0, 243.5, 247.0, 251.8, 262.7, 268.5, 276.5, 285.0,
]
FRONT_EVIDENCE = [
    "Title-card dissolve has cleared; the instructor is standing before the first opening step.",
    "The opening press has reached the lower position; weight starts shifting for the first parting step.",
    "The third parting stance settles and the rear foot begins gathering for the crane posture.",
    "The crane posture settles; the elevated arm starts its circle for brush-knee preparation.",
    "The last brush-knee push settles; the rear foot begins its small gathering step.",
    "The lute posture settles; the rear arm opens for the first backward step.",
    "The last backward push settles; the hands begin the left ward-off gathering motion.",
    "The left sequence's final push settles; the torso begins turning toward the right sequence.",
    "The right sequence's final push settles; both hands begin the long single-whip turn.",
    "The single-whip extension settles; weight shifts and the lower hand starts its cloud-hand circle.",
    "The final cloud-hands gathering step settles; the hands begin forming the next single whip.",
    "The second single-whip extension settles; the rear foot starts gathering for high pat.",
    "The high-pat reach settles; the arms begin crossing and opening for the right kick.",
    "The right heel retracts from full extension; the arms begin lowering for the paired-fist step.",
    "The paired-fist strike settles; the torso starts turning for the left heel kick.",
    "The left heel retracts; the leg begins lowering toward the first low sweeping stance.",
    "The first one-leg posture settles; the lifted leg lowers into the opposite low stance.",
    "The second one-leg posture settles; the lifted leg begins the first diagonal shuttle step.",
    "The second shuttle push settles; the rear foot gathers before the low needle reach.",
    "The low needle reach is complete; the torso starts rising and the arms separate.",
    "The fan-through-back extension settles; the body starts turning for deflect, parry, and punch.",
    "The forward punch settles; the open hand moves under the punching forearm.",
    "The two-hand press settles; the body begins turning to the front for cross hands.",
    "The crossed-hand posture settles; the hands begin to uncross before the closing press.",
]

# Audited from real 12 Hz MediaPipe Lite observations of these exact clip bytes.
# Keep a principal visible arm plus meaningful step evidence where observable;
# do not make a routinely occluded far wrist mandatory. No threshold is changed.
FRONT_FOCUS = {
    1: [15, 16, 27], 2: [16, 27, 28], 3: [16, 27, 28], 4: [16, 27, 28],
    5: [16, 28], 6: [16, 28], 7: [16, 27, 28], 8: [15, 27, 28],
    9: [15, 16, 27, 28], 10: [15, 16, 27, 28], 11: [15, 16, 27, 28],
    12: [16, 28], 13: [16, 28], 14: [16, 28], 15: [27, 28], 16: [27, 28],
    17: [15, 27, 28], 18: [15, 27, 28], 19: [15, 27], 20: [15, 27, 28],
    21: [16, 28], 22: [16, 27, 28], 23: [15, 16, 27, 28], 24: [15, 16],
}
FRONT_TRACKING_NOTES = {
    1: "Both arm raises/presses and the visible left opening step are compared. The right ankle is less reliably tracked in the wide stance.",
    15: "Leg sequence only: both ankles track the turn, left heel kick and recovery. Neither wrist has sufficient coverage in this rear-facing segment, so arm completion is not certified.",
    16: "Leg sequence only: both ankles track the low stance and rise into one-leg balance. Neither wrist has sufficient coverage in this segment, so arm completion is not certified.",
    24: "Both arm lowering sequences are compared. The small closing foot adjustment has too little coherent observed ankle displacement for this matcher and is not certified.",
}


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def save_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def properties(path):
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise RuntimeError(f"Cannot open {path}")
    result = {
        "width": int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)),
        "height": int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT)),
        "fps": capture.get(cv2.CAP_PROP_FPS),
        "frameCount": int(capture.get(cv2.CAP_PROP_FRAME_COUNT)),
    }
    capture.release()
    result["durationSeconds"] = result["frameCount"] / result["fps"]
    return result


def encode(ffmpeg, source, manifest, metadata_only):
    target = OUT / f'{manifest["id"]}.mp4'
    if not metadata_only:
        temporary = OUT / f'{manifest["id"]}.preparing.mp4'
        crop = manifest["crop"]
        filters = (
            f'crop={crop["width"]}:{crop["height"]}:{crop["x"]}:{crop["y"]},'
            f'scale={manifest["width"]}:{manifest["height"]},setsar=1'
        )
        command = [
            ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
            "-ss", str(manifest["startFrame"] / FPS), "-i", str(source),
            "-frames:v", str(manifest["endFrameExclusive"] - manifest["startFrame"]),
            "-an", "-vf", filters, "-c:v", "libx264", "-crf", "20",
            "-preset", "fast", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(temporary),
        ]
        subprocess.run(command, check=True)
        temporary.replace(target)
    actual = properties(target)
    expected = (manifest["endFrameExclusive"] - manifest["startFrame"], FPS, manifest["width"], manifest["height"])
    observed = (actual["frameCount"], actual["fps"], actual["width"], actual["height"])
    if observed != expected:
        raise RuntimeError(f'{manifest["id"]}: encoded properties {observed} differ from {expected}')
    manifest["sha256"] = digest(target)
    manifest["bytes"] = target.stat().st_size
    save_json(OUT / f'{manifest["id"]}.json', manifest)
    print(f'{manifest["id"]}: {manifest["startSeconds"]:.3f}-{manifest["endSeconds"]:.3f}s ({manifest["durationSeconds"]:.3f}s)', flush=True)


def manifest(identifier, template, source, source_metadata, start, end, crop, size, evidence, orientation):
    first, last = round(start * FPS), round(end * FPS)
    number = template["formNumber"]
    if source_metadata["id"] == "creator-front-24":
        focus = FRONT_FOCUS[number]
        tracking_notes = FRONT_TRACKING_NOTES.get(number, "Compare the listed visible arm and leg chains. Far-side limbs occluded during turns are not certified; actual observed landmarks are retained unchanged.")
    else:
        focus = [15, 16, 27, 28] if identifier == "source-crane-side" else [15, 27]
        tracking_notes = ("Both arm separations and both leg chains have complete observed coverage in this view." if identifier == "source-crane-side" else "Compare the visible left arm and left leg. The far right wrist and right leg are occluded during this view and are not certified.")
    return {
        "id": identifier, "src": f"/practice-media/{identifier}.mp4",
        "referencePoseSrc": f"/practice-media/{identifier}.poses.json",
        "title": template["title"], "chineseTitle": template["chineseTitle"],
        "description": template["description"], "formNumber": template["formNumber"],
        "sourceFile": source.name, "sourceLibraryId": source_metadata["id"],
        "sourceUrl": source_metadata["url"], "sourceSha256": source_metadata["sha256"],
        "sourceDurationSeconds": source_metadata["durationSeconds"],
        "startFrame": first, "endFrameExclusive": last,
        "startSeconds": first / FPS, "endSeconds": last / FPS,
        "durationSeconds": (last - first) / FPS,
        "sourceSegmentSeconds": (last - first) / FPS, "sourcePlaybackRate": 1,
        "crop": dict(zip(["x", "y", "width", "height"], crop)),
        "width": size[0], "height": size[1], "fps": FPS,
        "focusJoints": focus, "trackingNotes": tracking_notes,
        "focusSelectionProvenance": "Manual semantic limb selection audited against actual cached 12 Hz MediaPipe Lite observations and unchanged practice-relaxed-v1.1 rules. See artifacts/teaching-review/FOCUS.md.",
        "selectionReason": evidence,
        "boundaryEvidence": "Manually reviewed timestamped source frames and neighboring movement transitions. Routine form names use the existing reviewed 24-form taxonomy.",
        "boundaryPrecision": "Editorial transition in continuous movement; approximately 0.5-second review precision. Encoding cuts use the exact recorded frame indices.",
        "orientation": orientation,
        "provenance": "Locally downloaded instructor footage; reference landmarks must be real MediaPipe inference of this encoded clip. No fabricated landmarks or physical-camera validation.",
        "audio": False, "codec": "h264", "pixelFormat": "yuv420p",
    }


def make_sheet(clips, label):
    for page in range((len(clips) + 5) // 6):
        group = clips[page * 6:(page + 1) * 6]
        sheet = Image.new("RGB", (4 * 360, len(group) * 294), "#111111")
        draw = ImageDraw.Draw(sheet)
        for row, clip in enumerate(group):
            capture = cv2.VideoCapture(str(OUT / f'{clip["id"]}.mp4'))
            for col, fraction in enumerate([0, .33, .66, 1]):
                frame_index = min(round((clip["durationSeconds"] * FPS - 1) * fraction), clip["endFrameExclusive"] - clip["startFrame"] - 1)
                capture.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
                ok, frame = capture.read()
                if not ok:
                    raise RuntimeError(f'QA decode failed: {clip["id"]} frame {frame_index}')
                picture = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
                picture.thumbnail((360, 270))
                x, y = col * 360, row * 294
                sheet.paste(picture, (x + (360 - picture.width) // 2, y + 24))
                draw.text((x + 5, y + 4), f'{clip["id"]} | source {clip["startSeconds"] + frame_index / FPS:.2f}s', fill="white")
            capture.release()
        sheet.save(REVIEW / f"{label}-encoded-{page + 1:02}.jpg", quality=90)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--metadata-only", action="store_true")
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    REVIEW.mkdir(parents=True, exist_ok=True)
    sys.path.insert(0, str(ROOT.parents[1] / ".video-tools"))
    import imageio_ffmpeg
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    library = json.loads((SOURCES / "sources.json").read_text(encoding="utf-8"))["videos"]
    source_by_id = {item["id"]: item for item in library}
    templates = json.loads((OUT / "24-playlist.json").read_text(encoding="utf-8"))["clips"]
    prepared = {}
    for library_id in ["creator-front-24", "creator-white-crane"]:
        item = source_by_id[library_id]
        source = SOURCES / item["filename"]
        if digest(source) != item["sha256"]:
            raise RuntimeError(f"Original checksum differs: {source.name}")
        observed = properties(source)
        if observed["fps"] != FPS:
            raise RuntimeError("Only the reviewed 30 fps creator sources are encoded by this script.")
        clips = []
        if library_id == "creator-front-24":
            for index, template in enumerate(templates):
                clips.append(manifest(f"source-front-{index + 1:02}", template, source, item,
                                      FRONT_CUTS[index], FRONT_CUTS[index + 1], FRONT_CROP, (800, 600),
                                      FRONT_EVIDENCE[index], "Front-view recording; instructor turns naturally during the routine. No horizontal flip."))
            playlist_name, title = "source-front-24-playlist.json", "Front Demonstration - 24 Forms"
        else:
            template = dict(templates[2])
            for identifier, title_suffix, start, end, evidence in [
                ("source-crane-side", "Side View", 6.2, 20.0, "Begin before the instructor lowers from the initial held posture; retain the gathering step, weight transfer, arm separation, and completed crane posture. Exclude the long initial hold and the transition graphic at 24 seconds."),
                ("source-crane-back", "Back View", 32.0, 49.5, "Begin from the settled prior bow stance before the rear-foot gathering step; retain the complete slow demonstration and explanatory holds through the raised-hand finish. Exclude the previous scene and transition graphic."),
            ]:
                template["title"] = f"White Crane - {title_suffix}"
                clips.append(manifest(identifier, template, source, item, start, end,
                                      (0, 260, 1080, 1660), (540, 830), evidence,
                                      f"Source labels this scene {title_suffix}; the performer turns within the scene. No horizontal flip."))
            playlist_name, title = "source-white-crane-playlist.json", "White Crane - Teaching Views"
        for clip in clips:
            encode(ffmpeg, source, clip, args.metadata_only)
        playlist = {
            "id": playlist_name.removesuffix("-playlist.json") + "-v1", "title": title,
            "description": "Reviewed single-person movement clips at their original speed. Continuous movement boundaries are editorial; no timing rescale or interpolation.",
            "provenance": "Reviewed local teaching-source footage. Original files and previous playlists are preserved.",
            "sourceFile": source.name, "sourceSha256": item["sha256"], "clips": clips,
        }
        save_json(OUT / playlist_name, playlist)
        prepared[library_id] = {"playlist": f"/practice-media/{playlist_name}", "clips": clips}
        make_sheet(clips, library_id)
        if digest(source) != item["sha256"]:
            raise RuntimeError(f"Source checksum changed during processing: {source.name}")

    reasons = {
        "creator-wild-horse": "Two simultaneous bodies in the composite. The main-view rear foot reaches/passes the frame edge during the parting stance. A whole-frame single-person pose would be ambiguous. The inset would need separate orientation and edge auditing; no incomplete main-view clip is promoted.",
        "university-lesson-1": "640x352 split-view lecture with variable close-ups, long explanatory holds, labels and screen overlays. A stable front-panel crop leaves roughly 130-180 pixels of body height. Use the matching clean source-front opening, wild-horse, and crane clips for automatic imitation.",
        "university-lesson-2": "640x352 split-view instruction with variable close-ups, captions, screen overlays and long holds. The small panel is insufficient for a reliable primary reference. Use source-front forms 4-6; the source remains available for human study.",
        "university-full-24": "Composite rear view plus small front-view inset. The main instructor's extended hand approaches/overlaps the inset region in the left-facing sequence, so simply cropping off the inset would cut the main action. Mobile-player controls obscure the closing segment after about 335 seconds. Use the complete clean source-front routine for automatic imitation.",
    }
    inventory = {"schemaVersion": 1, "generatedAtUtc": datetime.now(timezone.utc).isoformat(),
                 "scope": "All six downloaded sources were visually reviewed in labeled contact sheets. This is sampled visual review, not continuous playback or physical-camera validation.",
                 "policy": "Preserve originals; prepare only reviewed full-body single-person references. Multi-person, clipped-body, or low-resolution sources remain documented teaching material rather than silently becoming automatic pose references.",
                 "sources": []}
    for item in library:
        path = SOURCES / item["filename"]
        actual_hash = digest(path)
        if actual_hash != item["sha256"]:
            raise RuntimeError(f"Source changed: {path.name}")
        usable = prepared.get(item["id"])
        entry = {"id": item["id"], "filename": item["filename"], "sourceUrl": item["url"],
                 "sha256": actual_hash, "originalPreserved": True, "actualMetadata": properties(path),
                 "status": "prepared-single-person-reference" if usable else "reviewed-teaching-only",
                 "clipCount": len(usable["clips"]) if usable else 0,
                 "playlist": usable["playlist"] if usable else None,
                 "reviewContactSheets": [str(p.relative_to(ROOT)).replace("\\", "/") for p in sorted(REVIEW.glob(item["filename"][:2] + "-page-*.jpg"))]}
        if usable:
            entry["clips"] = [{k: clip[k] for k in ["id", "title", "startSeconds", "endSeconds", "durationSeconds", "selectionReason"]} for clip in usable["clips"]]
            entry["excludedRanges"] = ([{"startSeconds": 0, "endSeconds": 5, "reason": "Title card/dissolve."}, {"startSeconds": 285, "endSeconds": item["durationSeconds"], "reason": "Completed routine hold and separate salute."}] if item["id"] == "creator-front-24" else [{"startSeconds": 0, "endSeconds": 6.2, "reason": "Initial held finished posture."}, {"startSeconds": 20, "endSeconds": 32, "reason": "Long finishing hold, transition graphic and initial hold of the next view."}, {"startSeconds": 49.5, "endSeconds": item["durationSeconds"], "reason": "Terminal finished-pose hold."}])
        else:
            entry["exclusionReason"] = reasons[item["id"]]
            entry["usableAlternativePlaylist"] = "/practice-media/source-front-24-playlist.json"
        inventory["sources"].append(entry)
    save_json(OUT / "source-inventory.json", inventory)
    save_json(REVIEW / "source-inventory.json", inventory)
    lines = ["# Teaching-source review", "", inventory["scope"], "", inventory["policy"], "", "| Source | Status | Prepared clips |", "| --- | --- | ---: |"]
    for item in inventory["sources"]:
        lines.append(f'| {item["filename"]} | {item["status"]} | {item["clipCount"]} |')
    lines += ["", "All prepared clips preserve original playback speed and source-frame duration. Source hashes were checked before and after encoding. The front demonstration uses one fixed 4:3 crop with proportional scaling, and the crane clips remove only the upper logo area. No view is stretched or horizontally flipped.", "", "Boundary review uses labeled 3-second full-frame contact sheets and 0.5-second transition sheets, with selected 0.25-second refinements. Boundaries are editorial and are not claims of exact physiological movement onset.", "", "MediaPipe pose inference and coverage are a separate verification step. No synthetic landmarks are included by this script.", "", "## Teaching-only sources", ""]
    for item in inventory["sources"]:
        if item["status"] == "reviewed-teaching-only":
            lines += [f'**{item["filename"]}**: {item["exclusionReason"]}', ""]
    for group in prepared.values():
        lines += ["| Clip | Form | Start (s) | End (s) | Duration (s) | Entry evidence |", "| --- | --- | ---: | ---: | ---: | --- |"]
        for clip in group["clips"]:
            lines.append(f'| {clip["id"]} | {clip["title"]} | {clip["startSeconds"]:.3f} | {clip["endSeconds"]:.3f} | {clip["durationSeconds"]:.3f} | {clip["selectionReason"]} |')
        lines.append("")
    (REVIEW / "REVIEW.md").write_text("\n".join(lines), encoding="utf-8")
    summary = ["# Downloaded source processing", "", "All six original videos were preserved and their SHA-256 checksums verified.", "", "Integrated single-person references:", "", "- Source 01: all 24 forms, original speed, 5.0-285.0 seconds, with reviewed semantic movement boundaries. Playlist: public/practice-media/source-front-24-playlist.json.", "- Source 03: two complete white-crane teaching views, 6.2-20.0 seconds and 32.0-49.5 seconds. Scene transition and initial/terminal holds are excluded. Internal teaching holds and original speed are retained. Playlist: public/practice-media/source-white-crane-playlist.json.", "", "Reviewed teaching sources kept outside automatic pose comparison:", ""]
    for item in inventory["sources"]:
        if item["status"] == "reviewed-teaching-only":
            summary += [f'- Source {item["filename"][:2]}: {item["exclusionReason"]}']
    summary += ["", "source-inventory.json contains metadata, hashes, per-source status, exclusions, alternatives, and clip boundaries. REVIEW.md records all cut decisions. The review is sampled visual inspection; MediaPipe coverage must be verified separately, and this processing does not claim physical-camera testing.", ""]
    (REVIEW / "SOURCES.md").write_text("\n".join(summary), encoding="utf-8")
    print("Prepared 26 original-speed clips across two source playlists; all six original checksums verified.", flush=True)


if __name__ == "__main__":
    main()
