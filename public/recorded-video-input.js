/** Local recorded-video input. The original File never leaves the browser. */
export const RECORDED_VIDEO_LIMITS = Object.freeze({
  maxFileBytes: 500 * 1024 * 1024,
  maxDurationSeconds: 600,
  defaultSampleRateHz: 12,
  maxSampleRateHz: 12,
  maxSamples: 7200,
  metadataTimeoutMs: 15000,
  seekTimeoutMs: 8000,
  frameCallbackTimeoutMs: 200,
  modelTimeoutMs: 45000,
  timestampToleranceSeconds: 0.125,
});

const EXTENSIONS = /\.(mp4|m4v|mov|webm|ogv|ogg|mkv|avi)$/i;
const activeExtractions = new WeakSet();

function aborted() {
  return new DOMException('Video analysis cancelled.', 'AbortError');
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw aborted();
}

function videoError(video) {
  const code = video.error?.code;
  return new Error(code === 3 || code === 4
    ? 'This browser cannot decode the video. Export it as H.264 MP4 or VP8/VP9 WebM and try again.'
    : 'The video could not be read. Try a complete, playable MP4 or WebM file.');
}

function closeClient(client) {
  try { client?.close?.(); } catch { /* A failed close must not mask the result. */ }
}

/** Throw on invalid input; media decoding is checked separately by loadRecordedVideo. */
export function validateRecordedVideoFile(file) {
  if (!file || typeof file.name !== 'string' || !Number.isFinite(file.size) || file.size <= 0) {
    throw new Error('Choose a non-empty video file.');
  }
  if (file.size > RECORDED_VIDEO_LIMITS.maxFileBytes) {
    throw new Error('Choose a video smaller than 500 MB.');
  }
  const type = String(file.type || '').toLowerCase();
  if (!(type.startsWith('video/') || ((!type || type === 'application/octet-stream') && EXTENSIONS.test(file.name)))) {
    throw new Error('Choose a video file, such as MP4, MOV or WebM.');
  }
  return {name: file.name, size: file.size, type};
}

/** Register before starting the media operation; always remove listeners and timers. */
function waitForVideo(video, events, ready, {signal, timeoutMs, timeoutMessage, start} = {}) {
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      for (const event of events) video.removeEventListener(event, check);
      video.removeEventListener('error', failed);
      signal?.removeEventListener('abort', cancelled);
    };
    const done = (error) => { cleanup(); error ? reject(error) : resolve(); };
    const check = () => { if (ready()) done(); };
    const failed = () => done(videoError(video));
    const cancelled = () => done(aborted());
    if (signal?.aborted) return reject(aborted());
    for (const event of events) video.addEventListener(event, check);
    video.addEventListener('error', failed);
    signal?.addEventListener('abort', cancelled, {once: true});
    timer = setTimeout(() => done(new Error(timeoutMessage)), timeoutMs);
    try { start?.(); check(); } catch (error) { done(error); }
  });
}

/** Attach a user-selected File, checking browser decoding before analysis begins. */
export async function loadRecordedVideo(video, file, {signal} = {}) {
  validateRecordedVideoFile(file);
  throwIfAborted(signal);
  const url = URL.createObjectURL(file);
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (video.getAttribute('src') === url || video.src === url) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
    URL.revokeObjectURL(url);
  };
  try {
    video.pause();
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    await waitForVideo(video, ['loadedmetadata', 'loadeddata', 'canplay'],
      () => video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0,
      {signal, timeoutMs: RECORDED_VIDEO_LIMITS.metadataTimeoutMs,
        timeoutMessage: 'Video metadata or the first decoded frame did not load. Try another video format.',
        start: () => { video.src = url; video.load(); }});
    throwIfAborted(signal);
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('The video has no readable duration. Export a complete MP4 or WebM file and try again.');
    }
    if (duration > RECORDED_VIDEO_LIMITS.maxDurationSeconds) {
      throw new Error('Choose a video up to 10 minutes long.');
    }
    return {url, width: video.videoWidth, height: video.videoHeight, duration, dispose};
  } catch (error) {
    dispose();
    throw error;
  }
}

function makeSchedule(ranges, duration, sampleRateHz) {
  if (!Number.isFinite(duration) || duration <= 0 || duration > RECORDED_VIDEO_LIMITS.maxDurationSeconds) {
    throw new Error('Load a video with a duration between 0 and 600 seconds first.');
  }
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0 || sampleRateHz > RECORDED_VIDEO_LIMITS.maxSampleRateHz) {
    throw new Error('The sample rate must be greater than 0 and no more than 12 Hz.');
  }
  const selected = ranges ?? [{startSeconds: 0, endSeconds: duration}];
  if (!Array.isArray(selected) || !selected.length) throw new Error('Choose at least one video range.');
  const schedule = [];
  let previousEnd = -1;
  for (const range of selected) {
    const start = range?.startSeconds, end = range?.endSeconds;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > duration + 0.001 || end <= start || start < previousEnd) {
      throw new Error('Video ranges must be ordered, non-overlapping and inside the loaded video.');
    }
    previousEnd = end;
    // Exclude the exact end: it may have no decoded frame and belongs to the next range.
    for (let index = 0; start + index / sampleRateHz < end - 0.000001; index++) {
      schedule.push(start + index / sampleRateHz);
      if (schedule.length > RECORDED_VIDEO_LIMITS.maxSamples) throw new Error('This selection exceeds 7,200 video samples.');
    }
  }
  return schedule;
}

