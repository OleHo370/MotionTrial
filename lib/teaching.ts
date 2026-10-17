import type { PoseSample, PracticeLandmark } from './imitation';

/** A forgiving learning aid for one held endpoint, never an assessment of correctness. */
export const TEACHING_RULES_VERSION = 'guided-endpoint-relaxed-v1.0';
export const TEACHING_PLAYLIST_SCHEMA = 'teaching-steps-v1';
const TORSO = [11, 12, 23, 24] as const;
const CHAINS: Record<number, readonly number[]> = {
  15: [11, 13, 15], 16: [12, 14, 16], 27: [23, 25, 27], 28: [24, 26, 28],
};
const LIMB_NAMES: Record<number, string> = { 15: 'left hand', 16: 'right hand', 27: 'left foot', 28: 'right foot' };

export interface TeachingStep {
  id: string;
  parentFormId: string;
  parentFormOrder: number;
  stepOrder: number;
  title: string;
  cue: string;
  /** Seconds within the existing parent-form video, not a newly generated clip. */
  startSeconds: number;
  endSeconds: number;
  /** Auditable seconds within the original source video. */
  sourceStartSeconds: number;
  sourceEndSeconds: number;
  /** Optional audited endpoint when a transition or fade obscures the last frame. */
  targetSeconds?: number;
  targetSourceSeconds?: number;
  focusJoints: number[];
  parentFormTitle?: string;
  chineseTitle?: string;
  chineseCue?: string;
}

