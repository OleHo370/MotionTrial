import type { PoseSample, PracticeLandmark } from './imitation';

export interface PracticeOverlayOptions {
  referenceAspectRatio: number;
  liveAspectRatio: number;
  visibilityThreshold?: number;
  /** Age of the last real camera observation, measured by the caller's clock. */
  liveAgeMs?: number;
  maximumLiveAgeMs?: number;
}

interface BodyAnchor { x: number; y: number; torso: number }

function anchor(sample: PoseSample, aspect: number, threshold: number): BodyAnchor | null {
  if (sample.status !== 'pose' || !Number.isFinite(aspect) || aspect <= 0) return null;
  const points = new Map(sample.landmarks.map((point) => [point.index, point]));
  const torso = [11, 12, 23, 24].map((index) => points.get(index));
  if (torso.some((point) => !point || ![point.x, point.y, point.visibility].every(Number.isFinite)
      || point.visibility < threshold || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)) return null;
  const [leftShoulder, rightShoulder, leftHip, rightHip] = torso as PracticeLandmark[];
  const x = (leftHip.x + rightHip.x) / 2 * aspect, y = (leftHip.y + rightHip.y) / 2;
  const shoulderX = (leftShoulder.x + rightShoulder.x) / 2 * aspect;
  const shoulderY = (leftShoulder.y + rightShoulder.y) / 2;
  const length = Math.hypot(shoulderX - x, shoulderY - y);
  return length >= 0.025 ? { x, y, torso: length } : null;
}

/**
 * Put the reference's actual phase on the learner's hip position and torso scale.
 * One uniform transform preserves topology and all relative body proportions.
 * This produces a visual guide, not a camera observation or matching evidence.
 * It preserves anatomical labels; apply any display mirror to the whole canvas.
 */
export function mapReferenceToLiveBody(
  reference: PoseSample | null | undefined,
  live: PoseSample | null | undefined,
  options: PracticeOverlayOptions,
): PoseSample | null {
  if (!reference || !live || reference.status !== 'pose' || live.status !== 'pose') return null;
  const age = options.liveAgeMs ?? 0, maximumAge = options.maximumLiveAgeMs ?? 500;
  if (!Number.isFinite(age) || age < 0 || !Number.isFinite(maximumAge) || maximumAge < 0 || age > maximumAge) return null;
  const threshold = options.visibilityThreshold ?? 0.45;
  const source = anchor(reference, options.referenceAspectRatio, threshold);
  const target = anchor(live, options.liveAspectRatio, threshold);
  if (!source || !target) return null;
  const scale = target.torso / source.torso;
  const landmarks = reference.landmarks.flatMap((point) => {
    // Missing/nonfinite points stay missing; low confidence remains explicitly low.
    if (![point.x, point.y, point.z, point.visibility].every(Number.isFinite)) return [];
    return [{ ...point,
      x: (target.x + (point.x * options.referenceAspectRatio - source.x) * scale) / options.liveAspectRatio,
      y: target.y + (point.y - source.y) * scale,
      z: point.z * options.referenceAspectRatio * scale / options.liveAspectRatio,
    }];
  });
  return { tMs: reference.tMs, status: 'pose', landmarks };
}
