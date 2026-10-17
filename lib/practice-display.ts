import { PRACTICE_CONNECTIONS, PRACTICE_JOINTS, type PoseSample } from './imitation';

export interface PracticeReferenceClip { id: string; src: string; sha256?: string; referencePoseSrc?: string }
export interface ReferenceAnalysis { samples: PoseSample[]; durationMs: number }

const MODEL_SHA256 = '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a';

/** Saved observations are only for recorded instructor frames, never the camera. */
export async function readRecordedAnalysis(clip: PracticeReferenceClip, video: HTMLVideoElement): Promise<ReferenceAnalysis | null> {
  if (!clip.referencePoseSrc || !clip.sha256 || !/^\/practice-media\/[^?#]+\.poses\.json$/.test(clip.referencePoseSrc) || clip.referencePoseSrc.includes('..')) return null;
  try {
    const response = await fetch(clip.referencePoseSrc, { cache: 'no-cache' });
    if (!response.ok) return null;
    const data = await response.json();
    if (data.schemaVersion !== 'recorded-reference-pose-v1' || data.clipId !== clip.id || data.src !== clip.src || data.sourceClipSha256 !== clip.sha256 || data.modelSha256 !== MODEL_SHA256
      || data.width !== video.videoWidth || data.height !== video.videoHeight || !Number.isFinite(data.durationMs) || Math.abs(data.durationMs - video.duration * 1000) > 50 || !Array.isArray(data.samples) || data.samples.length < 9 || data.samples.length > 20000) return null;
    let previous = -1;
    for (const sample of data.samples as PoseSample[]) {
      if (!Number.isFinite(sample.tMs) || sample.tMs <= previous || sample.tMs < 0 || sample.tMs > data.durationMs || !['pose', 'no_pose', 'inference_error'].includes(sample.status) || !Array.isArray(sample.landmarks)) return null;
      previous = sample.tMs;
      if (sample.status !== 'pose' && sample.landmarks.length) return null;
      if (sample.landmarks.length > PRACTICE_JOINTS.length || new Set(sample.landmarks.map((point) => point.index)).size !== sample.landmarks.length || sample.landmarks.some((point) => !PRACTICE_JOINTS.some((joint) => joint === point.index) || ![point.x, point.y, point.z, point.visibility].every(Number.isFinite) || point.visibility < 0 || point.visibility > 1)) return null;
    }
    return { samples: data.samples, durationMs: data.durationMs };
  } catch { return null; }
}

export function clearCanvas(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  canvas.getAnimations().forEach((animation) => animation.cancel());
  canvas.style.opacity = '0';
  canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
}

export function drawPose(canvas: HTMLCanvasElement | null, video: HTMLVideoElement | null, sample?: PoseSample, expiresInMs?: number, guide = false) {
  if (!canvas || !video || !sample || sample.status !== 'pose' || !video.videoWidth) { clearCanvas(canvas); return; }
  canvas.getAnimations().forEach((animation) => animation.cancel());
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, width, height);
  const visible = new Map(sample.landmarks.filter((point) => point.visibility >= 0.45 && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1).map((point) => [point.index, point]));
  context.lineWidth = Math.max(2.5, width / 230);
  context.strokeStyle = guide ? '#ffc269' : '#68ead0';
  context.setLineDash(guide ? [width / 75, width / 130] : []);
  context.globalAlpha = guide ? 0.82 : 1;
  context.lineCap = 'round';
  context.shadowColor = '#10242c';
  context.shadowBlur = 3;
  for (const [a, b] of PRACTICE_CONNECTIONS) {
    const start = visible.get(a);
    const end = visible.get(b);
    if (!start || !end) continue;
    context.beginPath(); context.moveTo(start.x * width, start.y * height); context.lineTo(end.x * width, end.y * height); context.stroke();
  }
  for (const point of visible.values()) {
    context.beginPath(); context.arc(point.x * width, point.y * height, Math.max(3.5, width / 150), 0, Math.PI * 2);
    context.fillStyle = guide ? '#ffc269' : '#e5fff2'; context.fill();
    context.strokeStyle = guide ? '#9e6320' : '#0b9b84'; context.lineWidth = Math.max(1.5, width / 380); context.stroke();
  }
  context.setLineDash([]); context.globalAlpha = 1;
  canvas.style.opacity = '1';
  // A compositor animation also expires the overlay if the main thread is busy.
  if (expiresInMs !== undefined) canvas.animate([{ opacity: 1, offset: 0 }, { opacity: 1, offset: 0.98 }, { opacity: 0, offset: 1 }], { duration: Math.max(1, expiresInMs), fill: 'forwards' });
}

export function visibleJoints(sample?: PoseSample) {
  return sample?.status === 'pose' ? sample.landmarks.filter((point) => PRACTICE_JOINTS.some((index) => index === point.index) && point.visibility >= 0.45 && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1).length : 0;
}

export function waitForVideo(video: HTMLVideoElement, event: 'loadeddata' | 'seeked', timeoutMs = 20000): Promise<void> {
  return new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout>;
    const cleanup = () => { clearTimeout(timeout); video.removeEventListener(event, done); video.removeEventListener('error', failed); };
    const done = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error('The reference clip could not be decoded. Check the local video asset and use desktop Chrome.')); };
    timeout = setTimeout(() => { cleanup(); reject(new Error('The reference clip took too long to decode. Reload the page and retry.')); }, timeoutMs);
    video.addEventListener(event, done, { once: true });
    video.addEventListener('error', failed, { once: true });
  });
}

export async function seekTo(video: HTMLVideoElement, seconds: number) {
  if (Math.abs(video.currentTime - seconds) < 0.002 && video.readyState >= 2) return;
  const seek = waitForVideo(video, 'seeked');
  video.currentTime = seconds;
  await seek;
}

export function cameraErrorMessage(cause: unknown) {
  const name = cause instanceof Error ? cause.name : '';
  if (name === 'NotAllowedError') return 'Camera permission was denied. Allow the camera in this browser’s site settings, then choose Start camera again.';
  if (name === 'NotFoundError') return 'No camera was found. Connect a camera, then choose Start camera again.';
  if (name === 'NotReadableError') return 'The camera is busy or unavailable. Close other camera apps, then retry.';
  return cause instanceof Error ? cause.message : 'The camera could not start. Open this local address in desktop Chrome and retry.';
}

