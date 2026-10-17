import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SessionStore } from '../lib/server/store';
import { assertSameOrigin, boundedBody, saveReview, streamVideo, uploadSession } from '../lib/server/http';
import { ApiError, MAX_REQUEST_BYTES, parseCapture } from '../lib/server/validation';
import { INSTRUCTIONS, MODEL_VERSION, TASK_ID, TASK_VERSION, type CaptureMetadata, type Observation } from '../lib/types';

const temporaryDirs: string[] = [];
const stores: SessionStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of temporaryDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function temporaryStore(options = {}): SessionStore {
  // Windows' sandbox temp area disallows atomic rename; exercise the actual
  // supported project-disk storage path instead, with isolated test directories.
  const root = path.resolve('.test-data'); mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(path.join(root, 'motiontrial-test-'));
  temporaryDirs.push(dir);
  const store = new SessionStore(dir, options); stores.push(store); return store;
}
function metadata(): CaptureMetadata {
  return { id: randomUUID(), demoCode: 'TEST-01', provenance: 'synthetic_demo', consentAt: '2026-10-16T10:00:00.000Z', recordedAt: '2026-10-16T10:00:01.000Z', durationMs: 2000, interrupted: false, taskId: TASK_ID, taskVersion: TASK_VERSION, instructions: INSTRUCTIONS, modelVersion: MODEL_VERSION, timing: { performanceStartMs: 100, recorderStartMs: 100, videoStartMs: 0 }, demoCase: 'API fixture — header validation only, not playable camera evidence' };
}
function observations(): Observation[] {
  return [{ tMs: 0, status: 'pose', landmarks: [11, 12, 13, 14, 15, 16].map(index => ({ index, x: 0.5, y: 0.5, z: 0, visibility: 0.9 })) }, { tMs: 100, status: 'no_pose', landmarks: [] }];
}
// This header fixture exercises persistence/streaming only. It is not a playable
// video and does not establish real camera or video decoding acceptance.
const VIDEO = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
function upload(meta = metadata(), obs = observations(), video = VIDEO, mime = 'video/webm', origin = 'http://localhost:3000') {
  const form = new FormData();
  form.set('video', new File([video], 'recording.webm', { type: mime }));
  form.set('metadata', JSON.stringify(meta)); form.set('observations', JSON.stringify(obs));
  return new Request('http://localhost:3000/api/sessions', { method: 'POST', headers: { origin }, body: form });
}
function reviewRequest(value: unknown, origin = 'http://localhost:3000') {
  return new Request('http://localhost:3000/api/sessions/id/review', { method: 'PATCH', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(value) });
}

test('multipart save survives SQLite reopen, recomputes time-weighted analysis, and retry creates one session', async () => {
  const store = temporaryStore(); const meta = metadata();
  const result = await uploadSession(upload(meta), store);
  assert.equal(result.status, 201);
  const saved = (await result.json()).session;
  assert.equal(saved.analysis.validMs, 100);
  assert.equal(saved.analysis.coverage, 0.05);
  assert.equal(store.list().length, 1);
  assert.equal('observations' in store.list()[0], false);
  assert.equal(readdirSync(path.join(store.dataDir, 'videos')).length, 1);
  assert.equal((await uploadSession(upload(meta), store)).status, 200);
  assert.equal(store.list().length, 1);
  assert.equal((await uploadSession(upload({ ...meta, demoCode: 'DIFFERENT' }), store)).status, 409);
  const dir = store.dataDir; store.close(); stores.splice(stores.indexOf(store), 1);
  const reopened = new SessionStore(dir); stores.push(reopened);
  assert.equal(reopened.get(meta.id).id, meta.id);
  assert.equal(reopened.get(meta.id).observations[1].status, 'no_pose');
});

test('failure between finalizing a video and inserting metadata leaves no saved session or orphan video', async () => {
  const store = temporaryStore({ beforeInsert() { throw new Error('Simulated disk/database failure'); } });
  assert.throws(() => store.save(metadata(), observations(), VIDEO, 'video/webm'), /Simulated/);
  assert.deepEqual(store.list(), []);
  assert.deepEqual(readdirSync(path.join(store.dataDir, 'videos')), []);
});

test('review updates append history and are read back from SQLite after reopening', async () => {
  const store = temporaryStore(); const meta = metadata();
  store.save(meta, observations(), VIDEO, 'video/webm');
  assert.equal((await saveReview(reviewRequest({ disposition: 'uncertain', note: 'Inspect wrist interval.' }), meta.id, store)).status, 200);
  assert.equal((await saveReview(reviewRequest({ disposition: 'recapture', note: 'Request a new authorized demo clip.', reviewer: 'Demo reviewer' }), meta.id, store)).status, 200);
  const dir = store.dataDir; store.close(); stores.splice(stores.indexOf(store), 1);
  const reopened = new SessionStore(dir); stores.push(reopened);
  assert.deepEqual(reopened.get(meta.id).reviews.map(entry => entry.disposition), ['uncertain', 'recapture']);
  assert.equal(reopened.get(meta.id).reviews[1].note, 'Request a new authorized demo clip.');
  assert.equal(reopened.get(meta.id).reviews[1].reviewer, 'Demo reviewer');
});

