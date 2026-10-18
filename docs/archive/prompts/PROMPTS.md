> Archived development notes. For the current app, see the [project README](../../../README.md) and [documentation index](../../README.md).
> Source paths and commands below are relative to the repository root.

# MotionTrial Codex prompts

**Current direction:** [PROMPT_STEP_BY_STEP.md](PROMPT_STEP_BY_STEP.md) implements fine teaching microsteps, slow demonstrations, held targets and learner-paced progression. Whole-form practice remains available.

**Latest user direction:** use [PROMPT_24_FORMS.md](PROMPT_24_FORMS.md) for the natural-duration 24-form sequence, reference/live skeleton overlay in one camera frame, and relaxed automatic progression. Earlier prompts below are historical scope.

**Historical four-stage direction (earlier 2026-10-16):** the four-stage continuation prompt and assessment/single-action prompts below are retained for reference. The 24-form prompt above is the current scope.

Use one of two approaches: recommended MASTER PROMPT for autonomous implementation with verified milestones; or the numbered prompts one at a time for closer steering. Do not send both approaches at once. These are instructions for the later coding session, not a request to implement before the event's official coding start.

Place this handoff's documents in the project directory. A separate Codex session may not have the Work conversation; the files supply the context.

## MASTER PROMPT — recommended

```text
Act as the product-minded lead designer and full-stack engineer for MotionTrial. Implement the complete local hackathon MVP, rather than stopping at advice, a plan, a scaffold or a static dashboard.

First inspect the repository and applicable instructions. Locate the supplied MotionTrial handoff documents in the project root, MotionTrial_Codex_Handoff/ or docs/motiontrial-handoff/ and resolve document names relative to that handoff directory. Read docs/archive/planning/PRODUCT_SPEC.md, docs/archive/planning/IMPLEMENTATION_PLAN.md and docs/archive/planning/ACCEPTANCE.md, then the current docs/development/STATUS.md. Preserve existing user changes, compatible architecture and existing AGENTS.md guidance. If starting empty, use Next.js + TypeScript + Tailwind, a minimal SQLite metadata store and video files outside public/ under a configurable local data directory. Use a Node runtime, not an ephemeral serverless filesystem. Check current official APIs and installed versions; do not invent dependency versions.

Product: a review workspace for remote movement assessment recordings. A demo participant follows a fixed 20-second seated upper-limb task. The browser records real source video without audio and runs MediaPipe Pose Landmarker. After explicit demonstration recording/storage consent, it uploads the video and timestamped observations to the local backend. The backend validates inputs, recomputes heuristic quality findings and saves the session. A demo researcher refreshes the queue, plays the real video, clicks time-localized tracking flags and saves an explicit review disposition and note. Recapture creates a linked new record. Role switching is demo navigation, not authentication.

Non-negotiable product behavior:
- Keep movement performance separate from capture/tracking quality. Low amplitude, slowness and asymmetry are not quality failures by themselves.
- Pose confidence is a heuristic, not proof of occlusion or clinical correctness. Use 'tracking unavailable' and 'needs review'. No diagnosis, rehabilitation score or clinical/FDA-validation claims.
- Preserve actual video separately from landmarks. Skeleton animation cannot stand in for source-video evidence. Missing detections must be explicit, never filled with stale landmarks, zero movement or made-up coordinates.
- Use one consistent video/observation/event timeline and time-weighted coverage, with versioned configurable prototype rules. Click-to-event playback should align within 500 ms on the demo browser.
- No corrective movement coaching once assessment recording begins. Setup hints may help framing before capture.
- Consent, camera/model/recorder readiness, upload pending/saved/failed states and retry must be real. Preserve the browser Blob until a successful idempotent save. Video, quality events and review history survive refresh/restart.
- Live inference, prerecorded demos and synthetic fixtures must be distinguishable. Never silently switch a failed camera/model path to mock inference.

Implement the project through M0–M4 in docs/archive/planning/IMPLEMENTATION_PLAN.md. Start with the smallest real recording -> backend -> playback vertical slice; then add inference and quality logic; then the evidence timeline and human review; then visual refinement, error handling and validation. Record assumptions and proceed with reasonable reversible defaults rather than repeatedly asking for approval. Fix discovered failures before broadening scope. Delegate independent modules only if available and keep file ownership clear.

Design: English UI, warm-white background, navy text, teal primary actions, amber review attention. A credible, calm research workspace with a large video player, precise timeline, readable queue and clear participant steps. Every visible control must work or truthfully be disabled. Provide loading, empty, error and saved states; keyboard focus and narrow-viewport usability. Keep implementation jargon out of the participant flow.

P0 does not include hardware, authentication, LLM chat, EHRs, recruitment, drug efficacy or public deployment. Build a real local full-stack prototype first. No real patient information. Do not upload recordings to third-party AI services, commit recordings/secrets to git, expose public uploads, or deploy publicly in this task. A deployed production clinical system would be separate work. Saved demo data remains until explicit session deletion or deliberate reset, and this must be explained before capture.

Verify meaningful behavior with focused domain tests, API/persistence checks and a browser workflow using an explicitly identified virtual/prerecorded camera input where available. Run lint/typecheck/build and local production start as applicable. Do not treat mocked-camera tests as physical-camera validation. If a physical camera is unavailable, finish other authorized implementation and document the exact remaining manual checks; do not falsely mark those passed.

Maintain docs/development/STATUS.md with milestones, decisions, actual validation results and unresolved issues. At completion provide the run URL and commands, implemented workflow, verification evidence, physical-camera checklist, known limitations, data reset instructions and a 90-second demo runbook. If you are running remotely, distinguish your environment's localhost/preview from the user's laptop and provide exact local-run steps; do not imply that a remote test exercised the laptop's camera. Continue until the agreed P0 works or a concrete external blocker remains; make any partial state explicit.
```

