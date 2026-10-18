import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveObjectURL } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { fetchLessonResource, storePreparedLesson, takePreparedLesson, type PreparedLesson } from '../features/qi-mirror/lib/lesson-preload';
import { readRecordedAnalysis } from '../features/qi-mirror/lib/practice-display';

test('lesson progress counts real decoded stream bytes rather than compressed Content-Length', async context => {
  const bytes = new TextEncoder().encode('{"title":"墨竹"}');
  context.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(bytes.slice(0, 5)); controller.enqueue(bytes.slice(5)); controller.close(); },
  }), { headers: { 'Content-Type': 'application/json', 'Content-Length': '3' } }));
  const increments: number[] = [];
  const response = await fetchLessonResource({ src: '/practice-media/example.json', bytes: bytes.length }, new AbortController().signal, count => increments.push(count));
  assert.equal(increments.reduce((sum, count) => sum + count, 0), bytes.length);
  assert.deepEqual(await response.json(), { title: '墨竹' });
});

test('changed sizes and failed resources never count as a prepared lesson', async context => {
  const mocked = context.mock.method(globalThis, 'fetch', async () => new Response('partial'));
  await assert.rejects(fetchLessonResource({ src: '/practice-media/example.mp4', bytes: 100 }, new AbortController().signal, () => {}), /changed while loading/);
  mocked.mock.mockImplementation(async () => new Response('missing', { status: 404 }));
  await assert.rejects(fetchLessonResource({ src: '/practice-media/example.mp4', bytes: 7 }, new AbortController().signal, () => {}), /could not be loaded/);
});

test('cancelled loading starts no resource request', async context => {
  const mocked = context.mock.method(globalThis, 'fetch', async () => new Response('never'));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(fetchLessonResource({ src: '/practice-media/example.mp4', bytes: 5 }, controller.signal, () => {}), { name: 'AbortError' });
  assert.equal(mocked.mock.callCount(), 0);
});

test('cancelling a pending stream stops reading without claiming its remaining bytes', async context => {
  let cancelled = false;
  const controller = new AbortController();
  context.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(stream) { stream.enqueue(new Uint8Array([1, 2])); },
    cancel() { cancelled = true; },
  })));
  let received = 0;
  await assert.rejects(fetchLessonResource({ src: '/practice-media/example.mp4', bytes: 10 }, controller.signal, count => { received += count; controller.abort(); }), { name: 'AbortError' });
  assert.equal(received, 2);
  assert.equal(cancelled, true);
});

test('prepared resources transfer once to their own form and replaced blobs are released', () => {
  const makeLesson = (form: number): PreparedLesson => ({ form, teaching: new Response('{}'), reference: new Response('{}'), poses: new Response('{}'), videoSrc: `/practice-media/24-${form}.mp4`, videoUrl: URL.createObjectURL(new Blob(['local instructor'])) });
  const first = makeLesson(1), next = makeLesson(24);
  storePreparedLesson(first);
  storePreparedLesson(next);
  assert.equal(resolveObjectURL(first.videoUrl), undefined);
  assert.equal(takePreparedLesson(1), null);
  assert.equal(takePreparedLesson(24), next);
  assert.equal(takePreparedLesson(24), null);
  assert.ok(resolveObjectURL(next.videoUrl));
  URL.revokeObjectURL(next.videoUrl);
});

test('preloaded instructor observations still require the original source and model provenance', async context => {
  const playlist = JSON.parse(await readFile('public/practice-media/24-playlist.json', 'utf8'));
  const clip = playlist.clips[0];
  const poses = JSON.parse(await readFile(`public${clip.referencePoseSrc}`, 'utf8'));
  const video = { videoWidth: poses.width, videoHeight: poses.height, duration: poses.durationMs / 1000 } as HTMLVideoElement;
  const mocked = context.mock.method(globalThis, 'fetch', async () => { throw new Error('Prepared poses must not be fetched again'); });
  assert.equal((await readRecordedAnalysis(clip, video, new Response(JSON.stringify(poses))))?.samples.length, poses.samples.length);
  assert.equal(await readRecordedAnalysis(clip, video, new Response(JSON.stringify({ ...poses, src: '/practice-media/other.mp4' }))), null);
  assert.equal(await readRecordedAnalysis(clip, video, new Response(JSON.stringify({ ...poses, modelSha256: 'wrong-model' }))), null);
  assert.equal(mocked.mock.callCount(), 0);
});
