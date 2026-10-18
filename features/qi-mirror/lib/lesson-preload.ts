import { parseTeachingPlaylist } from '@/lib/teaching';
import { readRecordedAnalysis } from './practice-display';

export interface LessonResource { src: string; bytes: number }
export interface LessonLoadPlan {
  form: number;
  title: string;
  chineseTitle: string;
  resources: [LessonResource, LessonResource, LessonResource, LessonResource];
}
export interface PreparedLesson {
  form: number;
  teaching: Response;
  reference: Response;
  poses: Response;
  videoSrc: string;
  videoUrl: string;
}

let prepared: PreparedLesson | null = null;
let expiry: ReturnType<typeof setTimeout> | undefined;

/** Only local instructor resources are held, once, across client-side navigation. */
export function storePreparedLesson(lesson: PreparedLesson) {
  if (expiry) clearTimeout(expiry);
  if (prepared && prepared !== lesson) URL.revokeObjectURL(prepared.videoUrl);
  prepared = lesson;
  expiry = setTimeout(() => {
    if (prepared) URL.revokeObjectURL(prepared.videoUrl);
    prepared = null;
    expiry = undefined;
  }, 60_000);
}

export function takePreparedLesson(form: number): PreparedLesson | null {
  if (!prepared || prepared.form !== form) return null;
  const lesson = prepared;
  prepared = null;
  if (expiry) clearTimeout(expiry);
  expiry = undefined;
  return lesson;
}

export async function fetchLessonResource(resource: LessonResource, signal: AbortSignal, onBytes: (bytes: number) => void): Promise<Response> {
  signal.throwIfAborted();
  const response = await fetch(resource.src, { cache: 'no-cache', signal });
  if (!response.ok) throw new Error('A lesson resource could not be loaded. Please retry.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('This browser could not read the lesson. Please use desktop Chrome.');
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let received = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value.slice());
      received += value.byteLength;
      onBytes(value.byteLength);
    }
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  // The plan uses local file sizes, not compressed Content-Length headers.
  if (received !== resource.bytes) throw new Error('The lesson changed while loading. Reload this page and retry.');
  return new Response(new Blob(chunks, { type: response.headers.get('Content-Type') ?? 'application/octet-stream' }));
}

async function decodeVideo(video: HTMLVideoElement, src: string, signal: AbortSignal) {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      video.removeEventListener('loadeddata', loaded);
      video.removeEventListener('error', failed);
      signal.removeEventListener('abort', aborted);
    };
    const loaded = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error('The instructor video could not be decoded. Please retry in Chrome.')); };
    const aborted = () => { cleanup(); reject(signal.reason ?? new DOMException('Loading cancelled', 'AbortError')); };
    const timeout = setTimeout(failed, 20_000);
    video.addEventListener('loadeddata', loaded, { once: true });
    video.addEventListener('error', failed, { once: true });
    signal.addEventListener('abort', aborted, { once: true });
    video.src = src;
    video.load();
  });
}

export async function prepareLesson(plan: LessonLoadPlan, signal: AbortSignal, onProgress: (progress: number) => void): Promise<PreparedLesson> {
  const total = plan.resources.reduce((sum, resource) => sum + resource.bytes, 0);
  let received = 0;
  onProgress(0);
  const responses = await Promise.all(plan.resources.map(resource => fetchLessonResource(resource, signal, bytes => {
    received += bytes;
    onProgress(Math.min(98, Math.floor(received / total * 98)));
  })));
  signal.throwIfAborted();
  const teaching = parseTeachingPlaylist(await responses[0].clone().json());
  const reference = await responses[1].clone().json();
  const step = teaching.steps.find(item => item.parentFormOrder === plan.form);
  const clip = Array.isArray(reference.clips) ? reference.clips.find((item: { id: string }) => item.id === step?.parentFormId) : null;
  if (!step || !clip || teaching.referencePlaylistSrc !== plan.resources[1].src
    || clip.src !== plan.resources[2].src || clip.referencePoseSrc !== plan.resources[3].src) throw new Error('The selected form does not match this lesson. Return to the form wheel and retry.');
  onProgress(99);
  const videoUrl = URL.createObjectURL(await responses[2].blob());
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  try {
    await decodeVideo(video, videoUrl, signal);
    if (!Number.isFinite(video.duration) || step.endSeconds > video.duration + .05) throw new Error('The first step exceeds the instructor video.');
    if (!await readRecordedAnalysis(clip, video, responses[3].clone())) throw new Error('The saved instructor poses could not be verified. Please retry.');
    signal.throwIfAborted();
    onProgress(100);
    return { form: plan.form, teaching: responses[0], reference: responses[1], poses: responses[3], videoSrc: clip.src, videoUrl };
  } catch (error) {
    URL.revokeObjectURL(videoUrl);
    throw error;
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
}
