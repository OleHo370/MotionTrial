import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const STATES = new Set(['idle', 'good', 'off']);
const DEVICE = 'motiontrial-uno-r4-wifi';
const MAX_BYTES = 2048;

class RelayError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function isPrivateArduinoAddress(address) {
  if (typeof address !== 'string' || !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(address)) return false;
  const octets = address.split('.');
  if (octets.some(part => Number(part) > 255 || String(Number(part)) !== part)) return false;
  const [a, b, , d] = octets.map(Number);
  return d !== 0 && d !== 255 && (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168));
}

function validReply(reply) {
  return reply && reply.device === DEVICE && reply.protocol === 1 && STATES.has(reply.state);
}

// The target is a validated literal LAN IPv4 address: no DNS, redirects, proxy or arbitrary port.
export function requestArduino({ address, key, method, pathname, state, signal, maxResponseBytes = MAX_BYTES, httpRequest = http.request }) {
  return new Promise((resolve, reject) => {
    const body = method === 'POST' ? `${state}\n` : '';
    const request = httpRequest({
      hostname: address, family: 4, port: 80, method, path: pathname, agent: false, signal,
      headers: {
        'X-MotionTrial-Key': key, Accept: 'application/json', Connection: 'close',
        ...(method === 'POST' ? { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(body) } : {}),
      },
    }, response => {
      if (response.statusCode !== 200 || !/^application\/json(?:\s*;|$)/i.test(response.headers['content-type'] || '')) {
        response.resume(); reject(new Error('Device rejected the request.')); request.destroy(); return;
      }
      const chunks = []; let length = 0;
      response.on('data', chunk => {
        length += chunk.length;
        if (length > maxResponseBytes) { reject(new Error('Device response is too large.')); request.destroy(); return; }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('aborted', () => reject(new Error('Device response interrupted.')));
      response.on('end', () => {
        if (length > maxResponseBytes) return;
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new Error('Device response is invalid.')); }
      });
    });
    request.on('error', reject);
    request.end(body);
  });
}

function sameSecret(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function enforceLocalRequest(req, mutation) {
  const host = req.headers.host || '';
  const localPort = req.socket.localPort;
  if (!new Set([`127.0.0.1:${localPort}`, `localhost:${localPort}`, `[::1]:${localPort}`]).has(host)) {
    throw new RelayError(403, 'Use the local MotionTrial address.');
  }
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== `http://${host}`) throw new RelayError(403, 'Same-origin requests only.');
  if (mutation) {
    const site = req.headers['sec-fetch-site'];
    if (site !== undefined && site !== 'same-origin') throw new RelayError(403, 'Same-origin requests only.');
    // No-Origin is supported for local command-line setup; browser requests must carry their origin.
    if (site !== undefined && origin === undefined) throw new RelayError(403, 'A browser origin is required.');
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || '')) {
      throw new RelayError(415, 'Send application/json.');
    }
  }
}

