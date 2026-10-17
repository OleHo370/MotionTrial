// Recorded observations only. This page never runs inference or requests a camera.
const $ = (id) => document.getElementById(id);
const names = ['front', 'back'];
const connections = [[0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],[9,10],
  [11,12],[11,13],[13,15],[15,17],[15,19],[15,21],[17,19],[12,14],[14,16],
  [16,18],[16,20],[16,22],[18,20],[11,23],[12,24],[23,24],[23,25],[25,27],
  [27,29],[29,31],[27,31],[24,26],[26,28],[28,30],[30,32],[28,32]];
const left = new Set([1,2,3,7,9,11,13,15,17,19,21,23,25,27,29,31]);
const right = new Set([4,5,6,8,10,12,14,16,18,20,22,24,26,28,30,32]);
const views = Object.fromEntries(names.map((name) => [name, {
  video: $(name + '-video'), canvas: $(name + '-overlay'), clock: $(name + '-clock'),
  quality: $(name + '-quality'), data: null, samples: null, drawn: undefined,
}]));
const state = {
  manifest: null, form: null, step: null, anchors: [], ready: false, playing: false,
  starting: false, held: false, speed: .5, operation: 0, loadGeneration: 0,
  seekGeneration: 0, aborter: null, pendingSeeks: new Set(), desiredTime: null,
  scrubbing: false, scrubResume: false, scrubTimer: null, lastDriftCheck: 0,
  lastText: 0, resetToken: 0, ending: false, samples: { front: null, back: null },
  poseRequests: [], scene: null, sceneError: null, sceneSignature: '',
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const timeText = (value) => {
  const time = Math.max(0, Number.isFinite(value) ? value : 0);
  return String(Math.floor(time / 60)).padStart(2, '0') + ':' + (time % 60).toFixed(2).padStart(5, '0');
};
const sourceFPS = (name) => state.manifest?.sources[name]?.fps || 30;
const selection = () => state.step || state.form;
const range = () => selection().front;
const finalFrameTime = () => Math.max(range().startSeconds, range().endSeconds - 1 / sourceFPS('front'));

function setStatus(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}
function showError(message) {
  $('load-error').hidden = !message;
  const text = $('load-error-message');
  if (text) text.textContent = message || '';
  else if (message) $('load-error').setAttribute('aria-label', message);
  if (message) setStatus(message, true);
}
function updateControls() {
  for (const id of ['play','replay','speed','seek','frame-prev','frame-next','step-select','loop']) $(id).disabled = !state.ready;
  const index = state.step ? state.form.steps.indexOf(state.step) + 1 : 0;
  $('step-prev').disabled = !state.ready || index === 0;
  $('step-next').disabled = !state.ready || index >= (state.form?.steps?.length || 0);
  $('play').textContent = state.playing || state.starting ? 'Pause' : 'Play';
  $('play').setAttribute('aria-pressed', String(state.playing || state.starting));
}
function cancelSeeks() {
  state.seekGeneration++;
  for (const cancel of [...state.pendingSeeks]) cancel();
  state.desiredTime = null;
}
function pausePair(message) {
  state.operation++;
  state.playing = false;
  state.starting = false;
  clearTimeout(state.scrubTimer);
  cancelSeeks();
  for (const view of Object.values(views)) view.video.pause();
  updateControls();
  if (message) setStatus(message);
}
function prepareAnchors() {
  const chosen = selection();
  const first = { frontSeconds: chosen.front.startSeconds, backSeconds: chosen.back.startSeconds };
  const last = { frontSeconds: chosen.front.endSeconds, backSeconds: chosen.back.endSeconds };
  const middle = state.form.anchors.filter((a) => a.frontSeconds > first.frontSeconds + .00001
    && a.frontSeconds < last.frontSeconds - .00001 && a.backSeconds > first.backSeconds && a.backSeconds < last.backSeconds);
  state.anchors = [first, ...middle, last];
}
function mapping(frontSeconds) {
  const anchors = state.anchors;
  if (anchors.length < 2) return { time: frontSeconds, slope: 1 };
  let i = 0;
  while (i < anchors.length - 2 && frontSeconds >= anchors[i + 1].frontSeconds) i++;
  const a = anchors[i], b = anchors[i + 1];
  const slope = (b.backSeconds - a.backSeconds) / (b.frontSeconds - a.frontSeconds);
  return { time: clamp(a.backSeconds + (frontSeconds - a.frontSeconds) * slope,
    anchors[0].backSeconds, anchors.at(-1).backSeconds), slope };
}
function setRates() {
  views.front.video.playbackRate = clamp(state.speed, .0625, 16);
  views.back.video.playbackRate = clamp(state.speed * mapping(views.front.video.currentTime).slope, .0625, 16);
}

// Exact source frame lookup, using a tiny epsilon only for floating-point time.
// No future-frame selection, interpolation, smoothing, or last-pose retention.
function sampleAt(name, time) {
  const view = views[name];
  if (!view.data || !Number.isFinite(time)) return null;
  const frame = Math.floor(time * sourceFPS(name) + .00001);
  const sample = view.samples.get(frame);
  return sample && Math.abs(sample.sourceTimeSeconds - time) <= 1 / sourceFPS(name) + .00001 ? sample : null;
}
function visiblePoint(point, world = false) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y)
    && (!world || Number.isFinite(point.z))
    && Number.isFinite(point.visibility) && point.visibility >= .45
    && (point.presence == null || (Number.isFinite(point.presence) && point.presence >= .45));
}
function pointColor(index) { return left.has(index) ? '#24e1d2' : right.has(index) ? '#ffc25e' : '#f4fbff'; }
function drawOverlay(view, sample, force) {
  if (!force && view.drawn === sample) return;
  view.drawn = sample;
  const { canvas, video } = view, ctx = canvas.getContext('2d');
  if (!ctx) return;
  const rect = canvas.getBoundingClientRect(), pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * pixelRatio));
  const height = Math.max(1, Math.round(rect.height * pixelRatio));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  ctx.clearRect(0, 0, width, height);
  if (sample?.status !== 'pose' || !sample.landmarks?.length || !video.videoWidth || !video.videoHeight) return;
  const fit = Math.min(width / video.videoWidth, height / video.videoHeight);
  const imageWidth = video.videoWidth * fit, imageHeight = video.videoHeight * fit;
  const xOffset = (width - imageWidth) / 2, yOffset = (height - imageHeight) / 2;
  const points = new Map(sample.landmarks.filter((p) => visiblePoint(p)).map((p) => [p.index, p]));
  const position = (p) => [xOffset + p.x * imageWidth, yOffset + p.y * imageHeight];
  ctx.lineCap = 'round'; ctx.lineWidth = Math.max(2, imageWidth / 210);
  ctx.shadowColor = '#071322b0'; ctx.shadowBlur = 3 * pixelRatio;
  for (const [a,b] of connections) {
    if (!points.has(a) || !points.has(b)) continue;
    ctx.strokeStyle = left.has(a) && left.has(b) ? '#24e1d2' : right.has(a) && right.has(b) ? '#ffc25e' : '#e9f7ff';
    ctx.beginPath(); ctx.moveTo(...position(points.get(a))); ctx.lineTo(...position(points.get(b))); ctx.stroke();
  }
  for (const [index, point] of points) {
    ctx.beginPath(); ctx.arc(...position(point), Math.max(2.5, imageWidth / 160), 0, Math.PI * 2);
    ctx.fillStyle = pointColor(index); ctx.fill();
    ctx.strokeStyle = '#102a40'; ctx.lineWidth = Math.max(1, pixelRatio); ctx.stroke();
  }
  ctx.shadowBlur = 0;
}
function counts(name) {
  if (!state.scene || state.sceneError) return null;
  // Read transformed coverage before the source group's visibility is applied.
  // The renderer requires confident image AND world observations and hip anchors.
  const diagnostic = state.scene.getDiagnostics().views?.[name];
  if (!diagnostic) return null;
  const points = new Set(diagnostic.validIndices || []);
  return { points: points.size, bones: connections.filter(([a,b]) => points.has(a) && points.has(b)).length };
}
function trackingText(view, sample) {
  if (!view.data) return 'Loading recorded observations…';
  if (!sample) return 'No recorded observation at this source frame · unknown';
  if (sample.status === 'inference_error') return 'Recorded inference error · unknown';
  if (sample.status !== 'pose') return 'No pose detected · unknown';
  const visible = (sample.landmarks || []).filter((p) => visiblePoint(p)).length;
  return visible ? `${visible}/33 image points visible · confidence ≥ 0.45` : 'Low-confidence image points · unknown';
}
function disableScene(error) {
  state.sceneError = error?.message || String(error || '3D rendering is unavailable.');
  // Keep the renderer's readable fallback/context-loss message in the scene.
  try { state.scene?.setAutoRotate(false); } catch { /* Recorded videos remain usable. */ }
  for (const control of document.querySelectorAll('[data-view], #auto-rotate, #trail')) control.disabled = true;
  $('scene-status').textContent = '3D unavailable: ' + state.sceneError + ' The source videos remain available.';
  $('scene-status').classList.add('error');
}
function render(force = false) {
  const freshText = force || performance.now() - state.lastText > 100;
  for (const name of names) {
    const view = views[name];
    // currentTime changes before the new pixels finish decoding on a seek.
    // Clear both skeletons for that source until the requested frame is ready.
    const sample = view.video.seeking || view.video.readyState < 2 ? null : sampleAt(name, view.video.currentTime);
    state.samples[name] = sample;
    drawOverlay(view, sample, force);
    if (freshText) {
      view.clock.textContent = `Source ${timeText(view.video.currentTime)} · frame ${Math.floor(view.video.currentTime * sourceFPS(name) + .00001)}`;
      view.quality.textContent = trackingText(view, sample);
      view.quality.classList.toggle('unknown', !sample || sample.status !== 'pose');
    }
  }
  const signature = `${state.samples.front?.frameIndex ?? '-'}:${state.samples.back?.frameIndex ?? '-'}:${$('source-mode').value}:${$('trail').checked}:${state.resetToken}`;
  if (state.scene && !state.sceneError && (force || signature !== state.sceneSignature)) {
    state.sceneSignature = signature;
    try {
      state.scene.update({ frontSample: state.samples.front, backSample: state.samples.back,
        mode: $('source-mode').value, showTrails: $('trail').checked, showGhosts: false, resetToken: state.resetToken });
    } catch (error) { disableScene(error); }
  }
  if (!freshText) return;
  state.lastText = performance.now();
  const f = counts('front'), b = counts('back');
  $('source-summary').textContent = f && b
    ? `Available 3D coverage · Front: ${f.points}/33 points · ${f.bones} bones  |  Back: ${b.points}/33 points · ${b.bones} bones`
    : state.sceneError ? '3D coverage unavailable · source-video observations remain available.' : 'Preparing 3D coverage…';
  if (state.scene && !state.sceneError) {
    const mode = $('source-mode').value;
    const hasPose = mode === 'front' ? f?.points : mode === 'back' ? b?.points : (f?.points || 0) + (b?.points || 0);
    $('scene-status').textContent = !state.form || !views.front.data ? 'Loading recorded 3D observations…'
      : hasPose ? (state.playing ? 'Playing recorded 3D estimates · drag to orbit' : 'Paused · drag to orbit, scroll to zoom, click a joint')
        : 'No confident 3D points at this source frame · tracking unknown';
  }
  if (!state.form) return;
  const bounds = range(), duration = bounds.endSeconds - bounds.startSeconds;
  const elapsed = state.held ? duration : clamp(views.front.video.currentTime - bounds.startSeconds, 0, duration);
  if (!state.scrubbing) $('seek').value = String(elapsed / duration * 1000);
  $('elapsed').textContent = `${timeText(elapsed)} / ${timeText(duration)}`;
}
function resetHistory() { state.resetToken++; state.sceneSignature = ''; }