test('source-video endpoint returns full/range/suffix bytes and rejects invalid or multiple ranges', async () => {
  const store = temporaryStore(); const meta = metadata(); store.save(meta, [], VIDEO, 'video/webm');
  const get = (range?: string, method = 'GET') => streamVideo(new Request('http://localhost:3000/video', { method, headers: range ? { range } : {} }), meta.id, store);
  const full = get(); assert.equal(full.status, 200); assert.equal(full.headers.get('content-type'), 'video/webm');
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), VIDEO);
  const part = get('bytes=3-6'); assert.equal(part.status, 206); assert.equal(part.headers.get('content-range'), `bytes 3-6/${VIDEO.length}`);
  assert.deepEqual(Buffer.from(await part.arrayBuffer()), VIDEO.subarray(3, 7));
  assert.deepEqual(Buffer.from(await get('bytes=-4').arrayBuffer()), VIDEO.subarray(-4));
  assert.deepEqual(Buffer.from(await get('bytes=14-100').arrayBuffer()), VIDEO.subarray(14));
  for (const range of ['bytes=999-', 'bytes=5-3', 'bytes=-0', 'bytes=0-1,3-4', 'bytes=a-b', 'bytes=-']) {
    const response = get(range); assert.equal(response.status, 416, range); assert.equal(response.headers.get('content-range'), `bytes */${VIDEO.length}`);
  }
  const head = get(undefined, 'HEAD'); assert.equal(head.headers.get('content-length'), String(VIDEO.length)); assert.equal(await head.text(), '');
});

test('explicit session deletion removes only its own record and generated private video', () => {
  const store = temporaryStore(); const first = metadata(); const second = metadata();
  store.save(first, [], VIDEO, 'video/webm'); store.save({ ...second, parentSessionId: first.id }, [], VIDEO, 'video/webm');
  assert.equal(store.get(second.id).parentSessionId, first.id);
  store.delete(first.id);
  assert.throws(() => store.get(first.id), (error: unknown) => error instanceof ApiError && error.status === 404);
  assert.equal(store.get(second.id).id, second.id);
  assert.equal(readdirSync(path.join(store.dataDir, 'videos')).length, 1);
  assert.throws(() => store.delete('../../outside'), (error: unknown) => error instanceof ApiError && error.status === 400);
});

test('malformed timestamps, non-finite values, stale missing landmarks, invalid indices and fixed instructions are rejected', () => {
  const meta = metadata(); const obs = observations();
  const invalid = [
    [{ ...meta, instructions: 'Move faster.' }, obs],
    [{ ...meta, durationMs: 30_001 }, obs],
    [{ ...meta, consentAt: 'not-a-date' }, obs],
    [meta, [obs[1], obs[0]]],
    [meta, [{ ...obs[0], tMs: 2001 }]],
    [meta, [obs[0], { ...obs[1], tMs: 0 }]],
    [meta, [{ ...obs[0], status: 'unknown' }]],
    [meta, [{ ...obs[0], status: 'no_pose' }]],
    [meta, [{ ...obs[0], landmarks: obs[0].landmarks.map(point => ({ ...point, x: Infinity })) }]],
    [meta, [{ ...obs[0], landmarks: obs[0].landmarks.map(point => ({ ...point, index: 11 })) }]],
  ];
  for (const [metadataValue, observationValue] of invalid) assert.throws(() => parseCapture(JSON.stringify(metadataValue), JSON.stringify(observationValue)), ApiError);
  assert.throws(() => parseCapture('{', '[]'), /valid JSON/);
  const offscreen = observations(); offscreen[0].landmarks[0].x = 1.2;
  assert.equal(parseCapture(JSON.stringify(meta), JSON.stringify(offscreen)).observations[0].landmarks[0].x, 1.2);
});

test('unsupported/empty/mismatched videos and invalid decision enum are rejected clearly', async () => {
  const store = temporaryStore();
  for (const request of [upload(metadata(), [], Buffer.alloc(0)), upload(metadata(), [], VIDEO, 'image/png'), upload(metadata(), [], Buffer.from('not-video'), 'video/webm')]) {
    const response = await uploadSession(request, store); assert.ok([400, 415].includes(response.status)); assert.equal(typeof (await response.json()).error, 'string');
  }
  const meta = metadata(); store.save(meta, [], VIDEO, 'video/webm');
  assert.equal((await saveReview(reviewRequest({ disposition: 'diagnosed', note: '' }), meta.id, store)).status, 400);
  assert.equal(store.get(meta.id).reviews.length, 0);
});