## 0 — Plan only, if you want to inspect the plan before coding

```text
Read the MotionTrial handoff documents and inspect the current repository. This turn is planning only: do not implement the app yet.

Produce a concise implementation plan mapped to M0–M4, choosing the smallest architecture compatible with the repository. Explain the first recording -> backend -> video-playback vertical slice, video and landmark retention, timeline synchronization, quality rules, researcher review state, demo provenance and actual test strategy. Record assumptions and concrete unresolved external blockers in docs/development/STATUS.md. Do not expand into a clinical-trial platform, account system or new feature ideas. Point out any spec contradiction that would change the core workflow.
```

## 1 — First real vertical slice

```text
Implement MotionTrial M0 and M1 from the handoff. Start by inspecting existing code and instructions. Build a polished basic shell with the demo participant briefing, pseudonymous code, explicit recording/storage consent, camera setup, a real 20-second silent video recording, multipart backend save, durable session queue and source-video playback after refresh.

For an empty repository use Next.js/TypeScript/Tailwind, SQLite for metadata and private local video files outside public/. Use a local Node runtime. Preserve existing compatible choices. Implement bounded upload validation, server-generated filenames, idempotent session IDs, readable pending/saved/failed states, failure cleanup and retry without losing the browser recording. Support video seeking through the server endpoint. Analysis may truthfully say 'pending' in this milestone; do not fake MediaPipe results.

Follow docs/archive/planning/PRODUCT_SPEC.md visual direction and keep all core actions functional. Verify one real media capture/save/reload/playback path using available browser tooling and distinguish physical versus virtual-camera evidence. Run appropriate build/type checks. Update docs/development/STATUS.md with exact commands, results and the next milestone. Implement the milestone now; do not return only a plan.
```

## 2 — Real pose acquisition and quality engine

```text
Continue the working MotionTrial app with M2. Read current docs/development/STATUS.md and preserve the recording/save/playback path. Add real browser MediaPipe Pose Landmarker using compatible, pinned model and WASM assets with an explicit loading/error state. Process new frames only; keep the UI responsive. Retain timestamped shoulder/elbow/wrist observations plus explicit no_pose/inference_error observations.

Implement one pure, shared, versioned quality-analysis module used on the server. Follow the initial configurable engineering defaults in docs/archive/planning/IMPLEMENTATION_PLAN.md. Calculate time-weighted tracking coverage with bounded observation support, explicit unknown intervals and no double counting. Detect sustained no_pose/low_visibility, sampling gaps and interruptions without asserting a physical cause. Keep one session-relative clock aligned to source-video playback.

Small, slow or asymmetric movement must not itself trigger a quality event. Lost tracking must remove or visibly mark unavailable overlays, not hold old coordinates as current. Never synthesize data to make a live result look successful.

Write meaningful tests for time weighting, long gaps, boundaries, no_pose, invalid timestamps and small-amplitude independence. Show actual camera observations if camera access is available, otherwise report that exact gap. Update docs/development/STATUS.md and fix regressions before considering optional metrics.
```

## 3 — Researcher review and demonstration cases