function seekVideo(video, time) {
  const bounded = clamp(time, 0, Math.max(0, video.duration - .001));
  if (Math.abs(video.currentTime - bounded) < .00001 && video.readyState >= 2 && !video.seeking) return Promise.resolve(true);
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => finish(new Error('A source video seek timed out. Retry the selection.')), 20000);
    const cancel = () => finish(null, false);
    const done = () => finish(null, true);
    const failed = () => finish(new Error('The source video could not be decoded.'));
    function finish(error, result) {
      if (settled) return;
      settled = true; clearTimeout(timeout);
      state.pendingSeeks.delete(cancel);
      video.removeEventListener('seeked', done); video.removeEventListener('error', failed);
      error ? reject(error) : resolve(result);
    }
    state.pendingSeeks.add(cancel);
    video.addEventListener('seeked', done); video.addEventListener('error', failed);
    try { video.currentTime = bounded; } catch (error) { finish(error); }
  });
}
async function seekPair(frontSeconds, operation = state.operation, reset = true) {
  cancelSeeks();
  const generation = state.seekGeneration;
  const time = clamp(frontSeconds, range().startSeconds, finalFrameTime());
  state.desiredTime = time;
  if (reset) resetHistory();
  const results = await Promise.all([seekVideo(views.front.video, time), seekVideo(views.back.video, mapping(time).time)]);
  if (generation !== state.seekGeneration || operation !== state.operation || results.some((done) => !done)) return false;
  state.desiredTime = null;
  setRates(); render(true);
  return true;
}
async function playPair(replay = false) {
  if (!state.ready) return;
  pausePair();
  const operation = state.operation;
  state.held = false; state.ending = false;
  try {
    const time = replay || views.front.video.currentTime >= finalFrameTime() - .005
      ? range().startSeconds : clamp(views.front.video.currentTime, range().startSeconds, finalFrameTime());
    if (!await seekPair(time, operation, replay) || operation !== state.operation || !state.ready) return;
    state.starting = true; updateControls();
    await Promise.all(names.map((name) => views[name].video.play()));
    if (operation !== state.operation || !state.ready) {
      if (!state.playing && !state.starting) for (const view of Object.values(views)) view.video.pause();
      return;
    }
    state.starting = false; state.playing = true;
    updateControls(); setStatus('Playing the aligned selection.');
  } catch (error) {
    if (operation !== state.operation) return;
    pausePair(); setStatus(error.message || 'Playback could not start. Press Play again.', true);
  }
}
async function holdEnd() {
  if (state.ending) return;
  state.ending = true;
  const looping = $('loop').checked;
  pausePair();
  const operation = state.operation;
  state.held = !looping;
  try {
    if (looping) await playPair(true);
    else if (await seekPair(finalFrameTime(), operation)) setStatus('Selection complete · holding the final source frames.');
  } catch (error) { if (operation === state.operation) setStatus(error.message, true); }
  finally { state.ending = false; }
}
function tick(now) {
  if (state.ready && state.playing) {
    const front = views.front.video, back = views.back.video;
    if (front.currentTime >= finalFrameTime() || front.ended) void holdEnd();
    else {
      try { setRates(); } catch (error) { pausePair(); setStatus('This browser does not support the requested aligned playback speed.', true); }
      if (now - state.lastDriftCheck > 200) {
        state.lastDriftCheck = now;
        const target = mapping(front.currentTime).time;
        if (!front.seeking && !back.seeking && Math.abs(back.currentTime - target) > .08) back.currentTime = target;
      }
    }
  }
  render(); requestAnimationFrame(tick);
}

