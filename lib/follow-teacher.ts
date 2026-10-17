import { RELAXED_COMPARISON_OPTIONS, type PoseSample, type PracticeLandmark } from './imitation';
import { evaluateTeachingPose, TEACHING_RULES_VERSION, type TeachingPoseResult } from './teaching';

export { createImitationPoseClient } from './imitation-pose';
export { requestPracticeCamera, listPracticeCameras } from './practice-camera';
export { updateTeachingHold } from './teaching';

/** This page adds anatomical movement evidence; existing practice rules are unchanged. */
export const FOLLOW_RULES_VERSION = 'follow-teacher-anatomical-v1.0';
export const FOLLOW_FOCUS_VERSION = 'dual-semantic-focus-v1.0';
/** Checkpoint progress is a learning aid, never a movement-quality/ability score. */
export const FOLLOW_PROGRESS_RULES_VERSION = 'follow-checkpoint-progress-v1.0';
const TORSO = [11, 12, 23, 24];
const CHAINS: Record<number, number[]> = { 15: [11, 13, 15], 16: [12, 14, 16], 27: [23, 25, 27], 28: [24, 26, 28] };
const NAMES: Record<number, string> = { 15: 'left hand', 16: 'right hand', 27: 'left foot', 28: 'right foot' };
const FOCUS: Record<string, number[]> = { A: [15, 16], F: [27, 28], L: [27], R: [28] };
/**
 * One explicit entry for each existing semantic step, in manifest order.
 * A = both hands; F = both feet; L/R = an explicitly named anatomical foot.
 * When a phase says "front/rear/stepping foot", both ankles are retained rather
 * than guessing anatomical identity from screen position or form popularity.
 * Source observation quality is checked separately, never used to pick an easier limb.
 */
export const FOLLOW_FOCUS_ROWS: readonly (readonly string[])[] = [
  ['L','L','A','A','A','A','A'],
  ['F','F','A','A','F','F','A','A','F','F','A','A'],
  ['F','A','A','A','A'],
  ['A','F','F','A','A','F','F','A','A','F','F','A','A'],
  ['F','A','F','A','A'],
  ['F','A','F','A','F','A','F','A','A'],
  ['A','L','L','A','A','A','A','A','A'],
  ['A','R','R','A','A','A','A','A','A'],
  ['A','F','F','A','A'],
  ['A','F','F','F','F','F','F','A','A'],
  ['F','F','A','A'],
  ['F','A','A','A','A'],
  ['A','F','A','R','R','R'],
  ['R','R','A','A','A','A'],
  ['A','L','L','L','L'],
  ['L','L','F','F','F','F','F','F','F'],
  ['F','A','F','F','F','F','F','F','F'],
  ['F','A','F','A','F','F','F','A','A'],
  ['F','A','A','A','A'],
  ['A','F','A','A','A'],
  ['A','A','F','F','A','F','A','A'],
  ['A','A','A','A','A'],
  ['F','A','A','F','A','A','A'],
  ['A','A','A','F','F','F'],
];

interface DualStep { id: string; title: string; front: { startSeconds: number; endSeconds: number } }
interface DualForm { formNumber: number; steps: DualStep[] }
interface RecordedSample extends PoseSample { frameIndex: number; sourceTimeSeconds: number }
interface FrontData { view: string; formNumber: number; fps: number; width: number; height: number; samples: RecordedSample[] }
interface Point { x: number; y: number }
export interface FollowMotionEvidence {
  joint: number;
  coverage: number;
  excursion: number;
  startToTarget: number;
  direction: Point | null;
  active: boolean;
}
export interface FollowReference {
  id: string; title: string; focusJoints: number[]; focusLabel: string;
  target: PoseSample | null; baseline: PoseSample | null; referenceAspectRatio: number;
  motionRequired: boolean; referenceEvidence: FollowMotionEvidence[];
  referenceUsable: boolean; unknownReason: string | null;
  focusProvenance: string; focusVersion: string;
  targetSourceSeconds: number; baselineSourceSeconds: number;
  coverage: number; sourceSampleCount: number;
}
export interface FollowSession {
  referenceId: string;
  baseline: Map<number, Point> | null;
  firstObservationAtMs: number | null;
  lastObservationAtMs: number | null;
  sampleCount: number;
}
export interface FollowResult {
  status: 'match' | 'mismatch' | 'unknown'; message: string;
  endpoint: TeachingPoseResult | null; focusJoints: number[];
  motionEvidence: Array<{ joint: number; observed: boolean; projectedDisplacement: number; requiredDisplacement: number }>;
  rulesVersion: string;
}

