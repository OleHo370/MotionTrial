export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Fixed local files only: this endpoint cannot proxy arbitrary URLs or invoke
// the practice server's camera, USB, upload or Factory endpoints.
const resources = [
  '/first-three.html',
  '/practice-media/recut-six/manifest.json',
  '/practice-media/recut-six/teacher-display-guides.json',
  '/practice-media/recut-six/master.poses.json',
  '/practice-media/recut-six/master.mp4',
];

export async function GET(request: Request) {
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5_000)]);
  try {
    const responses = await Promise.all(resources.map(resource => fetch(`http://127.0.0.1:8766${resource}`, {
      method: 'HEAD', cache: 'no-store', redirect: 'error', signal,
    })));
    if (responses.some(response => !response.ok)) throw new Error('Practice unavailable');
    return Response.json({ ready: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ ready: false }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
