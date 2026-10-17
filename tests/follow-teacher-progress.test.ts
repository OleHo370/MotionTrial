import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createFollowSession, evaluateFollowObservation, prepareStepReference, summarizeFollowProgress,
  FOLLOW_PROGRESS_RULES_VERSION, updateTeachingHold,
  type FollowReference, type FollowResult, type FollowSession,
} from '../lib/follow-teacher';
import type { PoseSample } from '../lib/imitation';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/practice-media/dual-view/manifest.json'), 'utf8'));
const form = manifest.forms[0];
const data = JSON.parse(fs.readFileSync(path.join(root, 'public', form.front.poseSrc), 'utf8'));
const step = form.steps[1];
const reference = prepareStepReference(form, step, data);
const trace = data.samples.filter((sample: any) => sample.sourceTimeSeconds >= step.front.startSeconds
  && sample.sourceTimeSeconds < step.front.endSeconds) as PoseSample[];

function observe(samples = trace) {
  const session = createFollowSession(reference);
  let result: FollowResult | undefined;
  for (const sample of samples) result = evaluateFollowObservation(reference, sample, {
    attemptAspectRatio: 16 / 9, session, liveAgeMs: 0,
  });
  return { session, result: result! };
}

test('recorded original front source has auditable 20/40/40 checkpoint progress on a matched left-foot step', () => {
  const { session, result } = observe();
  assert.equal(result.status, 'match');
  const summary = summarizeFollowProgress(reference, result, session);
  assert.equal(summary.percent, 100);
  assert.equal(summary.rulesVersion, FOLLOW_PROGRESS_RULES_VERSION);
  assert.deepEqual(summary.components.map((item) => [item.id, item.weight]), [
    ['start', 0.2], ['motion-27', 0.4], ['target', 0.4],
  ]);
  assert.ok(summary.components.every((item) => item.complete && item.progress === 1));
});

test('labelled stationary-left-foot counterfactual reports incomplete anatomical motion, not a pass', () => {
  // Deliberately altered software input, never described as a physical attempt.
  const initial = new Map(trace[0].landmarks.map((point) => [point.index, point]));
  const stationary = trace.map((sample) => ({ ...sample, landmarks: sample.landmarks.map((point) =>
    [25, 27].includes(point.index) ? { ...initial.get(point.index)! } : point) }));
  const { session, result } = observe(stationary);
  assert.equal(result.status, 'mismatch');
  const summary = summarizeFollowProgress(reference, result, session);
  assert.ok(summary.percent !== null && summary.percent < 100);
  assert.match(summary.reason, /left foot/);
  assert.equal(summary.components.find((item) => item.id === 'motion-27')?.complete, false);
});

test('current movement diagnostics remain available before a distant endpoint is reached', () => {
  const { session } = observe(trace.slice(0, 4));
  // Deliberately displaced recorded left foot: labelled software counterfactual.
  const current = structuredClone(trace.at(-1)!);
  current.tMs = trace[3].tMs + 33;
  current.landmarks.find((point) => point.index === 27)!.x = 0.9;
  const result = evaluateFollowObservation(reference, current, { attemptAspectRatio: 16 / 9, session, liveAgeMs: 0 });
  assert.equal(result.endpoint?.status, 'adjust');
  assert.equal(result.status, 'mismatch');
  assert.ok(result.motionEvidence.some((item) => item.joint === 27));
  const summary = summarizeFollowProgress(reference, result, session);
  assert.ok(summary.percent !== null && summary.percent < 100);
  assert.match(summary.reason, /target pose/);
});

test('unknown camera tracking or insufficient teacher source never has a numerical percentage', () => {
  for (const status of ['no_pose', 'inference_error'] as const) {
    const { session } = observe();
    const result = evaluateFollowObservation(reference, { tMs: trace.at(-1)!.tMs + 33, status, landmarks: [] }, {
      attemptAspectRatio: 16 / 9, session, liveAgeMs: 0,
    });
    const summary = summarizeFollowProgress(reference, result, session);
    assert.equal(summary.percent, null);
    assert.ok(summary.components.every((item) => item.progress === null));
  }
  const sourceUnknown = prepareStepReference(form, form.steps[0], data);
  const session = createFollowSession(sourceUnknown);
  const result = evaluateFollowObservation(sourceUnknown, trace[0], { attemptAspectRatio: 16 / 9, session, liveAgeMs: 0 });
  assert.equal(sourceUnknown.referenceUsable, false);
  assert.equal(summarizeFollowProgress(sourceUnknown, result, session).percent, null);
});

