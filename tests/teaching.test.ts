import test from 'node:test';
import assert from 'node:assert/strict';
import { PRACTICE_JOINTS, type PoseSample } from '../lib/imitation';
import { evaluateTeachingPose, parseTeachingPlaylist, TEACHING_RULES_VERSION, updateTeachingHold, type TeachingHold, type TeachingPlaylist } from '../lib/teaching';

const options = { referenceAspectRatio: 1, attemptAspectRatio: 1, focusJoints: [16] };
function sample(): PoseSample {
  const coordinates: Record<number, [number, number]> = {
    11: [0.42, 0.3], 12: [0.58, 0.3], 13: [0.35, 0.42], 14: [0.72, 0.3],
    15: [0.3, 0.55], 16: [0.82, 0.2], 23: [0.45, 0.55], 24: [0.55, 0.55],
    25: [0.44, 0.72], 26: [0.56, 0.72], 27: [0.43, 0.9], 28: [0.57, 0.9],
  };
  return { tMs: 1200, status: 'pose', landmarks: PRACTICE_JOINTS.map((index) => ({
    index, x: coordinates[index][0], y: coordinates[index][1], z: 0, visibility: 0.95,
  })) };
}

test('a learning endpoint can be held, with transparent forgiving rules', () => {
  const result = evaluateTeachingPose(sample(), sample(), options);
  assert.equal(result.status, 'close');
  assert.equal(result.positionError, 0);
  assert.equal(result.rulesVersion, TEACHING_RULES_VERSION);
  assert.ok(result.comparedJoints.includes(14));
  assert.ok(!result.comparedJoints.includes(27));
});

test('translation, scale and camera aspect are corrected before endpoint comparison', () => {
  const referenceAspectRatio = 16 / 9, attemptAspectRatio = 4 / 3;
  const attempt = sample();
  attempt.landmarks = attempt.landmarks.map((point) => ({
    ...point, x: (point.x * referenceAspectRatio * 0.6 + 0.08) / attemptAspectRatio, y: point.y * 0.6 + 0.12,
  }));
  const result = evaluateTeachingPose(sample(), attempt, { ...options, referenceAspectRatio, attemptAspectRatio });
  assert.equal(result.status, 'close');
  assert.ok((result.positionError ?? 1) < 0.000001);
});

test('approximate endpoint is sufficient but an opposite hand position needs adjustment', () => {
  const approximate = sample();
  approximate.landmarks = approximate.landmarks.map((point) => [14, 16].includes(point.index) ? { ...point, x: point.x - 0.1, y: point.y + 0.06 } : point);
  assert.equal(evaluateTeachingPose(sample(), approximate, options).status, 'close');
  const opposite = sample();
  opposite.landmarks = opposite.landmarks.map((point) => point.index === 16 ? { ...point, x: 0.6, y: 0.75 } : point);
  assert.equal(evaluateTeachingPose(sample(), opposite, options).status, 'adjust');
});

test('unrelated occlusion is tolerated while missing torso/focus-chain tracking is unknown', () => {
  const hiddenLegs = { ...sample(), landmarks: sample().landmarks.filter((point) => ![25, 26, 27, 28].includes(point.index)) };
  assert.equal(evaluateTeachingPose(sample(), hiddenLegs, options).status, 'close');
  for (const joint of [11, 12, 23, 24, 14, 16]) {
    const missing = { ...sample(), landmarks: sample().landmarks.filter((point) => point.index !== joint) };
    assert.equal(evaluateTeachingPose(sample(), missing, options).status, 'unknown');
    assert.equal(evaluateTeachingPose(missing, sample(), options).status, 'unknown');
  }
  for (const joint of [14, 16]) {
    const low = { ...sample(), landmarks: sample().landmarks.map((point) => point.index === joint ? { ...point, visibility: 0.1 } : point) };
    assert.equal(evaluateTeachingPose(sample(), low, options).status, 'unknown');
  }
});

test('missing, stale, malformed, off-screen and duplicate observations never count as close', () => {
  const target = sample();
  assert.equal(evaluateTeachingPose(undefined, sample(), options).status, 'unknown');
  assert.equal(evaluateTeachingPose(target, null, options).status, 'unknown');
  const invalid: PoseSample[] = [
    { tMs: 2000, status: 'no_pose', landmarks: [] },
    { tMs: 2000, status: 'inference_error', landmarks: [] },
    { ...sample(), tMs: NaN },
    { ...sample(), landmarks: sample().landmarks.map((point) => point.index === 16 ? { ...point, x: -0.1 } : point) },
    { ...sample(), landmarks: [...sample().landmarks, sample().landmarks[0]] },
  ];
  for (const attempt of invalid) assert.equal(evaluateTeachingPose(target, attempt, options).status, 'unknown');
  for (const liveAgeMs of [251, NaN, -1]) assert.equal(evaluateTeachingPose(target, sample(), { ...options, liveAgeMs, maximumLiveAgeMs: 250 }).status, 'unknown');
  for (const focusJoints of [[], [16, 16], [11], [999]]) assert.equal(evaluateTeachingPose(target, sample(), { ...options, focusJoints }).status, 'unknown');
});

test('two focused hands are each checked instead of hiding an omitted one in a body average', () => {
  const target = sample(), attempt = sample();
  target.landmarks = target.landmarks.map((point) => point.index === 15 ? { ...point, x: 0.18, y: 0.2 } : point);
  const result = evaluateTeachingPose(target, attempt, { ...options, focusJoints: [15, 16] });
  assert.equal(result.status, 'adjust');
  assert.ok((result.focusErrors.find((point) => point.joint === 15)?.error ?? 0) > 1.05);
});

