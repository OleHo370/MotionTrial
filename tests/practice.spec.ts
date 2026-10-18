import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __practiceQa?: {
      calls: number;
      stream?: MediaStream;
      source?: HTMLVideoElement;
      canvas?: HTMLCanvasElement;
      starts: number[];
      playedSources?: string[];
      requestedConstraints?: MediaStreamConstraints[];
    };
  }
}

interface PracticeClip { id: string; src: string; title: string; durationSeconds: number; startSeconds: number; endSeconds: number; sourcePlaybackRate?: number }
interface PracticePlaylist { id: string; title: string; clips: PracticeClip[] }

async function loadPlaylist(page: Page, source = '/practice-media/playlist.json') {
  const response = await page.request.get(source);
  expect(response.ok()).toBe(true);
  return await response.json() as PracticePlaylist;
}

async function canvasHasPose(page: Page, label: string) {
  await expect.poll(() => page.getByLabel(label).evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) return true;
    return false;
  }), { timeout: 30_000, message: `Actual pose pixels should appear on ${label}.` }).toBe(true);
}

async function referenceReady(page: Page, count = 24, routine = 'original24') {
  await page.goto(`/practice?routine=${encodeURIComponent(routine)}`);
  await expect(page.getByRole('button', { name: 'Start camera' })).toBeEnabled({ timeout: 60_000 });
  await expect(page.getByText('Recorded video + MediaPipe', { exact: true })).toBeVisible();
  await expect(page.locator('.practice-resources')).toContainText('Reference analyzed locally');
  await canvasHasPose(page, 'Pose estimated from the reference clip');
  await expect(page.locator('.practice-page')).toHaveAttribute('data-current-movement', '1');
  await expect(page.locator('.practice-page')).toHaveAttribute('data-total-movements', String(count));
  await expect(page.getByLabel('Match tolerance')).toHaveValue('easy');
  await expect(page.getByRole('button', { name: /^Practice movement \d+:/ })).toHaveCount(count);
  return await page.getByLabel('Recorded reference movement').evaluate((element) => (element as HTMLVideoElement).duration);
}

