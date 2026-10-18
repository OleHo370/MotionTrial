> Archived development notes. For the current app, see the [project README](../../../README.md) and [documentation index](../../README.md).
> Source paths and commands below are relative to the repository root.

# Engineering plan

## Default architecture

For a new project use Next.js, TypeScript and Tailwind. Reuse an existing compatible stack rather than migrate for preference. Use a Node runtime, one SQLite metadata database and a configurable writable data directory containing videos outside public/. Pick a minimal SQLite adapter compatible with the installed Node version. Verify current framework and MediaPipe APIs in official documentation before implementation; do not invent package versions.

This is a localhost application with real server persistence. SQLite and video files require a writable local/persistent disk. This design is not automatically suitable for ephemeral serverless hosting. Default run instructions must bind to localhost. Public deployment is not requested.

Prefer working in the project directory on the presentation laptop. If implementation happens in a remote Codex environment, distinguish its runtime/preview address from the laptop's localhost and give explicit local checkout/run instructions. Physical-camera acceptance must occur in a browser that can access the presentation laptop's camera. Retain saved demo data until explicit session deletion or a deliberate demo reset; disclose this behavior before capture.

Browser responsibilities: getUserMedia (audio disabled), MediaRecorder, MediaPipe Pose Landmarker, source-video preview, consent, timestamped observations and upload retry. Server responsibilities: bounded input validation, video persistence, deterministic analysis, session retrieval, video streaming and reviewer decisions.

Prefer locally served, pinned model and WASM assets. Record model/source/version in setup documentation. If assets cannot be fetched, provide an actionable model error and log the blocker; never replace live inference silently with generated coordinates. Ensure UI remains responsive; test an appropriate worker or a bounded, throttled inference loop. Process new frames only and retain capture timestamps, not inference completion times.

## Minimum routes and API

UI: / (overview/queue), /assess/new (briefing/setup/capture), /sessions/[id] (review), optional /about (methods).

| API | Responsibility |
| --- | --- |
| POST /api/sessions | Multipart video + metadata + observations, schema validation, analysis recomputation and durable save |
| GET /api/sessions | Bounded queue with separate analysis/review states |
| GET /api/sessions/:id | Metadata, observations, quality events, review history |
| GET /api/sessions/:id/video | Lookup by session ID; correct MIME and byte-range support for seeking |
| PATCH /api/sessions/:id/review | Validate disposition/note, append history, retain original recording |
| DELETE /api/sessions/:id | Explicitly remove the session and its own video; never accept arbitrary filesystem paths |

Use Route Handlers or equivalent explicit upload endpoints rather than an unexamined default upload size limit. Use generated server filenames; never interpolate user input as paths. No public upload exposure or permissive cross-origin configuration is required.

## Record model

- Session: client-generated UUID/idempotency key, pseudonymous demo code, provenance (live_camera / prerecorded_demo / synthetic_demo), consent timestamp, recordedAt, actual duration, capture completion/interruption state, original instructions/task version, model/configuration version, quality-rule version.
- Video: server-generated file key, supported MIME, verified size, duration, saved/pending/failed state. Maximum upload 25 MB; maximum demo assessment 30 seconds, default 20 seconds. Probe MediaRecorder format support at runtime; prefer a tested Chromium-supported format.
- Observations: session-relative tMs, source-video timestamp if available, observation status, and only needed upper-limb landmarks (11–16), with finite normalized coordinates and confidence/visibility fields. Include explicit no_pose/errors; do not store only successful detections.
- QualityEvent: type, startMs, endMs, affected points, reason, rule version. End must be after start and within the recording.
- ReviewEntry: disposition, note, timestamp, demo reviewer label; append rather than silently erase history.

Generate one UUID before submission; retry the same request idempotently. Keep the browser Blob until success. Stage the video, validate, and finalize the video/database record with compensation cleanup on failure. A session must not appear saved if the video is missing. Bound file size, observation count, timestamp range, monotonicity and JSON size. Recompute summaries on the server rather than trust client totals.

No video, database, secrets or real-person recording is committed to git. Generated/consented demo clips need explicit provenance and a documented retention/reset path.

## Analysis rules

Implement a pure shared analysis module so it can be tested independently and used server-side. Use time-weighted coverage; a count of successful inference calls is not coverage.

Initial configurable engineering parameters: target 10 observations/second, visibility threshold 0.6, maximum valid-observation hold 250 ms, sampling-gap threshold 500 ms, sustained low-visibility/no-pose flag minimum 750 ms. These are prototype defaults, not clinical thresholds. Document rule behavior and units in one configuration module.

Each valid observation may cover time until the next observation or maximum hold, whichever comes first, clipped to the recording bounds. Unobserved remainder is unknown. Compute the union of valid intervals / elapsed recorded duration; do not double-count overlapping intervals. A no-pose/error observation ends prior valid support at its timestamp. Do not fill gaps or use stale coordinates as live overlays. Return explicit unknown/insufficient-tracking states when appropriate.

Use one session-relative monotonic clock shared by video and analysis. Record timing anchors. Convert times to playable media positions and verify alignment within 500 ms on the actual demo browser. Treat hidden-tab events and recorder/inference interruption explicitly; preserve the partial video if possible and label it interrupted. Stop media tracks and release model resources when leaving the flow.

## Milestones

M0: Inspect repository, preserve applicable instructions, record assumptions and commands, verify camera/model/recorder constraints. Do not block on aesthetic choices.

M1: Ship the first vertical slice: polished basic shell, consent/briefing, actual video capture, backend persistence, queue, saved-video playback. A temporary 'analysis pending' state is honest; fake inference is not.

M2: Add real browser MediaPipe inference, observation timeline, deterministic quality analysis, focused tests for missingness/time-weighted coverage and low-amplitude independence.

M3: Add quality timeline seeking, evidence explanations, overlay toggle, persistent manual review, linked recapture and the three labelled demo cases. Use a real source video for a video-evidence claim; an animated/synthetic fixture is explicitly labelled and is not physical-camera validation.

M4: Handle permission/model/recorder/storage failures; refine responsive design/accessibility; run end-to-end and real-camera checks; verify local production build/start; prepare README, demo runbook, limitations and validation evidence.

After each milestone, update docs/development/STATUS.md with checks actually run, observed outcomes, remaining issues and the next action. Fix discovered failures before expanding scope. Deployment, authentication and hardware are P1; do not let them displace the verified P0 path.
