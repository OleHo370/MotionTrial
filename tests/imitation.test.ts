import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAttempt, evaluatePracticeAttempt, PRACTICE_JOINTS, PRACTICE_MATCHING_RULES_VERSION, IMITATION_RULES_VERSION, type PoseSample } from '../lib/imitation';

const duration = 3000;
function sample(tMs: number, progress = tMs / duration): PoseSample {
  const coordinates: Record<number, [number, number]> = {
    11: [0.42, 0.3], 12: [0.58, 0.3], 13: [0.35, 0.42],
    14: [0.63 + progress * 0.1, 0.43 - progress * 0.18],
    15: [0.3, 0.55], 16: [0.68 + progress * 0.14, 0.6 - progress * 0.48],
    23: [0.45, 0.55], 24: [0.55, 0.55], 25: [0.44, 0.72],
    26: [0.56, 0.72], 27: [0.43, 0.9], 28: [0.57, 0.9],
  };
  return { tMs, status: 'pose', landmarks: PRACTICE_JOINTS.map((index) => ({
    index, x: coordinates[index][0], y: coordinates[index][1], z: 0, visibility: 0.95,
  })) };
}
const sequence = (transform: (progress: number) => number = (p) => p): PoseSample[] =>
  Array.from({ length: 31 }, (_, index) => sample(index * 100, transform(index / 30)));
const reference = sequence();

test('a full copied trajectory matches with transparent diagnostics', () => {
  const result = evaluateAttempt(reference, sequence());
  assert.equal(result.status, 'matched');
  assert.equal(result.diagnostics.referenceCoverage, 1);
  assert.equal(result.diagnostics.attemptCoverage, 1);
  assert.equal(result.diagnostics.trajectoryError, 0);
  assert.equal(result.diagnostics.phaseCoverage, 1);
});

test('standing at one matching pose cannot pass a movement', () => {
  const result = evaluateAttempt(reference, sequence(() => 0.5));
  assert.equal(result.status, 'repeat');
  assert.equal(result.diagnostics.attemptExcursion, 0);
});

test('missing, stale, off-screen or low-confidence full-body tracking is unknown', () => {
  for (const incomplete of [
    reference.map((item, index) => index >= 8 && index <= 22 ? { ...item, status: 'no_pose' as const, landmarks: [] } : item),
    reference.filter((_, index) => index < 5 || index > 24),
    reference.map((item) => ({ ...item, landmarks: item.landmarks.map((point) => point.index === 27 ? { ...point, visibility: 0.1 } : point) })),
    reference.map((item) => ({ ...item, landmarks: item.landmarks.map((point) => point.index === 15 ? { ...point, x: -0.1 } : point) })),
  ]) {
    assert.equal(evaluateAttempt(reference, incomplete).status, 'unknown');
  }
});

test('an explicit no-pose replaces a same-time pose and cannot reuse old landmarks', () => {
  const missing = [...reference, ...reference.filter((point) => point.tMs <= 2000)
    .map((point): PoseSample => ({ tMs: point.tMs, status: 'no_pose', landmarks: [] }))];
  assert.equal(evaluateAttempt(reference, missing).status, 'unknown');
});

test('incomplete reference and static reference cannot authorize advancement', () => {
  assert.equal(evaluateAttempt(reference.slice(15), reference).status, 'unknown');
  assert.equal(evaluateAttempt(sequence(() => 0), reference).status, 'unknown');
});

test('translation, body scale and differing camera aspect do not create mismatch', () => {
  const referenceAspectRatio = 16 / 9, attemptAspectRatio = 4 / 3;
  const transformed = reference.map((item) => ({ ...item, landmarks: item.landmarks.map((point) => ({
    ...point, x: (point.x * referenceAspectRatio * 0.6 + 0.08) / attemptAspectRatio,
    y: point.y * 0.6 + 0.12,
  })) }));
  const result = evaluateAttempt(reference, transformed, { referenceAspectRatio, attemptAspectRatio });
  assert.equal(result.status, 'matched');
  assert.ok((result.diagnostics.trajectoryError ?? 1) < 0.000001);
});

test('anatomical side is fixed; a mirrored display does not swap matching labels', () => {
  const otherSide = reference.map((item) => ({ ...item, landmarks: item.landmarks.map((point) => ({
    ...point, index: point.index % 2 ? point.index + 1 : point.index - 1, x: 1 - point.x,
  })) }));
  assert.equal(evaluateAttempt(reference, otherSide).status, 'repeat');
});

test('reversed temporal order cannot pass by matching an unordered set of poses', () => {
  const result = evaluateAttempt(reference, sequence((p) => 1 - p));
  assert.equal(result.status, 'repeat');
});

test('moderate pace changes can align monotonically without erasing complete phases', () => {
  const result = evaluateAttempt(reference, sequence((p) => p ** 1.35));
  assert.equal(result.status, 'matched');
});