test('hold progresses only through uninterrupted fresh close observations', () => {
  let hold: TeachingHold | null = null;
  for (const now of [0, 100, 200, 300, 400, 500, 600]) hold = updateTeachingHold(hold, { status: 'close' }, now, { targetKey: 'step-1' });
  assert.equal(hold!.heldMs, 600);
  assert.equal(hold!.ready, false);
  hold = updateTeachingHold(hold, { status: 'close' }, 700, { targetKey: 'step-1' });
  assert.equal(hold.ready, true);
  hold = updateTeachingHold(hold, { status: 'unknown' }, 800, { targetKey: 'step-1' });
  assert.equal(hold.heldMs, 0);
  hold = updateTeachingHold(hold, { status: 'close' }, 900, { targetKey: 'step-1' });
  assert.equal(hold.heldMs, 0);
  hold = updateTeachingHold(hold, { status: 'close' }, 1000, { targetKey: 'step-1' });
  assert.equal(hold.heldMs, 100);
  hold = updateTeachingHold(hold, { status: 'adjust' }, 1100, { targetKey: 'step-1' });
  assert.equal(hold.heldMs, 0);
});

test('long gaps, target changes, replay resets and inactive watching cannot inherit hold', () => {
  const first = updateTeachingHold(null, { status: 'close' }, 0, { targetKey: 'a' });
  const part = updateTeachingHold(first, { status: 'close' }, 400, { targetKey: 'a' });
  const cases = [
    updateTeachingHold(part, { status: 'close' }, 900, { targetKey: 'a' }),
    updateTeachingHold(part, { status: 'close' }, 500, { targetKey: 'b' }),
    updateTeachingHold(part, { status: 'close' }, 500, { targetKey: 'a', reset: true }),
    updateTeachingHold(part, { status: 'close' }, 500, { targetKey: 'a', enabled: false }),
    updateTeachingHold(part, { status: 'close' }, 500, { targetKey: 'a', observationTimestampMs: 10 }),
    updateTeachingHold(part, { status: 'close' }, 300, { targetKey: 'a' }),
  ];
  for (const hold of cases) { assert.equal(hold.heldMs, 0); assert.equal(hold.ready, false); }
});

test('redrawing an old inference never creates additional hold evidence', () => {
  const first = updateTeachingHold(null, { status: 'close' }, 100, { targetKey: 'a', observationTimestampMs: 100 });
  const repeated = updateTeachingHold(first, { status: 'close' }, 300, { targetKey: 'a', observationTimestampMs: 100 });
  assert.equal(repeated.heldMs, 0);
  const stale = updateTeachingHold(repeated, { status: 'close' }, 600, { targetKey: 'a', observationTimestampMs: 100 });
  assert.equal(stale.ready, false);
  assert.equal(stale.closeSinceMs, null);
});

function playlist(): TeachingPlaylist {
  return { schemaVersion: 'teaching-steps-v1', id: 'teaching', title: 'Small steps', source: '24.mp4', referencePlaylistSrc: '/practice-media/24-playlist.json', steps: [
    { id: 'a-1', parentFormId: 'a', parentFormOrder: 1, stepOrder: 1, title: 'Prepare', cue: 'Take your time.', startSeconds: 0, endSeconds: 2, sourceStartSeconds: 5, sourceEndSeconds: 7, focusJoints: [27] },
    { id: 'a-2', parentFormId: 'a', parentFormOrder: 1, stepOrder: 2, title: 'Step', cue: 'Place the foot.', startSeconds: 2, endSeconds: 5, sourceStartSeconds: 7, sourceEndSeconds: 10, focusJoints: [27] },
    { id: 'b-1', parentFormId: 'b', parentFormOrder: 2, stepOrder: 1, title: 'Prepare hands', cue: 'Lift the hands.', startSeconds: 0, endSeconds: 3, sourceStartSeconds: 10, sourceEndSeconds: 13, focusJoints: [15, 16] },
  ] };
}

test('teaching manifest retains auditable local/source times and allows a shorter fixture', () => {
  assert.equal(parseTeachingPlaylist(playlist()).steps.length, 3);
  const explicitTarget = playlist();
  explicitTarget.steps[0].targetSeconds = 1.8;
  explicitTarget.steps[0].targetSourceSeconds = 6.8;
  assert.equal(parseTeachingPlaylist(explicitTarget).steps[0].targetSeconds, 1.8);
});

test('invalid teaching timelines, focus and noncontiguous groups are rejected', () => {
  for (const mutate of [
    (data: TeachingPlaylist) => { data.steps[1].id = 'a-1'; },
    (data: TeachingPlaylist) => { data.steps[1].startSeconds = 1; },
    (data: TeachingPlaylist) => { data.steps[1].sourceEndSeconds = 100; },
    (data: TeachingPlaylist) => { data.steps[1].stepOrder = 3; },
    (data: TeachingPlaylist) => { data.steps[2].parentFormOrder = 3; },
    (data: TeachingPlaylist) => { data.steps[2].focusJoints = []; },
    (data: TeachingPlaylist) => { data.steps[2].parentFormId = 'a'; },
    (data: TeachingPlaylist) => { data.steps[0].targetSeconds = 20; },
    (data: TeachingPlaylist) => { data.steps[0].targetSourceSeconds = 20; },
    (data: TeachingPlaylist) => { data.steps[0].targetSeconds = 0.2; data.steps[0].targetSourceSeconds = 6.8; },
    (data: TeachingPlaylist) => { data.referencePlaylistSrc = '/practice-media/../private.json'; },
  ]) {
    const data = playlist(); mutate(data);
    assert.throws(() => parseTeachingPlaylist(data));
  }
});