export interface FollowProgressComponent {
  id: string;
  label: string;
  complete: boolean;
  /** Unknown observations have no numerical progress. */
  progress: number | null;
  weight: number;
}
export interface FollowProgress {
  percent: number | null;
  reason: string;
  components: FollowProgressComponent[];
  rulesVersion: typeof FOLLOW_PROGRESS_RULES_VERSION;
}

function points(sample: PoseSample | null | undefined, aspect: number, required: number[]): Map<number, Point> | null {
  if (!sample || sample.status !== 'pose' || !Number.isFinite(sample.tMs) || sample.tMs < 0 || !Number.isFinite(aspect) || aspect <= 0) return null;
  const raw = new Map<number, PracticeLandmark>();
  for (const point of sample.landmarks) {
    if (raw.has(point.index)) return null;
    raw.set(point.index, point);
  }
  for (const joint of required) {
    const p = raw.get(joint) as (PracticeLandmark & { presence?: number | null }) | undefined;
    if (!p || ![p.x, p.y, p.visibility].every(Number.isFinite)
        || p.visibility < RELAXED_COMPARISON_OPTIONS.visibilityThreshold || p.visibility > 1
        || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1
        || (p.presence !== undefined && (p.presence === null || !Number.isFinite(p.presence) || p.presence < 0.45 || p.presence > 1))) return null;
  }
  const hip = { x: (raw.get(23)!.x + raw.get(24)!.x) * aspect / 2, y: (raw.get(23)!.y + raw.get(24)!.y) / 2 };
  const shoulder = { x: (raw.get(11)!.x + raw.get(12)!.x) * aspect / 2, y: (raw.get(11)!.y + raw.get(12)!.y) / 2 };
  const scale = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y);
  if (scale < 0.025) return null;
  return new Map(required.map((joint) => [joint, { x: (raw.get(joint)!.x * aspect - hip.x) / scale, y: (raw.get(joint)!.y - hip.y) / scale }]));
}
function requiredJoints(focus: number[]) { return [...new Set([...TORSO, ...focus.flatMap((joint) => CHAINS[joint])])]; }
function label(focus: number[]) {
  if (focus.length === 2 && focus.includes(15) && focus.includes(16)) return 'both hands';
  if (focus.length === 2 && focus.includes(27) && focus.includes(28)) return 'both feet';
  return focus.map((joint) => NAMES[joint]).join(' and ');
}
function range(values: number[]) {
  if (values.length < 2) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.floor((ordered.length - 1) * 0.9)] - ordered[Math.floor((ordered.length - 1) * 0.1)];
}