```text
Implement MotionTrial M3 on top of the actual capture and quality engine. Add a readable review queue, source-video player, clickable quality-event timeline, reasons/intervals, optional landmark overlay, task/model/rule version and provenance. Clicking an event should seek to its actual media moment; verify the 500 ms alignment target.

Separate analysis state, capture completion/interruption state and human review disposition. Save Accept for analysis / Request recapture / Uncertain and a note to the backend, append history and retain it after refresh. A recapture produces a linked new session, not an overwritten recording.

Prepare clearly labelled normal, tracking-loss and small-amplitude examples. Prefer authorized demo-volunteer recordings for source-video examples. If you generate synthetic visual fixtures, label them synthetic and never describe them as actual camera or patient recordings. No hardcoded seeded finding may masquerade as the live model's result.

Verify queue -> event -> evidence playback -> decision -> refresh through browser/API checks. Every displayed statistic should derive from saved records. Keep the workflow focused and update docs/development/STATUS.md with evidence and limitations.
```

## 4 — Design polish, integration and honest completion

```text
Finish MotionTrial M4. Inspect the running app in a browser and fix the full workflow, not only the first screen. Refine the warm-white/navy/teal/amber research interface: desktop video plus evidence panel, precise timeline, calm queue, clear participant steps, accessible labels/focus, and usable narrow layouts. Verify approximate 1440x900 and 390x844 viewports. Do not replace working functions with decorative controls.

Handle denied camera permission, model load failure, no pose, recording failure, hidden-tab interruption, upload/storage failure, empty queue and unavailable video. Check disposal of camera/model resources, valid video seeking, idempotent retries, review persistence and intentional session deletion.

Run the meaningful unit/integration tests, browser end-to-end workflow, lint/typecheck/build and local production start as applicable. Perform physical-camera checks only if actual hardware is accessible; list any missing checks explicitly. Verify that synthetic and prerecorded inputs are labelled, no unvalidated medical claims appear and no private media/secrets are committed.

Deliver updated README/run commands, docs/development/STATUS.md, a short known-limitations section, data reset instructions and docs/archive/practice/DEMO_RUNBOOK.md for a 90-second presentation. Do not publicly deploy or add optional features. Continue fixing material failures until P0 works or a concrete blocker is documented.
```

## 5 — Focused rescue prompt if the result drifts

```text
Stop expanding scope and inspect the current MotionTrial implementation against docs/archive/planning/ACCEPTANCE.md. Preserve useful working code. List only the concrete gaps preventing the core path: real camera/video -> durable backend save -> truthful quality timeline -> source-video review -> persistent human decision.

Fix those gaps in dependency order. Remove or disable misleading UI, fabricated results and unsupported medical claims. Do not rewrite the application from scratch or add dashboards/features unrelated to the path. Prove each fix with the smallest meaningful check and update docs/development/STATUS.md. Explain remaining external blockers accurately instead of declaring completion from a successful build alone.
```

## Optional later deployment prompt — NOT part of P0

```text
Prepare, but do not execute, a concrete deployment plan for the verified MotionTrial local MVP. Inspect its storage and runtime assumptions. Explain a persistent Node/disk deployment or a deliberate migration to managed database and private object storage. Add authentication, authorization for sessions/video, storage retention and consent controls before any real participant use. A demo role switch is insufficient.

Provide exact configuration, environment variables, costs that require checking, test steps and the changes needed. Use only clearly labelled synthetic/authorized demo data for a public demonstration. Do not assume local SQLite/video files persist on a serverless host, expose public uploads, buy services or publish a site in this planning task.
```

## Single-movement practice prompt — previous milestone