async function readJson(src, signal) {
  const response = await fetch(src, { signal });
  if (!response.ok) throw new Error(`Could not load ${src} (HTTP ${response.status}).`);
  return response.json();
}
function validRange(bounds) {
  return bounds && Number.isFinite(bounds.startSeconds) && Number.isFinite(bounds.endSeconds)
    && bounds.startSeconds >= 0 && bounds.endSeconds > bounds.startSeconds;
}
function validateManifest(manifest) {
  if (manifest.schemaVersion !== 'dual-view-alignment-v1' || !manifest.sources?.front?.src
    || !manifest.sources?.back?.src || !Array.isArray(manifest.forms) || !manifest.forms.length)
    throw new Error('The local alignment manifest is missing or unsupported.');
  for (const form of manifest.forms) {
    if (!validRange(form.front) || !validRange(form.back) || !form.front.poseSrc || !form.back.poseSrc
      || !Array.isArray(form.anchors) || form.anchors.length < 2) throw new Error('A form has incomplete source data.');
    for (let i = 0; i < form.anchors.length; i++) {
      const a = form.anchors[i], p = form.anchors[i - 1];
      if (!Number.isFinite(a.frontSeconds) || !Number.isFinite(a.backSeconds)
        || (p && (a.frontSeconds <= p.frontSeconds || a.backSeconds <= p.backSeconds)))
        throw new Error('Alignment anchors must increase in both recordings.');
    }
    for (const step of form.steps || []) {
      if (!validRange(step.front) || !validRange(step.back)
        || step.front.startSeconds < form.front.startSeconds - .05 || step.front.endSeconds > form.front.endSeconds + .05
        || step.back.startSeconds < form.back.startSeconds - .05 || step.back.endSeconds > form.back.endSeconds + .05)
        throw new Error('An action range falls outside its form.');
    }
  }
  return manifest;
}
function validatePose(data, expected) {
  if (data.schemaVersion !== 'dual-view-poses-v1' || !Array.isArray(data.samples) || !data.samples.length)
    throw new Error('The recorded observations are missing or unsupported.');
  if (!Number.isFinite(data.sourceStartSeconds) || !Number.isFinite(data.sourceEndSeconds)
    || data.sourceStartSeconds > expected.startSeconds + .1 || data.sourceEndSeconds < expected.endSeconds - .1)
    throw new Error('The recorded observations do not cover the selected form.');
  let previous = -Infinity;
  for (const sample of data.samples) {
    if (!Number.isFinite(sample.sourceTimeSeconds) || !Number.isInteger(sample.frameIndex)
      || sample.frameIndex <= previous || !['pose','no_pose','inference_error'].includes(sample.status)
      || (sample.status === 'pose' && (!Array.isArray(sample.landmarks) || !Array.isArray(sample.worldLandmarks))))
      throw new Error('The recorded frame observations have invalid timestamps, status, or landmarks.');
    previous = sample.frameIndex;
  }
  return data;
}
function renderSelections() {
  $('step-select').replaceChildren(new Option('Whole form', 'whole'));
  for (const [i, step] of (state.form.steps || []).entries()) $('step-select').add(new Option(`${i + 1}. ${step.title}`, step.id));
  $('step-select').value = state.step?.id || 'whole';
  const form = state.form;
  $('form-caption').textContent = `${form.chineseTitle} · Front ${timeText(form.front.startSeconds)}–${timeText(form.front.endSeconds)} · Back ${timeText(form.back.startSeconds)}–${timeText(form.back.endSeconds)}`;
  $('step-caption').textContent = state.step ? state.step.title : `${form.steps.length} actions · whole form selected`;
  updateControls();
}
async function selectStep(step) {
  if (!state.ready) return;
  pausePair();
  const operation = state.operation;
  state.step = step; state.held = false; state.scrubbing = false; state.scrubResume = false; state.ending = false;
  prepareAnchors(); renderSelections();
  try {
    if (await seekPair(range().startSeconds, operation)) setStatus('Ready · play, step through frames, or orbit while paused.');
  } catch (error) { if (operation === state.operation) showError(error.message); }
}
async function selectForm(form, requestedStep = null) {
  pausePair();
  const generation = ++state.loadGeneration;
  const operation = state.operation;
  state.aborter?.abort(); state.aborter = new AbortController();
  state.ready = false; state.form = form; state.step = (form.steps || []).find((step, i) => step.id === requestedStep || String(i + 1) === requestedStep) || null;
  state.held = false; state.scrubbing = false; state.scrubResume = false; state.ending = false;
  showError(null); resetHistory();
  for (const view of Object.values(views)) { view.data = null; view.samples = null; view.drawn = undefined; }
  state.samples = { front: null, back: null };
  $('inspect-details').textContent = 'Click a visible joint in the 3D scene to inspect its recorded estimate.';
  prepareAnchors(); renderSelections(); render(true);
  setStatus(`Loading recorded observations for form ${form.formNumber}…`);
  try {
    const data = await Promise.all(names.map(async (name) => {
      state.poseRequests.push(form[name].poseSrc);
      return validatePose(await readJson(form[name].poseSrc, state.aborter.signal), form[name]);
    }));
    if (generation !== state.loadGeneration || operation !== state.operation) return;
    names.forEach((name, i) => { views[name].data = data[i]; views[name].samples = new Map(data[i].samples.map((sample) => [sample.frameIndex, sample])); });
    if (!await seekPair(range().startSeconds, operation) || generation !== state.loadGeneration) return;
    state.ready = true; updateControls(); render(true);
    setStatus('Ready · both original videos and their recorded MediaPipe observations are loaded.');
  } catch (error) {
    if (generation === state.loadGeneration && operation === state.operation && error.name !== 'AbortError') showError(error.message);
  }
}
function loadVideo(name, source) {
  const video = views[name].video;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error(`The ${name} recording took too long to load. Use Retry.`)), 30000);
    const loaded = () => finish();
    const failed = () => finish(new Error(`The ${name} recording could not be loaded or decoded.`));
    function finish(error) {
      clearTimeout(timeout); video.removeEventListener('loadeddata', loaded); video.removeEventListener('error', failed);
      error ? reject(error) : resolve();
    }
    video.addEventListener('loadeddata', loaded); video.addEventListener('error', failed);
    video.muted = true; video.playsInline = true; video.src = source.src; video.load();
  });
}
async function boot() {
  pausePair(); state.ready = false; showError(null); updateControls();
  $('form-select').disabled = true;
  try {
    if (location.protocol === 'file:') throw new Error('Open this page through the local MotionTrial server so recorded JSON can load.');
    state.manifest = validateManifest(await readJson('/practice-media/dual-view/manifest.json'));
    $('form-select').replaceChildren();
    for (const form of state.manifest.forms) $('form-select').add(new Option(`${String(form.formNumber).padStart(2, '0')} · ${form.title} / ${form.chineseTitle}`, form.id));
    await Promise.all(names.map((name) => loadVideo(name, state.manifest.sources[name])));
    const params = new URLSearchParams(location.search), requested = params.get('form');
    const initial = state.manifest.forms.find((form) => form.id === requested || String(form.formNumber) === requested || String(form.formNumber).padStart(2, '0') === requested) || state.manifest.forms[0];
    $('form-select').disabled = false; $('form-select').value = initial.id;
    await selectForm(initial, params.get('step'));
  } catch (error) { showError(error.message || 'Could not load the local recordings.'); }
}
async function initializeScene() {
  try {
    const { createStudyScene } = await import('./study-3d-scene.js');
    state.scene = createStudyScene($('scene-container'), (info) => {
      if (!info) return;
      const confidence = Number.isFinite(info.visibility) ? `${(info.visibility * 100).toFixed(1)}% visibility` : 'visibility unknown';
      const angle = Number.isFinite(info.angle) ? ` · estimated joint angle ${info.angle.toFixed(1)}°` : '';
      $('inspect-details').textContent = `${info.name || 'Landmark ' + info.index} · ${info.source === 'back' ? 'Back' : 'Front'} source · ${confidence}${angle} · source ${timeText(info.sourceTimeSeconds)}`;
    });
    const diagnostic = state.scene.getDiagnostics();
    if (!diagnostic.ready) {
      disableScene(diagnostic.error || 'This browser could not initialize the 3D renderer.');
      render(true);
      return;
    }
    state.scene.setAutoRotate($('auto-rotate').checked);
    render(true);
  } catch (error) { disableScene(error); }
}

