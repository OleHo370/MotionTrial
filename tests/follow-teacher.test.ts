import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFollowSession, evaluateFollowObservation, prepareStepReference, FOLLOW_FOCUS_ROWS } from '../lib/follow-teacher';
import { evaluateTeachingPose } from '../lib/teaching';
import type { PoseSample } from '../lib/imitation';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/practice-media/dual-view/manifest.json'), 'utf8'));
const data = manifest.forms.map((form: any) => JSON.parse(fs.readFileSync(path.join(root, 'public', form.front.poseSrc), 'utf8')));
const opening = manifest.forms[0], openingData = data[0];
const leftStep = prepareStepReference(opening, opening.steps[1], openingData);
const sourceSamples = openingData.samples.filter((sample: any) => sample.sourceTimeSeconds >= opening.steps[1].front.startSeconds
  && sample.sourceTimeSeconds < opening.steps[1].front.endSeconds);
function run(reference: typeof leftStep, samples: PoseSample[], aspect = 16 / 9, timeScale = 1) {
  const session = createFollowSession(reference);
  let result;
  for (const sample of samples) result = evaluateFollowObservation(reference, { ...sample, tMs: sample.tMs * timeScale },
    { attemptAspectRatio: aspect, liveAgeMs: 0, session });
  return { result: result!, session };
}
function torso(sample: PoseSample, aspect = 16 / 9) {
  const p = new Map(sample.landmarks.map((point) => [point.index, point]));
  const x = (p.get(23)!.x + p.get(24)!.x) * aspect / 2, y = (p.get(23)!.y + p.get(24)!.y) / 2;
  return { x, y, scale: Math.hypot((p.get(11)!.x + p.get(12)!.x) * aspect / 2 - x, (p.get(11)!.y + p.get(12)!.y) / 2 - y) };
}

test('all 24 existing forms and 172 steps have explicit semantic foci and source observations', () => {
  assert.equal(FOLLOW_FOCUS_ROWS.length, 24);
  let count = 0, usable = 0, selfMatches = 0;
  for (let f = 0; f < manifest.forms.length; f++) {
    const form = manifest.forms[f];
    assert.equal(FOLLOW_FOCUS_ROWS[f].length, form.steps.length);
    for (const step of form.steps) {
      count++;
      const reference = prepareStepReference(form, step, data[f]);
      assert.ok(reference.sourceSampleCount > 0);
      assert.ok(reference.focusJoints.every((joint) => [15, 16, 27, 28].includes(joint)));
      assert.ok(reference.targetSourceSeconds < step.front.endSeconds);
      const samples = data[f].samples.filter((sample: any) => sample.sourceTimeSeconds >= step.front.startSeconds
        && sample.sourceTimeSeconds < step.front.endSeconds);
      const observed = run(reference, samples).result;
      if (reference.referenceUsable) { usable++; if (observed.status === 'match') selfMatches++; }
      else assert.equal(observed.status, 'unknown', step.id);
    }
  }
  assert.equal(count, 172);
  assert.ok(usable >= 50, `Expected real usable references; found ${usable}`);
  // The actual trace can lose focus visibility after starting; that correctly clears
  // movement evidence even when its source span has enough overall coverage.
  assert.ok(selfMatches >= 50, `Expected at least 50 replay-observed matches; found ${selfMatches} of ${usable} eligible targets.`);
});

test('raw recorded left-foot motion matches anatomical index 27 without reflection', () => {
  assert.deepEqual(leftStep.focusJoints, [27]);
  assert.ok(leftStep.referenceUsable);
  const result = run(leftStep, sourceSamples).result;
  assert.equal(result.status, 'match');
  assert.ok(result.motionEvidence.some((e) => e.joint === 27 && e.observed));
  assert.match(result.message, /left foot/);
  // Replaying five times slower has the same result: there is no attempt deadline.
  assert.equal(run(leftStep, sourceSamples, 16 / 9, 5).result.status, 'match');
});

test('position, uniform scale and different camera aspect are corrected in raw computation', () => {
  const aspect = 4 / 3;
  const transformed = sourceSamples.map((sample: PoseSample) => ({ ...sample, landmarks: sample.landmarks.map((point) => ({
    ...point, x: (point.x * (16 / 9) * 0.6 + 0.08) / aspect, y: point.y * 0.6 + 0.1,
  })) }));
  assert.equal(run(leftStep, transformed, aspect).result.status, 'match');
});

