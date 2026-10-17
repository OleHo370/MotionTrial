/** Experimental, transparent movement matching. This is not a clinical score. */
export const IMITATION_RULES_VERSION = 'single-action-v0.3';
export const PRACTICE_MATCHING_RULES_VERSION = 'practice-relaxed-v1.1';
export const PRACTICE_JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28] as const;
export const PRACTICE_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24],
  [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
];
export interface PracticeLandmark { index: number; x: number; y: number; z: number; visibility: number }
export interface PoseSample {
  /** Time within this reference clip / learner attempt, not the model's monotonic clock. */
  tMs: number;
  status: 'pose' | 'no_pose' | 'inference_error';
  landmarks: PracticeLandmark[];
}
export interface ComparisonOptions {
  referenceAspectRatio: number;
  attemptAspectRatio: number;
  referenceDurationMs?: number;
  attemptDurationMs?: number;
  visibilityThreshold: number;
  minimumCoverage: number;
  maximumSampleGapMs: number;
  minimumSamples: number;
  alignmentWindow: number;
  maximumPositionError: number;
  maximumAngleError: number;
  maximumPhaseError: number;
  minimumReferenceExcursion: number;
  minimumExcursionRatio: number;
  minimumActiveLimbExcursion: number;
  maximumLimbPhaseError: number;
  limbPhaseExcursionRatio: number;
  /** Manually audited movement endpoints for the selected reference, if supplied. */
  focusJoints?: number[];
  minimumFocusExcursion: number;
  minimumFocusPhaseDisplacement: number;
  minimumDirectionDisplacement: number;
  minimumDirectionRatio: number;
  /** Selection of actual observed frames bounds both excursion and DTW work. */
  maximumComparisonFrames?: number;
  /** With an audited focus, ignore untracked unrelated limbs, never the focus. */
  trackingPolicy?: 'full-body' | 'focused';
  minimumLimbPhaseTolerance?: number;
  /** Practice can require direction evidence for inferred active limbs as well. */
  requireDirection?: boolean;
}
/** Initial demo settings, to be calibrated using actual camera attempts. */
export const DEFAULT_COMPARISON_OPTIONS: ComparisonOptions = {
  referenceAspectRatio: 1, attemptAspectRatio: 1,
  visibilityThreshold: 0.6, minimumCoverage: 0.8, maximumSampleGapMs: 350,
  minimumSamples: 9, alignmentWindow: 0.22,
  maximumPositionError: 0.38, maximumAngleError: 0.5, maximumPhaseError: 0.45,
  minimumReferenceExcursion: 0.15, minimumExcursionRatio: 0.45,
  minimumActiveLimbExcursion: 0.3, maximumLimbPhaseError: 0.65, limbPhaseExcursionRatio: 0.65,
  minimumFocusExcursion: 0.15, minimumFocusPhaseDisplacement: 0.12,
  minimumDirectionDisplacement: 0.06, minimumDirectionRatio: 0.2,
  maximumComparisonFrames: 120, trackingPolicy: 'full-body', minimumLimbPhaseTolerance: 0.18,
  requireDirection: false,
};
/** Forgiving practice thresholds; these are experimental, not a clinical score. */
export const RELAXED_COMPARISON_OPTIONS: ComparisonOptions = {
  ...DEFAULT_COMPARISON_OPTIONS,
  visibilityThreshold: 0.45, minimumCoverage: 0.7, maximumSampleGapMs: 450,
  alignmentWindow: 0.3, maximumPositionError: 0.56, maximumAngleError: 0.75,
  maximumPhaseError: 0.68, minimumReferenceExcursion: 0.12, minimumExcursionRatio: 0.3,
  maximumLimbPhaseError: 0.95, limbPhaseExcursionRatio: 1.05, minimumLimbPhaseTolerance: 0.32,
  minimumFocusExcursion: 0.12, minimumFocusPhaseDisplacement: 0.09,
  minimumDirectionDisplacement: 0.07, minimumDirectionRatio: 0.05,
  trackingPolicy: 'focused', requireDirection: true,
};
export const PRACTICE_PROFILES = {
  easy: RELAXED_COMPARISON_OPTIONS,
  standard: DEFAULT_COMPARISON_OPTIONS,
} as const;
export type PracticeProfile = keyof typeof PRACTICE_PROFILES;
export interface AttemptResult {
  status: 'matched' | 'repeat' | 'unknown';
  reason: string;
  rulesVersion: string;
  diagnostics: {
    referenceCoverage: number; attemptCoverage: number;
    trajectoryError: number | null; angleError: number | null;
    referenceExcursion: number; attemptExcursion: number;
    /** Fraction of start, middle and end phases with valid, matching evidence. */
    phaseCoverage: number;
    activeLimbs: Array<{ joint: number; referenceExcursion: number; attemptExcursion: number; phaseError: number | null; directionRatio: number | null }>;
  };
}
interface Point { x: number; y: number }
interface Frame { progress: number; points: Array<Point | null>; angles: Array<number | null> }
const angleJoints = [[11, 13, 15], [12, 14, 16], [23, 25, 27], [24, 26, 28]] as const;
const weights = PRACTICE_JOINTS.map((joint) => [15, 16, 27, 28].includes(joint) ? 2 : 1);
const focusChains: Record<number, number[]> = { 15: [11, 13, 15], 16: [12, 14, 16], 27: [23, 25, 27], 28: [24, 26, 28] };
const limbNames: Record<number, string> = { 15: 'left arm', 16: 'right arm', 27: 'left leg', 28: 'right leg' };

