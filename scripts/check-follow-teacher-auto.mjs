/**
 * Automatic follow QA. Browser control fixtures are explicitly labelled and are
 * never represented as a human learner. The real-model case uses the existing
 * front.mp4 + generated-black prerecorded camera fixture and actual local WASM.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'artifacts/follow-teacher-auto-review');
const base = process.env.FOLLOW_TEACHER_TEST_URL || 'http://127.0.0.1:8766';
const fixture = path.join(root, 'artifacts/follow-teacher-review/qa-prerecorded-front-with-black-gap.y4m');
const manifest = JSON.parse(await readFile(path.join(root, 'public/practice-media/dual-view/manifest.json')));
const checks = [], snapshots = {}, pageErrors = [], remoteResponses = [];
const add = (text) => { checks.push(text); console.log(`PASS: ${text}`); };
const sha = async (file) => createHash('sha256').update(await readFile(file)).digest('hex');
await mkdir(out, { recursive: true });

async function staticChecks() {
  const baseline = JSON.parse(await readFile(path.join(out, 'protected-before.json')));
  const protectedFiles = [];
  for (const item of baseline.files) protectedFiles.push({ path: item.path, beforeSha256: item.sha256,
    afterSha256: await sha(path.join(root, item.path)) });
  for (const item of protectedFiles) assert.equal(item.beforeSha256, item.afterSha256, item.path);
  const existingBaseline = JSON.parse(await readFile(path.join(root, 'artifacts/follow-teacher-review/protected-before.json')));
  for (const item of protectedFiles) assert.equal(item.afterSha256, existingBaseline.files.find((entry) => entry.path === item.path).sha256);
  const originals = [];
  for (const view of ['front', 'back']) {
    const filename = path.resolve(root, '../../', `${view}.mp4`), actual = await sha(filename);
    assert.equal(actual, manifest.sources[view].sha256);
    originals.push({ path: filename, sha256: actual });
  }
  const assets = JSON.parse(await readFile(path.join(root, 'public/mediapipe/manifest.json'))), modelAssets = [];
  for (const asset of assets.assets) {
    const actual = await sha(path.join(root, 'public', asset.path)); assert.equal(actual, asset.sha256);
    modelAssets.push({ path: asset.path, sha256: actual });
  }
  await writeFile(path.join(out, 'protected-after.json'), JSON.stringify({ result: 'PASS', checkedAt: new Date().toISOString(), protectedFileCount: protectedFiles.length, files: protectedFiles, originals, modelAssets }, null, 2) + '\n');
  add(`${protectedFiles.length} old pages, matching helpers, recorded observations and protected resources retain both the new before/after and original SHA-256 values.`);
  assert.equal(manifest.forms.length, 24);
  assert.equal(manifest.forms.reduce((total, form) => total + form.steps.length, 0), 172);
  for (const form of manifest.forms) {
    assert.equal(form.anchors.length, form.steps.length + 1);
    for (const [index, step] of form.steps.entries()) for (const view of ['front', 'back']) {
      assert.equal(step[view].startSeconds, form.anchors[index][`${view}Seconds`]);
      assert.equal(step[view].endSeconds, form.anchors[index + 1][`${view}Seconds`]);
      assert.ok(step[view].endSeconds > step[view].startSeconds);
    }
  }
  add('All 24 forms and 172 existing microsteps preserve the original front/back phase boundaries.');
}

// TEST ONLY: routed module emits real recorded landmarks, with explicitly
// synthetic fresh timing. It exercises orchestration independently of inference.
const cameraFixtureScript = `
export function createFollowCamera(options) {
  const {onObservation=()=>{},onState=()=>{},startButton,stopButton,deviceSelect,mirrorCheckbox,skeletonCheckbox,statusElement}=options;
  let running=false,timer=null,starts=0,ended=0,inferences=0,lastSample=null,lastObservedAt=null,stepId=null,phaseStart=0,lastStage=null;
  const cache=new Map();
  const state=()=>({phase:running?'running':'idle',running,starting:false,tracking:running?(lastSample?'pose':'no_pose'):'off',hasSample:!!lastSample,inferenceCount:inferences,streamStarts:starts,stoppedTracks:ended,lastSampleStatus:lastSample?.status||null,lastObservedAt,tracks:running?[{kind:'video',readyState:'live',deviceId:'qa-recorded-landmark-control'}]:[]});
  const notify=()=>{statusElement.textContent='QA TEST FIXTURE: recorded landmarks with synthetic camera timing; not a live learner.';onState(state());};
  async function emit(){
    if(!running)return;
    const d=window.followTeacherDiagnostics;
    if(!d?.ready)return;
    if(!cache.has(d.formId))cache.set(d.formId,fetch('/practice-media/dual-view/front-'+d.formId.slice(-2)+'.poses.json').then(r=>r.json()));
    const data=await cache.get(d.formId);if(!running)return;
    const mode=window.__qaFixtureMode||'unknown';
    const stage=d.auto?.phase||'';
    const key=d.stepId+':'+(d.auto?.round||1)+':'+(d.auto?.attemptId||0);
    if(stepId!==key){stepId=key;phaseStart=performance.now();}
    if(stage==='demonstrating'&&lastStage!==stage)phaseStart=performance.now();
    lastStage=stage;
    if(mode==='unknown'){lastSample=null;lastObservedAt=null;onObservation(null);notify();return;}
    const start=d.selection.front.startSeconds,end=d.selection.front.endSeconds-1/data.fps;
    let sourceTime=start;
    if(mode==='source-motion'){
      // Begin at the teacher's actual source start, progress over 900ms, then
      // hold the actual endpoint. Repeat only when a new application round starts.
      sourceTime=start+(end-start)*Math.min(1,Math.max(0,(performance.now()-phaseStart-250)/900));
    }
    if(mode==='target-only')sourceTime=end;
    let recorded=data.samples.find(s=>s.frameIndex===Math.floor(sourceTime*data.fps+0.00001));
    if(!recorded||recorded.status!=='pose'){lastSample=null;onObservation(null);notify();return;}
    const now=performance.now();lastSample={...recorded,tMs:now};lastObservedAt=now;inferences++;
    onObservation({sample:lastSample,observedAtMs:now,aspectRatio:data.width/data.height});notify();
  }
  async function start(){if(running)stop();running=true;starts++;stepId=null;notify();timer=setInterval(()=>void emit(),80);await emit();}
  function stop(){if(running)ended++;running=false;clearInterval(timer);timer=null;lastSample=null;lastObservedAt=null;onObservation(null);notify();}
  startButton.addEventListener('click',()=>void start());stopButton.addEventListener('click',stop);
  deviceSelect.addEventListener('change',()=>{if(running)void start();});
  const mirror=()=>{for(const el of [options.video,options.canvas])el.style.transform=mirrorCheckbox.checked?'scaleX(-1)':'none';};mirrorCheckbox.addEventListener('change',mirror);mirror();
  notify();return {start,stop,getState:state,refreshDevices:async()=>{},destroy:stop};
}`;

async function label(page, message) {
  await page.evaluate((text) => { const banner = document.createElement('div'); banner.textContent = text;
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#fff0b8;color:#4d3510;padding:8px;text-align:center;font:13px Arial';
    document.body.appendChild(banner); }, message);
}
async function diagnostics(page) { return page.evaluate(() => window.followTeacherDiagnostics); }
async function ready(page, expectedStep) {
  await page.waitForFunction((step) => window.followTeacherDiagnostics?.ready && (!step || window.followTeacherDiagnostics.stepId === step), expectedStep);
}
async function launch(extraArgs = []) {
  return chromium.launch({ channel: 'chrome', headless: true, args: extraArgs });
}
async function newPage(browser, { fixtureMode, url = '', viewport = { width: 1512, height: 1180 }, denyCamera = false } = {}) {
  const page = await browser.newPage({ viewport }); page.setDefaultTimeout(45000);
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('response', (response) => { if (!response.url().startsWith(base) && !response.url().startsWith('blob:') && !response.url().startsWith('data:')) remoteResponses.push(response.url()); });
  await page.addInitScript(({ mode, denied }) => {
    window.__qaFixtureMode = mode;
    window.__qaCaptureRequests = 0;
    const capture = navigator.mediaDevices?.getUserMedia.bind(navigator.mediaDevices);
    if (capture) navigator.mediaDevices.getUserMedia = (constraints) => {
      window.__qaCaptureRequests++;
      if (denied) return Promise.reject(new DOMException('QA deliberate permission denial.', 'NotAllowedError'));
      return capture(constraints);
    };
  }, { mode: fixtureMode, denied: denyCamera });
  if (fixtureMode) await page.route('**/follow-teacher-camera.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: cameraFixtureScript }));
  await page.goto(`${base}/follow-teacher.html${url}`);
  await ready(page);
  return page;
}

