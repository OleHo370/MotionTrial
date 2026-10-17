import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeQuality, currentObservation } from '../lib/quality';
import type { Observation } from '../lib/types';

function pose(tMs: number, scale = 1, visibility = 0.95): Observation {
  return {
    tMs, status: 'pose',
    landmarks: [11, 12, 13, 14, 15, 16].map((index) => ({
      index, x: 0.5 + Math.sin(tMs / 1000 + index) * scale * 0.1,
      y: 0.5 + Math.cos(tMs / 700 + index) * scale * 0.1,
      z: 0, visibility,
    })),
  };
}

function series(startMs: number, endMs: number, status: Observation['status']): Observation[] {
  return Array.from({ length: (endMs - startMs) / 100 }, (_, index) => ({
    tMs: startMs + index * 100, status, landmarks: [],
  }));
}

test('coverage is time weighted: a 4-second sample gap is mostly unknown', () => {
  const observations = [0, 100, 200, 300, 400, 4400, 4500].map((t) => pose(t));
  const result = analyzeQuality(observations, 4600, false);
  assert.equal(result.validMs, 850);
  assert.equal(result.unknownMs, 3750);
  assert.equal(result.coverage, 850 / 4600);
  assert.deepEqual(result.events.map(({ type, startMs, endMs }) => ({ type, startMs, endMs })),
    [{ type: 'sampling_gap', startMs: 650, endMs: 4400 }]);
});

test('explicit no-pose and errors end prior valid support immediately', () => {
  const noPose: Observation = { tMs: 50, status: 'no_pose', landmarks: [] };
  const error: Observation = { tMs: 350, status: 'inference_error', landmarks: [] };
  const result = analyzeQuality([pose(0), noPose, pose(300), error], 500, false);
  assert.equal(result.validMs, 100);
  assert.equal(result.unknownMs, 400);
  assert.equal(result.events[0].type, 'inference_error');
  assert.equal(currentObservation([pose(0), noPose], 50), null);
  assert.equal(currentObservation([pose(300), error], 350), null);
});

test('sustained missing and low-visibility runs flag correct intervals; transient does not', () => {
  const observations = [
    pose(0), ...series(100, 1000, 'no_pose'), pose(1000),
    ...Array.from({ length: 9 }, (_, index) => pose(1100 + index * 100, 1, 0.3)),
    pose(2000), { tMs: 2100, status: 'no_pose', landmarks: [] } as Observation, pose(2200),
  ];
  const result = analyzeQuality(observations, 2300, false);
  assert.deepEqual(result.events.map(({ type, startMs, endMs }) => ({ type, startMs, endMs })), [
    { type: 'no_pose', startMs: 100, endMs: 1000 },
    { type: 'low_visibility', startMs: 1100, endMs: 2000 },
  ]);
  assert.deepEqual(result.events[1].affectedPoints, [11, 12, 13, 14, 15, 16]);
});

test('isolated no-pose does not fabricate a sustained no-pose interval across a gap', () => {
  const result = analyzeQuality([{ tMs: 0, status: 'no_pose', landmarks: [] }, pose(4000)], 4100, false);
  assert.deepEqual(result.events.map(({ type, startMs, endMs }) => ({ type, startMs, endMs })),
    [{ type: 'sampling_gap', startMs: 250, endMs: 4000 }]);
  assert.equal(result.validMs, 100);
});

test('small, slow and asymmetric movement cannot change quality classification', () => {
  const large = Array.from({ length: 20 }, (_, index) => pose(index * 100, 1));
  const small = large.map((observation) => ({ ...observation,
    landmarks: observation.landmarks.map((point) => ({ ...point,
      x: 0.5 + (point.x - 0.5) * (point.index % 2 ? 0.002 : 0.01),
      y: 0.5,
    })),
  }));
  assert.deepEqual(analyzeQuality(small, 2000, false), analyzeQuality(large, 2000, false));
  assert.equal(analyzeQuality(small, 2000, false).state, 'no_flags');
});

test('coverage clips to the end, handles duplicate timestamps and has no double counting', () => {
  const result = analyzeQuality([pose(0), pose(0), pose(100), pose(190)], 200, false);
  assert.equal(result.validMs, 200);
  assert.equal(result.coverage, 1);
  assert.equal(result.unknownMs, 0);
  const interrupted = analyzeQuality([pose(0)], 100, true);
  assert.deepEqual(interrupted.events.map(({ startMs, endMs }) => [startMs, endMs]), [[99, 100]]);
});

test('missing data is explicitly insufficient and boundary gaps remain within the video', () => {
  const empty = analyzeQuality([], 4000, false);
  assert.equal(empty.state, 'insufficient_tracking');
  assert.equal(empty.coverage, 0);
  assert.equal(empty.unknownMs, 4000);
  assert.deepEqual(empty.events.map(({ startMs, endMs }) => [startMs, endMs]), [[0, 4000]]);
  const delayed = analyzeQuality([pose(1000)], 2000, false);
  assert.deepEqual(delayed.events.map(({ startMs, endMs }) => [startMs, endMs]), [[0, 1000], [1250, 2000]]);
  assert.deepEqual(analyzeQuality([], 0, true), {
    ruleVersion: empty.ruleVersion, validMs: 0, unknownMs: 0, coverage: 0,
    state: 'insufficient_tracking', events: [],
  });
});

test('overlay clears on stale, missing or error estimates and never uses a future sample', () => {
  const observations = [pose(100), { tMs: 500, status: 'no_pose', landmarks: [] } as Observation,
    pose(600), { tMs: 650, status: 'inference_error', landmarks: [] } as Observation];
  assert.equal(currentObservation(observations, 99), null);
  assert.equal(currentObservation(observations, 100), observations[0]);
  assert.equal(currentObservation(observations, 349), observations[0]);
  assert.equal(currentObservation(observations, 350), null);
  assert.equal(currentObservation(observations, 500), null);
  assert.equal(currentObservation(observations, 600), observations[2]);
  assert.equal(currentObservation(observations, 650), null);
  assert.equal(currentObservation(observations, Number.NaN), null);
});

test('invalid timing fails clearly and non-finite landmarks never create valid support', () => {
  assert.throws(() => analyzeQuality([pose(100), pose(50)], 200, false), /timestamps/);
  assert.throws(() => analyzeQuality([pose(201)], 200, false), /timestamps/);
  assert.throws(() => analyzeQuality([], Number.NaN, false), /duration/);
  const observation = pose(0);
  observation.landmarks[0].x = Number.NaN;
  const result = analyzeQuality([observation], 200, false);
  assert.equal(result.validMs, 0);
  assert.equal(result.state, 'insufficient_tracking');
  assert.ok(Number.isFinite(result.coverage));
});