async function readJson(req) {
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > MAX_BYTES) { req.resume(); throw new RelayError(413, 'Request is too large.'); }
  const body = await new Promise((resolve, reject) => {
    const chunks = []; let size = 0, failed = false;
    req.on('data', chunk => {
      if (failed) return;
      size += chunk.length;
      if (size > MAX_BYTES) { failed = true; chunks.length = 0; reject(new RelayError(413, 'Request is too large.')); }
      else chunks.push(chunk);
    });
    req.on('end', () => { if (!failed) resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('aborted', () => reject(new RelayError(400, 'Request was interrupted.')));
    req.on('error', reject);
  });
  try {
    const parsed = JSON.parse(body);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error();
    return parsed;
  } catch { throw new RelayError(400, 'Invalid JSON object.'); }
}

export function createArduinoFeedbackRelay({
  transport = requestArduino, now = () => performance.now(), heartbeatMs = 150, leaseMs = 450, timeoutMs = 350,
  defaultKey = null,
} = {}) {
  if (!(heartbeatMs > 0 && heartbeatMs <= 150 && leaseMs > heartbeatMs && leaseMs <= 450 && timeoutMs > 0 && timeoutMs <= 350)) {
    throw new Error('Arduino relay timing exceeds the safety limits.');
  }
  if (defaultKey !== null && (typeof defaultKey !== 'string' || !/^[a-fA-F0-9]{32,64}$/.test(defaultKey))) {
    throw new Error('Arduino pairing configuration is invalid.');
  }
  let generation = 0, revision = 0, closed = false, flight = null;
  let address = null, key = null, connected = false, sessionId = null, sequence = -1;
  let desired = 'idle', lastSignalAt = -Infinity, message = 'Arduino is not connected.';

  function effectiveState() {
    const age = now() - lastSignalAt;
    return connected && age >= 0 && age <= leaseMs ? desired : 'idle';
  }
  function status() {
    return { supported: true, connected, address, state: effectiveState(), message, pairingConfigured: defaultKey !== null };
  }
  function expireLease() {
    const age = now() - lastSignalAt;
    if (connected && (age < 0 || age > leaseMs) && desired !== 'idle') {
      desired = 'idle'; revision++;
      message = 'Practice feedback paused; outputs are idle.';
      if (flight?.state !== 'idle') flight?.controller.abort();
    }
  }

  async function network(target, requestMethod, state, expectedGeneration) {
    if (closed && requestMethod !== 'POST') throw new Error('Relay closed.');
    if (generation !== expectedGeneration || flight) throw new Error('Connection changed.');
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('Device request timed out.')); }, timeoutMs);
    });
    const work = Promise.resolve().then(() => {
      if (generation !== expectedGeneration || controller.signal.aborted) throw new Error('Connection changed.');
      return transport({ address: target.address, key: target.key, method: requestMethod,
        pathname: requestMethod === 'GET' ? '/motiontrial/status' : '/motiontrial/feedback',
        state, signal: controller.signal, timeoutMs, maxResponseBytes: MAX_BYTES });
    });
    const promise = Promise.race([work, deadline]).then(reply => {
      if (!validReply(reply) || (requestMethod === 'POST' && reply.state !== state)) throw new Error('Device identity or state is invalid.');
      return reply;
    }).finally(() => {
      clearTimeout(timer);
      if (flight?.controller === controller) flight = null;
    });
    flight = { promise, controller, state, generation: expectedGeneration };
    return promise;
  }

  async function drain() {
    const previous = flight;
    previous?.controller.abort();
    if (previous) await previous.promise.catch(() => {});
  }

  function disconnectState(text) {
    connected = false; sessionId = null; sequence = -1; desired = 'idle'; lastSignalAt = -Infinity; revision++;
    message = text;
  }

  async function tick() {
    if (closed || !connected) return;
    expireLease();
    if (flight) return;
    const tag = generation, commandRevision = revision, state = effectiveState();
    const target = { address, key };
    try {
      await network(target, 'POST', state, tag);
      // A late acknowledgement must not restore an older state, browser lease or session.
      if (generation !== tag || commandRevision !== revision || !connected) return;
    } catch {
      if (generation !== tag || !connected) return;
      // An intentional change to idle aborts old feedback; immediately send only the new command.
      if (commandRevision !== revision) { queueMicrotask(tick); return; }
      disconnectState('Arduino connection lost. Outputs fall idle automatically; reconnect to continue.');
      key = null;
    }
  }
  const timer = setInterval(tick, heartbeatMs);
  timer.unref?.();

  async function connect(input) {
    if (closed) throw new RelayError(503, 'Arduino relay is stopped.');
    if (!isPrivateArduinoAddress(input.address)) throw new RelayError(400, 'Enter a private LAN IPv4 address, without a URL or port.');
    const suppliedKey = input.key === undefined || input.key === '' ? defaultKey : input.key;
    if (typeof suppliedKey !== 'string' || !/^[a-fA-F0-9]{32,64}$/.test(suppliedKey)) throw new RelayError(400, 'Enter the 32–64 character hexadecimal device key.');
    const previous = connected && key ? { address, key } : null;
    const tag = ++generation;
    disconnectState('Connecting to Arduino…'); address = input.address; key = null;
    await drain();
    if (tag !== generation || closed) throw new RelayError(409, 'Connection was replaced.');
    if (previous) {
      try { await network(previous, 'POST', 'idle', tag); } catch { /* The device watchdog remains the fallback. */ }
    }
    if (tag !== generation || closed) throw new RelayError(409, 'Connection was replaced.');
    const target = { address: input.address, key: suppliedKey };
    try {
      await network(target, 'GET', undefined, tag);
      if (tag !== generation || closed) throw new Error('Connection changed.');
      await network(target, 'POST', 'idle', tag);
      if (tag !== generation || closed) throw new Error('Connection changed.');
      key = suppliedKey; connected = true; sessionId = randomBytes(24).toString('hex');
      sequence = -1; lastSignalAt = now(); desired = 'idle';
      message = 'Arduino connected. Feedback starts with your practice movement.';
      return { ...status(), sessionId };
    } catch {
      if (tag !== generation || closed) throw new RelayError(409, 'Connection was replaced.');
      disconnectState('Could not connect. Check device Wi-Fi, IP address and key.'); key = null;
      throw new RelayError(502, message);
    }
  }

  function signal(input) {
    if (closed || !connected || !sameSecret(input.sessionId, sessionId)) throw new RelayError(409, 'Reconnect this page to the Arduino.');
    if (!Number.isSafeInteger(input.sequence) || input.sequence < 0 || input.sequence <= sequence) throw new RelayError(409, 'Out-of-order feedback was rejected.');
    if (!STATES.has(input.state)) throw new RelayError(400, 'Invalid feedback state.');
    sequence = input.sequence; lastSignalAt = now();
    if (desired !== input.state) {
      desired = input.state; revision++;
      // End a pending alarm promptly when practice stops or tracking becomes unknown.
      if (desired === 'idle' && flight?.state !== 'idle') flight?.controller.abort();
    }
    message = desired === 'idle' ? 'Connected; outputs are idle.' : 'Live practice feedback connected.';
    void tick();
    return status();
  }

  async function disconnect(input) {
    if (!connected || !sameSecret(input.sessionId, sessionId)) throw new RelayError(409, 'This Arduino session is no longer active.');
    const target = { address, key }, tag = ++generation;
    disconnectState('Arduino disconnected.'); key = null;
    await drain();
    if (tag === generation && !closed) {
      try { await network(target, 'POST', 'idle', tag); } catch { /* Hardware watchdog silences a lost device. */ }
    }
    if (tag !== generation) throw new RelayError(409, 'Connection was replaced.');
    return status();
  }

  async function close() {
    if (closed) return;
    const target = connected && key ? { address, key } : null, tag = ++generation;
    closed = true; clearInterval(timer); disconnectState('Arduino relay stopped.'); key = null;
    await drain();
    if (target) { try { await network(target, 'POST', 'idle', tag); } catch { /* Hardware watchdog is independent of this process. */ } }
  }

  async function handle(req, res) {
    let pathname;
    try { pathname = new URL(req.url, 'http://127.0.0.1').pathname; } catch { return false; }
    if (!pathname.startsWith('/api/arduino/')) return false;
    function json(code, body) {
      if (!res.writableEnded && !res.destroyed) res.writeHead(code, {
        'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      }).end(JSON.stringify(body));
    }
    try {
      const mutation = req.method === 'POST';
      enforceLocalRequest(req, mutation);
      if (req.method === 'GET' && pathname === '/api/arduino/status') { expireLease(); json(200, status()); return true; }
      if (!mutation) throw new RelayError(405, 'Method not allowed.');
      if (!['/api/arduino/connect', '/api/arduino/signal', '/api/arduino/disconnect'].includes(pathname)) throw new RelayError(404, 'Arduino endpoint not found.');
      const input = await readJson(req);
      const result = pathname.endsWith('/connect') ? await connect(input) : pathname.endsWith('/disconnect') ? await disconnect(input) : signal(input);
      json(200, result);
    } catch (error) {
      json(error instanceof RelayError ? error.status : 500,
        { ...status(), message: error instanceof RelayError ? error.message : 'Arduino request could not be completed.' });
    }
    return true;
  }
  return { handle, status, close };
}