```text
请作为 MotionTrial 的产品设计师和全栈工程师，继续当前“看视频学一个动作”的本地 demo，直接实现和验证，不只提供计划。

先检查当前仓库、适用 AGENTS.md 和 docs/development/STATUS.md，保留现有代码、数据、用户修改和原视频。项目根目录为 D:\MotionTrial\MotionTrial_Codex_Handoff\MotionTrial_Codex_Handoff。本轮练习页面 /practice 的需求优先于旧评估产品中“不做动作指导”的限制，但不要删除旧采集和人工复核流程。

先做好一个动作，不自动批量切视频。现有参考来自 D:\MotionTrial\太极拳最简入门_起势示范节选.mp4 的 6.5–8.5 秒：开立后双臂向前抬起，裁出中间示范者全身，0.5 倍速得到 4 秒片段；它不是完整起势。原片和较长教学视频都不能覆盖。检查 public/practice-media/action-01.json、action-01.webm 和 scripts/prepare-practice.py，保留来源、裁切、速度与时间信息。若改变切点，先确认它确实包含一个可辨认的完整小动作。

页面保持极简、英文、暖白背景、深海军蓝文字、青绿色操作、琥珀色提示。左边播放参考视频及真实 MediaPipe Pose 骨架；右边用户明确开启摄像头后，显示自己的实时视频及真实骨架，覆盖肩、肘、腕、髋、膝、踝。参考预录视频与实时摄像头必须明确标识，缓存的真实参考推理与合成演示点不能混淆。摄像头不录音、不保存、不上传，不添加账号、仪表盘或大模型功能。

流程：预览参考 → 开启摄像头 → 3 秒准备，参考回到起始姿态 → 同步跟做 → 比较整个有序动作。匹配则进入已经确认存在的下一片段；当前只有一段时明确显示本段完成。动作未完成则自动重播；追踪不足则显示 unknown 并重试，不能算成动作做错。提供 Pause、Restart movement 和 Stop camera，离开页面释放资源。

保留单独、可解释、版本化的模仿匹配规则；不能修改旧采集质量规则来评分人的动作。比较应处理人体位置、尺度、画幅比例和适度快慢差异，要求起始/中间/结束与真实动作变化，不能只摆一个姿势就通过。默认不镜像；镜像只同时翻转视频与骨架，不偷偷交换人体左右。模型无结果、置信度不足或推理错误时立即清空相应骨架，旧摄像头坐标按采样时间最多保留 250ms，不编造点或假分数。阈值是待真人校准的原型设置，不宣称太极正确性或临床能力评价。

执行类型检查、生产构建、关键单元测试和浏览器验证。至少覆盖：真实模型对同一预录动作作为测试摄像头能完成；真实模型看到第一帧静止人体时不能完成；无人体时 unknown；自动重试、暂停、停止摄像头、权限拒绝及恢复；桌面左右屏和窄屏布局。明确预录/合成输入的测试来源，不能把它们描述成真人摄像头验收。修复失败再推进，更新 docs/development/STATUS.md。最终给出运行地址和启动命令、实际结果、待真人检查、已知限制和简短演示步骤。

先完成这一个动作的体验与真人校准；在我确认后，再讨论长视频的动作边界和下一段，不自行扩充播放列表。
```

## Four-stage continuation prompt — current direction

```text
请继续完善 MotionTrial 当前 /practice 的四段真实 MediaPipe 跟练，先读取适用 AGENTS.md、docs/development/STATUS.md 和 README.md，保留原始视频、用户数据和旧采集复核应用。

用户已确认顺序：提左脚（长视频82–85秒）→向侧落脚（85–96秒）→双臂抬起（保留短视频6.5–8.5秒的原action-01字节）→双手下压（长视频114–129秒）。每段4秒。播放列表按public/practice-media/playlist.json顺序02→03→01→04，包含来源、速度、裁切、校验值和动作关注关节；它们是起势的四个阶段，不是四种新招式。不要自行扩充或伪造片段。

左侧播放当前原始来源切片和真实MediaPipe估计；右侧用户明确开启摄像头后实时推理。完整有序动作匹配通过才自动下一段，未匹配重复当前段，追踪不足是unknown并重试。每次有起始姿势和3秒准备；转场加载时Pause/Stop也必须取消异步自动开始。最后显示全部完成，可回到第一段。保持英文、暖白/海军蓝/青绿/琥珀的简洁左右屏。

动作匹配独立于原采集质量规则。按当前阶段的真实动肢证据、幅度、阶段和方向判定，既不能让静止/反向/错误肢体动作通过，也不能用全身平均稀释脚部小动作；证据不可辨时unknown。不要宣称能评分手掌朝向或精细脚形。缺失/错误时清骨架，旧实时点按采样时间250ms内过期；不伪造点、成功分数或临床结论。此页不录音、录制、上传或持久保存摄像头数据。

先验证真实参考、自匹配、静止/逆序/遗漏动肢负例，再用明确标注的预录像素输入和真实模型跑完整四段连续通过，以及当前段重试、无人体unknown、权限恢复、转场暂停/停止、重启和桌面/窄屏。修复失败，不改预期来掩盖问题。运行单元/类型/生产构建和适用浏览器检查，更新STATUS，明确真人摄像头校准仍有哪些未完成；不可把自动化源说成真人验收。不要回退到旧的仅一段需求。
```
