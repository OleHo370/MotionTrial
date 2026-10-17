import { expect, test, type Page } from '@playwright/test';
import { INSTRUCTIONS, MODEL_VERSION, type Session } from '../lib/types';

// Chromium's configured virtual device supplies generated neutral Y4M frames,
// NOT a person or a physical camera. The actual local MediaPipe
// model still executes. Every saved test recording is explicitly synthetic.
const savedIds: string[] = [];

async function openSetup(page: Page, code: string) {
  await page.goto('/assess/new');
  await page.getByLabel('Pseudonymous demo code').fill(code);
  await page.getByRole('checkbox', { name: /I consent to recording/ }).check();
  await page.getByRole('button', { name: 'Continue to camera setup' }).click();
}

async function readyForSyntheticCapture(page: Page, code: string) {
  await openSetup(page, code);
  await page.getByLabel('Camera source').selectOption('synthetic_demo');
  await expect(page.getByRole('button', { name: 'Start 20-second recording' })).toBeEnabled({ timeout: 60_000 });
  await expect(page.getByText('Ready · local real model', { exact: true })).toBeVisible();
}

test.afterEach(async ({ request }) => {
  for (const id of savedIds.splice(0)) {
    const response = await request.delete(`/api/sessions/${id}`);
    expect(response.ok()).toBeTruthy();
  }
});

