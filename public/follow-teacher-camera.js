import {
  createImitationPoseClient,
  listPracticeCameras,
  requestPracticeCamera,
} from './follow-teacher-runtime.js';

const MAXIMUM_SAMPLE_AGE_MS = 450;
const INFERENCE_INTERVAL_MS = 90;
const CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
];

function cameraError(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Camera permission was not granted. Allow camera access, then press Start camera again.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No camera was found. Connect a camera, then press Start camera again.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The camera could not start. Close other apps using it, then try again.';
    case 'OverconstrainedError':
      return 'The selected camera is unavailable. Choose another device, then start it again.';
    case 'SecurityError':
      return 'Camera access is unavailable here. Open this page on localhost or HTTPS.';
    default:
      return error?.message || 'The camera or local pose model could not start. You can keep learning without it.';
  }
}

/**
 * Optional live camera. The video element is always the raw inference source.
 * Mirroring affects the two display elements only; landmark indices stay intact.
 * This module never records, uploads, interpolates, or substitutes a camera frame.
 */
export function createFollowCamera({
  video, canvas, deviceSelect, startButton, stopButton,
  mirrorCheckbox, skeletonCheckbox, statusElement,
  onObservation = () => {}, onState = () => {},
  pointIndices = null, showConnections = true, pointColors = {},
}) {
  let stream = null;
  let client = null;
  let generation = 0;
  let deviceGeneration = 0;
  let destroyed = false;
  let running = false;
  let starting = false;
  let phase = 'idle';
  let tracking = 'off';
  let message = 'Camera off. Press Start practice to enable movement feedback.';
  let frameRequest = 0;
  let watchdog = 0;
  let startedAt = 0;
  let lastVideoTime = -1;
  let lastInferenceStartedAt = 0;
  let lastTimestamp = 0;
  let lastObservedAt = null;
  let lastSample = null;
  let lastSampleStatus = null;
  let inferenceCount = 0;
  let streamStarts = 0;
  let stoppedTracks = 0;
  let trackListeners = [];
  let trackMuted = false;
  let drawnIndices=[];
  // The SDK's Wasm bootstrap uses shared ModuleFactory state. Never overlap
  // starts in this camera instance, even when a previous start was canceled.
  let modelInitialization = Promise.resolve();

  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.style.objectFit = 'contain';
  canvas.style.objectFit = 'contain';

  function getState() {
    return {
      phase, tracking, message, running, starting,
      hasSample: !!lastSample,
      lastSampleStatus,
      lastObservedAt,
      lastObservationAgeMs: lastObservedAt === null ? null : Math.max(0, performance.now() - lastObservedAt),
      inferenceCount, streamStarts, stoppedTracks,
      overlayJoints:[...drawnIndices],showConnections,
      generation,
      videoTime: video.currentTime,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      tracks: stream?.getTracks().map((track) => ({
        kind: track.kind, readyState: track.readyState, muted: track.muted,
        enabled: track.enabled, deviceId: track.getSettings().deviceId || '',
      })) || [],
    };
  }

  function updateState(nextPhase, nextTracking, nextMessage) {
    phase = nextPhase;
    tracking = nextTracking;
    message = nextMessage;
    statusElement.textContent = message;
    startButton.disabled = starting || running || destroyed;
    stopButton.disabled = (!starting && !running) || destroyed;
    onState(getState());
  }

  function clearCanvas() {
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    drawnIndices=[];
  }

  function clearObservation(force = false) {
    const hadSample = !!lastSample;
    lastSample = null;
    clearCanvas();
    if (force || hadSample) onObservation(null);
  }

  function mirrorDisplay() {
    const transform = mirrorCheckbox.checked ? 'scaleX(-1)' : 'none';
    video.style.transform = transform;
    canvas.style.transform = transform;
  }

  function renderSkeleton() {
    clearCanvas();
    if (!skeletonCheckbox.checked || !lastSample || lastObservedAt === null
        || performance.now() - lastObservedAt > MAXIMUM_SAMPLE_AGE_MS) return;
    const width = video.videoWidth, height = video.videoHeight;
    if (!width || !height) return;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return;
    const points = new Map(lastSample.landmarks.filter((point) =>
      Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.visibility)
      && point.visibility >= 0.45 && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1,
    ).filter((point)=>!pointIndices||pointIndices.includes(point.index)).map((point) => [point.index, point]));
    context.lineWidth = Math.max(2, width / 240);
    context.strokeStyle = '#67e8d5';
    context.fillStyle = '#a5fff1';
    for (const [a, b] of showConnections?CONNECTIONS:[]) {
      const start = points.get(a), end = points.get(b);
      if (!start || !end) continue;
      context.beginPath();
      context.moveTo(start.x * width, start.y * height);
      context.lineTo(end.x * width, end.y * height);
      context.stroke();
    }
    for (const point of points.values()) {
      context.fillStyle=pointColors[point.index]||'#a5fff1';
      context.beginPath();
      context.arc(point.x * width, point.y * height, pointIndices?Math.max(6,width/90):Math.max(3, width / 180), 0, Math.PI * 2);
      context.fill();
      context.strokeStyle='#102d38';context.lineWidth=2;context.stroke();
    }
    drawnIndices=[...points.keys()];
  }

  function stopTracks(target) {
    if (!target) return;
    for (const track of target.getTracks()) {
      if (track.readyState !== 'ended') stoppedTracks += 1;
      track.stop();
    }
  }

  function releaseResources() {
    cancelAnimationFrame(frameRequest);
    frameRequest = 0;
    clearInterval(watchdog);
    watchdog = 0;
    for (const [track, event, handler] of trackListeners) track.removeEventListener(event, handler);
    trackListeners = [];
    stopTracks(stream);
    stream = null;
    if (client) {
      try { client.close(); } catch { /* A stopped model must not prevent stream release. */ }
      client = null;
    }
    video.pause();
    video.srcObject = null;
    trackMuted = false;
    lastVideoTime = -1;
    lastInferenceStartedAt = 0;
    lastObservedAt = null;
    lastSampleStatus = null;
    clearObservation(true);
  }

  function stop(reason = 'Camera off. Video preview can continue without movement feedback.') {
    generation += 1;
    running = false;
    starting = false;
    releaseResources();
    updateState('idle', 'off', reason);
  }

  async function refreshDevices() {
    const token = ++deviceGeneration;
    const selected = deviceSelect.value;
    try {
      const devices = await listPracticeCameras();
      if (destroyed || token !== deviceGeneration) return [];
      const actual = stream?.getVideoTracks()[0]?.getSettings().deviceId;
      const wanted = selected || actual || '';
      const options = [{ deviceId: '', label: 'Default / front-facing camera' }, ...devices];
      if (wanted && !options.some((option) => option.deviceId === wanted)) {
        options.push({ deviceId: wanted, label: 'Selected camera (currently unavailable)' });
      }
      deviceSelect.replaceChildren(...options.map((camera) => {
        const option = document.createElement('option');
        option.value = camera.deviceId;
        option.textContent = camera.label;
        return option;
      }));
      deviceSelect.value = wanted;
      return devices;
    } catch {
      // Device enumeration never prompts for permission and must not block teaching.
      return [];
    }
  }

  function markUnknown(kind, text, sampleStatus = null) {
    const changed = tracking !== kind;
    lastSampleStatus = sampleStatus;
    clearObservation(changed);
    if (changed) updateState('running', kind, text);
  }

  function initializeModel(token) {
    const queued = modelInitialization.catch(() => {}).then(async () => {
      if (destroyed || token !== generation || !starting) return null;
      const candidate = await createImitationPoseClient();
      if (destroyed || token !== generation || !starting) {
        candidate.close();
        return null;
      }
      // Establish ownership before resolving the queue. A switch occurring
      // before start() resumes can already release this exact model.
      client = candidate;
      return candidate;
    });
    modelInitialization = queued.then(() => {}, () => {});
    return queued;
  }

  function inferenceFrame(token, now) {
    frameRequest = 0;
    if (destroyed || token !== generation || !running || !client) return;
    if (!trackMuted && video.readyState >= 2 && video.videoWidth > 0 && !video.paused
        && video.currentTime !== lastVideoTime && now - lastInferenceStartedAt >= INFERENCE_INTERVAL_MS) {
      lastVideoTime = video.currentTime;
      lastInferenceStartedAt = now;
      // Timestamp the acquired frame before synchronous inference, not its completion.
      const observedAtMs = performance.now();
      lastTimestamp = Math.max(observedAtMs, lastTimestamp + 0.001);
      try {
        const result = client.estimate(video, lastTimestamp);
        inferenceCount += 1;
        if (token !== generation || !running) return;
        lastObservedAt = observedAtMs;
        lastSampleStatus = result.status;
        if (performance.now() - observedAtMs > MAXIMUM_SAMPLE_AGE_MS) {
          markUnknown('stale', 'Tracking is delayed. Waiting for a fresh camera observation.', result.status);
        } else if (result.status !== 'pose') {
          markUnknown(result.status, result.status === 'no_pose'
            ? 'No person tracked. Keep your full body in view; you can still continue manually.'
            : 'Pose tracking is unavailable for this frame. You can still continue manually.', result.status);
        } else {
          lastSample = { tMs: lastTimestamp, status: result.status, landmarks: result.landmarks };
          renderSkeleton();
          if (tracking !== 'pose') updateState('running', 'pose', 'Camera on · live MediaPipe. Keep your full body in view.');
          onObservation({
            sample: lastSample,
            observedAtMs,
            aspectRatio: video.videoWidth / video.videoHeight,
          });
        }
      } catch {
        inferenceCount += 1;
        lastObservedAt = observedAtMs;
        markUnknown('inference_error', 'Pose tracking failed for this frame. You can still continue manually.', 'inference_error');
      }
    }
    if (token === generation && running) frameRequest = requestAnimationFrame((time) => inferenceFrame(token, time));
  }

  async function start() {
    if (destroyed || document.hidden) return;
    const token = ++generation;
    running = false;
    starting = true;
    releaseResources();
    updateState('starting', 'waiting', 'Starting camera and the local MediaPipe model…');
    let acquired = null;
    let created = null;
    try {
      acquired = await requestPracticeCamera(deviceSelect.value);
      if (destroyed || token !== generation) {
        stopTracks(acquired);
        return;
      }
      stream = acquired;
      streamStarts += 1;
      const videoTracks = stream.getVideoTracks();
      if (!videoTracks.length || videoTracks.every((track) => track.readyState === 'ended')) {
        throw new Error('The selected camera did not provide an active video track.');
      }
      for (const track of videoTracks) {
        const ended = () => {
          if (token === generation) stop('Camera disconnected. Choose a camera and press Start camera to resume.');
        };
        const mute = () => {
          if (token !== generation) return;
          trackMuted = true;
          clearObservation(true);
          updateState(starting ? 'starting' : 'running', 'muted', 'Camera interrupted. Waiting for fresh frames.');
        };
        const unmute = () => {
          if (token !== generation) return;
          trackMuted = videoTracks.some((item) => item.muted);
          lastVideoTime = -1;
          if (!trackMuted) updateState(starting ? 'starting' : 'running', 'waiting', 'Camera resumed. Waiting for a fresh pose.');
        };
        for (const [event, handler] of [['ended', ended], ['mute', mute], ['unmute', unmute]]) {
          track.addEventListener(event, handler);
          trackListeners.push([track, event, handler]);
        }
      }
      trackMuted = videoTracks.some((track) => track.muted);
      video.srcObject = stream;
      await video.play();
      if (destroyed || token !== generation) return;
      created = await initializeModel(token);
      if (!created) return;
      if (destroyed || token !== generation) {
        if (client === created) {
          client = null;
          created.close();
        }
        return;
      }
      created = null;
      starting = false;
      running = true;
      startedAt = performance.now();
      updateState('running', trackMuted ? 'muted' : 'waiting', 'Camera on. Waiting for a fresh pose.');
      frameRequest = requestAnimationFrame((time) => inferenceFrame(token, time));
      watchdog = setInterval(() => {
        if (token !== generation || !running) return;
        if (!stream?.getVideoTracks().some((track) => track.readyState === 'live')) {
          stop('Camera disconnected. Press Start camera to resume.');
          return;
        }
        if (trackMuted) return;
        const age = performance.now() - (lastObservedAt ?? startedAt);
        if (age > MAXIMUM_SAMPLE_AGE_MS) {
          markUnknown('stale', 'No fresh camera observation. Check the camera; you can still continue manually.');
        }
      }, 100);
      void refreshDevices();
    } catch (error) {
      if (created && client === created) {
        client = null;
        try { created.close(); } catch { /* Release remaining resources below. */ }
      }
      if (token !== generation || destroyed) {
        // A pending permission result belongs to the canceled start, never a newer stream.
        if (acquired && acquired !== stream) stopTracks(acquired);
        return;
      }
      running = false;
      starting = false;
      releaseResources();
      updateState('error', 'off', cameraError(error));
    }
  }

  const startHandler = () => { void start(); };
  const stopHandler = () => stop();
  const deviceHandler = () => { if (running || starting) void start(); };
  const skeletonHandler = () => renderSkeleton();
  const hiddenHandler = () => {
    if (document.hidden && (running || starting)) stop('Camera stopped while the page was hidden. Press Start camera to resume.');
  };
  const pagehideHandler = () => stop('Camera stopped because this page was closed or left.');
  const deviceChangeHandler = () => { void refreshDevices(); };

  startButton.addEventListener('click', startHandler);
  stopButton.addEventListener('click', stopHandler);
  deviceSelect.addEventListener('change', deviceHandler);
  mirrorCheckbox.addEventListener('change', mirrorDisplay);
  skeletonCheckbox.addEventListener('change', skeletonHandler);
  document.addEventListener('visibilitychange', hiddenHandler);
  window.addEventListener('pagehide', pagehideHandler);
  navigator.mediaDevices?.addEventListener('devicechange', deviceChangeHandler);
  mirrorDisplay();
  updateState('idle', 'off', message);
  void refreshDevices();

  return {
    stop,
    refreshDevices,
    getState,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      deviceGeneration += 1;
      stop();
      startButton.removeEventListener('click', startHandler);
      stopButton.removeEventListener('click', stopHandler);
      deviceSelect.removeEventListener('change', deviceHandler);
      mirrorCheckbox.removeEventListener('change', mirrorDisplay);
      skeletonCheckbox.removeEventListener('change', skeletonHandler);
      document.removeEventListener('visibilitychange', hiddenHandler);
      window.removeEventListener('pagehide', pagehideHandler);
      navigator.mediaDevices?.removeEventListener('devicechange', deviceChangeHandler);
    },
  };
}
