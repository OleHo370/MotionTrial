import type { Analysis, Observation, QualityEvent } from './types';

/** Prototype engineering thresholds, in milliseconds and normalized confidence.
 * Neither motion amplitude, speed nor left/right symmetry enters these rules.
 * An observation supports at most 250 ms. All remaining time is unknown.
 */
export const QUALITY_CONFIG = Object.freeze({
  ruleVersion: 'motiontrial-quality-v1',
  targetObservationsPerSecond: 10,
  visibilityThreshold: 0.6,
  maxObservationHoldMs: 250,
  samplingGapThresholdMs: 500,
  sustainedFlagMinMs: 750,
  requiredLandmarks: [11, 12, 13, 14, 15, 16] as readonly number[],
});

type EvidenceInterval = {
  type: 'no_pose' | 'low_visibility' | 'inference_error';
  startMs: number;
  endMs: number;
  affectedPoints: number[];
};

function unavailablePoints(observation: Observation): number[] {
  return QUALITY_CONFIG.requiredLandmarks.filter((index) => {
    const point = observation.landmarks.find((candidate) => candidate.index === index);
    return !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)
      || !Number.isFinite(point.z) || !Number.isFinite(point.visibility)
      || point.visibility < QUALITY_CONFIG.visibilityThreshold;
  });
}

function validateTiming(observations: Observation[], durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new RangeError('Recording duration must be finite and nonnegative.');
  }
  let previousMs = -1;
  for (const observation of observations) {
    if (!Number.isFinite(observation.tMs) || observation.tMs < 0
      || observation.tMs > durationMs || observation.tMs < previousMs) {
      throw new RangeError('Observation timestamps must be ordered and within the recording.');
    }
    previousMs = observation.tMs;
  }
}

function event(type: QualityEvent['type'], startMs: number, endMs: number,
  reason: string, affectedPoints: number[] = []): QualityEvent {
  return { type, startMs, endMs, affectedPoints, reason, ruleVersion: QUALITY_CONFIG.ruleVersion };
}

/** Deterministic, time-weighted capture/tracking evidence, never a movement score.
 * Contiguous no-pose/low-confidence support is debounced for 750 ms. An isolated
 * missing observation does not claim the entire following unobserved gap.
 * Sampling gaps are detected when raw sample/boundary separation is >=500 ms;
 * only the unsupported portion after the maximum hold is flagged.
 * Equal timestamps are permitted here: the latest sample wins at that instant.
 * API validation may enforce stricter capture input constraints.
 */
export function analyzeQuality(
  observations: Observation[], durationMs: number, interrupted: boolean,
): Analysis {
  validateTiming(observations, durationMs);
  let validMs = 0;
  const evidence: EvidenceInterval[] = [];
  const events: QualityEvent[] = [];

  for (let i = 0; i < observations.length; i += 1) {
    const observation = observations[i];
    const nextMs = observations[i + 1]?.tMs ?? durationMs;
    const endMs = Math.min(durationMs, nextMs, observation.tMs + QUALITY_CONFIG.maxObservationHoldMs);
    if (endMs <= observation.tMs) continue;
    const affectedPoints = observation.status === 'pose' ? unavailablePoints(observation) : [];
    if (observation.status === 'pose' && affectedPoints.length === 0) {
      validMs += endMs - observation.tMs;
      continue;
    }
    const type = observation.status === 'pose' ? 'low_visibility' : observation.status;
    const previous = evidence.at(-1);
    if (previous?.type === type && previous.endMs === observation.tMs) {
      previous.endMs = endMs;
      previous.affectedPoints = [...new Set([...previous.affectedPoints, ...affectedPoints])].sort((a, b) => a - b);
    } else {
      evidence.push({ type, startMs: observation.tMs, endMs, affectedPoints });
    }
  }

  for (const interval of evidence) {
    if (interval.type !== 'inference_error'
      && interval.endMs - interval.startMs < QUALITY_CONFIG.sustainedFlagMinMs) continue;
    const reason = interval.type === 'no_pose'
      ? 'Tracking unavailable: observations reported no pose for at least 750 ms. Movement is unknown during this interval.'
      : interval.type === 'low_visibility'
        ? 'One or more shoulder, elbow or wrist estimates were missing or below 0.60 confidence for at least 750 ms. Inspect the source video; this does not establish occlusion or poor movement.'
        : 'Pose inference reported an error. Tracking is unknown during this interval; inspect the source video.';
    events.push(event(interval.type, interval.startMs, interval.endMs, reason, interval.affectedPoints));
  }

  const addGap = (startMs: number, endMs: number) => {
    if (endMs > startMs) events.push(event('sampling_gap', startMs, endMs,
      'Observation/boundary spacing reached at least 500 ms. Tracking after the 250 ms maximum hold is unknown; coordinates are not interpolated.'));
  };
  if (observations.length === 0) {
    if (durationMs >= QUALITY_CONFIG.samplingGapThresholdMs) addGap(0, durationMs);
  } else {
    const firstMs = observations[0].tMs;
    if (firstMs >= QUALITY_CONFIG.samplingGapThresholdMs) addGap(0, firstMs);
    for (let i = 0; i < observations.length; i += 1) {
      const startMs = observations[i].tMs;
      const nextMs = observations[i + 1]?.tMs ?? durationMs;
      if (nextMs - startMs >= QUALITY_CONFIG.samplingGapThresholdMs) {
        addGap(Math.min(durationMs, startMs + QUALITY_CONFIG.maxObservationHoldMs), nextMs);
      }
    }
  }
  if (interrupted && durationMs > 0) {
    events.push(event('recording_interrupted', Math.max(0, durationMs - 1), durationMs,
      'Recording was interrupted or stopped before task completion. This final 1 ms marker identifies the end boundary, not a measured tracking-failure interval.'));
  }

  events.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs || a.type.localeCompare(b.type));
  validMs = Math.min(durationMs, Math.max(0, validMs));
  return {
    ruleVersion: QUALITY_CONFIG.ruleVersion,
    coverage: durationMs > 0 ? validMs / durationMs : 0,
    validMs,
    unknownMs: durationMs - validMs,
    state: validMs === 0 ? 'insufficient_tracking' : events.length ? 'review_flags' : 'no_flags',
    events,
  };
}

/** Replay only fresh estimates. Explicit missing/error observations immediately
 * clear the overlay; a sampling gap never freezes an old skeleton on screen.
 * The caller should omit individual points below the visibility threshold.
 */
export function currentObservation(observations: Observation[], tMs: number): Observation | null {
  if (!Number.isFinite(tMs) || tMs < 0) return null;
  let low = 0;
  let high = observations.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (observations[middle].tMs <= tMs) {
      found = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  const observation = observations[found];
  if (!observation || observation.status !== 'pose'
    || tMs - observation.tMs >= QUALITY_CONFIG.maxObservationHoldMs) return null;
  return observation;
}