/** Only actual front-source observations inside the selected existing interval are used. */
export function prepareStepReference(form: DualForm, step: DualStep, data: FrontData): FollowReference {
  const stepIndex = form.steps.findIndex((entry) => entry.id === step.id);
  const row = FOLLOW_FOCUS_ROWS[form.formNumber - 1];
  if (!row || row.length !== form.steps.length || stepIndex < 0 || data.view !== 'front' || data.formNumber !== form.formNumber
      || !Number.isFinite(data.fps) || data.fps <= 0 || !Number.isFinite(data.width / data.height) || data.height <= 0) {
    throw new Error('The selected step needs its unchanged front-source data and an explicit focus mapping.');
  }
  const focusJoints = [...FOCUS[row[stepIndex]]], required = requiredJoints(focusJoints);
  const referenceAspectRatio = data.width / data.height;
  const startFrame = Math.floor(step.front.startSeconds * data.fps + 0.00001);
  const endFrame = Math.ceil(step.front.endSeconds * data.fps - 0.00001) - 1;
  const samples = data.samples.filter((sample) => sample.frameIndex >= startFrame && sample.frameIndex <= endFrame);
  const baseline = samples.find((sample) => sample.frameIndex === startFrame) ?? null;
  const target = samples.find((sample) => sample.frameIndex === endFrame) ?? null;
  const valid = samples.map((sample) => points(sample, referenceAspectRatio, required));
  const coverage = valid.filter(Boolean).length / Math.max(1, endFrame - startFrame + 1);
  const startPoints = points(baseline, referenceAspectRatio, required), endPoints = points(target, referenceAspectRatio, required);
  const referenceEvidence = focusJoints.map((joint): FollowMotionEvidence => {
    const observed = samples.flatMap((sample) => {
      const p = points(sample, referenceAspectRatio, requiredJoints([joint]));
      return p ? [p.get(joint)!] : [];
    });
    const a = startPoints?.get(joint), b = endPoints?.get(joint);
    const startToTarget = a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
    const excursion = Math.hypot(range(observed.map((p) => p.x)), range(observed.map((p) => p.y)));
    return { joint, coverage: observed.length / Math.max(1, endFrame - startFrame + 1), excursion, startToTarget,
      direction: a && b && startToTarget > 0 ? { x: (b.x - a.x) / startToTarget, y: (b.y - a.y) / startToTarget } : null,
      active: excursion >= RELAXED_COMPARISON_OPTIONS.minimumFocusExcursion
        && startToTarget >= RELAXED_COMPARISON_OPTIONS.minimumFocusPhaseDisplacement };
  });
  const motionRequired = !/^Complete\b/i.test(step.title);
  let unknownReason: string | null = null;
  if (!target || !endPoints) unknownReason = `The teacher's ${label(focusJoints)} are not clearly tracked at this target. This step is visual practice only.`;
  else if (motionRequired && (!baseline || !startPoints || coverage < RELAXED_COMPARISON_OPTIONS.minimumCoverage)) {
    unknownReason = `The teacher's ${label(focusJoints)} are not clearly tracked through this step. You can still learn visually.`;
  } else if (motionRequired && !referenceEvidence.some((item) => item.active)) {
    unknownReason = 'The recorded change is too small or has no clear endpoint direction for action feedback. This step is visual practice only.';
  }
  return { id: step.id, title: step.title, focusJoints, focusLabel: label(focusJoints), target, baseline, referenceAspectRatio,
    motionRequired, referenceEvidence, referenceUsable: unknownReason === null, unknownReason,
    focusProvenance: 'Explicit semantic focus per existing step; ambiguous front/rear foot phases keep both anatomical ankles. Source visibility never changes the selected focus.',
    focusVersion: FOLLOW_FOCUS_VERSION, targetSourceSeconds: endFrame / data.fps, baselineSourceSeconds: startFrame / data.fps,
    coverage, sourceSampleCount: samples.length };
}

export function createFollowSession(reference: Pick<FollowReference, 'id'>): FollowSession {
  return { referenceId: reference.id, baseline: null, firstObservationAtMs: null, lastObservationAtMs: null, sampleCount: 0 };
}
function clear(session: FollowSession) {
  session.baseline = null; session.firstObservationAtMs = null; session.lastObservationAtMs = null; session.sampleCount = 0;
}

/**
 * Raw teacher front ↔ raw learner front; no display coordinates, side swaps or mirror option.
 * Reuses broad endpoint thresholds verbatim. The extra guard requires a clear displacement
 * of each source-active anatomical focus, with no speed/deadline requirement. It observes
 * projected movement near a target, not full-form correctness, weight transfer or palm angle.
 */