test('one matching pose and then a late start is incomplete evidence, not a match', () => {
  const late = sequence().filter((item) => item.tMs > 1000);
  late.unshift(sample(0, 0));
  assert.equal(evaluateAttempt(reference, late).status, 'unknown');
});

function bothArmsSequence(range = 1): PoseSample[] {
  return sequence().map((frame) => {
    const progress = frame.tMs / duration;
    return { ...frame, landmarks: frame.landmarks.map((point) => {
      if (point.index === 13 || point.index === 14) return { ...point,
        x: point.index === 13 ? 0.37 - progress * 0.1 * range : 0.63 + progress * 0.1 * range,
        y: 0.43 - progress * 0.12 * range };
      if (point.index === 15 || point.index === 16) return { ...point,
        x: point.index === 15 ? 0.32 - progress * 0.1 * range : 0.68 + progress * 0.1 * range,
        y: 0.6 - progress * 0.32 * range };
      return point;
    }) };
  });
}

test('a copied bilateral action passes without requiring the static legs to move', () => {
  const bilateral = bothArmsSequence();
  const result = evaluateAttempt(bilateral, bilateral);
  assert.equal(result.status, 'matched');
  assert.deepEqual(result.diagnostics.activeLimbs.map((limb) => limb.joint), [15, 16]);
});

test('one moving arm cannot hide the omitted other arm inside the whole-body average', () => {
  const bilateral = bothArmsSequence();
  for (const omittedJoints of [[13, 15], [14, 16]]) {
    const oneArm = bilateral.map((frame) => ({ ...frame, landmarks: frame.landmarks.map((point) =>
      omittedJoints.includes(point.index) ? { ...bilateral[0].landmarks.find((start) => start.index === point.index)! } : point) }));
    const result = evaluateAttempt(bilateral, oneArm);
    assert.equal(result.status, 'repeat');
    assert.match(result.reason, /arm movement was not observed/);
  }
});

test('each active arm needs phase evidence, not just a sufficiently large excursion', () => {
  const bilateral = bothArmsSequence();
  const wrongPhase = bilateral.map((frame, index) => ({ ...frame, landmarks: frame.landmarks.map((point) =>
    [13, 15].includes(point.index) ? { ...bilateral[bilateral.length - index - 1].landmarks.find((other) => other.index === point.index)! } : point) }));
  const result = evaluateAttempt(bilateral, wrongPhase);
  assert.equal(result.status, 'repeat');
  assert.match(result.reason, /left arm did not match/);
});

test('smaller coherent bilateral movement can match and is never labelled bad capture quality', () => {
  const smaller = bothArmsSequence(0.35);
  const result = evaluateAttempt(smaller, smaller);
  assert.equal(result.status, 'matched');
  assert.equal(result.diagnostics.attemptCoverage, 1);
  assert.deepEqual(result.diagnostics.activeLimbs.map((limb) => limb.joint), [15, 16]);
  const belowResolution = bothArmsSequence(0.03);
  const unknown = evaluateAttempt(belowResolution, belowResolution);
  assert.equal(unknown.status, 'unknown');
  assert.equal(unknown.diagnostics.attemptCoverage, 1);
  assert.match(unknown.reason, /too little visible change/);
});

test('one endpoint noise spike does not require a static leg to move', () => {
  const bilateral = bothArmsSequence();
  const noisyReference = bilateral.map((frame, index) => ({ ...frame, landmarks: frame.landmarks.map((point) =>
    index === 15 && point.index === 27 ? { ...point, x: point.x + 0.15 } : point) }));
  const result = evaluateAttempt(noisyReference, bilateral);
  assert.equal(result.status, 'matched');
  assert.deepEqual(result.diagnostics.activeLimbs.map((limb) => limb.joint), [15, 16]);
});

function footSequence(transform: (progress: number) => number = (p) => p): PoseSample[] {
  return sequence(() => 0).map((frame) => {
    const progress = transform(frame.tMs / duration);
    return { ...frame, landmarks: frame.landmarks.map((point) => point.index === 27
      ? { ...point, x: 0.43 + progress * 0.055, y: 0.9 - progress * 0.03 }
      : point.index === 25 ? { ...point, x: 0.44 + progress * 0.015, y: 0.72 - progress * 0.015 } : point) };
  });
}

test('an audited foot focus compares a real limb change diluted by eleven mostly static joints', () => {
  const foot = footSequence();
  assert.equal(evaluateAttempt(foot, foot).status, 'unknown'); // Preserves legacy whole-body observability gate.
  const result = evaluateAttempt(foot, foot, { focusJoints: [27] });
  assert.equal(result.status, 'matched');
  assert.ok(result.diagnostics.referenceExcursion < 0.15);
  assert.deepEqual(result.diagnostics.activeLimbs.map((limb) => limb.joint), [27]);
  assert.ok((result.diagnostics.activeLimbs[0].directionRatio ?? 0) > 0.99);
});

