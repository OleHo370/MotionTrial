/** Actual recorded-video inference QA; never a live-camera fixture or a landmark generator. */
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseUrl = process.env.MOTIONTRIAL_TEST_URL || 'http://127.0.0.1:3000';
const hz = 12;
const option = (name, fallback) => {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
};
const playlistArgument = option('--playlist', 'public/practice-media/playlist.json');
const expectedCount = option('--expected-count', playlistArgument === 'public/practice-media/playlist.json' ? '24' : null);
// Recalculate changed rules/focus from actual stored observations only after all
// clip bytes, dimensions and durations match; never relabel them as fresh inference.
const reuseObservations = process.argv.includes('--reuse-observations');
const counterfactuals = process.argv.includes('--counterfactuals');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const modelSha256 = '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a';
if (sha256(await readFile(path.join(root, 'public/models/pose_landmarker_lite.task'))) !== modelSha256) throw new Error('The local MediaPipe model does not match its pinned SHA256.');
const reportDirectory = path.resolve(root, option('--report-directory', 'artifacts/reference-24-qa'));
await mkdir(reportDirectory, { recursive: true });
const playlistPath = path.resolve(root, playlistArgument);
const playlist = JSON.parse(await readFile(playlistPath, 'utf8'));
if (!Array.isArray(playlist.clips) || playlist.clips.length === 0) throw new Error('The playlist has no clips.');
if (expectedCount !== null && playlist.clips.length !== Number(expectedCount)) throw new Error(`Expected ${expectedCount} clips; found ${playlist.clips.length}.`);
const bundled = await build({
  stdin: { contents: 'export * from "./lib/imitation"; export { createImitationPoseClient } from "./lib/imitation-pose";', resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'ReferenceQa', target: 'es2022',
});
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
page.setDefaultTimeout(60_000);
await page.route('**/__reference24_qa', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Recorded reference inference QA</title>' }));
const reports = [];
try {
  await page.goto(`${baseUrl}/__reference24_qa`);
  await page.addScriptTag({ content: bundled.outputFiles[0].text });
  for (const [index, clip] of playlist.clips.entries()) {
    const started = performance.now();
    const sourcePath = path.join(root, 'public', clip.src);
    const sourceHash = sha256(await readFile(sourcePath));
    if (sourceHash !== clip.sha256) throw new Error(`${clip.id} bytes do not match the finalized manifest.`);
    const cacheName = `${path.parse(clip.src).name}.poses.json`;
    const cachePath = path.join(root, 'public/practice-media', cacheName);
    const recorded = reuseObservations ? JSON.parse(await readFile(cachePath, 'utf8')) : null;
    if (recorded && (recorded.schemaVersion !== 'recorded-reference-pose-v1' || recorded.modelSha256 !== modelSha256
      || recorded.clipId !== clip.id || recorded.src !== clip.src
      || recorded.sourceClipSha256 !== sourceHash || sourceHash !== clip.sha256
      || recorded.width !== clip.width || recorded.height !== clip.height
      || Math.abs(recorded.durationMs - clip.durationSeconds * 1000) > 100)) {
      throw new Error(`Stored actual observations do not match ${clip.id}; run fresh inference.`);
    }
    const inferred = await page.evaluate(async ({ clip, hz, recorded, counterfactuals }) => {
      const qa = window.ReferenceQa;
      const summarize = (samples, durationMs, width, height) => {
        const options = {
          referenceAspectRatio: width / height, attemptAspectRatio: width / height,
          referenceDurationMs: durationMs, attemptDurationMs: durationMs,
          ...(clip.focusJoints?.length ? { focusJoints: clip.focusJoints } : {}),
        };
        const selfCheck = qa.evaluatePracticeAttempt(samples, samples, options);
        const strictCheck = qa.evaluatePracticeAttempt(samples, samples, { ...options, profile: 'standard' });
        const focusChecks = [15, 16, 27, 28].map((joint) => ({ joint,
          result: qa.evaluatePracticeAttempt(samples, samples, { ...options, focusJoints: [joint] }),
        }));
        const visibility = qa.PRACTICE_JOINTS.map((joint) => {
          const values = samples.map((sample) => sample.landmarks.find((point) => point.index === joint)?.visibility ?? 0);
          return { joint, mean: values.reduce((sum, value) => sum + value, 0) / values.length,
            fractionAboveHalf: values.filter((value) => value >= 0.5).length / values.length };
        });
        const counterfactualChecks = counterfactuals ? {
          provenance: 'Counterfactual transformations of the actual recorded-reference observations; not additional camera footage or new model inference.',
          heldFirstPose: qa.evaluatePracticeAttempt(samples, samples.map((sample) => ({ ...sample, landmarks: samples[0].landmarks })), options),
          reversedSequence: qa.evaluatePracticeAttempt(samples, samples.map((sample, index) => ({ ...samples[samples.length - 1 - index], tMs: sample.tMs })), options),
          missingTracking: qa.evaluatePracticeAttempt(samples, samples.map((sample) => ({ ...sample, status: 'no_pose', landmarks: [] })), options),
        } : null;
        return { durationMs, width, height, samples, selfCheck, strictCheck, focusChecks, visibility, ...(counterfactualChecks ? { counterfactualChecks } : {}) };
      };
      if (recorded) return summarize(recorded.samples, recorded.durationMs, recorded.width, recorded.height);
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      document.body.append(video);
      const wait = (event) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => { cleanup(); reject(new Error(`Video ${event} timed out.`)); }, 30_000);
        const cleanup = () => { clearTimeout(timer); video.removeEventListener(event, success); video.removeEventListener('error', error); };
        const success = () => { cleanup(); resolve(); };
        const error = () => { cleanup(); reject(new Error(`Video decode failed: ${video.error?.message}`)); };
        video.addEventListener(event, success, { once: true });
        video.addEventListener('error', error, { once: true });
      });
      let model;
      try {
        const loaded = wait('loadeddata');
        video.src = clip.src;
        video.load();
        await loaded;
        model = await qa.createImitationPoseClient();
        const durationMs = video.duration * 1000;
        const samples = [];
        const count = Math.ceil(durationMs / (1000 / hz));
        for (let frame = 0; frame <= count; frame++) {
          const tMs = Math.min(frame * (1000 / hz), durationMs - 15);
          if (samples.at(-1)?.tMs === tMs) continue;
          if (Math.abs(video.currentTime - tMs / 1000) >= 0.002) {
            const sought = wait('seeked');
            video.currentTime = tMs / 1000;
            await sought;
          }
          samples.push({ tMs, ...model.estimate(video, tMs + 1) });
        }
        return summarize(samples, durationMs, video.videoWidth, video.videoHeight);
      } finally { model?.close(); video.remove(); }
    }, { clip, hz, recorded, counterfactuals });
    if (sourceHash !== sha256(await readFile(sourcePath))) throw new Error(`${clip.id} changed during inference; observations were not saved.`);
    if (inferred.width !== clip.width || inferred.height !== clip.height
      || Math.abs(inferred.durationMs - clip.durationSeconds * 1000) > 100) throw new Error(`${clip.id} decoded dimensions/duration do not match the manifest.`);
    const observationFile = {
      schemaVersion: 'recorded-reference-pose-v1', clipId: clip.id, src: clip.src,
      provenance: 'Actual local MediaPipe Pose Landmarker Lite float16 v1 CPU inference on recorded instructor video, not live camera data.',
      modelSha256,
      sourceClipSha256: sourceHash,
      sampleRateHz: hz, durationMs: inferred.durationMs, width: inferred.width, height: inferred.height, samples: inferred.samples,
    };
    if (!reuseObservations) await writeFile(cachePath, JSON.stringify(observationFile) + '\n');
    const { samples, ...summary } = inferred;
    const report = { number: index + 1, id: clip.id, title: clip.title, src: clip.src,
      samples: samples.length, inferenceMode: reuseObservations ? 'recalculated actual stored observations' : 'fresh MediaPipe inference',
      inferenceMs: Math.round(performance.now() - started),
      observationFile: `/practice-media/${cacheName}`, ...summary };
    reports.push(report);
    await writeFile(path.join(reportDirectory, 'diagnostics.json'), JSON.stringify({
      provenance: observationFile.provenance, baseUrl, playlistPath, sampleRateHz: hz, reuseObservations, counterfactuals, clips: reports,
    }, null, 2) + '\n');
    console.log(`${index + 1}/${playlist.clips.length} ${clip.title}: ${report.selfCheck.status}, coverage ${(report.selfCheck.diagnostics.referenceCoverage * 100).toFixed(1)}%, ${report.samples} actual observations, ${report.inferenceMs} ms`);
  }
} finally { await browser.close(); }
if (!reuseObservations) await writeFile(path.join(reportDirectory, 'fresh-inference.json'), await readFile(path.join(reportDirectory, 'diagnostics.json')));
const failed = reports.filter((report) => report.selfCheck.status !== 'matched');
console.log(`Recorded reference QA: ${reports.length - failed.length}/${playlist.clips.length} relaxed self-checks matched. Report: ${reportDirectory}`);
if (failed.length) process.exitCode = 1;