async function browserChecks() {
  const browser = await launch();
  let currentPage = null;
  const phase = (page, expected) => page.waitForFunction((value) => window.followTeacherDiagnostics?.auto?.phase === value, expected);
  try {
    const page = currentPage = await newPage(browser, { denyCamera: true });
    await page.waitForFunction(() => !!window.followTeacherDiagnostics.auto);
    snapshots.initial = await diagnostics(page);
    assert.equal(await page.evaluate(() => window.__qaCaptureRequests), 0);
    assert.equal(snapshots.initial.speed, 0.5);
    assert.equal(snapshots.initial.layout.primary, 'back');
    assert.equal(snapshots.initial.layout.mode, 'dual');
    assert.equal(await page.locator('#back-overlay').count(), 0);
    const transforms = await page.evaluate(() => ({ front: getComputedStyle(document.getElementById('front-pixels')).transform,
      back: getComputedStyle(document.getElementById('back-video')).transform,
      grouped: document.getElementById('front-pixels').contains(document.getElementById('front-overlay')) }));
    assert.match(transforms.front, /^matrix\(-1,/); assert.equal(transforms.back, 'none'); assert.equal(transforms.grouped, true);
    add('Default half-speed, back-primary dual view and grouped mirrored front skeleton; no camera permission request on load.');
    assert.equal(snapshots.initial.auto.phase, 'countdown');
    assert.equal(snapshots.initial.auto.referenceState, 'insufficient');
    for (const id of ['lesson-settings', 'playback-settings', 'camera-settings']) assert.equal(await page.locator(`#${id}`).getAttribute('open'), null);
    await page.waitForFunction(() => document.getElementById('overlay-countdown').textContent === '2');
    await page.click('#practice-toggle');
    let paused = await diagnostics(page);
    assert.equal(paused.auto.paused, true);
    await page.waitForTimeout(1150);
    let d = await diagnostics(page);
    assert.equal(d.auto.phase, 'countdown'); assert.equal(d.auto.paused, true);
    assert.ok(Math.abs(d.auto.remainingMs - paused.auto.remainingMs) < 70);
    assert.ok(Math.abs(d.frontTime - paused.frontTime) < 0.01);
    await page.click('#practice-toggle');
    await page.waitForFunction(() => document.getElementById('overlay-countdown').textContent === '1');
    await phase(page, 'demonstrating');
    assert.equal((await diagnostics(page)).auto.round, 1);
    add('Automatic 3–2–1 occurs without interaction; pause freezes countdown and video, Resume continues from the remaining time.');
    await phase(page, 'grace');
    paused = await diagnostics(page);
    assert.equal(paused.held, true); assert.equal(paused.playing, false);
    assert.ok(paused.frontTime > 8.4 && paused.frontTime < 8.5);
    assert.ok(Math.abs(paused.driftSeconds) < 0.1);
    await page.click('#practice-toggle'); paused = await diagnostics(page);
    await page.waitForTimeout(700); d = await diagnostics(page);
    assert.equal(d.auto.phase, 'grace'); assert.equal(d.auto.paused, true);
    assert.ok(Math.abs(d.auto.remainingMs - paused.auto.remainingMs) < 70);
    await page.click('#practice-toggle');
    await phase(page, 'feedback');
    let feedbackAt = performance.now();
    snapshots.referenceInsufficient = await diagnostics(page);
    assert.equal(snapshots.referenceInsufficient.auto.round, 1);
    assert.equal(snapshots.referenceInsufficient.auto.progress, null);
    assert.match(await page.locator('#overlay-title').textContent(), /not assessed/i);
    assert.doesNotMatch(await page.locator('#overlay-progress').textContent(), /\d+%/);
    assert.equal(snapshots.referenceInsufficient.auto.results.length, 0);
    await page.waitForTimeout(2200);
    assert.equal((await diagnostics(page)).auto.phase, 'feedback');
    await page.waitForFunction(() => window.followTeacherDiagnostics.auto.phase === 'demonstrating' && window.followTeacherDiagnostics.auto.round === 2);
    assert.ok(performance.now() - feedbackAt >= 2850);
    assert.equal((await diagnostics(page)).stepId, 'dual-01-01');
    add('Held target provides a four-second completion buffer; insufficient-reference feedback has no percentage and stays three real seconds before round 2.');
    await page.waitForFunction(() => window.followTeacherDiagnostics.auto.results.some((entry) => entry.stepId === 'dual-01-01' && entry.status === 'unassessed'));
    await ready(page, 'dual-01-02');
    snapshots.afterVisualRounds = await diagnostics(page);
    assert.equal(snapshots.afterVisualRounds.auto.results.filter((entry) => entry.stepId === 'dual-01-01').length, 1);
    assert.equal(snapshots.afterVisualRounds.auto.results.some((entry) => entry.status === 'matched'), false);
    add('Three full insufficient-reference demo/buffer/feedback rounds continue with unassessed, never a matched pass.');
    await phase(page, 'feedback'); d = await diagnostics(page);
    assert.equal(d.stepId, 'dual-01-02'); assert.equal(d.auto.referenceState, 'usable'); assert.equal(d.auto.progress, null);
    assert.match(await page.locator('#overlay-title').textContent(), /Unable to judge/i);
    await page.waitForFunction(() => window.followTeacherDiagnostics.auto.round >= 2 && window.followTeacherDiagnostics.auto.phase === 'demonstrating');
    assert.equal((await diagnostics(page)).stepId, 'dual-01-02');
    add('Usable reference with camera off repeats as unknown, without percentage or a passed result.');
    await page.click('#end-practice');
    const stopped = await diagnostics(page);
    await page.waitForTimeout(3300); d = await diagnostics(page);
    assert.equal(d.auto.phase, 'stopped'); assert.equal(d.auto.enabled, false); assert.equal(d.playing, false);
    assert.equal(d.stepId, stopped.stepId); assert.ok(Math.abs(d.frontTime - stopped.frontTime) < 0.02);
    assert.equal(await page.locator('#practice-overlay').isVisible(), false);
    add('End cancels the loop, hides its window and prevents timer-driven replay or advancement.');
    await page.click('#start-practice');
    await page.waitForFunction(() => window.__qaCaptureRequests === 1 && window.followTeacherDiagnostics.camera.phase === 'error');
    assert.equal((await diagnostics(page)).auto.results.some((entry) => entry.status === 'matched'), false);
    assert.match(await page.locator('#camera-status').textContent(), /permission/i);
    add('Start practice is the single camera permission action; explicit permission denial is visible and cannot become a match.');
    await page.close();

    const incomplete = currentPage = await newPage(browser, { fixtureMode: 'baseline-only', url: '?step=2' });
    await incomplete.click('#start-practice'); await phase(incomplete, 'feedback');
    snapshots.incomplete = await diagnostics(incomplete);
    const summary = snapshots.incomplete.auto.progress;
    assert.equal(snapshots.incomplete.stepId, 'dual-01-02');
    assert.ok(summary && Number.isFinite(summary.percent) && summary.percent >= 0 && summary.percent < 100);
    assert.ok(summary.reason && summary.reason.length > 10);
    assert.match(await incomplete.locator('#overlay-progress').textContent(), /%/);
    assert.ok((await incomplete.locator('#overlay-components li').count()) > 0);
    assert.equal(snapshots.incomplete.auto.results.length, 0);
    await label(incomplete, 'QA CONTROL FIXTURE — recorded baseline landmarks with synthetic timing; no human learner acceptance');
    await incomplete.screenshot({ path: path.join(out, 'incomplete-progress-labelled.png'), fullPage: true });
    feedbackAt = performance.now();
    await incomplete.waitForTimeout(2100);
    assert.equal((await diagnostics(incomplete)).auto.phase, 'feedback');
    await incomplete.waitForFunction(() => window.followTeacherDiagnostics.auto.round === 2 && window.followTeacherDiagnostics.auto.phase === 'demonstrating');
    assert.ok(performance.now() - feedbackAt >= 2750);
    assert.equal((await diagnostics(incomplete)).stepId, 'dual-01-02');
    add('Labelled baseline-only input produces estimated progress and reason, stays visible three seconds, then retries the same step without clicking.');
    await incomplete.evaluate(() => { window.__qaFixtureMode = 'unknown'; });
    await phase(incomplete, 'feedback'); snapshots.unknown = await diagnostics(incomplete);
    assert.ok(snapshots.unknown.auto.progress === null || snapshots.unknown.auto.progress.percent === null);
    assert.match(await incomplete.locator('#overlay-title').textContent(), /Unable to judge/i);
    assert.doesNotMatch(await incomplete.locator('#overlay-progress').textContent(), /\d+%/);
    assert.equal(snapshots.unknown.auto.results.length, 0);
    add('Missing-observation fixture resets evidence and shows Unable to judge, with no invented percentage or advancement.');
    await incomplete.click('#practice-toggle'); const feedbackPaused = await diagnostics(incomplete);
    await incomplete.waitForTimeout(3300);
    assert.equal((await diagnostics(incomplete)).auto.phase, 'feedback');
    assert.ok(Math.abs((await diagnostics(incomplete)).auto.remainingMs - feedbackPaused.auto.remainingMs) < 70);
    await incomplete.click('#end-practice'); assert.equal((await diagnostics(incomplete)).camera.running, false);
    add('Feedback timer freezes while paused; End during feedback releases its camera and prevents another round.');
    await incomplete.close();

    const matching = currentPage = await newPage(browser, { fixtureMode: 'source-motion', url: '?step=2' });
    await matching.evaluate(() => {
      window.__qaMatchEvents = []; window.__qaMatchTimer = setInterval(() => { const d = window.followTeacherDiagnostics;
        window.__qaMatchEvents.push({ atMs: performance.now(), step: d.stepId, phase: d.auto.phase, feedback: d.feedback?.status, hold: d.auto.hold, results: d.auto.results }); }, 30);
    });
    await matching.click('#start-practice');
    await matching.waitForFunction(() => window.followTeacherDiagnostics.auto.results.some((entry) => entry.stepId === 'dual-01-02' && entry.status === 'matched'));
    await ready(matching, 'dual-01-03'); snapshots.matched = await diagnostics(matching);
    const matchEvents = await matching.evaluate(() => { clearInterval(window.__qaMatchTimer); const d=window.followTeacherDiagnostics;
      window.__qaMatchEvents.push({atMs:performance.now(),step:d.stepId,phase:d.auto.phase,feedback:d.feedback?.status,hold:d.auto.hold,results:d.auto.results}); return window.__qaMatchEvents; });
    const firstMatch = matchEvents.find((event) => event.step === 'dual-01-02' && event.feedback === 'match');
    const advanced = matchEvents.find((event) => event.results.some((entry) => entry.stepId === 'dual-01-02' && entry.status === 'matched'));
    assert.ok(firstMatch, 'Actual recorded left-foot movement must match.');
    assert.ok(advanced && advanced.atMs - firstMatch.atMs >= 650, 'A single matching frame must not advance.');
    assert.deepEqual(snapshots.matched.auto.results.find((entry) => entry.stepId === 'dual-01-02'), { stepId: 'dual-01-02', status: 'matched' });
    snapshots.matchEvents = matchEvents;
    add('Actual recorded left-ankle motion with labelled synthetic timing automatically advances only after continuous fresh 700ms confirmation.');
    await matching.click('#practice-toggle');
    const mirror = await matching.evaluate(() => {
      const before = JSON.stringify(window.followTeacherDiagnostics.feedback), focus = window.followTeacherDiagnostics.focus.joints;
      const checkbox = document.getElementById('mirror-preview'); checkbox.checked = !checkbox.checked; checkbox.dispatchEvent(new Event('change'));
      return { unchanged: before === JSON.stringify(window.followTeacherDiagnostics.feedback), focus, after: window.followTeacherDiagnostics.focus.joints };
    });
    assert.equal(mirror.unchanged, true); assert.deepEqual(mirror.after, mirror.focus);
    add('Preview mirroring does not mutate computed feedback or anatomical focus in the production controller.');
    await matching.click('#end-practice'); await matching.close();

    const final = currentPage = await newPage(browser, { fixtureMode: 'target-only', url: '?form=24&step=6' });
    await final.click('#start-practice'); await phase(final, 'finished'); snapshots.final = await diagnostics(final);
    assert.equal(snapshots.final.stepId, 'dual-24-06'); assert.equal(snapshots.final.finished, true);
    assert.equal(snapshots.final.playing, false); assert.equal(snapshots.final.auto.enabled, false); assert.equal(snapshots.final.camera.running, false);
    assert.ok(snapshots.final.auto.results.some((entry) => entry.stepId === 'dual-24-06' && entry.status === 'matched'));
    add('Final actual microstep finishes automatically, pauses video, releases camera and records the match without out-of-range navigation.');
    await final.close();

    for (const viewport of [{ width: 1512, height: 1180 }, { width: 390, height: 844 }]) {
      const screen = currentPage = await newPage(browser, { denyCamera: true, viewport });
      await screen.click('#practice-toggle');
      const layout = await screen.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
        controls: ['start-practice', 'practice-toggle', 'end-practice'].map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return { id, left: r.left, right: r.right, height: r.height, width: r.width }; }) }));
      assert.ok(layout.scrollWidth <= layout.width + 1);
      assert.ok(layout.controls.every((item) => item.left >= 0 && item.right <= layout.width + 1 && item.height >= 40));
      await label(screen, 'QA SOFTWARE SCREENSHOT — no human learner acceptance');
      await screen.screenshot({ path: path.join(out, viewport.width < 500 ? 'automatic-mobile-labelled.png' : 'automatic-desktop-labelled.png'), fullPage: true });
      await screen.click('#end-practice'); await screen.click('#swap-views'); assert.equal((await diagnostics(screen)).layout.primary, 'front');
      for (const view of ['back', 'front']) { await screen.click(`#enlarge-${view}`); assert.equal((await diagnostics(screen)).layout.mode, view); await screen.click('#restore-views'); assert.equal((await diagnostics(screen)).layout.mode, 'dual'); }
      await screen.close();
    }
    add('Desktop and 390px mobile layouts have no horizontal overflow, retain large session controls, and support swap/enlarge/restore.');
    assert.deepEqual(pageErrors, []); assert.deepEqual(remoteResponses, []);
    assert.ok(!snapshots.initial.poseRequests.some((url) => /back-.*poses/.test(url)));
    add('No page exceptions or remote responses; only original front pose observations are requested.');
  } catch (error) {
    snapshots.browserFailure = await diagnostics(currentPage).catch(() => null);
    await currentPage?.screenshot({ path: path.join(out, 'browser-failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally { await browser.close(); }
}

async function realModelChecks() {
  const html = await readFile(path.join(root, 'public/follow-teacher.html'), 'utf8');
  const policy = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i)?.[1];
  assert.match(policy, /connect-src 'self'(?:;|$)/);
  const browser = await launch(['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${fixture}`]);
  const page = await browser.newPage({ viewport: { width: 1000, height: 850 } });
  page.setDefaultTimeout(45000);
  const errors = [], requests = [], blocked = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => requests.push(request.url()));
  page.on('response', (response) => { if (!response.url().startsWith(base) && !response.url().startsWith('blob:') && !response.url().startsWith('data:')) remoteResponses.push(response.url()); });
  const harnessHtml = `<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><title>Labelled original-front camera replay</title><style>body{font:16px Arial;margin:24px}#pixels{width:640px;height:360px;position:relative;background:#19382f}video,canvas{position:absolute;inset:0;width:100%;height:100%}button,select{padding:12px}</style><h1>QA: recorded front.mp4 replay, not a human learner</h1><p>Genuine local MediaPipe on seconds 8–12 plus generated black frames. Device switching and stale input are explicit control fixtures.</p><div id="pixels"><video id="video" muted playsinline></video><canvas id="overlay"></canvas></div><select id="devices"></select><button id="start">Start</button><button id="stop">Stop</button><label><input id="mirror" type="checkbox" checked>Mirror</label><label><input id="skeleton" type="checkbox" checked>Skeleton</label><p id="status"></p><script type="module" src="/qa-auto-camera-harness.js"></script></html>`;
  const harnessJs = `import {createFollowCamera} from '/follow-teacher-camera.js';window.qaStates=[];window.qaLatest=null;window.qaCamera=createFollowCamera({video:document.getElementById('video'),canvas:document.getElementById('overlay'),deviceSelect:document.getElementById('devices'),startButton:document.getElementById('start'),stopButton:document.getElementById('stop'),mirrorCheckbox:document.getElementById('mirror'),skeletonCheckbox:document.getElementById('skeleton'),statusElement:document.getElementById('status'),onObservation(value){window.qaLatest=value;},onState(value){window.qaStates.push(value);}});`;
  const state = () => page.evaluate(() => window.qaCamera.getState());
  const pose = () => page.waitForFunction(() => window.qaCamera?.getState().running && window.qaCamera.getState().hasSample);
  const pixels = () => page.locator('#overlay').evaluate((canvas) => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some((v, i) => i % 4 === 3 && v > 0));
  try {
    await page.addInitScript(() => {
      window.qaStreams = []; window.qaCaptureRequests = []; window.qaViolations = [];
      document.addEventListener('securitypolicyviolation', (event) => window.qaViolations.push({ blockedURI: event.blockedURI, directive: event.effectiveDirective }));
      const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices), enumerate = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
      navigator.mediaDevices.enumerateDevices = async () => [...await enumerate(), { kind: 'videoinput', deviceId: 'qa-second', groupId: 'qa-simulated-switch', label: 'QA second device — same recorded source' }];
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        window.qaCaptureRequests.push(structuredClone(constraints)); const actual = structuredClone(constraints);
        if (actual.video?.deviceId?.exact === 'qa-second') delete actual.video.deviceId;
        const stream = await capture(actual); window.qaStreams.push(stream); return stream;
      };
    });
    await page.route('**/qa-auto-camera-harness.html', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: harnessHtml }));
    await page.route('**/qa-auto-camera-harness.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: harnessJs }));
    await page.goto(`${base}/qa-auto-camera-harness.html`);
    await page.waitForFunction(() => !!window.qaCamera);
    assert.equal(await page.evaluate(() => window.qaCaptureRequests.length), 0);
    await page.click('#start'); await pose();
    snapshots.realModelFirst = await page.evaluate(() => ({ state: window.qaCamera.getState(), observation: window.qaLatest }));
    assert.ok(snapshots.realModelFirst.state.inferenceCount > 0);
    assert.deepEqual(snapshots.realModelFirst.observation.sample.landmarks.map((p) => p.index), [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]);
    assert.ok(requests.some((url) => url.endsWith('/models/pose_landmarker_lite.task')));
    assert.ok(requests.some((url) => /\/mediapipe\/wasm\/.*\.wasm$/.test(url)));
    assert.ok(await pixels());
    add('Genuine local MediaPipe model and WASM infer original anatomical IDs from the explicitly labelled front.mp4 camera replay.');
    await page.screenshot({ path: path.join(out, 'real-mediapipe-recorded-replay-labelled.png'), fullPage: true });
    const mirrored = await page.evaluate(() => {
      const prior = JSON.stringify(window.qaLatest); const box = document.getElementById('mirror'); box.checked = false; box.dispatchEvent(new Event('change'));
      return { same: prior === JSON.stringify(window.qaLatest), video: getComputedStyle(document.getElementById('video')).transform, overlay: getComputedStyle(document.getElementById('overlay')).transform };
    });
    assert.equal(mirrored.same, true); assert.equal(mirrored.video, 'none'); assert.equal(mirrored.overlay, 'none');
    await page.check('#mirror');
    await page.uncheck('#skeleton'); assert.equal(await pixels(), false); await page.check('#skeleton');
    add('Real camera-module preview mirroring leaves raw observations unchanged; video/skeleton mirror together and the skeleton display switch clears pixels.');
    await page.waitForFunction(() => window.qaCamera.getState().tracking === 'no_pose');
    assert.equal((await state()).hasSample, false); assert.equal(await pixels(), false); assert.equal(await page.evaluate(() => window.qaLatest), null);
    add('Generated black fixture frames produce actual MediaPipe no_pose, clearing prior samples and skeleton.');
    await pose();
    await page.locator('#video').evaluate((video) => video.pause());
    await page.waitForFunction(() => window.qaCamera.getState().tracking === 'stale');
    assert.equal((await state()).hasSample, false); assert.equal(await pixels(), false);
    await page.locator('#video').evaluate((video) => video.play()); await pose();
    add('Explicit paused-stream fault expires stale observations; the genuine inference client recovers when raw video resumes.');
    const before = (await state()).streamStarts;
    await page.selectOption('#devices', 'qa-second');
    await page.waitForFunction((count) => window.qaCamera.getState().running && window.qaCamera.getState().streamStarts > count, before);
    await pose();
    assert.ok(await page.evaluate(() => window.qaStreams[0].getTracks().every((track) => track.readyState === 'ended')));
    assert.ok(await page.evaluate(() => window.qaCaptureRequests.some((constraints) => constraints.video.deviceId?.exact === 'qa-second')));
    add('Explicit simulated second-device selection requests its ID, stops the prior actual MediaStreamTrack and initializes new real inference.');
    await page.click('#stop');
    assert.equal((await state()).running, false); assert.equal((await state()).hasSample, false); assert.equal(await pixels(), false);
    assert.ok(await page.evaluate(() => window.qaStreams.every((stream) => stream.getTracks().every((track) => track.readyState === 'ended'))));
    await page.waitForTimeout(300);
    assert.deepEqual(errors, []); assert.deepEqual(remoteResponses, []);
    blocked.push(...await page.evaluate(() => window.qaViolations));
    assert.ok(blocked.some((violation) => violation.directive === 'connect-src' && violation.blockedURI.startsWith('https://odml.pa.googleapis.com/')));
    snapshots.realModelFinal = { state: await state(), blockedTelemetry: blocked, fixtureSha256: await sha(fixture), provenance: 'Prerecorded camera replay, generated black frames and injected device-control/stale-frame faults. NOT human acceptance.' };
    add('Stop releases every actual replay stream and clears tracking; enforced production CSP blocks SDK telemetry before any remote response.');
    const production = await newPage(browser, { url: '?step=2' });
    await production.click('#start-practice');
    await production.waitForFunction(() => window.followTeacherDiagnostics.auto.results.some((entry) => entry.stepId === 'dual-01-02' && entry.status === 'matched'));
    snapshots.realModelProductionMatch = await diagnostics(production);
    assert.ok(snapshots.realModelProductionMatch.camera.inferenceCount > 0);
    assert.ok(snapshots.realModelProductionMatch.auto.results.some((entry) => entry.stepId === 'dual-01-02' && entry.status === 'matched'));
    await label(production, 'QA RECORDED CAMERA REPLAY — genuine local MediaPipe on front.mp4; NOT a human learner');
    await production.screenshot({ path: path.join(out, 'real-mediapipe-auto-advance-labelled.png'), fullPage: true });
    await production.click('#end-practice');
    assert.equal((await diagnostics(production)).camera.running, false);
    await production.close();
    add('Actual automatic-practice production page uses genuine MediaPipe on labelled prerecorded camera frames and advances the left-foot step as an observed match.');
  } finally { await browser.close(); }
}