export function evaluateFollowObservation(reference: FollowReference, live: PoseSample | null | undefined, options: {
  attemptAspectRatio: number; liveAgeMs?: number; session: FollowSession;
}): FollowResult {
  const session = options.session;
  const result = (status: FollowResult['status'], message: string, endpoint: TeachingPoseResult | null = null,
    motionEvidence: FollowResult['motionEvidence'] = []): FollowResult => ({ status, message, endpoint, motionEvidence,
    focusJoints: [...reference.focusJoints], rulesVersion: `${FOLLOW_RULES_VERSION} + ${TEACHING_RULES_VERSION}` });
  if (session.referenceId !== reference.id) { clear(session); session.referenceId = reference.id; }
  const age = options.liveAgeMs ?? 0;
  const normalized = points(live, options.attemptAspectRatio, requiredJoints(reference.focusJoints));
  if (!Number.isFinite(age) || age < 0 || age > RELAXED_COMPARISON_OPTIONS.maximumSampleGapMs || !normalized || !live) {
    clear(session);
    return result('unknown', `Your ${reference.focusLabel} or torso are not clearly tracked. Waiting for a fresh view.`);
  }
  if (!reference.referenceUsable) { clear(session); return result('unknown', reference.unknownReason!); }
  const endpoint = evaluateTeachingPose(reference.target, live, { referenceAspectRatio: reference.referenceAspectRatio,
    attemptAspectRatio: options.attemptAspectRatio, focusJoints: reference.focusJoints, liveAgeMs: age });
  if (endpoint.status === 'unknown') { clear(session); return result('unknown', `Unable to judge ${reference.focusLabel} from the current tracking.`, endpoint); }
  if (session.lastObservationAtMs !== null && (live.tMs < session.lastObservationAtMs
      || live.tMs - session.lastObservationAtMs > RELAXED_COMPARISON_OPTIONS.maximumSampleGapMs)) clear(session);
  if (session.lastObservationAtMs === live.tMs) return result('unknown', 'Waiting for a new camera observation.', endpoint);
  session.lastObservationAtMs = live.tMs;
  if (!session.baseline) {
    let startObserved = true;
    if (reference.motionRequired) {
      const referenceStart = points(reference.baseline, reference.referenceAspectRatio, requiredJoints(reference.focusJoints))!;
      const startPose = evaluateTeachingPose(reference.baseline, live, { referenceAspectRatio: reference.referenceAspectRatio,
        attemptAspectRatio: options.attemptAspectRatio, focusJoints: reference.focusJoints, liveAgeMs: age });
      // Seeing only an endpoint after an occlusion cannot establish that its action occurred.
      // Acquire the beginning half of the source displacement using preserved anatomical IDs.
      startObserved = startPose.status === 'close' && reference.referenceEvidence.filter((item) => item.active).every((item) => {
        const start = referenceStart.get(item.joint)!, current = normalized.get(item.joint)!;
        const progress = ((current.x - start.x) * item.direction!.x + (current.y - start.y) * item.direction!.y) / item.startToTarget;
        return progress <= 0.55;
      });
    }
    if (startObserved) { session.baseline = normalized; session.firstObservationAtMs = live.tMs; session.sampleCount = 0; }
  }
  if (session.baseline) session.sampleCount++;
  // Compute current displacement even when the held endpoint has not yet been
  // reached. This supports honest partial feedback without weakening matching.
  const motionEvidence = session.baseline ? reference.referenceEvidence.filter((item) => item.active).map((item) => {
    const a = session.baseline!.get(item.joint)!, b = normalized.get(item.joint)!;
    const projectedDisplacement = (b.x - a.x) * item.direction!.x + (b.y - a.y) * item.direction!.y;
    // This local guard is intentionally much broader than exact amplitude matching.
    const requiredDisplacement = Math.max(0.035, item.startToTarget * RELAXED_COMPARISON_OPTIONS.minimumExcursionRatio);
    return { joint: item.joint, observed: projectedDisplacement >= requiredDisplacement, projectedDisplacement, requiredDisplacement };
  }) : [];
  if (endpoint.status === 'adjust') return result('mismatch', `Target not matched yet: check your ${reference.focusLabel} against the teacher. Take your time.`, endpoint, motionEvidence);
  if (!reference.motionRequired) return result('match', `Target pose observed: ${reference.focusLabel}.`, endpoint);
  if (!session.baseline) return result('unknown', `Target pose is close, but the start of ${reference.focusLabel} movement was not observed. Follow the teacher from the beginning.`, endpoint);
  if (motionEvidence.every((item) => item.observed)) {
    const observedLabel = label(motionEvidence.map((item) => item.joint));
    return result('match', `Movement observed: ${observedLabel}; target pose is close.`, endpoint, motionEvidence);
  }
  if (session.sampleCount < 2) return result('unknown', `Target pose is close. Start with the teacher's beginning pose so ${reference.focusLabel} movement can be observed.`, endpoint, motionEvidence);
  const missing = label(motionEvidence.filter((item) => !item.observed).map((item) => item.joint));
  return result('mismatch', `Target pose is close; ${missing} movement has not been observed yet. Follow the teacher again.`, endpoint, motionEvidence);
}

const unitInterval = (value: number) => Math.max(0, Math.min(1, value));

