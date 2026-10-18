/** Fresh, local MediaPipe world observations for the five current tutorial clips.
 * Uses the immutable exact-PNG schedule; never changes the assessment archive.
 * node scripts/extract-lesson-study-3d.mjs
 */
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(root, 'public');
const directory = path.join(publicRoot, 'practice-media/recut-six');
const outputPath = path.join(directory, 'master.study-3d.poses.json');
const artifacts = path.join(root, 'artifacts/lesson-study-3d-extraction');
const sourceSha256 = '2d62941ddebe1a75febee4423d0040d021a4247440e248f40d7ea1c69b17fab6';
const modelSha256 = '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a';
const schemaVersion = 'first-three-study-3d-world-v1';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async filename => JSON.parse(await readFile(filename, 'utf8'));
const manifest = await json(path.join(directory, 'manifest.json'));
const schedule = await json(path.join(directory, 'schedule.json'));
const source = manifest.sources?.[0];
const first = manifest.steps?.[0]?.referenceStartFrame;
const last = manifest.steps?.[4]?.referenceEndFrame;
if (manifest.source?.sha256 !== sourceSha256 || schedule.sourceSha256 !== sourceSha256
  || source?.id !== 'master' || first !== 15 || last !== 465
  || source.video.fps !== 30 || source.video.width !== 450 || source.video.height !== 360) {
  throw new Error('The five-clip source and exact-frame schedule do not match this extraction.');
}
const sourceClipSha256 = source.video.sha256;
const originalPath = path.resolve(root, '..', '..', '24.mp4');
if (hash(await readFile(originalPath)) !== sourceSha256
  || hash(await readFile(path.join(publicRoot, source.video.src))) !== sourceClipSha256
  || schedule.masterSha256 !== sourceClipSha256) {
  throw new Error('The immutable original or continuous master failed its SHA-256 check.');
}
const packageInfo = await json(path.join(root, 'node_modules/@mediapipe/tasks-vision/package.json'));
const assetManifest = await json(path.join(publicRoot, 'mediapipe/manifest.json'));
if (packageInfo.version !== '1.1.1' || assetManifest.packageVersion !== '1.1.1') {
  throw new Error('Expected pinned MediaPipe Tasks Vision 1.1.1.');
}
for (const asset of assetManifest.assets) {
  if (!/^\/(mediapipe\/wasm\/[^/]+|models\/pose_landmarker_lite\.task)$/.test(asset.path)) {
    throw new Error('Unexpected pinned MediaPipe asset path.');
  }
  const bytes = await readFile(path.join(publicRoot, asset.path));
  if (bytes.length !== asset.bytes || hash(bytes) !== asset.sha256) {
    throw new Error(`Pinned asset changed: ${asset.path}`);
  }
}
if (hash(await readFile(path.join(publicRoot, 'models/pose_landmarker_lite.task'))) !== modelSha256) {
  throw new Error('The pinned local model failed its SHA-256 check.');
}
const frames = schedule.frames.filter(frame => frame.sourceFrameIndex >= first && frame.sourceFrameIndex <= last);
if (!frames.length || frames[0].sourceFrameIndex !== first || frames.at(-1).sourceFrameIndex !== last
  || frames.some((frame, i) => frame.frameIndex !== frame.sourceFrameIndex || !frame.inferenceEligible
    || frame.width !== 450 || frame.height !== 360 || i > 0 && frame.sourceFrameIndex <= frames[i - 1].sourceFrameIndex
    || Math.abs(frame.tMs - frame.sourceFrameIndex * 1000 / 30) > 1e-6
    || !/^\/practice-media\/recut-six\/inference-frames\/frame-\d{6}\.png$/.test(frame.pngSrc))) {
  throw new Error('The exact-PNG inference schedule is invalid.');
}
for (const frame of frames) {
  if (hash(await readFile(path.join(publicRoot, frame.pngSrc))) !== frame.pngSha256) {
    throw new Error(`Exact original PNG changed at frame ${frame.sourceFrameIndex}.`);
  }
}
const protectedPaths = [path.join(directory, 'master.poses.json'), path.join(directory, 'master.mp4'),
  path.join(directory, 'manifest.json'), path.join(directory, 'schedule.json')];
