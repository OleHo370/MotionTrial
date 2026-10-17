/**
 * Explicitly SIMULATED camera lifecycle controls, separate from MediaPipe QA.
 * No physical camera, real landmarks, or recognition accuracy is claimed here.
 * Run: node scripts/verify-follow-camera-lifecycle.mjs
 */
import { readFile } from 'node:fs/promises';
import { strict as assert } from 'node:assert';

const moduleSource = await readFile(new URL('../public/follow-teacher-camera.js', import.meta.url), 'utf8');
let clock = 1000;
let nextTask = 1;
let checks = 0;
let inferenceStatus = 'pose';
let activeInitializations = 0;
let maximumInitializations = 0;
const frames = new Map();
const intervals = new Map();
const requests = [];
const modelRequests = [];
const observations = [];
const inferenceSources = [];
const events = [];
const closedModels = [];
const check = (condition, message) => { checks += 1; assert.ok(condition, message); };
const flush = async () => { for (let index = 0; index < 16; index += 1) await Promise.resolve(); };

class Element extends EventTarget {
  constructor() {
    super();
    this.style = {};
    this.checked = true;
    this.value = '';
    this.children = [];
    this.disabled = false;
  }
  replaceChildren(...children) { this.children = children; }
}

class Track extends EventTarget {
  kind = 'video';
  readyState = 'live';
  muted = false;
  enabled = true;
  constructor(id) { super(); this.id = id; this.stops = 0; }
  getSettings() { return { deviceId: this.id }; }
  stop() { this.readyState = 'ended'; this.stops += 1; }
}

const streamFor = (track) => ({ getTracks: () => [track], getVideoTracks: () => [track] });
const tick = () => {
  for (const [id, callback] of [...frames]) {
    frames.delete(id);
    callback(clock);
  }
};

globalThis.performance = { now: () => clock };
globalThis.requestAnimationFrame = (callback) => { const id = nextTask++; frames.set(id, callback); return id; };
globalThis.cancelAnimationFrame = (id) => frames.delete(id);
globalThis.setInterval = (callback) => { const id = nextTask++; intervals.set(id, callback); return id; };
globalThis.clearInterval = (id) => intervals.delete(id);
const documentStub = new EventTarget();
documentStub.hidden = false;
documentStub.createElement = () => new Element();
globalThis.document = documentStub;
globalThis.window = new EventTarget();
Object.defineProperty(globalThis, 'navigator', {
  value: { mediaDevices: new EventTarget() }, configurable: true,
});
globalThis.__followCameraLifecycleRuntime = {
  requestPracticeCamera: (id) => new Promise((resolve, reject) => requests.push({ id, resolve, reject })),
  listPracticeCameras: async () => [
    { deviceId: 'one', label: 'One' },
    { deviceId: 'two', label: 'Two' },
  ],
  createImitationPoseClient: () => new Promise((resolve) => {
    const id = modelRequests.length + 1;
    activeInitializations += 1;
    maximumInitializations = Math.max(maximumInitializations, activeInitializations);
    events.push(`initialize-${id}`);
    modelRequests.push({
      id,
      resolve() {
        activeInitializations -= 1;
        resolve({
          estimate(source) {
            inferenceSources.push(source);
            return {
              status: inferenceStatus,
              landmarks: inferenceStatus === 'pose'
                ? [{ index: 27, x: 0.2, y: 0.8, z: 0, visibility: 1 }] : [],
            };
          },
          close() { closedModels.push(id); events.push(`close-${id}`); },
        });
      },
    });
  }),
};

// Dependency injection exists only inside this labeled control test.
const injectedSource = moduleSource.replace(
  /import\s*\{[\s\S]*?\}\s*from '\.\/follow-teacher-runtime\.js';/,
  'const { createImitationPoseClient, listPracticeCameras, requestPracticeCamera } = globalThis.__followCameraLifecycleRuntime;',
);
check(injectedSource !== moduleSource, 'The runtime import is replaced only in the test');
const { createFollowCamera } = await import(`data:text/javascript;base64,${Buffer.from(injectedSource).toString('base64')}`);
const video = new Element();
Object.assign(video, {
  currentTime: 0, videoWidth: 640, videoHeight: 360, readyState: 4, paused: false,
  async play() { this.paused = false; },
  pause() { this.paused = true; },
});
const canvas = new Element();
Object.assign(canvas, {
  width: 640, height: 360,
  getContext: () => ({
    clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, arc() {}, fill() {},
  }),
});
const startButton = new Element();
const stopButton = new Element();
const deviceSelect = new Element();
const mirrorCheckbox = new Element();
const skeletonCheckbox = new Element();
const statusElement = new Element();
const camera = createFollowCamera({
  video, canvas, startButton, stopButton, deviceSelect,
  mirrorCheckbox, skeletonCheckbox, statusElement,
  onObservation: (value) => observations.push(value),
});
const start = () => startButton.dispatchEvent(new Event('click'));
const switchTo = (id) => { deviceSelect.value = id; deviceSelect.dispatchEvent(new Event('change')); };

