import { randomUUID } from 'node:crypto';
import { chromium, type Browser } from '@playwright/test';
import { fixParsedWebmDuration } from '@fix-webm-duration/fix';
import { WebmFile } from '@fix-webm-duration/parser';
import { INSTRUCTIONS, TASK_ID, TASK_VERSION, type CaptureMetadata, type Observation } from '../lib/types';

const durationMs = 20_000;
const modelVersion = 'synthetic-fixture-v1 (no model inference)';
const fixtures = [
  { code: 'SYN-NORMAL', name: 'Synthetic normal tracking', kind: 'normal' },
  { code: 'SYN-LOSS', name: 'Synthetic tracking loss (8–11 s)', kind: 'loss' },
  { code: 'SYN-SMALL', name: 'Synthetic small movement', kind: 'small' },
] as const;
type Fixture = typeof fixtures[number];

function origin(): string {
  const index = process.argv.indexOf('--origin');
  const url = new URL(index >= 0 ? process.argv[index + 1] : 'http://127.0.0.1:3000');
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/') {
    throw new Error('Use a local HTTP origin, for example --origin http://127.0.0.1:3000.');
  }
  return url.origin;
}

function observationsFor(kind: Fixture['kind']): Observation[] {
  return Array.from({ length: durationMs / 100 }, (_, index): Observation => {
    const tMs = index * 100;
    if (kind === 'loss' && tMs >= 8000 && tMs < 11_000) {
      return { tMs, sourceVideoMs: tMs, status: 'no_pose', landmarks: [] };
    }
    const amplitude = kind === 'small' ? 0.007 : 0.12;
    const wave = Math.sin(tMs / 1000 * Math.PI / 3);
    const coordinates = [
      [11, 0.39, 0.35], [12, 0.61, 0.35],
      [13, 0.32, 0.52 - wave * amplitude * 0.4], [14, 0.68, 0.52 - wave * amplitude * 0.4],
      [15, 0.26, 0.61 - wave * amplitude], [16, 0.74, 0.61 - wave * amplitude],
    ];
    return { tMs, sourceVideoMs: tMs, status: 'pose', landmarks: coordinates.map(([point, x, y]) => ({
      index: point, x, y, z: 0, visibility: 0.98,
    })) };
  });
}

async function makeAnimation(browser: Browser, fixture: Fixture): Promise<Uint8Array<ArrayBuffer>> {
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  try {
    // tsx/esbuild preserves nested function names with this helper. Playwright
    // serializes the callback below into a separate browser JavaScript realm.
    await page.addScriptTag({ content: 'globalThis.__name = (value) => value;' });
    const base64 = await page.evaluate(async ({ durationMs, fixture }) => {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      document.body.append(canvas);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas is unavailable.');
      const stream = canvas.captureStream(20);
      const mimeType = ['video/webm;codecs=vp8', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error('This browser cannot record a WebM canvas fixture.');
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 500_000 });
      const chunks: Blob[] = [];
      const finished = new Promise<Blob>((resolve, reject) => {
        recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
        recorder.onerror = () => reject(new Error('Synthetic animation recording failed.'));
        recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
      });
      const startedAt = performance.now();
      const draw = () => {
        const elapsed = Math.min(durationMs, performance.now() - startedAt);
        const wave = Math.sin(elapsed / 1000 * Math.PI / 3);
        const amplitude = fixture.kind === 'small' ? 0.007 : 0.12;
        const loss = fixture.kind === 'loss' && elapsed >= 8000 && elapsed < 11_000;
        context.fillStyle = '#F7F8FA';
        context.fillRect(0, 0, 640, 480);
        context.fillStyle = '#14263D';
        context.font = 'bold 18px sans-serif';
        context.fillText('SYNTHETIC ANIMATION', 26, 34);
        context.font = '14px sans-serif';
        context.fillText('Not a camera recording · Not model inference', 26, 58);
        context.fillText(fixture.name, 26, 84);
        context.strokeStyle = '#087E8B';
        context.lineWidth = 9;
        context.lineCap = 'round';
        const points = [[0.39, 0.35], [0.61, 0.35], [0.32, 0.52 - wave * amplitude * 0.4],
          [0.68, 0.52 - wave * amplitude * 0.4], [0.26, 0.61 - wave * amplitude], [0.74, 0.61 - wave * amplitude]];
        for (const [a, b] of [[0, 1], [0, 2], [2, 4], [1, 3], [3, 5]]) {
          context.beginPath();
          context.moveTo(points[a][0] * 640, points[a][1] * 480);
          context.lineTo(points[b][0] * 640, points[b][1] * 480);
          context.stroke();
        }
        context.beginPath();
        context.arc(320, 127, 25, 0, Math.PI * 2);
        context.stroke();
        context.beginPath();
        context.moveTo(320, 175);
        context.lineTo(320, 330);
        context.stroke();
        context.strokeStyle = '#8093A5';
        context.beginPath();
        context.moveTo(260, 344);
        context.lineTo(380, 344);
        context.moveTo(275, 344);
        context.lineTo(275, 390);
        context.moveTo(365, 344);
        context.lineTo(365, 390);
        context.stroke();
        context.fillStyle = loss ? '#B76B12' : '#14263D';
        context.font = 'bold 16px sans-serif';
        context.fillText(loss ? 'Simulated unavailable tracking: 8–11 s' : 'Generated confidence and coordinates', 26, 427);
        context.font = '14px sans-serif';
        context.fillText(`${(elapsed / 1000).toFixed(1)} / 20.0 s · Demonstration fixture only`, 26, 455);
      };
      draw();
      recorder.start(250);
      const timer = setInterval(draw, 50);
      await new Promise((resolve) => setTimeout(resolve, durationMs));
      clearInterval(timer);
      draw();
      recorder.stop();
      const blob = await finished;
      stream.getTracks().forEach((track) => track.stop());
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = () => reject(new Error('Cannot read generated video.'));
        reader.readAsDataURL(blob);
      });
    }, { durationMs, fixture });
    // MediaRecorder WebM lacks Duration metadata in Chromium. Repair the EBML
    // container only; the source video frames are never decoded or reencoded.
    // The Blob helper uses FileReader, so use the library's parsed-file API in
    // Node instead of silently returning an unchanged Blob without duration.
    const file = new WebmFile(new Uint8Array(Buffer.from(base64, 'base64')));
    fixParsedWebmDuration(file, durationMs, { logger: false });
    const metadataDuration = file.getSectionById(0x8538067)?.getSectionById(0x549a966)
      ?.getSectionById(0x489)?.getValue();
    if (!Number.isFinite(metadataDuration) || !metadataDuration || !file.source) {
      throw new Error('The generated animation has no finite WebM duration metadata.');
    }
    return new Uint8Array(file.source);
  } finally {
    await page.close();
  }
}

