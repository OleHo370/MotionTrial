import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { TeachingPlaylist, TeachingStep } from '../lib/teaching';

declare global {
  interface Window {
    __teachingQa?: {
      calls: number;
      stream?: MediaStream;
      canvas?: HTMLCanvasElement;
      allStreams: MediaStream[];
    };
  }
}

const artifactDirectory = path.resolve('artifacts/teaching-qa');
mkdirSync(artifactDirectory, { recursive: true });
const root = (page: Page) => page.locator('.teaching-page');
const reference = (page: Page) => page.getByLabel('Recorded reference movement');
const replay = (page: Page) => page.getByRole('button', { name: /^(Watch slowly|Replay step)$/ });
const nextStep = (page: Page) => page.getByRole('button', { name: /^Next step/ });

async function loadTeaching(page: Page) {
  const response = await page.request.get('/practice-media/teaching-playlist.json');
  expect(response.ok()).toBe(true);
  return await response.json() as TeachingPlaylist;
}

async function ready(page: Page) {
  await page.goto('/practice');
  await expect(root(page)).toHaveAttribute('data-step-phase', 'ready', { timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Watch slowly', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Demonstration speed')).toHaveValue('0.5');
  await expect(page.getByRole('checkbox', { name: 'Auto advance when close' })).not.toBeChecked();
}

async function watchAndWait(page: Page, step: TeachingStep) {
  await replay(page).click();
  await expect(root(page)).toHaveAttribute('data-step-phase', 'watching');
  await expect(root(page)).toHaveAttribute('data-step-phase', 'imitating', {
    timeout: (step.endSeconds - step.startSeconds) * 4_000 + 15_000,
  });
}

async function posePixels(page: Page, label: string) {
  await expect.poll(() => page.getByLabel(label).evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) return true;
    return false;
  }), { timeout: 30_000 }).toBe(true);
}

async function canvasSignature(page: Page, label: string) {
  return page.getByLabel(label).evaluate((element) => (element as HTMLCanvasElement).toDataURL());
}

async function trackCameraRequests(page: Page) {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window.__teachingQa = { calls: 0, allStreams: [] };
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      window.__teachingQa!.calls++;
      const stream = await original(constraints);
      window.__teachingQa!.stream = stream;
      window.__teachingQa!.allStreams.push(stream);
      return stream;
    };
  });
}

/** Pixels from the actual displayed source frame, with the product's real MediaPipe untouched. */
async function useLabelledRecordedFrameCamera(page: Page) {
  await page.addInitScript(() => {
    window.__teachingQa = { calls: 0, allStreams: [] };
    navigator.mediaDevices.getUserMedia = async () => {
      window.__teachingQa!.calls++;
      const source = document.querySelector<HTMLVideoElement>('video[aria-label="Recorded reference movement"]')!;
      if (!source || source.readyState < 2) throw new Error('Recorded teaching test frame is not decoded.');
      const canvas = document.createElement('canvas');
      canvas.width = source.videoWidth;
      canvas.height = source.videoHeight;
      const context = canvas.getContext('2d')!;
      const draw = () => {
        if (source.readyState >= 2) context.drawImage(source, 0, 0, canvas.width, canvas.height);
        else context.clearRect(0, 0, canvas.width, canvas.height);
      };
      draw();
      const badge = document.createElement('div');
      badge.textContent = 'BROWSER TEST: prerecorded instructor pixels in camera preview; real MediaPipe inference. No physical camera or human imitation.';
      badge.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:99999;padding:7px;background:#fff1ca;color:#122c3e;font:12px sans-serif;text-align:center';
      document.body.append(badge);
      const stream = canvas.captureStream(30);
      const timer = window.setInterval(draw, 1000 / 30);
      stream.getTracks().forEach((track) => {
        const original = track.stop.bind(track);
        track.stop = () => { clearInterval(timer); original(); };
      });
      window.__teachingQa!.stream = stream;
      window.__teachingQa!.canvas = canvas;
      window.__teachingQa!.allStreams.push(stream);
      return stream;
    };
  });
}