$('play').addEventListener('click', () => {
  if (state.playing || state.starting) pausePair('Paused · orbit the held recorded pose.');
  else void playPair();
});
$('replay').addEventListener('click', () => void playPair(true));
$('speed').addEventListener('change', () => {
  state.speed = Number($('speed').value);
  try { setRates(); } catch { pausePair('This playback rate is unsupported by the browser.'); }
});
$('form-select').addEventListener('change', () => {
  const form = state.manifest?.forms.find((f) => f.id === $('form-select').value);
  if (form) void selectForm(form);
});
$('step-select').addEventListener('change', () => void selectStep(state.form.steps.find((s) => s.id === $('step-select').value) || null));
for (const [id, offset] of [['step-prev',-1],['step-next',1]]) $(id).addEventListener('click', () => {
  const choices = [null, ...state.form.steps], index = state.step ? choices.indexOf(state.step) : 0;
  void selectStep(choices[clamp(index + offset, 0, choices.length - 1)]);
});
for (const [id, offset] of [['frame-prev',-1],['frame-next',1]]) $(id).addEventListener('click', async () => {
  if (!state.ready) return;
  const frame = Math.floor(views.front.video.currentTime * sourceFPS('front') + .00001);
  pausePair(); state.held = false; state.scrubbing = false;
  try { if (await seekPair((frame + offset) / sourceFPS('front'))) setStatus('Paused · one actual front-source frame per step.'); }
  catch (error) { showError(error.message); }
});
function beginScrub() {
  if (state.scrubbing) return;
  state.scrubResume = state.playing || state.starting;
  pausePair(); state.scrubbing = true; state.held = false;
}
$('seek').addEventListener('input', () => {
  if (!state.ready) return;
  beginScrub(); clearTimeout(state.scrubTimer);
  const bounds = range(), time = bounds.startSeconds + Number($('seek').value) / 1000 * (bounds.endSeconds - bounds.startSeconds);
  const operation = state.operation;
  $('elapsed').textContent = `${timeText(time - bounds.startSeconds)} / ${timeText(bounds.endSeconds - bounds.startSeconds)}`;
  state.scrubTimer = setTimeout(() => {
    if (operation === state.operation) void seekPair(time, operation).catch((error) => { if (operation === state.operation) showError(error.message); });
  }, 40);
});
$('seek').addEventListener('change', async () => {
  if (!state.ready || !state.form) return;
  clearTimeout(state.scrubTimer);
  const bounds = range(), time = bounds.startSeconds + Number($('seek').value) / 1000 * (bounds.endSeconds - bounds.startSeconds);
  const resume = state.scrubResume, operation = state.operation;
  state.scrubbing = false; state.scrubResume = false;
  try {
    if (await seekPair(time, operation)) {
      if (resume) void playPair(); else setStatus('Paused at the selected source frames.');
    }
  } catch (error) { if (operation === state.operation) showError(error.message); }
});
$('source-mode').addEventListener('change', () => { resetHistory(); render(true); });
$('trail').addEventListener('change', () => { resetHistory(); render(true); });
$('auto-rotate').addEventListener('change', () => state.scene?.setAutoRotate($('auto-rotate').checked));
for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => {
  state.scene?.setView(button.dataset.view);
  for (const other of document.querySelectorAll('[data-view]')) other.setAttribute('aria-pressed', String(other === button));
});
$('retry').addEventListener('click', () => {
  if (state.manifest && state.form && names.every((name) => views[name].video.readyState >= 2)) void selectForm(state.form, state.step?.id);
  else void boot();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && (state.playing || state.starting)) pausePair('Paused because the page is hidden.');
});
document.addEventListener('keydown', (event) => {
  if (event.code !== 'Space' || event.repeat || event.target.closest('button,input,select,a,summary,textarea')) return;
  event.preventDefault(); if (state.ready) $('play').click();
});
for (const [name, view] of Object.entries(views)) {
  view.video.addEventListener('seeked', () => render(true));
  view.video.addEventListener('loadeddata', () => render(true));
  view.video.addEventListener('error', () => {
    if (!state.ready) return;
    pausePair(); state.ready = false; updateControls(); showError(`The ${name} source recording could not be decoded. Use Retry.`);
  });
}
const resizeObserver = new ResizeObserver(() => { for (const view of Object.values(views)) view.drawn = undefined; render(true); state.scene?.resize(); });
for (const view of Object.values(views)) resizeObserver.observe(view.canvas);
window.addEventListener('pagehide', () => { pausePair(); state.aborter?.abort(); state.scene?.dispose(); resizeObserver.disconnect(); });
$('scene-container').addEventListener('study3derror', (event) => {
  disableScene(event.detail || 'The 3D renderer is no longer available.');
  render(true);
});
Object.defineProperty(window, 'study3dDiagnostics', { configurable: false, get: () => ({
  ready: state.ready, formId: state.form?.id || null, stepId: state.step?.id || 'whole',
  frontTime: views.front.video.currentTime, backTime: views.back.video.currentTime,
  sampleFrames: { front: state.samples.front?.frameIndex ?? null, back: state.samples.back?.frameIndex ?? null },
  mode: $('source-mode').value, playing: state.playing, starting: state.starting,
  driftSeconds: state.form ? views.back.video.currentTime - mapping(views.front.video.currentTime).time : null,
  scene: state.scene?.getDiagnostics() || { ready: false, error: state.sceneError },
  poseRequests: [...state.poseRequests], loadedForms: state.form && views.front.data ? [state.form.id] : [],
}) });
updateControls();
requestAnimationFrame(tick);
void initializeScene();
void boot();
