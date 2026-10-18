# Qi Mirror project guidance

## Documentation layout

- Keep only `README.md` and `AGENTS.md` as Markdown files in the repository root.
- Current engineering guides and the documentation index belong in `docs/`.
- Update implementation and verification history in `docs/development/STATUS.md`.
- Earlier specifications, practice notes and prompts belong in `docs/archive/`, grouped by purpose. Preserve working references when relocating documents.

## Project conventions

Build the local hackathon MVP described in docs/archive/planning/PRODUCT_SPEC.md and docs/archive/planning/ACCEPTANCE.md. Preserve an existing repository's applicable instructions and architecture; merge this guidance rather than overwrite an existing AGENTS.md.

- Goal: one real recording-to-human-review workflow for remote movement assessment recordings.
- Keep observed movement separate from capture/tracking quality. Small, slow or asymmetric movement is not itself a quality failure.
- Retain the original recorded video separately from timestamped landmark observations. A skeleton replay is not the source video.
- Never silently use mock landmarks, fabricated metrics or prerecorded inference as live camera results. Label data provenance.
- Use deterministic, versioned quality rules. Missing tracking is unknown, not zero motion, and cannot be silently interpolated.
- No movement-correction coaching during the fixed assessment. Keep collection, analysis and human-review states separate.
- Default to local Node + SQLite + private video files; no public deployment, production medical claims or real patient data in this scope. Role switching is demo navigation, not authentication.
- Use short milestones. Verify the meaningful behavior changed, repair failures, and keep docs/development/STATUS.md current. Do not stop at a plan, scaffold or static UI when asked to implement.
- Reuse installed compatible dependencies. Pin model/WASM/package assets reproducibly. Prefer no LLM service dependency for P0.
- Delegate independent work only when tools support it and file ownership can be kept clear. Integrate and verify centrally.
- Do not invent passing test results or physical-camera validation. Record blocked checks and the exact manual steps still needed.
- Keep code and UI in English; explain progress to the user in Chinese unless asked otherwise.
- Honor the event's official coding start and the user's requested phase. This handoff is planning material, not permission to ignore contest rules.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## User-authorized practice prototype (2026-10-16)

The user explicitly added a new direction: a minimal `/practice` page with a trimmed instructor movement and real MediaPipe on the left, live camera and real MediaPipe on the right, repeating an incomplete attempt and advancing only after a complete matching movement. Build and verify one movement first; do not invent subsequent clips. Preserve the existing assessment/review workflows and source videos. The old fixed-assessment/no-coaching scope still applies to those assessment routes; the new user-authorized imitation mode has separate versioned comparison rules and may give movement-practice feedback. Unknown tracking must remain separate from observed mismatch. No clinical movement score or fabricated live results.

The user has now authorized four consecutive stages and explicitly approved their natural order: lift the left foot, step out to the left, lift both arms, press both hands down. Preserve the original arm clip bytes as the third stage; the new stages come from the supplied longer opening tutorial. A match advances automatically, observed mismatch or unknown repeats only the current stage. These are four stages of the opening, not four different forms. Playlist order and explicit movement focus come from the local manifest. Do not invent further movements or imply that palm orientation is measured by Pose.

The latest user direction supersedes the four-stage practice scope: use the newly supplied `D:\MotionTrial\24.mp4`, audit its 24 form boundaries, and create natural-duration, original-speed clips. Preserve the four-stage assets and original videos. Show synchronized reference and live skeletons in the same camera frame, with body-position/scale alignment and clear colors. Default to a versioned forgiving practice matcher; a roughly complete imitation should advance automatically. Missing tracking remains unknown. See docs/archive/prompts/PROMPT_24_FORMS.md for the implementation prompt requested by the user. This does not change the assessment/review scope.

The user subsequently found whole forms too hard to follow, especially form 2. Default `/practice` to fine teaching microsteps across all 24 forms, slow demonstration, a held target and unlimited imitation time. Default to learner-confirmed Next step, with optional forgiving endpoint auto advance; tracking uncertainty must not trap the learner. A manual confirmation is not a model-verified pass. Preserve whole-form practice, all existing video-library/camera controls and assessment workflows. See docs/archive/prompts/PROMPT_STEP_BY_STEP.md.
