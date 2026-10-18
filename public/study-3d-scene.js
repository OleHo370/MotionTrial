import * as THREE from './vendor/study-3d/three.module.js';
import { OrbitControls } from './vendor/study-3d/OrbitControls.js';

// These are display rotations, not camera calibration. Derived once from the
// median shoulder baseline in the first 0.5 seconds of each source's Opening.
export const COORDINATE_TRANSFORMS = Object.freeze({
  front: Object.freeze({ yawRadians: 0.08539825916780035, referenceFrames: [240, 254], referenceSeconds: [8, 8.5] }),
  back: Object.freeze({ yawRadians: 3.037440977362589, referenceFrames: [180, 194], referenceSeconds: [6, 6.5] }),
});
export const VISIBILITY_THRESHOLD = 0.45;
export const HIP_DISPLAY_HEIGHT = 0.95;
export const POSE_CONNECTIONS = Object.freeze([
  [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8], [9, 10],
  [11, 12], [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  [11, 23], [12, 24], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28],
  [27, 29], [28, 30], [29, 31], [30, 32], [27, 31], [28, 32],
]);
const JOINT_NAMES = [
  'Nose', 'Left eye inner', 'Left eye', 'Left eye outer', 'Right eye inner', 'Right eye',
  'Right eye outer', 'Left ear', 'Right ear', 'Mouth left', 'Mouth right',
  'Left shoulder', 'Right shoulder', 'Left elbow', 'Right elbow', 'Left wrist', 'Right wrist',
  'Left pinky', 'Right pinky', 'Left index', 'Right index', 'Left thumb', 'Right thumb',
  'Left hip', 'Right hip', 'Left knee', 'Right knee', 'Left ankle', 'Right ankle',
  'Left heel', 'Right heel', 'Left foot index', 'Right foot index',
];
const ANGLE_TRIPLETS = { 13: [11, 13, 15], 14: [12, 14, 16], 25: [23, 25, 27], 26: [24, 26, 28] };
const LEFT_INDICES = new Set([1, 2, 3, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31]);
const SOURCE_COLORS = { front: { left: 0x36b8af, right: 0x087f83, bone: 0x233d57 }, back: { left: 0xf4be55, right: 0xbf7f16, bone: 0x9d762f } };
const EMPTY_POINTS = () => Array.from({ length: 33 }, () => null);

function indexedPoints(points) {
  const result = Array(33);
  if (!Array.isArray(points)) return result;
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    const index = Number.isInteger(point?.index) ? point.index : i;
    if (index >= 0 && index < 33) result[index] = point;
  }
  return result;
}

function pointConfidence(image, world) {
  if (!image || !world || ![world.x, world.y, world.z, image.x, image.y, image.z].every(Number.isFinite)) return null;
  // Confidence must exist in both observations; absence is unknown, not 100%.
  if (![image.visibility, image.presence, world.visibility, world.presence].every(Number.isFinite)) return null;
  return Math.max(0, Math.min(1, image.visibility, image.presence, world.visibility, world.presence));
}