test('synthetic virtual camera: actual model, 20-second raw capture, failed upload retry and durable playback', async ({ page, request }) => {
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const submittedIds: string[] = [];
  let failFirstUpload = true;
  await page.route('**/api/sessions', async (route) => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    const body = route.request().postData() ?? '';
    const metadata = body.match(/name="metadata"\r\n\r\n([^\r\n]+)/)?.[1];
    if (metadata) submittedIds.push((JSON.parse(metadata) as { id: string }).id);
    if (failFirstUpload) { failFirstUpload = false; await route.abort('failed'); }
    else await route.continue();
  });

  await readyForSyntheticCapture(page, 'E2E-VIRTUAL-CAMERA');
  await page.getByRole('button', { name: 'Start 20-second recording' }).click();
  await expect(page.getByRole('heading', { name: 'Recording your task' })).toBeVisible();
  await page.getByLabel('Live camera preview, not mirrored').scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('capture-desktop.png') });
  await expect(page.getByRole('heading', { name: 'Your recording is ready.' })).toBeVisible({ timeout: 35_000 });
  await expect(page.getByText('Partial / interrupted recording.', { exact: false })).toHaveCount(0);
  await expect(page.getByLabel('Original recorded video')).toHaveAttribute('src', /^blob:/);

  await page.getByRole('button', { name: 'Save recording', exact: true }).click();
  await expect(page.locator('.capture-flow [role="alert"]')).toContainText('Upload failed');
  await expect(page.getByLabel('Original recorded video')).toHaveAttribute('src', /^blob:/);
  // Sidebar client navigation must not silently throw away the retry Blob.
  await page.getByRole('link', { name: 'Review workspace', exact: false }).click();
  await expect(page).toHaveURL(/\/assess\/new$/);
  await expect(page.locator('.capture-flow [role="alert"]')).toContainText('Save or discard');
  await expect(page.getByLabel('Original recorded video')).toHaveAttribute('src', /^blob:/);
  await page.getByRole('button', { name: 'Retry saving recording' }).click();
  await expect(page.getByRole('heading', { name: 'Recording saved.' })).toBeVisible({ timeout: 30_000 });
  const reviewHref = await page.getByRole('link', { name: 'Open researcher review' }).getAttribute('href');
  const id = reviewHref!.split('/').at(-1)!;
  savedIds.push(id);
  expect(submittedIds).toHaveLength(2);
  expect(new Set(submittedIds).size).toBe(1);
  expect(submittedIds[0]).toBe(id);

  const response = await request.get(`/api/sessions/${id}`);
  expect(response.ok()).toBeTruthy();
  const session = await response.json() as Session;
  const missingSamples = session.observations.filter((sample) => sample.status !== 'pose');
  const poseSamples = session.observations.filter((sample) => sample.status === 'pose');
  const statusCounts = session.observations.reduce<Record<string, number>>((counts, sample) => {
    counts[sample.status] = (counts[sample.status] ?? 0) + 1;
    return counts;
  }, {});
  // A real model can hallucinate pose on a synthetic source. Preserve
  // and report its output; do not force an invented all-no-pose expectation.
  console.info('REAL_MODEL_VIRTUAL_CAPTURE', JSON.stringify({ model: session.modelVersion, source: session.provenance, durationMs: session.durationMs, observations: session.observations.length, statusCounts, coverage: session.analysis.coverage, unknownMs: session.analysis.unknownMs, videoBytes: session.videoSize, events: session.analysis.events.map(({ type, startMs, endMs }) => ({ type, startMs, endMs })) }));
  await test.info().attach('capture-evidence', { body: Buffer.from(JSON.stringify(session, null, 2)), contentType: 'application/json' });
  expect(session.provenance).toBe('synthetic_demo');
  expect(session.modelVersion).toBe(MODEL_VERSION);
  expect(session.demoCode).toBe('E2E-VIRTUAL-CAMERA');
  expect(session.demoCase).toContain('Virtual camera · actual MediaPipe');
  expect(session.instructions).toBe(INSTRUCTIONS);
  expect(session.durationMs).toBeGreaterThanOrEqual(19_900);
  expect(session.durationMs).toBeLessThan(22_000);
  expect(session.interrupted).toBe(false);
  expect(session.videoSize).toBeGreaterThan(1_000);
  expect(session.observations.length).toBeGreaterThan(30);
  expect(missingSamples.length).toBeGreaterThan(0);
  expect(missingSamples.every((sample) => sample.landmarks.length === 0)).toBe(true);
  expect(poseSamples.every((sample) => sample.landmarks.length === 6 && sample.landmarks.every((point) => [point.x, point.y, point.z, point.visibility].every(Number.isFinite)))).toBe(true);
  expect(Number.isFinite(session.analysis.coverage)).toBe(true);
  expect(session.analysis.coverage).toBeGreaterThanOrEqual(0);
  expect(session.analysis.coverage).toBeLessThanOrEqual(1);
  expect(session.analysis.unknownMs).toBeGreaterThan(0);
  // Stale / missing tracking must never draw a previous skeleton.
  expect(pageErrors).toEqual([]);

  await page.getByRole('link', { name: 'Open researcher review' }).click();
  await expect(page).toHaveURL(new RegExp(`/sessions/${id}$`));
  await page.reload();
  const player = page.locator('video');
  await expect(player).toHaveAttribute('src', `/api/sessions/${id}/video`);
  await expect.poll(() => player.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(1);
  const playback = await player.evaluate(async (element: HTMLVideoElement) => {
    await element.play();
    const media = element as HTMLVideoElement & { captureStream?: () => MediaStream };
    return { duration: element.duration, paused: element.paused, audioTracks: media.captureStream?.().getAudioTracks().length ?? 0 };
  });
  expect(Number.isFinite(playback.duration)).toBe(true);
  expect(playback.duration).toBeGreaterThan(19);
  expect(Math.abs(playback.duration * 1000 - session.durationMs)).toBeLessThan(500);
  console.info('RAW_VIDEO_PLAYBACK', JSON.stringify({ nativeDurationSeconds: Number.isFinite(playback.duration) ? playback.duration : 'Infinity / unknown', paused: playback.paused, audioTracks: playback.audioTracks }));
  expect(playback.paused).toBe(false);
  expect(playback.audioTracks).toBe(0);
  await player.evaluate((element: HTMLVideoElement) => element.pause());
  let targetMs: number;
  if (session.analysis.events.length) {
    await page.locator('.timeline-event').first().click();
    targetMs = session.analysis.events[0].startMs;
  } else {
    targetMs = 8_000;
    await player.evaluate((element: HTMLVideoElement) => { element.currentTime = 8; });
    console.info('NO_QUALIFYING_MODEL_FLAG: This actual inference result has no sustained flag. Checking an 8-second source-video seek; deterministic marker seeking is covered by the separately labelled synthetic fixture.');
  }
  await expect.poll(() => player.evaluate((element: HTMLVideoElement, target) => Math.abs(element.currentTime * 1000 - target), targetMs)).toBeLessThan(500);
  const seekErrorMs = await player.evaluate((element: HTMLVideoElement, target) => Math.abs(element.currentTime * 1000 - target), targetMs);
  console.info('REAL_MODEL_EVENT_SEEK', JSON.stringify({ targetMs, seekErrorMs, input: 'Chromium synthetic virtual camera; physical camera alignment still pending' }));
});