export interface TeachingPlaylist {
  schemaVersion: typeof TEACHING_PLAYLIST_SCHEMA;
  id: string;
  title: string;
  source: string;
  referencePlaylistSrc: string;
  steps: TeachingStep[];
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function nonempty(value: unknown): value is string { return typeof value === 'string' && !!value.trim(); }
function validFocus(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && new Set(value).size === value.length
    && value.every((joint) => typeof joint === 'number' && Object.hasOwn(CHAINS, joint));
}
function nonnegative(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
function positiveInteger(value: unknown): value is number { return typeof value === 'number' && Number.isInteger(value) && value > 0; }

/** Reject ambiguous ordering and source boundaries; additional documentary fields are retained. */
export function parseTeachingPlaylist(value: unknown): TeachingPlaylist {
  if (!record(value) || value.schemaVersion !== TEACHING_PLAYLIST_SCHEMA
      || !['id', 'title', 'source', 'referencePlaylistSrc'].every((key) => nonempty(value[key]))
      || !Array.isArray(value.steps) || value.steps.length === 0) {
    throw new Error('The teaching playlist needs a supported schema, source and nonempty steps.');
  }
  if (!/^\/practice-media\/[^?#]+\.json$/.test(value.referencePlaylistSrc as string)
      || (value.referencePlaylistSrc as string).includes('..')) {
    throw new Error('The teaching reference playlist must be a local practice-media JSON asset.');
  }
  const ids = new Set<string>(), forms = new Set<string>();
  let previous: TeachingStep | null = null;
  for (const raw of value.steps) {
    if (!record(raw) || !['id', 'parentFormId', 'title', 'cue'].every((key) => nonempty(raw[key]))
        || !positiveInteger(raw.parentFormOrder) || !positiveInteger(raw.stepOrder) || !validFocus(raw.focusJoints)) {
      throw new Error('Every teaching step needs an ID, parent form, ordered position, cue and valid focus joints.');
    }
    for (const key of ['startSeconds', 'endSeconds', 'sourceStartSeconds', 'sourceEndSeconds']) {
      if (!nonnegative(raw[key])) throw new Error(`A teaching step has an invalid ${key}.`);
    }
    const step = raw as unknown as TeachingStep;
    if (ids.has(step.id)) throw new Error('The teaching playlist contains duplicate step IDs.');
    ids.add(step.id);
    if (step.endSeconds <= step.startSeconds || step.sourceEndSeconds <= step.sourceStartSeconds
        || Math.abs((step.endSeconds - step.startSeconds) - (step.sourceEndSeconds - step.sourceStartSeconds)) > 0.15) {
      throw new Error('Teaching step boundaries must have positive, consistent local and source durations.');
    }
    if ((step.targetSeconds !== undefined && (!nonnegative(step.targetSeconds)
        || step.targetSeconds < step.startSeconds || step.targetSeconds > step.endSeconds))
        || (step.targetSourceSeconds !== undefined && (!nonnegative(step.targetSourceSeconds)
        || step.targetSourceSeconds < step.sourceStartSeconds || step.targetSourceSeconds > step.sourceEndSeconds))
        || (step.targetSeconds !== undefined && step.targetSourceSeconds !== undefined
        && Math.abs((step.targetSourceSeconds - step.targetSeconds) - (step.sourceStartSeconds - step.startSeconds)) > 0.15)) {
      throw new Error('Teaching target frames must lie within their matching local and source step boundaries.');
    }
    if (previous?.parentFormId === step.parentFormId) {
      if (step.parentFormOrder !== previous.parentFormOrder || step.stepOrder !== previous.stepOrder + 1
          || step.startSeconds < previous.endSeconds - 0.05
          || step.sourceStartSeconds < previous.sourceEndSeconds - 0.05
          || Math.abs((step.sourceStartSeconds - step.startSeconds) - (previous.sourceStartSeconds - previous.startSeconds)) > 0.15) {
        throw new Error('Teaching steps within a form must have consecutive numbers and ordered source boundaries.');
      }
    } else {
      if (forms.has(step.parentFormId) || step.stepOrder !== 1 || step.parentFormOrder !== (previous?.parentFormOrder ?? 0) + 1
          || (previous && step.sourceStartSeconds < previous.sourceEndSeconds - 0.05)) {
        throw new Error('Teaching form groups must be contiguous and ordered, starting at form 1 and step 1.');
      }
      forms.add(step.parentFormId);
    }
    previous = step;
  }
  return value as unknown as TeachingPlaylist;
}

export interface TeachingPoseOptions {
  referenceAspectRatio: number;
  attemptAspectRatio: number;
  focusJoints?: number[];
  /** Clock age of the actual live observation. The two PoseSample times have different origins. */
  liveAgeMs?: number;
  maximumLiveAgeMs?: number;
}
export interface TeachingPoseResult {
  status: 'close' | 'adjust' | 'unknown';
  reason: string;
  /** RMS distance in torso-length units after body translation and uniform scale alignment. */
  positionError: number | null;
  focusErrors: Array<{ joint: number; error: number }>;
  comparedJoints: number[];
  rulesVersion: typeof TEACHING_RULES_VERSION;
}

interface Point { x: number; y: number }
function normalizedPoints(sample: PoseSample, aspect: number, required: number[]): Map<number, Point> | null {
  if (sample.status !== 'pose' || !Number.isFinite(sample.tMs) || sample.tMs < 0
      || !Number.isFinite(aspect) || aspect <= 0) return null;
  const points = new Map<number, PracticeLandmark>();
  for (const point of sample.landmarks) {
    if (points.has(point.index)) return null;
    points.set(point.index, point);
  }
  for (const index of required) {
    const point = points.get(index);
    if (!point || ![point.x, point.y, point.visibility].every(Number.isFinite)
        || point.visibility < 0.45 || point.visibility > 1
        || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return null;
  }
  const hipX = (points.get(23)!.x + points.get(24)!.x) / 2 * aspect;
  const hipY = (points.get(23)!.y + points.get(24)!.y) / 2;
  const shoulderX = (points.get(11)!.x + points.get(12)!.x) / 2 * aspect;
  const shoulderY = (points.get(11)!.y + points.get(12)!.y) / 2;
  const scale = Math.hypot(shoulderX - hipX, shoulderY - hipY);
  if (scale < 0.025) return null;
  return new Map(required.map((index) => {
    const point = points.get(index)!;
    return [index, { x: (point.x * aspect - hipX) / scale, y: (point.y - hipY) / scale }];
  }));
}

/**
 * Compare just the current teaching endpoint with an independently observed live pose.
 * Timing, speed, motion amplitude and stillness are deliberately not graded here.
 * Anatomical sides are preserved; mirroring remains a presentation-only choice.
 */
export function evaluateTeachingPose(target: PoseSample | null | undefined, live: PoseSample | null | undefined, options: TeachingPoseOptions): TeachingPoseResult {
  const result = (status: TeachingPoseResult['status'], reason: string, positionError: number | null = null,
    focusErrors: TeachingPoseResult['focusErrors'] = [], comparedJoints: number[] = []): TeachingPoseResult =>
    ({ status, reason, positionError, focusErrors, comparedJoints, rulesVersion: TEACHING_RULES_VERSION });
  const focus = options.focusJoints ?? [15, 16, 27, 28];
  if (!validFocus(focus)) return result('unknown', 'This teaching step has no valid movement focus.');
  if (!target || !live) return result('unknown', 'Waiting for a tracked reference and camera pose.');
  const age = options.liveAgeMs ?? 0, maximumAge = options.maximumLiveAgeMs ?? 450;
  if (!Number.isFinite(age) || age < 0 || !Number.isFinite(maximumAge) || maximumAge < 0 || age > maximumAge) {
    return result('unknown', 'Waiting for a fresh camera pose.');
  }
  const required = [...new Set([...TORSO, ...focus.flatMap((joint) => CHAINS[joint])])];
  const reference = normalizedPoints(target, options.referenceAspectRatio, required);
  if (!reference) return result('unknown', 'The reference endpoint is not clearly tracked. You can replay or continue manually.');
  const attempt = normalizedPoints(live, options.attemptAspectRatio, required);
  if (!attempt) return result('unknown', 'Keep your torso and this step’s hand or foot visible to the camera.');
  const distances = new Map(required.map((joint) => {
    const a = reference.get(joint)!, b = attempt.get(joint)!;
    return [joint, Math.hypot(a.x - b.x, a.y - b.y)];
  }));
  let weightedError = 0, totalWeight = 0;
  for (const joint of required) {
    const weight = focus.includes(joint) ? 2 : TORSO.some((index) => index === joint) ? 0.3 : 1;
    weightedError += distances.get(joint)! ** 2 * weight;
    totalWeight += weight;
  }
  const positionError = Math.sqrt(weightedError / totalWeight);
  const focusErrors = focus.map((joint) => ({ joint, error: distances.get(joint)! }));
  // These broad, versioned ranges are initial practice settings, not calibrated ability scores.
  const farthest = [...focusErrors].sort((a, b) => b.error - a.error)[0];
  if (positionError > 0.72 || farthest.error > 1.05) {
    return result('adjust', `Take your time. Bring your ${LIMB_NAMES[farthest.joint]} a little nearer the amber guide.`, positionError, focusErrors, required);
  }
  return result('close', 'Close enough for this learning step.', positionError, focusErrors, required);
}

export interface TeachingHold {
  targetKey: string;
  heldMs: number;
  ready: boolean;
  closeSinceMs: number | null;
  lastObservationAtMs: number | null;
}
export interface TeachingHoldOptions {
  targetKey: string;
  holdMs?: number;
  maximumSampleGapMs?: number;
  enabled?: boolean;
  reset?: boolean;
  /** Supply the inference timestamp when calls can occur more often than new camera frames. */
  observationTimestampMs?: number;
}

/** Only consecutive, fresh, real observations count; gaps/unknown never accumulate hold time. */
export function updateTeachingHold(
  previous: TeachingHold | null | undefined,
  observation: Pick<TeachingPoseResult, 'status'>,
  nowMs: number,
  options: TeachingHoldOptions,
): TeachingHold {
  const empty: TeachingHold = { targetKey: options.targetKey, heldMs: 0, ready: false, closeSinceMs: null, lastObservationAtMs: null };
  const stamp = options.observationTimestampMs ?? nowMs;
  const holdMs = options.holdMs ?? 700, maximumGap = options.maximumSampleGapMs ?? 450;
  if (options.enabled === false || !options.targetKey || !Number.isFinite(nowMs) || !Number.isFinite(stamp)
      || nowMs < 0 || stamp < 0 || stamp > nowMs || !Number.isFinite(holdMs) || holdMs <= 0
      || !Number.isFinite(maximumGap) || maximumGap <= 0 || nowMs - stamp > maximumGap
      || observation.status !== 'close') return empty;
  const baseline: TeachingHold = { ...empty, closeSinceMs: stamp, lastObservationAtMs: stamp };
  if (!previous || options.reset || previous.targetKey !== options.targetKey || previous.closeSinceMs === null
      || previous.lastObservationAtMs === null || stamp < previous.lastObservationAtMs
      || stamp - previous.lastObservationAtMs > maximumGap) return baseline;
  // Repeated rendering of the same inference does not create additional evidence.
  if (stamp === previous.lastObservationAtMs) return previous;
  const heldMs = stamp - previous.closeSinceMs;
  return { ...previous, heldMs, ready: heldMs >= holdMs, lastObservationAtMs: stamp };
}