export function transformSample(sample, source, options = {}) {
  const state = {
    frameIndex: sample?.frameIndex ?? null, sourceTimeSeconds: sample?.sourceTimeSeconds ?? null,
    status: sample?.status ?? 'unavailable', reason: null, drawnPoints: 0, drawnBones: 0,
    validIndices: [], points: EMPTY_POINTS(), confidences: EMPTY_POINTS(), trailSegments: 0,
  };
  if (!sample || sample.status !== 'pose') return state;
  const world = indexedPoints(sample.worldLandmarks);
  const image = indexedPoints(sample.landmarks);
  state.confidences = world.map((point, index) => pointConfidence(image[index], point));
  if (![23, 24].every(index => state.confidences[index] >= VISIBILITY_THRESHOLD)) {
    state.reason = 'hip_anchor_unknown';
    return state;
  }
  const hip = {
    x: (world[23].x + world[24].x) / 2,
    y: (world[23].y + world[24].y) / 2,
    z: (world[23].z + world[24].z) / 2,
  };
  const transforms = options.coordinateTransforms || COORDINATE_TRANSFORMS;
  const yaw = (transforms[source] || COORDINATE_TRANSFORMS[source]).yawRadians;
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  for (let index = 0; index < 33; index += 1) {
    if (!(state.confidences[index] >= VISIBILITY_THRESHOLD)) continue;
    const point = world[index];
    // Two axis sign changes preserve handedness. No anatomical labels change.
    const x = point.x - hip.x;
    const y = -point.y + hip.y + HIP_DISPLAY_HEIGHT;
    const z = -point.z + hip.z;
    const displayX = cos * x + sin * z;
    // Optional display reflection matches a mirrored tutorial. Anatomical IDs
    // and source observations stay unchanged; this is not inferred movement.
    state.points[index] = [(source === 'front' && options.mirrorFront ? -1 : 1) * displayX, y, -sin * x + cos * z];
    state.validIndices.push(index);
  }
  state.drawnPoints = state.validIndices.length;
  state.drawnBones = POSE_CONNECTIONS.filter(([a, b]) => state.points[a] && state.points[b]).length;
  return state;
}

function angleFor(state, index) {
  const triple = ANGLE_TRIPLETS[index];
  if (!triple || !triple.every(i => state.points[i])) return undefined;
  const [a, b, c] = triple.map(i => state.points[i]);
  const ab = a.map((v, i) => v - b[i]), cb = c.map((v, i) => v - b[i]);
  const denominator = Math.hypot(...ab) * Math.hypot(...cb);
  if (denominator < 1e-8) return undefined;
  return Math.acos(Math.max(-1, Math.min(1, ab.reduce((sum, v, i) => sum + v * cb[i], 0) / denominator))) * 180 / Math.PI;
}

function fallback(container, error) {
  const element = document.createElement('div');
  element.className = 'study-3d-webgl-error';
  element.setAttribute('role', 'status');
  element.style.cssText = 'display:grid;place-content:center;min-height:390px;padding:32px;text-align:center;color:#263b4e;background:#edf2f4;border-radius:16px;font:500 15px/1.7 system-ui';
  const heading = document.createElement('strong');
  heading.textContent = '3D rendering is unavailable in this browser';
  const description = document.createElement('p');
  description.textContent = 'Enable browser hardware acceleration and reload this page. The original videos and movement navigation remain available.';
  element.append(heading, description);
  container.appendChild(element);
  return {
    update() {}, setView() {}, setAutoRotate() {}, resize() {},
    dispose() { element.remove(); },
    getDiagnostics() { return { ready: false, error: String(error?.message || error), views: {} }; },
  };
}

