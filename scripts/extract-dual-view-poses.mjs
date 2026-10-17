/** Extract actual, independent full-frame MediaPipe observations from the two supplied views.
 * Run with a local static server serving public/: node scripts/extract-dual-view-poses.mjs --view front
 * Completed chunks are immutable resumable evidence; no landmarks are interpolated or synthesized.
 */
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
};
const view = argument('--view', null);
const sources = {
  front: { sourceFile: 'front.mp4', src: '/practice-media/dual-front-source.mp4', frameCount: 8740,
    sourceSha256: '5af76997dad0972943418a3d931870e9cce531abd78f8a4597b75f6a00498ef5' },
  back: { sourceFile: 'back.mp4', src: '/practice-media/dual-back-source.mp4', frameCount: 8670,
    sourceSha256: '1068209a066394c8556dcfcdd96bfa3d56058de8834a3305b08948311574147f' },
};
if (!Object.hasOwn(sources, view)) throw new Error('Choose exactly one view with --view front or --view back.');
const source = sources[view];
const baseUrl = argument('--base-url', process.env.MOTIONTRIAL_MEDIA_URL || 'http://127.0.0.1:8765').replace(/\/$/, '');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseUrl).hostname)) throw new Error('Extraction requires a local loopback media server.');
const fps = 30, width = 640, height = 360, chunkSize = 300, resumeWarmupFrames = 30;
const modelSha256 = '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a';
const packageVersion = '1.1.1';
const schemaVersion = 'dual-view-full-pose-v1';
const directory = path.join(root, 'artifacts/dual-view-review');
const chunkDirectory = path.join(directory, `${view}.full.pose-chunks`);
const outputPath = path.join(directory, `${view}.full.poses.json`);
const originalPath = path.resolve(root, '..', '..', source.sourceFile);
const copiedPath = path.join(root, 'public', source.src);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fileHash = async (filename) => hash(await readFile(filename));
const modelOptions = {
  baseOptions: { modelAssetPath: '/models/pose_landmarker_lite.task', delegate: 'CPU' },
  runningMode: 'VIDEO', numPoses: 1,
  minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  outputSegmentationMasks: false,
};

