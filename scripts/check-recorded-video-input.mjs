/** Pure lifecycle fixtures only: no real video/model, webcam, API or hardware calls. */
import assert from 'node:assert/strict';
import {RECORDED_VIDEO_LIMITS, validateRecordedVideoFile, loadRecordedVideo, extractRecordedVideoPoses}
  from '../public/recorded-video-input.js';

const checks = [];
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {resolve, promise};};
const pose = () => ({status: 'pose', landmarks: Array.from({length: 33}, (_, index) =>
  ({index, x: .5, y: .5, z: 0, visibility: .9}))});

class FixtureVideo extends EventTarget {
  constructor({duration = .4, frameRate = 30, callbacks = true, stalled = false, stalledSeek = false,
    decodedTimeForRequest, failAt} = {}) {
    super();
    this.duration = duration; this.frameRate = frameRate; this.readyState = 2;
    this.videoWidth = 640; this.videoHeight = 480; this.seeking = false;
    this._currentTime = 0; this.src = ''; this.stalled = stalled; this.stalledSeek = stalledSeek;
    this.decodedTimeForRequest = decodedTimeForRequest; this.failAt = failAt;
    this._frames = new Map(); this._id = 0; this.loads = 0; this.pauses = 0;
    if (!callbacks) this.requestVideoFrameCallback = undefined;
  }
  pause() {this.pauses++;}
  load() {
    this.loads++;
    if (this.src && !this.stalled) queueMicrotask(() => this.dispatchEvent(new Event('loadedmetadata')));
  }
  getAttribute(name) {return name === 'src' ? this.src : null;}
  removeAttribute(name) {if (name === 'src') this.src = '';}
  requestVideoFrameCallback(callback) {const id = ++this._id; this._frames.set(id, callback); return id;}
  cancelVideoFrameCallback(id) {this._frames.delete(id);}
  get currentTime() {return this._currentTime;}
  set currentTime(time) {
    this._currentTime = time; this.seeking = true; this.error = null;
    if (this.stalledSeek) return;
    queueMicrotask(() => {
      this.seeking = false;
      if (this.failAt?.(time)) {
        this.error = {code: 3}; this.dispatchEvent(new Event('error')); return;
      }
      this.dispatchEvent(new Event('seeked'));
      const callbacks = [...this._frames.entries()]; this._frames.clear();
      for (const [, callback] of callbacks) callback(123456,
        {mediaTime: this.decodedTimeForRequest?.(time) ?? Math.floor(time * this.frameRate + .000001) / this.frameRate});
    });
  }
}

