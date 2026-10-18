"""Export the first five teaching clips without changing any source asset.

The preview remuxes the preserved intra-only master, retaining the original
compressed pictures for source frames 15..464. This is a media export only;
saved pose observations and the practice player keep their source timeline.
"""
from fractions import Fraction
from pathlib import Path
import hashlib
import json
import zipfile

import av


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public/practice-media/recut-six"
OUTPUT = ROOT / "public/practice-media/recut-five"
FIRST_FRAME = 15
END_FRAME = 465
FPS = 30


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def verify_preview(preview, master):
    with av.open(str(master)) as source, av.open(str(preview)) as export:
        source_video = source.streams.video[0]
        export_video = export.streams.video[0]
        assert export_video.average_rate == FPS
        assert (export_video.width, export_video.height) == (450, 360)
        assert export_video.codec_context.name == "h264"
        assert export_video.duration * export_video.time_base == Fraction(END_FRAME - FIRST_FRAME, FPS)
        decoded_export = iter(export.decode(video=0))
        count = 0
        for index, frame in enumerate(source.decode(video=0)):
            if index < FIRST_FRAME:
                continue
            if index >= END_FRAME:
                break
            output_frame = next(decoded_export)
            assert output_frame.pts * output_frame.time_base == Fraction(count, FPS)
            # A remux must retain every decoded pixel, not merely duration.
            assert frame.to_ndarray(format="rgb24").tobytes() == output_frame.to_ndarray(format="rgb24").tobytes()
            count += 1
        assert count == END_FRAME - FIRST_FRAME
        assert next(decoded_export, None) is None
        return {"frameCount": count, "durationSeconds": count / FPS,
                "fps": FPS, "width": export_video.width, "height": export_video.height,
                "codec": export_video.codec_context.name, "pixelExactToMaster": True}


def main():
    manifest = json.loads((SOURCE / "manifest.json").read_text("utf8"))
    steps = manifest["steps"][:5]
    assert len(steps) == 5
    assert steps[0]["sourceStartFrame"] == FIRST_FRAME
    assert steps[-1]["sourceEndFrameExclusive"] == END_FRAME
    clips = [SOURCE / f"step-{index:02}.mp4" for index in range(1, 6)]
    protected = clips + [SOURCE / "master.mp4", SOURCE / "master.poses.json", SOURCE / "manifest.json"]
    before = {path.name: digest(path) for path in protected}
    for path, step in zip(clips, steps):
        assert before[path.name] == step["clipSha256"], f"Unexpected source clip: {path.name}"
    OUTPUT.mkdir(parents=True, exist_ok=True)
    preview = OUTPUT / "demonstration.mp4"
    temporary = OUTPUT / "demonstration.preparing.mp4"
    with av.open(str(SOURCE / "master.mp4")) as source, av.open(str(temporary), "w", options={"movflags": "+faststart"}) as export:
        source_video = source.streams.video[0]
        assert source_video.average_rate == FPS
        export_video = export.add_stream_from_template(source_video)
        origin = int(Fraction(FIRST_FRAME, FPS) / source_video.time_base)
        end = Fraction(END_FRAME, FPS)
        count = 0
        for packet in source.demux(source_video):
            if packet.pts is None:
                continue
            packet_time = packet.pts * packet.time_base
            if packet_time < Fraction(FIRST_FRAME, FPS):
                continue
            if packet_time >= end:
                break
            assert packet.is_keyframe, "Frame-exact remux requires the reviewed intra-only master"
            assert packet.dts == packet.pts, "Unexpected reordered source pictures"
            packet.pts -= origin
            packet.dts -= origin
            packet.stream = export_video
            export.mux(packet)
            count += 1
        assert count == END_FRAME - FIRST_FRAME
    preview_info = verify_preview(temporary, SOURCE / "master.mp4")
    temporary.replace(preview)
    archive_path = OUTPUT / "five-continuous-clips.zip"
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_STORED) as archive:
        for path in clips:
            entry = zipfile.ZipInfo(path.name, date_time=(2026, 10, 17, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_STORED
            archive.writestr(entry, path.read_bytes())
    with zipfile.ZipFile(archive_path) as archive:
        assert archive.namelist() == [path.name for path in clips]
        assert archive.testzip() is None
        for path in clips:
            assert hashlib.sha256(archive.read(path.name)).hexdigest() == before[path.name]
    after = {path.name: digest(path) for path in protected}
    assert before == after, "A preserved source asset changed"
    verification = {"schemaVersion": "five-clip-media-export-v1",
        "sourceFrameRange": [FIRST_FRAME, END_FRAME], "sourceEndFrameExclusive": True,
        "sourceTimeRangeSeconds": [FIRST_FRAME / FPS, END_FRAME / FPS],
        "preview": {**preview_info, "src": "/practice-media/recut-five/demonstration.mp4",
                    "sha256": digest(preview), "bytes": preview.stat().st_size,
                    "method": "Packet remux: exact source pictures, no encoding or temporal resampling"},
        "zip": {"src": "/practice-media/recut-five/five-continuous-clips.zip",
                "sha256": digest(archive_path), "bytes": archive_path.stat().st_size,
                "entries": [path.name for path in clips], "originalClipBytesPreserved": True},
        "sourceAssets": before, "allSourceAssetsUnchanged": before == after,
        "newInferencePerformed": False}
    (OUTPUT / "verification.json").write_text(json.dumps(verification, indent=2) + "\n", encoding="utf8")
    print(json.dumps(verification))


if __name__ == "__main__":
    main()
