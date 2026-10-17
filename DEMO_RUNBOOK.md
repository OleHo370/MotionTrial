# Current 24b video library and camera check — 2026-10-16

1. Open `http://127.0.0.1:3000/practice?mode=forms&routine=24b`. Confirm **Training video** shows the new indoor recording and there are 24 movements. Wait for **Reference analyzed locally**, then use **Preview reference** to inspect its real skeleton.
2. In the right panel choose the intended **Camera**, choose **Start camera**, and allow browser access. Keep **Show my skeleton** and **Show instructor guide** enabled. Stand back with hands, hips and feet visible. Confirm the mint joints follow the actual person and the dashed amber guide is aligned to the same body. A prerecorded browser fixture is not this physical check.
3. Toggle each skeleton independently; confirm mirroring flips the image and both overlays together. If no skeleton appears, inspect the tracking message and camera choice. Missing poses must clear, not freeze or turn into a demo skeleton.
4. Start practice, follow one complete movement, and inspect matching/retry. Check real approximate imitation, a held pose, missing hands/feet, timing differences, and transitions. Relaxed thresholds need human calibration; repeated/out-and-back forms have known reversed-trajectory false matches.
5. Switch **Training video** during practice. Confirm the attempt stops, progress resets, the new reference prepares, and the current camera stays running. Change **Camera** and confirm the old device releases before starting the newly selected device. **Stop camera** must release the device and clear both right-side overlays.

# MotionTrial presentation runbook

## Default: one small teaching step at a time

Open `/practice`, keep **Step-by-step learning**, and choose **Form 02** for the user's difficult case. The original outdoor form is divided into 15 observable steps; the whole routine has 196.

Choose **Watch slowly**. Explain one small visible goal, then let the half-speed clip stop. The target remains while the learner copies it, without countdown or automatic retry. **Next step** is the learner's own confirmation, and begins the next short demonstration. Use **Replay step**, **Previous step**, **Pause**, and **0.25×** whenever helpful.

Optionally start the camera for amber instructor/mint live skeletons together. **Auto advance when close** is opt-in, with a broad final-pose range and brief stable evidence. Missing points cannot automatically pass. Manually continue whenever the source view or camera tracking is unclear; a manual confirmation is not a motion-quality score. Automatic progression is not guaranteed for every endpoint.

Human checks remain: try the complete second form, then a kick and low-stance sequence. Confirm each boundary is understandable, the cue describes the visible action, and the target can be copied at a comfortable range. Check mirrored/unmirrored display, camera choice and release on mode switch. Record confusing cues or misplaced boundaries before changing the source-reviewed map. Automated replay does not establish human teaching outcomes.

## Current 24-form practice demo

Open `/practice` on the local server after `npm run build` and `npm start`. Keep `public/practice-media/` with the project. The source is the user's `24.mp4`; all 24 named forms use their actual, different durations and original speed. Boundary evidence is in `artifacts/source-24-review/BOUNDARIES.md` and `boundaries.json`.

Wait for reference readiness, preview the current form, then choose **Start camera**. Frame the full body. Explain the right panel: **amber dashed = instructor guide**, **mint = your detected movement**, aligned by hips and torso size. The source video remains on the left. Leave **Relaxed** selected, then **Start practice**. A complete approximate match automatically advances; missing tracking or an incomplete attempt repeats this form. Use the numbered strip to choose a particular form, which does not mark it passed. Show **Pause**, **Show instructor guide**, **Mirror preview**, and **Stop camera**.

### Physical-camera checks — pending human execution

- Try ordinary approximate imitation for the opening, a turning form, a repeated form such as cloud hands, and a leg-focused form. Check that tolerance feels forgiving and record any false rejection or false pass before tuning thresholds.
- Verify both colors are visible in the same right-hand frame and follow the same reference phase. Move closer/further and sideways: the guide should follow the observed hip position and torso size. Mirroring must flip camera and both overlays together.
- Hold still or omit the principal limb movement: no automatic pass. Leave the frame or cover required points: unknown/retry, no lingering guide or old live skeleton.
- Select the final form first: selection does not add progress; a single pass must not claim all 24 are complete. Resume the unpassed forms automatically.
- Pause during countdown/retry/next-reference loading; stop camera, switch tabs, and leave the page. Automatic starts should stay canceled, and Stop/leave should release the camera light. Deny then reallow permission and verify recovery.