{
  const valid = new File(['fixture bytes, not a playable video'], 'tai-chi.mp4', {type: 'video/mp4'});
  assert.equal(validateRecordedVideoFile(valid).size, valid.size);
  assert.throws(() => validateRecordedVideoFile(new File([], 'empty.mp4', {type: 'video/mp4'})), /non-empty/);
  assert.throws(() => validateRecordedVideoFile(new File(['x'], 'pose.png', {type: 'image/png'})), /video file/);
  assert.throws(() => validateRecordedVideoFile({name: 'large.mp4', type: 'video/mp4', size: RECORDED_VIDEO_LIMITS.maxFileBytes + 1}), /500 MB/);
  assert.doesNotThrow(() => validateRecordedVideoFile({name: 'phone.MOV', type: '', size: 4}));
  checks.push('Empty, non-video and oversized files are rejected before object URL creation; browser-typed and extension-typed videos are accepted for decoding checks.');
}
{
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  const revoked = [];
  URL.createObjectURL = () => 'blob:fixture-local';
  URL.revokeObjectURL = url => revoked.push(url);
  try {
    const file = new File(['fixture'], 'tai-chi.mp4', {type: 'video/mp4'});
    const video = new FixtureVideo({duration: 12});
    const loaded = await loadRecordedVideo(video, file);
    assert.equal(loaded.duration, 12); assert.equal(loaded.width, 640); assert.equal(loaded.height, 480);
    assert.equal(video.muted, true); loaded.dispose(); loaded.dispose();
    assert.deepEqual(revoked, ['blob:fixture-local']); assert.equal(video.src, '');
    const tooLong = new FixtureVideo({duration: 601});
    await assert.rejects(loadRecordedVideo(tooLong, file), /10 minutes/);
    assert.equal(tooLong.src, '');
    const stalled = new FixtureVideo({stalled: true}); stalled.readyState = 0;
    const controller = new AbortController();
    const loading = loadRecordedVideo(stalled, file, {signal: controller.signal});
    controller.abort(); await assert.rejects(loading, {name: 'AbortError'});
    assert.equal(stalled.src, ''); assert.equal(revoked.length, 3);
    const decoding = new FixtureVideo({stalled: true}); decoding.readyState = 0;
    const pending = loadRecordedVideo(decoding, file);
    decoding.error = {code: 4}; decoding.dispatchEvent(new Event('error'));
    await assert.rejects(pending, /cannot decode/); assert.equal(revoked.length, 4);
    checks.push('Metadata success, browser codec failure, duration rejection and cancellation all clean up owned object URLs; disposal is idempotent.');
  } finally {URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke;}
}
{
  const video = new FixtureVideo({frameRate: 10}), clocks = [], progress = [], observed = [];
  let closed = 0;
  const result = await extractRecordedVideoPoses(video, {sampleRateHz: 12,
    createPoseClient: async () => ({estimate(input, time) {assert.equal(input, video); clocks.push(time); return pose();}, close() {closed++;}}),
    onProgress: value => progress.push(value), onSample: sample => observed.push(sample)});
  assert.equal(result.samples.length, 4); assert.equal(observed.length, 4); assert.equal(closed, 1);
  assert.equal(result.provenance.skippedSampleCount, 1);
  assert.equal(result.provenance.skippedRequests[0].status, 'duplicate_frame');
  assert.equal(result.provenance.skippedRequests[0].tMs, 0);
  assert.equal(result.provenance.skippedRequests[0].requestedTimeSeconds, 1 / 12);
  assert.deepEqual(clocks, [0, 100, 200, 300]);
  assert.equal(result.samples[1].timestampSource, 'video-frame-mediaTime');
  assert.equal(result.samples[1].sourceTimeSeconds, .1);
  assert.equal(result.provenance.requestedSamples, 5); assert.equal(result.provenance.emittedSamples, 4);
  assert.deepEqual(result.samples.map(sample => sample.tMs), clocks);
  assert.equal(progress[0].completed, 0); assert.equal(progress.at(-1).percent, 100);
  assert.equal(progress.at(-1).completed, 5);
  assert.equal(video._frames.size, 0); assert.equal(result.provenance.missingData, 'explicit-unknown-no-interpolation');
  checks.push('Inference and emitted samples retain strictly increasing decoded timestamps; duplicate low-frame-rate images become explicit skipped-request gaps, with no fabricated timestamps or landmarks.');
}
{
  const video = new FixtureVideo({duration: .5, decodedTimeForRequest: time => time + .1,
    failAt: time => Math.abs(time - (.1 + 1 / 12)) < .000001});
  const clocks = [];
  const result = await extractRecordedVideoPoses(video, {ranges: [{startSeconds: .1, endSeconds: .4}],
    createPoseClient: async () => ({estimate(_input, time) {clocks.push(time); return pose();}, close() {}})});
  assert.equal(result.samples[0].tMs, 200); assert.equal(clocks[0], 200);
  assert.equal(result.provenance.skippedSampleCount, 1);
  const gap = result.provenance.skippedRequests[0];
  assert.equal(gap.status, 'decode_error'); assert.equal(gap.timestampSource, 'requested-time-unobserved');
  assert.ok(gap.tMs < 200); assert.equal(gap.reason, 'non-increasing-source-time');
  assert.ok(result.samples.every((sample, index) => index === 0 || sample.tMs > result.samples[index - 1].tMs));
  assert.deepEqual(result.samples.map(sample => sample.tMs), clocks);
  checks.push('A failed decode whose requested timestamp precedes the last observed frame is preserved as explicit gap metadata, without moving either real observation in time.');
}
{
  const video = new FixtureVideo({callbacks: false, duration: .3}), clocks = [];
  let closed = 0;
  const result = await extractRecordedVideoPoses(video, {sampleRateHz: 10,
    createPoseClient: async () => ({estimate(_input, time) {
      clocks.push(time); if (time === 100) throw new Error('fixture inference failure');
      return time === 200 ? {status: 'no_pose', landmarks: []} : pose();
    }, close() {closed++;}})});
  assert.deepEqual(clocks, [0, 100, 200]); assert.equal(closed, 1);
  assert.deepEqual(result.samples.map(sample => sample.status), ['pose', 'inference_error', 'no_pose']);
  assert.ok(result.samples.every(sample => sample.timestampSource === 'seeked-currentTime'));
  assert.deepEqual(result.samples[1].landmarks, []); assert.deepEqual(result.samples[2].landmarks, []);
  checks.push('Browsers without frame callbacks use explicitly labeled, completed-seek timestamps; model exceptions and absent poses remain separate unknown observations.');
}
{
  const video = new FixtureVideo({callbacks: false, duration: .3});
  const world = Array.from({length: 33}, (_, index) =>
    ({index, x: index * .0123, y: -.2, z: .145, visibility: .84, presence: .73}));
  const result = await extractRecordedVideoPoses(video, {sampleRateHz: 10,
    createPoseClient: async () => ({estimate(_input, time) {
      if (time === 0) return {...pose(), worldLandmarks: world};
      if (time === 100) return {...pose(), worldLandmarks: world.map(point => ({...point, z: NaN}))};
      return pose();
    }, close() {}})});
  assert.deepEqual(result.samples[0].worldLandmarks, world);
  assert.notEqual(result.samples[0].worldLandmarks, world);
  assert.equal(result.samples[0].worldLandmarks[1].x, .0123);
  assert.equal(result.samples[0].worldLandmarks[1].visibility, .84);
  assert.equal(result.samples[0].worldLandmarks[1].presence, .73);
  assert.equal(result.samples[1].status, 'pose'); assert.equal(result.samples[1].worldLandmarks, undefined);
  assert.equal(result.samples[2].status, 'pose'); assert.equal(result.samples[2].worldLandmarks, undefined);
  world[0].z = 99; assert.equal(result.samples[0].worldLandmarks[0].z, .145);
  assert.match(result.provenance.worldCoordinates, /model-estimated meters/);
  checks.push('Valid raw model world coordinates and confidence fields are retained independently; missing or invalid 3D never invalidates 2D or substitutes normalized coordinates.');
}
{
  const video = new FixtureVideo(), lateClient = deferred(), controller = new AbortController();
  let closed = 0;
  const analyzing = extractRecordedVideoPoses(video, {signal: controller.signal, createPoseClient: () => lateClient.promise});
  await tick(); controller.abort(); await assert.rejects(analyzing, {name: 'AbortError'});
  lateClient.resolve({estimate: () => pose(), close() {closed++;}});
  await tick(); assert.equal(closed, 1);
  const retried = await extractRecordedVideoPoses(video, {sampleRateHz: 1, createPoseClient: async () => ({estimate: () => pose(), close() {closed++;}})});
  assert.equal(retried.samples.length, 1); assert.equal(closed, 2);
  checks.push('Cancellation interrupts model initialization promptly; a late model is closed, and the same video can be analyzed again.');
}
{
  const video = new FixtureVideo({stalledSeek: true, callbacks: false});
  const controller = new AbortController(); let closed = 0;
  const started = Date.now();
  const analyzing = extractRecordedVideoPoses(video, {ranges: [{startSeconds: .1, endSeconds: .3}],
    signal: controller.signal, createPoseClient: async () => ({estimate: () => pose(), close() {closed++;}})});
  await tick();
  await assert.rejects(extractRecordedVideoPoses(video), /already being analyzed/);
  controller.abort(); await assert.rejects(analyzing, {name: 'AbortError'});
  assert.ok(Date.now() - started < 500); assert.equal(closed, 1); assert.equal(video._frames.size, 0);
  checks.push('Seeking cancellation removes media listeners/timers, closes the model, and prevents simultaneous extraction on the same element.');
}
{
  const video = new FixtureVideo({duration: 10}); let initialized = 0;
  const options = {createPoseClient: async () => {initialized++; return {estimate: () => pose()};}};
  await assert.rejects(extractRecordedVideoPoses(video, {...options, ranges: [{startSeconds: 4, endSeconds: 6}, {startSeconds: 5, endSeconds: 8}]}), /ordered/);
  await assert.rejects(extractRecordedVideoPoses(video, {...options, ranges: [{startSeconds: 0, endSeconds: 11}]}), /inside/);
  await assert.rejects(extractRecordedVideoPoses(video, {...options, sampleRateHz: 60}), /12 Hz/);
  assert.equal(initialized, 0);
  checks.push('Invalid ranges and excessive sampling are rejected before model initialization.');
}

console.log(`Recorded video input: ${checks.length} pure software checks passed. These are lifecycle fixtures, not real model or browser validation.`);
for (const check of checks) console.log(`- ${check}`);
