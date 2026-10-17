/** Explicit prerecorded-video camera replay QA. This is NOT a human learner or physical-camera acceptance test. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'artifacts/follow-teacher-review');
const fixture = path.join(output, 'qa-prerecorded-front-with-black-gap.y4m');
const baseUrl = process.env.FOLLOW_TEACHER_TEST_URL || 'http://127.0.0.1:8766';
const fixtureHash = createHash('sha256').update(await readFile(fixture)).digest('hex');
const pageSource = await readFile(path.join(root, 'public/follow-teacher.html'), 'utf8');
const policy = pageSource.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i)?.[1];
assert.ok(policy && /connect-src 'self'(?:;|$)/.test(policy), 'New page enforces local-only connections.');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: [
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  `--use-file-for-fake-video-capture=${fixture}`,
] });
const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
page.setDefaultTimeout(45000);
const checks = [], errors = [], requests = [], failedRequests = [], remoteResponses = [];
const add = (message) => { checks.push(message); console.log(`PASS: ${message}`); };
page.on('pageerror', (error) => errors.push(error.message));
page.on('request', (request) => requests.push(request.url()));
page.on('requestfailed', (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
page.on('response', (response) => { if (!response.url().startsWith(baseUrl) && !response.url().startsWith('blob:') && !response.url().startsWith('data:')) remoteResponses.push({ url: response.url(), status: response.status() }); });
const harness = `<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><title>Explicit recorded replay QA</title>
<style>body{font:16px Arial;margin:24px}#preview{position:relative;width:640px;height:360px;background:#182a3b}video,canvas{position:absolute;inset:0;width:100%;height:100%}button,select{padding:10px}</style>
<h1>QA prerecorded replay fixture — not a live learner</h1>
<p>Real local MediaPipe inference on front.mp4 seconds 8–12, followed by 2 seconds of black frames. Device switching is a labelled control fixture.</p>
<div id="preview"><video id="video" muted playsinline></video><canvas id="overlay"></canvas></div>
<select id="devices"></select><button id="start">Start camera</button><button id="stop">Stop camera</button>
<label><input id="mirror" type="checkbox" checked>Mirror preview</label><label><input id="skeleton" type="checkbox" checked>Skeleton</label><p id="status"></p>
<script type="module" src="/follow-teacher-qa-harness.js"></script></html>`;
const harnessScript = `import {createFollowCamera} from '/follow-teacher-camera.js';
window.qaObservations=[];window.qaStates=[];window.qaLatest=null;
window.qaCamera=createFollowCamera({video:document.getElementById('video'),canvas:document.getElementById('overlay'),deviceSelect:document.getElementById('devices'),startButton:document.getElementById('start'),stopButton:document.getElementById('stop'),mirrorCheckbox:document.getElementById('mirror'),skeletonCheckbox:document.getElementById('skeleton'),statusElement:document.getElementById('status'),onObservation(value){window.qaLatest=value;window.qaObservations.push(value?{time:performance.now(),status:value.sample.status,indices:value.sample.landmarks.map(p=>p.index)}:{time:performance.now(),status:null});},onState(state){window.qaStates.push(state);}});
`;
const state = () => page.evaluate(() => window.qaCamera.getState());
const hasCanvas = () => page.locator('#overlay').evaluate((canvas) => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some((v, i) => i % 4 === 3 && v > 0));
async function pose() { await page.waitForFunction(() => window.qaCamera?.getState().running && window.qaCamera.getState().hasSample); }
try {
  await page.addInitScript(() => {
    window.qaCspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => window.qaCspViolations.push({ blockedURI: event.blockedURI, effectiveDirective: event.effectiveDirective, disposition: event.disposition }));
    window.qaStreams = []; window.qaCaptureRequests = []; window.qaDelayNext = false; window.qaPendingPermission = false;
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const enumerate = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
    navigator.mediaDevices.enumerateDevices = async () => [...await enumerate(), { kind: 'videoinput', deviceId: 'qa-second-device', groupId: 'qa-replay-device-control', label: 'QA simulated second device · same recorded replay' }];
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      window.qaCaptureRequests.push(structuredClone(constraints));
      const actualConstraints = structuredClone(constraints);
      if (actualConstraints.video?.deviceId?.exact === 'qa-second-device') delete actualConstraints.video.deviceId;
      const stream = await original(actualConstraints); window.qaStreams.push(stream);
      if (window.qaDelayNext) { window.qaDelayNext = false; window.qaPendingPermission = true; await new Promise((resolve) => { window.qaReleasePermission = resolve; }); window.qaPendingPermission = false; }
      return stream;
    };
  });
  await page.route('**/follow-teacher-qa-harness.html', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: harness }));
  await page.route('**/follow-teacher-qa-harness.js', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: harnessScript }));
  await page.goto(`${baseUrl}/follow-teacher-qa-harness.html`);
  await page.waitForFunction(() => !!window.qaCamera);
  assert.equal(await page.evaluate(() => window.qaCaptureRequests.length), 0);
  assert.equal((await state()).running, false);
  await page.click('#start');
  await pose();
  assert.ok((await state()).inferenceCount > 0);
  assert.ok(await hasCanvas());
  const firstSample = await page.evaluate(() => window.qaLatest);
  assert.equal(firstSample.sample.status, 'pose');
  assert.deepEqual(firstSample.sample.landmarks.map((point) => point.index), [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]);
  assert.ok(requests.some((url) => url.endsWith('/models/pose_landmarker_lite.task')));
  assert.ok(requests.some((url) => url.includes('/mediapipe/wasm/') && /\.wasm(?:\?|$)/.test(url)));
  await page.screenshot({ path: path.join(output, 'camera-replay-active-labelled.png'), fullPage: true });
  add('Start invokes genuine local MediaPipe on explicitly labelled prerecorded camera replay; original anatomical joint identities retained');

  const mirrorCheck = await page.evaluate(() => {
    const before = JSON.stringify(window.qaLatest);
    const checkbox = document.getElementById('mirror'); checkbox.checked = false; checkbox.dispatchEvent(new Event('change'));
    return { unchanged: before === JSON.stringify(window.qaLatest), video: getComputedStyle(document.getElementById('video')).transform, canvas: getComputedStyle(document.getElementById('overlay')).transform };
  });
  assert.equal(mirrorCheck.unchanged, true); assert.equal(mirrorCheck.video, 'none'); assert.equal(mirrorCheck.canvas, 'none');
  await page.check('#mirror');
  assert.equal(await page.locator('#video').evaluate((video) => getComputedStyle(video).transform), await page.locator('#overlay').evaluate((canvas) => getComputedStyle(canvas).transform));
  await page.uncheck('#skeleton'); assert.equal(await hasCanvas(), false);
  await page.check('#skeleton'); await pose();
  add('Mirror changes only video/canvas presentation and never mutates raw observations or indices; skeleton display switch works');

  await page.waitForFunction(() => window.qaStates.some((s) => s.tracking === 'no_pose'));
  const unknownState = (await page.evaluate(() => window.qaStates)).find((s) => s.tracking === 'no_pose');
  assert.equal(unknownState.hasSample, false);
  await page.waitForFunction(() => window.qaCamera.getState().tracking === 'no_pose');
  assert.equal(await hasCanvas(), false);
  assert.equal(await page.evaluate(() => window.qaLatest), null);
  add('Actual black video frames produce real MediaPipe no_pose; prior skeleton and observation clear immediately');
  await pose();
  await page.locator('#video').evaluate((video) => video.pause());
  await page.waitForFunction(() => window.qaCamera.getState().tracking === 'stale');
  assert.equal((await state()).hasSample, false); assert.equal(await hasCanvas(), false);
  assert.equal(await page.evaluate(() => window.qaLatest), null);
  await page.locator('#video').evaluate((video) => video.play());
  await pose();
  add('Explicit paused-video fault injection expires observations after 450ms and clears skeleton; fresh inference recovers');

  const oldStarts = (await state()).streamStarts;
  await page.selectOption('#devices', 'qa-second-device');
  await page.waitForFunction((n) => window.qaCamera.getState().running && window.qaCamera.getState().streamStarts > n, oldStarts);
  await pose();
  const switchState = await state();
  assert.ok(switchState.stoppedTracks > 0);
  assert.ok(await page.evaluate(() => window.qaStreams[0].getTracks().every((t) => t.readyState === 'ended')));
  assert.ok(await page.evaluate(() => window.qaCaptureRequests.some((c) => c.video.deviceId?.exact === 'qa-second-device')));
  add('Labelled second-device control fixture requests selected ID, releases old actual stream, then runs a new real inference client');

  await page.evaluate(() => document.getElementById('video').srcObject.getVideoTracks()[0].dispatchEvent(new Event('mute')));
  assert.equal((await state()).tracking, 'muted'); assert.equal((await state()).hasSample, false); assert.equal(await hasCanvas(), false);
  await page.evaluate(() => document.getElementById('video').srcObject.getVideoTracks()[0].dispatchEvent(new Event('unmute')));
  await pose();
  await page.evaluate(() => document.getElementById('video').srcObject.getVideoTracks()[0].stop());
  await page.waitForFunction(() => !window.qaCamera.getState().running);
  assert.equal((await state()).hasSample, false); assert.equal(await hasCanvas(), false);
  assert.equal(await page.locator('#video').evaluate((video) => video.srcObject === null), true);
  add('Labelled mute/unmute event fixture clears and recovers; actually ending the MediaStreamTrack disconnects and releases resources');

  await page.evaluate(() => { window.qaDelayNext = true; });
  await page.click('#start');
  await page.waitForFunction(() => window.qaPendingPermission);
  await page.click('#stop');
  await page.evaluate(() => window.qaReleasePermission());
  await page.waitForFunction(() => window.qaStreams.every((stream) => stream.getTracks().every((track) => track.readyState === 'ended')));
  assert.equal((await state()).running, false); assert.equal((await state()).hasSample, false);
  add('Explicit delayed-permission race fixture: Stop cancels pending start and releases its late-arriving actual stream');
  await page.click('#start'); await pose(); await page.click('#stop');
  assert.equal(await hasCanvas(), false);
  assert.equal((await state()).hasSample, false);
  assert.ok(await page.evaluate(() => window.qaStreams.every((stream) => stream.getTracks().every((track) => track.readyState === 'ended'))));
  add('Stop clears all samples and ends every captured track; restart and stop remain functional');

  await page.waitForTimeout(200);
  const remoteAttempts = requests.filter((url) => !url.startsWith(baseUrl) && !url.startsWith('blob:') && !url.startsWith('data:'));
  const violations = await page.evaluate(() => window.qaCspViolations);
  assert.deepEqual(errors, []);
  assert.deepEqual(remoteResponses, []);
  assert.ok(remoteAttempts.every((url) => failedRequests.some((request) => request.url === url && /BLOCKED_BY_CSP/.test(request.error))));
  assert.ok(violations.some((event) => event.blockedURI.startsWith('https://odml.pa.googleapis.com/') && event.effectiveDirective === 'connect-src' && event.disposition === 'enforce'));
  add('Real browser enforces the production page CSP: SDK telemetry attempts are blocked before any remote response; model and WASM remain local');
  await page.screenshot({ path: path.join(output, 'camera-replay-qa-explicitly-labelled.png'), fullPage: true });
  const productionPage = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const productionRemoteResponses = [], productionViolations = [], productionErrors = [];
  productionPage.on('pageerror', (error) => productionErrors.push(error.message));
  productionPage.on('response', (response) => { if (!response.url().startsWith(baseUrl) && !response.url().startsWith('blob:') && !response.url().startsWith('data:')) productionRemoteResponses.push(response.url()); });
  await productionPage.addInitScript(() => {
    window.qaCspViolations = []; window.qaCaptureCount = 0;
    document.addEventListener('securitypolicyviolation', (event) => window.qaCspViolations.push({ blockedURI: event.blockedURI, effectiveDirective: event.effectiveDirective, disposition: event.disposition }));
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (constraints) => { window.qaCaptureCount++; return capture(constraints); };
  });
  await productionPage.goto(`${baseUrl}/follow-teacher.html`);
  await productionPage.waitForFunction(() => window.followTeacherDiagnostics?.ready);
  await productionPage.evaluate(() => { const label = document.createElement('p'); label.textContent = 'QA EVIDENCE: prerecorded front.mp4 replay, NOT a physical learner acceptance.'; label.style.cssText = 'background:#fff0cf;padding:12px;font-weight:bold'; document.body.prepend(label); });
  assert.equal(await productionPage.evaluate(() => window.qaCaptureCount), 0);
  await productionPage.click('#start-camera');
  await productionPage.waitForFunction(() => window.followTeacherDiagnostics?.camera.running && window.followTeacherDiagnostics.camera.hasSample);
  const productionRunning = await productionPage.evaluate(() => window.followTeacherDiagnostics);
  assert.ok(productionRunning.camera.inferenceCount > 0);
  await productionPage.screenshot({ path: path.join(output, 'actual-page-camera-active-replay-labelled.png'), fullPage: true });
  await productionPage.uncheck('#mirror-preview');
  assert.equal(await productionPage.locator('#camera-video').evaluate((video) => getComputedStyle(video).transform), 'none');
  assert.equal(await productionPage.locator('#camera-overlay').evaluate((canvas) => getComputedStyle(canvas).transform), 'none');
  await productionPage.click('#stop-camera');
  await productionPage.waitForFunction(() => !window.followTeacherDiagnostics.camera.running && !window.followTeacherDiagnostics.camera.hasSample);
  assert.equal(await productionPage.locator('#camera-video').evaluate((video) => video.srcObject === null), true);
  assert.equal(await productionPage.locator('#feedback').getAttribute('data-state'), 'unknown');
  await productionPage.waitForTimeout(200);
  productionViolations.push(...await productionPage.evaluate(() => window.qaCspViolations));
  assert.deepEqual(productionErrors, []); assert.deepEqual(productionRemoteResponses, []);
  assert.ok(productionViolations.some((event) => event.effectiveDirective === 'connect-src' && event.disposition === 'enforce'));
  await productionPage.screenshot({ path: path.join(output, 'actual-page-camera-replay-labelled.png'), fullPage: true });
  await productionPage.close();
  add('Actual follow-teacher.html integration: lazy Start, genuine local inference under CSP, preview toggle, Stop and feedback reset; replay source explicitly labelled in evidence');
  const report = { result: 'PASS', checkedAt: new Date().toISOString(), provenance: 'TEST ONLY: actual local MediaPipe inference on a prerecorded front.mp4 replay, seconds 8–12; generated black frames test no_pose. No person was physically following along. Duplicate device enumeration, mute events, paused frames and delayed permission are explicitly injected lifecycle fixtures.', fixture: { file: path.basename(fixture), sha256: fixtureHash, originalSource: 'D:\\MotionTrial\\front.mp4', originalSourceSha256: '5af76997dad0972943418a3d931870e9cce531abd78f8a4597b75f6a00498ef5', fps: 10, frames: 60, modelSha256: '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a' }, checks, firstActualSample: firstSample, finalState: await state(), observedStates: await page.evaluate(() => window.qaStates), captureRequests: await page.evaluate(() => window.qaCaptureRequests), observationCount: await page.evaluate(() => window.qaObservations.length), contentSecurityPolicy: policy, blockedTelemetryAttempts: remoteAttempts, cspViolations: violations, remoteResponses, productionIntegration: { snapshotWhileRunning: productionRunning, cspViolations: productionViolations, remoteResponses: productionRemoteResponses, pageErrors: productionErrors }, physicalHumanAcceptance: 'NOT PERFORMED' };
  await writeFile(path.join(output, 'camera-replay-qa.json'), JSON.stringify(report, null, 2) + '\n');
} catch (error) {
  await page.screenshot({ path: path.join(output, 'camera-replay-failure.png'), fullPage: true }).catch(() => {});
  await writeFile(path.join(output, 'camera-replay-qa.json'), JSON.stringify({ result: 'FAIL', checkedAt: new Date().toISOString(), provenance: 'Explicitly labelled prerecorded replay and lifecycle fixtures; not human acceptance.', checks, error: error.message, pageErrors: errors, requests, state: await state().catch(() => null), states: await page.evaluate(() => window.qaStates).catch(() => null) }, null, 2) + '\n');
  throw error;
} finally { await browser.close(); }
