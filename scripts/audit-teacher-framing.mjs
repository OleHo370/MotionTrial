import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// This audit only reads existing observations. It never crops video, extracts poses,
// alters source data, or supplies smoothed coordinates to a matcher.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/practice-media/dual-view/manifest.json'), 'utf8'));
const crops = {
  front: { x: 0.30, y: 0.18, width: 0.40, height: 0.73 },
  back: { x: 0.29, y: 0.14, width: 0.42, height: 0.77 },
};
const threshold = 0.65;
const outside = (point, crop) => point.x < crop.x || point.x > crop.x + crop.width || point.y < crop.y || point.y > crop.y + crop.height;
const trusted = (point) => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.visibility)
  && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1
  && point.visibility >= threshold && point.visibility <= 1
  && (point.presence === undefined || (Number.isFinite(point.presence) && point.presence >= threshold && point.presence <= 1));
const median = (values) => { values.sort((a, b) => a - b); return values[Math.floor(values.length / 2)]; };
const frameCount = (points) => new Set(points.map((point) => `${point.formId}:${point.frameIndex}`)).size;
function extrema(points) {
  if (!points.length) return null;
  const min = (key) => points.reduce((best, point) => point[key] < best[key] ? point : best);
  const max = (key) => points.reduce((best, point) => point[key] > best[key] ? point : best);
  return { left: min('x'), right: max('x'), top: min('y'), bottom: max('y') };
}
function statistics(points, crop) {
  const excluded = points.filter((point) => outside(point, crop));
  const edge = extrema(points);
  return { pointCount: points.length, frameCount: frameCount(points),
    bounds: edge ? { left: edge.left.x, top: edge.top.y, right: edge.right.x, bottom: edge.bottom.y } : null,
    outsideCropPointCount: excluded.length, outsideCropPointRatio: excluded.length / Math.max(1, points.length),
    outsideCropFrameCount: frameCount(excluded), outsideCropFrameRatio: frameCount(excluded) / Math.max(1, frameCount(points)),
    coverageRatio: 1 - excluded.length / Math.max(1, points.length) };
}

const files = [], views = {};
for (const view of ['front', 'back']) {
  const raw = [], smoothed = [];
  let missingFrames = 0;
  for (const form of manifest.forms) {
    const src = form[view].poseSrc, bytes = fs.readFileSync(path.join(root, 'public', src));
    const data = JSON.parse(bytes.toString('utf8'));
    if (data.view !== view || data.formNumber !== form.formNumber || data.sourceSha256 !== manifest.sources[view].sha256) {
      throw new Error(`Observation provenance does not match ${view} ${form.id}.`);
    }
    const tracks = new Map(), formRaw = [];
    for (const sample of data.samples) {
      if (sample.status !== 'pose') { missingFrames++; continue; }
      for (const point of sample.landmarks) {
        if (!trusted(point)) continue;
        const record = { index: point.index, x: point.x, y: point.y, visibility: point.visibility,
          presence: point.presence ?? null, formId: form.id, formNumber: form.formNumber,
          frameIndex: sample.frameIndex, sourceTimeSeconds: sample.sourceTimeSeconds,
          frameTimeSeconds: sample.frameIndex / data.fps, poseSrc: src };
        raw.push(record); formRaw.push(record);
        if (!tracks.has(point.index)) tracks.set(point.index, new Map());
        tracks.get(point.index).set(sample.frameIndex, record);
      }
    }
    // A 7-source-frame coordinate median suppresses isolated glitches. Every window
    // needs >=4 actual trusted observations. It is used only for this display audit;
    // these coordinate medians are not claimed to be new observed landmarks.
    for (const [index, track] of tracks) for (const [frameIndex, point] of track) {
      const support = Array.from({ length: 7 }, (_, offset) => track.get(frameIndex + offset - 3)).filter(Boolean);
      if (support.length < 4) continue;
      smoothed.push({ index, x: median(support.map((p) => p.x)), y: median(support.map((p) => p.y)),
        formId: point.formId, formNumber: point.formNumber, frameIndex, sourceTimeSeconds: point.sourceTimeSeconds,
        supportFrameIndices: support.map((p) => p.frameIndex) });
    }
    files.push({ view, formId: form.id, formNumber: form.formNumber, src,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'), sourceSha256: data.sourceSha256,
      modelSha256: data.modelSha256, sampleCount: data.samples.length,
      rawTrusted: statistics(formRaw, crops[view]) });
  }
  const crop = crops[view], source = manifest.sources[view];
  views[view] = { crop, pixelCrop: { x: crop.x * source.width, y: crop.y * source.height,
    width: crop.width * source.width, height: crop.height * source.height },
    sourceSize: { width: source.width, height: source.height },
    sourceSha256: source.sha256, missingFrames,
    rawTrusted: statistics(raw, crop), temporalMedianForDisplayAuditOnly: statistics(smoothed, crop),
    actualExtremeFrames: extrema(raw),
    screenshotReview: Object.entries(extrema(raw)).map(([edge, point]) => ({ edge, view, formId: point.formId,
      formNumber: point.formNumber, sourceTimeSeconds: point.sourceTimeSeconds, frameIndex: point.frameIndex,
      landmarkIndex: point.index, sourceVideo: source.src, point: { x: point.x, y: point.y },
      note: 'Actual cached observation; inspect this original source frame visually before claiming full-person coverage.' })) };
}
if (files.length !== 48) throw new Error(`Expected 48 existing observation files; found ${files.length}.`);
const report = {
  schemaVersion: 'teacher-framing-source-audit-v1',
  method: { confidenceThreshold: threshold, coordinates: 'Normalized original source frame; all available 33 Pose indices considered.',
    temporalMedian: { windowSourceFrames: 7, minimumTrustedSupport: 4,
      use: 'Offline crop-box audit only. Coordinate medians are not new observed landmarks and are never used by a matcher.' },
    cropPolicy: 'Fixed rectangle per view for the entire routine. No frame-by-frame tracking or zoom changes.',
    rawCoverageIsPrimary: true, sourceObservationsModified: false, inferenceRun: false },
  limitations: [
    'Coverage counts trusted observed landmarks, not every clothing, hair or fingertip pixel. The crop includes extra margin but requires visual frame review.',
    'Low-confidence and missing points remain unknown. Their absence does not prove the complete body is inside a crop.',
    'Temporal coordinate medians are only an outlier-sensitive display-bounds comparison; raw trusted observations are audited independently.',
    'Cropping is presentation only: original video pixels and original pose/matcher coordinates must remain unchanged.',
    'For mirrored front display, crop and landmark overlay must share the same raw crop transform before the common display mirror.'
  ],
  files, views,
};
const output = path.join(root, 'artifacts/teacher-crop-review/source-framing-audit.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Audited ${files.length} unchanged pose files. Front: ${views.front.rawTrusted.outsideCropPointCount}/${views.front.rawTrusted.pointCount} trusted points outside; back: ${views.back.rawTrusted.outsideCropPointCount}/${views.back.rawTrusted.pointCount} outside.`);
console.log('Saved artifacts/teacher-crop-review/source-framing-audit.json. No source data or videos were changed.');
