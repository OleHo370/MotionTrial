# First three movements from 24.mp4

The current player now continues through six small movements. See [Opening continuation](OPENING_CONTINUATION.md) for the current sequence and verification. The original three-step source data and evidence described below are preserved.

Open [First three movements](http://127.0.0.1:8766/first-three.html) using the existing static server on port8766. This is a separate single-view lesson; existing study/game/practice pages and their source files are preserved.

The first30 seconds of the actual supplied `D:\MotionTrial\24.mp4` were reviewed with timestamped contact sheets. The three teaching movements are small parts of the opening, not the first three complete forms:

| Movement | Original source time | Opening-player time | Required anatomical points |
| --- | --- | --- | --- |
| Open the left stance | 1.0–6.5s | 0.0–5.5s | Left ankle27 |
| Raise both hands | 6.5–9.5s | 5.5–8.5s | Wrists15 and16 |
| Lower both hands | 9.5–13.0s | 8.5–12.0s | Wrists15 and16 |

The final cut stops before the next form's gathering preparation. Under **See the three movements**, select a step to inspect its actual start/end screenshots or open the first30-second excerpt. Screenshots and the teacher display are mirrored for same-side learning. Original media and all matching coordinates are unmirrored.

## Practice

Opening the page starts a3–2–1 countdown and a0.5× preview. **Start practice** requests camera access, waits for the real local model, then starts the countdown. The teacher is shown large with only four wrist/ankle dots. Camera guides join observed start/end positions, with short actual live trails. They are game guides rather than a reconstruction of every intermediate motion.

The existing isolated four-point game evaluator is reused. A fresh same-side match held for700ms advances automatically. A demonstration ends with a four-second target hold; incomplete movement shows an estimated progress/reason window for3seconds and automatically retries. Missing/old observations are unknown with no passing result. If a teacher reference fails its source checks, three complete demonstrations continue as not assessed. Pause freezes playback/timers and clears accumulated evidence; End/hidden-page/completion stops capture. Manual step navigation is clearly separate from observed matches. No camera frames or learner poses are saved/uploaded.

Both hands are required on raising/lowering steps. The new `first-three-observed-v1.0` reference preparation checks that each required teacher point moves in the named direction; visibility alone cannot turn a misdetected raise into a stationary target. Left stepping requires anatomical left ankle27 and observed positive lateral displacement in the front reference. This additional check is scoped to this lesson and does not alter old global thresholds.

## Source provenance

Original24.mp4 SHA-256: `2d62941ddebe1a75febee4423d0040d021a4247440e248f40d7ea1c69b17fab6`.

`public/practice-media/first-three/opening.mp4` is a byte-identical copy of the previously source-derived `24-01.mp4`: source seconds1.0–13.3, crop pixels `(50,0,450,360)`,30fps. Its matching149 actual archived MediaPipe Lite observations are reused without changing coordinates, statuses or timestamps. These observations are12Hz, not30fps tracking. Derived frame indices are explicitly approximate; the player displays the nearest actual observation only within100ms and never interpolates missing points. The teaching steps use only source seconds1.0–13.0; the extra tail stays unused.

The original model SHA is retained and validated. The new page never loads red-clothing front/back media, back-view observations or a second teacher view. New first30-second and three-step cuts, six actual source screenshots, copied observations and provenance manifest are confined to `public/practice-media/first-three/`.

Preparation: `python scripts/prepare-first-three.py` using the existing Python environment with PyAV, OpenCV and Pillow. The script reads the original video and existing matching clip/cache, writes only new lesson assets and source-review evidence, and verifies source/clip identity. Review evidence is in `artifacts/first-three-review/`.

## Verification

`scripts/check-first-three.mjs` separates `--static`, `--browser`, and `--camera` modes. Source endpoints are actual supported observations, all149 original samples remain unchanged, and all three recorded-source replays match. Labelled counterfactual controls reject a fixed left foot, an omitted raised hand, a high-visibility invalid teacher raise, stale timestamps and explicit invalid presence values. Browser controls cover preview without camera permission, denial recovery, automatic3/3 completion, incomplete/unknown three-second retries, source-insufficient three rounds and manual continuation.

In the separate genuine local MediaPipe run, a clearly labelled new24-opening camera replay completes all three movements after864 real inferences, then releases its stream. Generated black frames produce actual tracking loss and clear guide pixels. This is software replay, not a physical learner. The342 old protected files, three original input videos and pinned model/WASM hashes remain unchanged. Desktop1440×1000,1366×768 and phone390×844 layouts were inspected; both hands and the feet remain inside the crop, and start/end screenshots load correctly. Final reports are in `artifacts/first-three-review/verification-summary.json`; the source and software/real-inference reports remain separate.

No physical learner or real-device camera acceptance is implied by recorded-source or browser tests. The four-point target result does not certify complete Tai Chi choreography, knee loading, weight transfer or palm orientation.
