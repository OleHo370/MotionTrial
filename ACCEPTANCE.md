# Acceptance and validation

This document is an implementation target. None of these checks has passed merely because this handoff exists. Record actual results in STATUS.md.

## Core behavior

1. A new user can understand the demo purpose, data retention and 20-second task before camera capture; consent is explicit and audio is off.
2. Model load, camera permission and recording capability have truthful, distinct states. A model load failure does not silently enable synthetic live inference. Working model but no detected pose can be recorded with a visible tracking warning.
3. Actual source video is recorded separately from observations. Stop/abort and hidden-tab interruption have documented outcomes. Camera tracks stop after exit.
4. Upload shows progress/saving/failure, keeps the browser recording available for retry, and uses an idempotent session ID. Retrying must not create duplicates.
5. A saved session survives page refresh and application restart. Video exists, plays and seeks through the session video endpoint; files are outside public/.
6. A new assessment can be opened in the participant view and reviewed in the researcher view using shared backend data. Both views are labelled demo views rather than protected accounts.
7. Event markers contain a reason and an interval. Clicking seeks to the matching video moment within 500 ms on the actual presentation browser.
8. Review disposition/note persists through refresh; a new decision appends history; recapture links a new session without overwriting the original.
9. Session-level deletion removes only that session and its video, with a deliberate UI action. Failed persistence and deletion states are not reported as success.
10. Provenance distinguishes live camera, prerecorded source-video demos, and synthetic examples. A generated animation is never represented as real participant evidence.

## Meaningful unit/integration checks

- Time weighting: use a short fixture with a known valid interval and a long missing interval. The long gap must reduce coverage even if many valid observations precede it.
- A 4-second gap between samples is mostly unknown, not four seconds of continuously valid tracking. No-pose and inference errors end valid support. End-of-recording boundaries are clipped and intervals are not double-counted.
- A low-visibility/no-pose interval exceeding the configured duration produces the correct timestamped event. A brief transient follows the documented debounce rule.
- Small-amplitude and large-amplitude fixtures with identical observation confidence and timing have identical QUALITY classification. Do not assert exact repetition counts as a proxy for this check.
- Missing values are null/unknown; never output fabricated angles, old coordinates during a lost-tracking state, NaN or Infinity.
- Non-monotonic or out-of-bounds timestamps, unsupported video types, empty/oversized uploads and invalid decision enums are rejected clearly.
- Duplicate save retry creates one durable session; a simulated write failure does not leave a 'saved' record pointing to no video.
- The source-video endpoint handles seek byte ranges with consistent MIME and appropriate invalid-range behavior.
- Review-save integration reads back the updated review state/history from the backend, not only local React state.

Use the smallest useful test suite. Avoid tests that merely restate constants or component internals.

## Browser workflow checks

Use Playwright or an available browser testing tool with a clearly labelled prerecorded/virtual-camera input for repeatable integration checks. Verify capture/save/refresh/playback/event seek/review persistence. Verify queue empty/loading/error states and failed camera/model/recorder/upload handling. Report what the virtual camera does and does not establish.

Check the visual result at approximately 1440x900 and 390x844. Participant flow must remain usable on a narrow viewport; actual P0 recording compatibility is promised only for a tested desktop Chromium browser. Verify focus, labels and disabled/loading behavior, not just a screenshot of the landing page. Check that source-video and optional overlay remain aligned under resizing and mirrored-preview choices.

## Required human checks on the presentation laptop

| Case | Action | Expected result |
| --- | --- | --- |
| Normal | Record 20 seconds of comfortable seated upper-limb movement | Playable source video and traceable observations; actual summary, no prefilled result |
| Missing tracking | Move a wrist out of frame or obscure it long enough | A heuristic tracking review flag if model output warrants it; video supports manual verification; no forced certainty about occlusion |
| Small movement | Keep upper limbs in frame and make small comfortable movements | Data retained; small amplitude alone causes no quality rejection |
| No pose | Leave the camera view | Unknown/no-pose interval, no fake skeleton or crash |
| Interrupted | Hide tab or stop mid-recording | Explicit interruption/partial-recording state, no invented continuous coverage |
| Replay | Refresh, open saved session, click a flag | Real video persists; marker seeks to the corresponding interval within stated tolerance |
| Review | Save Uncertain or Request recapture with a note; refresh | Decision and history persist |
| Permission denied | Deny camera access | Readable recovery action; no empty recording labelled successful |

If a deliberate wrist occlusion remains confidently tracked, do not fabricate an event to match the story. Record the model limitation and use a genuinely detectable tracking-loss example for demonstration. A heuristic's false negatives and false positives are evaluation results.

## Evidence to report

At completion: exact startup commands, actual dependency/model versions, changed features, test/build results, browser/OS used, physical-camera checks done or still pending, event/video alignment observations, model limitations, and data reset instructions.

The prototype does not establish clinical validity, sensitivity/specificity in patients, safety for clinical use or coordinator time savings. An actual evaluation could use manually labelled authorized clips and measured review times. Do not invent those measurements for the presentation.
