import type { PoseSample, PracticeLandmark } from './imitation';
import { FOLLOW_FOCUS_ROWS, FOLLOW_FOCUS_VERSION } from './follow-teacher';

/** A local point-acquisition game, not a full-body or clinical movement score. */
export const FOUR_POINT_RULES_VERSION = 'four-point-slide-v1.0';
export const FOUR_POINT_GUIDE_VERSION = 'observed-endpoint-medoid-v1.0';
export const FOUR_POINT_INDICES = [15, 16, 27, 28] as const;
export const FOUR_POINT_COLORS: Record<number, string> = { 15: '#41d9b1', 16: '#ffbf69', 27: '#79b8ff', 28: '#eaa4ff' };
const NAMES: Record<number, string> = { 15: 'Left hand', 16: 'Right hand', 27: 'Left foot', 28: 'Right foot' };
const FOCUS: Record<string, number[]> = { A: [15, 16], F: [27, 28], L: [27], R: [28] };
export const FOUR_POINT_OPTIONS = Object.freeze({ visibilityThreshold: 0.45, maximumAgeMs: 450,
  startRadius: 0.40, endRadius: 0.40, stationaryDistance: 0.08, minimumForward: 0.03,
  forwardFraction: 0.30, endpointWindowSeconds: 0.20 });

interface Point { x: number; y: number }
interface RecordedSample extends PoseSample { frameIndex: number; sourceTimeSeconds: number }
interface DualStep { id: string; title: string; front: { startSeconds: number; endSeconds: number } }
interface DualForm { formNumber: number; steps: DualStep[] }
interface FrontData { view: string; formNumber: number; fps: number; width: number; height: number; samples: RecordedSample[] }
export interface FourPointBodyFrame { hip: Point; scale: number; aspect: number }
export interface FourPointGuide {
  index: number; label: string; color: string; required: boolean; valid: boolean;
  start: Point | null; end: Point | null; startRaw: Point | null; endRaw: Point | null;
  startSourceSeconds: number | null; endSourceSeconds: number | null;
  support: { startFrames: number[]; endFrames: number[] }; distance: number | null; stationary: boolean;
}
export interface FourPointReference {
  id: string; title: string; focusJoints: number[]; guides: FourPointGuide[];
  referenceAspectRatio: number; referenceUsable: boolean; unknownReason: string | null;
  rulesVersion: string; guideVersion: string; focusVersion: string; guideProvenance: string;
}
interface LimbSession { start: Point | null; startSeen: boolean; firstAtMs: number | null; sampleCount: number; maximumForward: number }
export interface FourPointSession {
  referenceId: string; lastObservationAtMs: number | null; limbs: Record<number, LimbSession>;
}
export interface FourPointLimbResult {
  index: number; label: string; required: boolean; valid: boolean; stationary: boolean;
  startSeen: boolean; targetReached: boolean; movementObserved: boolean; progress: number | null;
  distanceToStart: number | null; distanceToTarget: number | null; projectedDisplacement: number | null;
}
export interface FourPointResult {
  status: 'match' | 'mismatch' | 'unknown'; percent: number | null; reason: string; message: string;
  limbs: FourPointLimbResult[]; focusJoints: number[]; rulesVersion: string;
}

function usable(point: PracticeLandmark | undefined) {
  const p = point as (PracticeLandmark & { presence?: number | null }) | undefined;
  return !!p && [p.x, p.y, p.visibility].every(Number.isFinite) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1
    && p.visibility >= FOUR_POINT_OPTIONS.visibilityThreshold && p.visibility <= 1
    && (p.presence === undefined || (p.presence !== null && Number.isFinite(p.presence) && p.presence >= FOUR_POINT_OPTIONS.visibilityThreshold && p.presence <= 1));
}
function rawPoints(sample: PoseSample | null | undefined): Map<number, PracticeLandmark> | null {
  if (!sample || sample.status !== 'pose' || !Number.isFinite(sample.tMs) || sample.tMs < 0) return null;
  const map = new Map<number, PracticeLandmark>();
  for (const p of sample.landmarks) { if (map.has(p.index)) return null; map.set(p.index, p); }
  return map;
}
/** Torso landmarks are used only to remove body position / scale; elbows are never required. */
export function getFourPointBodyFrame(sample: PoseSample | null | undefined, aspect: number): FourPointBodyFrame | null {
  const map = rawPoints(sample);
  if (!map || !Number.isFinite(aspect) || aspect <= 0 || ![11, 12, 23, 24].every((i) => usable(map.get(i)))) return null;
  const hip = { x: (map.get(23)!.x + map.get(24)!.x) * aspect / 2, y: (map.get(23)!.y + map.get(24)!.y) / 2 };
  const shoulder = { x: (map.get(11)!.x + map.get(12)!.x) * aspect / 2, y: (map.get(11)!.y + map.get(12)!.y) / 2 };
  const scale = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y);
  return scale >= 0.025 ? { hip, scale, aspect } : null;
}
function normalized(point: Point, body: FourPointBodyFrame): Point {
  return { x: (point.x * body.aspect - body.hip.x) / body.scale, y: (point.y - body.hip.y) / body.scale };
}
function distance(a: Point, b: Point) { return Math.hypot(a.x - b.x, a.y - b.y); }
function endpoint(samples: RecordedSample[], index: number, aspect: number) {
  const observed = samples.flatMap((sample) => {
    const body = getFourPointBodyFrame(sample, aspect), p = rawPoints(sample)?.get(index);
    return body && usable(p) ? [{ point: normalized(p!, body), raw: { x: p!.x, y: p!.y }, sample }] : [];
  });
  // At least two actual observations support the endpoint; no confidence-gap interpolation.
  if (observed.length < 2) return null;
  const medoid = observed.reduce((best, current) => {
    const total = observed.reduce((sum, p) => sum + distance(current.point, p.point), 0);
    return total < best.total ? { value: current, total } : best;
  }, { value: observed[0], total: Infinity }).value;
  return { ...medoid, frames: observed.map((p) => p.sample.frameIndex) };
}

