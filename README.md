# MotionTrial local MVP

## Current: step-by-step learning

Open [the practice page](http://127.0.0.1:3000/practice). Default **Step-by-step learning** divides the original outdoor recording into **196 reviewed small steps** across all 24 forms. Form 2 has **15 steps**, including each round's turn/open, foot gathering, heel reach, transfer/separation and finish.

Choose a form, then **Watch slowly**. Each small movement plays at **0.5×**, then holds its target while you imitate with **no time limit**. Choose **0.25×** for extra time. **Replay step**, **Previous step**, **Pause** and **Next step** let you control the lesson. Next step confirms your own progress and begins the next small demonstration; it does not claim a model verified the movement. Every step can be visited without a camera.

**Start camera** adds mint live joints and an amber instructor guide in one frame. Opt-in **Auto advance when close** waits until the demonstration ends, then compares a generous final-pose range with 700 ms of continuous fresh evidence. It checks a held learning target, not a complete motion. Some side/back endpoints remain untracked; **Next step stays available**. Nothing is recorded or uploaded. Camera choice, display toggles and mirroring remain available.

Switch to **Whole-form practice** for the existing timed sequence, indoor/outdoor recordings and opening tutorials. Existing `?routine=...` links open whole-form mode; `?mode=forms` explicitly selects it and `?mode=guided` selects learning. Switching modes releases the active camera. The fine teaching map currently uses the original outdoor `24.mp4`; other recordings remain unchanged in the video library.

Run `python scripts/build-teaching-steps.py` to recreate `public/practice-media/teaching-playlist.json` and `artifacts/teaching-step-review/分解动作表.md` from the two reviewed source maps in `scripts/teaching-steps-*.json`. The player uses exact windows of preserved MP4s and their genuine reference observations. A reviewed clear target may precede a source fade. See PROMPT_STEP_BY_STEP.md, STATUS.md and DEMO_RUNBOOK.md for the prompt, evidence and walkthrough.

## Current video library and camera controls — 2026-10-16

Open `/practice?mode=forms&routine=24b` for whole-form practice. The video-library default is the newly supplied **24b.mp4**, split into 24 reviewed natural-duration forms at the original speed. **Training video** switches between prepared recordings and the preserved four-stage opening. Switching recordings cancels the current attempt and clears that recording's practice progress while leaving the camera running. Original videos and saved assessment sessions are preserved.

In the right panel, choose **Camera**, then **Start camera**. **Show my skeleton** draws real current MediaPipe observations directly on the camera image; **Show instructor guide** adds the amber recorded-reference guide in the same frame. Both are enabled by default and can be controlled independently. Camera and overlays mirror together. Camera selection uses the exact selected device and releases the previous stream; a disconnected selected device gives a recovery message. Device names appear after browser permission. The display now uses the same 0.45 confidence floor as Relaxed practice, while missing and expired observations still clear within 250 ms. No-body, partial-body, slow-inference and inference-error messages are distinct.

Video preparation uses local OpenCV/PyAV; browser camera capture plus MediaPipe supplies the real-time body skeleton. OpenCV alone is not the pose model. Cached instructor observations are never substituted for camera observations. Physical-person camera tracking and imitation calibration still require a real follow-along check.

Rebuild the new instructor assets and verify their real recorded references with the app running:

```powershell
python scripts/prepare-24b.py --source 'D:\MotionTrial\24b.mp4'
$env:MOTIONTRIAL_TEST_URL = 'http://127.0.0.1:3000'
node scripts/diagnose-24.mjs --playlist public/practice-media/24b-playlist.json --expected-count 24 --report-directory artifacts/reference-24b-qa
npx tsx scripts/check-practice-library.mts
```

The library contains **78 verified reference clips / 10,677 actual recorded pose observations**. All 7 whole-form production browser checks, 69 unit/integration checks, typecheck and production build passed in this run. `public/practice-media/library.json` controls the available recordings and default. Preserve the entire generated `public/practice-media/` directory when copying the app. `scripts/prepare-practice.py` now rebuilds `opening-playlist.json` independently; `--activate` explicitly replaces the legacy active manifest. The 24b download is `D:\MotionTrial\24b动作剪辑_20261016.zip`.

The six previously downloaded teaching sources were also reviewed. The full front routine and the two isolated white-crane views have prepared clips; `public/practice-media/source-inventory.json` and `artifacts/teaching-review/SOURCES.md` explain all six source decisions. Multi-person insets, clipped limbs and low-resolution teaching panels are retained as teaching material. Only references that pass actual-model checks are included in the selector.

Relaxed matching remains approximate. In the 24b recorded-observation counterfactual check, held poses never passed and missing tracking remained unknown, but reversed trajectories passed for 6 of 24 forms with repeated/out-and-back motion. A reference self-match establishes usable recorded evidence, not accurate human grading or reliable direction discrimination for every form. Source-specific visibility notes identify hidden limbs that cannot be assessed.

## Current demo: 24 forms with a shared-frame guide

Use `/practice` for the 24-form routine from the newly supplied `D:\MotionTrial\24.mp4`. The source is about 4 minutes 47 seconds. Each form has its own reviewed boundary, original speed, and natural duration. These are whole forms, including their repeated left/right movements, rather than equal four-second excerpts. The local clip list and cut evidence are in `public/practice-media/playlist.json`; the previous opening sequence is retained as `opening-playlist.json`.

1. Open the practice page and wait for **Reference analyzed locally**. The left panel shows the actual instructor clip and its detected pose. Reference observations may be prepared locally in advance and checked against the clip/model metadata; if unavailable or invalid, the page analyzes the actual frames again.
2. Choose **Start camera** and allow access. Stand back so your hands, hips and feet are visible. The right panel shows **mint** live joints and an **amber dashed** instructor guide together. The guide follows the same video phase as the left panel, translated/scaled to your hips and torso. It never replaces your camera observations. The guide clears if the live body anchors cannot be trusted; missing or expired live poses disappear within 250 ms.
3. Leave **Match tolerance → Relaxed** selected for approximate imitation. It allows smaller movement, pose differences, and timing variation. **Standard** is available while paused when the recorded view has enough tracking for its stricter rules; otherwise it is disabled. A later form with limited visibility explicitly returns the setting to Relaxed. Start practice gives a three-second countdown; follow the complete form. A match advances automatically; an incomplete or unknown attempt repeats only that form.
4. Choose any numbered form to practice it, without marking it passed. On reaching the last form, the sequence returns to remaining unpassed forms; completion requires all 24. **Pause**, **Stop camera**, **Show instructor guide**, and **Mirror preview** remain available. Mirroring flips the camera and both overlays together, preserving anatomical side labels.

Relaxed rules are versioned `practice-relaxed-v1.1`: 70% tracked evidence, confidence 0.45 for the required body/focus points, up to 30% phase alignment difference, and at least 30% of the reference movement range. Position and phase tolerances are deliberately broad. Start/middle/finish and actual directional movement still matter: standing still, a missing principal limb sequence, or no tracking does not pass. These are experimental practice settings and still need calibration with a person. Palm orientation and detailed foot shape are not scored. Source camera angle and self-occlusion limit comparison.

The camera remains local, unrecorded and unuploaded. Cached observations belong only to the recorded instructor; your mint skeleton always comes from real current camera frames. Existing assessment/review routes and private saved sessions remain available.

Recreate the 24 clips (Python dependencies used here: PyAV 15.0.0, OpenCV 4.11.0, Pillow 11.3.0), then prepare actual local reference observations with the app running:

```powershell
python scripts/prepare-24.py --source 'D:\MotionTrial\24.mp4'
$env:MOTIONTRIAL_TEST_URL = 'http://127.0.0.1:3000'
node scripts/diagnose-24.mjs
```

All 24 reference clips pass actual-model reference checks (3,459 observations); 52 unit/integration checks, typecheck, production build, and five practice browser behaviors are verified. Browser cameras were explicitly prerecorded/synthetic, so human imitation tolerance remains to be checked. See [PROMPT_24_FORMS.md](PROMPT_24_FORMS.md) for the requested implementation prompt, STATUS.md for detailed evidence, and DEMO_RUNBOOK.md for the human-camera checks. Keep the generated `public/practice-media/` folder when copying the app to another computer.

## Previous demo: four stages of the opening

The instructions in this historical section describe the preserved opening assets. Running the old preparation script rebuilds that older active playlist; use `prepare-24.py` for the current 24-form sequence.

The user-authorized practice prototype is at [127.0.0.1:3000/practice](http://127.0.0.1:3000/practice). The assessment application below remains available at `/`; its recording, storage and review flows are preserved. The earlier assessment-only scope does not restrict this separate practice page.

1. Open `/practice` in desktop Chrome. Wait for **Reference analyzed locally**. The left clip is prerecorded source video; its overlay is actual MediaPipe inference from those frames, cached in page memory for replay.
2. Choose **Start camera**, allow access, and stand far enough back for shoulders, elbows, wrists, hips, knees and ankles to be visible. Nothing is recorded or uploaded on this page. The preview is unmirrored by default; **Mirror preview** flips video and overlay together without changing anatomical left/right matching.
3. Choose **Preview reference** to watch the current stage, then **Start practice**. Each attempt has a 3-second starting-pose countdown and a 4-second movement.
4. A match marks the current stage **Passed**, prepares the next actual clip, and automatically starts its countdown. An observed mismatch or insufficient tracking repeats only the current stage. Missing evidence is **unknown**, separate from an observed mismatch. The four-stage order and progress are visible above the videos.
5. **Pause** cancels automatic playback, including during a transition; the camera stays on. **Stop camera** releases camera tracks and models, cancels pending starts, and may require **Prepare movement** before resuming. On completion, **All movements complete** and **Back to first movement** allow another round. Leaving the page releases resources.

The user approved this natural order after source inspection. These are four stages of the opening, rather than four different tai chi forms:

| Stage | Source | Source interval | Source speed | File |
| --- | --- | --- | --- | --- |
| Lift the left foot | Long tutorial | 82–85 s | 0.75× | action-02.webm |
| Step out to the left | Long tutorial | 85–96 s | 2.75× | action-03.webm |
| Lift both arms forward | Short source | 6.5–8.5 s | 0.5× | action-01.webm, original approved bytes preserved |
| Press both hands down | Long tutorial | 114–129 s | 3.75× | action-04.webm |

Every output is silent, 4 seconds, 520×660 and contains the full body. The long teaching footage moves slowly; the displayed source-speed changes make each practice stage four seconds. The short clip's central instructor crop is unchanged; the three new clips use x760/y140/w700/h888 from the long source. Both original MP4s are untouched. `public/practice-media/playlist.json` specifies the order, movement focus, timing, crop and clip SHA-256 values. The outdoor setting changes between clips because the preserved arm clip comes from the other supplied recording.

The practice model uses real local MediaPipe Pose on 12 joints, at a maximum target of 12 Hz. Each reference uses a separate model instance; the live camera model continues across stages. The comparison normalizes torso size/position and image aspect ratio, compares joint angles and an ordered trajectory with limited timing tolerance, and requires beginning/middle/end coverage and actual movement. Explicitly audited movement focus is the left ankle for the first two stages and both wrists for the last two. Each focus needs robust excursion, coherent phase change, sufficient learner movement and matching direction; a small foot movement is not diluted by eleven mostly static joints. Both arms must contribute to bilateral stages, while stationary legs are not required to move. A single held pose or reversed sequence cannot pass. These versioned thresholds (`single-action-v0.3`) are experimental engineering settings, not a calibrated tai chi judgement. Palm orientation, finger articulation and detailed foot/toe form are not scored. Camera angle, occlusion, lighting, laptop speed and body proportions affect results. Physical-person acceptance remains pending; see the practice checklist in DEMO_RUNBOOK.md.

The current practice page saves no camera video, pose records or progression. Reload clears samples/progress; Stop camera releases capture. To remove the generated references, stop the app and remove only the generated `public/practice-media/` directory. This does not delete either original MP4 or assessment data. Generated references are locally served by the app and excluded from Git, along with test artifacts.

For another presentation computer, copy the app source/lockfile **and the entire `public/practice-media/` directory**, install Node 24 and Chrome, then use the setup/build/start commands below. If the generated clips were not copied, put both supplied MP4s at known paths, install Python with `opencv-python==4.11.0.86`, and run:

```powershell
python scripts/prepare-practice.py --source 'D:\MotionTrial\太极拳最简入门_起势示范节选.mp4' --long-source 'D:\MotionTrial\太极拳入门_起势完整教学_5分17秒.mp4'
```

This script reads the sources and creates the four-stage local playlist. It checks expected source dimensions, output duration and an existing approved arm clip's checksum before preserving that file. Media/playlist assets must exist before building/starting the presentation server. Implementation and browser checks take place on this computer's local `D:` workspace, not on a remote host. See STATUS.md for actual results and PROMPTS.md for the current continuation prompt.

## Original assessment MVP

MotionTrial records a fixed 20-second seated movement task, saves the original video and timestamped upper-limb observations, and lets a researcher inspect tracking signals and save a review decision. Capture quality is separate from movement ability: small, slow or asymmetric movement does not trigger a quality failure.

This is a local demonstration with labelled participant/researcher views, not authenticated accounts. It is not a validated clinical endpoint and makes no diagnostic, regulatory or measured time-saving claim. Use only authorized demonstration recordings and pseudonymous codes.

## Run on this Windows computer

Implementation occurred on this computer's `D:` drive, not on a remote preview host. Open PowerShell with **Node 24.x** and npm installed:

```powershell
Set-Location -LiteralPath 'D:\MotionTrial\MotionTrial_Codex_Handoff\MotionTrial_Codex_Handoff'
npm ci
npm run setup:assets
npm run dev
```

Open [MotionTrial at 127.0.0.1:3000](http://127.0.0.1:3000). Keep the terminal running. `Ctrl+C` stops the server. Both development and production scripts bind to `127.0.0.1`.

For the presentation, stop the development server, then run:

```powershell
npm run build
npm start
```

The initial installation and asset setup need internet access. Once installed, the app serves its model and WASM locally; capture and analysis have no cloud inference or LLM dependency. Use a current desktop Chrome browser for the tested path. Chrome camera permission must be granted to this exact origin. Localhost provides the secure context required by [`getUserMedia`](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia); changing to an arbitrary LAN HTTP address is not a supported setup.

If port 3000 is occupied, stop its existing app or use `npm run dev -- --port 3001` and open [127.0.0.1:3001](http://127.0.0.1:3001). Supply `--origin http://127.0.0.1:3001` to seed/reset commands and set `$env:MOTIONTRIAL_TEST_URL = 'http://127.0.0.1:3001'` before browser tests.

## Capture and review

1. Choose **New assessment**, read the fixed instructions and retention notice, enter a demo code, and explicitly consent. No audio is requested.
2. In setup choose the truthful **Camera source**. Physical camera is `live_camera`; prerecorded video via a virtual camera is `prerecorded_demo`; generated virtual input is `synthetic_demo`. This selector labels the source; camera routing itself is configured in the browser/OS. Every capture option runs the real local pose model.
3. Wait for separate camera, model and recorder readiness, then choose **Start 20-second recording**. No pose is a visible unknown state; it does not prevent recording when the camera and model work. Preview and replay are not mirrored.
4. The task ends automatically. **Stop & keep partial recording** keeps an interrupted clip; **Abort & discard recording** discards it. Hiding the tab stops and retains a partial recording. Camera/model resources are released when leaving the flow. Save or deliberately discard an unsaved recording before navigation.
5. Choose **Save recording**. A failed upload keeps the Blob in the current tab for **Retry saving recording**, using the same UUID. Closing/reloading the tab can lose an unsaved Blob; saved records remain on the server.
6. Open **researcher review**, play the actual source video, click a quality event to seek, and optionally enable estimated landmarks. Save **Accept for analysis**, **Request recapture**, or **Uncertain** with a note. Refresh to verify history. A new decision appends history; **Linked recapture** creates a new session linked to the original.

The fixed instruction snapshot is stored with each session:

> Sit comfortably and keep your upper body in view. For the next 20 seconds, slowly raise and lower your hands within a comfortable range. You may pause or stop at any time.

## Architecture and reproducibility

| Layer | Implementation |
| --- | --- |
| UI | Next.js App Router 16.4.2, React/React DOM 19.3.1, TypeScript 7.0.2, Tailwind 4.3.3; English warm-white/navy/teal interface |
| Capture | Browser `getUserMedia({audio:false})` and [`MediaRecorder`](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder); runtime WebM/MP4 format probing |
| WebM metadata | `@fix-webm-duration/fix` and parser 1.0.1; adds missing duration from the measured recording clock without re-encoding frames ([library API](https://github.com/yusitnikov/fix-webm-duration)) |
| Pose | `@mediapipe/tasks-vision` 1.1.1; Pose Landmarker Lite float16 v1, CPU, VIDEO mode, one pose; shoulders/elbows/wrists 11–16 only |
| Analysis | Shared pure `lib/quality.ts`, recomputed by the server; `motiontrial-quality-v1` |
| Server | Node 24.x [native SQLite](https://nodejs.org/api/sqlite.html), WAL + synchronous FULL; private generated video filenames; [Next Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers) |
| Validation/tests | Zod 4.6.7, tsx 4.23.15, Playwright 1.64.1; `package-lock.json` pins transitive dependencies |

The implementation uses the official [MediaPipe Web Pose Landmarker API](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js). `npm run setup:assets` copies pinned package WASM assets and downloads the [versioned official model](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task), requiring SHA-256 `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`. It writes `/mediapipe/manifest.json` with asset hashes. Model/setup failure gives a recovery message; it never enables a fabricated live-inference fallback.

Inference processes new video frames at a maximum target of 10 Hz, synchronously on the browser main thread. Sampling timestamps precede inference; recording timing anchors and source-video-relative timestamps are saved. Actual sampling rate depends on the laptop. Overlay estimates expire after 250 ms and clear immediately on no-pose/error observations; missingness is not filled with old coordinates.

Quality rules use confidence ≥0.60 for all six required points, support each observation for at most 250 ms, identify observation/boundary spacing ≥500 ms, and debounce contiguous no-pose/low-visibility signals for 750 ms. Inference errors and recording interruptions are explicit. Coverage is supported time divided by elapsed recording time, with all remaining time unknown. Confidence does not prove physical visibility or occlusion. Amplitude, speed and symmetry are absent from these rules.

| API | Behavior |
| --- | --- |
| `POST /api/sessions` | Multipart `video`, JSON `metadata`, JSON `observations`; validate, recompute analysis, stage/finalize bytes and persist; UUID retry is idempotent |
| `GET /api/sessions` | Latest 200 summaries plus whole-database `stats: {total,pendingReview,withFlags}`; queue filters operate on those latest rows |
| `GET /api/sessions/:id` | Original metadata, observations, analysis and append-only review history |
| `GET/HEAD /api/sessions/:id/video` | Server-mediated original video; MIME, byte ranges, seeking and HTTP 416 for invalid ranges |
| `PATCH /api/sessions/:id/review` | Validated disposition/note appended to history |
| `DELETE /api/sessions/:id` | Remove that session and its own video; linked sessions remain |

Video limit is 25 MiB (displayed as 25 MB), duration metadata ≤30 seconds, observations ≤1,500. Inputs have bounded JSON/request sizes, strictly increasing session-relative timestamps and finite landmark values. Off-screen normalized estimates are retained within validation bounds. Unsupported MIME/header combinations fail clearly. Mutation endpoints reject cross-origin browser requests; they do not provide authentication.

## Data retention and deletion

The default private directory is `D:\MotionTrial\MotionTrial_Codex_Handoff\MotionTrial_Codex_Handoff\data`: `motiontrial.sqlite` plus WAL files and `videos/`. Videos are outside `public/`; observations and video are separate persisted evidence. No audio is requested by the capture UI. Saved video, observations, consent/task/model versions, review notes and history remain until explicit deletion. These files are not encrypted by the app. Keep them out of source control; `.gitignore` excludes runtime data, models and generated artifacts.

Set a different writable private directory **before starting the server**, for example:

```powershell
$env:MOTIONTRIAL_DATA_DIR = 'D:\MotionTrial\private-demo-data'
npm start
```

Use one local app process per data directory. Server restarts must use the same directory to see existing records.

- Delete one session in its review page: **Delete session & video → Delete permanently**. Only that session's video, observations and review history are removed.
- Delete every database-referenced demo record with the server running: `npm run data:reset -- --confirm`. The script repeatedly calls the scoped delete API and stops/report errors rather than claiming success.
- For a complete disk reset, stop the server first. Back up the entire private directory if wanted, then use File Explorer to remove exactly the configured private data directory, including SQLite/WAL files and videos. The default directory is the absolute `data` path above; do not remove the project directory. Restarting recreates empty storage. This also removes crash-orphan files that the API cannot list.

Normal persistence failures compensate staged/final video writes. Startup restores a `.deleting` video still referenced by SQLite. Abrupt process/OS death can leave unreferenced `.pending`, final, or `.deleting` files; uncertain orphans are not automatically deleted. A stopped-server complete disk reset removes them. Cross-file/SQLite crash atomicity is a prototype limitation.

## Verification and example data

```powershell
npm run typecheck
npm test
npm run build
```

As of 2026-10-16, **42 unit/integration tests pass** (13 backend, 9 quality, 20 imitation), strict typecheck passes, and the production build passes. Tests cover time weighting/missingness, movement-amplitude independence, stale overlays, persistence/reopen, retry conflicts, failed-write cleanup, byte ranges, validation/size limits, review history, deletion, same-origin Host normalization, startup failure/recovery and counts beyond 200 records. The imitation checks additionally cover ordered full-motion matching, static-pose/one-arm rejection, per-limb phases/direction, focused small foot movement, unknown tracking, scale/aspect/timing tolerance and static-leg noise. Header-only backend fixtures are not playable-video or physical-camera evidence.

All **12 browser behaviors are verified** against the final production build in Chrome 155.0.8059.40 on Windows (NT 10.0.26200.0): 7 assessment and 5 practice checks. The full run passed 11 checks in3.2 minutes; the stationary-input fixture initially decoded a black canvas. After repairing only its video decoding and asserting real nonblack pixels, that remaining check passed in a targeted18-second run. No product rule or expected result was weakened. The moving prerecorded instructor automatically completed all four stages (57-second check), using one persistent test-camera stream and actual MediaPipe. A held real first frame had99% tracked time but repeated on stage1 with0 stages passed; a blank synthetic camera was unknown with0% tracked time and did not advance. Pausing and stopping while subsequent clips load cancel automatic starts. Missing/reversed/wrong-limb behavior is also covered by matcher tests and the real-reference diagnostic. The initial HTML report retains the fixture failure; the targeted passing evidence is under `test-results-practice-still/`. Full assessment production restart previously preserved video bytes and review history. See **STATUS.md** for evidence and **DEMO_RUNBOOK.md** for the remaining physical-camera checklist; no human-camera acceptance is claimed.

With the server running, create optional examples in a second terminal:

```powershell
npm run demo:seed
npm run test:e2e
```

The seed produces three playable 20-second **synthetic animations with generated observations and no model inference**: `SYN-NORMAL`, `SYN-LOSS` (8–11 seconds unavailable), and `SYN-SMALL`. It labels both video and records, retains existing examples, and never represents them as participant evidence. It uses installed Chrome, falling back to Playwright Chromium if installed. Browser tests use installed desktop Chrome and a running local server; they do not start the server. Playwright generates a neutral-frame Y4M virtual camera input, explicitly labels it synthetic, executes actual MediaPipe, and injects selected failure/visibility signals. No model outputs are mocked. Tests retain the seed examples, clean their own test sessions and write reports under `playwright-report/`, `test-results/`, and screenshots under `artifacts/`.

## Known limits and another presentation laptop

The full physical-camera sequence—comfortable movement, sustained tracking loss, small movement, no pose, real hidden-tab interruption, refresh/playback/seek within 500 ms, review persistence and real permission denial—must be checked on the presentation laptop. Virtual input validates software plumbing; it cannot establish tracking accuracy on a person. MediaPipe can confidently estimate an obscured wrist or miss a visible one. Never fabricate an event if the model does not report a qualifying issue.

During validation, MediaPipe occasionally returned pose estimates for Chromium's geometric synthetic test pattern. Those were retained as actual model output. Repeatable camera tests now use a labelled neutral-frame Y4M source; this is a software check, not evidence of person-tracking accuracy. A narrow off-screen headless preview also produced an empty partial recording; the UI reports that no playable video exists and prevents saving it. Actual capture acceptance is scoped to a visible desktop Chromium preview.

CPU inference can block the main thread and reduce sampling on slower hardware. Uploaded MIME/magic headers and duration metadata are checked; the server does not independently decode/probe container duration or establish that submitted observations match its pixels. Playback/alignment need browser verification. Mobile layouts are provided, but camera recording compatibility is scoped to a checked desktop Chromium browser. There is no production authentication, encryption, multi-process coordination or public/serverless deployment support.

The tested browser's MediaRecorder omits native WebM duration metadata. Capture adds the measured duration before saving, retaining video frames and recording content. If preparation throws, the original Blob is retained with a warning; the custom session timeline remains available for review. This metadata step does not independently measure or validate uploaded media duration.

To present on another laptop, copy the project source **including `package-lock.json`**, excluding `node_modules`, `.next`, `data`, test outputs and any private recordings. Install Node 24.x and Chrome, open PowerShell in that copied project directory, run `npm ci`, `npm run setup:assets`, `npm run build`, then `npm start`. Open that laptop's [127.0.0.1:3000](http://127.0.0.1:3000), grant its camera permission and execute the physical checklist there. `localhost` always refers to the computer running the browser; a URL on another host is not the laptop's local camera acceptance.