/** A bounded rVFC observation; old callbacks are ignored and cancelled on every path. */
function observeDecodedFrame(video, requestedTimeSeconds, signal) {
  let callbackId, timer, settled = false;
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  const finish = value => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (callbackId !== undefined) video.cancelVideoFrameCallback?.(callbackId);
    signal?.removeEventListener('abort', cancelled);
    resolve(value);
  };
  const cancelled = () => finish(null);
  if (typeof video.requestVideoFrameCallback === 'function') {
    const request = () => {
      callbackId = video.requestVideoFrameCallback((_now, metadata) => {
        const time = metadata?.mediaTime;
        if (!video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - requestedTimeSeconds) <= 0.002 &&
            Number.isFinite(time) && Math.abs(time - requestedTimeSeconds) <= RECORDED_VIDEO_LIMITS.timestampToleranceSeconds) {
          finish(time);
        } else if (!settled) request();
      });
    };
    request();
    signal?.addEventListener('abort', cancelled, {once: true});
    timer = setTimeout(() => finish(null), RECORDED_VIDEO_LIMITS.frameCallbackTimeoutMs);
  } else finish(null);
  return {promise, cancel: () => finish(null)};
}

async function decodeAt(video, requestedTimeSeconds, signal) {
  throwIfAborted(signal);
  const frame = observeDecodedFrame(video, requestedTimeSeconds, signal);
  try {
    const sameFrame = Math.abs(video.currentTime - requestedTimeSeconds) < 0.000001 && video.readyState >= 2 && !video.seeking;
    if (!sameFrame) {
      await waitForVideo(video, ['seeked', 'loadeddata', 'canplay'],
        () => !video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - requestedTimeSeconds) <= 0.002,
        {signal, timeoutMs: RECORDED_VIDEO_LIMITS.seekTimeoutMs,
          timeoutMessage: 'The browser could not decode this position in the video.',
          start: () => { video.currentTime = requestedTimeSeconds; }});
    }
    throwIfAborted(signal);
    // Paused videos can lack a compositor callback (especially for the first frame).
    // A finished seek with HAVE_CURRENT_DATA is still a decoded HTMLVideoElement.
    const decodedTime = sameFrame ? null : await frame.promise;
    throwIfAborted(signal);
    if (video.readyState < 2 || video.seeking || video.error) throw videoError(video);
    const time = decodedTime ?? video.currentTime;
    if (!Number.isFinite(time) || time < 0 || time > video.duration ||
        Math.abs(time - requestedTimeSeconds) > RECORDED_VIDEO_LIMITS.timestampToleranceSeconds) {
      throw new Error('Decoded video timestamp did not match the requested sample.');
    }
    return {sourceTimeSeconds: time, timestampSource: decodedTime === null ? 'seeked-currentTime' : 'video-frame-mediaTime'};
  } finally { frame.cancel(); }
}

async function defaultCreatePoseClient() {
  const {createCenterPoseClient} = await import('./first-three-pose-runtime.js');
  return createCenterPoseClient();
}

/** Race model initialization with cancellation, closing any late-arriving instance. */
function acquireClient(createPoseClient, signal) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancelled); };
    const fail = error => {
      if (finished) return;
      finished = true; cleanup(); reject(error);
    };
    const cancelled = () => fail(aborted());
    const timer = setTimeout(() => fail(new Error('The local pose model did not initialize in time. Retry the analysis.')),
      RECORDED_VIDEO_LIMITS.modelTimeoutMs);
    signal?.addEventListener('abort', cancelled, {once: true});
    if (signal?.aborted) { cancelled(); return; }
    Promise.resolve().then(createPoseClient).then(client => {
      if (finished || signal?.aborted) { closeClient(client); if (!finished) cancelled(); return; }
      if (!client || typeof client.estimate !== 'function') { closeClient(client); fail(new Error('The pose model did not return an inference client.')); return; }
      finished = true; cleanup(); resolve(client);
    }, fail);
  });
}