/** Each displayed straight line is a designed guide between real observed endpoints, not a reconstructed trajectory. */
export function prepareFourPointStep(form: DualForm, step: DualStep, data: FrontData): FourPointReference {
  const stepIndex = form.steps.findIndex((s) => s.id === step.id), row = FOLLOW_FOCUS_ROWS[form.formNumber - 1];
  if (!row || row.length !== form.steps.length || stepIndex < 0 || data.view !== 'front' || data.formNumber !== form.formNumber
    || !Number.isFinite(data.fps) || data.fps <= 0 || !Number.isFinite(data.width / data.height) || data.height <= 0) {
    throw new Error('Use the unchanged front-source observations and existing semantic step mapping.');
  }
  const focusJoints = [...FOCUS[row[stepIndex]]], aspect = data.width / data.height;
  const first = Math.floor(step.front.startSeconds * data.fps + 0.00001);
  const last = Math.ceil(step.front.endSeconds * data.fps - 0.00001) - 1;
  const width = Math.max(2, Math.min(Math.round(FOUR_POINT_OPTIONS.endpointWindowSeconds * data.fps), Math.floor((last - first + 1) / 4)));
  const starts = data.samples.filter((s) => s.frameIndex >= first && s.frameIndex < first + width);
  const ends = data.samples.filter((s) => s.frameIndex <= last && s.frameIndex > last - width);
  const guides = FOUR_POINT_INDICES.map((index): FourPointGuide => {
    const start = endpoint(starts, index, aspect), end = endpoint(ends, index, aspect);
    const valid = !!start && !!end, length = valid ? distance(start.point, end.point) : null;
    return { index, label: NAMES[index], color: FOUR_POINT_COLORS[index], required: focusJoints.includes(index), valid,
      start: start?.point ?? null, end: end?.point ?? null, startRaw: start?.raw ?? null, endRaw: end?.raw ?? null,
      startSourceSeconds: start?.sample.sourceTimeSeconds ?? null, endSourceSeconds: end?.sample.sourceTimeSeconds ?? null,
      support: { startFrames: start?.frames ?? [], endFrames: end?.frames ?? [] }, distance: length,
      stationary: length !== null && length < FOUR_POINT_OPTIONS.stationaryDistance };
  });
  const absent = guides.filter((g) => g.required && !g.valid);
  const unknownReason = absent.length ? `The teacher's ${absent.map((g) => g.label.toLowerCase()).join(' and ')} need clearer recorded endpoints. Visual practice only.` : null;
  return { id: step.id, title: step.title, focusJoints, guides, referenceAspectRatio: aspect,
    referenceUsable: unknownReason === null, unknownReason, rulesVersion: FOUR_POINT_RULES_VERSION,
    guideVersion: FOUR_POINT_GUIDE_VERSION, focusVersion: FOLLOW_FOCUS_VERSION,
    guideProvenance: 'Straight game guides join actual front-source medoid observations within short start/end windows. Missing endpoints are not filled in. Only the named step focus is required; other limb guides are optional.' };
}

function freshLimb(): LimbSession { return { start: null, startSeen: false, firstAtMs: null, sampleCount: 0, maximumForward: 0 }; }
export function createFourPointSession(reference: Pick<FourPointReference, 'id'>): FourPointSession {
  return { referenceId: reference.id, lastObservationAtMs: null, limbs: Object.fromEntries(FOUR_POINT_INDICES.map((i) => [i, freshLimb()])) };
}
function clear(session: FourPointSession, id: string) { Object.assign(session, createFourPointSession({ id })); }

/** The helper returns raw camera coordinates. Mirror the canvas/video only after this calculation. */
export function projectFourPointGuides(reference: FourPointReference, live: PoseSample | null | undefined,
  aspect: number, fixedBodyFrame?: FourPointBodyFrame | null) {
  const body = fixedBodyFrame ?? getFourPointBodyFrame(live, aspect);
  const project = (p: Point | null) => p && body ? { x: (p.x * body.scale + body.hip.x) / body.aspect, y: p.y * body.scale + body.hip.y } : null;
  return reference.guides.map((g) => ({ ...g, start: project(g.start), end: project(g.end), valid: g.valid && !!body }));
}