function angle(a: Point, b: Point, c: Point): number | null {
  const ux = a.x - b.x, uy = a.y - b.y, vx = c.x - b.x, vy = c.y - b.y;
  const length = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (length < 0.00001) return null;
  return Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / length)));
}

function normalizedFrame(sample: PoseSample, aspect: number, duration: number, options: ComparisonOptions): Frame | null {
  if (sample.status !== 'pose' || !Number.isFinite(aspect) || aspect <= 0 || duration <= 0) return null;
  const joints = new Map(sample.landmarks.map((point) => [point.index, point]));
  const focused = options.trackingPolicy === 'focused' && !!options.focusJoints?.length;
  const required = new Set(focused ? [11, 12, 23, 24, ...options.focusJoints!.flatMap((joint) => focusChains[joint] ?? [])] : PRACTICE_JOINTS);
  const points: Array<Point | null> = [];
  for (const index of PRACTICE_JOINTS) {
    const point = joints.get(index);
    if (!point || ![point.x, point.y, point.visibility].every(Number.isFinite)
        || point.visibility < options.visibilityThreshold || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) {
      if (required.has(index)) return null;
      points.push(null);
      continue;
    }
    // Landmarks use image-relative x and y; correct the aspect before geometry.
    points.push({ x: point.x * aspect, y: point.y });
  }
  const hipLeft = points[6]!, hipRight = points[7]!;
  const hip = { x: (hipLeft.x + hipRight.x) / 2, y: (hipLeft.y + hipRight.y) / 2 };
  const shoulder = { x: (points[0]!.x + points[1]!.x) / 2, y: (points[0]!.y + points[1]!.y) / 2 };
  const scale = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y);
  if (scale < 0.025) return null;
  const normalized = points.map((point) => point ? { x: (point.x - hip.x) / scale, y: (point.y - hip.y) / scale } : null);
  const angles: Array<number | null> = [];
  for (const [a, b, c] of angleJoints) {
    const pa = normalized[PRACTICE_JOINTS.indexOf(a)], pb = normalized[PRACTICE_JOINTS.indexOf(b)], pc = normalized[PRACTICE_JOINTS.indexOf(c)];
    const value = pa && pb && pc ? angle(pa, pb, pc) : null;
    if (value === null && (!focused || required.has(c))) return null;
    angles.push(value);
  }
  // Anatomical labels are preserved. No reflection / best-of-two mirror matching.
  return { progress: sample.tMs / duration, points: normalized, angles };
}

function positionDistance(a: Frame, b: Frame): number {
  let sum = 0, total = 0;
  a.points.forEach((point, index) => {
    const other = b.points[index];
    if (!point || !other) return;
    sum += weights[index] * ((point.x - other.x) ** 2 + (point.y - other.y) ** 2);
    total += weights[index];
  });
  return total > 0 ? Math.sqrt(sum / total) : Infinity;
}
function angleDistance(a: Frame, b: Frame): number {
  const differences = a.angles.flatMap((value, index) => value !== null && b.angles[index] !== null ? [Math.abs(value - b.angles[index]!)] : []);
  return differences.length ? differences.reduce((sum, value) => sum + value, 0) / differences.length : Infinity;
}