/** Only a browser test fixture. Product inference and comparison are untouched. */
async function usePrerecordedInstructorCamera(page: Page, stationary = false) {
  await page.addInitScript((holdFirstFrame) => {
    window.__practiceQa = { calls: 0, starts: [], playedSources: [], requestedConstraints: [] };
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      window.__practiceQa!.calls++;
      window.__practiceQa!.requestedConstraints!.push(constraints ?? {});
      const reference = document.querySelector<HTMLVideoElement>('video[aria-label="Recorded reference movement"]')!;
      const source = document.createElement('video');
      source.muted = true;
      source.playsInline = true;
      source.loop = true;
      source.style.display = 'none';
      source.setAttribute('data-prerecorded-test-source', 'true');
      document.body.append(source);
      const badge = document.createElement('div');
      badge.textContent = `BROWSER TEST: right camera uses prerecorded instructor ${holdFirstFrame ? 'held at the first frame' : 'playlist videos'}; real MediaPipe inference.`;
      badge.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:99999;padding:6px;background:#fff1ca;color:#122c3e;font:12px sans-serif;text-align:center';
      document.body.append(badge);
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d')!;
      let currentUrl = '';
      let loading: Promise<void> = Promise.resolve();
      const loadReferenceSource = () => {
        const url = reference.currentSrc || reference.src;
        if (!url || url === currentUrl) return loading;
        currentUrl = url;
        source.pause();
        context.clearRect(0, 0, canvas.width, canvas.height);
        source.src = url;
        source.load();
        loading = new Promise<void>((resolve, reject) => {
          source.addEventListener('loadeddata', () => resolve(), { once: true });
          source.addEventListener('error', () => reject(new Error('The prerecorded browser test source could not load.')), { once: true });
        }).then(async () => {
          if (holdFirstFrame) {
            // loadeddata alone may leave a paused video without a composited
            // image for drawImage. Decode a displayed frame, then seek to zero.
            const decoded = new Promise<void>((resolve) => source.requestVideoFrameCallback(() => resolve()));
            await source.play();
            await decoded;
            source.pause();
            if (source.currentTime !== 0) {
              const sought = new Promise<void>((resolve) => source.addEventListener('seeked', () => resolve(), { once: true }));
              source.currentTime = 0;
              await sought;
            }
          }
          canvas.width = source.videoWidth;
          canvas.height = source.videoHeight;
          context.drawImage(source, 0, 0);
          if (!holdFirstFrame) await source.play();
        });
        return loading;
      };
      await loadReferenceSource();
      // One camera stream survives all playlist changes. Its pixels, never pose
      // coordinates, are supplied to the product's unmodified MediaPipe client.
      const stream = canvas.captureStream(30);
      const redraw = window.setInterval(() => {
        if (source.readyState >= 2) context.drawImage(source, 0, 0, canvas.width, canvas.height);
        else context.clearRect(0, 0, canvas.width, canvas.height);
      }, 1000 / 30);
      const sourceChanged = () => { void loadReferenceSource(); };
      const referencePlayed = (event: Event) => {
        if (event.target !== reference) return;
        void loadReferenceSource().then(() => {
          if (!holdFirstFrame) { source.currentTime = 0; void source.play(); }
          window.__practiceQa!.starts.push(performance.now());
          window.__practiceQa!.playedSources!.push(currentUrl);
        });
      };
      reference.addEventListener('loadstart', sourceChanged);
      reference.addEventListener('play', referencePlayed);
      stream.getTracks().forEach((track) => {
        const stop = track.stop.bind(track);
        track.stop = () => {
          clearInterval(redraw); source.pause();
          reference.removeEventListener('loadstart', sourceChanged);
          reference.removeEventListener('play', referencePlayed);
          stop();
        };
      });
      window.__practiceQa!.source = source;
      window.__practiceQa!.canvas = canvas;
      window.__practiceQa!.stream = stream;
      return stream;
    };
  }, stationary);
}

