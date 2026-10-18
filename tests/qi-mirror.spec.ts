import { expect, test, type Page } from '@playwright/test';

async function styleSnapshot(page: Page) {
  return page.evaluate(() => {
    const selectors = ['body', '.sidebar', '.main-shell', '.topbar', '#main', 'h1', '.button', '.practice-page'];
    const properties = ['display', 'position', 'margin-left', 'padding', 'color', 'background-color', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'overflow'];
    return { overflow: document.body.style.overflow, styles: selectors.map(selector => {
      const node = document.querySelector(selector);
      if (!node) return { selector, values: null };
      const style = getComputedStyle(node);
      return { selector, values: properties.map(property => style.getPropertyValue(property)) };
    }) };
  });
}

async function returnTo(page: Page, name: 'Existing workspace' | 'Existing practice') {
  const begin = page.getByRole('button', { name: 'Begin', exact: true });
  if (await begin.isVisible()) await begin.click();
  await page.locator('.qi-host-links summary').click();
  await page.getByRole('link', { name, exact: true }).click();
  await expect(page.locator('[data-qimirror-root]')).toHaveCount(0);
  if (name === 'Existing workspace') await expect(page.locator('.sidebar')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { cameraRequests: number }).cameraRequests = 0;
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => {
      (window as unknown as { cameraRequests: number }).cameraRequests += 1;
      throw new Error('This page-isolation check must not activate a camera.');
    };
  });
});

test('homepage renders four scenes, local fonts, reduced motion and narrow layouts', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/qi-mirror');
  await expect(page.locator('.home-scene')).toHaveCount(4);
  await expect(page.getByRole('link', { name: 'Explore the forms' })).toHaveAttribute('href', '/qi-mirror/levels');
  await page.evaluate(() => document.fonts.ready);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await expect.poll(() => page.locator('.home-brush-canvas').evaluateAll(canvases =>
      canvases.length === 2 && canvases.every(canvas => (canvas as HTMLElement).dataset.progress === '1.000'))).toBe(true);
    await page.screenshot({ path: info.outputPath(`homepage-${viewport.width}.png`) });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.getByRole('button', { name: 'Reduced motion' })).toBeDisabled();
  await expect(page.locator('.qi-home')).toHaveAttribute('data-ambient-motion', 'paused');
  expect(errors).toEqual([]);
});