await mkdir(chunkDirectory, { recursive: true });
const installed = JSON.parse(await readFile(path.join(root, 'node_modules/@mediapipe/tasks-vision/package.json'), 'utf8'));
if (installed.version !== packageVersion) throw new Error(`Expected @mediapipe/tasks-vision ${packageVersion}; found ${installed.version}.`);
const assetManifest = JSON.parse(await readFile(path.join(root, 'public/mediapipe/manifest.json'), 'utf8'));
if (assetManifest.packageVersion !== packageVersion || !Array.isArray(assetManifest.assets) || assetManifest.assets.length !== 7) throw new Error('The pinned local MediaPipe asset manifest is invalid.');
for (const asset of assetManifest.assets) {
  if (!/^\/(mediapipe\/wasm\/[^/]+|models\/pose_landmarker_lite\.task)$/.test(asset.path)) throw new Error('Unexpected MediaPipe asset path.');
  const localBytes = await readFile(path.join(root, 'public', asset.path));
  if (hash(localBytes) !== asset.sha256 || localBytes.length !== asset.bytes) throw new Error(`Pinned MediaPipe asset changed: ${asset.path}`);
}
if (await fileHash(path.join(root, 'public/models/pose_landmarker_lite.task')) !== modelSha256) throw new Error('The local pose model failed its pinned SHA-256 check.');
for (const filename of [originalPath, copiedPath]) {
  if (await fileHash(filename) !== source.sourceSha256) throw new Error(`Source SHA-256 mismatch: ${filename}`);
}
const configuration = {
  schemaVersion, view, ...source, width, height, fps, sampleRateHz: fps,
  sourceDurationSeconds: source.frameCount / fps, packageVersion, modelSha256, modelOptions,
  assetHashes: assetManifest.assets.map(({ path: assetPath, sha256 }) => ({ path: assetPath, sha256 })),
  samplingPolicy: 'One actual decoded-video inference for every source frame in increasing order, seeking to frameIndex / 30 + 0.001 seconds; inference timestamp is frameIndex / 30 * 1000 + 1 ms.',
  presencePolicy: 'Model visibility is preserved. Presence is copied when returned by MediaPipe and null when absent; null is not a zero confidence estimate.',
  resumePolicy: 'Each launch creates a fresh model for this view. When resuming, up to 30 preceding actual frames are inferred to warm tracking state; saved observations are preserved. Inference sessions document resets.',
  landmarkCoordinates: 'landmarks: normalized image x/y and model-relative z; worldLandmarks: model-estimated meters in the pose coordinate system, not calibrated multi-camera reconstruction.',
};
const configurationSha256 = hash(JSON.stringify(configuration));
const validateSample = (sample, frameIndex) => {
  if (sample.frameIndex !== frameIndex || !Number.isFinite(sample.tMs) || Math.abs(sample.tMs - frameIndex * 1000 / fps) > 1e-6
      || !['pose', 'no_pose', 'inference_error'].includes(sample.status)
      || !Array.isArray(sample.landmarks) || !Array.isArray(sample.worldLandmarks)) throw new Error(`Invalid saved observation at frame ${frameIndex}.`);
  if (sample.status === 'pose') {
    for (const points of [sample.landmarks, sample.worldLandmarks]) {
      if (points.length !== 33 || points.some((point, index) => point.index !== index
          || ![point.x, point.y, point.z, point.visibility].every(Number.isFinite)
          || point.visibility < 0 || point.visibility > 1
          || (point.presence !== null && (!Number.isFinite(point.presence) || point.presence < 0 || point.presence > 1)))) {
        throw new Error(`Invalid saved 33-point output at frame ${frameIndex}.`);
      }
    }
  } else if (sample.landmarks.length || sample.worldLandmarks.length) throw new Error(`Missing/error frame ${frameIndex} contains fabricated or stale points.`);
};
const atomicJson = async (filename, value) => {
  const temporary = `${filename}.${process.pid}.preparing`;
  await writeFile(temporary, JSON.stringify(value) + '\n');
  await rename(temporary, filename);
};
const existingJson = async (filename) => {
  try { return JSON.parse(await readFile(filename, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
};
const complete = await existingJson(outputPath);
if (complete) {
  if (complete.configurationSha256 !== configurationSha256 || complete.samples?.length !== source.frameCount || !complete.complete) throw new Error('Existing output does not match this extraction configuration; preserve and inspect it before replacing it.');
  complete.samples.forEach(validateSample);
  console.log(`${view}: existing complete output verified (${complete.samples.length} frames): ${outputPath}`);
  process.exit(0);
}

const samples = [], sessions = new Map();
const chunkNames = (await readdir(chunkDirectory)).filter((name) => /^\d{6}-\d{6}\.json$/.test(name)).sort();
for (const filename of chunkNames) {
  const chunk = await existingJson(path.join(chunkDirectory, filename));
  if (chunk.configurationSha256 !== configurationSha256 || chunk.startFrame !== samples.length
      || chunk.endFrameExclusive <= chunk.startFrame || chunk.endFrameExclusive > source.frameCount
      || chunk.endFrameExclusive - chunk.startFrame !== chunk.samples?.length) throw new Error(`Noncontiguous or incompatible extraction checkpoint: ${filename}`);
  chunk.samples.forEach((sample, index) => validateSample(sample, chunk.startFrame + index));
  samples.push(...chunk.samples);
  sessions.set(chunk.inferenceSession.id, chunk.inferenceSession);
}
console.log(`${view}: ${samples.length}/${source.frameCount} saved frames; verifying assets served by ${baseUrl}.`);
for (const asset of [...assetManifest.assets, { path: source.src, sha256: source.sourceSha256 }]) {
  const response = await fetch(`${baseUrl}${asset.path}`, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok || hash(Buffer.from(await response.arrayBuffer())) !== asset.sha256) throw new Error(`The local server serves different or missing bytes: ${asset.path}`);
}

const bundle = await build({
  stdin: { contents: 'export { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";', resolveDir: root, loader: 'js' },
  bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'DualViewMediaPipe', target: 'es2022',
});
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const inferenceSession = {
  id: randomUUID(), startedAt: new Date().toISOString(), startFrame: samples.length,
  warmupStartFrame: Math.max(0, samples.length - resumeWarmupFrames),
  warmupFrames: Math.min(samples.length, resumeWarmupFrames),
  browserVersion: browser.version(), delegate: 'CPU',
};
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(60_000);
  await page.route('**/__dual_view_pose_extract', (route) => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Actual recorded dual-view pose extraction</title><body></body>',
  }));
  await page.goto(`${baseUrl}/__dual_view_pose_extract`);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const decoded = await page.evaluate(async ({ source, modelOptions, fps, resumeWarmupFrames, nextFrame }) => {
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.preload = 'auto';
    video.width = 640; video.height = 360; document.body.append(video);
    const wait = (event) => new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); video.removeEventListener(event, success); video.removeEventListener('error', failed); };
      const success = () => { cleanup(); resolve(); };
      const failed = () => { cleanup(); reject(new Error(`Source video ${event} failed: ${video.error?.message || 'decode error'}`)); };
      const timer = setTimeout(() => { cleanup(); reject(new Error(`Source video ${event} timed out.`)); }, 30_000);
      video.addEventListener(event, success, { once: true }); video.addEventListener('error', failed, { once: true });
    });
    const loaded = wait('loadeddata'); video.src = source.src; video.load(); await loaded;
    if (video.videoWidth !== 640 || video.videoHeight !== 360 || Math.abs(video.duration - source.frameCount / fps) > 0.05) throw new Error('Decoded source dimensions/duration differ from the audited source.');
    const vision = await DualViewMediaPipe.FilesetResolver.forVisionTasks('/mediapipe/wasm');
    const model = await DualViewMediaPipe.PoseLandmarker.createFromOptions(vision, modelOptions);
    const seekFrame = async (frameIndex) => {
      const requestedSeekSeconds = Math.min(frameIndex / fps + 0.001, video.duration - 0.0001);
      if (Math.abs(video.currentTime - requestedSeekSeconds) > 1e-7) {
        const sought = wait('seeked'); video.currentTime = requestedSeekSeconds; await sought;
      }
      return { requestedSeekSeconds, videoCurrentTimeSeconds: video.currentTime };
    };
    window.dualViewExtractor = { video, model, seekFrame, fps };
    for (let frameIndex = Math.max(0, nextFrame - resumeWarmupFrames); frameIndex < nextFrame; frameIndex++) {
      await seekFrame(frameIndex);
      const result = model.detectForVideo(video, frameIndex * 1000 / fps + 1); result.close();
    }
    return { width: video.videoWidth, height: video.videoHeight, durationMs: video.duration * 1000 };
  }, { source, modelOptions, fps, resumeWarmupFrames, nextFrame: samples.length });
  while (samples.length < source.frameCount) {
    const startFrame = samples.length, endFrameExclusive = Math.min(startFrame + chunkSize, source.frameCount);
    const observed = await page.evaluate(async ({ startFrame, endFrameExclusive }) => {
      const { video, model, seekFrame, fps } = window.dualViewExtractor;
      const points = (landmarks) => landmarks.map((point, index) => {
        if (![point.x, point.y, point.z, point.visibility].every(Number.isFinite)
            || point.visibility < 0 || point.visibility > 1
            || (point.presence !== undefined && (!Number.isFinite(point.presence) || point.presence < 0 || point.presence > 1))) throw new Error('MediaPipe returned a nonfinite or invalid landmark.');
        return { index, x: point.x, y: point.y, z: point.z, visibility: point.visibility, presence: point.presence ?? null };
      });
      const observed = [];
      for (let frameIndex = startFrame; frameIndex < endFrameExclusive; frameIndex++) {
        // A seek/decode failure aborts the chunk; it must not masquerade as absent body tracking.
        const seek = await seekFrame(frameIndex);
        const sample = { frameIndex, tMs: frameIndex * 1000 / fps, sourceTimeSeconds: frameIndex / fps,
          inferenceTimestampMs: frameIndex * 1000 / fps + 1, ...seek };
        let result;
        try {
          result = model.detectForVideo(video, sample.inferenceTimestampMs);
          const normalized = result.landmarks[0], world = result.worldLandmarks[0];
          if (!normalized?.length) observed.push({ ...sample, status: 'no_pose', landmarks: [], worldLandmarks: [] });
          else {
            if (normalized.length !== 33 || world?.length !== 33) throw new Error('Detected pose does not contain both expected 33-point landmark arrays.');
            observed.push({ ...sample, status: 'pose', landmarks: points(normalized), worldLandmarks: points(world) });
          }
        } catch (error) {
          observed.push({ ...sample, status: 'inference_error', landmarks: [], worldLandmarks: [], error: String(error?.message || error) });
        } finally { result?.close(); }
      }
      return observed;
    }, { startFrame, endFrameExclusive });
    observed.forEach((sample, index) => validateSample(sample, startFrame + index));
    const chunk = { schemaVersion: 'dual-view-full-pose-chunk-v1', configurationSha256, view,
      startFrame, endFrameExclusive, inferenceSession, samples: observed };
    await atomicJson(path.join(chunkDirectory, `${String(startFrame).padStart(6, '0')}-${String(endFrameExclusive).padStart(6, '0')}.json`), chunk);
    samples.push(...observed); sessions.set(inferenceSession.id, inferenceSession);
    const counts = observed.reduce((total, sample) => ({ ...total, [sample.status]: (total[sample.status] || 0) + 1 }), {});
    console.log(`${view}: ${samples.length}/${source.frameCount} frames (${(samples.length / source.frameCount * 100).toFixed(1)}%); last ${observed.length}: ${JSON.stringify(counts)}`);
  }
  await page.evaluate(() => { window.dualViewExtractor?.model.close(); window.dualViewExtractor?.video.remove(); });
  for (const filename of [originalPath, copiedPath]) {
    if (await fileHash(filename) !== source.sourceSha256) throw new Error(`Source changed while processing: ${filename}. Final output was not saved.`);
  }
  const statusCounts = samples.reduce((total, sample) => ({ ...total, [sample.status]: (total[sample.status] || 0) + 1 }), {});
  const output = { ...configuration, configurationSha256, sourcePath: originalPath, copiedSourcePath: copiedPath,
    provenance: 'Actual local MediaPipe Pose Landmarker Lite float16 v1 CPU inference on every source frame of this recorded view. No live camera data, generated landmarks, interpolation, cross-view fusion or calibrated 3D reconstruction.',
    baseUrl, decoded, complete: true, completedAt: new Date().toISOString(),
    totalSamples: samples.length, statusCounts, inferenceSessions: [...sessions.values()], samples };
  await atomicJson(outputPath, output);
  console.log(`${view}: completed ${samples.length} actual source-frame observations; ${JSON.stringify(statusCounts)}; ${outputPath}`);
} finally { await browser.close(); }
