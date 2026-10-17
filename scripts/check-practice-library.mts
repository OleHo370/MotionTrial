/** Check recorded-video cache provenance against the actual local clip bytes. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { evaluatePracticeAttempt, type PoseSample } from '../lib/imitation';

const root = process.cwd();
const publicRoot = path.join(root, 'public');
const asset = (url: string) => {
  if (!/^\/practice-media\/[a-zA-Z0-9_.-]+$/.test(url) || url.includes('..')) throw new Error(`Invalid local asset: ${url}`);
  return path.join(publicRoot, url);
};
const json = async (file: string) => JSON.parse(await readFile(file, 'utf8'));
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const modelHash = hash(await readFile(path.join(publicRoot, 'models/pose_landmarker_lite.task')));
const library = await json(asset('/practice-media/library.json'));
if (!library.routines.some((item: {id: string}) => item.id === library.defaultId)) throw new Error('Unknown default routine.');
const reports = [];
for (const routine of library.routines) {
  const playlist = await json(asset(routine.src));
  const clips = [];
  if (!playlist.clips.length) throw new Error(`${routine.id}: empty playlist`);
  for (const clip of playlist.clips) {
    const clipHash = hash(await readFile(asset(clip.src)));
    if (clipHash !== clip.sha256 || !clip.referencePoseSrc) throw new Error(`${clip.id}: video hash or recorded pose path mismatch`);
    const recorded = await json(asset(clip.referencePoseSrc));
    if (recorded.schemaVersion !== 'recorded-reference-pose-v1' || recorded.modelSha256 !== modelHash || recorded.sourceClipSha256 !== clipHash || recorded.clipId !== clip.id || recorded.src !== clip.src || recorded.width !== clip.width || recorded.height !== clip.height || Math.abs(recorded.durationMs - clip.durationSeconds * 1000) > 100) throw new Error(`${clip.id}: recorded reference provenance mismatch`);
    let previous = -1;
    for (const sample of recorded.samples as PoseSample[]) {
      if (!Number.isFinite(sample.tMs) || sample.tMs <= previous || sample.tMs < 0 || sample.tMs > recorded.durationMs || !['pose', 'no_pose', 'inference_error'].includes(sample.status) || (sample.status !== 'pose' && sample.landmarks.length)) throw new Error(`${clip.id}: invalid observation`);
      previous = sample.tMs;
    }
    const result = evaluatePracticeAttempt(recorded.samples, recorded.samples, {
      referenceAspectRatio: recorded.width / recorded.height, attemptAspectRatio: recorded.width / recorded.height,
      referenceDurationMs: recorded.durationMs, attemptDurationMs: recorded.durationMs, focusJoints: clip.focusJoints,
    });
    if (result.status !== 'matched') throw new Error(`${clip.id}: reference cannot be compared: ${result.reason}`);
    clips.push({ id: clip.id, sha256: clipHash, observations: recorded.samples.length, durationSeconds: clip.durationSeconds, selfCheck: result.status, referenceCoverage: result.diagnostics.referenceCoverage });
  }
  reports.push({ id: routine.id, title: routine.title, sourceFile: routine.sourceFile, clips });
  console.log(`${routine.id}: ${clips.length}/${playlist.clips.length} recorded references verified`);
}
const report = { modelSha256: modelHash, provenance: 'Actual saved MediaPipe observations of recorded instructors. Integrity and reference self-comparison only; no physical-camera or person-imitation claim.', defaultId: library.defaultId, routines: reports, totalClips: reports.reduce((sum, item) => sum + item.clips.length, 0), totalObservations: reports.reduce((sum, item) => sum + item.clips.reduce((total, clip) => total + clip.observations, 0), 0) };
await mkdir(path.join(root, 'artifacts/practice-library-qa'), { recursive: true });
await writeFile(path.join(root, 'artifacts/practice-library-qa/integrity.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`${report.totalClips} clips / ${report.totalObservations} actual recorded observations verified.`);