test('focused small movements reject held, reversed and wrong-side attempts', () => {
  const foot = footSequence();
  for (const candidate of [footSequence(() => 0), footSequence((p) => 1 - p),
    foot.map((frame) => ({ ...frame, landmarks: frame.landmarks.map((point) => {
      const stationary = sample(0, 0).landmarks.find((other) => other.index === point.index)!;
      if ([25, 27].includes(point.index)) return { ...stationary };
      if (point.index === 28) return { ...point, x: 0.57 - frame.tMs / duration * 0.055, y: 0.9 - frame.tMs / duration * 0.03 };
      return point;
    }) }))]) assert.equal(evaluateAttempt(foot, candidate, { focusJoints: [27] }).status, 'repeat');
  assert.match(evaluateAttempt(foot, footSequence((p) => 1 - p), { focusJoints: [27] }).reason, /reference direction/);
});

test('declared focus requires coherent phase change, not model noise or an unrelated moving arm', () => {
  assert.equal(evaluateAttempt(reference, reference, { focusJoints: [27] }).status, 'unknown');
  const noisy = footSequence(() => 0).map((frame, index) => ({ ...frame,
    landmarks: frame.landmarks.map((point) => point.index === 27 ? { ...point, x: 0.43 + Math.sin(index * Math.PI / 2) * 0.08 } : point),
  }));
  const result = evaluateAttempt(noisy, noisy, { focusJoints: [27] });
  assert.equal(result.status, 'unknown');
  assert.equal(result.diagnostics.referenceCoverage, 1);
  assert.match(result.reason, /coherent visible change/);
});

test('declared bilateral arm focus retains each arm requirement and excludes leg noise', () => {
  const bilateral = bothArmsSequence();
  const focused = evaluateAttempt(bilateral, bilateral, { focusJoints: [15, 16] });
  assert.equal(focused.status, 'matched');
  assert.deepEqual(focused.diagnostics.activeLimbs.map((limb) => limb.joint), [15, 16]);
  const omitted = bilateral.map((frame) => ({ ...frame, landmarks: frame.landmarks.map((point) =>
    [13, 15].includes(point.index) ? { ...bilateral[0].landmarks.find((other) => other.index === point.index)! } : point) }));
  assert.equal(evaluateAttempt(bilateral, omitted, { focusJoints: [15, 16] }).status, 'repeat');
});

test('missing focused tracking remains unknown and invalid focus is never silently ignored', () => {
  const foot = footSequence();
  const missing = foot.map((frame): PoseSample => ({ ...frame, status: 'no_pose', landmarks: [] }));
  assert.equal(evaluateAttempt(foot, missing, { focusJoints: [27] }).status, 'unknown');
  for (const focusJoints of [[], [27, 27], [11], [999]]) {
    const result = evaluateAttempt(foot, foot, { focusJoints });
    assert.equal(result.status, 'unknown');
    assert.match(result.reason, /focus is invalid/);
  }
});

test('easy practice accepts an approximate movement and standard remains available', () => {
  const approximate = sequence((p) => 0.1 + p * 0.42);
  const easy = evaluatePracticeAttempt(reference, approximate, { focusJoints: [16] });
  assert.equal(easy.status, 'matched');
  assert.equal(easy.rulesVersion, PRACTICE_MATCHING_RULES_VERSION);
  const standard = evaluatePracticeAttempt(reference, approximate, { profile: 'standard', focusJoints: [16] });
  assert.equal(standard.status, 'repeat');
  assert.equal(standard.rulesVersion, IMITATION_RULES_VERSION);
});

test('easy practice still rejects held, reversed and omitted active limb movement', () => {
  for (const candidate of [sequence(() => 0.5), sequence((p) => 1 - p)]) {
    assert.equal(evaluatePracticeAttempt(reference, candidate).status, 'repeat');
    assert.equal(evaluatePracticeAttempt(reference, candidate, { focusJoints: [16] }).status, 'repeat');
  }
  const bilateral = bothArmsSequence();
  const omitted = bilateral.map((frame) => ({ ...frame, landmarks: frame.landmarks.map((point) =>
    [13, 15].includes(point.index) ? { ...bilateral[0].landmarks.find((other) => other.index === point.index)! } : point) }));
  assert.equal(evaluatePracticeAttempt(bilateral, omitted, { focusJoints: [15, 16] }).status, 'repeat');
});

