import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageVersion = '1.1.1';
const modelUrl = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
// Observed from the versioned official model binary, then pinned here. A change
// requires deliberate verification; never silently accept a different model.
const modelSha256 = '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a';
const destination = path.join(root, 'public', 'mediapipe');
const packageDirectory = path.join(root, 'node_modules', '@mediapipe', 'tasks-vision');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

try {
  const installed = JSON.parse(await readFile(path.join(packageDirectory, 'package.json'), 'utf8'));
  if (installed.version !== packageVersion) {
    throw new Error(`Expected @mediapipe/tasks-vision ${packageVersion}; found ${installed.version}. Run npm ci.`);
  }
  await mkdir(path.join(destination, 'wasm'), { recursive: true });
  const assets = [];
  for (const filename of [
    'vision_wasm_internal.js', 'vision_wasm_internal.wasm',
    'vision_wasm_module_internal.js', 'vision_wasm_module_internal.wasm',
    'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm',
  ]) {
    const source = path.join(packageDirectory, 'wasm', filename);
    const output = path.join(destination, 'wasm', filename);
    await copyFile(source, output);
    const bytes = await readFile(output);
    assets.push({ path: `/mediapipe/wasm/${filename}`, bytes: bytes.byteLength, sha256: hash(bytes) });
  }
  await mkdir(path.join(root, 'public', 'models'), { recursive: true });
  const modelPath = path.join(root, 'public', 'models', 'pose_landmarker_lite.task');
  let model;
  try {
    const bytes = await readFile(modelPath);
    if (hash(bytes) === modelSha256) model = bytes;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!model) {
    console.log('Downloading official Pose Landmarker Lite float16 v1 model…');
    const response = await fetch(modelUrl, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Model download failed: HTTP ${response.status}`);
    model = Buffer.from(await response.arrayBuffer());
    if (model.length > 25 * 1024 * 1024 || hash(model) !== modelSha256) {
      throw new Error('Model integrity check failed. The existing model has not been replaced.');
    }
    const stagedPath = `${modelPath}.download`;
    await writeFile(stagedPath, model);
    await rename(stagedPath, modelPath);
  }
  assets.push({ path: '/models/pose_landmarker_lite.task', bytes: model.byteLength, sha256: modelSha256 });
  await writeFile(path.join(destination, 'manifest.json'), JSON.stringify({
    package: '@mediapipe/tasks-vision', packageVersion,
    model: 'pose_landmarker_lite float16 v1', modelUrl, assets,
    note: 'All runtime assets are served locally. The versioned model hash is pinned in scripts/setup-assets.mjs.',
  }, null, 2) + '\n');
  console.log(`Ready: ${assets.length} verified local assets in public/mediapipe/wasm and public/models.`);
  console.log(`Model SHA256: ${modelSha256}`);
} catch (error) {
  console.error(`MediaPipe asset setup failed: ${error.message}`);
  console.error('Run npm ci, check network access to storage.googleapis.com, then retry npm run setup:assets. No synthetic fallback is enabled.');
  process.exitCode = 1;
}
