import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PoseSample } from '../lib/imitation';
import { FOUR_POINT_INDICES, FOUR_POINT_RULES_VERSION, createFourPointSession, evaluateFourPointObservation,
  getFourPointBodyFrame, prepareFourPointStep, projectFourPointGuides } from '../lib/four-point-game';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/practice-media/dual-view/manifest.json'), 'utf8'));
const records = manifest.forms.map((form: any) => JSON.parse(fs.readFileSync(path.join(root, 'public', form.front.poseSrc), 'utf8')));
const opening = manifest.forms[0], openingData = records[0], step = opening.steps[1];
const reference = prepareFourPointStep(opening, step, openingData);
const samples: PoseSample[] = openingData.samples.filter((s: any) => s.sourceTimeSeconds >= step.front.startSeconds && s.sourceTimeSeconds < step.front.endSeconds);
function run(ref = reference, observations = samples, aspect = 16 / 9) {
  const session = createFourPointSession(ref);
  let result = evaluateFourPointObservation(ref, null, { attemptAspectRatio: aspect, session });
  for (const sample of observations) result = evaluateFourPointObservation(ref, sample, { attemptAspectRatio: aspect, liveAgeMs: 0, session });
  return { result, session };
}

test('all 24 forms / 172 steps have four named guides supported only by actual source endpoints', (t) => {
  let count = 0, usable = 0, replayMatches = 0, allFourValid = 0;
  for (let f = 0; f < manifest.forms.length; f++) for (const entry of manifest.forms[f].steps) {
    count++;
    const ref = prepareFourPointStep(manifest.forms[f], entry, records[f]);
    assert.deepEqual(ref.guides.map((g) => g.index), [...FOUR_POINT_INDICES]);
    for (const guide of ref.guides) {
      if (!guide.valid) continue;
      for (const end of ['start', 'end'] as const) {
        assert.ok(guide.support[`${end}Frames`].length >= 2);
        const raw = guide[`${end}Raw`]!, sourceTime = guide[`${end}SourceSeconds`]!;
        assert.ok(sourceTime >= entry.front.startSeconds && sourceTime < entry.front.endSeconds);
        const source = records[f].samples.find((s: any) => s.sourceTimeSeconds === sourceTime);
        const point = source.landmarks.find((p: any) => p.index === guide.index);
        assert.equal(raw.x, point.x); assert.equal(raw.y, point.y);
      }
    }
    if (ref.guides.every((g) => g.valid)) allFourValid++;
    const observations = records[f].samples.filter((s: any) => s.sourceTimeSeconds >= entry.front.startSeconds && s.sourceTimeSeconds < entry.front.endSeconds);
    const observation = run(ref, observations).result;
    if (ref.referenceUsable) { usable++; if (observation.status === 'match') replayMatches++; }
    else { assert.equal(observation.status, 'unknown'); assert.equal(observation.percent, null); }
  }
  assert.equal(manifest.forms.length, 24); assert.equal(count, 172);
  assert.ok(usable >= 90); assert.ok(replayMatches >= 50);
  t.diagnostic(`Actual cached MediaPipe observations: ${usable}/172 usable references, ${allFourValid} with all four valid guides, ${replayMatches} endpoint replay matches. This is a recorded-source software check, not live-human acceptance.`);
});

test('actual recorded left-foot start-to-end slide passes without elbow or knee requirements', () => {
  assert.deepEqual(reference.focusJoints, [27]);
  assert.ok(reference.referenceUsable);
  const noElbows = samples.map((s) => ({ ...s, landmarks: s.landmarks.filter((p) => ![13, 14, 25, 26].includes(p.index)) }));
  const result = run(reference, noElbows).result;
  assert.equal(result.status, 'match'); assert.equal(result.percent, 100);
  assert.ok(result.limbs.find((g) => g.index === 27)!.movementObserved);
});

test('counterfactual wrong-side slide cannot pass a named left-foot game target', () => {
  // Explicit synthetic negative test: keep index 27 at its observed normalized start;
  // move index 28 instead. This is never presented as a live camera observation.
  const start = reference.guides.find((g) => g.index === 27)!.start!;
  const wrongSide = samples.map((sample) => {
    const body = getFourPointBodyFrame(sample, 16 / 9)!;
    const left = sample.landmarks.find((p) => p.index === 27)!;
    return { ...sample, landmarks: sample.landmarks.map((p) => p.index === 27 ? { ...p,
      x: (start.x * body.scale + body.hip.x) / body.aspect, y: start.y * body.scale + body.hip.y }
      : p.index === 28 ? { ...p, x: left.x, y: left.y } : p) };
  });
  const result = run(reference, wrongSide).result;
  assert.equal(result.status, 'mismatch'); assert.ok(result.percent! < 100);
  assert.equal(result.limbs.find((g) => g.index === 27)!.movementObserved, false);
});