test('real reference + neutral test camera: unknown repeats, pause cancels, stop releases, mobile fits', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'provenance', description: 'Real MediaPipe reference inference. Camera is the explicitly synthetic, blank Y4M fixture from config/playwright.config.ts; no physical-camera claim.' });
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window.__practiceQa = { calls: 0, starts: [] };
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      window.__practiceQa!.calls++;
      const stream = await original(constraints);
      window.__practiceQa!.stream = stream;
      return stream;
    };
  });
  const duration = await referenceReady(page);
  test.setTimeout(Math.max(90_000, duration * 2_000 + 70_000));
  expect(await page.evaluate(() => window.__practiceQa!.calls)).toBe(0);
  const reference = page.getByLabel('Recorded reference movement');
  await page.getByRole('button', { name: 'Preview reference' }).click();
  await expect.poll(() => reference.evaluate((element) => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(0.3);
  await page.getByRole('button', { name: 'Pause preview' }).click();
  expect(await reference.evaluate((element) => (element as HTMLVideoElement).paused)).toBe(true);

  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect(page.getByRole('button', { name: 'Start practice' })).toBeEnabled({ timeout: 45_000 });
  await expect(page.getByText('Unknown / partial · 0/12 joints', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Pose estimated from the live camera')).toHaveCSS('opacity', '0');
  await expect(page.getByLabel('Reference skeleton aligned to your body')).toHaveCSS('opacity', '0');
  await page.getByRole('button', { name: 'Start practice' }).click();
  await expect(page.getByRole('status')).toContainText('Attempt 1', { timeout: 10_000 });
  await expect(page.getByRole('status')).toContainText('Tracking was incomplete', { timeout: duration * 1_000 + 10_000 });
  await expect(page.getByRole('status')).toContainText('Tracked time: 0%');
  await expect(page.getByRole('status')).toContainText('The same clip will repeat automatically.');
  await expect(page.getByRole('status')).toContainText('Attempt 2', { timeout: 10_000 });
  await expect(page.locator('.practice-page')).toHaveAttribute('data-current-movement', '1');
  await expect(page.locator('.practice-sequence [data-state="passed"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Practice paused');
  const pausedAt = await reference.evaluate((element) => (element as HTMLVideoElement).currentTime);
  await page.waitForTimeout(4_200); // Longer than the retry countdown: a cancelled loop must stay paused.
  expect(await reference.evaluate((element) => (element as HTMLVideoElement).currentTime)).toBeCloseTo(pausedAt, 2);
  await expect(page.getByRole('status')).toContainText('Practice paused');
  await page.getByRole('button', { name: /^Practice movement 24:/ }).click();
  await expect(page.locator('.practice-page')).toHaveAttribute('data-current-movement', '24');
  await expect(page.locator('.practice-sequence [data-state="passed"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__practiceQa!.calls)).toBe(1);
  await page.getByRole('button', { name: 'Stop camera' }).click();
  await expect(page.getByText('Camera off', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Reference skeleton aligned to your body')).toHaveCSS('opacity', '0');
  expect(await page.evaluate(() => window.__practiceQa!.stream!.getTracks().every((track) => track.readyState === 'ended'))).toBe(true);
  expect(await page.getByLabel('Live camera preview').evaluate((element) => (element as HTMLVideoElement).srcObject === null)).toBe(true);

  const desktopPanels = await page.locator('.practice-panel').evaluateAll((elements) => elements.map((element) => ({ x: element.getBoundingClientRect().x, y: element.getBoundingClientRect().y })));
  expect(desktopPanels[1].x).toBeGreaterThan(desktopPanels[0].x);
  expect(Math.abs(desktopPanels[1].y - desktopPanels[0].y)).toBeLessThan(2);
  await page.setViewportSize({ width: 390, height: 844 });
  const mobilePanels = await page.locator('.practice-panel').evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().y));
  expect(mobilePanels[1]).toBeGreaterThan(mobilePanels[0]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath('practice-mobile.png'), fullPage: true });
});

test('an invalid reference cache falls back to real inference, and denied camera permission can recover', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'provenance', description: 'Only the saved reference model-hash metadata is corrupted to exercise actual MediaPipe fallback; no landmarks are fabricated. The first camera permission request is intentionally rejected; retry uses the blank virtual camera, not a physical device.' });
  let invalidCaches = 0;
  let referenceModelRequests = 0;
  page.on('request', (request) => { if (new URL(request.url()).pathname === '/models/pose_landmarker_lite.task') referenceModelRequests++; });
  await page.route('**/practice-media/24-01.poses.json', async (route) => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    const observations = await response.json();
    invalidCaches++;
    await route.fulfill({ json: { ...observations, modelSha256: 'deliberately-invalid-browser-test-metadata' } });
  });
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    let calls = 0;
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (++calls === 1) throw new DOMException('Permission denied by the browser test', 'NotAllowedError');
      return original(constraints);
    };
  });
  await referenceReady(page);
  expect(invalidCaches).toBe(1);
  // No camera has been requested yet, so these model bytes were used for the
  // actual reference fallback rather than silently trusting the invalid cache.
  expect(referenceModelRequests).toBeGreaterThan(0);
  await page.getByLabel('Match tolerance').selectOption('standard');
  await page.getByRole('button', { name: /^Practice movement 2:/ }).click();
  await expect(page.locator('.practice-resources')).toContainText('Reference analyzed locally');
  await expect(page.getByLabel('Match tolerance')).toHaveValue('easy');
  await expect(page.getByLabel('Match tolerance').locator('option[value="standard"]')).toHaveJSProperty('disabled', true);
  await expect(page.locator('.practice-error[role="alert"]')).toContainText('Relaxed mode has been selected for this form.');
  await expect(page.locator('.practice-sequence [data-state="passed"]')).toHaveCount(0);
  await page.getByRole('button', { name: /^Practice movement 1:/ }).click();
  await expect(page.getByRole('button', { name: 'Start camera' })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('practice-desktop-1440x900.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('practice-mobile-390x844.png') });
  await page.screenshot({ path: testInfo.outputPath('practice-mobile-full.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect(page.locator('.practice-error[role="alert"]')).toContainText('Camera permission was denied.');
  await expect(page.getByRole('button', { name: 'Start camera' })).toBeEnabled();
  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect(page.getByRole('button', { name: 'Start practice' })).toBeEnabled({ timeout: 45_000 });
  await expect(page.locator('.practice-error[role="alert"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Stop camera' }).click();
  await expect(page.getByText('Camera off', { exact: true })).toBeVisible();
});

test('a labelled prerecorded camera matches and advances through the first three actual-duration movements with real MediaPipe', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'provenance', description: 'PRERECORDED TEST SOURCE: first three instructor clips decoded to one persistent canvas.captureStream virtual camera. The playlist response is shortened only for this integration test. Actual video pixels, MediaPipe inference, comparison, durations and auto advancement are unmodified. This is not human imitation or physical-camera validation.' });
  const source = await loadPlaylist(page);
  expect(source.clips).toHaveLength(24);
  expect(new Set(source.clips.map((clip) => clip.durationSeconds)).size).toBeGreaterThan(3);
  for (const clip of source.clips) {
    expect(clip.durationSeconds).toBeGreaterThan(0);
    expect(Math.abs(clip.durationSeconds - (clip.endSeconds - clip.startSeconds))).toBeLessThan(0.15);
    expect(clip.sourcePlaybackRate ?? 1).toBe(1);
  }
  const playlist = { ...source, clips: source.clips.slice(0, 3) };
  test.setTimeout(Math.max(240_000, playlist.clips.reduce((sum, clip) => sum + clip.durationSeconds, 0) * 4_000 + 90_000));
  await page.route('**/practice-media/playlist.json', (route) => route.fulfill({ json: playlist }));
  await usePrerecordedInstructorCamera(page);
  await referenceReady(page, 3);
  expect(await page.evaluate(() => window.__practiceQa!.calls)).toBe(0);
  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect(page.getByRole('button', { name: 'Start practice' })).toBeEnabled({ timeout: 45_000 });
  await expect(page.getByRole('region', { name: 'Your camera' }).getByText('Body pose tracked', { exact: true })).toBeVisible({ timeout: 15_000 });
  const guideToggle = page.getByRole('checkbox', { name: 'Show instructor guide' });
  await expect(guideToggle).toBeChecked();
  await canvasHasPose(page, 'Reference skeleton aligned to your body');
  await guideToggle.uncheck();
  await expect(page.getByLabel('Reference skeleton aligned to your body')).toHaveCSS('opacity', '0');
  await guideToggle.check();
  await canvasHasPose(page, 'Reference skeleton aligned to your body');
  const mirror = page.getByRole('checkbox', { name: 'Mirror preview' });
  await mirror.check();
  await expect(page.getByLabel('Live camera preview').locator('..')).toHaveCSS('transform', 'matrix(-1, 0, 0, 1, 0, 0)');
  await mirror.uncheck();
  await page.getByRole('button', { name: 'Start practice' }).click();
  for (let index = 0; index < playlist.clips.length; index++) {
    const clip = playlist.clips[index];
    await expect(page.locator('.practice-page')).toHaveAttribute('data-current-movement', String(index + 1), { timeout: 45_000 });
    await expect.poll(() => page.getByLabel('Recorded reference movement').evaluate((element) => new URL((element as HTMLVideoElement).src).pathname)).toBe(clip.src);
    await expect(page.locator('.practice-page')).toHaveAttribute('data-phase', 'practicing', { timeout: 35_000 });
    await canvasHasPose(page, 'Pose estimated from the live camera');
    await canvasHasPose(page, 'Reference skeleton aligned to your body');
    const parents = await page.getByLabel('Reference skeleton aligned to your body').evaluate((overlay) => {
      const live = document.querySelector('[aria-label="Pose estimated from the live camera"]')!;
      return { sameFrame: overlay.parentElement === live.parentElement, count: overlay.parentElement!.querySelectorAll('canvas').length };
    });
    expect(parents).toEqual({ sameFrame: true, count: 2 });
    if (index === 0) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: testInfo.outputPath('practice-labelled-both-skeletons.png') });
    }
    await expect(page.locator('.practice-sequence [data-state="passed"]')).toHaveCount(index + 1, { timeout: clip.durationSeconds * 2_000 + 20_000 });
    console.log(`Prerecorded real-model playlist: movement ${index + 1}/3 (${clip.title}) passed.`);
  }
  await expect(page.getByRole('heading', { name: 'All movements complete', exact: true })).toBeVisible();
  await page.getByText('How this prototype decides', { exact: true }).click();
  await expect(page.locator('details')).toContainText('Latest attempt: matched.');
  console.log(`Prerecorded moving instructor / real MediaPipe: ${await page.getByRole('status').innerText()}`);
  await testInfo.attach('actual-completion-status', { body: await page.getByRole('status').innerText(), contentType: 'text/plain' });
  expect(await page.evaluate(() => window.__practiceQa!.calls)).toBe(1);
  const playedPaths = await page.evaluate(() => [...new Set(window.__practiceQa!.playedSources!.map((url) => new URL(url).pathname))]);
  expect(playedPaths).toEqual(playlist.clips.map((clip) => clip.src));
  await page.screenshot({ path: testInfo.outputPath('practice-prerecorded-real-model-match.png'), fullPage: true });
  await page.getByRole('button', { name: 'Stop camera' }).click();
  expect(await page.evaluate(() => window.__practiceQa!.stream!.getTracks().every((track) => track.readyState === 'ended'))).toBe(true);
  await page.evaluate(() => window.__practiceQa!.source!.pause());
});