async function main() {
  const baseUrl = origin();
  const listResponse = await fetch(`${baseUrl}/api/sessions`);
  if (!listResponse.ok) throw new Error(`Cannot read local sessions: HTTP ${listResponse.status}. Start the app first.`);
  const listing = await listResponse.json();
  const existing: { demoCode: string; provenance: string; modelVersion: string }[] = Array.isArray(listing) ? listing : listing.sessions;
  if (!Array.isArray(existing)) throw new Error('Unexpected session list response.');
  const pending = fixtures.filter((fixture) => !existing.some((session) => session.demoCode === fixture.code
    && session.provenance === 'synthetic_demo' && session.modelVersion === modelVersion));
  if (!pending.length) {
    console.log('All three synthetic fixtures already exist. No sessions were changed.');
    return;
  }
  console.log(`Generating ${pending.length} clearly labelled synthetic 20-second animation fixture(s). No camera or model inference is used.`);
  let browser: Browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  } catch {
    browser = await chromium.launch({ headless: true });
  }
  try {
    await Promise.all(pending.map(async (fixture) => {
      const video = await makeAnimation(browser, fixture);
      const now = new Date().toISOString();
      const metadata: CaptureMetadata = {
        id: randomUUID(), demoCode: fixture.code, provenance: 'synthetic_demo',
        consentAt: now, recordedAt: now, durationMs, interrupted: false,
        taskId: TASK_ID, taskVersion: TASK_VERSION, instructions: INSTRUCTIONS,
        modelVersion, timing: { performanceStartMs: 0, recorderStartMs: 0, videoStartMs: 0 },
        demoCase: `${fixture.name} · animation, no model inference`,
      };
      const form = new FormData();
      form.set('metadata', JSON.stringify(metadata));
      form.set('observations', JSON.stringify(observationsFor(fixture.kind)));
      form.set('video', new Blob([video], { type: 'video/webm' }), 'synthetic-animation.webm');
      const response = await fetch(`${baseUrl}/api/sessions`, { method: 'POST', body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(`${fixture.name}: HTTP ${response.status} ${JSON.stringify(result)}`);
      console.log(`Saved ${fixture.code}: ${baseUrl}/sessions/${metadata.id} (${video.byteLength} bytes, synthetic_demo)`);
    }));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`Demo seed failed: ${error.message}`);
  console.error('Start MotionTrial locally first. If no Chromium browser is installed, run npx playwright install chromium and retry. Successfully saved fixtures are retained.');
  process.exitCode = 1;
});