/** Named raw anatomical points acquire start → move forward → reach end; optional points never block the game. */
export function evaluateFourPointObservation(reference: FourPointReference, live: PoseSample | null | undefined,
  options: { attemptAspectRatio: number; liveAgeMs?: number; session: FourPointSession }): FourPointResult {
  const session = options.session;
  const result = (status: FourPointResult['status'], reason: string, limbs: FourPointLimbResult[] = [], percent: number | null = null): FourPointResult =>
    ({ status, percent, reason, message: reason, limbs, focusJoints: [...reference.focusJoints], rulesVersion: FOUR_POINT_RULES_VERSION });
  if (session.referenceId !== reference.id) clear(session, reference.id);
  if (!reference.referenceUsable) { clear(session, reference.id); return result('unknown', reference.unknownReason ?? 'The recorded endpoints cannot be assessed.'); }
  const body = getFourPointBodyFrame(live, options.attemptAspectRatio), raw = rawPoints(live);
  const age = options.liveAgeMs ?? 0;
  if (!Number.isFinite(age) || age < 0 || age > FOUR_POINT_OPTIONS.maximumAgeMs || !body || !raw) {
    clear(session, reference.id); return result('unknown', 'Keep your whole body in view. A fresh camera observation is needed.');
  }
  const missing = reference.focusJoints.filter((i) => !usable(raw.get(i)));
  if (missing.length) { clear(session, reference.id); return result('unknown', `${missing.map((i) => NAMES[i]).join(' and ')} temporarily hidden. Keep them in view.`); }
  const tMs = live!.tMs;
  if (session.lastObservationAtMs !== null && tMs <= session.lastObservationAtMs) return result('unknown', 'Waiting for a fresh camera frame.');
  if (session.lastObservationAtMs !== null && tMs - session.lastObservationAtMs > FOUR_POINT_OPTIONS.maximumAgeMs) clear(session, reference.id);
  session.lastObservationAtMs = tMs;
  const limbs = reference.guides.map((guide): FourPointLimbResult => {
    const point = raw.get(guide.index), state = session.limbs[guide.index];
    const unknown: FourPointLimbResult = { index: guide.index, label: guide.label, required: guide.required,
      valid: false, stationary: guide.stationary, startSeen: false, targetReached: false, movementObserved: false,
      progress: null, distanceToStart: null, distanceToTarget: null, projectedDisplacement: null };
    if (!guide.valid || !usable(point)) return unknown;
    const p = normalized(point!, body), start = guide.start!, end = guide.end!;
    const toStart = distance(p, start), toEnd = distance(p, end), length = guide.distance!;
    if (!state.startSeen && toStart <= FOUR_POINT_OPTIONS.startRadius) {
      state.startSeen = true; state.start = p; state.firstAtMs = tMs; state.sampleCount = 0;
    }
    if (state.startSeen) state.sampleCount++;
    const forward = state.start && length > 0 ? ((p.x - state.start.x) * (end.x - start.x) + (p.y - state.start.y) * (end.y - start.y)) / length : 0;
    state.maximumForward = Math.max(state.maximumForward, forward);
    const needed = Math.max(FOUR_POINT_OPTIONS.minimumForward, length * FOUR_POINT_OPTIONS.forwardFraction);
    const movementObserved = guide.stationary || (state.sampleCount >= 2 && state.maximumForward >= needed);
    const targetReached = state.startSeen && state.sampleCount >= 2 && movementObserved && toEnd <= FOUR_POINT_OPTIONS.endRadius;
    const travel = guide.stationary ? (state.startSeen ? 1 : 0) : Math.min(1, state.maximumForward / needed);
    const progress = targetReached ? 1 : Math.min(0.95, (state.startSeen ? 0.25 : 0) + 0.35 * travel + (toEnd <= FOUR_POINT_OPTIONS.endRadius ? 0.30 : 0));
    return { index: guide.index, label: guide.label, required: guide.required, valid: true, stationary: guide.stationary,
      startSeen: state.startSeen, targetReached, movementObserved, progress, distanceToStart: toStart, distanceToTarget: toEnd,
      projectedDisplacement: forward };
  });
  const required = limbs.filter((g) => g.required), percent = Math.round(required.reduce((sum, g) => sum + (g.progress ?? 0), 0) / required.length * 100);
  if (required.every((g) => g.targetReached)) return result('match', 'Targets reached. Hold briefly to collect this step.', limbs, 100);
  const pending = required.find((g) => !g.targetReached)!;
  const reason = !pending.startSeen ? `Place your ${pending.label.toLowerCase()} on its start ring.`
    : !pending.movementObserved ? `Slide your ${pending.label.toLowerCase()} along its guide.`
    : `Move your ${pending.label.toLowerCase()} into its end ring.`;
  return result('mismatch', reason, limbs, percent);
}
