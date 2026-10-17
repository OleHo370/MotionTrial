import { GAME_PROGRESS_KEY, gameStars, gameStepIds, readGameProgress } from './game-progress.js';

const grid = document.querySelector('#level-grid');
const loading = document.querySelector('#loading-message');
const error = document.querySelector('#load-error');
const pathFor = formId => `/follow-teacher.html?game=1&form=${encodeURIComponent(formId)}`;
let forms = [];
let levelInfo = new Map();
let availableStars = 0;

function star(earned) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  if (earned) svg.classList.add('earned');
  const shape = document.createElementNS(svg.namespaceURI, 'path');
  shape.setAttribute('d', 'm12 2.5 2.93 5.94 6.55.95-4.74 4.62 1.12 6.52L12 17.45l-5.86 3.08 1.12-6.52-4.74-4.62 6.55-.95z');
  svg.append(shape);
  return svg;
}

function render() {
  if (!forms.length) return;
  const progress = readGameProgress();
  // The audited source determines playable targets; learner visibility never does.
  const summaries = new Map(forms.map(form => {
    const info = levelInfo.get(form.id);
    const matched = (progress.forms[form.id]?.matchedStepIds ?? []).filter(id => info.eligibleStepIds.includes(id)).length;
    return [form.id, { matched, stars: gameStars(matched, info.eligibleStepIds.length) }];
  }));
  const totalStars = [...summaries.values()].reduce((sum, form) => sum + form.stars, 0);
  const matchedSteps = [...summaries.values()].reduce((sum, form) => sum + form.matched, 0);
  const playable = forms.filter(form => levelInfo.get(form.id).eligibleStepIds.length > 0);
  const next = playable.find(form => summaries.get(form.id).stars < 3) ?? playable[0] ?? forms[0];
  const last = forms.find(form => form.id === progress.lastFormId);
  const featured = last && levelInfo.get(last.id).eligibleStepIds.length > 0 && summaries.get(last.id).stars < 3 ? last : next;
  document.querySelector('#total-stars').textContent = String(totalStars);
  document.querySelector('#available-stars').textContent = `/ ${availableStars} available stars`;
  document.querySelector('#total-progress').style.width = `${availableStars ? totalStars / availableStars * 100 : 0}%`;
  document.querySelector('#observed-total').textContent = `${matchedSteps} targets collected`;
  document.querySelector('#continue-journey').href = pathFor(featured.id);
  document.querySelector('#continue-label').textContent = matchedSteps ? 'Continue your journey' : 'Begin your journey';
  document.querySelector('#continue-caption').textContent = `${matchedSteps ? 'Next up' : 'Start with'} ${String(featured.formNumber).padStart(2, '0')} · ${featured.title}`;
  document.querySelector('#save-status').textContent = progress.storageAvailable ? 'Progress stays on this device' : 'Local saving is unavailable';
  grid.replaceChildren();
  for (const form of forms) {
    const info = levelInfo.get(form.id);
    const { stars, matched } = summaries.get(form.id);
    const visualOnly = info.eligibleStepIds.length === 0;
    const card = document.createElement('a');
    card.className = `level-card${form.id === featured.id ? ' next-level' : ''}${stars === 3 ? ' completed' : ''}${visualOnly ? ' visual-only-level' : ''}`;
    card.href = pathFor(form.id);
    card.dataset.formId = form.id;
    card.setAttribute('aria-label', `${form.formNumber}. ${form.title}. ${visualOnly ? 'Visual practice only. Stars unavailable for this recording.' : `${stars} of 3 stars. ${matched} of ${info.eligibleStepIds.length} playable targets observed; ${info.visualOnlyCount} visual-only steps.`}`);
    const top = document.createElement('div'); top.className = 'level-top';
    const number = document.createElement('span'); number.className = 'level-number'; number.textContent = String(form.formNumber).padStart(2, '0');
    const starRow = document.createElement('span'); starRow.className = 'level-stars'; starRow.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 3; i += 1) starRow.append(star(i < stars));
    top.append(number, starRow);
    const title = document.createElement('h3'); title.className = 'level-title'; title.textContent = form.title;
    const detail = document.createElement('p'); detail.className = 'level-detail'; detail.textContent = visualOnly ? 'Visual practice only · no stars' : `${matched} / ${info.eligibleStepIds.length} targets · ${info.visualOnlyCount} visual-only`;
    const track = document.createElement('div'); track.className = 'mini-track'; track.setAttribute('aria-hidden', 'true');
    const fill = document.createElement('div'); fill.style.width = `${info.eligibleStepIds.length ? matched / info.eligibleStepIds.length * 100 : 0}%`; track.append(fill);
    const bottom = document.createElement('div'); bottom.className = 'level-bottom';
    const cue = document.createElement('span'); cue.textContent = visualOnly ? 'Watch & follow' : stars === 3 ? 'Flow collected' : form.id === featured.id ? 'Your next move' : matched ? 'Keep going' : 'Ready to play';
    const arrow = document.createElement('span'); arrow.className = 'level-arrow'; arrow.textContent = '↗'; arrow.setAttribute('aria-hidden', 'true');
    bottom.append(cue, arrow);
    card.append(top, title, detail, track, bottom);
    grid.append(card);
  }
}

