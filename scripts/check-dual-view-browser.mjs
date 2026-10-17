/** Browser QA against the actual front/back recordings and recorded observations. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const baseUrl = process.env.DUAL_VIEW_TEST_URL || 'http://127.0.0.1:8766';
const allForms = process.argv.includes('--all-forms');
const reportDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../artifacts/dual-view-review');
await mkdir(reportDirectory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1120 } });
page.setDefaultTimeout(45000);
const errors = [];
const poseRequests = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('request', (request) => { if (/\.poses\.json(?:\?|$)/.test(request.url())) poseRequests.push(new URL(request.url()).pathname); });
const readClocks = () => page.evaluate(() => ({
  front: document.getElementById('front-video').currentTime,
  back: document.getElementById('back-video').currentTime,
  frontRate: document.getElementById('front-video').playbackRate,
  backRate: document.getElementById('back-video').playbackRate,
  paused: document.getElementById('front-video').paused && document.getElementById('back-video').paused,
}));
function mapBack(form, time) {
  let index = 0;
  while (index < form.anchors.length - 2 && time >= form.anchors[index + 1].frontSeconds) index++;
  const a = form.anchors[index], b = form.anchors[index + 1];
  return a.backSeconds + (time - a.frontSeconds) * (b.backSeconds - a.backSeconds) / (b.frontSeconds - a.frontSeconds);
}
try {
  await page.addInitScript(() => {
    window.cameraRequests = 0;
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { window.cameraRequests++; throw new Error('Camera access is not part of recorded-view QA.'); };
  });
  const manifest = await (await page.request.get(`${baseUrl}/practice-media/dual-view/manifest.json`)).json();
  assert.equal(manifest.schemaVersion, 'dual-view-alignment-v1');
  await page.goto(`${baseUrl}/dual-view.html`);
  await page.waitForFunction(() => !document.getElementById('play').disabled);
  assert.equal(await page.locator('#form-select option').count(), manifest.forms.length);
  assert.deepEqual(poseRequests.sort(), [manifest.forms[0].front.poseSrc, manifest.forms[0].back.poseSrc].sort(), 'Only the current form observation pair should load.');
  let clocks = await readClocks();
  assert.ok(Math.abs(clocks.front - manifest.forms[0].front.startSeconds) < 0.05);
  assert.ok(Math.abs(clocks.back - manifest.forms[0].back.startSeconds) < 0.05);
  assert.ok(clocks.paused, 'Opening the player should leave the pair paused.');

  for (const speed of ['0.25', '0.5', '0.75', '1']) {
    await page.selectOption('#speed', speed);
    clocks = await readClocks();
    assert.equal(clocks.frontRate, Number(speed));
    assert.ok(clocks.backRate > 0);
  }
  await page.selectOption('#speed', '0.5');
  await page.click('#play');
  await page.waitForFunction(() => document.getElementById('play').textContent === 'Pause pair');
  await page.waitForTimeout(1600);
  clocks = await readClocks();
  assert.ok(clocks.front > manifest.forms[0].front.startSeconds + 0.45, 'Front playback should advance at the selected speed.');
  assert.ok(Math.abs(clocks.back - mapBack(manifest.forms[0], clocks.front)) < 0.18, 'Source clocks should follow the recorded alignment.');
  await page.click('#play');
  const paused = await readClocks();
  await page.waitForTimeout(300);
  clocks = await readClocks();
  assert.ok(clocks.paused && Math.abs(clocks.front - paused.front) < 0.04);

  await page.locator('#seek').evaluate((slider) => { slider.value = '500'; slider.dispatchEvent(new Event('input', { bubbles: true })); slider.dispatchEvent(new Event('change', { bubbles: true })); });
  const first = manifest.forms[0];
  await page.waitForFunction((expected) => Math.abs(document.getElementById('front-video').currentTime - expected) < 0.05 && !document.getElementById('back-video').seeking, (first.front.startSeconds + first.front.endSeconds) / 2);
  clocks = await readClocks();
  assert.ok(Math.abs(clocks.back - mapBack(first, clocks.front)) < 0.06);

  await page.uncheck('#skeleton');
  assert.ok(await page.locator('#front-overlay').evaluate((canvas) => !canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value)), 'Hiding skeletons should clear the overlay.');
  await page.check('#skeleton');
  const frontObservations = await (await page.request.get(`${baseUrl}${first.front.poseSrc}`)).json();
  clocks = await readClocks();
  const observed = frontObservations.samples.reduce((best, sample) => Math.abs(sample.sourceTimeSeconds - clocks.front) < Math.abs(best.sourceTimeSeconds - clocks.front) ? sample : best);
  const visible = observed.status === 'pose' ? observed.landmarks.filter((point) => Number.isFinite(point.visibility) && point.visibility >= 0.45 && (point.presence == null || point.presence >= 0.45)).length : 0;
  if (visible && Math.abs(observed.sourceTimeSeconds - clocks.front) <= 1 / frontObservations.fps) {
    assert.equal(await page.locator('#front-tracking').textContent(), `${visible}/33 points visible`, 'Only actual source-frame points meeting the confidence threshold should be reported.');
    assert.ok(await page.locator('#front-overlay').evaluate((canvas) => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value)), 'Actual visible observations should draw an overlay.');
  }

  const stepForm = manifest.forms.find((form) => form.steps?.length) || first;
  await page.selectOption('#form-select', stepForm.id);
  await page.waitForFunction(() => !document.getElementById('play').disabled);
  let step = null;
  if (stepForm.steps?.length) {
    step = stepForm.steps[0];
    await page.locator('.step-button').nth(1).click();
    await page.waitForFunction(() => !document.getElementById('play').disabled);
    clocks = await readClocks();
    assert.ok(Math.abs(clocks.front - step.front.startSeconds) < 0.05);
    assert.ok(Math.abs(clocks.back - step.back.startSeconds) < 0.05);
    assert.equal(await page.locator('.step-button[aria-pressed="true"]').count(), 1);
  }
  const chosen = step || stepForm;
  await page.locator('#seek').evaluate((slider) => { slider.value = '1000'; slider.dispatchEvent(new Event('input', { bubbles: true })); slider.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForFunction((end) => Math.abs(document.getElementById('front-video').currentTime - end) < 0.07 && !document.getElementById('back-video').seeking, chosen.front.endSeconds);
  await page.click('#replay');
  await page.waitForFunction((start) => document.getElementById('front-video').currentTime < start + 0.4 && !document.getElementById('front-video').paused, chosen.front.startSeconds);
  await page.click('#play');

  await page.locator('#seek').evaluate((slider) => { slider.value = '950'; slider.dispatchEvent(new Event('input', { bubbles: true })); slider.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(300);
  await page.selectOption('#speed', '1');
  await page.click('#play');
  await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Selection complete'), null, { timeout: 30000 });
  clocks = await readClocks();
  assert.ok(clocks.paused && Math.abs(clocks.front - chosen.front.endSeconds) < 0.07, 'The selected action should hold its own final frame.');
  assert.equal(await page.evaluate(() => window.cameraRequests), 0);
  let checkedIntervals = 0;
  if (allForms) {
    for (const form of manifest.forms) {
      await page.selectOption('#form-select', form.id);
      await page.waitForFunction(() => !document.getElementById('play').disabled);
      for (let index = 0; index < form.anchors.length - 1; index++) {
        const a = form.anchors[index], b = form.anchors[index + 1];
        const target = (a.frontSeconds + b.frontSeconds) / 2;
        const value = 1000 * (target - form.front.startSeconds) / (form.front.endSeconds - form.front.startSeconds);
        await page.locator('#seek').evaluate((slider, position) => { slider.value = String(position); slider.dispatchEvent(new Event('input', { bubbles: true })); slider.dispatchEvent(new Event('change', { bubbles: true })); }, value);
        await page.waitForFunction((time) => Math.abs(document.getElementById('front-video').currentTime - time) < 0.06 && !document.getElementById('front-video').seeking && !document.getElementById('back-video').seeking, target);
        for (const speed of ['0.25', '0.5', '0.75', '1']) {
          await page.selectOption('#speed', speed);
          const rate = await readClocks();
          const expected = Math.max(0.0625, Math.min(16, Number(speed) * (b.backSeconds - a.backSeconds) / (b.frontSeconds - a.frontSeconds)));
          assert.equal(rate.frontRate, Number(speed), `Front rate for ${form.id} interval ${index}`);
          assert.ok(Math.abs(rate.backRate - expected) < 0.001, `Supported back rate for ${form.id} interval ${index} at ${speed}×`);
        }
        checkedIntervals++;
      }
      console.log(`Verified ${form.id}: ${form.anchors.length - 1} alignment intervals at all four speeds.`);
    }
    await page.selectOption('#form-select', first.id);
    await page.waitForFunction(() => !document.getElementById('play').disabled);
    await page.selectOption('#speed', '0.5');
  }
  await page.screenshot({ path: path.join(reportDirectory, 'player-desktop.png'), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(100);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'The mobile page should fit the viewport.');
  await page.screenshot({ path: path.join(reportDirectory, 'player-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  const report = { result: 'PASS', checkedAt: new Date().toISOString(), baseUrl, forms: manifest.forms.length, allForms, checkedIntervals, observationsRequested: poseRequests.length,
    checks: ['current-form observation loading', 'source seeks', 'four playback rates', 'anchored pair playback', 'pause', 'scrub', 'overlay toggle', 'actual-frame confidence threshold', 'action selection', 'replay', 'selection end hold', 'no camera access', 'mobile layout', 'no browser exceptions'] };
  await writeFile(path.join(reportDirectory, 'browser-qa.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await writeFile(path.join(reportDirectory, 'browser-qa.json'), JSON.stringify({ result: 'FAIL', checkedAt: new Date().toISOString(), baseUrl, error: error.message, browserErrors: errors }, null, 2) + '\n');
  throw error;
} finally {
  await browser.close();
}
