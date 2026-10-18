# Five-clip teacher 3D preview

Open `http://127.0.0.1:8766/first-three.html?step=1` and press **3D skeleton**
beside the Teacher heading. The matching model appears between the tutorial and
learner panels. Drag to rotate, scroll to zoom, use **Reset view** to return to
the front, or close it with **×**, **Hide 3D** or Escape. On narrow screens the
tutorial and model share the first row, with the webcam below. Closing restores
the original two-panel layout.

The model follows the existing teacher video's `currentTime`; it has no separate
playback clock. It follows watch, practice, speed, pause, replay and step changes.
Loading and seeking clear the previous pose until the matching frame is ready.
The latest actual recorded observation may be held for at most 100 ms between
the 15 Hz observations. There is no interpolation or invented replacement for
missing joints. Each step's exact shared finish frame is allowed while held.

| Clip | First frame | Held finish frame | Teacher seconds |
| --- | --- | --- | --- |
| Open the left stance | 15 | 195 | 0.5–6.5 |
| Raise both hands | 195 | 285 | 6.5–9.5 |
| Lower both hands | 285 | 399 | 9.5–13.3 |
| Turn and open the hands | 399 | 435 | 13.3–14.5 |
| Circle and gather the hands | 435 | 465 | 14.5–15.5 |

## Earlier code and new data

The earlier `public/study-3d-scene.js` renderer reads MediaPipe `worldLandmarks`,
recenters the body at its hips, draws anatomical bones and joints, and supports
orbit/zoom. `scripts/extract-dual-view-poses.mjs` was the earlier extraction code.
That existing study page uses a different source recording; its saved 3D poses
cannot be relabeled as the five-clip lesson.

The current lesson's original `master.poses.json` contains image landmarks only.
The new `scripts/extract-lesson-study-3d.mjs` therefore inferred fresh image and
world landmarks from 231 verified source PNGs, frames 15–465, using local pinned
MediaPipe Tasks Vision 1.1.1 and Pose Landmarker Lite v1 in CPU VIDEO mode. The
separate `public/practice-media/recut-six/master.study-3d.poses.json` records both
33-point outputs, their actual source frames/timestamps, confidence, source PNG
hashes and matching video/model SHA-256 values. The original archive, video,
manifest, frame schedule and five clip files are unchanged. Extraction blocked
external requests, including the SDK's usage logging.

These are learned depth estimates from a single recording, displayed relative
to the hips. The current video's initial shoulder observations establish its
own fixed facing rotation. Display mirroring matches the tutorial without
renaming anatomical sides. Both image and world confidence must be at least
0.45, including the hip anchors; unavailable joints and their bones stay hidden.

`public/first-three-study-3d.js` validates this sidecar and selects the corresponding
frame. It lazily loads the existing renderer only when opened. Optional rotation
and mirroring settings preserve the earlier study page's defaults. Closing
disposes the scene, WebGL resources and animation loop while retaining validated
recorded data for reopening. WebGL failure leaves a readable message and keeps
the ordinary tutorial/practice controls available.

The preview never reads the learner camera, requests Factory feedback or alters
raw tracking, targets, readiness, grading, timing, progression or Arduino rules.

## Verification

Run `node scripts/check-lesson-3d.mjs` for the isolated browser/data checks, and
`node scripts/check-study-3d.mjs` for the existing standalone viewer regression.
They test genuine archived teacher observations; learner camera, USB and paid
Factory access are blocked. The new checks cover all five starts/midpoints/
finishes, four speeds, pauses, clip changes, orbit/reset, close/reopen, narrow
layouts, wrong/missing data, late replies and disabled WebGL. Evidence is saved
in `artifacts/lesson-3d-review/` and `artifacts/lesson-study-3d-extraction/`.

Regeneration requires the original supplied `24.mp4`, the unchanged master and
exact PNG schedule, and the installed pinned dependencies. Run
`node scripts/extract-lesson-study-3d.mjs`; a validated existing sidecar is reused
without overwriting it. Ordinary preview use requires no inference or camera.