test('stale, duplicated, and post-occlusion endpoint observations have no percentage', () => {
  const observed = observe();
  for (const age of [451, NaN, -1]) {
    const result = evaluateFollowObservation(reference, trace.at(-1), {
      attemptAspectRatio: 16 / 9, session: observed.session, liveAgeMs: age,
    });
    assert.equal(summarizeFollowProgress(reference, result, observed.session).percent, null);
  }
  const { session } = observe();
  const duplicate = evaluateFollowObservation(reference, trace.at(-1), { attemptAspectRatio: 16 / 9, session, liveAgeMs: 0 });
  assert.equal(summarizeFollowProgress(reference, duplicate, session).percent, null);
  const freshTarget = { ...trace.at(-1)!, tMs: trace.at(-1)!.tMs + 1000 };
  const afterGap = evaluateFollowObservation(reference, freshTarget, { attemptAspectRatio: 16 / 9, session, liveAgeMs: 0 });
  assert.equal(summarizeFollowProgress(reference, afterGap, session).percent, null);
});

test('labelled progress-only fixtures expose per-side requirements and never round a mismatch to 100', () => {
  const { session, result } = observe();
  const bilateral: FollowReference = { ...reference, focusJoints: [27, 28], referenceEvidence: [
    ...reference.referenceEvidence, { ...reference.referenceEvidence[0], joint: 28 },
  ] };
  const mismatched: FollowResult = { ...result, status: 'mismatch', motionEvidence: [
    { joint: 27, observed: true, projectedDisplacement: 1, requiredDisplacement: 1 },
    { joint: 28, observed: false, projectedDisplacement: 0.2, requiredDisplacement: 1 },
  ] };
  const summary = summarizeFollowProgress(bilateral, mismatched, session);
  assert.equal(summary.percent, 84);
  assert.equal(summary.components.find((item) => item.id === 'motion-28')?.progress, 0.2);
  assert.match(summary.reason, /right foot/);
  const near = { ...mismatched, motionEvidence: mismatched.motionEvidence.map((item) => ({
    ...item, projectedDisplacement: 0.9999, observed: false,
  })) };
  assert.equal(summarizeFollowProgress(bilateral, near, session).percent, 99);
});

test('posture-only step reports target proximity without fabricated start or motion components', () => {
  const { result, session } = observe();
  const posture = { ...reference, motionRequired: false };
  const summary = summarizeFollowProgress(posture, result, session);
  assert.deepEqual(summary.components.map((item) => item.id), ['target']);
  assert.equal(summary.components[0].weight, 1);
});

test('wrong step session or nonfinite endpoint diagnostics cannot inherit numerical progress', () => {
  const { result, session } = observe();
  assert.equal(summarizeFollowProgress(reference, result, { ...session, referenceId: 'different-step' }).percent, null);
  const invalid = { ...result, endpoint: { ...result.endpoint!, positionError: NaN } };
  assert.equal(summarizeFollowProgress(reference, invalid, session).percent, null);
});

test('exported unchanged fresh-observation hold needs 700ms and resets on unknown', () => {
  let hold = updateTeachingHold(null, { status: 'close' }, 1000, { targetKey: reference.id, observationTimestampMs: 1000 });
  hold = updateTeachingHold(hold, { status: 'close' }, 1300, { targetKey: reference.id, observationTimestampMs: 1300 });
  assert.equal(hold.ready, false);
  const duplicate = updateTeachingHold(hold, { status: 'close' }, 1500, { targetKey: reference.id, observationTimestampMs: 1300 });
  assert.equal(duplicate.heldMs, 300);
  hold = updateTeachingHold(hold, { status: 'close' }, 1650, { targetKey: reference.id, observationTimestampMs: 1650 });
  hold = updateTeachingHold(hold, { status: 'close' }, 1700, { targetKey: reference.id, observationTimestampMs: 1700 });
  assert.equal(hold.ready, true);
  hold = updateTeachingHold(hold, { status: 'unknown' }, 1750, { targetKey: reference.id, observationTimestampMs: 1750 });
  assert.equal(hold.ready, false);
  assert.equal(hold.heldMs, 0);
});