Automated recorded/synthetic test cameras are software evidence. They do not establish human-camera tracking accuracy or calibrate pass sensitivity. The page records/uploads no camera data. Reference pose files are saved observations of recorded instructor clips; learner samples and progress remain in memory.

## Historical four-stage practice demo — 90 seconds

Use [127.0.0.1:3000/practice](http://127.0.0.1:3000/practice). Start with `npm run build`, then `npm start` in the project root. On a different computer, first copy `public/practice-media/` as well as the source/lockfile, install Node 24/Chrome, run `npm ci` and `npm run setup:assets`. This demo runs locally, without a remote host.

Preflight: wait for reference analysis, allow the physical camera, arrange enough room to keep the entire body visible, and use Preview reference once. Order: lift the left foot, step out to the left, lift both arms, press both hands down. Every output is 4 seconds; source-speed changes are disclosed in clip details. These are four stages of the opening. The arm clip is preserved as stage 3; new stages come from the longer supplied tutorial. No user video is recorded or uploaded on this page. Original videos are untouched.

| Time | Action and words |
| --- | --- |
| 0–12 s | Show the two panels and four stages: “Left is a recorded instructor clip with real MediaPipe estimates. Right is my camera, also analyzed locally. We practice four stages of the opening.” |
| 12–22 s | Preview the first stage: “Start with feet together and lift the instructor’s anatomical left foot. The next stages are step out, raise both arms, and lower both hands.” |
| 22–60 s | Start camera, frame hands and feet, then Start practice. Follow each 3-second countdown and 4-second movement. A passing stage marks Passed and automatically prepares the next clip. New reference analysis may add time; read the actual progress. |
| 60–72 s | Read the actual outcome. A match advances; an observed mismatch repeats only that stage; insufficient tracking is unknown and also repeats. Do not promise a pass or substitute a fabricated result. |
| 72–82 s | Show Pause and Stop camera: “Pause cancels even a pending transition; Stop releases the camera. Matching checks ordered movement of the relevant leg or arms.” |
| 82–90 s | “All movements complete appears after four passes. Back to first movement starts another round. These prototype thresholds still need calibration with a person on this laptop.” |

### Practice physical-camera checklist — all pending

These are not covered by the automated prerecorded/synthetic camera checks. Record actual browser, camera, lighting, result and any threshold adjustment in STATUS.md. Keep the movement comfortable and stop if needed.

- Full body visible: confirm the actual person can complete all four stages and the overlay stays aligned. Confirm left foot/side labels, starting poses, natural transitions and adequate countdowns.
- Still first pose, the wrong foot, only one arm moving, reversed sequence and a clearly different movement: confirm a full-movement match is not reported for any stage.
- Leave the frame or obscure a required joint: confirm unknown/retry and no old live skeleton after 250 ms.
- Repeat at modestly different speeds and body sizes: inspect both completion and rejection; current thresholds have no measured accuracy claim.
- Try the optional mirror setting: video/overlay stay together, anatomical left/right policy remains clear.
- Pause during countdown, retry and next-stage loading; hide/return to tab, Stop camera and leave page: confirm automatic starts stay canceled and the camera light goes off after Stop/leave. Back to first movement should reset completed progress.
- Deny/reallow camera permission on the actual browser; confirm recovery. Verify the desktop stage fits and the model keeps up with this laptop.

Practice data deletion: camera video, pose samples and progression are in page memory only; Stop camera releases capture and reload clears samples/progress. To delete the generated reference playlist after stopping the app, remove only `public/practice-media/`; keep the original MP4s. Assessment data deletion is described below and remains separate.

## Retained assessment demo

The remainder is the original recording/review runbook and is still applicable to the assessment routes.

## Before the clock starts

Use the presentation laptop's desktop Chrome and its own authorized camera. Complete the manual checks below first; record results in STATUS.md. Do not claim physical-camera validation from a synthetic/virtual input test.

1. In PowerShell open `D:\MotionTrial\MotionTrial_Codex_Handoff\MotionTrial_Codex_Handoff`, run `npm ci`, then `npm run setup:assets`. Build with `npm run build`, then leave `npm start` running.
2. Open [MotionTrial](http://127.0.0.1:3000). Confirm the queue is using the intended private data directory and has no unauthorized recordings. Check the exact source provenance of every example you plan to show.
3. Read the task and consent notice in advance. Test camera permission and local-model readiness, lighting and upper-body framing. Do not ask for a larger, faster or more symmetric movement. The fixed 20-second task is unchanged.
4. Optionally run `npm run demo:seed` in a second terminal. It creates `SYN-NORMAL`, `SYN-LOSS` and `SYN-SMALL` as explicitly labelled animations with generated observations and no inference. They illustrate deterministic rules; they are not real participant evidence.
5. Have a genuinely model-flagged authorized camera recording ready if one has been verified. If not, use the labelled synthetic example for the rule explanation and say so. Do not promise a wrist obstruction will produce an event.

On another laptop, copy the source/lockfile without `data`, `node_modules`, `.next` or private recordings, then perform the same installation and physical checks there. This implementation runs locally on the user's Windows `D:` drive; no remote deployment is needed.

## 90-second script

The participant should already have read the instructions before this timed presentation. Model loading and camera permission can vary; finish the preflight rather than claiming a guaranteed startup latency.

| Time | Action | Suggested words |
| --- | --- | --- |
| 0–10 s | Show the queue and separate capture-quality/human-review columns. | “MotionTrial helps a coordinator find possible recording or tracking problems, inspect the actual video, and document a human decision. These are demonstration views.” |
| 10–18 s | New assessment; demo code, consent; choose **Live physical camera** and show camera/model readiness. | “The task and consent are fixed. We record video without audio. Saved video and observations stay on this local server until explicitly deleted.” |
| 18–38 s | **Start 20-second recording**; let the fixed task run. | “Move only within a comfortable range; pausing is allowed. Small, slow or asymmetric movement is not a capture-quality failure. The pose model is running locally; unavailable tracking is unknown.” Do not give adaptive movement coaching. |
| 38–51 s | **Save recording → Open researcher review**; play the source video. | “This is the original recording, stored separately from estimates. The server recomputes the quality summary and the saved recording survives refresh.” |
| 51–65 s | Open a previously verified real tracking-loss case, or explicitly labelled `SYN-LOSS`; click its event and show the source interval. | For real evidence: “This is a heuristic signal from this saved clip; inspect the video before interpreting it.” For seed data: “This animation and its generated observations are synthetic. Its 8–11 second gap demonstrates timeline seeking, not live tracking accuracy.” |
| 65–76 s | Show a verified small-motion camera case or explicitly labelled `SYN-SMALL`. | “Movement amplitude is absent from the quality rules. Trackable small motion remains usable for human review. This example's provenance is shown here.” |
| 76–90 s | Select **Uncertain**, enter a short evidence note, **Save review decision**, refresh, and point to history / **Linked recapture**. | “The reviewer records uncertainty instead of forcing certainty. Decisions append history; a recapture creates a separate linked session. No clinical validity or measured time saving is claimed.” |

If recording or upload fails, show the truthful failure and recovery action. The unsaved Blob remains in the current tab for retry; do not close/reload that tab. If the camera/model is unavailable, explicitly switch the demonstration to labelled saved examples and report the live step as incomplete.

## Physical-camera acceptance checklist

All rows are **pending human execution** until an actual result is recorded in STATUS.md. Use pseudonymous codes and only authorized demonstration footage. Record browser version, OS, video/session ID, outcome and any discrepancy. The participant can pause or stop at any time.

| Case | Action on presentation laptop | Required observation |
| --- | --- | --- |
| Normal | Choose physical source, consent and record the complete 20-second task. Save, refresh, then stop/restart the app and reopen. | Actual source video plays; observations/model/task provenance are present; results are computed, not prefilled. No audio track. Saved data survives restart. |
| Tracking loss | In a separate planned demo attempt, let a wrist leave view or become obscured long enough; inspect actual model output. | A qualifying low-visibility/no-pose event appears only if warranted. The reason and interval are inspectable. Confident but wrong tracking is a documented model limitation, not a reason to manufacture a flag. |
| Small movement | Keep the upper body visible and make small comfortable movements. | Recording is retained. Small amplitude alone does not change quality classification; genuine tracking issues may still be flagged. |
| No pose | In a separate authorized attempt, leave the camera view. | Tracking becomes unknown. Previous coordinates are not frozen/drawn as current. Sustained model-reported missingness is localized. |
| Real interruption | Stop early, then separately hide the browser tab during recording. | Playable partial video where the recorder can produce it; explicit interruption reason/event; no claim of continuous tracking. Abort intentionally discards. |
| Source/overlay | Replay with overlay off/on, resize the window; verify left/right correspondence. | Original video remains available; non-mirrored source and estimates align. Lost/error/stale estimates clear. |
| Event alignment | Pause; click a real event marker; compare player time with the event start. Inspect surrounding source frames. | Player seek difference ≤500 ms on this browser. Record the measured difference. UI seeking alone does not establish person-tracking accuracy. |
| Review/recapture | Save **Uncertain** or **Request recapture** plus note; refresh; save a second decision; create a linked new recording. | Both decisions remain in history. New session links to original; source record is retained. |
| Permission denied | Revoke/deny the origin's camera permission, reopen setup, then re-enable and retry. | Actionable camera error and retry; recording stays disabled while unavailable. No success-labelled empty recording. |
| Device/model/recorder failure | Disconnect camera; separately block/unavailable local model assets or use a browser without recorder support. | Separate truthful camera/model/recorder states and recovery text. No fabricated model output. Partial evidence is retained if available. |
| Upload retry | Record, temporarily block upload/server connectivity, choose Save, restore connectivity and retry in the same tab. | Failure is visible, Blob remains playable, same session UUID retries, one durable record. |
| Resource cleanup | Exit/discard after setup or a recording; check the browser camera indicator and hardware light. | Tracks stop and camera resources release. Unsaved navigation is deliberately handled. |
| Delete | Delete a disposable test session through both UI confirmation steps; check queue/API and another session. | Deleted video/detail are unavailable; only chosen session disappears; linked/other sessions remain. |
| Layout and access | Inspect around 1440×900 and 390×844; tab through consent, capture, timeline and review controls. | Readable controls, visible focus/labels, honest disabled/loading/error states and no obstructing horizontal overflow. Recording compatibility remains scoped to desktop Chromium. |

## Verification evidence and reset

`npm test` has 42 passing unit/integration checks (22 assessment, 20 imitation) and the production build/typecheck pass. Browser tests require a running local app, installed Chrome and seeded assessment examples: `npm run demo:seed`, then `npm run test:e2e`. Consult STATUS.md for the actual latest browser results; tests use synthetic/prerecorded virtual camera input, not a person. Selected camera/model/recorder/network failures are injected. A simulated visibility signal does not replace the real hidden-tab check above.

Saved demo data persists. Delete a session using **Delete session & video → Delete permanently**. For all database-referenced sessions, with the server running use `npm run data:reset -- --confirm`. For a complete reset including any abrupt-crash orphan files, stop the server, optionally back up, then remove exactly the private data directory in File Explorer. Default: `D:\MotionTrial\MotionTrial_Codex_Handoff\MotionTrial_Codex_Handoff\data`; if `MOTIONTRIAL_DATA_DIR` was set, use that exact directory instead. Do not delete the project directory. Keep one server process per data directory.

The server validates upload sizes/types/headers and duration metadata; it does not independently decode/probe the uploaded container or establish pixel-to-observation correctness. CPU model speed and tracking reliability depend on device, framing and lighting. This prototype does not establish clinical validity, patient accuracy or coordinator time savings.
