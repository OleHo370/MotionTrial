/** Reproducible QA. Camera replay and device-control fixtures are explicitly labelled, never human acceptance. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'artifacts/follow-teacher-review');
const baseUrl = process.env.FOLLOW_TEACHER_TEST_URL || 'http://127.0.0.1:8766';
const oldHashes = {
  'dual-view.html': 'b0a00ead68678258793c0a553541fe6f95166c927a749946bf9e758d22f69360',
  'study-3d.html': '08f787b37cc90490620561312a6311fee3ccf428f791ad290fc34ad4d43c62fc',
};
await mkdir(output, { recursive: true });
const manifest = JSON.parse(await readFile(path.join(root, 'public/practice-media/dual-view/manifest.json')));
const cache = new Map();
const readPose = async (form) => {
  if (!cache.has(form.id)) cache.set(form.id, JSON.parse(await readFile(path.join(root, 'public', form.front.poseSrc))));
  return cache.get(form.id);
};
const hash = async (filename) => createHash('sha256').update(await readFile(path.join(root, 'public', filename))).digest('hex');
function mapBack(form, time) {
  let index = 0;
  while (index < form.anchors.length - 2 && time >= form.anchors[index + 1].frontSeconds) index++;
  const a = form.anchors[index], b = form.anchors[index + 1];
  return a.backSeconds + (time - a.frontSeconds) * (b.backSeconds - a.backSeconds) / (b.frontSeconds - a.frontSeconds);
}
async function validateData() {
  for (const [file, expected] of Object.entries(oldHashes)) assert.equal(await hash(file), expected, `${file} unchanged`);
  assert.equal(manifest.forms.length, 24);
  assert.equal(manifest.forms.reduce((sum, form) => sum + form.steps.length, 0), 172);
  const ids = new Set();
  let gaps = [], poseCount = 0, noPoseCount = 0;
  const forms = [];
  for (const [index, form] of manifest.forms.entries()) {
    assert.equal(form.formNumber, index + 1);
    assert.equal(form.anchors.length, form.steps.length + 1);
    const poses = await readPose(form);
    assert.equal(poses.view, 'front');
    assert.equal(poses.modelSha256, manifest.modelSha256);
    assert.equal(poses.sourceSha256, manifest.sources.front.sha256);
    for (const [i, step] of form.steps.entries()) {
      assert.ok(!ids.has(step.id)); ids.add(step.id);
      for (const source of ['front', 'back']) {
        assert.equal(step[source].startSeconds, form.anchors[i][`${source}Seconds`]);
        assert.equal(step[source].endSeconds, form.anchors[i + 1][`${source}Seconds`]);
        assert.ok(step[source].endSeconds > step[source].startSeconds);
      }
      for (const time of [step.front.startSeconds, (step.front.startSeconds + step.front.endSeconds) / 2, step.front.endSeconds]) {
        const phase = (time - step.front.startSeconds) / (step.front.endSeconds - step.front.startSeconds);
        assert.ok(Math.abs(mapBack(form, time) - (step.back.startSeconds + phase * (step.back.endSeconds - step.back.startSeconds))) < 1e-8);
      }
    }
    for (const sample of poses.samples) {
      if (sample.status === 'pose') {
        poseCount++;
        assert.equal(sample.landmarks.length, 33);
        assert.equal(sample.worldLandmarks.length, 33);
        assert.deepEqual(sample.landmarks.map((point) => point.index), Array.from({ length: 33 }, (_, i) => i));
      } else {
        assert.equal(sample.landmarks.length, 0, 'Missing observations are empty, without interpolation.');
        if (sample.status === 'no_pose') {
          noPoseCount++;
          if (!gaps.some((gap) => gap.formId === form.id)) gaps.push({ formId: form.id, sourceTime: sample.sourceTimeSeconds, frameIndex: sample.frameIndex });
        }
      }
    }
    forms.push({ id: form.id, steps: form.steps.length, front: form.front, back: form.back });
  }
  const report = { result: 'PASS', checkedAt: new Date().toISOString(), forms: 24, microsteps: 172, allStepIntervalsEqualOriginalAnchors: true,
    mapping: 'Existing piecewise semantic phase mapping; no equal-seconds substitution.', poseCount, noPoseCount, realFrontGaps: gaps, preservedPageHashes: oldHashes, details: forms };
  await writeFile(path.join(output, 'data-validation.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('PASS: Original 24 forms, 172 steps, all source intervals/phase anchors, actual front landmark provenance and old page hashes.');
  return report;
}

async function browserQA(dataReport) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1512, height: 1180 } });
  page.setDefaultTimeout(45000);
  const errors = [], requests = [], checks = [], failedResponses = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => requests.push(request.url()));
  page.on('response', (response) => { if (response.status() >= 400) failedResponses.push({ url: response.url(), status: response.status() }); });
  const diag = () => page.evaluate(() => window.followTeacherDiagnostics);
  const add = (message) => { checks.push(message); console.log(`PASS: ${message}`); };
  async function ready(formId, stepId) {
    await page.waitForFunction(({ formId, stepId }) => {
      const d = window.followTeacherDiagnostics;
      return d?.ready && (!formId || d.formId === formId) && (!stepId || d.stepId === stepId)
        && !document.getElementById('front-video').seeking && !document.getElementById('back-video').seeking;
    }, { formId, stepId });
  }
  async function select(form, step = form.steps[0]) {
    if ((await diag()).formId !== form.id) { await page.selectOption('#form-select', form.id); await ready(form.id); }
    if ((await diag()).stepId !== step.id) { await page.selectOption('#step-select', step.id); await ready(form.id, step.id); }
  }
  async function scrub(form, step, time) {
    await page.locator('#seek').evaluate((slider, position) => {
      slider.value = String(position);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
    }, 1000 * (time - step.front.startSeconds) / (step.front.endSeconds - step.front.startSeconds));
    await page.waitForFunction((time) => {
      const f = document.getElementById('front-video'), b = document.getElementById('back-video');
      return !f.seeking && !b.seeking && Math.abs(f.currentTime - time) < 0.035;
    }, time);
    await page.waitForTimeout(80);
    const d = await diag();
    assert.ok(Math.abs(d.backTime - mapBack(form, d.frontTime)) < 0.06, 'The back source uses phase-aligned time.');
    return d;
  }
  async function canvasMatchesActual(form) {
    const d = await diag(), poses = await readPose(form);
    const sample = poses.samples.find((s) => s.frameIndex === Math.floor(d.frontTime * poses.fps + 1e-5));
    assert.ok(sample, 'The displayed time belongs to an actual recorded source sample.');
    const pointIds = [11, 12, 15, 16, 23, 24, 27, 28];
    const pixels = await page.locator('#front-overlay').evaluate((canvas, points) => {
      const context = canvas.getContext('2d');
      return points.map((point) => {
        const x = Math.round(point.x * canvas.width), y = Math.round(point.y * canvas.height);
        if (x < 4 || y < 4 || x + 4 >= canvas.width || y + 4 >= canvas.height) return false;
        return context.getImageData(x - 4, y - 4, 9, 9).data.some((value, index) => index % 4 === 3 && value > 0);
      });
    }, sample.landmarks.filter((point) => pointIds.includes(point.index) && point.visibility >= 0.45 && (point.presence == null || point.presence >= 0.45)));
    assert.ok(pixels.length && pixels.some(Boolean), 'Recorded skeleton is drawn at original, unmirrored source coordinates before display mirroring.');
  }
  try {
    await page.addInitScript(() => {
      window.qaCameraRequests = 0;
      if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => {
        window.qaCameraRequests++;
        throw new DOMException('QA: deliberately denied camera permission.', 'NotAllowedError');
      };
    });
    await page.goto(`${baseUrl}/follow-teacher.html`);
    await ready(manifest.forms[0].id, manifest.forms[0].steps[0].id);
    assert.equal(await page.evaluate(() => window.qaCameraRequests), 0);
    assert.equal(await page.locator('#form-select option').count(), 24);
    assert.equal((await diag()).speed, 0.5);
    assert.equal((await diag()).playing, false);
    assert.equal(await page.locator('#teacher-views').getAttribute('data-primary'), 'back');
    assert.equal(await page.locator('#teacher-views').getAttribute('data-mode'), 'dual');
    assert.equal(await page.locator('#back-overlay').count(), 0);
    const transforms = await page.evaluate(() => ({
      front: getComputedStyle(document.getElementById('front-pixels')).transform,
      back: getComputedStyle(document.getElementById('back-video')).transform,
      group: document.getElementById('front-pixels').contains(document.getElementById('front-video')) && document.getElementById('front-pixels').contains(document.getElementById('front-overlay')),
    }));
    assert.match(transforms.front, /^matrix\(-1,/);
    assert.equal(transforms.back, 'none');
    assert.equal(transforms.group, true);
    await canvasMatchesActual(manifest.forms[0]);
    add('Default first microstep at 0.5×, original back primary and grouped mirrored front video/skeleton; no back overlay or permission request');

    await page.click('#swap-views');
    assert.equal(await page.locator('#teacher-views').getAttribute('data-primary'), 'front');
    for (const source of ['back', 'front']) {
      await page.click(`#enlarge-${source}`);
      assert.equal(await page.locator('#teacher-views').getAttribute('data-mode'), source);
      assert.equal(await page.locator(`#${source}-card`).isVisible(), true);
      assert.equal(await page.locator(`#${source === 'back' ? 'front' : 'back'}-card`).isVisible(), false);
      await page.click('#restore-views');
      assert.equal(await page.locator('#teacher-views').getAttribute('data-mode'), 'dual');
      assert.ok(await page.locator('#front-card').isVisible() && await page.locator('#back-card').isVisible());
    }
    await page.click('#swap-views');
    add('Swap priority, enlarge either view, restore both without changing anatomical data');

    const first = manifest.forms[0], step = first.steps[1];
    await select(first, step);
    await page.click('#play');
    await page.waitForFunction(() => window.followTeacherDiagnostics?.playing);
    const before = await diag();
    await page.waitForTimeout(900);
    let d = await diag();
    assert.ok(d.frontTime > before.frontTime + 0.2 && d.frontTime < before.frontTime + 0.8, 'Half-speed demonstration advances at approximately 0.5 source seconds per second.');
    assert.ok(Math.abs(d.backTime - mapBack(first, d.frontTime)) < 0.2);
    await page.click('#play');
    await page.waitForFunction(() => !window.followTeacherDiagnostics?.playing);
    const paused = (await diag()).frontTime;
    await page.waitForTimeout(250);
    assert.ok(Math.abs((await diag()).frontTime - paused) < 0.025);
    await scrub(first, step, 9.7);
    add('Shared half-speed playback, phase alignment, pause and action timeline');

    await select(first, first.steps[0]);
    await page.selectOption('#speed', '1');
    await page.click('#replay');
    await page.waitForFunction(() => window.followTeacherDiagnostics?.held && !window.followTeacherDiagnostics.playing);
    d = await diag();
    assert.equal(d.stepId, first.steps[0].id);
    assert.ok(d.frontTime >= 8.4 && d.frontTime <= 8.5);
    await page.waitForTimeout(1000);
    assert.equal((await diag()).stepId, first.steps[0].id);
    assert.ok(Math.abs((await diag()).frontTime - d.frontTime) < 0.025);
    await page.check('#loop');
    await page.evaluate(() => {
      window.qaLoopResets = 0; let oldTime = document.getElementById('front-video').currentTime;
      window.qaLoopObserver = setInterval(() => { const time = document.getElementById('front-video').currentTime; if (time < oldTime - 0.15) window.qaLoopResets++; oldTime = time; }, 20);
    });
    await page.click('#replay');
    await page.waitForTimeout(1900);
    assert.equal((await diag()).stepId, first.steps[0].id);
    assert.ok(await page.evaluate(() => window.qaLoopResets >= 2));
    await page.evaluate(() => clearInterval(window.qaLoopObserver));
    await page.click('#play');
    await page.uncheck('#loop');
    await page.click('#step-next');
    await ready(first.id, first.steps[1].id);
    await page.click('#step-prev');
    await ready(first.id, first.steps[0].id);
    add('Replay, unlimited held frame without auto progress, current-action loop, manual previous/next without camera');

    let checkedSteps = 0;
    for (const form of manifest.forms) {
      await select(form);
      assert.equal(await page.locator('#step-select option').count(), form.steps.length);
      for (const microstep of form.steps) {
        await select(form, microstep);
        d = await diag();
        assert.equal(d.formId, form.id); assert.equal(d.stepId, microstep.id);
        assert.ok(d.frontTime >= microstep.front.startSeconds - 0.04 && d.frontTime <= microstep.front.endSeconds);
        assert.ok(Math.abs(d.backTime - mapBack(form, d.frontTime)) < 0.06);
        checkedSteps++;
      }
    }
    assert.equal(checkedSteps, 172);
    add('All 24 forms and all 172 microsteps selectable with original source intervals and phase-aligned back time');

    const gap = dataReport.realFrontGaps[0];
    if (gap) {
      const form = manifest.forms.find((f) => f.id === gap.formId);
      const microstep = form.steps.find((s) => gap.sourceTime >= s.front.startSeconds && gap.sourceTime + 0.5 / 30 < s.front.endSeconds);
      assert.ok(microstep);
      await select(form, microstep);
      await scrub(form, microstep, gap.sourceTime + 0.5 / 30);
      assert.equal(await page.locator('#front-overlay').evaluate((canvas) => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some((v, i) => i % 4 === 3 && v > 0)), false);
      add('Actual recorded front no-pose frame clears overlay without interpolation or borrowed back points');
    }

    await select(first, first.steps[1]);
    await page.selectOption('#speed', '0.5');
    await scrub(first, first.steps[1], 10.2);
    await page.screenshot({ path: path.join(output, 'follow-teacher-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(150);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.ok(await page.locator('#front-card').isVisible() && await page.locator('#back-card').isVisible());
    await page.screenshot({ path: path.join(output, 'follow-teacher-mobile.png'), fullPage: true });
    add('Desktop and 390px phone layout fits viewport with both teaching views and controls');

    assert.equal(await page.evaluate(() => window.qaCameraRequests), 0);
    await page.click('#start-camera');
    await page.waitForFunction(() => window.qaCameraRequests === 1);
    await page.waitForFunction(() => !document.getElementById('start-camera').disabled);
    assert.match(await page.locator('#camera-status').textContent(), /denied|permission|allow|blocked/i);
    assert.equal((await diag()).camera.running, false);
    add('Camera permission requested only on Start; explicit denied-permission state preserves manual learning');
    assert.equal(requests.some((url) => /\/back-\d+\.poses\.json/.test(url)), false, 'Teaching page never loads existing back pose data.');
    assert.deepEqual(requests.filter((url) => !url.startsWith(baseUrl) && !url.startsWith('blob:') && !url.startsWith('data:')), []);
    assert.deepEqual(failedResponses, []);
    assert.deepEqual(errors, []);
    for (const [file, expected] of Object.entries(oldHashes)) assert.equal(await hash(file), expected);
    add('No back-pose fetches, remote dependencies, HTTP failures or page exceptions; old pages retain exact hashes');
    const report = { result: 'PASS', checkedAt: new Date().toISOString(), baseUrl, checkedForms: 24, checkedSteps, checks, preservedPageHashes: oldHashes, provenance: 'Existing actual recorded MediaPipe observations. Camera denial is an explicitly simulated browser permission rejection. No human follow-along acceptance.', finalSnapshot: await diag() };
    await writeFile(path.join(output, 'browser-qa.json'), JSON.stringify(report, null, 2) + '\n');
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
    await writeFile(path.join(output, 'browser-qa.json'), JSON.stringify({ result: 'FAIL', checkedAt: new Date().toISOString(), checks, error: error.message, pageErrors: errors, failedResponses, diagnostics: await diag().catch(() => null) }, null, 2) + '\n');
    throw error;
  } finally { await browser.close(); }
}

const dataReport = await validateData();
if (!process.argv.includes('--static-only')) await browserQA(dataReport);
