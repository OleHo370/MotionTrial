import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { ApiError, MAX_REQUEST_BYTES, parseCapture, parseReview } from './validation';
import { getStore, type SessionStore } from './store';

export function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) return json({ error: error.message }, error.status);
  console.error('MotionTrial storage/API failure:', error);
  return json({ error: 'The local server could not complete this operation. Check free disk space, data-directory permissions, and the server log, then retry.' }, 500);
}
export function assertSameOrigin(request: Request): void {
  // Next's internal Request URL can use localhost even when the browser opened
  // 127.0.0.1. The actual HTTP Host identifies this request's browser origin;
  // never substitute forwarded host headers or allow arbitrary local aliases.
  const url = new URL(request.url);
  const host = request.headers.get('host') ?? url.host;
  let expected: URL;
  try { expected = new URL(`${url.protocol}//${host}`); }
  catch { throw new ApiError(403, 'Use MotionTrial from its local server address.'); }
  if (!['http:', 'https:'].includes(url.protocol)
      || !['localhost', '127.0.0.1', '[::1]'].includes(expected.hostname)
      || expected.username || expected.password || expected.pathname !== '/' || expected.search || expected.hash
      || expected.host !== host.toLowerCase()) throw new ApiError(403, 'Use MotionTrial from its local server address.');
  const origin = request.headers.get('origin');
  if (request.headers.get('sec-fetch-site') === 'cross-site' || (origin && origin !== expected.origin)) throw new ApiError(403, 'Cross-origin changes are not allowed. Open MotionTrial from its localhost address.');
}

/** Count streamed bytes before multipart/JSON parsing, including chunked uploads. */
export async function boundedBody(request: Request, maxBytes: number): Promise<Buffer> {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    await request.body?.cancel().catch(() => {});
    throw new ApiError(413, 'Upload exceeds the allowed request size. Video must be at most 25 MB.');
  }
  if (!request.body) throw new ApiError(400, 'A request body is required.');
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ApiError(413, 'Upload exceeds the allowed request size. Video must be at most 25 MB.');
      }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}

export async function uploadSession(request: Request, store?: SessionStore): Promise<Response> {
  try {
    assertSameOrigin(request);
    if (!request.headers.get('content-type')?.startsWith('multipart/form-data;')) throw new ApiError(415, 'Send the recording as multipart form data.');
    const bytes = await boundedBody(request, MAX_REQUEST_BYTES);
    let form: FormData;
    try { form = await new Request(request.url, { method: 'POST', headers: { 'content-type': request.headers.get('content-type')! }, body: new Uint8Array(bytes) }).formData(); }
    catch { throw new ApiError(400, 'The multipart upload could not be read. Please retry the recording.'); }
    if (Array.from(form.keys()).some(key => !['video', 'metadata', 'observations'].includes(key)) || ['video', 'metadata', 'observations'].some(key => form.getAll(key).length !== 1)) throw new ApiError(400, 'Supply exactly one video, metadata and observations field.');
    const video = form.get('video'); const metadata = form.get('metadata'); const observations = form.get('observations');
    if (!(video instanceof File) || typeof metadata !== 'string' || typeof observations !== 'string') throw new ApiError(400, 'Video, metadata and observations are required.');
    const parsed = parseCapture(metadata, observations);
    const result = (store ?? getStore()).save(parsed.metadata, parsed.observations, Buffer.from(await video.arrayBuffer()), video.type);
    return json({ id: result.session.id, session: result.session, duplicate: result.duplicate }, result.duplicate ? 200 : 201);
  } catch (error) { return errorResponse(error); }
}

export async function saveReview(request: Request, id: string, store?: SessionStore): Promise<Response> {
  try {
    assertSameOrigin(request);
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new ApiError(415, 'Send the review as JSON.');
    const bytes = await boundedBody(request, 16 * 1024);
    let value: unknown;
    try { value = JSON.parse(bytes.toString('utf8')); } catch { throw new ApiError(400, 'The review must be valid JSON.'); }
    const review = parseReview(value);
    return json((store ?? getStore()).review(id, review));
  } catch (error) { return errorResponse(error); }
}

export function streamVideo(request: Request, id: string, store?: SessionStore): Response {
  try {
    const video = (store ?? getStore()).video(id);
    const headers: Record<string, string> = { 'Content-Type': video.mimeType, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ETag: video.etag };
    let start = 0; let end = video.size - 1; let status = 200;
    const range = request.headers.get('range');
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      let valid = Boolean(match && (match[1] || match[2]));
      if (match) {
        if (!match[1]) { const suffix = Number(match[2]); valid &&= Number.isSafeInteger(suffix) && suffix > 0; start = Math.max(0, video.size - suffix); }
        else { start = Number(match[1]); end = match[2] ? Number(match[2]) : end; valid &&= Number.isSafeInteger(start) && Number.isSafeInteger(end); }
      }
      if (!valid || start >= video.size || start > end) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${video.size}`, 'Content-Length': '0' } });
      end = Math.min(end, video.size - 1); status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${video.size}`;
    }
    headers['Content-Length'] = String(end - start + 1);
    const body = request.method === 'HEAD' ? null : Readable.toWeb(createReadStream(video.path, { start, end })) as ReadableStream<Uint8Array>;
    return new Response(body, { status, headers });
  } catch (error) { return errorResponse(error); }
}
