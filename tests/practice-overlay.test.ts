import test from 'node:test';
import assert from 'node:assert/strict';
import { mapReferenceToLiveBody } from '../lib/practice-overlay';
import type { PoseSample } from '../lib/imitation';

const reference: PoseSample = {
  tMs: 1_234, status: 'pose',
  landmarks: [
    [11, 0.4, 0.3], [12, 0.6, 0.3], [23, 0.45, 0.6], [24, 0.55, 0.6],
    [13, 0.3, 0.4], [15, 0.25, 0.2], [27, 0.4, 0.9],
  ].map(([index, x, y]) => ({ index, x, y, z: 0.05, visibility: 0.9 })),
};

test('reference overlay maps hips and torso with one uniform transform across aspect ratios', () => {
  const referenceAspectRatio = 16 / 9, liveAspectRatio = 4 / 3;
  const scale = 0.6;
  const live: PoseSample = { ...reference, tMs: 40, landmarks: reference.landmarks.map((point) => ({
    ...point, x: (point.x * referenceAspectRatio * scale + 0.1) / liveAspectRatio,
    y: point.y * scale + 0.1,
  })) };
  const result = mapReferenceToLiveBody(reference, live, { referenceAspectRatio, liveAspectRatio, liveAgeMs: 30 });
  assert.ok(result);
  assert.equal(result.tMs, reference.tMs);
  assert.deepEqual(result.landmarks.map((point) => point.index), reference.landmarks.map((point) => point.index));
  result.landmarks.forEach((point, index) => {
    assert.ok(Math.abs(point.x - live.landmarks[index].x) < 1e-10);
    assert.ok(Math.abs(point.y - live.landmarks[index].y) < 1e-10);
    assert.equal(point.visibility, reference.landmarks[index].visibility);
  });
  // A learner's mismatched wrist must not pull the reference wrist into alignment.
  const wrongWrist = { ...live, landmarks: live.landmarks.map((point) => point.index === 15 ? { ...point, x: 0.95 } : point) };
  const guide = mapReferenceToLiveBody(reference, wrongWrist, { referenceAspectRatio, liveAspectRatio })!;
  assert.deepEqual(guide, result);
});

test('reference overlay is absent without fresh trusted torso observations', () => {
  const options = { referenceAspectRatio: 1, liveAspectRatio: 1 };
  assert.equal(mapReferenceToLiveBody(reference, null, options), null);
  assert.equal(mapReferenceToLiveBody(null, reference, options), null);
  assert.equal(mapReferenceToLiveBody(reference, { ...reference, status: 'no_pose', landmarks: [] }, options), null);
  assert.equal(mapReferenceToLiveBody(reference, reference, { ...options, liveAgeMs: 501 }), null);
  assert.equal(mapReferenceToLiveBody(reference, reference, { ...options, liveAgeMs: Number.NaN }), null);
  const missingHip = { ...reference, landmarks: reference.landmarks.filter((point) => point.index !== 23) };
  assert.equal(mapReferenceToLiveBody(reference, missingHip, options), null);
  const hiddenShoulder = { ...reference, landmarks: reference.landmarks.map((point) => point.index === 11 ? { ...point, visibility: 0.1 } : point) };
  assert.equal(mapReferenceToLiveBody(reference, hiddenShoulder, options), null);
});

test('overlay preserves reference anatomy and missing limbs without fabricating zero coordinates', () => {
  const unusual: PoseSample = { ...reference, landmarks: [
    ...reference.landmarks.filter((point) => point.index !== 27),
    { index: 16, x: Number.NaN, y: 0.2, z: 0, visibility: 0.9 },
    { index: 28, x: 0.6, y: 0.9, z: 0.05, visibility: 0.1 },
  ] };
  const result = mapReferenceToLiveBody(unusual, reference, { referenceAspectRatio: 1, liveAspectRatio: 1 })!;
  assert.ok(result);
  assert.equal(result.landmarks.find((point) => point.index === 27), undefined);
  assert.equal(result.landmarks.find((point) => point.index === 16), undefined);
  assert.equal(result.landmarks.find((point) => point.index === 28)?.visibility, 0.1);
  assert.ok(result.landmarks.find((point) => point.index === 15)!.x < result.landmarks.find((point) => point.index === 12)!.x);
});
