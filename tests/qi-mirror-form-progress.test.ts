import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { restudyForm, teachingFormProgress } from '../features/qi-mirror/lib/form-progress';
import { parseTeachingPlaylist } from '../lib/teaching';

const steps = parseTeachingPlaylist(JSON.parse(readFileSync('public/practice-media/teaching-playlist.json', 'utf8'))).steps;

test('jumping to the last small step cannot skip the unconfirmed steps of that form', () => {
  const first = steps.filter(step => step.parentFormOrder === 1);
  const index = steps.findIndex(step => step.id === first.at(-1)!.id);
  const state = teachingFormProgress(steps, index, [first.at(-1)!.id])!;
  assert.equal(state.complete, false);
  assert.equal(state.nextStepIndex, 0);
  assert.equal(steps[state.nextStepIndex!].parentFormOrder, 1);
});

test('completing this form exposes its next form without claiming the full lesson is complete', () => {
  const first = steps.filter(step => step.parentFormOrder === 1);
  const state = teachingFormProgress(steps, first.length - 1, first.map(step => step.id))!;
  assert.equal(state.complete, true);
  assert.equal(state.nextStepIndex, null);
  assert.equal(steps[state.nextFormIndex!].parentFormOrder, 2);
  assert.equal(steps[state.nextFormIndex!].stepOrder, 1);
});

test('Restudy clears only this form and preserves confirmations in other forms', () => {
  const first = steps.filter(step => step.parentFormOrder === 1).map(step => step.id);
  const second = steps.filter(step => step.parentFormOrder === 2).map(step => step.id);
  const confirmed = [...first, ...second];
  const state = teachingFormProgress(steps, first.length, confirmed)!;
  assert.deepEqual(restudyForm(confirmed, state), first);
  assert.deepEqual(confirmed, [...first, ...second]);
});

test('last form completion has no fabricated form 25 or wrap to unconfirmed earlier forms', () => {
  const last = steps.filter(step => step.parentFormOrder === 24);
  const state = teachingFormProgress(steps, steps.length - 1, last.map(step => step.id))!;
  assert.equal(state.complete, true);
  assert.equal(state.formOrder, 24);
  assert.equal(state.nextFormIndex, null);
  assert.equal(state.stepIds.length, last.length);
});

test('invalid current indices do not grant completion', () => {
  assert.equal(teachingFormProgress(steps, -1, []), null);
  assert.equal(teachingFormProgress(steps, steps.length, steps.map(step => step.id)), null);
});