test('labelled counterfactual: stationary anatomical left foot plus moving right foot cannot pass broad endpoint proximity', () => {
  // This is a deliberately altered recorded trace, NOT a camera or human attempt.
  const base = sourceSamples[0] as PoseSample, baseTorso = torso(base);
  const initial = new Map(base.landmarks.map((p) => [p.index, p]));
  const counterfactual = sourceSamples.map((sample: PoseSample) => {
    const current = torso(sample);
    return { ...sample, landmarks: sample.landmarks.map((point) => {
      if ([25, 27].includes(point.index)) {
        const before = initial.get(point.index)!;
        return { ...point, x: (current.x + (before.x * (16 / 9) - baseTorso.x) / baseTorso.scale * current.scale) / (16 / 9),
          y: current.y + (before.y - baseTorso.y) / baseTorso.scale * current.scale };
      }
      if ([26, 28].includes(point.index)) return { ...point, x: point.x - 0.02 };
      return point;
    }) };
  });
  const endpointOnly = evaluateTeachingPose(leftStep.target, counterfactual.at(-1), {
    referenceAspectRatio: 16 / 9, attemptAspectRatio: 16 / 9, focusJoints: [27],
  });
  assert.equal(endpointOnly.status, 'close', 'The unchanged forgiving endpoint comparator alone is insufficient here.');
  const guarded = run(leftStep, counterfactual).result;
  assert.equal(guarded.status, 'mismatch');
  assert.ok(!guarded.motionEvidence.find((item) => item.joint === 27)!.observed);
});

test('tiny source change is explicitly unknown rather than claimed as an observed foot lift', () => {
  const first = prepareStepReference(opening, opening.steps[0], openingData);
  assert.equal(first.referenceUsable, false);
  assert.match(first.unknownReason!, /too small/);
  const result = evaluateFollowObservation(first, openingData.samples[0], {
    attemptAspectRatio: 16 / 9, liveAgeMs: 0, session: createFollowSession(first),
  });
  assert.equal(result.status, 'unknown');
});

test('missing, low-confidence and stale observations clear movement evidence', () => {
  for (const variant of ['no_pose', 'inference_error', 'missing', 'visibility', 'presence', 'stale'] as const) {
    const { session } = run(leftStep, sourceSamples);
    const latest: PoseSample = structuredClone(sourceSamples.at(-1));
    latest.tMs += 33;
    if (variant === 'no_pose' || variant === 'inference_error') { latest.status = variant; latest.landmarks = []; }
    if (variant === 'missing') latest.landmarks = latest.landmarks.filter((p) => p.index !== 27);
    if (variant === 'visibility') latest.landmarks.find((p) => p.index === 27)!.visibility = 0.1;
    if (variant === 'presence') (latest.landmarks.find((p) => p.index === 27)! as any).presence = 0.1;
    const result = evaluateFollowObservation(leftStep, latest, { attemptAspectRatio: 16 / 9, liveAgeMs: variant === 'stale' ? 451 : 0, session });
    assert.equal(result.status, 'unknown', variant);
    assert.equal(session.baseline, null, variant);
  }
});

test('camera frame gaps and step changes cannot borrow previous movement evidence', () => {
  const { session } = run(leftStep, sourceSamples);
  const latest = { ...sourceSamples.at(-1), tMs: sourceSamples.at(-1).tMs + 1000 };
  const result = evaluateFollowObservation(leftStep, latest, { attemptAspectRatio: 16 / 9, liveAgeMs: 0, session });
  assert.equal(result.status, 'unknown');
  assert.equal(session.sampleCount, 0);
  assert.equal(session.baseline, null);
  const nextReference = prepareStepReference(opening, opening.steps[3], openingData);
  evaluateFollowObservation(nextReference, latest, { attemptAspectRatio: 16 / 9, liveAgeMs: 0, session });
  assert.equal(session.referenceId, nextReference.id);
  assert.equal(session.sampleCount, 1);
});

test('an endpoint seen after occlusion remains unknown until a new movement beginning is visible', () => {
  const { session } = run(leftStep, sourceSamples);
  const missing = { tMs: sourceSamples.at(-1).tMs + 33, status: 'no_pose' as const, landmarks: [] };
  evaluateFollowObservation(leftStep, missing, { attemptAspectRatio: 16 / 9, liveAgeMs: 0, session });
  for (let i = 1; i <= 8; i++) {
    const endpointOnly = { ...sourceSamples.at(-1), tMs: missing.tMs + i * 33 };
    const result = evaluateFollowObservation(leftStep, endpointOnly, { attemptAspectRatio: 16 / 9, liveAgeMs: 0, session });
    assert.equal(result.status, 'unknown');
    assert.equal(session.baseline, null);
  }
});

test('repeated inference timestamps cannot create new anatomical movement evidence', () => {
  const session = createFollowSession(leftStep);
  const start = { ...sourceSamples[0], tMs: 1000 };
  evaluateFollowObservation(leftStep, start, { attemptAspectRatio: 16 / 9, liveAgeMs: 0, session });
  // Deliberately mutated duplicate timestamp: labelled software counterfactual, not an inference.
  const changedDuplicate = { ...sourceSamples.at(-1), tMs: 1000 };
  const result = evaluateFollowObservation(leftStep, changedDuplicate, { attemptAspectRatio: 16 / 9, liveAgeMs: 0, session });
  assert.equal(result.status, 'unknown');
  assert.equal(session.sampleCount, 1);
});
