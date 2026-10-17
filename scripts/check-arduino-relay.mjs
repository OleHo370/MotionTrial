import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { createArduinoFeedbackRelay, isPrivateArduinoAddress, requestArduino } from './arduino-feedback-relay.mjs';
import { createDualViewServer } from './serve-dual-view.mjs';

// All board replies below are explicitly simulated. No existing LAN hardware is contacted.
const KEY = 'a'.repeat(32), ADDRESS = '192.168.20.22';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = [];
const filter = process.argv.find(argument => argument.startsWith('--match='))?.slice('--match='.length);
function reply(state = 'idle') { return { device: 'motiontrial-uno-r4-wifi', protocol: 1, state }; }
async function fixture(options = {}) {
  const calls = []; let mode = 'normal', active = 0, maxActive = 0, boardState = 'idle';
  const transport = async request => {
    calls.push({ method: request.method, address: request.address, pathname: request.pathname, state: request.state });
    assert.equal(request.key, KEY); assert.equal(request.maxResponseBytes, 2048);
    assert.equal(request.pathname, request.method === 'GET' ? '/motiontrial/status' : '/motiontrial/feedback');
    assert.equal(request.signal.aborted, false);
    active++; maxActive = Math.max(maxActive, active);
    try {
      if (mode === 'hang' || (mode === 'hold-good' && request.state === 'good')) {
        await new Promise((_, reject) => request.signal.addEventListener('abort', () => reject(new Error('Simulated abort.')), { once: true }));
      }
      if (mode === 'fail') throw new Error('Simulated board disconnect.');
      if (mode === 'wrong-device') return { ...reply(), device: 'other-device' };
      if (mode === 'wrong-protocol') return { ...reply(), protocol: 2 };
      if (mode === 'wrong-state') return reply('unknown');
      if (mode === 'wrong-ack' && request.method === 'POST') return reply(request.state === 'idle' ? 'good' : 'idle');
      if (request.method === 'POST') boardState = request.state;
      return reply(boardState);
    } finally { active--; }
  };
  const relay = createArduinoFeedbackRelay({ transport, heartbeatMs: 15, leaseMs: 90, timeoutMs: 35, ...options });
  const server = createDualViewServer({ relay });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port, host = `127.0.0.1:${port}`;
  async function request(pathname, { method = 'GET', body, headers = {}, raw, chunks } = {}) {
    const bytes = raw === undefined ? (body === undefined ? '' : JSON.stringify(body)) : raw;
    return new Promise((resolve, reject) => {
      const finalHeaders = { Host: host, ...(method === 'POST' ? { Origin: `http://${host}`, 'Content-Type': 'application/json' } : {}),
        ...(chunks ? { 'Transfer-Encoding': 'chunked' } : { 'Content-Length': Buffer.byteLength(bytes) }), ...headers };
      for (const name of Object.keys(finalHeaders)) if (finalHeaders[name] === undefined) delete finalHeaders[name];
      const req = http.request({ hostname: '127.0.0.1', port, path: pathname, method, headers: finalHeaders }, res => {
        const parts = []; res.on('data', chunk => parts.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(parts).toString('utf8'); let json;
          try { json = JSON.parse(text); } catch { /* Static response. */ }
          resolve({ code: res.statusCode, headers: res.headers, text, json });
        });
      });
      req.on('error', reject);
      if (chunks) for (const chunk of chunks) req.write(chunk);
      req.end(chunks ? undefined : bytes);
    });
  }
  async function connect(input = { address: ADDRESS, key: KEY }) {
    const result = await request('/api/arduino/connect', { method: 'POST', body: input });
    assert.equal(result.code, 200, result.text); return result.json;
  }
  const signal = (session, sequence, state) => request('/api/arduino/signal', { method: 'POST', body: { sessionId: session, sequence, state } });
  return { relay, server, request, calls, connect, signal, setMode: value => { mode = value; }, get boardState() { return boardState; },
    get maxActive() { return maxActive; }, close: () => server.shutdown() };
}
async function group(name, action) {
  if (filter && !name.includes(filter)) return;
  await action(); report.push(name); console.log(`PASS ${name}`);
}
async function using(action, options) {
  const f = await fixture(options); try { await action(f); } finally { await f.close(); }
}