check(requests.length === 0 && modelRequests.length === 0, 'Initial setup never prompts for permission or initializes MediaPipe');
switchTo('one');
check(requests.length === 0, 'Selecting a camera while stopped does not request permission');
start();
check(requests.length === 1, 'Explicit Start requests permission');
camera.stop();
const lateTrack = new Track('one');
requests[0].resolve(streamFor(lateTrack));
await flush();
check(lateTrack.readyState === 'ended', 'Canceled permission request releases its late stream');
check(!camera.getState().running && !camera.getState().starting, 'Canceled start stays stopped');

start();
const firstTrack = new Track('one');
requests[1].resolve(streamFor(firstTrack));
await flush();
check(modelRequests.length === 1, 'The first model initialization starts');
switchTo('two');
check(firstTrack.readyState === 'ended', 'Switching during initialization releases the old stream immediately');
const intermediateTrack = new Track('two');
requests[2].resolve(streamFor(intermediateTrack));
await flush();
check(modelRequests.length === 1, 'A second initialization waits behind the pending one');
switchTo('one');
const activeTrack = new Track('one');
requests[3].resolve(streamFor(activeTrack));
await flush();
check(intermediateTrack.readyState === 'ended', 'A rapidly superseded stream is released immediately');
check(modelRequests.length === 1, 'Rapid restarts do not initialize concurrently');
modelRequests[0].resolve();
await flush();
check(closedModels.includes(1), 'The canceled initialized model is closed');
check(modelRequests.length === 2, 'The superseded queued model is skipped; only the newest initializes');
check(events.indexOf('close-1') < events.indexOf('initialize-2'), 'Canceled model closes before the next initialization starts');
modelRequests[1].resolve();
await flush();
check(camera.getState().running && maximumInitializations === 1, 'The latest camera runs with at most one initialization at a time');

tick();
check(camera.getState().hasSample && inferenceSources[0] === video, 'Inference receives the original video element');
check(video.style.transform === 'scaleX(-1)' && canvas.style.transform === video.style.transform, 'Mirror applies to both display layers');
const landmarkBeforeMirror = observations.filter(Boolean).at(-1).sample.landmarks[0];
mirrorCheckbox.checked = false;
mirrorCheckbox.dispatchEvent(new Event('change'));
check(landmarkBeforeMirror.index === 27 && landmarkBeforeMirror.x === 0.2
  && video.style.transform === 'none' && canvas.style.transform === 'none', 'Mirror never swaps or transforms computation landmarks');
inferenceStatus = 'no_pose';
clock += 100;
video.currentTime += 0.1;
tick();
check(!camera.getState().hasSample && observations.at(-1) === null, 'Missing tracking clears the last sample');
inferenceStatus = 'pose';
clock += 100;
video.currentTime += 0.1;
tick();
check(camera.getState().hasSample, 'A fresh observation can resume after missing tracking');
clock += 501;
for (const callback of intervals.values()) callback();
check(!camera.getState().hasSample && camera.getState().tracking === 'stale'
  && observations.at(-1) === null, 'A stalled frame clears evidence after 450 ms');

switchTo('two');
check(activeTrack.readyState === 'ended' && closedModels.includes(2), 'Switching releases the running stream and model');
const secondTrack = new Track('two');
requests[4].resolve(streamFor(secondTrack));
await flush();
modelRequests[2].resolve();
await flush();
clock += 100;
video.currentTime += 0.1;
tick();
secondTrack.muted = true;
secondTrack.dispatchEvent(new Event('mute'));
check(!camera.getState().hasSample && camera.getState().tracking === 'muted', 'A muted track clears evidence immediately');
secondTrack.muted = false;
secondTrack.dispatchEvent(new Event('unmute'));
clock += 100;
video.currentTime += 0.1;
tick();
check(camera.getState().hasSample, 'Only a new observation resumes tracking after unmute');
secondTrack.dispatchEvent(new Event('ended'));
check(!camera.getState().running && video.srcObject === null && closedModels.includes(3), 'A disconnected camera releases resources');
start();
requests[5].reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
await flush();
check(camera.getState().phase === 'error' && !camera.getState().running
  && statusElement.textContent.includes('permission'), 'Permission denial leaves a recoverable stopped state');
start();
documentStub.hidden = true;
documentStub.dispatchEvent(new Event('visibilitychange'));
const hiddenTrack = new Track('two');
requests[6].resolve(streamFor(hiddenTrack));
await flush();
check(hiddenTrack.readyState === 'ended' && !camera.getState().running, 'Hidden page cancels a pending start and releases its late stream');
camera.destroy();
check(startButton.disabled && stopButton.disabled, 'Destroyed controls cannot restart a camera');

console.log(JSON.stringify({
  provenance: 'Explicitly simulated lifecycle controls; no physical camera or MediaPipe accuracy claim',
  checks, passed: true, maximumConcurrentModelInitializations: maximumInitializations,
  modelInitializations: modelRequests.length, modelsClosed: closedModels,
  inferenceCalls: inferenceSources.length, stoppedTracks: camera.getState().stoppedTracks,
}, null, 2));
