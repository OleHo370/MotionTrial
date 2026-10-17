# MotionTrial product specification

Version: planning v0.1, 2026-10-16. Status: not implemented. Starter-kit fit and the real coordinator pain point remain unvalidated assumptions.

## Product

MotionTrial is a review workspace for remote movement assessment recordings. It helps a research coordinator locate suspected capture/tracking problems, inspect the actual recorded evidence, and document a review decision.

The product hypothesis is that finding unusable recordings earlier and making review more targeted may reduce avoidable re-recording and coordinator work. Do not claim a measured time saving, diagnostic accuracy or regulatory readiness without an actual evaluation.

P0 is a complete local full-stack hackathon prototype, not an entire clinical-trial management system. The demonstration task is a short seated upper-limb movement task inspired by our earlier tai chi discussion. It is NOT a validated clinical endpoint or a treatment protocol.

## Users and workflow

Two explicitly labelled demo views: participant and researcher. They share records through a real local backend. This is not authenticated multi-user access.

1. Participant opens the assessment briefing, selects or enters a pseudonymous demo code, reads fixed instructions, and consents to storing the demonstration video and tracking data on the local application server. No names, clinical histories or audio.
2. Camera setup shows live preview, model-load state and persistent shoulder/elbow/wrist tracking hints. These are framing hints, not judgements of physical capability. No pose detected is a warning, not a reason to invent coordinates.
3. When camera and model are ready, participant records the fixed 20-second task. Let hands move comfortably without forced range or speed. Start/Stop are explicit. Do not coach the participant to move higher, faster, straighter or more symmetrically once the assessment starts.
4. Save the actual video, observations and metadata. Clearly show uploading, saved and failed/retry states. Do not discard the local recording until upload succeeds.
5. Researcher opens the review queue, chooses a session, plays the source video, inspects a quality timeline and optionally overlays estimated landmarks. Event clicks seek to the corresponding video interval.
6. Researcher records Accept for analysis / Request recapture / Uncertain with a note. This is a demo review disposition, not a clinical judgement. Recapture creates a new session linked to the old one. Keep original records and review history.

Task ID: seated-arm-movement; instruction version: v0.1. Use this exact initial instruction text and store its snapshot with the session: 'Sit comfortably and keep your upper body in view. For the next 20 seconds, slowly raise and lower your hands within a comfortable range. You may pause or stop at any time.' Do not turn it into an adaptive movement-coaching task.

Retention default: the video and tracking data remain in the demo application's server data directory until the user deletes the session or deliberately resets demo data. Closing a page does not delete saved data. Suggested consent copy: 'This demonstration records video without audio and uploads the video and movement tracking data to this demo app’s server. Saved data remains until you delete the session or reset demo data. Continue only with your own authorized demonstration recording.'

## Required screens

| Screen | Required content |
| --- | --- |
| Overview/review queue | Actual stored-session counts; filters; demo provenance; task version; analysis state; separate review state |
| Briefing | Task description, 20-second duration, pseudonymous code, fixed instruction text, consent and data-handling explanation |
| Camera setup | Permissions and model state; live preview; framing/visibility hints; retry and back actions |
| Capture and submission | Recording indicator, elapsed/remaining time, fixed task instructions, stop/abort, upload progress/result |
| Session review | Source-video player, event timeline, event list with reasons, provenance/version metadata, human disposition/note/history |

Briefing/setup/capture may be steps within one route. No marketing homepage is needed.

## Capture quality versus observed movement

Quality findings are HEURISTIC SIGNALS requiring interpretation. Pose confidence does not establish physical visibility, and lost wrist tracking does not prove occlusion.

Automatic event types: no_pose, low_visibility, sampling_gap, inference_error, recording_interrupted. Use language such as 'Tracking unavailable from 8.2–10.1 s' rather than 'Patient performed incorrectly'. Each event has start/end times, affected landmarks if relevant, a triggering rule/version, and a human-readable explanation.

P0 summaries: elapsed duration, time-weighted tracking coverage, number of review flags, interruptions, and provenance. Estimated wrist trajectories may be shown in a separate observed-movement panel. Repetition counting, joint angles and proficiency scores are optional P1 and must never determine quality acceptance.

Small movement amplitude, limited range, asymmetry or slowness must not by themselves trigger a quality flag. A participant can have limited motion and a well-recorded attempt. Likewise, an apparently smooth skeleton may be wrong: retain video for review.

## Visual design

English UI. Calm research software: warm-white background (#F7F8FA), navy text (#14263D), teal main action (#087E8B), amber review attention (#B76B12), muted blue-gray supporting text. Use accessible darker variants where required. Red is for operation failures, not disability or low motion.

Use a consistent 8 px spacing rhythm, restrained rounded surfaces, generous video area and clear typography. Desktop researcher view: video on the left, evidence/decision panel on the right, timeline below. Queue rows should be scannable, with separate quality and review badges. Participant view should prioritize one task and one main action. Provide empty, loading, error, saved and disabled states; keyboard focus and text labels alongside colors/icons.

Do not add decorative hospital stock photos, fake partner logos, mock clinical scores or an oversized tai chi/watercolor theme to the review workspace. Optional cultural context belongs in the project story, not data-quality labels.

## P0 deliverables

- Working local app: real camera -> real backend save -> refresh -> video playback -> persistent human review.
- Browser pose inference, versioned quality rules and event/video synchronization.
- Clearly labelled normal, suspected-tracking-loss and small-amplitude demonstration cases.
- Source, run/setup instructions, meaningful test results, known limitations and a 90-second demo runbook.
- Local data reset for demo records and server-mediated video access outside public/.

## Out of scope

No patient recruitment, clinical eligibility decisions, EHR integration, drug-effect analysis, adaptive treatment advice, official regulatory submissions, medical score, full multi-study administration, wearable hardware or LLM chat in P0. No actual patients or clinical deployment. Public deployment and production authentication are later work, not implicitly completed by the local demo.

## Definition of success

A judge can record a short clip, see a genuine tracking issue localized to an interval, inspect the actual evidence, see that small but trackable movement is retained, and save a review decision that survives refresh. All displayed results must have traceable provenance.
