import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: 'qi-mirror.spec.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 25_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results-qi-mirror',
  use: {
    baseURL: process.env.MOTIONTRIAL_QI_TEST_URL || 'http://127.0.0.1:3100',
    channel: 'chrome', headless: true, viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure', screenshot: 'only-on-failure', permissions: [],
  },
});