const protectedHashes = await Promise.all(protectedPaths.map(async filename => hash(await readFile(filename))));
const validPoints = points => Array.isArray(points) && points.length === 33 && points.every((point, index) =>
  point?.index === index && [point.x, point.y, point.z, point.visibility].every(Number.isFinite)
  && point.visibility >= 0 && point.visibility <= 1
  && (point.presence === null || Number.isFinite(point.presence) && point.presence >= 0 && point.presence <= 1));
const validSamples = samples => Array.isArray(samples) && samples.length === frames.length
  && samples.every((sample, index) => sample?.frameIndex === frames[index].sourceFrameIndex
    && sample.sourceFrameIndex === sample.frameIndex && sample.inputPngSha256 === frames[index].pngSha256
    && Math.abs(sample.tMs - frames[index].tMs) < 1e-6
    && Math.abs(sample.sourceTimeSeconds - frames[index].sourceTimeSeconds) < 1e-6
    && (sample.status === 'pose' ? validPoints(sample.landmarks) && validPoints(sample.worldLandmarks)
      : ['no_pose', 'inference_error'].includes(sample.status) && sample.landmarks?.length === 0 && sample.worldLandmarks?.length === 0));
try {
  await access(outputPath);
  const saved = await json(outputPath);
  if (saved.schemaVersion !== schemaVersion || saved.sourceSha256 !== sourceSha256
    || saved.sourceClipSha256 !== sourceClipSha256 || saved.modelSha256 !== modelSha256
    || !validSamples(saved.samples) || !Number.isFinite(saved.displayYawRadians) || !saved.complete) {
    throw new Error('Existing 3D observations differ from this verified extraction; preserve and inspect them.');
  }
  console.log(JSON.stringify({reused: true, samples: saved.samples.length, statusCounts: saved.statusCounts,
    displayYawRadians: saved.displayYawRadians, output: outputPath}));
  process.exit(0);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const modelOptions = {
  baseOptions: {modelAssetPath: '/models/pose_landmarker_lite.task', delegate: 'CPU'},
  runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: .5,
  minPosePresenceConfidence: .5, minTrackingConfidence: .5, outputSegmentationMasks: false,
};
const bundle = await build({
  stdin: {contents: 'export { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";',
    resolveDir: root, loader: 'js'},
  bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'LessonWorldMediaPipe',
  target: 'es2022', legalComments: 'none',
});
const runtime = bundle.outputFiles[0].text;
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    response.setHeader('Cache-Control', 'no-store');
    if (pathname === '/__lesson_world_extract') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end('<!doctype html><title>Actual recorded teacher world extraction</title>');
      return;
    }
    if (pathname === '/__lesson_world_runtime.js') {
      response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      response.end(runtime);
      return;
    }
    const relative = pathname.replace(/^\//, '');
    const filename = path.resolve(publicRoot, relative);
    if (filename !== publicRoot && !filename.startsWith(publicRoot + path.sep)) throw new Error('Invalid local path.');
    const allowed = /^\/(mediapipe\/wasm\/[^/]+|models\/pose_landmarker_lite\.task|practice-media\/recut-six\/inference-frames\/frame-\d{6}\.png)$/.test(pathname);
    if (!allowed) {response.writeHead(404); response.end(); return;}
    response.setHeader('Content-Type', pathname.endsWith('.wasm') ? 'application/wasm'
      : pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.png') ? 'image/png' : 'application/octet-stream');
    response.end(await readFile(filename));
  } catch (error) {
    response.writeHead(500); response.end('Verified local extraction input unavailable.');
  }
});
await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
const baseUrl = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({channel: 'chrome', headless: true});
  const page = await browser.newPage();
  const progress = [];
  const blockedNetworkOrigins = new Set();
  await page.exposeFunction('reportRecordedWorldProgress', value => {
    progress.push(value);
    console.log(`Actual recorded world inference: ${value.done}/${frames.length} · source frame ${value.frame}`);
  });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === baseUrl || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
    blockedNetworkOrigins.add(url.origin);
    return route.abort('blockedbyclient');
  });
  await page.goto(baseUrl + '/__lesson_world_extract');
  await page.addScriptTag({url: baseUrl + '/__lesson_world_runtime.js'});
  const startedAt = new Date().toISOString();
  const samples = await page.evaluate(async ({frames, modelOptions}) => {
    const canvas = document.createElement('canvas'); canvas.width = 450; canvas.height = 360;
    document.body.append(canvas);
    const context = canvas.getContext('2d');
    const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map(value => value.toString(16).padStart(2, '0')).join('');
    const convert = points => points.map((point, index) => ({index, x: point.x, y: point.y, z: point.z,
      visibility: point.visibility, presence: point.presence === undefined ? null : point.presence}));
    const valid = points => points.length === 33 && points.every((point, index) => point.index === index
      && [point.x, point.y, point.z, point.visibility].every(Number.isFinite)
      && point.visibility >= 0 && point.visibility <= 1
      && (point.presence === null || Number.isFinite(point.presence) && point.presence >= 0 && point.presence <= 1));
    const vision = await LessonWorldMediaPipe.FilesetResolver.forVisionTasks('/mediapipe/wasm');
    const model = await LessonWorldMediaPipe.PoseLandmarker.createFromOptions(vision, modelOptions);
    const samples = [];
    try {
      for (const [number, frame] of frames.entries()) {
        const response = await fetch(frame.pngSrc);
        if (!response.ok) throw new Error('Exact PNG unavailable at frame ' + frame.sourceFrameIndex);
        const bytes = await response.arrayBuffer();
        if (await digest(bytes) !== frame.pngSha256) throw new Error('Served PNG checksum mismatch.');
        const bitmap = await createImageBitmap(new Blob([bytes], {type: 'image/png'}));
        context.drawImage(bitmap, 0, 0); bitmap.close();
        const base = {frameIndex: frame.frameIndex, sourceFrameIndex: frame.sourceFrameIndex,
          sourceTimeSeconds: frame.sourceTimeSeconds, tMs: frame.tMs,
          inputPngSha256: frame.pngSha256, inferenceTimestampMs: frame.tMs + 1};
        let result;
        try {
          result = model.detectForVideo(canvas, base.inferenceTimestampMs);
          const image = result.landmarks?.[0], world = result.worldLandmarks?.[0];
          if (!image?.length) samples.push({...base, status: 'no_pose', landmarks: [], worldLandmarks: []});
          else {
            const landmarks = convert(image), worldLandmarks = convert(world ?? []);
            if (!valid(landmarks) || !valid(worldLandmarks)) throw new Error('Invalid model image/world landmarks.');
            samples.push({...base, status: 'pose', landmarks, worldLandmarks});
          }
        } catch (error) {
          samples.push({...base, status: 'inference_error', landmarks: [], worldLandmarks: [], error: String(error?.message || error)});
        } finally {result?.close();}
        if (number % 32 === 0 || number === frames.length - 1) {
          await reportRecordedWorldProgress({done: number + 1, frame: frame.sourceFrameIndex});
        }
      }
    } finally {model.close();}
    return samples;
  }, {frames, modelOptions});

  if (!validSamples(samples)) throw new Error('The new world observations failed exact-frame validation.');

  // Tasks Vision 1.1.1 flushes its own usage log when closing the model. This
  // remains blocked; no inference inputs or outputs are sent to that origin.
  if ([...blockedNetworkOrigins].some(origin => origin !== 'https://odml.pa.googleapis.com')) {
    throw new Error('An unexpected external origin was blocked during local inference.');
  }

  const confidence = (sample, index) => Math.min(...[sample.landmarks[index], sample.worldLandmarks[index]]
    .flatMap(point => [point?.visibility, point?.presence]).map(value => Number.isFinite(value) ? value : -1));
  const baselineSamples = samples.filter(sample => sample.sourceFrameIndex >= first && sample.sourceFrameIndex <= first + 15
    && sample.status === 'pose' && [11, 12].every(index => confidence(sample, index) >= .45));
  const angles = baselineSamples.map(sample => {
    const left = sample.worldLandmarks[11], right = sample.worldLandmarks[12];
    return Math.atan2(-(left.z - right.z), left.x - right.x);
  }).sort((a, b) => a - b);
  if (angles.length < 3) throw new Error('Initial shoulder observations cannot support a fixed display-facing rotation.');
  const displayYawRadians = angles.length % 2 ? angles[(angles.length - 1) / 2]
    : (angles[angles.length / 2 - 1] + angles[angles.length / 2]) / 2;
  const statusCounts = samples.reduce((counts, sample) => (counts[sample.status] = (counts[sample.status] || 0) + 1, counts), {});
  if (!samples.some(sample => sample.status === 'pose')) throw new Error('No genuine teacher world observations were obtained.');
  for (const [index, filename] of protectedPaths.entries()) {
    if (hash(await readFile(filename)) !== protectedHashes[index]) throw new Error('An immutable practice source changed during extraction.');
  }
  const output = {schemaVersion, extractionVersion: 'lesson-five-exact-png-world-v1', sourceId: source.id,
    sourceFile: '24.mp4', view: 'front', sourceSha256, sourceClipSha256, modelSha256,
    packageVersion: '1.1.1', fps: 30, width: 450, height: 360, sampleRateHz: 15,
    durationMs: source.video.durationSeconds * 1000, sourceStartSeconds: first / 30, sourceEndSeconds: last / 30,
    coverage: {firstFrame: first, lastFrameInclusive: last, sampleCount: samples.length,
      note: 'First five teaching intervals plus their actual shared final held frame.'},
    displayYawRadians, displayYawProvenance: {policy: 'Fixed body-relative display rotation; not calibrated camera geometry.',
      method: 'Median atan2(-shoulderDeltaZ, shoulderDeltaX) of actual anatomical left-minus-right world shoulder observations.',
      confidenceThreshold: .45, referenceFrames: baselineSamples.map(sample => sample.sourceFrameIndex),
      referenceSeconds: [first / 30, (first + 15) / 30]},
    coordinatePolicy: 'Raw image and model-estimated world coordinates are preserved. Rendering uses x,-y,-z, hip centering and a fixed initial-stance yaw; no reconstructed travel or foot contact.',
    modelOptions, provenance: 'Actual local MediaPipe Pose Landmarker Lite float16 v1 CPU VIDEO inference on SHA-256 verified lossless original 24.mp4 PNGs at exact source frame IDs. One continuous model session. All runtime assets and inputs are local; external requests, including SDK usage logging, are blocked. Newly observed image and world coordinates; original assessment landmarks remain unchanged. Recorded teacher data, not live camera results or calibrated 3D reconstruction.',
    samplingPolicy: '15 Hz exact-PNG observations plus teaching boundaries, source frames 15 through 465 inclusive. No interpolation, future observations, cross-recording borrowing or synthesized joints.',
    landmarkCoordinates: 'landmarks: normalized image x/y and model-relative z; worldLandmarks: model-estimated meters relative to the pose, not calibrated multi-view reconstruction.',
    presencePolicy: 'Visibility and presence are preserved when supplied; absent presence is null and remains unknown.',
    complete: true, startedAt, completedAt: new Date().toISOString(), statusCounts, samples};
  await writeFile(outputPath, JSON.stringify(output) + '\n', {flag: 'wx'});
  await mkdir(artifacts, {recursive: true});
  await writeFile(path.join(artifacts, 'verification.json'), JSON.stringify({sourceSha256, sourceClipSha256,
    modelSha256, sampleCount: samples.length, statusCounts, displayYawRadians, displayYawProvenance: output.displayYawProvenance,
    protectedArchivesUnchanged: true, allowedExternalNetworkRequests: 0,
    blockedSdkUsageLoggingOrigins: [...blockedNetworkOrigins],
    outputSha256: hash(await readFile(outputPath)), progress}, null, 2) + '\n');
  console.log(JSON.stringify({saved: true, samples: samples.length, statusCounts, displayYawRadians,
    bytes: (await readFile(outputPath)).length, protectedArchivesUnchanged: true, output: outputPath}));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
