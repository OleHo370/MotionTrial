/** Deliberate server-mediated deletion only. No arbitrary filesystem paths. */
async function main() {
  if (!process.argv.includes('--confirm')) {
    throw new Error('Nothing deleted. This removes all local MotionTrial sessions, videos and review history. Run npm run data:reset -- --confirm to proceed.');
  }
  const originIndex = process.argv.indexOf('--origin');
  const url = new URL(originIndex >= 0 ? process.argv[originIndex + 1] : 'http://127.0.0.1:3000');
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/') {
    throw new Error('Use a local HTTP origin, for example --origin http://127.0.0.1:3000.');
  }
  let removed = 0;
  // The queue is bounded. Fetch a fresh batch after deletion until it is empty.
  for (;;) {
    const response = await fetch(`${url.origin}/api/sessions`);
    if (!response.ok) throw new Error(`Cannot list sessions: HTTP ${response.status}. ${removed} deleted so far.`);
    const listing = await response.json();
    const sessions: { id: string }[] = Array.isArray(listing) ? listing : listing.sessions;
    if (!Array.isArray(sessions)) throw new Error('Unexpected session list response.');
    if (sessions.length === 0) break;
    for (const session of sessions) {
      if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(session.id)) throw new Error('Server returned an invalid session ID.');
      const deletion = await fetch(`${url.origin}/api/sessions/${session.id}`, { method: 'DELETE' });
      if (!deletion.ok) throw new Error(`Cannot delete ${session.id}: HTTP ${deletion.status}. ${removed} deleted so far.`);
      removed += 1;
    }
  }
  console.log(`Deleted ${removed} MotionTrial session(s) and their videos/history through the local API.`);
}

main().catch((error) => {
  console.error(`Data reset stopped: ${error.message}`);
  process.exitCode = 1;
});
