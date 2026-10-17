# Four Point Flow and automatic follow-along

## Current game: 24 levels and three target stars

Open [the new game home](http://127.0.0.1:8766/game.html). Each of the24 original forms is a selectable level with zero to three earned stars. A card opens `follow-teacher.html?game=1&form=dual-xx`, using that form's original small steps. The level finishes at its own last step, rather than entering the next form. **Back to levels** and **Play again** appear with the result.

Both teacher and learner displays show only four colored points: left wrist15 (mint), right wrist16 (amber), left ankle27 (blue), and right ankle28 (purple). The back view remains unmirrored source video with no overlay. The mirrored front detail has four points and no body connections. The larger right camera view shows same-colored straight start/end guides, current observed points and a short live trail. Ring1 is the start, ring2 the finish, and a double H ring is a stationary hold target. Bright guides identify the current step's required hand or foot; other available guides are optional visual orientation.

The game compares the four points only. Shoulders and hips remain hidden internal anchors for camera aspect, body position and torso scale; elbows and knees are not required by the game matcher. Raw anatomical IDs never swap when a preview mirrors. All source points, videos and older practice rules are preserved.

### Closer teacher framing

The lesson automatically crops the surrounding scenery from both teacher views. Each view uses a stable rectangle for the entire routine, retaining room for extended hands and feet without a moving camera or extra controls. The front rectangle is normalized source `(x .30, y .18, width .40, height .73)`; the back is `(.29, .14, .42, .77)`. The cropped image keeps its original proportions, including when enlarged or shown on a phone. The enlarged view is capped at 65% of viewport height.

The front video and its four-point overlay occupy one shared source plane, which is cropped and mirrored together. The back is still unmirrored, with no overlay or back-pose requests in the browser. Original media bytes, raw coordinates, camera framing and all matching rules remain unchanged. No new video encoding or MediaPipe extraction is needed.

`node scripts/audit-teacher-framing.mjs` audits the existing 48 observation files against the display rectangles. All 225,109 trusted front points and 216,389 trusted back points are within the rectangles. This is source-coverage evidence rather than a claim about missing observations or every clothing/hair pixel. Raw extreme frames also require visual review. Evidence is kept separately in `artifacts/teacher-crop-review/`.

`node scripts/check-teacher-crop.mjs` verifies preservation, actual source-point coverage, browser geometry, mirroring, swaps/enlargement, phone layout and real video phase playback. Its camera regression uses an explicitly labelled prerecorded source with genuine local MediaPipe; it does not claim physical learner acceptance. Seven functional groups pass, and eight actual extreme source frames were visually checked for head/hand/foot margins. The additional .45-threshold audit retains481,071 actual body-point observations with no clipped points. See `artifacts/teacher-crop-review/verification-summary.json`. Distant viewing comfort still requires the learner's actual screen and room.

`four-point-slide-v1.0` is an intentionally forgiving point-acquisition game. A required moving point must first be observed near its start, make a small same-side forward slide and reach its end. Tiny source changes become explicit hold targets, rather than claims that a foot lift or complete Tai Chi movement was verified. Fresh matching held for700ms collects the step. Retries,321 preparation,3-second feedback, pause and camera cleanup remain automatic. Unknown tracking never collects a target. Unusable source steps play three rounds, then remain not assessed.

Guides are **designed straight connections**, not reconstructed observed trajectories. `observed-endpoint-medoid-v1.0` chooses actual source observations supported by at least two confident points in short start/end windows, reducing individual-frame jitter without fabricating a missing limb. Each guide retains its source frame support. Across172 original steps,99 have usable required focus endpoints and54 have all four endpoint pairs. Missing guides are clearly marked **Reference unavailable**; other valid guides continue. Recorded-source endpoint replay matches91 references; these counts are software/source evidence, not human accuracy. Levels20 (Fan Through the Back) and22 (Apparent Close-Up) currently have no scorable source targets, so the map marks them **visual practice only**. All24 levels remain accessible, with66 available target stars across the other22 levels.

### Stars and local progress

Before a level begins, its source-eligible targets are fixed from the unchanged front data. One third collected earns one star, two thirds earns two, and all earns three. Stars accumulate across visits from distinct actually observed target completions. Source visual-only steps are shown separately. Learner occlusion, unknown results and manual skips never earn stars or reduce the fixed target denominator. A level with no eligible targets earns no stars.

Only target IDs and aggregate game progress are saved under `motiontrial.four-point-game.progress.v1` in this browser's local storage. Camera video and observations are not saved or uploaded. Closing the page, stopping the camera or reaching a level result releases capture. If local saving is blocked, the page reports that limitation. The old assessment/practice data is not changed.

### Game verification

Current checks use `scripts/check-four-point-game.mjs --static`, `--home`, `--browser`, and `--camera`. Browser controls/whole-level completion use explicitly labelled recorded-landmark fixtures; these are separate from genuine local MediaPipe on the labelled front-video camera replay. Actual-model testing verifies four-point rendering, same-anatomical-side target collection, automatic step advancement and Stop cleanup. Desktop/mobile home and guide screenshots are inspected. New matching/storage tests run with the full104-test unit/integration suite; TypeScript passes.

Evidence is under `artifacts/four-point-game-review/`, with final report `verification-summary.json`. Original two-page hashes,59 protected old resources, both source videos and seven model/WASM hashes remain unchanged. A physical learner, deliberate wrong-side attempts, different bodies/camera placement/lighting and two real devices still need human acceptance. Game stars are not Tai Chi correctness.

Build only the new point-game bundle when needed:

```powershell
node scripts/build-four-point-game.mjs
npx tsx scripts/build-game-levels.ts
npm run typecheck
npm test
node scripts/check-four-point-game.mjs --static
node scripts/check-four-point-game.mjs --home
node scripts/check-four-point-game.mjs --browser
node scripts/check-four-point-game.mjs --camera
```

## Original automatic routine

The plain `follow-teacher.html` URL now defaults to the point game as well. The earlier automatic full-routine comparator and navigation remain available at `follow-teacher.html?mode=routine`, with the simplified four-point display. The home page's `game=1` links select a specific level. Earlier source audits and browser reports below are historical evidence for the automatic routine.

Open [Follow the teacher](http://127.0.0.1:8766/follow-teacher.html). The page starts a **3-2-1 countdown and automatic video preview**. Choose **Start practice** once to request your camera and start camera-guided practice. The camera permission decision remains yours; opening the page never requests permission.

The original back recording is the unmirrored main guide, with simultaneous mirrored front detail. The front skeleton mirrors together with its video. Main/detail swap, enlargement and restoring both views remain available. The original 24 forms / 172 microsteps and reviewed phase mapping are unchanged.

## Automatic cycle

`Get ready -> 0.5x demonstration -> up to four seconds to finish -> advance or three-second feedback -> retry`

- A continuous **700 ms** of fresh observed matching evidence advances automatically. A new step gets its own three-second countdown.
- An observed incomplete movement shows **Estimated action progress**, a specific reason and short per-limb observations. The window closes after **three seconds**, then the current step replays. No confirmation is needed.
- Missing, low-confidence, stale (>450 ms), interrupted, off-screen or ambiguous learner tracking gives **Unable to judge**, with no percentage. It never marks a pass or skips an otherwise usable reference. A fresh movement beginning is required after tracking loss.
- A teacher reference that cannot support comparison plays **three complete demonstration/buffer/feedback rounds**, then continues as **not assessed**. This is never an observed match. A failed-to-load asset is separately unavailable; it is not silently treated as a valid three-round reference.
- **Pause / Resume** freezes video and all automatic timers. Movement evidence clears on pause. **End** cancels pending transitions, clears the window and releases the camera. Hiding the page pauses practice and stops the camera; restart the camera explicitly when ready.
- The last step ends the session, releases the camera and reports matches separately from not-assessed steps. Progress is only in page memory and clears on reload.

Stand far enough back for your full body to fit the camera, with the camera beside the screen facing you. Device, preview, form, speed and manual controls are folded away by default. Manual Next is a **skip**, never a model pass. A lesson can still be inspected and navigated without a camera; video preview cannot manufacture observed matches.

## What the estimate means

Comparison remains **original front teacher points versus raw unmirrored learner camera frames**. Anatomical identities are never swapped. Existing `guided-endpoint-relaxed-v1.0` body translation, torso scale, aspect handling and broad thresholds are unchanged.

The isolated `follow-teacher-anatomical-v1.0` guard requires each source-active anatomical focus to contribute visible movement. Right-foot movement cannot replace required left ankle 27 evidence. The automatic controller uses `follow-automatic-v1.0` and the unchanged fresh-observation hold helper.

`follow-checkpoint-progress-v1.0` describes estimated observed checkpoints, not Tai Chi correctness. Movement steps combine:

- 20%: a valid movement beginning was observed;
- 40%: projected displacement of every required same-side limb, divided equally across active limbs;
- 40%: current target-pose proximity using existing body-normalized endpoint bounds.

Posture-only completion steps use target proximity alone. Unknown evidence produces **no number**. Failed attempts are below 100; a briefly matched target that has not met 700 ms is also capped at 99 in retry feedback. One moving limb cannot hide a missing second required limb. Visibility and detection confidence never contribute as action progress. Full weights remain in diagnostics and this document; the distant-view feedback window uses short observations.

Palm orientation, actual weight distribution, balance, force and depth are not reliably assessed. The existing two-recording alignment has approximately +/-0.5-0.75 s editorial phase uncertainty, rather than calibrated simultaneous capture.

## Data and privacy

Local pinned MediaPipe/model/WASM assets and genuine teacher observations are reused. The back view uses only its original video and reviewed time map: back landmarks are neither loaded, deleted nor regenerated. No camera video, landmarks or progress are recorded or uploaded. The page's `connect-src 'self'` Content Security Policy blocks installed SDK external telemetry attempts; actual-browser tests verify the block. Existing SDK files and global practice helpers are unchanged.

The previous real-record source audit found 78 of 172 references with sufficient required focus evidence. Same-record trace replay returned 73 match / 0 mismatch / 99 unknown. These are source-evidence software results, **not learner accuracy**. Ninety-four references lack an adequate target/span/change; five more lose the movement beginning after interruptions. The first 0.5-second left-foot-lift window is too subtle to judge, so it demonstrates three rounds and continues unassessed. The next left-step-out window has usable left-foot evidence.

## Actual validation

Automatic browser checks cover countdown, preview without permission, continuous 700 ms matching, estimated progress, real three-second feedback, retries, unknown input, three complete unassessed rounds, timer freeze/resume, End cancellation, final-step finish, phase mapping, mirror/layout controls and desktop/390 px mobile windows. Additional recovery checks cover pausing just after timer expiry and canceling camera startup while the local model is pending; late callbacks cannot restart an ended session.

Genuine local MediaPipe on a **clearly labelled front.mp4 camera replay** automatically advances the production page's left-step-out reference from step 2 to step 3. Generated black frames exercise real no_pose; paused-stream faults exercise stale clearing. This is separate from explicitly labelled recorded-landmark/control-timing fixtures for deterministic orchestration. Simulated second-device selection exercises release and exact selection but is not two physical cameras.

The 87-test unit/integration suite, TypeScript and JavaScript syntax checks pass. Before/after SHA-256 checks preserve 59 protected old files, both original videos and seven local model/WASM assets. The old HTML hashes remain:

- dual-view.html: `b0a00ead68678258793c0a553541fe6f95166c927a749946bf9e758d22f69360`
- study-3d.html: `08f787b37cc90490620561312a6311fee3ccf428f791ad290fc34ad4d43c62fc`

Remaining acceptance requires an actual learner, deliberately wrong left/right actions, real permission prompts, two physical cameras and indicator cleanup, varied bodies/lighting/clothing and mobile hardware. No physical-human or expert Tai Chi acceptance is claimed.

## Run and reproduce

Use the existing local static server. If port 8766 already serves this project, open the page directly:

```powershell
node scripts/serve-dual-view.mjs
```

Current automatic-mode checks (old self-paced browser scripts describe the superseded interface):

```powershell
node scripts/build-follow-teacher.mjs
npm run typecheck
npm test
node scripts/check-follow-teacher-auto.mjs --browser
node scripts/check-follow-teacher-auto.mjs --camera
node scripts/check-follow-teacher-auto.mjs --mobile
node scripts/check-follow-teacher-auto.mjs --static
node scripts/check-follow-teacher-auto-recovery.mjs
node scripts/verify-follow-camera-lifecycle.mjs
```

Reports, hashes and inspected labelled screenshots are under `artifacts/follow-teacher-auto-review/`. `verification-summary.json` binds final implementation hashes to results and limitations. The camera replay fixture remains at `artifacts/follow-teacher-review/qa-prerecorded-front-with-black-gap.y4m`; earlier source audits and self-paced evidence remain preserved there.