async function load() {
  loading.hidden = false;
  error.hidden = true;
  try {
    const [manifestResponse, levelsResponse] = await Promise.all([
      fetch('/practice-media/dual-view/manifest.json'), fetch('/game-levels.json'),
    ]);
    if (!manifestResponse.ok || !levelsResponse.ok) throw new Error('Movement map or audited targets could not load.');
    const [manifest, levels] = await Promise.all([manifestResponse.json(), levelsResponse.json()]);
    if (!Array.isArray(manifest.forms) || manifest.forms.length !== 24 || manifest.forms.reduce((sum, form) => sum + (form.steps?.length ?? 0), 0) !== 172) throw new Error('Movement map does not contain 24 forms and 172 steps.');
    for (const [index, form] of manifest.forms.entries()) {
      const expected = gameStepIds(form.id);
      if (form.formNumber !== index + 1 || typeof form.title !== 'string' || !expected.length || form.steps.length !== expected.length || !form.steps.every((step, i) => step.id === expected[i])) throw new Error('Movement map step identities are invalid.');
    }
    if (!levels || levels.schemaVersion !== 'four-point-levels-v1' || !Array.isArray(levels.forms) || levels.forms.length !== 24 || new Set(levels.forms.map(form => form.id)).size !== 24 || !Array.isArray(levels.visualOnlyFormIds)) throw new Error('Audited target catalog is invalid.');
    const audited = new Map(levels.forms.map(form => [form.id, form]));
    let auditedStars = 0;
    const visualOnlyIds = [];
    for (const form of manifest.forms) {
      const info = audited.get(form.id);
      const valid = new Set(gameStepIds(form.id));
      if (!info || info.formNumber !== form.formNumber || info.totalSteps !== form.steps.length || !Array.isArray(info.eligibleStepIds) || new Set(info.eligibleStepIds).size !== info.eligibleStepIds.length || info.eligibleStepIds.some(id => !valid.has(id)) || info.visualOnlyCount !== form.steps.length - info.eligibleStepIds.length || info.availableStars !== (info.eligibleStepIds.length ? 3 : 0)) throw new Error('Audited targets do not match the source movement map.');
      auditedStars += info.availableStars;
      if (!info.eligibleStepIds.length) visualOnlyIds.push(form.id);
    }
    if (levels.availableStars !== auditedStars || levels.visualOnlyFormIds.length !== visualOnlyIds.length || !visualOnlyIds.every(id => levels.visualOnlyFormIds.includes(id))) throw new Error('Audited star total is inconsistent.');
    forms = manifest.forms;
    levelInfo = audited;
    availableStars = auditedStars;
    render();
    loading.hidden = true;
  } catch {
    loading.hidden = true;
    error.hidden = false;
  }
}

document.querySelector('#retry-load').addEventListener('click', load);
window.addEventListener('pageshow', render);
window.addEventListener('motiontrial-game-progress', render);
window.addEventListener('storage', event => { if (event.key === GAME_PROGRESS_KEY || event.key === null) render(); });
load();