function safeEstimateResult(result) {
  if (result?.status !== 'pose') return {status: result?.status === 'no_pose' ? 'no_pose' : 'inference_error', landmarks: []};
  if (!Array.isArray(result.landmarks) || result.landmarks.length !== 33) return {status: 'inference_error', landmarks: []};
  const landmarks = result.landmarks.map((point, index) => ({index,
    x: point.x, y: point.y, z: point.z, visibility: point.visibility,
    ...(point.presence === undefined ? {} : {presence: point.presence})}));
  if (landmarks.some(p => ![p.x, p.y, p.z, p.visibility].every(Number.isFinite) || p.visibility < 0 || p.visibility > 1 ||
      (p.presence !== undefined && (!Number.isFinite(p.presence) || p.presence < 0 || p.presence > 1)))) {
    return {status: 'inference_error', landmarks: []};
  }
  let worldLandmarks;
  if (Array.isArray(result.worldLandmarks) && result.worldLandmarks.length === 33 &&
      result.worldLandmarks.every(point => point && typeof point === 'object')) {
    const points = result.worldLandmarks.map((point, index) => ({index,
      x: point.x, y: point.y, z: point.z, visibility: point.visibility,
      ...(point.presence === undefined ? {} : {presence: point.presence})}));
    if (points.every(p => [p.x, p.y, p.z, p.visibility].every(Number.isFinite) && p.visibility >= 0 && p.visibility <= 1 &&
        (p.presence === undefined || Number.isFinite(p.presence) && p.presence >= 0 && p.presence <= 1))) {
      worldLandmarks = points;
    }
  }
  return {status: 'pose', landmarks, ...(worldLandmarks ? {worldLandmarks} : {})};
}

/**
 * Sequential VIDEO inference against actual decoded file frames, never a canvas,
 * webcam, wall-clock or pre-recorded landmark fixture. Unknown stays unknown.
 */
export async function extractRecordedVideoPoses(video, {
  ranges, sampleRateHz = RECORDED_VIDEO_LIMITS.defaultSampleRateHz,
  signal, onProgress, onSample, createPoseClient = defaultCreatePoseClient,
} = {}) {
  throwIfAborted(signal);
  if (activeExtractions.has(video)) throw new Error('This video is already being analyzed. Cancel it before starting again.');
  if (!(video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2)) throw new Error('Load a playable video before analyzing it.');
  const schedule = makeSchedule(ranges, video.duration, sampleRateHz);
  activeExtractions.add(video);
  video.pause();
  let client;
  const samples = [];
  const skippedRequests = [];
  let lastInferenceTimeMs = -Infinity;
  let lastEmittedTimeMs = -Infinity;
  try {
    onProgress?.({completed: 0, total: schedule.length, percent: 0, currentTime: schedule[0]});
    client = await acquireClient(createPoseClient, signal);
    for (const [requestIndex, requestedTimeSeconds] of schedule.entries()) {
      throwIfAborted(signal);
      let sample;
      try {
        const decoded = await decodeAt(video, requestedTimeSeconds, signal);
        const tMs = decoded.sourceTimeSeconds * 1000;
        let result = {status: 'duplicate_frame', landmarks: []};
        if (tMs > lastInferenceTimeMs && tMs > lastEmittedTimeMs) {
          // A failed VIDEO invocation has still consumed its timestamp.
          lastInferenceTimeMs = tMs;
          try { result = safeEstimateResult(await client.estimate(video, tMs)); }
          catch { result = {status: 'inference_error', landmarks: []}; }
        }
        throwIfAborted(signal);
        sample = {tMs, requestedTimeSeconds, ...decoded, ...result,
          timestampToleranceSeconds: RECORDED_VIDEO_LIMITS.timestampToleranceSeconds};
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') throw aborted();
        sample = {tMs: requestedTimeSeconds * 1000, sourceTimeSeconds: requestedTimeSeconds,
          requestedTimeSeconds, status: 'decode_error', landmarks: [], timestampSource: 'requested-time-unobserved',
          error: 'This frame could not be decoded or inferred; movement is unknown.'};
      }
      if (sample.tMs > lastEmittedTimeMs) {
        samples.push(sample);
        lastEmittedTimeMs = sample.tMs;
        onSample?.(sample);
      } else {
        // Do not retime the same observed frame or place an unobserved requested
        // timestamp behind a decoded one. Retain the skipped request as a gap.
        skippedRequests.push({requestedTimeSeconds, sourceTimeSeconds: sample.sourceTimeSeconds,
          tMs: sample.tMs, status: sample.status, timestampSource: sample.timestampSource,
          reason: 'non-increasing-source-time'});
      }
      const completed = requestIndex + 1;
      onProgress?.({completed, total: schedule.length,
        percent: Math.round(completed / schedule.length * 100), currentTime: sample.sourceTimeSeconds});
      // Yield even with a synchronously decoding media implementation so Cancel stays responsive.
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    throwIfAborted(signal);
    return {samples, width: video.videoWidth, height: video.videoHeight, provenance: {
      source: 'user-selected-recorded-video', inference: 'browser-local-mediapipe',
      model: '/models/pose_landmarker_lite.task', runningMode: 'VIDEO', sampleRateHz,
      clock: 'decoded-video-media-time', timestampToleranceSeconds: RECORDED_VIDEO_LIMITS.timestampToleranceSeconds,
      worldCoordinates: 'Optional worldLandmarks are raw MediaPipe model-estimated meters in the pose coordinate system; not calibrated reconstruction or normalized-z conversion.',
      missingData: 'explicit-unknown-no-interpolation',
      requestedSamples: schedule.length, emittedSamples: samples.length,
      skippedSampleCount: skippedRequests.length, skippedRequests,
    }};
  } finally {
    closeClient(client);
    video.pause();
    activeExtractions.delete(video);
  }
}