export function createStudyScene(container, onInspect = () => {}, options = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  } catch (error) { return fallback(container, error); }

  const coordinateTransforms = { ...COORDINATE_TRANSFORMS, ...options.coordinateTransforms };
  const displayOptions = { coordinateTransforms, mirrorFront: Boolean(options.mirrorFront) };
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0xeef2f3, 1);
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none';
  renderer.domElement.setAttribute('aria-label', 'Rotatable 3D MediaPipe skeleton. Drag to orbit, scroll to zoom, click a joint to inspect.');
  renderer.domElement.setAttribute('tabindex', '0');
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xeef2f3, 5, 12);
  const camera = new THREE.PerspectiveCamera(39, 1, 0.04, 30);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.97, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.095;
  controls.minDistance = 1.5;
  controls.maxDistance = 6.5;
  controls.maxPolarAngle = Math.PI * 0.89;
  controls.autoRotateSpeed = 0.65;
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb9c5ce, 2.4));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(-3, 5, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.9);
  fill.position.set(3, 2, -3);
  scene.add(fill);

  const floor = new THREE.Mesh(new THREE.CircleGeometry(5.5, 100), new THREE.MeshStandardMaterial({ color: 0xe7edef, roughness: 1, metalness: 0 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.016;
  scene.add(floor);
  const grid = new THREE.GridHelper(8, 32, 0xc6d2d9, 0xd8e1e5);
  grid.position.y = -0.01;
  grid.material.transparent = true;
  grid.material.opacity = 0.65;
  scene.add(grid);
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.03, 1.044, 100), new THREE.MeshBasicMaterial({ color: 0xb6c8d0, side: THREE.DoubleSide, transparent: true, opacity: 0.7 }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -0.004;
  scene.add(ring);
  const centerRing = new THREE.Mesh(new THREE.RingGeometry(0.065, 0.078, 40), new THREE.MeshBasicMaterial({ color: 0x708b9c, side: THREE.DoubleSide, transparent: true, opacity: 0.4 }));
  centerRing.rotation.x = -Math.PI / 2;
  centerRing.position.y = -0.003;
  scene.add(centerRing);

  const sphereGeometry = new THREE.SphereGeometry(1, 14, 10);
  const boneGeometry = new THREE.CylinderGeometry(1, 1, 1, 10, 1, false);
  const up = new THREE.Vector3(0, 1, 0);
  const from = new THREE.Vector3(), to = new THREE.Vector3(), direction = new THREE.Vector3();
  const views = {};
  const pickingMeshes = [];
  const makeView = source => {
    const group = new THREE.Group();
    scene.add(group);
    const colors = SOURCE_COLORS[source];
    const joints = Array.from({ length: 33 }, (_, index) => {
      const color = LEFT_INDICES.has(index) ? colors.left : colors.right;
      const material = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.08, transparent: true });
      const mesh = new THREE.Mesh(sphereGeometry, material);
      const radius = index < 11 ? 0.011 : [11, 12, 23, 24].includes(index) ? 0.023 : 0.018;
      mesh.scale.setScalar(radius);
      mesh.visible = false;
      mesh.userData = { index, source };
      group.add(mesh);
      pickingMeshes.push(mesh);
      return mesh;
    });
    const bones = POSE_CONNECTIONS.map(([a, b]) => {
      const material = new THREE.MeshStandardMaterial({ color: colors.bone, roughness: 0.65, transparent: true });
      const mesh = new THREE.Mesh(boneGeometry, material);
      mesh.visible = false;
      mesh.userData = { a, b };
      group.add(mesh);
      return mesh;
    });
    const trails = [15, 16].map(index => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 3), 3));
      geometry.setDrawRange(0, 0);
      const material = new THREE.LineBasicMaterial({ color: LEFT_INDICES.has(index) ? colors.left : colors.right, transparent: true, opacity: 0.66, depthWrite: false });
      const line = new THREE.Line(geometry, material);
      line.frustumCulled = false;
      group.add(line);
      return { index, line, queue: [] };
    });
    return { source, group, joints, bones, trails, state: transformSample(null, source, displayOptions), previousFrame: null, previousTime: null };
  };
  views.front = makeView('front');
  views.back = makeView('back');
  let mode = 'front', resetToken, trailsEnabled = false, disposed = false, frameHandle, lastAnimationTime = 0;
  let renderingError = null, renderingErrorElement = null;

  function clearTrails(view) {
    for (const trail of view.trails) {
      trail.queue.length = 0;
      trail.line.geometry.setDrawRange(0, 0);
    }
    view.previousFrame = null;
    view.previousTime = null;
    view.state.trailSegments = 0;
  }

  function updateTrails(view, enabled) {
    const state = view.state;
    if (!enabled || state.status !== 'pose' || !state.drawnPoints || !Number.isFinite(state.frameIndex) || !Number.isFinite(state.sourceTimeSeconds)) {
      clearTrails(view);
      return;
    }
    const deltaFrame = view.previousFrame === null ? null : state.frameIndex - view.previousFrame;
    const deltaTime = view.previousTime === null ? null : state.sourceTimeSeconds - view.previousTime;
    if (deltaFrame === 0) {
      state.trailSegments = view.trails.reduce((total, trail) => total + Math.max(0, trail.queue.length - 1), 0);
      return;
    }
    if (deltaFrame !== null && (deltaFrame !== 1 || deltaTime <= 0 || deltaTime > 0.12)) clearTrails(view);
    let segments = 0;
    for (const trail of view.trails) {
      const point = state.points[trail.index];
      if (!point) trail.queue.length = 0;
      else {
        trail.queue.push({ t: state.sourceTimeSeconds, point });
        while (trail.queue.length > 64 || (trail.queue.length && state.sourceTimeSeconds - trail.queue[0].t > 0.7)) trail.queue.shift();
      }
      const attribute = trail.line.geometry.getAttribute('position');
      trail.queue.forEach((item, i) => attribute.setXYZ(i, ...item.point));
      attribute.needsUpdate = true;
      trail.line.geometry.setDrawRange(0, trail.queue.length);
      segments += Math.max(0, trail.queue.length - 1);
    }
    view.previousFrame = state.frameIndex;
    view.previousTime = state.sourceTimeSeconds;
    state.trailSegments = segments;
  }

  function drawView(view, sample) {
    view.state = transformSample(sample, view.source, displayOptions);
    const state = view.state;
    view.joints.forEach((mesh, index) => {
      const point = state.points[index];
      mesh.visible = Boolean(point);
      if (point) {
        mesh.position.set(...point);
        mesh.material.opacity = 0.35 + 0.65 * ((state.confidences[index] - VISIBILITY_THRESHOLD) / (1 - VISIBILITY_THRESHOLD));
      }
    });
    view.bones.forEach(mesh => {
      const { a, b } = mesh.userData;
      const pa = state.points[a], pb = state.points[b];
      mesh.visible = Boolean(pa && pb);
      if (!mesh.visible) return;
      from.set(...pa); to.set(...pb);
      direction.subVectors(to, from);
      const length = direction.length();
      // The cylinder length is the observed distance. No skeleton retargeting.
      const radius = a < 11 && b < 11 ? 0.005 : view.source === 'front' ? 0.011 : 0.009;
      mesh.position.copy(from).add(to).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(up, direction.normalize());
      mesh.scale.set(radius, length, radius);
      mesh.material.opacity = 0.3 + 0.65 * ((Math.min(state.confidences[a], state.confidences[b]) - VISIBILITY_THRESHOLD) / (1 - VISIBILITY_THRESHOLD));
    });
    updateTrails(view, trailsEnabled && view.group.visible);
  }

  function update(options = {}) {
    if (disposed) return;
    const nextMode = ['front', 'back', 'both'].includes(options.mode) ? options.mode : mode;
    if (nextMode !== mode || options.resetToken !== resetToken || Boolean(options.showTrails) !== trailsEnabled) {
      Object.values(views).forEach(clearTrails);
    }
    mode = nextMode;
    resetToken = options.resetToken;
    trailsEnabled = Boolean(options.showTrails);
    views.front.group.visible = mode !== 'back';
    views.back.group.visible = mode !== 'front';
    drawView(views.front, options.frontSample);
    drawView(views.back, options.backSample);
  }

  function setView(view = 'iso') {
    const directions = {
      front: [0, 0.1, 3.5], back: [0, 0.1, -3.5], left: [3.5, 0.1, 0],
      right: [-3.5, 0.1, 0], top: [0, 3.6, 0.001], iso: [2.25, 1.1, 3],
    };
    const offset = directions[view] || directions.iso;
    camera.position.set(controls.target.x + offset[0], controls.target.y + offset[1], controls.target.z + offset[2]);
    controls.update();
  }

  function resize() {
    if (disposed) return;
    const rect = container.getBoundingClientRect();
    const width = Math.max(1, rect.width), height = Math.max(1, rect.height || 500);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pointerStart = null;
  const pointerDown = event => { pointerStart = { x: event.clientX, y: event.clientY }; };
  const pointerUp = event => {
    if (!pointerStart || Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5) { pointerStart = null; return; }
    pointerStart = null;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(pickingMeshes.filter(mesh => mesh.visible && views[mesh.userData.source].group.visible));
    if (!hits.length) return;
    const { index, source } = hits[0].object.userData;
    const state = views[source].state;
    const payload = { index, source, name: JOINT_NAMES[index], visibility: state.confidences[index], confidence: state.confidences[index], sourceTimeSeconds: state.sourceTimeSeconds };
    const angle = angleFor(state, index);
    if (Number.isFinite(angle)) payload.angle = angle;
    onInspect(payload);
  };
  renderer.domElement.addEventListener('pointerdown', pointerDown);
  renderer.domElement.addEventListener('pointerup', pointerUp);
  const contextLost = event => {
    event.preventDefault();
    renderingError = 'WebGL context lost. Reload the page to restore 3D rendering.';
    renderer.domElement.setAttribute('aria-label', renderingError);
    if (!renderingErrorElement) {
      renderingErrorElement = document.createElement('div');
      renderingErrorElement.setAttribute('role', 'status');
      renderingErrorElement.textContent = renderingError;
      renderingErrorElement.style.cssText = 'position:absolute;inset:35% 12% auto;padding:24px;border:1px solid #c8d5dc;border-radius:14px;background:#f7f9fa;color:#233d57;text-align:center;font:500 15px/1.6 system-ui;z-index:2';
      container.appendChild(renderingErrorElement);
    }
    container.dispatchEvent(new CustomEvent('study3derror', { detail: renderingError }));
  };
  renderer.domElement.addEventListener('webglcontextlost', contextLost);
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  setView('iso');
  resize();
  function animate(time) {
    if (disposed) return;
    const delta = lastAnimationTime ? Math.min(0.05, (time - lastAnimationTime) / 1000) : 0;
    lastAnimationTime = time;
    controls.update(delta);
    if (!renderingError) renderer.render(scene, camera);
    frameHandle = requestAnimationFrame(animate);
  }
  frameHandle = requestAnimationFrame(animate);

  return {
    update, setView, resize,
    setAutoRotate(enabled) { controls.autoRotate = Boolean(enabled); },
    getDiagnostics() {
      return {
        ready: !renderingError, error: renderingError, mode, visibilityThreshold: VISIBILITY_THRESHOLD,
        coordinatePolicy: 'x,-y,-z; fixed initial-stance yaw; hips centered; no inferred travel, fusion, rescaling, or interpolation'
          + (displayOptions.mirrorFront ? '; front x reflected for mirrored tutorial display; anatomical IDs unchanged' : ''),
        coordinateTransforms, mirrorFront: displayOptions.mirrorFront,
        displayMirrors: { front: displayOptions.mirrorFront, back: false }, hipDisplayHeight: HIP_DISPLAY_HEIGHT,
        cameraPosition: camera.position.toArray(), target: controls.target.toArray(),
        autoRotate: controls.autoRotate, showTrails: trailsEnabled, showGhosts: false,
        views: Object.fromEntries(Object.entries(views).map(([source, view]) => [source, {
          ...view.state, visible: view.group.visible,
          drawnPoints: view.group.visible ? view.state.drawnPoints : 0,
          drawnBones: view.group.visible ? view.state.drawnBones : 0,
        }])),
      };
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frameHandle);
      observer.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      scene.traverse(object => {
        if (object.geometry && ![sphereGeometry, boneGeometry].includes(object.geometry)) object.geometry.dispose();
        if (object.material) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach(material => material.dispose());
        }
      });
      sphereGeometry.dispose(); boneGeometry.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      renderingErrorElement?.remove();
    },
  };
}