test('a moving target cannot pass by appearing at its end and remaining still', () => {
  const target = samples.at(-1)!;
  const still = Array.from({ length: 40 }, (_, i) => ({ ...target, tMs: 100 + i * 33 }));
  assert.equal(run(reference, still).result.status, 'mismatch');
});

test('stale, duplicate and missing required tracking never pass or yield numerical completion', () => {
  const { session } = run();
  const last = samples.at(-1)!;
  let result = evaluateFourPointObservation(reference, last, { attemptAspectRatio: 16 / 9, liveAgeMs: 0, session });
  assert.equal(result.status, 'unknown'); assert.equal(result.percent, null);
  result = evaluateFourPointObservation(reference, { ...last, tMs: last.tMs + 33 }, { attemptAspectRatio: 16 / 9, liveAgeMs: 451, session });
  assert.equal(result.status, 'unknown'); assert.equal(result.percent, null);
  assert.equal(session.limbs[27].startSeen, false);
  const hidden = { ...last, tMs: last.tMs + 66, landmarks: last.landmarks.filter((p) => p.index !== 27) };
  result = evaluateFourPointObservation(reference, hidden, { attemptAspectRatio: 16 / 9, liveAgeMs: 0, session });
  assert.equal(result.status, 'unknown'); assert.equal(result.percent, null);
});

test('source confidence gaps do not fabricate endpoints; hidden optional joints do not block a named foot', () => {
  const obscured = { ...openingData, samples: openingData.samples.map((s: any) => ({ ...s,
    landmarks: s.landmarks.map((p: any) => p.index === 27 ? { ...p, visibility: 0 } : p) })) };
  const ref = prepareFourPointStep(opening, step, obscured);
  assert.equal(ref.referenceUsable, false);
  const guide = ref.guides.find((g) => g.index === 27)!;
  assert.equal(guide.start, null); assert.equal(guide.end, null); assert.equal(guide.valid, false);
  assert.equal(run(ref).result.percent, null);
  const handHidden = samples.map((s) => ({ ...s, landmarks: s.landmarks.filter((p) => p.index !== 15) }));
  assert.equal(run(reference, handHidden).result.status, 'match');
  assert.equal(projectFourPointGuides(reference, handHidden[0], 16 / 9).filter((g) => g.valid).length, 4);
});

test('camera position, body scale and camera aspect preserve raw anatomical comparison and guide projection', () => {
  const aspect = 4 / 3;
  const transformed = samples.map((sample) => ({ ...sample, landmarks: sample.landmarks.map((p) => ({ ...p,
    x: (p.x * (16 / 9) * 0.6 + 0.08) / aspect, y: p.y * 0.6 + 0.1 })) }));
  assert.equal(run(reference, transformed, aspect).result.status, 'match');
  const guides = projectFourPointGuides(reference, transformed[0], aspect);
  assert.deepEqual(guides.map((g) => g.index), [...FOUR_POINT_INDICES]);
  assert.ok(guides.every((g) => g.start && g.end));
  assert.ok(projectFourPointGuides(reference, null, aspect).every((g) => !g.valid && g.start === null));
  assert.equal('mirror' in createFourPointSession(reference), false);
});

test('homepage star eligibility index agrees with actual current references and never offers stars for unassessable forms', () => {
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'public/game-levels.json'), 'utf8'));
  assert.equal(metadata.schemaVersion, 'four-point-levels-v1');
  assert.equal(metadata.sourceSha256, manifest.sources.front.sha256);
  assert.equal(metadata.modelSha256, openingData.modelSha256);
  assert.equal(metadata.rulesVersion, FOUR_POINT_RULES_VERSION);
  let availableStars = 0;
  const visualOnly: string[] = [];
  for (let f = 0; f < manifest.forms.length; f++) {
    const form = manifest.forms[f], level = metadata.forms[f];
    const eligible = form.steps.filter((entry: any) => prepareFourPointStep(form, entry, records[f]).referenceUsable).map((entry: any) => entry.id);
    assert.equal(level.id, form.id); assert.equal(level.formNumber, form.formNumber);
    assert.deepEqual(level.eligibleStepIds, eligible);
    assert.equal(level.totalSteps, form.steps.length);
    assert.equal(level.visualOnlyCount, form.steps.length - eligible.length);
    assert.equal(level.availableStars, eligible.length > 0 ? 3 : 0);
    availableStars += level.availableStars;
    if (!eligible.length) visualOnly.push(form.id);
  }
  assert.equal(metadata.availableStars, availableStars);
  assert.deepEqual(metadata.visualOnlyFormIds, visualOnly);
  assert.equal(availableStars, 66);
  assert.deepEqual(visualOnly, ['dual-20', 'dual-22']);
});