test('the new 24b opening matches at original speed with two real skeletons and completes automatically', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  testInfo.annotations.push({ type: 'provenance', description: 'PRERECORDED 24b TEST SOURCE: the actual 24b opening clip is decoded into the virtual camera; unmodified real MediaPipe and relaxed practice matching. The real 24b manifest is shortened to one actual-duration clip for this integration test. This does not validate physical camera capture or human imitation.' });
  const source = await loadPlaylist(page, '/practice-media/24b-playlist.json');
  expect(source.clips).toHaveLength(24);
  const clip = source.clips[0];
  expect(clip.src).toMatch(/^\/practice-media\/24b-/);
  expect(clip.sourcePlaybackRate ?? 1).toBe(1);
  expect(Math.abs(clip.durationSeconds - (clip.endSeconds - clip.startSeconds))).toBeLessThan(0.15);
  await page.route('**/practice-media/24b-playlist.json', (route) => route.fulfill({ json: { ...source, clips: [clip] } }));
  await usePrerecordedInstructorCamera(page);
  const duration = await referenceReady(page, 1, '24b');
  expect(Math.abs(duration - clip.durationSeconds)).toBeLessThan(0.15);
  await expect(page.locator('.practice-page')).toHaveAttribute('data-routine', '24b');
  expect(await page.evaluate(() => window.__practiceQa!.calls)).toBe(0);
  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect(page.getByRole('button', { name: 'Start practice' })).toBeEnabled({ timeout: 45_000 });
  await canvasHasPose(page, 'Pose estimated from the live camera');
  await canvasHasPose(page, 'Reference skeleton aligned to your body');
  await page.getByRole('button', { name: 'Start practice' }).click();
  await expect(page.locator('.practice-page')).toHaveAttribute('data-phase', 'practicing', { timeout: 10_000 });
  await canvasHasPose(page, 'Pose estimated from the live camera');
  await canvasHasPose(page, 'Reference skeleton aligned to your body');
  await page.screenshot({ path: testInfo.outputPath('practice-24b-labelled-both-skeletons.png'), fullPage: true });
  await expect(page.getByRole('heading', { name: 'All movements complete', exact: true })).toBeVisible({ timeout: duration * 2_000 + 20_000 });
  await expect(page.locator('.practice-sequence [data-state="passed"]')).toHaveCount(1);
  expect(await page.evaluate(() => window.__practiceQa!.calls)).toBe(1);
  const playedPaths = await page.evaluate(() => [...new Set(window.__practiceQa!.playedSources!.map((url) => new URL(url).pathname))]);
  expect(playedPaths).toEqual([clip.src]);
  await testInfo.attach('24b-actual-completion-status', { body: await page.getByRole('status').innerText(), contentType: 'text/plain' });
  await page.screenshot({ path: testInfo.outputPath('practice-24b-real-model-complete.png'), fullPage: true });
  await page.getByRole('button', { name: 'Stop camera' }).click();
  expect(await page.evaluate(() => window.__practiceQa!.stream!.getTracks().every((track) => track.readyState === 'ended'))).toBe(true);
});

