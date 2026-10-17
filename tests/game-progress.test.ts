// Storage-only fixtures: these are not camera observations or human practice acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GAME_FORM_STEP_COUNTS, GAME_PROGRESS_KEY, gameStars, gameStepIds, readGameProgress, recordGameFormResult } from '../public/game-progress.js';

class MemoryStorage implements Storage {
  values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

const ids = gameStepIds('dual-01');
const payload = (results: { stepId: string; status: string }[], eligibleStepIds = ids) => ({ formId: 'dual-01', stepIds: ids, eligibleStepIds, results });

test('game progress catalog matches the actual 24-form, 172-step source manifest', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/practice-media/dual-view/manifest.json', import.meta.url), 'utf8'));
  assert.equal(GAME_FORM_STEP_COUNTS.length, 24);
  assert.equal(GAME_FORM_STEP_COUNTS.reduce((sum, count) => sum + count, 0), 172);
  for (const form of manifest.forms) assert.deepEqual(gameStepIds(form.id), form.steps.map((step: { id: string }) => step.id));
  for (const invalid of ['dual-00', 'dual-25', 'dual-1', '../dual-01', '__proto__']) assert.deepEqual(gameStepIds(invalid), []);
});

test('stars have explicit one-third, two-thirds and all-target boundaries', () => {
  assert.deepEqual(Array.from({ length: 8 }, (_, matched) => gameStars(matched, 7)), [0, 0, 0, 1, 1, 2, 2, 3]);
  assert.equal(gameStars(0, 0), 0);
  assert.equal(gameStars(1, 0), 0);
  assert.equal(gameStars(8, 7), 0);
  assert.equal(gameStars(1.5, 7), 0);
});

test('only source-eligible targets enter the denominator and all can earn three stars', () => {
  const storage = new MemoryStorage();
  const eligible = ids.slice(0, 4);
  const first = recordGameFormResult(payload(eligible.slice(0, 2).map(stepId => ({ stepId, status: 'matched' })), eligible), storage);
  assert.equal(first.stars, 1);
  assert.equal(first.total, 4);
  assert.equal(first.totalSteps, 7);
  assert.equal(first.visualOnlyCount, 3);
  const second = recordGameFormResult(payload([{ stepId: eligible[2], status: 'matched' }], eligible), storage);
  assert.equal(second.stars, 2);
  const third = recordGameFormResult(payload([{ stepId: eligible[3], status: 'matched' }], eligible), storage);
  assert.equal(third.stars, 3);
  assert.equal(third.matched, 4);
});

test('unknown and skipped steps earn nothing; duplicate observed steps count once across visits', () => {
  const storage = new MemoryStorage();
  const first = recordGameFormResult(payload([
    { stepId: ids[0], status: 'matched' }, { stepId: ids[0], status: 'matched' },
    { stepId: ids[1], status: 'unassessed' }, { stepId: ids[2], status: 'skipped' },
  ]), storage);
  assert.equal(first.matched, 1);
  assert.equal(first.stars, 0);
  const second = recordGameFormResult(payload([{ stepId: ids[0], status: 'unassessed' }, { stepId: ids[1], status: 'matched' }, { stepId: ids[2], status: 'matched' }]), storage);
  assert.equal(second.matched, 3);
  assert.equal(second.stars, 1);
  assert.deepEqual(second.unassessedStepIds, []);
  assert.equal(second.persisted, true);
  const restored = readGameProgress(storage);
  assert.equal(restored.matchedSteps, 3);
  assert.equal(restored.totalStars, 1);
  assert.equal(restored.lastFormId, 'dual-01');
});

test('zero playable targets do not create a free three-star level', () => {
  const result = recordGameFormResult(payload(ids.map(stepId => ({ stepId, status: 'unassessed' })), []), new MemoryStorage());
  assert.equal(result.stars, 0);
  assert.equal(result.total, 0);
  assert.equal(result.visualOnlyCount, 7);
  assert.equal(result.matched, 0);
});

test('invalid identities and outcomes cannot award stars or change the denominator', () => {
  const storage = new MemoryStorage();
  assert.throws(() => recordGameFormResult(payload([{ stepId: 'dual-02-01', status: 'matched' }]), storage), TypeError);
  assert.throws(() => recordGameFormResult(payload([{ stepId: ids[0], status: 'unknown' }]), storage), TypeError);
  assert.throws(() => recordGameFormResult({ ...payload([]), stepIds: ids.slice(1) }, storage), TypeError);
  assert.throws(() => recordGameFormResult(payload([{ stepId: ids[6], status: 'matched' }], ids.slice(0, 4)), storage), TypeError);
  recordGameFormResult(payload([], ids.slice(0, 4)), storage);
  assert.throws(() => recordGameFormResult(payload([], ids.slice(0, 3)), storage), TypeError);
  assert.equal(readGameProgress(storage).totalStars, 0);
});

test('stored summary values are derived from valid matched IDs, never trusted as awards', () => {
  const storage = new MemoryStorage();
  storage.setItem(GAME_PROGRESS_KEY, JSON.stringify({ schemaVersion: 1, lastFormId: 'dual-99', forms: {
    'dual-01': { stars: 3, matched: 700, total: 1, eligibleStepIds: ids, matchedStepIds: [ids[0], ids[0], 'dual-02-01'], unassessedStepIds: [ids[0], ids[1]] },
    'dual-25': { stars: 3, matchedStepIds: ['dual-25-01'], eligibleStepIds: ['dual-25-01'] },
  } }));
  const restored = readGameProgress(storage);
  assert.equal(restored.totalStars, 0);
  assert.equal(restored.matchedSteps, 1);
  assert.equal(restored.lastFormId, null);
  assert.equal(Object.keys(restored.forms).length, 1);
});

test('corrupt, incompatible or inaccessible storage does not break the game', () => {
  const storage = new MemoryStorage();
  for (const value of ['{', 'null', '{"schemaVersion":999,"forms":{}}', '{"schemaVersion":1,"forms":[]}']) {
    storage.setItem(GAME_PROGRESS_KEY, value);
    assert.equal(readGameProgress(storage).totalStars, 0);
  }
  const blocked = new MemoryStorage();
  blocked.getItem = () => { throw new Error('storage disabled'); };
  blocked.setItem = () => { throw new Error('quota exceeded'); };
  const session = recordGameFormResult(payload(ids.slice(0, 3).map(stepId => ({ stepId, status: 'matched' }))), blocked);
  assert.equal(session.stars, 1);
  assert.equal(session.persisted, false);
});

test('game saving touches only the new game key and stores no pose/video data', () => {
  const storage = new MemoryStorage();
  storage.setItem('existing-practice-progress', 'preserve me');
  recordGameFormResult(payload([{ stepId: ids[0], status: 'matched' }]), storage);
  assert.equal(storage.getItem('existing-practice-progress'), 'preserve me');
  assert.equal(storage.length, 2);
  const saved = storage.getItem(GAME_PROGRESS_KEY)!;
  assert.ok(!saved.includes('landmarks'));
  assert.ok(!saved.includes('video'));
  assert.ok(!saved.includes('image'));
});