async function mobileFeedbackChecks() {
  const browser = await launch();
  try {
    const page = await newPage(browser, { fixtureMode: 'baseline-only', url: '?step=2', viewport: { width: 390, height: 844 } });
    await page.click('#start-practice');
    await page.waitForFunction(() => window.followTeacherDiagnostics.auto.phase === 'feedback');
    const bounds = await page.evaluate(() => {
      const panel = document.querySelector('.overlay-panel'), session = document.querySelector('.session-bar');
      const p = panel.getBoundingClientRect(), s = session.getBoundingClientRect();
      return { viewport: { width: innerWidth, height: innerHeight }, scrollWidth: document.documentElement.scrollWidth,
        panel: { left: p.left, right: p.right, top: p.top, bottom: p.bottom, clientHeight: panel.clientHeight, scrollHeight: panel.scrollHeight },
        header: { top: s.top, bottom: s.bottom }, titleVisible: document.getElementById('overlay-title').getBoundingClientRect().top >= s.bottom };
    });
    snapshots.mobileFeedback = { diagnostics: await diagnostics(page), bounds };
    await label(page, 'QA RECORDED-LANDMARK CONTROL FIXTURE — not human learner acceptance');
    await page.screenshot({ path: path.join(out, 'mobile-incomplete-feedback-labelled.png'), fullPage: true });
    assert.ok(bounds.scrollWidth <= bounds.viewport.width + 1);
    assert.ok(bounds.panel.left >= 0 && bounds.panel.right <= bounds.viewport.width + 1);
    assert.ok(bounds.panel.top >= 0 && bounds.panel.bottom <= bounds.viewport.height + 1);
    assert.equal(bounds.titleVisible, true, 'Mobile feedback title must not sit behind the session controls.');
    await page.click('#end-practice');
    add('390px mobile feedback stays within the viewport and its title remains below the accessible session controls.');
  } finally { await browser.close(); }
}