test('a tracked real instructor frame held stationary repeats rather than completing', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'provenance', description: 'PRERECORDED STILL TEST SOURCE: first decoded instructor frame repeatedly drawn to canvas.captureStream. Real MediaPipe detects the stationary body; no landmarks or comparison results are mocked.' });
  await usePrerecordedInstructorCamera(page, true);
  const duration = await referenceReady(page);
  test.setTimeout(Math.max(90_000, duration * 1_000 + 70_000));
  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect(page.getByRole('button', { name: 'Start practice' })).toBeEnabled({ timeout: 45_000 });
  expect(await page.evaluate(() => window.__practiceQa!.source!.currentTime)).toBe(0);
  await expect.poll(() => page.evaluate(() => {
    const canvas = window.__practiceQa!.canvas!;
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let nonBlack = 0;
    for (let index = 0; index < pixels.length; index += 4) if (pixels[index] + pixels[index + 1] + pixels[index + 2] > 90) nonBlack++;
    return nonBlack / (canvas.width * canvas.height);
  })).toBeGreaterThan(0.5);
  await expect(page.getByRole('region', { name: 'Your camera' }).getByText('Body pose tracked', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Start practice' }).click();
  await expect(page.getByRole('status')).toContainText('Attempt 1', { timeout: 10_000 });
  await expect(page.getByRole('status')).toContainText('Let’s try that again', { timeout: duration * 1_000 + 10_000 });
  await expect(page.getByRole('status')).toContainText('The same clip will repeat automatically.');
  console.log(`Prerecorded stationary instructor / real MediaPipe: ${await page.getByRole('status').innerText()}`);
  await testInfo.attach('actual-stationary-status', { body: await page.getByRole('status').innerText(), contentType: 'text/plain' });
  await page.getByText('How this prototype decides', { exact: true }).click();
  await expect(page.locator('details')).toContainText('Latest attempt: repeat.');
  await expect(page.locator('.practice-page')).toHaveAttribute('data-current-movement', '1');
  await expect(page.locator('.practice-sequence [data-state="passed"]')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'All movements complete', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Stop camera' }).click();
});

test('camera settings control the real overlay and changing training video cancels practice without reopening the camera', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  testInfo.annotations.push({ type: 'provenance', description: 'PRERECORDED TEST SOURCE: actual instructor pixels feed the unmodified MediaPipe client. Only camera enumeration is a labeled browser-test fixture so exact device selection can be checked without physical hardware. The alternate manifest response is delayed, not changed. No pose samples, matching results, or library content are fabricated.' });
  const libraryResponse = await page.request.get('/practice-media/library.json');
  expect(libraryResponse.ok()).toBe(true);
  const library = await libraryResponse.json() as { routines: { id: string; src: string }[] };
  const alternate = library.routines.find((routine) => routine.id !== 'original24');
  expect(alternate, 'The real training library must include a previous or newly processed source.').toBeTruthy();
  await usePrerecordedInstructorCamera(page);
  await page.addInitScript(() => {
    navigator.mediaDevices.enumerateDevices = async () => [
      { deviceId: 'qa-instructor-camera', kind: 'videoinput', label: 'PRERECORDED BROWSER TEST camera', groupId: 'qa', toJSON: () => ({}) },
      { deviceId: 'qa-microphone', kind: 'audioinput', label: 'Browser test microphone', groupId: 'qa', toJSON: () => ({}) },
    ];
  });
  await referenceReady(page);
  const cameraChoice = page.getByLabel('Camera device');
  await expect(cameraChoice.locator('option[value="qa-instructor-camera"]')).toHaveCount(1);
  await expect(cameraChoice.locator('option[value="qa-microphone"]')).toHaveCount(0);
  await cameraChoice.selectOption('qa-instructor-camera');
  expect(await page.evaluate(() => window.__practiceQa!.calls)).toBe(0);
  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect(page.getByRole('button', { name: /^(Start practice|Restart movement)$/ })).toBeEnabled({ timeout: 45_000 });
  expect(await page.evaluate(() => window.__practiceQa!.requestedConstraints)).toEqual([{
    audio: false,
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, deviceId: { exact: 'qa-instructor-camera' } },
  }]);
  await canvasHasPose(page, 'Pose estimated from the live camera');
  await canvasHasPose(page, 'Reference skeleton aligned to your body');
  const ownSkeleton = page.getByRole('checkbox', { name: 'Show my skeleton' });
  await expect(ownSkeleton).toBeChecked();
  await ownSkeleton.uncheck();
  await expect(page.getByLabel('Pose estimated from the live camera')).toHaveCSS('opacity', '0');
  await canvasHasPose(page, 'Reference skeleton aligned to your body');
  await ownSkeleton.check();
  await canvasHasPose(page, 'Pose estimated from the live camera');
  await expect(page.getByLabel('Pose estimated from the live camera')).toHaveCSS('opacity', '1');
  expect(await page.evaluate(() => window.__practiceQa!.calls)).toBe(1);

  await page.getByRole('button', { name: /^(Start practice|Restart movement)$/ }).click();
  await expect(page.locator('.practice-sequence [data-state="passed"]')).toHaveCount(1, { timeout: 60_000 });
  await expect(page.locator('.practice-page')).toHaveAttribute('data-current-movement', '2', { timeout: 15_000 });
  await expect(page.locator('.practice-page')).toHaveAttribute('data-phase', 'countdown', { timeout: 15_000 });
  let releaseManifest!: () => void;
  let manifestSeen!: () => void;
  const seen = new Promise<void>((resolve) => { manifestSeen = resolve; });
  const released = new Promise<void>((resolve) => { releaseManifest = resolve; });
  await page.route(`**${alternate!.src}`, async (route) => {
    manifestSeen(); await released; await route.continue();
  });
  try {
    await page.getByLabel('Training video').selectOption(alternate!.id);
    await seen;
    await expect(page.locator('.practice-page')).toHaveAttribute('data-routine', alternate!.id);
    await expect(page.locator('.practice-sequence [data-state="passed"]')).toHaveCount(0);
    await expect(page.locator('.practice-page')).not.toHaveAttribute('data-phase', /countdown|practicing|passed|transition/);
    await expect(page.getByText('Live camera + MediaPipe', { exact: true })).toBeVisible();
    expect(await page.getByLabel('Live camera preview').evaluate((element) => (element as HTMLVideoElement).srcObject === window.__practiceQa!.stream)).toBe(true);
    expect(await page.evaluate(() => window.__practiceQa!.stream!.getTracks().every((track) => track.readyState === 'live'))).toBe(true);
    await page.waitForTimeout(4_200); // An old countdown must remain canceled while the new manifest is pending.
    expect(await page.getByLabel('Recorded reference movement').evaluate((element) => (element as HTMLVideoElement).paused)).toBe(true);
    releaseManifest();
    await expect(page.locator('.practice-resources')).toContainText('Reference analyzed locally', { timeout: 60_000 });
    await expect(page.locator('.practice-page')).toHaveAttribute('data-current-movement', '1');
    await expect(page.locator('.practice-sequence [data-state="passed"]')).toHaveCount(0);
    await expect(page.locator('.practice-page')).not.toHaveAttribute('data-phase', /countdown|practicing|passed|transition/);
    expect(await page.evaluate(() => window.__practiceQa!.calls)).toBe(1);
    await canvasHasPose(page, 'Pose estimated from the live camera');
    await page.screenshot({ path: testInfo.outputPath('practice-library-switch-preserves-live-skeleton.png'), fullPage: true });
    await page.getByRole('button', { name: 'Stop camera' }).click();
  } finally {
    releaseManifest();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  }
});