/** A robust range prevents one noisy endpoint from making a static leg active. */
function limbExcursion(frames: Frame[], pointIndex: number): number {
  if (frames.length < 2) return 0;
  const range = (coordinate: 'x' | 'y') => {
    const values = frames.flatMap((frame) => frame.points[pointIndex] ? [frame.points[pointIndex]![coordinate]] : []).sort((a, b) => a - b);
    if (values.length < 2) return 0;
    return values[Math.floor((values.length - 1) * 0.9)] - values[Math.floor((values.length - 1) * 0.1)];
  };
  return Math.hypot(range('x'), range('y'));
}

function prepare(samples: PoseSample[], aspect: number, explicitDuration: number | undefined, options: ComparisonOptions) {
  // At a duplicate time, the last observation wins (including explicit no-pose).
  const byTime = new Map<number, PoseSample>();
  for (const sample of samples) if (Number.isFinite(sample.tMs) && sample.tMs >= 0) byTime.set(sample.tMs, sample);
  const ordered = [...byTime.values()].sort((a, b) => a.tMs - b.tMs);
  const duration = explicitDuration ?? ordered.at(-1)?.tMs ?? 0;
  const observedFrames: Frame[] = [];
  let validMs = 0;
  for (let index = 0; index < ordered.length; index++) {
    const sample = ordered[index];
    if (sample.tMs > duration) continue;
    const frame = normalizedFrame(sample, aspect, duration, options);
    if (!frame) continue;
    observedFrames.push(frame);
    const next = ordered[index + 1]?.tMs ?? duration;
    validMs += Math.max(0, Math.min(next, duration, sample.tMs + options.maximumSampleGapMs) - sample.tMs);
  }
  // Coverage uses every real observation above. Geometry selects actual frames
  // including both endpoints; no missing positions are generated or filled in.
  const requestedLimit = options.maximumComparisonFrames ?? 120;
  const limit = Number.isFinite(requestedLimit) ? Math.max(12, Math.min(240, Math.floor(requestedLimit))) : 120;
  const frames = observedFrames.length <= limit ? observedFrames : Array.from({ length: limit }, (_, index) =>
    observedFrames[Math.round(index * (observedFrames.length - 1) / (limit - 1))]);
  let excursion = 0;
  for (let a = 0; a < frames.length; a++) for (let b = a + 1; b < frames.length; b++) {
    excursion = Math.max(excursion, positionDistance(frames[a], frames[b]));
  }
  return { frames, duration, coverage: duration > 0 ? validMs / duration : 0, excursion };
}

function phase(progress: number): number {
  if (progress <= 0.25) return 0;
  if (progress >= 0.375 && progress <= 0.625) return 1;
  if (progress >= 0.75) return 2;
  return -1;
}

function phaseCentroids(frames: Frame[], pointIndex: number): Point[] {
  return [0, 1, 2].map((bin) => {
    const points = frames.filter((frame) => phase(frame.progress) === bin).flatMap((frame) => frame.points[pointIndex] ? [frame.points[pointIndex]!] : []);
    return { x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length };
  });
}

const phasePairs = [[0, 1], [1, 2], [0, 2]] as const;
function maximumPhaseDisplacement(points: Point[]): number {
  return Math.max(...phasePairs.map(([start, end]) => Math.hypot(points[end].x - points[start].x, points[end].y - points[start].y)));
}

/** Local summaries of observed points reject isolated spikes without filling gaps. */
function motionEvidencePoints(points: Point[]): Point[] {
  const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  return points.map((_, index) => {
    const center = Math.max(1, Math.min(points.length - 2, index));
    const observed = points.slice(center - 1, center + 2);
    return { x: median(observed.map((point) => point.x)), y: median(observed.map((point) => point.y)) };
  });
}

function maximumDisplacement(points: Point[]): number {
  let maximum = 0;
  for (let a = 0; a < points.length; a++) for (let b = a + 1; b < points.length; b++) {
    maximum = Math.max(maximum, Math.hypot(points[b].x - points[a].x, points[b].y - points[a].y));
  }
  return maximum;
}