let result = 'PASS', failure = null;
try {
  await staticChecks();
  if (!process.argv.includes('--static')) {
    if (process.argv.includes('--mobile')) await mobileFeedbackChecks();
    else {
      if (!process.argv.includes('--camera')) await browserChecks();
      if (!process.argv.includes('--browser')) await realModelChecks();
      if (!process.argv.includes('--camera') && !process.argv.includes('--browser')) await mobileFeedbackChecks();
    }
  }
} catch (error) { result = 'FAIL'; failure = error.stack || error.message; console.error(failure); process.exitCode = 1; }
await writeFile(path.join(out, process.argv.includes('--static') ? 'preservation-qa.json' : process.argv.includes('--mobile') ? 'mobile-feedback-qa.json' : process.argv.includes('--camera') ? 'real-mediapipe-qa.json' : 'automatic-follow-qa.json'), JSON.stringify({ result, checkedAt: new Date().toISOString(),
  provenance: 'Software checks only. Original MediaPipe landmark replay with clearly labelled synthetic control timing is separate from genuine MediaPipe prerecorded-camera inference. No physical learner acceptance was performed.',
  checks, snapshots, pageErrors, remoteResponses, failure, physicalHumanAcceptance: 'NOT PERFORMED' }, null, 2) + '\n');