test('level one opens original opening lesson and other form choices keep their routes', async ({ page }, info) => {
  await page.goto('/qi-mirror/cover');
  await page.getByRole('link', { name: '开始游戏' }).click();
  await expect(page).toHaveURL(/\/qi-mirror\/levels$/);
  await expect(page.locator('.ql-level-stop')).toHaveCount(24);
  await page.getByRole('button', { name: 'Next level', exact: true }).click();
  await expect(page.locator('.ql-enter')).toHaveAttribute('href', '/qi-mirror/enter?form=2');
  for (let level = 1; level <= 24; level++) {
    await page.getByRole('button', { name: new RegExp(`^Choose level ${level}:`) }).click();
    await expect(page.locator('.ql-enter')).toHaveAttribute('href', level === 1 ? '/qi-mirror/enter?form=1&lesson=opening' : `/qi-mirror/enter?form=${level}`);
  }
  await page.screenshot({ path: info.outputPath('levels-desktop.png') });
  await page.setViewportSize({ width: 320, height: 568 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath('levels-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 900 });
  // Hold the read-only readiness check so both loader states are observable.
  let releaseReady!: () => void;
  const readyGate = new Promise<void>(resolve => { releaseReady = resolve; });
  await page.route('**/api/qi-mirror/opening-ready', async route => {
    await readyGate;
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ready":true}' });
  });
  const progressChanges: { value: string; at: number }[] = [];
  let destinationRequestedAt = 0;
  await page.exposeBinding('recordOpeningProgress', (_source, value: string, at: number) => { progressChanges.push({ value, at }); });
  const watchOpeningProgress = () => {
    let previous = '';
    const record = () => {
      const value = document.querySelector('[role="progressbar"][aria-label="Lesson preparation"]')?.getAttribute('aria-valuenow');
      if (value == null || value === previous) return;
      previous = value;
      void (window as unknown as { recordOpeningProgress: (value: string, at: number) => Promise<void> }).recordOpeningProgress(value, Date.now());
    };
    new MutationObserver(record).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-valuenow'] });
    record();
  };
  await page.addInitScript(watchOpeningProgress);
  await page.evaluate(watchOpeningProgress);
  const sideEffectRequests: string[] = [];
  page.on('request', request => {
    if (/\/api\/(?:arduino(?:\/|$)|practice-(?:feedback|summary))/.test(new URL(request.url()).pathname)) sideEffectRequests.push(request.url());
    if (request.isNavigationRequest() && request.url() === 'http://127.0.0.1:8766/first-three.html?step=1') destinationRequestedAt = Date.now();
  });
  // Loading must not initialize another player, hardware relay, or AI session.
  await page.route(/\/api\/(?:arduino(?:\/|$)|practice-(?:feedback|summary))/, route => route.fulfill({
    status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Hardware and AI disabled for navigation check.' }),
  }));
  await page.getByRole('button', { name: /^Choose level 1:/ }).click();
  await page.getByRole('link', { name: /Begin this form/ }).click();
  await expect(page).toHaveURL(/\/qi-mirror\/enter\?form=1&lesson=opening$/);
  const progress = page.getByRole('progressbar', { name: 'Lesson preparation' });
  await expect(progress).toBeVisible();
  await expect(page.locator('.qi-bamboo-progress')).toBeVisible();
  await expect(progress).toHaveAttribute('aria-valuenow', '0');
  expect(sideEffectRequests).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as { cameraRequests: number }).cameraRequests)).toBe(0);
  releaseReady();
  await expect(progress).toHaveAttribute('aria-valuenow', '100');
  await page.screenshot({ path: info.outputPath('opening-bamboo-100.png'), animations: 'disabled' });
  await expect(page).toHaveURL('http://127.0.0.1:8766/first-three.html?step=1');
  const complete = progressChanges.find(change => change.value === '100');
  expect(progressChanges.some(change => change.value === '0')).toBe(true);
  expect(complete).toBeDefined();
  expect(destinationRequestedAt - complete!.at).toBeGreaterThanOrEqual(450);
  await expect(page.locator('[data-qimirror-root]')).toHaveCount(0);
  await expect(page.locator('#teacher-video')).toBeVisible();
  await expect(page.locator('#camera-video')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { firstThreeDiagnostics?: { ready: boolean; index: number } }).firstThreeDiagnostics?.ready)).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { firstThreeDiagnostics: { index: number } }).firstThreeDiagnostics.index)).toBe(0);
  const teacher = await page.locator('#teacher-pixels').boundingBox();
  const camera = await page.locator('#camera-pixels').boundingBox();
  expect(teacher).not.toBeNull(); expect(camera).not.toBeNull();
  expect(teacher!.x + teacher!.width).toBeLessThanOrEqual(camera!.x + 1);
  expect(await page.evaluate(() => (window as unknown as { cameraRequests: number }).cameraRequests)).toBe(0);
});

test('opening bamboo loader offers retry after unavailable practice and remains isolated', async ({ page }, info) => {
  let readinessRequests = 0;
  let releaseReady!: () => void;
  const readyGate = new Promise<void>(resolve => { releaseReady = resolve; });
  await page.route('**/api/qi-mirror/opening-ready', async route => {
    readinessRequests++;
    if (readinessRequests === 1) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"ready":false}' });
      return;
    }
    await readyGate;
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ready":true}' });
  });
  await page.route('http://127.0.0.1:8766/first-three.html?step=1', route => route.fulfill({
    status: 200, contentType: 'text/html', body: '<!doctype html><h1>Opening practice destination</h1>',
  }));
  const sideEffectRequests: string[] = [];
  page.on('request', request => {
    if (/\/api\/(?:arduino(?:\/|$)|practice-(?:feedback|summary))/.test(new URL(request.url()).pathname)) sideEffectRequests.push(request.url());
  });
  await page.goto('/qi-mirror/levels');
  await page.getByRole('link', { name: /Begin this form/ }).click();
  const loadError = page.getByRole('region', { name: 'Loading the selected form' }).getByRole('alert');
  await expect(loadError).toHaveText('The practice page is unavailable. Please try again.');
  const progress = page.getByRole('progressbar', { name: 'Lesson preparation' });
  await expect(progress).toHaveAttribute('aria-valuenow', '0');
  await expect(page.getByRole('link', { name: 'Back to forms' })).toHaveAttribute('href', '/qi-mirror/levels');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('opening-bamboo-unavailable-mobile.png') });
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect.poll(() => readinessRequests).toBe(2);
  await expect(loadError).toHaveCount(0);
  await expect(progress).toHaveAttribute('aria-valuenow', '0');
  expect(sideEffectRequests).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as { cameraRequests: number }).cameraRequests)).toBe(0);
  releaseReady();
  await expect(progress).toHaveAttribute('aria-valuenow', '100');
  await page.screenshot({ path: info.outputPath('opening-bamboo-100-mobile.png'), animations: 'disabled' });
  await expect(page).toHaveURL('http://127.0.0.1:8766/first-three.html?step=1');
  await expect(page.getByRole('heading', { name: 'Opening practice destination' })).toBeVisible();
});