/** Follow substantial local trajectory legs, including out-and-back cycles. */
function trajectoryDirectionRatio(expected: Point[], observed: Point[], options: ComparisonOptions): number | null {
  const threshold = Math.max(options.minimumDirectionDisplacement, maximumDisplacement(expected) * 0.12);
  let previous = 0, expectedEnergy = 0, projection = 0;
  for (let index = 1; index < expected.length; index++) {
    const dx = expected[index].x - expected[previous].x, dy = expected[index].y - expected[previous].y;
    if (Math.hypot(dx, dy) < threshold) continue;
    const liveDx = observed[index].x - observed[previous].x, liveDy = observed[index].y - observed[previous].y;
    projection += liveDx * dx + liveDy * dy;
    expectedEnergy += dx * dx + dy * dy;
    previous = index;
  }
  // The energy-weighted ratio tolerates an approximate range and a short pause;
  // reversing a substantial trajectory produces opposing signed evidence.
  return expectedEnergy > 0 ? projection / expectedEnergy : null;
}

/**
 * Whole-trajectory comparison, with a monotonic, time-bounded DTW path anchored
 * at both ends. Bounded samples retain actual endpoints; poses cannot be reordered.
 * Missing tracking is unknown and is never interpolated or counted as failure.
 */
export function evaluateAttempt(reference: PoseSample[], attempt: PoseSample[], overrides: Partial<ComparisonOptions> = {}): AttemptResult {
  const options = { ...DEFAULT_COMPARISON_OPTIONS, ...overrides };
  const ref = prepare(reference, options.referenceAspectRatio, options.referenceDurationMs, options);
  const live = prepare(attempt, options.attemptAspectRatio, options.attemptDurationMs, options);
  const diagnostics: AttemptResult['diagnostics'] = {
    referenceCoverage: ref.coverage, attemptCoverage: live.coverage,
    trajectoryError: null, angleError: null, referenceExcursion: ref.excursion,
    attemptExcursion: live.excursion, phaseCoverage: 0, activeLimbs: [],
  };
  const result = (status: AttemptResult['status'], reason: string): AttemptResult => ({ status, reason, rulesVersion: IMITATION_RULES_VERSION, diagnostics });
  if (ref.coverage < options.minimumCoverage || ref.frames.length < options.minimumSamples) {
    return result('unknown', 'Reference tracking is incomplete. Choose a clip with shoulders, wrists, hips, knees and ankles visible.');
  }
  if (live.coverage < options.minimumCoverage || live.frames.length < options.minimumSamples) {
    return result('unknown', 'Tracking is incomplete. Keep your full body in view and try this movement again.');
  }
  for (const sequence of [ref.frames, live.frames]) {
    const counts = [0, 0, 0];
    for (const frame of sequence) { const bin = phase(frame.progress); if (bin >= 0) counts[bin]++; }
    if (counts.some((count) => count < 2)) return result('unknown', 'A complete start, middle and end could not be observed. Try again.');
  }
  const hasFocus = options.focusJoints !== undefined;
  if (hasFocus && (!options.focusJoints?.length || new Set(options.focusJoints).size !== options.focusJoints.length
      || options.focusJoints.some((joint) => ![15, 16, 27, 28].includes(joint)))) {
    return result('unknown', 'The reference movement focus is invalid. Select an audited reference with wrist or ankle focus joints.');
  }
  if (!hasFocus && ref.excursion < options.minimumReferenceExcursion) {
    return result('unknown', 'This reference has too little visible change for the current movement matcher.');
  }
  // A small, deliberate foot movement must not be diluted by eleven static joints.
  // A supplied focus must show both a robust range AND coherent phase change;
  // otherwise this reference remains unknown rather than relaxing all thresholds.
  const referencePhases: Point[][] = [];
  const referenceMotion: Point[][] = [];
  for (const joint of options.focusJoints ?? [15, 16, 27, 28]) {
    const pointIndex = PRACTICE_JOINTS.indexOf(joint as typeof PRACTICE_JOINTS[number]);
    const referenceExcursion = limbExcursion(ref.frames, pointIndex);
    const phases = phaseCentroids(ref.frames, pointIndex);
    const motion = options.requireDirection ? motionEvidencePoints(ref.frames.map((frame) => frame.points[pointIndex]!)) : [];
    const coherentDisplacement = options.requireDirection ? maximumDisplacement(motion) : maximumPhaseDisplacement(phases);
    if (hasFocus) {
      if (referenceExcursion < options.minimumFocusExcursion || coherentDisplacement < options.minimumFocusPhaseDisplacement) {
        return result('unknown', `The reference ${limbNames[joint]} has too little coherent visible change for its declared focus.`);
      }
    } else if (referenceExcursion < options.minimumActiveLimbExcursion) continue;
    else if (options.requireDirection && coherentDisplacement < options.minimumFocusPhaseDisplacement) continue;
    const attemptExcursion = limbExcursion(live.frames, pointIndex);
    diagnostics.activeLimbs.push({ joint, referenceExcursion, attemptExcursion, phaseError: null, directionRatio: null });
    referencePhases.push(phases);
    referenceMotion.push(motion);
  }
  if (options.requireDirection && !diagnostics.activeLimbs.length) return result('unknown', 'This reference has too little coherent visible limb change for the current movement matcher.');
  if (live.excursion < ref.excursion * options.minimumExcursionRatio) {
    return result('repeat', 'The full movement was not observed. Follow the reference from its start through its finish.');
  }
  // Activity follows this reference, not an assumption that all four limbs must move.
  // Per-limb checks prevent one moving arm from hiding an entirely omitted arm in
  // the whole-body mean. They are imitation evidence, never capture-quality labels.
  const omitted = diagnostics.activeLimbs.find((limb) => limb.attemptExcursion < limb.referenceExcursion * options.minimumExcursionRatio);
  if (omitted) return result('repeat', `The reference ${limbNames[omitted.joint]} movement was not observed through its full sequence. Try this movement again.`);

  const rows = ref.frames.length, cols = live.frames.length;
  const costs = Array.from({ length: rows }, () => new Float64Array(cols).fill(Infinity));
  const previous = Array.from({ length: rows }, () => new Int8Array(cols).fill(-1));
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const a = ref.frames[r], b = live.frames[c];
    if (Math.abs(a.progress - b.progress) > options.alignmentWindow) continue;
    const cost = positionDistance(a, b) + angleDistance(a, b) * 0.18;
    if (r === 0 && c === 0) { costs[r][c] = cost; continue; }
    // A small repetition penalty prefers phase progression over held-frame paths.
    const candidates = [r > 0 && c > 0 ? costs[r - 1][c - 1] : Infinity,
      r > 0 ? costs[r - 1][c] + 0.025 : Infinity,
      c > 0 ? costs[r][c - 1] + 0.025 : Infinity];
    const direction = candidates.indexOf(Math.min(...candidates));
    if (Number.isFinite(candidates[direction])) {
      costs[r][c] = cost + candidates[direction]; previous[r][c] = direction;
    }
  }
  if (!Number.isFinite(costs[rows - 1][cols - 1])) {
    return result('repeat', 'The movement timing did not align from start to finish. Follow the reference and try again.');
  }
  let r = rows - 1, c = cols - 1, count = 0, positionSum = 0, angleSum = 0;
  const phaseSums = [0, 0, 0], phaseCounts = [0, 0, 0];
  const limbPhaseSums = diagnostics.activeLimbs.map(() => [0, 0, 0]);
  const alignedLivePhases = diagnostics.activeLimbs.map(() => [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }]);
  const alignedLiveMotion = diagnostics.activeLimbs.map(() => ref.frames.map(() => ({ x: 0, y: 0, count: 0 })));
  while (r >= 0 && c >= 0) {
    const a = ref.frames[r], b = live.frames[c];
    const error = positionDistance(a, b);
    positionSum += error; angleSum += angleDistance(a, b); count++;
    for (let index = 0; index < diagnostics.activeLimbs.length; index++) {
      const pointIndex = PRACTICE_JOINTS.indexOf(diagnostics.activeLimbs[index].joint as typeof PRACTICE_JOINTS[number]);
      const aligned = alignedLiveMotion[index][r];
      aligned.x += b.points[pointIndex]!.x; aligned.y += b.points[pointIndex]!.y; aligned.count++;
    }
    const bin = phase(a.progress);
    if (bin >= 0) {
      phaseSums[bin] += error; phaseCounts[bin]++;
      for (let index = 0; index < diagnostics.activeLimbs.length; index++) {
        const pointIndex = PRACTICE_JOINTS.indexOf(diagnostics.activeLimbs[index].joint as typeof PRACTICE_JOINTS[number]);
        // Active limbs are required observations in focused tracking mode.
        limbPhaseSums[index][bin] += Math.hypot(a.points[pointIndex]!.x - b.points[pointIndex]!.x,
          a.points[pointIndex]!.y - b.points[pointIndex]!.y);
        alignedLivePhases[index][bin].x += b.points[pointIndex]!.x;
        alignedLivePhases[index][bin].y += b.points[pointIndex]!.y;
      }
    }
    const direction = previous[r][c];
    if (direction === 0) { r--; c--; } else if (direction === 1) r--; else if (direction === 2) c--; else break;
  }
  diagnostics.trajectoryError = positionSum / count;
  diagnostics.angleError = angleSum / count;
  diagnostics.phaseCoverage = phaseSums.filter((sum, bin) => phaseCounts[bin] >= 2
    && sum / phaseCounts[bin] <= options.maximumPhaseError).length / 3;
  for (let index = 0; index < diagnostics.activeLimbs.length; index++) {
    diagnostics.activeLimbs[index].phaseError = Math.max(...limbPhaseSums[index].map((sum, bin) =>
      phaseCounts[bin] > 0 ? sum / phaseCounts[bin] : Infinity));
    if (options.requireDirection) {
      const observed = motionEvidencePoints(alignedLiveMotion[index].map((point) => ({ x: point.x / point.count, y: point.y / point.count })));
      diagnostics.activeLimbs[index].directionRatio = trajectoryDirectionRatio(referenceMotion[index], observed, options);
    } else if (hasFocus) {
      const observed = alignedLivePhases[index].map((point, bin) => ({ x: point.x / phaseCounts[bin], y: point.y / phaseCounts[bin] }));
      const expected = referencePhases[index];
      const maximumDisplacement = maximumPhaseDisplacement(expected);
      const ratios: number[] = [];
      for (const [start, end] of phasePairs) {
        const dx = expected[end].x - expected[start].x, dy = expected[end].y - expected[start].y;
        const length = Math.hypot(dx, dy);
        // Ignore small settling/jitter phases, but preserve substantial intermediate
        // changes and direction even when a whole action returns to its start.
        if (length < Math.max(options.minimumDirectionDisplacement, maximumDisplacement * 0.35)) continue;
        const liveDx = observed[end].x - observed[start].x, liveDy = observed[end].y - observed[start].y;
        ratios.push((liveDx * dx + liveDy * dy) / (length * length));
      }
      diagnostics.activeLimbs[index].directionRatio = ratios.length ? Math.min(...ratios) : null;
    }
  }
  const wrongDirection = (hasFocus || options.requireDirection) && diagnostics.activeLimbs.find((limb) => !Number.isFinite(limb.directionRatio)
    || (limb.directionRatio ?? -Infinity) < options.minimumDirectionRatio);
  if (wrongDirection) return result('repeat', `The ${limbNames[wrongDirection.joint]} did not progress in the reference direction through the movement phases. Try again.`);
  const misplaced = diagnostics.activeLimbs.find((limb) => (limb.phaseError ?? Infinity)
    > Math.max(options.minimumLimbPhaseTolerance ?? 0.18, Math.min(options.maximumLimbPhaseError, limb.referenceExcursion * options.limbPhaseExcursionRatio)));
  if (misplaced) return result('repeat', `The ${limbNames[misplaced.joint]} did not match across the movement phases yet. Watch and try again.`);
  if (diagnostics.trajectoryError > options.maximumPositionError || diagnostics.angleError > options.maximumAngleError
      || diagnostics.phaseCoverage < 1) {
    return result('repeat', 'The start, middle and finish did not all match yet. Watch and try this movement again.');
  }
  return result('matched', 'Movement matched across its start, middle and finish.');
}

/** Practice defaults to easy; the existing comparator and assessment stay separate. */
export function evaluatePracticeAttempt(reference: PoseSample[], attempt: PoseSample[], overrides: Partial<ComparisonOptions> & { profile?: PracticeProfile } = {}): AttemptResult {
  const { profile = 'easy', ...options } = overrides;
  const result = evaluateAttempt(reference, attempt, { ...PRACTICE_PROFILES[profile], ...options });
  return { ...result, rulesVersion: profile === 'easy' ? PRACTICE_MATCHING_RULES_VERSION : IMITATION_RULES_VERSION };
}
