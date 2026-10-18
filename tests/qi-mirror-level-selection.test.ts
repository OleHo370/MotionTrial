import test from 'node:test';
import assert from 'node:assert/strict';
import { nearestLevelStep, romanLevel, wheelSlot, wrapLevel, WHEEL_STEP_DEGREES } from '../features/qi-mirror/lib/level-selection';

test('three complete octagonal turns visit every form once and wrap without reversing', () => {
  assert.deepEqual(Array.from({ length: 24 }, (_, step) => wrapLevel(step)), Array.from({ length: 24 }, (_, index) => index));
  assert.equal(24 * WHEEL_STEP_DEGREES, 1080);
  assert.equal(wrapLevel(24), 0);
  assert.equal(wrapLevel(-1), 23);
  assert.equal(nearestLevelStep(23, 0), 24);
  assert.equal(nearestLevelStep(0, 23), -1);
});

test('recycled wheel slots stay unique and exactly one selected form lands at the pointer', () => {
  for (let step = -48; step <= 48; step++) {
    const slots = Array.from({ length: 8 }, (_, slot) => ({ slot, ...wheelSlot(step, slot) }));
    assert.equal(new Set(slots.map(item => item.index)).size, 8);
    const selected = slots.filter(item => item.selected);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].index, wrapLevel(step));
    assert.equal(((selected[0].slot - step) * WHEEL_STEP_DEGREES % 360 + 360) % 360, 0);
    for (const item of slots) assert.equal(wrapLevel(nearestLevelStep(step, item.index)), item.index);
  }
});

test('Roman numerals remain unambiguous at chapter and level boundaries', () => {
  assert.deepEqual([1, 4, 8, 9, 16, 19, 24].map(romanLevel), ['I', 'IV', 'VIII', 'IX', 'XVI', 'XIX', 'XXIV']);
});