test('streamed body byte limit cannot be bypassed by omitting or lying about Content-Length', async () => {
  for (const contentLength of [undefined, '1']) {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(5)); controller.enqueue(new Uint8Array(5)); }, cancel() { cancelled = true; } });
    const request = new Request('http://localhost:3000/api/sessions', { method: 'POST', body: stream, duplex: 'half', headers: contentLength ? { 'content-length': contentLength } : {} } as RequestInit & { duplex: 'half' });
    await assert.rejects(() => boundedBody(request, 8), (error: unknown) => error instanceof ApiError && error.status === 413);
    assert.equal(cancelled, true);
  }
  const store = temporaryStore();
  const response = await uploadSession(new Request('http://localhost:3000/api/sessions', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=x', 'content-length': String(MAX_REQUEST_BYTES + 1) }, body: 'x' }), store);
  assert.equal(response.status, 413);
});

test('cross-origin mutations fail and malformed multipart does not create a record', async () => {
  const store = temporaryStore();
  assert.equal((await uploadSession(upload(metadata(), [], VIDEO, 'video/webm', 'https://external.example'), store)).status, 403);
  assert.equal((await uploadSession(new Request('http://localhost:3000/api/sessions', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=nope' }, body: 'invalid' }), store)).status, 400);
  const duplicateFields = new FormData(); duplicateFields.append('metadata', '{}'); duplicateFields.append('metadata', '{}'); duplicateFields.set('observations', '[]'); duplicateFields.set('video', new File([VIDEO], 'recording.webm', { type: 'video/webm' }));
  assert.equal((await uploadSession(new Request('http://localhost:3000/api/sessions', { method: 'POST', body: duplicateFields }), store)).status, 400);
  assert.equal(store.list().length, 0);
});

test('same-origin guard uses the actual local Host when Next rewrites the internal Request URL', () => {
  const request = (host: string, origin: string, additionalHeaders = {}) => new Request('http://localhost:3000/api/sessions/id/review', { method: 'PATCH', headers: { host, origin, ...additionalHeaders } });
  assert.doesNotThrow(() => assertSameOrigin(request('127.0.0.1:3000', 'http://127.0.0.1:3000')));
  assert.doesNotThrow(() => assertSameOrigin(request('localhost:3000', 'http://localhost:3000')));
  assert.doesNotThrow(() => assertSameOrigin(request('[::1]:3000', 'http://[::1]:3000')));
  for (const rejected of [
    request('127.0.0.1:3000', 'http://localhost:3000'),
    request('127.0.0.1:3000', 'http://127.0.0.1:3001'),
    request('external.example:3000', 'http://external.example:3000'),
    request('127.0.0.1:3000', 'http://127.0.0.1:3000', { 'sec-fetch-site': 'cross-site' }),
    request('localhost:3000', 'http://127.0.0.1:3000', { 'x-forwarded-host': '127.0.0.1:3000' }),
    request('localhost:3000@external.example', 'http://localhost:3000'),
  ]) assert.throws(() => assertSameOrigin(rejected), (error: unknown) => error instanceof ApiError && error.status === 403);
});

test('data-directory initialization failure returns actionable JSON from upload, review and video endpoints', async (context) => {
  const store = temporaryStore();
  const invalidDir = path.join(store.dataDir, 'not-a-directory'); writeFileSync(invalidDir, 'a file blocks the directory');
  const originalDir = process.env.MOTIONTRIAL_DATA_DIR;
  context.mock.method(console, 'error', () => {});
  process.env.MOTIONTRIAL_DATA_DIR = invalidDir;
  try {
    const responses = [
      await uploadSession(upload()),
      await saveReview(reviewRequest({ disposition: 'uncertain', note: '' }), randomUUID()),
      streamVideo(new Request('http://localhost:3000/video'), randomUUID()),
    ];
    for (const response of responses) {
      assert.equal(response.status, 500);
      assert.match((await response.json()).error, /data-directory permissions/);
    }
  } finally {
    if (originalDir === undefined) delete process.env.MOTIONTRIAL_DATA_DIR;
    else process.env.MOTIONTRIAL_DATA_DIR = originalDir;
  }
});

test('queue statistics include all stored sessions beyond the latest 200 returned rows', () => {
  const store = temporaryStore();
  const sessions = Array.from({ length: 201 }, metadata);
  for (const session of sessions) store.save(session, [], VIDEO, 'video/webm');
  store.review(sessions[0].id, { disposition: 'accept', note: 'A completed demo review.' });
  assert.equal(store.list().length, 200);
  assert.deepEqual(store.stats(), { total: 201, pendingReview: 200, withFlags: 201 });
  store.delete(sessions[200].id);
  assert.deepEqual(store.stats(), { total: 200, pendingReview: 199, withFlags: 200 });
});

test('restarting restores a referenced deletion-stage video left before a database deletion committed', () => {
  const store = temporaryStore(); const meta = metadata(); store.save(meta, [], VIDEO, 'video/webm');
  const original = store.video(meta.id).path;
  const dir = store.dataDir; store.close(); stores.splice(stores.indexOf(store), 1);
  renameSync(original, `${original}.deleting`);
  const reopened = new SessionStore(dir); stores.push(reopened);
  assert.equal(reopened.get(meta.id).id, meta.id);
  assert.equal(existsSync(original), true);
  assert.equal(existsSync(`${original}.deleting`), false);
});