await group('Only canonical RFC1918 literal IPv4 targets are accepted', async () => {
  for (const valid of ['10.1.2.3', '172.16.1.2', '172.31.254.1', ADDRESS]) assert.equal(isPrivateArduinoAddress(valid), true);
  for (const invalid of ['127.0.0.1', '169.254.169.254', '8.8.8.8', '172.32.1.2', '172.15.1.2', 'localhost',
    'http://192.168.1.2', '192.168.1.2:80', '192.168.01.2', '192.168.1.256', '2130706433', '0x7f000001',
    '192.168.1.0', '192.168.1.255', '::1', '192.168.1.2/path', '192.168.1.2\n']) assert.equal(isPrivateArduinoAddress(invalid), false, invalid);
});
await group('Device HTTP transport pins port 80, authenticates, bounds replies and refuses redirects', async () => {
  function fakeHttp({ status = 200, mime = 'application/json', text = JSON.stringify(reply('good')), interrupted = false } = {}) {
    const captures = [];
    const httpRequest = (options, callback) => {
      const req = new EventEmitter(); req.destroy = () => { req.destroyed = true; };
      req.end = body => {
        captures.push({ options, body });
        queueMicrotask(() => {
          const res = new EventEmitter(); res.statusCode = status; res.headers = { 'content-type': mime }; res.resume = () => {};
          callback(res);
          if (!req.destroyed) {
            res.emit('data', Buffer.from(text));
            if (interrupted) res.emit('aborted'); else res.emit('end');
          }
        });
      };
      return req;
    };
    return { httpRequest, captures };
  }
  const good = fakeHttp();
  const parsed = await requestArduino({ address: ADDRESS, key: KEY, method: 'POST', pathname: '/motiontrial/feedback', state: 'good',
    signal: new AbortController().signal, httpRequest: good.httpRequest });
  assert.equal(parsed.state, 'good');
  const call = good.captures[0];
  assert.equal(call.options.hostname, ADDRESS); assert.equal(call.options.port, 80); assert.equal(call.options.family, 4);
  assert.equal(call.options.agent, false); assert.equal(call.options.headers['X-MotionTrial-Key'], KEY);
  assert.equal(call.options.headers['Content-Type'], 'text/plain'); assert.equal(call.body, 'good\n');
  for (const bad of [{ status: 302 }, { status: 401 }, { mime: 'text/html' }, { text: 'x'.repeat(2049) }, { text: '{' }, { interrupted: true }]) {
    const transport = fakeHttp(bad);
    await assert.rejects(requestArduino({ address: ADDRESS, key: KEY, method: 'GET', pathname: '/motiontrial/status',
      signal: new AbortController().signal, httpRequest: transport.httpRequest }));
    assert.equal(transport.captures.length, 1);
  }
});
await group('API handshake verifies the board and sends idle before creating a session', () => using(async f => {
  const before = await f.request('/api/arduino/status');
  assert.deepEqual([before.code, before.json.supported, before.json.connected, before.json.state], [200, true, false, 'idle']);
  const connected = await f.connect();
  assert.equal(connected.connected, true); assert.match(connected.sessionId, /^[a-f0-9]{48}$/);
  assert.deepEqual(f.calls.slice(0, 2).map(c => [c.method, c.state]), [['GET', undefined], ['POST', 'idle']]);
  assert.equal(connected.state, 'idle'); assert.equal(f.boardState, 'idle');
  assert.equal(JSON.stringify(connected).includes(KEY), false);
  const status = await f.request('/api/arduino/status'); assert.equal('sessionId' in status.json, false);
  assert.equal(status.headers['cache-control'], 'no-store'); assert.equal(status.headers['access-control-allow-origin'], undefined);
}));
await group('Server-side private pairing configuration permits IP-only connection without revealing a key', () => using(async f => {
  const status = await f.request('/api/arduino/status'); assert.equal(status.json.pairingConfigured, true);
  const connection = await f.connect({ address: ADDRESS }); assert.equal(connection.connected, true);
  assert.equal(JSON.stringify(connection).includes(KEY), false);
}, { defaultKey: KEY }));
await group('Bad address or key never reaches any network transport', () => using(async f => {
  for (const body of [{ address: '169.254.169.254', key: KEY }, { address: '192.168.2.1:80', key: KEY },
    { address: ADDRESS, key: 'password' }, { address: ADDRESS, key: 'a'.repeat(65) },
    { address: ADDRESS, key: 'a'.repeat(31) }, { address: ADDRESS }, { address: 'localhost', key: KEY }]) {
    assert.equal((await f.request('/api/arduino/connect', { method: 'POST', body })).code, 400);
  }
  assert.equal(f.calls.length, 0);
  assert.throws(() => createArduinoFeedbackRelay({ defaultKey: 'a'.repeat(65) }), /configuration/);
}));
await group('Same-origin, local Host and JSON are mandatory; wildcard CORS is absent', () => using(async f => {
  const body = { address: ADDRESS, key: KEY };
  for (const headers of [{ Origin: 'https://attacker.invalid' }, { Host: 'attacker.invalid' },
    { Origin: 'null' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'same-site' }]) {
    assert.equal((await f.request('/api/arduino/connect', { method: 'POST', body, headers })).code, 403);
  }
  assert.equal((await f.request('/api/arduino/status', { headers: { Host: '192.168.1.2:8766' } })).code, 403);
  assert.equal((await f.request('/api/arduino/connect', { method: 'POST', body, headers: { 'Content-Type': 'text/plain' } })).code, 415);
  assert.equal((await f.request('/api/arduino/connect', { method: 'POST', body, headers: { Origin: undefined, 'Sec-Fetch-Site': 'same-origin' } })).code, 403);
  assert.equal((await f.request('/api/arduino/connect', { method: 'OPTIONS' })).code, 405);
  assert.equal(f.calls.length, 0);
  const cli = await f.request('/api/arduino/connect', { method: 'POST', body, headers: { Origin: undefined } });
  assert.equal(cli.code, 200);
}));
await group('JSON errors and both declared/chunked body limits are bounded', () => using(async f => {
  for (const raw of ['', '{', 'null', '[]', '"string"']) assert.equal((await f.request('/api/arduino/connect', { method: 'POST', raw })).code, 400);
  assert.equal((await f.request('/api/arduino/connect', { method: 'POST', raw: 'x'.repeat(2049) })).code, 413);
  assert.equal((await f.request('/api/arduino/connect', { method: 'POST', chunks: ['x'.repeat(1025), 'x'.repeat(1025)] })).code, 413);
  assert.equal(f.calls.length, 0);
}));
await group('Identity, protocol, acknowledgement and timeout failures never connect', async () => {
  for (const mode of ['wrong-device', 'wrong-protocol', 'wrong-state', 'wrong-ack', 'fail', 'hang']) await using(async f => {
    f.setMode(mode);
    const result = await f.request('/api/arduino/connect', { method: 'POST', body: { address: ADDRESS, key: KEY } });
    assert.equal(result.code, 502, mode); assert.equal(result.json.connected, false); assert.equal(result.json.state, 'idle');
    assert.equal(JSON.stringify(result.json).includes(KEY), false); assert.equal(f.maxActive, 1);
  });
});
await group('Sequence ordering, stale sessions and invalid states cannot control outputs', () => using(async f => {
  const c = await f.connect();
  assert.equal((await f.signal(c.sessionId, 1, 'good')).code, 200); await sleep(8); assert.equal(f.boardState, 'good');
  for (const seq of [1, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.equal((await f.signal(c.sessionId, seq, 'off')).code, 409);
  assert.equal((await f.signal('wrong-session', 2, 'off')).code, 409);
  assert.equal((await f.signal(c.sessionId, 2, 'unknown')).code, 400);
  assert.equal((await f.signal(c.sessionId, 2, 'off')).code, 200); await sleep(8); assert.equal(f.boardState, 'off');
  assert.equal(f.maxActive, 1);
}));
await group('A fresh browser lease holds good; expiry automatically sends idle', () => using(async f => {
  const c = await f.connect();
  for (let i = 0; i < 3; i++) { await f.signal(c.sessionId, i, 'good'); await sleep(40); assert.equal(f.boardState, 'good'); }
  await sleep(110); const status = await f.request('/api/arduino/status');
  assert.equal(status.json.state, 'idle'); assert.equal(f.boardState, 'idle'); assert.equal(f.maxActive, 1);
}));
await group('Clock reversal or a forward expiry cannot retain a cached warning', async () => {
  let current = 1000;
  await using(async f => {
    const c = await f.connect(); await f.signal(c.sessionId, 0, 'off'); await sleep(5);
    assert.equal(f.boardState, 'off');
    current = 900;
    const reversed = await f.request('/api/arduino/status'); assert.equal(reversed.json.state, 'idle');
    await sleep(25); assert.equal(f.boardState, 'idle');
    await f.signal(c.sessionId, 1, 'off'); await sleep(5); assert.equal(f.boardState, 'off');
    current = 1000;
    const expired = await f.request('/api/arduino/status'); assert.equal(expired.json.state, 'idle');
    await sleep(25); assert.equal(f.boardState, 'idle'); assert.equal(f.maxActive, 1);
  }, { now: () => current });
});
await group('Stopping while good is pending aborts it and never reapplies an old alarm', () => using(async f => {
  const c = await f.connect(); f.setMode('hold-good');
  await f.signal(c.sessionId, 0, 'good'); await sleep(5);
  await f.signal(c.sessionId, 1, 'idle'); await sleep(45);
  assert.equal(f.boardState, 'idle'); assert.equal((await f.request('/api/arduino/status')).json.connected, true);
  assert.equal(f.maxActive, 1); assert.equal(f.calls.at(-1).state, 'idle');
}));
await group('Board loss clears good and demands an explicit reconnection', () => using(async f => {
  const c = await f.connect(); await f.signal(c.sessionId, 0, 'good'); await sleep(5);
  f.setMode('fail'); await sleep(35);
  const status = await f.request('/api/arduino/status'); assert.equal(status.json.connected, false); assert.equal(status.json.state, 'idle');
  assert.equal((await f.signal(c.sessionId, 1, 'good')).code, 409);
  const count = f.calls.length; f.setMode('normal'); await sleep(30); assert.equal(f.calls.length, count);
}));
await group('A second browser connection supersedes the old session and resets outputs', () => using(async f => {
  const first = await f.connect(); await f.signal(first.sessionId, 0, 'off'); await sleep(5);
  const second = await f.connect(); assert.notEqual(second.sessionId, first.sessionId); assert.equal(f.boardState, 'idle');
  assert.equal((await f.signal(first.sessionId, 1, 'off')).code, 409);
  assert.equal((await f.request('/api/arduino/disconnect', { method: 'POST', body: { sessionId: first.sessionId } })).code, 409);
  assert.equal((await f.signal(second.sessionId, 0, 'good')).code, 200); await sleep(5); assert.equal(f.boardState, 'good');
  assert.equal(f.maxActive, 1);
}));
await group('A concurrent connect invalidates a pending earlier handshake', () => using(async f => {
  f.setMode('hang'); const earlier = f.request('/api/arduino/connect', { method: 'POST', body: { address: ADDRESS, key: KEY } });
  await sleep(5); f.setMode('normal'); const latest = await f.connect(); const old = await earlier;
  assert.equal(old.code, 409); assert.equal(latest.connected, true); assert.equal(f.boardState, 'idle'); assert.equal(f.maxActive, 1);
}));
await group('Disconnect and process shutdown send idle and invalidate pending commands', () => using(async f => {
  const c = await f.connect(); await f.signal(c.sessionId, 0, 'off'); await sleep(5);
  const d = await f.request('/api/arduino/disconnect', { method: 'POST', body: { sessionId: c.sessionId } });
  assert.equal(d.code, 200); assert.equal(d.json.connected, false); assert.equal(f.boardState, 'idle');
  assert.equal((await f.signal(c.sessionId, 1, 'good')).code, 409);
  const c2 = await f.connect(); await f.signal(c2.sessionId, 0, 'off'); await sleep(5);
  await f.relay.close(); assert.equal(f.boardState, 'idle'); assert.equal(f.relay.status().connected, false);
}));
await group('Disconnect and shutdown abort pending good requests before sending idle', async () => {
  for (const action of ['disconnect', 'shutdown']) await using(async f => {
    const c = await f.connect(); f.setMode('hold-good'); await f.signal(c.sessionId, 0, 'good'); await sleep(5);
    if (action === 'disconnect') {
      const result = await f.request('/api/arduino/disconnect', { method: 'POST', body: { sessionId: c.sessionId } });
      assert.equal(result.code, 200);
    } else await f.relay.close();
    assert.equal(f.boardState, 'idle'); assert.equal(f.calls.at(-1).state, 'idle');
    assert.equal(f.relay.status().connected, false); assert.equal(f.maxActive, 1);
  });
});
await group('The app server preserves real static files, byte ranges and HEAD', () => using(async f => {
  const source = await readFile(fileURLToPath(new URL('../public/first-three.js', import.meta.url)));
  const whole = await f.request('/first-three.js'); assert.equal(whole.code, 200); assert.equal(whole.text, source.toString('utf8'));
  const range = await f.request('/first-three.js', { headers: { Range: 'bytes=0-15' } });
  assert.equal(range.code, 206); assert.equal(range.text, source.subarray(0, 16).toString('utf8'));
  assert.equal(range.headers['content-range'], `bytes 0-15/${source.length}`);
  const head = await f.request('/first-three.js', { method: 'HEAD' }); assert.equal(head.code, 200); assert.equal(head.text, '');
  assert.equal((await f.request('/first-three.js', { headers: { Range: `bytes=${source.length}-` } })).code, 416);
  assert.equal((await f.request('/api/arduino/unknown', { method: 'POST', body: {} })).code, 404);
}));
console.log(JSON.stringify({ passed: report.length, provenance: 'Simulated board transport; real loopback HTTP API and static server. No LAN device or circuit acceptance claimed.', groups: report }, null, 2));