test('the second form has small steps; slow demonstration freezes indefinitely and fits desktop/mobile', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  testInfo.annotations.push({ type: 'provenance', description: 'Actual local manifest and recorded video. No camera requested. Demonstration plays at the actual default 0.5x speed, then pauses at the audited small-step boundary.' });
  await trackCameraRequests(page);
  const playlist = await loadTeaching(page);
  const groups = [...new Set(playlist.steps.map((step) => step.parentFormId))];
  expect(groups).toHaveLength(24);
  const second = playlist.steps.filter((step) => step.parentFormOrder === 2);
  expect(second.length).toBeGreaterThanOrEqual(12);
  await ready(page);
  await page.getByLabel('Teaching form').selectOption(String(second[0].parentFormOrder));
  await expect(root(page)).toHaveAttribute('data-step-id', second[0].id);
  await expect(root(page)).toHaveAttribute('data-step-phase', 'ready');
  await expect(page.getByRole('button', { name: /^Practice step \d+:/ })).toHaveCount(second.length);
  await expect(root(page)).toHaveAttribute('data-completed-steps', '0');
  await page.getByRole('button', { name: 'Watch slowly', exact: true }).click();
  await expect(root(page)).toHaveAttribute('data-step-phase', 'watching');
  expect(await reference(page).evaluate((element) => (element as HTMLVideoElement).playbackRate)).toBe(0.5);
  await expect.poll(() => reference(page).evaluate((element) => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(second[0].startSeconds + 0.15);
  await expect(root(page)).toHaveAttribute('data-step-phase', 'imitating', { timeout: (second[0].endSeconds - second[0].startSeconds) * 2_000 + 15_000 });
  const frozenAt = await reference(page).evaluate((element) => (element as HTMLVideoElement).currentTime);
  expect(Math.abs(frozenAt - (second[0].targetSeconds ?? second[0].endSeconds))).toBeLessThan(0.1);
  expect(await reference(page).evaluate((element) => (element as HTMLVideoElement).paused)).toBe(true);
  await page.waitForTimeout(3_200);
  await expect(root(page)).toHaveAttribute('data-step-id', second[0].id);
  await expect(root(page)).toHaveAttribute('data-step-phase', 'imitating');
  expect(await reference(page).evaluate((element) => (element as HTMLVideoElement).currentTime)).toBeCloseTo(frozenAt, 2);
  expect(await page.evaluate(() => window.__teachingQa!.calls)).toBe(0);
  await expect(nextStep(page)).toBeEnabled();
  await posePixels(page, 'Pose estimated from the reference clip');
  await page.screenshot({ path: path.join(artifactDirectory, 'second-form-small-step-desktop.png'), fullPage: true });
  const panels = await page.locator('.practice-panel').evaluateAll((elements) => elements.map((element) => ({ x: element.getBoundingClientRect().x, y: element.getBoundingClientRect().y })));
  expect(panels).toHaveLength(2);
  expect(panels[1].x).toBeGreaterThan(panels[0].x);
  expect(Math.abs(panels[1].y - panels[0].y)).toBeLessThan(2);
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileY = await page.locator('.practice-panel').evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().y));
  expect(mobileY[1]).toBeGreaterThan(mobileY[0]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: path.join(artifactDirectory, 'second-form-small-step-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await nextStep(page).click();
  await expect(root(page)).toHaveAttribute('data-step-id', second[1].id);
  await expect(root(page)).toHaveAttribute('data-completed-steps', '1');
  await page.getByRole('button', { name: 'Previous step', exact: true }).click();
  await expect(root(page)).toHaveAttribute('data-step-id', second[0].id);
  await replay(page).click();
  await expect(root(page)).toHaveAttribute('data-step-id', second[0].id);
  await expect(root(page)).toHaveAttribute('data-step-phase', 'watching');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(root(page)).toHaveAttribute('data-step-phase', 'paused');
  const pausedAt = await reference(page).evaluate((element) => (element as HTMLVideoElement).currentTime);
  await page.waitForTimeout(1_000);
  expect(await reference(page).evaluate((element) => (element as HTMLVideoElement).currentTime)).toBeCloseTo(pausedAt, 2);
});

test('every audited step can be completed manually without a camera or a matching score', async ({ page }, testInfo) => {
  test.setTimeout(600_000);
  testInfo.annotations.push({ type: 'provenance', description: 'Actual full teaching manifest and parent videos. To keep this traversal bounded, the browser seeks each real video to its audited step endpoint after Watch slowly; no poses, matcher outcomes or camera evidence are fabricated. The separate playback test verifies natural slow playback and endpoint freezing.' });
  await trackCameraRequests(page);
  const playlist = await loadTeaching(page);
  expect(playlist.steps.length).toBeGreaterThan(100);
  await ready(page);
  for (const [index, step] of playlist.steps.entries()) {
    await expect(root(page)).toHaveAttribute('data-step-id', step.id);
    await expect(root(page)).toHaveAttribute('data-step-phase', /ready|watching/, { timeout: 30_000 });
    if (await root(page).getAttribute('data-step-phase') === 'ready') await replay(page).click();
    await expect(root(page)).toHaveAttribute('data-step-phase', 'watching');
    await reference(page).evaluate((element, endSeconds) => { (element as HTMLVideoElement).currentTime = endSeconds; }, step.endSeconds);
    await expect(root(page)).toHaveAttribute('data-step-phase', 'imitating');
    await nextStep(page).click();
    await expect(root(page)).toHaveAttribute('data-completed-steps', String(index + 1));
  }
  await expect(root(page)).toHaveAttribute('data-step-phase', 'complete');
  expect(await page.evaluate(() => window.__teachingQa!.calls)).toBe(0);
  await page.screenshot({ path: path.join(artifactDirectory, 'all-small-steps-manually-complete.png'), fullPage: true });
});

test('blank camera stays unknown with optional auto; manual next remains possible and stop releases the stream', async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  testInfo.annotations.push({ type: 'provenance', description: 'Real MediaPipe receives the explicitly synthetic blank Y4M test camera from playwright.config.ts. It must remain unknown and never automatically advance. No physical-camera validation claim.' });
  await trackCameraRequests(page);
  const playlist = await loadTeaching(page);
  await ready(page);
  await page.getByRole('button', { name: 'Start camera', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop camera', exact: true })).toBeEnabled({ timeout: 45_000 });
  await page.getByRole('checkbox', { name: 'Auto advance when close' }).check();
  await watchAndWait(page, playlist.steps[0]);
  await page.waitForTimeout(3_200);
  await expect(root(page)).toHaveAttribute('data-step-id', playlist.steps[0].id);
  await expect(root(page)).toHaveAttribute('data-completed-steps', '0');
  await expect(root(page)).toHaveAttribute('data-step-phase', 'imitating');
  await expect(page.getByLabel('Pose estimated from the live camera')).toHaveCSS('opacity', '0');
  await expect(page.getByLabel('Reference skeleton aligned to your body')).toHaveCSS('opacity', '0');
  await nextStep(page).click();
  await expect(root(page)).toHaveAttribute('data-step-id', playlist.steps[1].id);
  await expect(root(page)).toHaveAttribute('data-completed-steps', '1');
  await page.getByRole('button', { name: 'Stop camera', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start camera', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.__teachingQa!.allStreams.every((stream) => stream.getTracks().every((track) => track.readyState === 'ended')))).toBe(true);
  expect(await page.getByLabel('Live camera preview').evaluate((element) => (element as HTMLVideoElement).srcObject)).toBeNull();
  await expect(page.getByLabel('Pose estimated from the live camera')).toHaveCSS('opacity', '0');
  await expect(page.getByLabel('Reference skeleton aligned to your body')).toHaveCSS('opacity', '0');
});

test('labelled prerecorded endpoint pixels pass real MediaPipe auto only after watching, guide updates and mode switch releases camera', async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  const consoleErrors: string[] = [], pageErrors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => { pageErrors.push(error.message); });
  testInfo.annotations.push({ type: 'provenance', description: 'PRERECORDED BROWSER TEST: actual displayed instructor video frames are redrawn into a labelled canvas.captureStream camera. Product MediaPipe, saved source-checked reference observations, endpoint rules and hold timing are unmodified. This proves wiring with real inference, not human imitation or physical-camera performance.' });
  await useLabelledRecordedFrameCamera(page);
  const playlist = await loadTeaching(page);
  await ready(page);
  await page.getByRole('button', { name: 'Start camera', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop camera', exact: true })).toBeEnabled({ timeout: 45_000 });
  await posePixels(page, 'Pose estimated from the live camera');
  await posePixels(page, 'Reference skeleton aligned to your body');
  const previousGuide = await canvasSignature(page, 'Reference skeleton aligned to your body');
  await page.getByRole('checkbox', { name: 'Auto advance when close' }).check();
  await page.waitForTimeout(1_200);
  await expect(root(page)).toHaveAttribute('data-step-id', playlist.steps[0].id);
  await expect(root(page)).toHaveAttribute('data-completed-steps', '0');
  await page.getByRole('button', { name: 'Watch slowly', exact: true }).click();
  await expect(root(page)).toHaveAttribute('data-step-phase', 'watching');
  await expect(root(page)).toHaveAttribute('data-completed-steps', '0');
  await expect(root(page)).toHaveAttribute('data-step-id', playlist.steps[1].id, {
    timeout: (playlist.steps[0].endSeconds - playlist.steps[0].startSeconds) * 2_000 + 25_000,
  });
  await expect(root(page)).toHaveAttribute('data-completed-steps', '1');
  await page.getByRole('checkbox', { name: 'Auto advance when close' }).uncheck();
  await expect(root(page)).toHaveAttribute('data-step-phase', 'imitating', {
    timeout: (playlist.steps[1].endSeconds - playlist.steps[1].startSeconds) * 2_000 + 15_000,
  });
  await page.waitForTimeout(1_200);
  await expect(root(page)).toHaveAttribute('data-step-id', playlist.steps[1].id);
  await posePixels(page, 'Pose estimated from the live camera');
  await posePixels(page, 'Reference skeleton aligned to your body');
  expect(await canvasSignature(page, 'Reference skeleton aligned to your body')).not.toBe(previousGuide);
  await page.screenshot({ path: path.join(artifactDirectory, 'labelled-recorded-camera-both-skeletons-endpoint.png'), fullPage: true });
  await page.getByRole('button', { name: 'Whole-form practice', exact: true }).click();
  await expect(root(page)).toHaveCount(0);
  await expect(page.locator('.practice-page')).toBeVisible();
  expect(await page.evaluate(() => window.__teachingQa!.allStreams.every((stream) => stream.getTracks().every((track) => track.readyState === 'ended')))).toBe(true);
  expect(await page.evaluate(() => window.__teachingQa!.calls)).toBe(1);
  await page.getByRole('button', { name: 'Step-by-step learning', exact: true }).click();
  await expect(root(page)).toHaveAttribute('data-step-phase', 'ready', { timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Start camera', exact: true })).toBeEnabled();
  const diagnostics = JSON.stringify({ consoleErrors, pageErrors }, null, 2);
  writeFileSync(path.join(artifactDirectory, 'actual-browser-diagnostics.json'), diagnostics);
  await testInfo.attach('actual-browser-diagnostics', { body: diagnostics, contentType: 'application/json' });
  expect(pageErrors, 'The recorded-camera fixture must not hide product runtime errors.').toEqual([]);
});
