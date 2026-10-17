/** Browser QA of the new recorded-world-landmark 3D study page. Never uses fake poses. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'artifacts/study-3d');
const baseUrl = process.env.STUDY_3D_TEST_URL || 'http://127.0.0.1:8766';
const allForms = process.argv.includes('--all-forms');
const baseline = 'b0a00ead68678258793c0a553541fe6f95166c927a749946bf9e758d22f69360';
const originalHash = createHash('sha256').update(await readFile(path.join(root, 'public/dual-view.html'))).digest('hex');
assert.equal(originalHash, baseline, 'Existing dual-view.html must remain byte-for-byte unchanged.');
await mkdir(output, { recursive: true });
async function runMain() {
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1512, height: 1180 } });
page.setDefaultTimeout(45000);
const errors = [], requests = [], failedResponses = [], checks = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
page.on('request', (request) => requests.push(request.url()));
page.on('response', (response) => { if (response.status() >= 400) failedResponses.push({ url: response.url(), status: response.status() }); });
const diag = () => page.evaluate(() => window.study3dDiagnostics);
const addCheck = (text) => { checks.push(text); console.log(`PASS: ${text}`); };
function mapBack(form, time) {
  let index = 0;
  while (index < form.anchors.length - 2 && time >= form.anchors[index + 1].frontSeconds) index++;
  const a = form.anchors[index], b = form.anchors[index + 1];
  return a.backSeconds + (time - a.frontSeconds) * (b.backSeconds - a.backSeconds) / (b.frontSeconds - a.frontSeconds);
}
function mapFront(form, time) {
  let index = 0;
  while (index < form.anchors.length - 2 && time >= form.anchors[index + 1].backSeconds) index++;
  const a = form.anchors[index], b = form.anchors[index + 1];
  return a.frontSeconds + (time - a.backSeconds) * (b.frontSeconds - a.frontSeconds) / (b.backSeconds - a.backSeconds);
}
const dataCache = new Map();
async function dataFor(form, source) {
  const filename = form[source].poseSrc;
  if (!dataCache.has(filename)) dataCache.set(filename, JSON.parse(await readFile(path.join(root, 'public', filename))));
  return dataCache.get(filename);
}
async function ready(formId, stepId) {
  await page.waitForFunction(({ formId, stepId }) => {
    const d = window.study3dDiagnostics;
    return d?.ready && (!formId || d.formId === formId) && (stepId === undefined || d.stepId === stepId)
      && !document.getElementById('front-video').seeking && !document.getElementById('back-video').seeking;
  }, { formId, stepId });
}
async function selectForm(form) {
  await page.selectOption('#form-select', form.id);
  await ready(form.id);
}
async function scrub(form, time, selection = form) {
  const value = 1000 * (time - selection.front.startSeconds) / (selection.front.endSeconds - selection.front.startSeconds);
  await page.locator('#seek').evaluate((slider, position) => {
    slider.value = String(position);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await page.waitForFunction((time) => {
    const front = document.getElementById('front-video'), back = document.getElementById('back-video');
    return !front.seeking && !back.seeking && Math.abs(front.currentTime - time) < 0.025;
  }, time);
  await page.waitForTimeout(80);
  const d = await diag();
  assert.ok(Math.abs(d.backTime - mapBack(form, d.frontTime)) < 0.06, 'Back video should use the manifest alignment.');
  return d;
}
async function checkActualSample(form, source, snapshot) {
  const recorded = await dataFor(form, source);
  const render = snapshot.scene.views[source];
  const actual = recorded.samples.find((sample) => sample.frameIndex === render.frameIndex);
  assert.ok(actual, `${source} rendered sample must exist in its own recorded source.`);
  assert.equal(render.status, actual.status);
  const visible = (point) => point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)
    && Number.isFinite(point.visibility) && point.visibility >= 0.45
    && (point.presence == null || point.presence >= 0.45);
  const image = new Map((actual.landmarks || []).map((point) => [point.index, point]));
  const world = new Map((actual.worldLandmarks || []).map((point) => [point.index, point]));
  const expected = actual.status === 'pose' ? [...world.keys()].filter((id) => visible(world.get(id)) && visible(image.get(id))) : [];
  assert.deepEqual([...render.validIndices].sort((a, b) => a - b), expected.sort((a, b) => a - b), `${source} missing or low-confidence points must remain absent.`);
  if (actual.status !== 'pose') {
    assert.equal(render.drawnPoints, 0);
    assert.equal(render.drawnBones, 0);
    return;
  }
  const yaw = snapshot.scene.coordinateTransforms[source].yawRadians;
  const hips = [world.get(23), world.get(24)];
  assert.ok(hips.every(Boolean), 'Recorded hip points define the documented display translation.');
  const center = ['x', 'y', 'z'].map((key) => (hips[0][key] + hips[1][key]) / 2);
  for (const id of expected) {
    const p = world.get(id), x = p.x - center[0], y = -(p.y - center[1]) + 0.95, z = -(p.z - center[2]);
    const expectedPoint = [x * Math.cos(yaw) + z * Math.sin(yaw), y, -x * Math.sin(yaw) + z * Math.cos(yaw)];
    const displayed = render.points[id];
    assert.ok(displayed && expectedPoint.every((value, axis) => Math.abs(value - displayed[axis]) < 1e-6), `${source} point ${id} must retain recorded world coordinates with only the declared rigid display transform.`);
  }
  const time = source === 'front' ? snapshot.frontTime : snapshot.backTime;
  assert.ok(Math.abs(actual.sourceTimeSeconds - time) <= 1 / recorded.fps + 1e-5, `${source} uses a nearby actual recorded frame.`);
}

let finalSnapshot, checkedForms = 0, checkedSteps = 0;
try {
  await page.addInitScript(() => {
    window.cameraRequests = 0;
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { window.cameraRequests++; throw new Error('Recorded 3D study does not use the camera.'); };
  });
  const manifest = JSON.parse(await readFile(path.join(root, 'public/practice-media/dual-view/manifest.json')));
  assert.equal(manifest.forms.length, 24);
  assert.equal(manifest.forms.reduce((sum, form) => sum + form.steps.length, 0), 172);
  await page.goto(`${baseUrl}/study-3d.html`);
  await ready(manifest.forms[0].id);
  assert.equal(await page.locator('#form-select option').count(), 24);
  const initial = await diag();
  assert.ok(initial.scene.ready && !initial.scene.error, 'Three.js should create a real WebGL scene.');
  assert.ok(await page.locator('#scene-container canvas').evaluate((canvas) => !!(canvas.getContext('webgl2') || canvas.getContext('webgl'))));
  assert.equal(initial.playing, false);
  await checkActualSample(manifest.forms[0], 'front', initial);
  await checkActualSample(manifest.forms[0], 'back', initial);
  addCheck('Real WebGL scene, real independent recorded world points, explicit confidence gaps');
  const poseUrls = requests.filter((url) => /\.poses\.json(?:\?|$)/.test(url));
  assert.ok(poseUrls.length <= 4, 'Initial page should load current observations with at most one next-form preload.');
  addCheck('Observation files load by form');

  const canvas = page.locator('#scene-container canvas');
  const box = await canvas.boundingBox();
  const cameraBefore = initial.scene.cameraPosition;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const orbit = await diag();
  assert.ok(orbit.scene.cameraPosition.some((value, axis) => Math.abs(value - cameraBefore[axis]) > 0.05), 'Dragging must orbit the scene.');
  const distance = (s) => Math.hypot(...s.scene.cameraPosition.map((v, i) => v - s.scene.target[i]));
  await page.mouse.wheel(0, -350);
  await page.waitForTimeout(200);
  assert.ok(distance(await diag()) < distance(orbit) - 0.05, 'Scroll must zoom closer.');
  for (const view of ['front', 'back', 'left', 'right', 'top', 'iso']) {
    await page.click(`[data-view="${view}"]`);
    await page.waitForTimeout(120);
    assert.ok((await diag()).scene.cameraPosition.every(Number.isFinite));
  }
  await page.check('#auto-rotate');
  const spinning = await diag();
  await page.waitForTimeout(400);
  assert.notDeepEqual((await diag()).scene.cameraPosition, spinning.scene.cameraPosition);
  await page.uncheck('#auto-rotate');
  await page.click('[data-view="iso"]');
  addCheck('Drag orbit, wheel zoom, six camera presets, automatic orbit');

  for (const mode of ['front', 'back', 'both']) {
    await page.selectOption('#source-mode', mode);
    await page.waitForTimeout(80);
    const d = await diag();
    assert.equal(d.mode, mode);
    assert.equal(d.scene.mode, mode);
    for (const source of ['front', 'back']) {
      if (mode === 'both' || mode === source) assert.ok(d.scene.views[source].drawnPoints > 0, `${mode} shows the requested recorded source.`);
      else assert.equal(d.scene.views[source].drawnPoints, 0, `${mode} hides the other source.`);
    }
  }
  addCheck('Front, back, and dual-source display modes');

  await page.selectOption('#source-mode', 'front');
  await page.click('[data-view="front"]');
  await page.waitForTimeout(400);
  const elbowTarget = await page.evaluate(async () => {
    const THREE = await import('/vendor/study-3d/three.module.js');
    const d = window.study3dDiagnostics.scene, canvas = document.querySelector('#scene-container canvas');
    const rect = canvas.getBoundingClientRect(), camera = new THREE.PerspectiveCamera(39, rect.width / rect.height, 0.04, 30);
    camera.position.set(...d.cameraPosition); camera.lookAt(...d.target); camera.updateMatrixWorld();
    const projected = new THREE.Vector3(...d.views.front.points[13]).project(camera);
    return { x: rect.left + (projected.x + 1) * rect.width / 2, y: rect.top + (1 - projected.y) * rect.height / 2 };
  });
  await page.mouse.click(elbowTarget.x, elbowTarget.y);
  assert.match(await page.locator('#inspect-details').textContent(), /Left elbow.*Front source.*estimated joint angle/);
  await page.selectOption('#source-mode', 'both');
  addCheck('Visible joint picking reports actual source confidence and estimated angle');

  await page.selectOption('#speed', '0.5');
  await page.click('#play');
  await page.waitForFunction(() => window.study3dDiagnostics?.playing);
  await page.waitForTimeout(1200);
  let d = await diag();
  assert.ok(d.frontTime > initial.frontTime + 0.35 && Math.abs(d.backTime - mapBack(manifest.forms[0], d.frontTime)) < 0.18);
  await page.click('#play');
  await page.waitForFunction(() => !window.study3dDiagnostics?.playing);
  const paused = await diag();
  await page.waitForTimeout(200);
  assert.ok(Math.abs((await diag()).frontTime - paused.frontTime) < 0.025);
  await page.click('#frame-next');
  await page.waitForTimeout(160);
  const nextFrameTime = (Math.floor(paused.frontTime * 30 + 1e-5) + 1) / 30;
  assert.ok(Math.abs((await diag()).frontTime - nextFrameTime) < 0.005);
  await page.click('#frame-prev');
  await page.waitForTimeout(160);
  assert.ok(Math.abs((await diag()).frontTime - (nextFrameTime - 1 / 30)) < 0.005);
  for (const speed of ['0.25', '0.5', '0.75', '1']) {
    await page.selectOption('#speed', speed);
    assert.equal(await page.locator('#front-video').evaluate((video) => video.playbackRate), Number(speed));
    assert.ok(await page.locator('#back-video').evaluate((video) => video.playbackRate > 0));
  }
  await scrub(manifest.forms[0], 14.5);
  d = await diag();
  await checkActualSample(manifest.forms[0], 'front', d);
  await checkActualSample(manifest.forms[0], 'back', d);
  addCheck('Aligned video playback, pause, four speeds, source-frame stepping, scrub');

  const selectedForms = allForms ? manifest.forms : [manifest.forms[0], manifest.forms[11], manifest.forms[15], manifest.forms[23]];
  for (const form of selectedForms) {
    await selectForm(form);
    assert.equal(await page.locator('#step-select option').count(), form.steps.length + 1);
    const chosenSteps = allForms ? form.steps : [form.steps[0], form.steps.at(-1)];
    for (const step of chosenSteps) {
      await page.selectOption('#step-select', step.id);
      await ready(form.id, step.id);
      d = await diag();
      assert.ok(Math.abs(d.frontTime - step.front.startSeconds) < 0.04);
      assert.ok(Math.abs(d.backTime - step.back.startSeconds) < 0.05);
      checkedSteps++;
    }
    await page.selectOption('#step-select', 'whole');
    await ready(form.id);
    const middle = (form.front.startSeconds + form.front.endSeconds) / 2;
    d = await scrub(form, middle);
    await checkActualSample(form, 'front', d);
    await checkActualSample(form, 'back', d);
    checkedForms++;
    console.log(`Verified ${form.id}: ${chosenSteps.length} action boundaries and independent world-point samples.`);
  }
  addCheck(`${checkedForms} forms and ${checkedSteps} action-step source boundaries`);

  // Use real no_pose records, including a front gap where the back stream remains valid.
  for (const [form, source] of [[manifest.forms[1], 'back'], [manifest.forms[15], 'front']]) {
    await selectForm(form);
    const sourceData = await dataFor(form, source);
    const unknown = sourceData.samples.find((sample) => sample.status === 'no_pose');
    assert.ok(unknown, 'Use an actual observed tracking gap.');
    // Place the playhead inside the actual frame rather than on a floating-point boundary.
    const unknownTime = unknown.sourceTimeSeconds + 0.5 / sourceData.fps;
    const time = source === 'front' ? unknownTime : mapFront(form, unknownTime);
    d = await scrub(form, time);
    await checkActualSample(form, source, d);
    assert.equal(d.scene.views[source].drawnPoints, 0, 'An actual no_pose frame must clear that skeleton rather than borrow the other view.');
    assert.equal(d.scene.views[source].drawnBones, 0);
  }
  addCheck('Actual front/back no-pose gaps stay unknown without fusion or interpolation');

  const first = manifest.forms[0], step = first.steps[0];
  await selectForm(first);
  await page.selectOption('#step-select', step.id);
  await ready(first.id, step.id);
  await page.uncheck('#loop');
  await page.selectOption('#speed', '1');
  await page.click('#play');
  await page.waitForFunction(() => !window.study3dDiagnostics?.playing && window.study3dDiagnostics.frontTime > 8.4);
  d = await diag();
  assert.equal(d.stepId, step.id, 'Completing an action must hold its selection.');
  assert.ok(Math.abs(d.frontTime - step.front.endSeconds) < 0.06);
  const endHold = d.frontTime;
  await page.waitForTimeout(200);
  assert.ok(Math.abs((await diag()).frontTime - endHold) < 0.015);
  await page.check('#loop');
  await page.click('#replay');
  await page.waitForFunction(() => window.study3dDiagnostics?.playing && window.study3dDiagnostics.frontTime < 8.2);
  await page.waitForTimeout(650);
  d = await diag();
  assert.ok(d.playing && d.frontTime >= step.front.startSeconds && d.frontTime < step.front.endSeconds, 'Looping should remain inside the selected action.');
  await page.click('#play');
  await page.uncheck('#loop');
  await page.click('#step-next');
  await ready(first.id, first.steps[1].id);
  await page.click('#step-prev');
  await ready(first.id, first.steps[0].id);
  addCheck('Selection end hold, replay, selected-action loop, previous/next steps');

  await page.selectOption('#step-select', 'whole');
  await ready(first.id);
  await page.check('#trail');
  await page.selectOption('#speed', '0.25');
  await page.click('#play');
  await page.waitForTimeout(1100);
  await page.click('#play');
  assert.ok((await diag()).scene.views.front.trailSegments > 0, 'Trails must use actual preceding recorded wrist/ankle positions.');
  await page.uncheck('#trail');
  await page.selectOption('#speed', '0.5');
  await scrub(first, 15.4);
  await page.click('[data-view="iso"]');
  finalSnapshot = await diag();
  addCheck('Optional recorded motion trails');
  await page.screenshot({ path: path.join(output, 'study-3d-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Mobile page must fit the viewport without horizontal scrolling.');
  assert.ok(await canvas.isVisible());
  await page.screenshot({ path: path.join(output, 'study-3d-mobile.png'), fullPage: true });
  addCheck('Desktop and mobile layout');
  assert.equal(await page.evaluate(() => window.cameraRequests), 0);
  assert.deepEqual(requests.filter((url) => !url.startsWith(baseUrl) && !url.startsWith('data:') && !url.startsWith('blob:')), [], 'All scripts, modules, data, and videos load from the local server.');
  assert.deepEqual(failedResponses, []);
  assert.deepEqual(errors, []);
  assert.equal(createHash('sha256').update(await readFile(path.join(root, 'public/dual-view.html'))).digest('hex'), baseline);
  addCheck('No camera access, remote dependency requests, HTTP/browser errors; existing page unchanged');

  // Exercise the real renderer creation failure while retaining real videos/data.
  const fallbackBrowser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-webgl', '--disable-webgl2'] });
  try {
    const fallbackPage = await fallbackBrowser.newPage({ viewport: { width: 1280, height: 960 } });
    const fallbackExceptions = [];
    fallbackPage.on('pageerror', (error) => fallbackExceptions.push(error.message));
    await fallbackPage.goto(`${baseUrl}/study-3d.html`);
    await fallbackPage.waitForFunction(() => window.study3dDiagnostics?.ready && window.study3dDiagnostics.scene?.error);
    const fallbackState = await fallbackPage.evaluate(() => window.study3dDiagnostics);
    assert.equal(fallbackState.scene.ready, false);
    assert.match(await fallbackPage.locator('#scene-status').textContent(), /3D unavailable/i);
    assert.match(await fallbackPage.locator('#scene-container').textContent(), /3D rendering is unavailable/i);
    assert.equal(await fallbackPage.locator('[data-view="front"]').isDisabled(), true);
    assert.equal(await fallbackPage.locator('#play').isEnabled(), true);
    await fallbackPage.click('#play');
    await fallbackPage.waitForFunction((time) => window.study3dDiagnostics?.playing && window.study3dDiagnostics.frontTime > time + 0.15, fallbackState.frontTime);
    await fallbackPage.click('#play');
    assert.match(await fallbackPage.locator('#scene-status').textContent(), /3D unavailable/i);
    assert.deepEqual(fallbackExceptions, []);
    await fallbackPage.screenshot({ path: path.join(output, 'study-3d-webgl-fallback.png'), fullPage: true });
  } finally { await fallbackBrowser.close(); }
  addCheck('Real WebGL-disabled fallback remains explicit while original videos still play');
  const report = { result: 'PASS', checkedAt: new Date().toISOString(), baseUrl, allForms, checkedForms, checkedSteps, checks, dualViewSha256: baseline, finalSnapshot };
  await writeFile(path.join(output, 'browser-qa.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, finalSnapshot: undefined }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  await writeFile(path.join(output, 'browser-qa.json'), JSON.stringify({ result: 'FAIL', checkedAt: new Date().toISOString(), baseUrl, checks, error: error.message, browserErrors: errors, failedResponses, diagnostics: await diag().catch(() => null) }, null, 2) + '\n');
  throw error;
} finally {
  await browser.close();
}
}

async function runSeekRecovery() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
  page.setDefaultTimeout(45000);
  const errors = [], mediaRanges = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let failNextObservation = true, delayMedia = false;
  await page.route('**/front-02.poses.json', async (route) => {
    if (failNextObservation) {
      failNextObservation = false;
      await route.fulfill({ status: 503, contentType: 'text/plain', body: 'Temporary local observation service unavailable (QA).' });
    } else await route.continue();
  });
  await page.route('**/dual-*-source.mp4', async (route) => {
    mediaRanges.push({ url: route.request().url(), range: route.request().headers().range || null, delayed: delayMedia });
    if (delayMedia) await new Promise((resolve) => setTimeout(resolve, 350));
    await route.continue();
  });
  try {
    await page.goto(`${baseUrl}/study-3d.html`);
    await page.waitForFunction(() => window.study3dDiagnostics?.ready && window.study3dDiagnostics?.scene.ready);
    await page.selectOption('#form-select', 'dual-02');
    await page.waitForFunction(() => !document.getElementById('load-error').hidden);
    assert.match(await page.locator('#load-error-message').textContent(), /HTTP 503/);
    assert.equal(await page.locator('#play').isDisabled(), true);
    const failed = await page.evaluate(() => window.study3dDiagnostics);
    assert.equal(failed.sampleFrames.front, null);
    assert.equal(failed.scene.views.front.drawnPoints, 0);
    await page.screenshot({ path: path.join(output, 'study-3d-load-failure.png'), fullPage: true });
    await page.click('#retry');
    await page.waitForFunction(() => window.study3dDiagnostics?.ready && window.study3dDiagnostics.formId === 'dual-02');
    assert.equal(await page.locator('#load-error').isHidden(), true);
    assert.equal(await page.locator('#play').isEnabled(), true);
    await page.evaluate(() => {
      window.observedSeeking = [];
      for (const source of ['front', 'back']) {
        const video = document.getElementById(source + '-video');
        video.addEventListener('seeking', () => {
          const inspect = () => {
            if (!video.seeking) return;
            const d = window.study3dDiagnostics;
            const canvas = document.getElementById(source + '-overlay');
            const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
            window.observedSeeking.push({ source, time: video.currentTime, frame: d.sampleFrames[source],
              drawnPoints: d.scene.views[source].drawnPoints, hasOverlay: pixels.some((value, index) => index % 4 === 3 && value > 0) });
            requestAnimationFrame(inspect);
          };
          requestAnimationFrame(inspect);
        });
      }
    });
    delayMedia = true;
    for (const value of [950, 50, 850, 150, 700, 300]) {
      await page.locator('#seek').evaluate((slider, position) => {
        slider.value = String(position);
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        slider.dispatchEvent(new Event('change', { bubbles: true }));
      }, value);
      await page.waitForFunction(() => !document.getElementById('front-video').seeking && !document.getElementById('back-video').seeking);
      await page.waitForTimeout(50);
    }
    const observations = await page.evaluate(() => window.observedSeeking);
    assert.ok(observations.length > 0, 'Capture at least one real source decode/seek interval.');
    assert.ok(observations.every((sample) => sample.frame === null && sample.drawnPoints === 0 && !sample.hasOverlay), '2D and 3D observations must stay empty while the corresponding source pixels are seeking.');
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(output, 'study-3d-load-recovered.png'), fullPage: true });
    const report = { result: 'PASS', checkedAt: new Date().toISOString(), baseUrl, checks: ['Actual HTTP 503 observation failure shown with controls disabled', 'Retry fetches actual source JSON and restores playback', '2D and 3D clear throughout observed source seek/decode intervals'], observations, mediaRanges };
    await writeFile(path.join(output, 'seek-recovery-qa.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ ...report, observations: observations.length }, null, 2));
  } catch (error) {
    await writeFile(path.join(output, 'seek-recovery-qa.json'), JSON.stringify({ result: 'FAIL', checkedAt: new Date().toISOString(), error: error.message, browserErrors: errors, mediaRanges, observations: await page.evaluate(() => window.observedSeeking || []).catch(() => []) }, null, 2) + '\n');
    throw error;
  } finally { await browser.close(); }
}

if (process.argv.includes('--seek-recovery-only')) await runSeekRecovery();
else await runMain();