/**
 * Transparent estimated checkpoint progress from the current VALID observation.
 * Movement steps: start acquired 20%, each required anatomical displacement an
 * equal share of 40%, current target proximity 40%. Target-only steps use 100%
 * target proximity. The endpoint term is 1 inside the existing acceptance bounds,
 * then decreases linearly to 0 at three times either bound. It is NOT visibility,
 * confidence, a clinical score, or a percentage of Tai Chi correctness. Missing,
 * stale, ambiguous, and insufficient-source observations always return null.
 * A complete number is reserved for an actual matcher result, not rounded ratios.
 */
export function summarizeFollowProgress(reference: FollowReference, result: FollowResult, session: FollowSession): FollowProgress {
  const active = reference.referenceEvidence.filter((item) => item.active);
  const descriptors = reference.motionRequired ? [
    { id: 'start', label: 'Beginning position observed', weight: 0.2 },
    ...active.map((item) => ({ id: `motion-${item.joint}`, label: `${NAMES[item.joint]} movement`, weight: 0.4 / active.length })),
    { id: 'target', label: 'Target pose proximity', weight: 0.4 },
  ] : [{ id: 'target', label: 'Target pose proximity', weight: 1 }];
  const unavailable = (reason: string): FollowProgress => ({ percent: null, reason,
    components: descriptors.map((item) => ({ ...item, complete: false, progress: null })),
    rulesVersion: FOLLOW_PROGRESS_RULES_VERSION });
  if (!reference.referenceUsable) return unavailable(reference.unknownReason || 'The teacher reference is insufficient for this step.');
  if (result.status === 'unknown' || session.referenceId !== reference.id || !result.endpoint
      || result.endpoint.status === 'unknown' || result.endpoint.positionError === null
      || !Number.isFinite(result.endpoint.positionError) || !result.endpoint.focusErrors.length
      || result.endpoint.focusErrors.some((item) => !Number.isFinite(item.error))) {
    return unavailable(result.status === 'unknown' ? result.message : 'Unable to judge from the current observation.');
  }
  // The bounds are the same held-pose comparator's .72 RMS and 1.05 worst-focus
  // torso distances. These numbers only normalize feedback; no thresholds change.
  const endpointRatio = Math.max(result.endpoint.positionError / 0.72,
    ...result.endpoint.focusErrors.map((item) => item.error / 1.05));
  const endpointProgress = result.endpoint.status === 'close' ? 1 : unitInterval((3 - endpointRatio) / 2);
  const components = descriptors.map((descriptor): FollowProgressComponent => {
    if (descriptor.id === 'start') return { ...descriptor, complete: !!session.baseline, progress: session.baseline ? 1 : 0 };
    if (descriptor.id === 'target') return { ...descriptor, complete: result.endpoint!.status === 'close', progress: endpointProgress };
    const evidence = result.motionEvidence.find((item) => `motion-${item.joint}` === descriptor.id);
    const valid = evidence && Number.isFinite(evidence.projectedDisplacement) && Number.isFinite(evidence.requiredDisplacement)
      && evidence.requiredDisplacement > 0;
    return { ...descriptor, complete: !!valid && evidence.observed,
      progress: valid ? unitInterval(evidence.projectedDisplacement / evidence.requiredDisplacement) : 0 };
  });
  const weighted = components.reduce((sum, item) => sum + item.progress! * item.weight, 0);
  // Rounding, a close endpoint, or one moving side can never become a pass.
  const percent = result.status === 'match' ? 100 : Math.min(99, Math.round(weighted * 100));
  const reasons: string[] = [];
  if (reference.motionRequired && !session.baseline) reasons.push('The beginning position has not been observed. Follow the teacher from the beginning.');
  else {
    const missing = components.filter((item) => item.id.startsWith('motion-') && !item.complete)
      .map((item) => Number(item.id.slice('motion-'.length)));
    if (missing.length) reasons.push(`${label(missing)} movement has not reached this step's observed checkpoint.`);
  }
  if (result.endpoint.status !== 'close') reasons.push(`Bring your ${reference.focusLabel} nearer the teacher's target pose.`);
  return { percent, components, reason: reasons.slice(0, 2).join(' ') || result.message,
    rulesVersion: FOLLOW_PROGRESS_RULES_VERSION };
}