test('pause and stop during next-reference loading cancel automatic practice', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  testInfo.annotations.push({ type: 'provenance', description: 'PRERECORDED TEST SOURCE with real MediaPipe. Browser-test network gates delay the second and third local reference assets to exercise transition cancellation; no pose samples or comparison results are mocked.' });
  const playlist = await loadPlaylist(page);
  expect(playlist.clips).toHaveLength(24);
  const gate = () => {
    let notifySeen!: () => void;
    let release!: () => void;
    const seen = new Promise<void>((resolve) => { notifySeen = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    return { seen, notifySeen, released, release };
  };
  const second = gate(), third = gate();
  await page.route(/\/practice-media\/[^?#]+\.(?:webm|mp4)(?:\?.*)?$/, async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const blocked = pathname === playlist.clips[1].src ? second : pathname === playlist.clips[2].src ? third : null;
    if (blocked) { blocked.notifySeen(); await blocked.released; }
    await route.continue();
  });
  await usePrerecordedInstructorCamera(page);
  try {
    await referenceReady(page);
    await page.getByRole('button', { name: 'Start camera' }).click();
    await expect(page.getByRole('button', { name: 'Start practice' })).toBeEnabled({ timeout: 45_000 });
    await page.getByRole('button', { name: 'Start practice' }).click();
    await second.seen;
    await expect(page.locator('.practice-page')).toHaveAttribute('data-current-movement', '2');
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Practice paused', exact: true })).toBeVisible();
    second.release();
    await expect(page.locator('.practice-resources')).toContainText('Reference analyzed locally', { timeout: 45_000 });
    await page.waitForTimeout(4_200); // A released analysis must not revive the automatic countdown.
    await expect(page.locator('.practice-page')).toHaveAttribute('data-phase', 'paused');
    expect(await page.getByLabel('Recorded reference movement').evaluate((element) => (element as HTMLVideoElement).paused)).toBe(true);
    await expect(page.locator('.practice-sequence [data-state="passed"]')).toHaveCount(1);
    await page.getByRole('button', { name: 'Restart movement', exact: true }).click();
    await third.seen;
    await expect(page.locator('.practice-page')).toHaveAttribute('data-current-movement', '3');
    await page.getByRole('button', { name: 'Stop camera', exact: true }).click();
    third.release();
    await expect(page.getByText('Camera off', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.__practiceQa!.stream!.getTracks().every((track) => track.readyState === 'ended'))).toBe(true);
    await page.waitForTimeout(4_200);
    expect(await page.getByLabel('Recorded reference movement').evaluate((element) => (element as HTMLVideoElement).paused)).toBe(true);
    await expect(page.locator('.practice-page')).not.toHaveAttribute('data-phase', /countdown|practicing|passed|transition/);
    await expect(page.locator('.practice-sequence [data-state="passed"]')).toHaveCount(2);
    expect(await page.getByLabel('Live camera preview').evaluate((element) => (element as HTMLVideoElement).srcObject)).toBeNull();
    await page.screenshot({ path: testInfo.outputPath('practice-stopped-during-transition.png'), fullPage: true });
  } finally {
    second.release(); third.release();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  }
});