test('simulated hidden-tab event keeps an interrupted partial recording with real model observations', async ({ page, request }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    const originalStart = MediaRecorder.prototype.start;
    MediaRecorder.prototype.start = function (timeslice?: number) {
      const testWindow = window as Window & { __captureEncodedBytes?: number };
      testWindow.__captureEncodedBytes = 0;
      this.addEventListener('dataavailable', (event: BlobEvent) => {
        testWindow.__captureEncodedBytes = (testWindow.__captureEncodedBytes ?? 0) + event.data.size;
      });
      // Observe genuine encoded bytes. Do not change the source, start timing,
      // recorder options or events delivered to the application.
      originalStart.call(this, timeslice);
    };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await readyForSyntheticCapture(page, 'E2E-HIDDEN-VIRTUAL');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: test.info().outputPath('camera-setup-mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // Recording compatibility is scoped to desktop Chromium. Keep this narrow
  // viewport check separate from camera acceptance, including Chrome's media
  // optimizations for an off-screen preview after mobile scrolling.
  await page.setViewportSize({ width: 1440, height: 900 });
  // Reacquire the real virtual-device stream after the mobile screenshot;
  // headless Chromium can pause an off-screen stream across viewport changes.
  await page.getByRole('button', { name: 'Back to briefing', exact: true }).click();
  await page.getByRole('button', { name: 'Continue to camera setup' }).click();
  await page.getByLabel('Camera source').selectOption('synthetic_demo');
  await expect(page.getByRole('button', { name: 'Start 20-second recording' })).toBeEnabled({ timeout: 60_000 });
  await page.getByLabel('Live camera preview, not mirrored').scrollIntoViewIfNeeded();
  const videoTime = await page.getByLabel('Live camera preview, not mirrored').evaluate((element: HTMLVideoElement) => element.currentTime);
  await expect.poll(() => page.getByLabel('Live camera preview, not mirrored').evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(videoTime);
  await page.getByRole('button', { name: 'Start 20-second recording' }).click();
  await expect(page.getByRole('heading', { name: 'Recording your task' })).toBeVisible();
  await page.getByLabel('Live camera preview, not mirrored').scrollIntoViewIfNeeded();
  await expect.poll(() => page.evaluate(() => (window as Window & { __captureEncodedBytes?: number }).__captureEncodedBytes ?? 0), {
    timeout: 7_000, message: 'The real MediaRecorder must emit encoded video bytes before the interruption signal.',
  }).toBeGreaterThan(0);
  await page.waitForTimeout(1_000); // Keep the partial interval long enough to inspect.
  // Headless tabs do not consistently change visibility on bringToFront. Inject
  // only the browser visibility signal; video and inference remain genuine.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByText('Partial / interrupted recording.', { exact: false })).toBeVisible();
  await expect(page.getByText('The browser tab was hidden during recording.', { exact: false })).toBeVisible();
  const partialPlayer = page.getByLabel('Original recorded video');
  await expect(partialPlayer).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => partialPlayer.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2);
  await page.getByRole('button', { name: 'Save recording', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Recording saved.' })).toBeVisible();
  const reviewHref = await page.getByRole('link', { name: 'Open researcher review' }).getAttribute('href');
  const id = reviewHref!.split('/').at(-1)!;
  savedIds.push(id);
  const session = await (await request.get(`/api/sessions/${id}`)).json() as Session;
  expect(session.provenance).toBe('synthetic_demo');
  expect(session.interrupted).toBe(true);
  expect(session.durationMs).toBeLessThan(10_000);
  expect(session.durationMs).toBeGreaterThan(1_000);
  expect(session.interruptionReason).toContain('hidden');
  expect(session.analysis.events.some((event) => event.type === 'recording_interrupted')).toBe(true);
  console.info('HIDDEN_PARTIAL_CAPTURE', JSON.stringify({ durationMs: session.durationMs, observations: session.observations.length, interrupted: session.interrupted, source: session.provenance }));
});

test('injected camera denial has an actionable recovery and never enables recording', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Permission denied by test', 'NotAllowedError'); };
  });
  await openSetup(page, 'E2E-DENIED');
  await expect(page.locator('.capture-flow [role="alert"]')).toContainText('Camera access was denied');
  await expect(page.getByRole('button', { name: 'Retry camera' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start 20-second recording' })).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'Recording saved.' })).toHaveCount(0);
});

test('blocked local model gives setup command, keeps recording disabled and provides retry', async ({ page }) => {
  await page.route('**/models/pose_landmarker_lite.task', (route) => route.abort('failed'));
  await openSetup(page, 'E2E-MODEL-FAILED');
  await expect(page.locator('.capture-flow [role="alert"]')).toContainText('npm run setup:assets', { timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Retry model' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start 20-second recording' })).toBeDisabled();
});

test('unsupported recorder stays disabled with desktop browser recovery text', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: undefined }); });
  await openSetup(page, 'E2E-NO-RECORDER');
  await expect(page.getByText('Unavailable. Use a current desktop Chrome or Edge browser.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start 20-second recording' })).toBeDisabled();
});