test('audited practice focus tolerates unrelated occlusion but requires real focused evidence', () => {
  const hide = (joints: number[]) => reference.map((frame) => ({ ...frame,
    landmarks: frame.landmarks.filter((point) => !joints.includes(point.index)),
  }));
  const hiddenLegs = hide([25, 26, 27, 28]);
  assert.equal(evaluatePracticeAttempt(hiddenLegs, hiddenLegs, { focusJoints: [16] }).status, 'matched');
  assert.equal(evaluatePracticeAttempt(reference, hiddenLegs, { focusJoints: [16] }).status, 'matched');
  assert.equal(evaluatePracticeAttempt(reference, hiddenLegs).status, 'unknown');
  assert.equal(evaluatePracticeAttempt(reference, hide([14]), { focusJoints: [16] }).status, 'unknown');
  assert.equal(evaluatePracticeAttempt(reference, hide([23]), { focusJoints: [16] }).status, 'unknown');
  assert.equal(evaluatePracticeAttempt(reference, hiddenLegs, { profile: 'standard', focusJoints: [16] }).status, 'unknown');
});

test('easy practice cannot fill missing phases or tracking gaps', () => {
  const noStart = reference.filter((frame) => frame.tMs >= 900);
  assert.equal(evaluatePracticeAttempt(reference, noStart).status, 'unknown');
  const dropout = reference.map((frame): PoseSample => frame.tMs >= 700 && frame.tMs <= 2200
    ? { tMs: frame.tMs, status: 'no_pose', landmarks: [] } : frame);
  assert.equal(evaluatePracticeAttempt(reference, dropout).status, 'unknown');
});

test('a long action compares bounded real observations without hiding a long dropout', () => {
  const durationMs = 60_000;
  const long = Array.from({ length: 6_001 }, (_, index) => {
    const tMs = index * 10;
    return { ...sample(tMs, tMs / durationMs), tMs };
  });
  const result = evaluatePracticeAttempt(long, long, { referenceDurationMs: durationMs, attemptDurationMs: durationMs });
  assert.equal(result.status, 'matched');
  assert.equal(result.diagnostics.referenceCoverage, 1);
  const sparse = long.filter((frame) => frame.tMs < 10_000 || frame.tMs > 45_000);
  const missing = evaluatePracticeAttempt(long, sparse, { referenceDurationMs: durationMs, attemptDurationMs: durationMs });
  assert.equal(missing.status, 'unknown');
  assert.ok(missing.diagnostics.attemptCoverage < 0.5);
});

function circularSequence(range = 1, reverse = false): PoseSample[] {
  return Array.from({ length: 121 }, (_, index) => {
    const progress = index / 120;
    const radians = (reverse ? -1 : 1) * progress * Math.PI * 16;
    const frame = sample(index * 100, 0);
    return { ...frame, landmarks: frame.landmarks.map((point) => point.index === 16 ? {
      ...point, x: 0.68 + Math.cos(radians) * 0.12 * range, y: 0.5 + Math.sin(radians) * 0.12 * range,
    } : point) };
  });
}

test('easy practice observes repeated circular trajectories whose three phase means coincide', () => {
  const circles = circularSequence();
  assert.equal(evaluateAttempt(circles, circles, { focusJoints: [16] }).status, 'unknown');
  const result = evaluatePracticeAttempt(circles, circles, { focusJoints: [16] });
  assert.equal(result.status, 'matched');
  assert.ok((result.diagnostics.activeLimbs[0].directionRatio ?? 0) > 0.99);
  assert.equal(evaluatePracticeAttempt(circles, circularSequence(0.6), { focusJoints: [16] }).status, 'matched');
  assert.equal(evaluatePracticeAttempt(circles, circularSequence(1, true), { focusJoints: [16] }).status, 'repeat');
  const held = circles.map((frame) => ({ ...frame, landmarks: circles[0].landmarks }));
  assert.equal(evaluatePracticeAttempt(circles, held, { focusJoints: [16] }).status, 'repeat');
});

test('easy practice retains genuine motion between the three broad phase windows', () => {
  const excursions = Array.from({ length: 121 }, (_, index) => {
    const progress = index / 120;
    const burst = (start: number, end: number) => progress >= start && progress <= end
      ? Math.sin((progress - start) / (end - start) * Math.PI) : 0;
    const frame = sample(index * 100, 0);
    return { ...frame, landmarks: frame.landmarks.map((point) => point.index === 16
      ? { ...point, x: 0.68 + (burst(0.26, 0.37) + burst(0.63, 0.74)) * 0.16 } : point) };
  });
  assert.equal(evaluateAttempt(excursions, excursions, { focusJoints: [16] }).status, 'unknown');
  assert.equal(evaluatePracticeAttempt(excursions, excursions, { focusJoints: [16] }).status, 'matched');
  const held = excursions.map((frame) => ({ ...frame, landmarks: excursions[0].landmarks }));
  assert.equal(evaluatePracticeAttempt(excursions, held, { focusJoints: [16] }).status, 'repeat');
});
