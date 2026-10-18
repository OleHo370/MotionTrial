> Archived development notes. For the current app, see the [project README](../../../README.md) and [documentation index](../../README.md).
> Source paths and commands below are relative to the repository root.

# Opening practice: six small movements

The current page also adds actual recorded **ordered movement paths**, with numbered intermediate squares that must be visited before the final triangles. Current interaction and verification: `docs/archive/practice/MOVEMENT_PATHS.md`.

The current teaching interaction now pauses at each movement's start and waits for all four learner circles to occupy their starting squares for 1.5 seconds before playback. Finish markers are triangles. See `docs/archive/practice/START_POSITION_GUIDANCE.md`; the automatic-countdown interaction and verification below describe the earlier six-step implementation.

Continue at [step4](http://127.0.0.1:8766/first-three.html?step=4), or start [all six](http://127.0.0.1:8766/first-three.html). The same player now continues beyond the original three movements, without additional main controls. Starting at4 does not mark the earlier movements completed.

| Step | Original24.mp4 time | Movement | Required anatomical points |
| --- | --- | --- | --- |
| 1 | 1.0–6.5s | Open the left stance | Left ankle27 |
| 2 | 6.5–9.5s | Raise both hands | Wrists15/16 |
| 3 | 9.5–13.0s | Lower both hands | Wrists15/16 |
| 4 | 13.3–14.5s | Turn and open the hands | Wrists15/16 |
| 5 | 14.5–15.5s | Circle and gather the hands | Wrists15/16 |
| 6 | 15.5–17.5s | Lift and extend the left heel | Left ankle27 |

The new scope stops at the first extended left heel. The subsequent bow-stance/parting movement has an obscured teacher wrist and is intentionally deferred. A0.3-second editorial join between13.0 and13.3s is excluded; it is not filled with generated frames or inferred landmarks. Start/end screenshots are available under **See the movements**, with six buttons in three desktop columns or two phone columns.

## Source and reference integrity

Original source SHA remains `2d62941ddebe1a75febee4423d0040d021a4247440e248f40d7ea1c69b17fab6`. The first three source files, timings and prepared reference objects remain unchanged. The new player uses two exact recorded video/pose pairs: the original149-sample opening copy and a byte-identical `24-02.mp4` copy with294 genuine archived observations. Both sets remain12Hz observations of30fps video, with no missing-point interpolation or new inference claimed for the archived data.

New files are in `public/practice-media/next-three/`, prepared with `python scripts/prepare-next-three.py`. The six-step manifest maps each step to its corresponding source. On a recording change the player clears old observations/overlays and accumulated movement evidence, loads the matching source, seeks to the selected step, then begins321. End and later selections invalidate pending loads. A late camera/model start respects a subsequent Pause.

New teacher endpoints and display points use visibility/presence≥.65; the original three retain their previous rules. Unreliable optional teacher dots are hidden with an explanation, never copied from the opposite limb. The named hands/left ankle must have actual supported endpoints and sufficient movement. Live camera and existing global matching rules are unchanged. Straight start/end game guides do not certify the circular hand path, body turn, balance or weight transfer.

## Verification

`node scripts/check-next-three.mjs` supports separate static, browser and genuine-camera replay checks. Reports are isolated under `artifacts/next-three-review/`; old evidence remains untouched. Twelve groups pass, including379 protected old files, three input videos and seven pinned model assets, unchanged original-three references, all six real-source endpoint replays, same-side/one-hand/low-confidence counterexamples, source switching, cancellation/recovery, fast selection, three-second retries and late-model Pause preservation.

The new real-model test runs591 actual local MediaPipe inferences on explicitly labelled source13.3–17.5s video at0.5×, with1.5-second repeated endpoint holds and generated black frames. It observes all three new targets, advances to the final step and releases capture. Held/repeated video frames are test inputs, not extra teacher observations or human movement. Separate recorded-landmark timing controls verify six-step orchestration. Desktop, phone and small-desktop screenshots were visually checked for limb margins, shared mirror/overlay transforms and the obscured wrist warning.

Final source/code hashes and exact provenance are in `artifacts/next-three-review/verification-summary.json`. Physical-human imitation, real camera placement and mobile hardware remain unverified.
