// Versioned local progress for the four-point game. No camera data is stored.
export const GAME_PROGRESS_KEY = 'motiontrial.four-point-game.progress.v1';
export const GAME_PROGRESS_VERSION = 1;
export const GAME_FORM_STEP_COUNTS = Object.freeze([7, 12, 5, 13, 5, 9, 9, 9, 5, 9, 4, 5, 6, 6, 5, 9, 9, 9, 5, 5, 8, 5, 7, 6]);

function browserStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

export function gameStepIds(formId) {
  if (typeof formId !== 'string' || !/^dual-(0[1-9]|1\d|2[0-4])$/.test(formId)) return [];
  const count = GAME_FORM_STEP_COUNTS[Number(formId.slice(-2)) - 1];
  return Array.from({ length: count }, (_, index) => `${formId}-${String(index + 1).padStart(2, '0')}`);
}

function uniqueValid(values, valid) {
  return Array.isArray(values) ? [...new Set(values.filter(value => typeof value === 'string' && valid.has(value)))].sort() : [];
}

export function gameStars(matched, total) {
  if (!Number.isInteger(total) || total < 1 || !Number.isInteger(matched) || matched < 0 || matched > total) return 0;
  if (matched === total) return 3;
  if (matched >= Math.ceil(total * 2 / 3)) return 2;
  if (matched >= Math.ceil(total / 3)) return 1;
  return 0;
}

function normalizeForm(formId, raw = {}) {
  const stepIds = gameStepIds(formId);
  if (!stepIds.length) return null;
  const valid = new Set(stepIds);
  if (!Array.isArray(raw?.eligibleStepIds) || new Set(raw.eligibleStepIds).size !== raw.eligibleStepIds.length || raw.eligibleStepIds.some(id => !valid.has(id))) return null;
  const eligibleStepIds = [...raw.eligibleStepIds].sort();
  const eligible = new Set(eligibleStepIds);
  const matchedStepIds = uniqueValid(raw?.matchedStepIds, eligible);
  const matched = new Set(matchedStepIds);
  const unassessedStepIds = uniqueValid(raw?.unassessedStepIds, valid).filter(id => !matched.has(id));
  const attemptedStepIds = uniqueValid([...(Array.isArray(raw?.attemptedStepIds) ? raw.attemptedStepIds : []), ...matchedStepIds, ...unassessedStepIds], valid);
  return {
    formId, stars: gameStars(matchedStepIds.length, eligibleStepIds.length), matched: matchedStepIds.length,
    total: eligibleStepIds.length, eligibleCount: eligibleStepIds.length, totalSteps: stepIds.length,
    eligibleStepIds, visualOnlyCount: stepIds.length - eligibleStepIds.length,
    matchedStepIds, unassessedStepIds, attemptedStepIds,
    updatedAt: Number.isFinite(raw?.updatedAt) && raw.updatedAt >= 0 ? raw.updatedAt : 0,
  };
}

function emptyProgress(storageAvailable = false) {
  return { schemaVersion: GAME_PROGRESS_VERSION, forms: {}, totalStars: 0, matchedSteps: 0, lastFormId: null, storageAvailable };
}

export function readGameProgress(storage = browserStorage()) {
  const progress = emptyProgress(Boolean(storage));
  if (!storage || typeof storage.getItem !== 'function') return progress;
  try {
    const serialized = storage.getItem(GAME_PROGRESS_KEY);
    if (!serialized) return progress;
    const raw = JSON.parse(serialized);
    if (!raw || raw.schemaVersion !== GAME_PROGRESS_VERSION || typeof raw.forms !== 'object' || raw.forms === null || Array.isArray(raw.forms)) return progress;
    for (const [formId, value] of Object.entries(raw.forms)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const form = normalizeForm(formId, value);
      if (!form) continue;
      progress.forms[formId] = form;
      progress.totalStars += form.stars;
      progress.matchedSteps += form.matched;
    }
    progress.lastFormId = Object.hasOwn(progress.forms, raw.lastFormId) ? raw.lastFormId : null;
    return progress;
  } catch {
    // Corrupt or unavailable storage must never prevent practice.
    return emptyProgress(false);
  }
}

/** Cumulative observed clears earn stars; unassessed/manual steps never do. */
export function recordGameFormResult({ formId, stepIds, eligibleStepIds, results }, storage = browserStorage()) {
  const expected = gameStepIds(formId);
  if (!expected.length || !Array.isArray(stepIds) || stepIds.length !== expected.length || new Set(stepIds).size !== expected.length || !expected.every(id => stepIds.includes(id))) {
    throw new TypeError('Game progress requires the complete, canonical step list for one of the 24 forms.');
  }
  if (!Array.isArray(results)) throw new TypeError('Game results must be an array.');
  const valid = new Set(expected);
  if (!Array.isArray(eligibleStepIds) || new Set(eligibleStepIds).size !== eligibleStepIds.length || eligibleStepIds.some(id => !valid.has(id))) {
    throw new TypeError('Game progress requires a fixed, source-eligible subset of the canonical steps.');
  }
  const eligible = new Set(eligibleStepIds);
  const allowed = new Set(['matched', 'unassessed', 'skipped']);
  if (results.some(result => !result || !valid.has(result.stepId) || !allowed.has(result.status) || (result.status === 'matched' && !eligible.has(result.stepId)))) {
    throw new TypeError('Game results must use valid step IDs and explicit observed outcomes.');
  }
  const progress = readGameProgress(storage);
  const previous = progress.forms[formId] ?? normalizeForm(formId, { eligibleStepIds });
  if (previous.eligibleStepIds.length !== eligibleStepIds.length || !previous.eligibleStepIds.every(id => eligible.has(id))) {
    throw new TypeError('Source eligibility must stay fixed for saved game progress. Learner tracking cannot change the star denominator.');
  }
  const matched = new Set(previous.matchedStepIds);
  const unassessed = new Set(previous.unassessedStepIds);
  const attempted = new Set(previous.attemptedStepIds);
  for (const result of results) {
    attempted.add(result.stepId);
    if (result.status === 'matched') matched.add(result.stepId);
    if (result.status === 'unassessed') unassessed.add(result.stepId);
  }
  const form = normalizeForm(formId, {
    eligibleStepIds, matchedStepIds: [...matched], unassessedStepIds: [...unassessed], attemptedStepIds: [...attempted], updatedAt: Date.now(),
  });
  progress.forms[formId] = form;
  progress.lastFormId = formId;
  progress.totalStars = Object.values(progress.forms).reduce((sum, entry) => sum + entry.stars, 0);
  progress.matchedSteps = Object.values(progress.forms).reduce((sum, entry) => sum + entry.matched, 0);
  let persisted = false;
  try {
    if (storage && typeof storage.setItem === 'function') {
      storage.setItem(GAME_PROGRESS_KEY, JSON.stringify({ schemaVersion: GAME_PROGRESS_VERSION, forms: progress.forms, lastFormId: formId }));
      persisted = true;
    }
  } catch { /* Quota/private mode: current-session feedback still works. */ }
  if (typeof globalThis.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function') {
    globalThis.dispatchEvent(new CustomEvent('motiontrial-game-progress', { detail: { formId, stars: form.stars } }));
  }
  return { ...form, persisted, progress };
}
