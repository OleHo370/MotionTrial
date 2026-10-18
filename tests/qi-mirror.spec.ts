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

test('cover and all 24 form choices lead only to the new namespace', async ({ page }, info) => {
  await page.goto('/qi-mirror/cover');
  await page.getByRole('link', { name: '开始游戏' }).click();
  await expect(page).toHaveURL(/\/qi-mirror\/levels$/);
  await expect(page.locator('.ql-level-stop')).toHaveCount(24);
  await page.getByRole('button', { name: 'Next level', exact: true }).click();
  await expect(page.locator('.ql-enter')).toHaveAttribute('href', '/qi-mirror/enter?form=2');
  for (let level = 1; level <= 24; level++) {
    await page.getByRole('button', { name: new RegExp(`^Choose level ${level}:`) }).click();
    await expect(page.locator('.ql-enter')).toHaveAttribute('href', `/qi-mirror/enter?form=${level}`);
  }
  await page.screenshot({ path: info.outputPath('levels-desktop.png') });
  await page.setViewportSize({ width: 320, height: 568 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath('levels-mobile.png') });
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