test('leaving opening bamboo loading cancels pending readiness and completed redirects', async ({ page }) => {
  let releaseReady!: () => void;
  const readyGate = new Promise<void>(resolve => { releaseReady = resolve; });
  let holdReadiness = true;
  await page.route('**/api/qi-mirror/opening-ready', async route => {
    if (holdReadiness) await readyGate;
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ready":true}' }).catch(() => {});
  });
  const destinationRequests: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).origin === 'http://127.0.0.1:8766') destinationRequests.push(request.url());
  });
  await page.goto('/qi-mirror/levels');
  await page.getByRole('link', { name: /Begin this form/ }).click();
  await expect(page.getByRole('progressbar', { name: 'Lesson preparation' })).toHaveAttribute('aria-valuenow', '0');
  await page.goBack();
  await expect(page).toHaveURL(/\/qi-mirror\/levels$/);
  releaseReady();
  // Cover the entire one-second minimum after the cancelled readiness resolves.
  await page.waitForTimeout(1_200);
  await expect(page).toHaveURL(/\/qi-mirror\/levels$/);
  expect(destinationRequests).toEqual([]);

  holdReadiness = false;
  await page.getByRole('link', { name: /Begin this form/ }).click();
  await expect(page.getByRole('progressbar', { name: 'Lesson preparation' })).toHaveAttribute('aria-valuenow', '100');
  await page.goBack();
  await expect(page).toHaveURL(/\/qi-mirror\/levels$/);
  await page.waitForTimeout(1_200);
  await expect(page).toHaveURL(/\/qi-mirror\/levels$/);
  expect(destinationRequests).toEqual([]);
});

test('other selected forms retain the original bamboo lesson preparation', async ({ page }) => {
  await page.goto('/qi-mirror/levels');
  await page.getByRole('button', { name: /^Choose level 2:/ }).click();
  await page.getByRole('link', { name: /Begin this form/ }).click();
  await expect(page).toHaveURL(/\/qi-mirror\/practice\?mode=guided&form=2$/);
  await expect(page.getByRole('combobox', { name: 'Teaching form' })).toHaveValue('2');
  await expect(page.getByRole('heading', { name: 'Round 1: turn and open', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Watch slowly', exact: true })).toBeEnabled();
  expect(await page.locator('video').evaluateAll(videos => videos.every(video => (video as HTMLVideoElement).paused))).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { cameraRequests: number }).cameraRequests)).toBe(0);
});

test('bamboo loading reaches instructions without starting video or camera', async ({ page }, info) => {
  await page.goto('/qi-mirror/enter?form=1');
  await expect(page).toHaveURL(/\/qi-mirror\/practice\?mode=guided&form=1$/);
  await expect(page.getByRole('heading', { name: 'How to play', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { cameraRequests: number }).cameraRequests)).toBe(0);
  await page.screenshot({ path: info.outputPath('practice-instructions.png') });
  await page.getByRole('button', { name: 'Begin', exact: true }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  expect(await page.locator('video').evaluateAll(videos => videos.every(video => (video as HTMLVideoElement).paused))).toBe(true);
  await page.screenshot({ path: info.outputPath('practice-ready.png') });
});

test('existing workspace styles and navigation recover after each new page', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'A clearer view of every recording.' })).toBeVisible();
  const baseline = await styleSnapshot(page);
  for (const route of ['/qi-mirror', '/qi-mirror/cover', '/qi-mirror/levels', '/qi-mirror/practice?mode=guided&form=1', '/qi-mirror/practice?mode=forms&routine=original24']) {
    await page.goto(route);
    await expect(page.locator('[data-qimirror-root]')).toBeVisible();
    if (route.includes('practice')) await expect(page.getByRole('heading', { name: 'How to play', exact: true })).toBeVisible();
    await returnTo(page, 'Existing workspace');
    await expect(page.getByRole('heading', { name: 'A clearer view of every recording.' })).toBeVisible();
    expect(await styleSnapshot(page)).toEqual(baseline);
  }
});

test('existing practice styles recover after imported practice', async ({ page }) => {
  await page.goto('/practice');
  await expect(page.locator('.practice-page')).toBeVisible();
  const baseline = await styleSnapshot(page);
  await page.goto('/qi-mirror/practice?mode=guided&form=1');
  await expect(page.getByRole('heading', { name: 'How to play', exact: true })).toBeVisible();
  await returnTo(page, 'Existing practice');
  await expect(page.locator('.practice-page')).toBeVisible();
  expect(await styleSnapshot(page)).toEqual(baseline);
});
