import { spawn, execFile } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HELPER = path.join(ROOT, 'scripts/arduino-usb-helper.ps1');
const ARDUINO_CLI = 'C:\\Program Files\\Arduino IDE\\resources\\app\\lib\\backend\\resources\\arduino-cli.exe';
const CONFIG = path.join(ROOT, '.test-data/arduino-cli/config.yaml');
const DEVICE = 'motiontrial-uno-r4-usb';
const STATES = new Set(['idle', 'good', 'off']);
const MAX_BYTES = 2048;
const MAX_WIRE_BYTES = 512;
const MAX_SEQUENCE = 0xffffffff;
const PORT = /^COM(?:[1-9][0-9]{0,2})$/;

class RelayError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function abortError() { const error = new Error('Arduino USB operation canceled.'); error.name = 'AbortError'; return error; }
function timedOut() { const error = new Error('Arduino USB acknowledgement timed out.'); error.code = 'USB_TIMEOUT'; return error; }

export function parseUsbAcknowledgement(line, expected) {
  if (typeof line !== 'string' || Buffer.byteLength(line) > MAX_WIRE_BYTES || /[\r\n]/.test(line)) throw new Error('Invalid USB acknowledgement.');
  let reply;
  try { reply = JSON.parse(line); } catch { throw new Error('Invalid USB acknowledgement.'); }
  if (!reply || Array.isArray(reply) || reply.device !== DEVICE || reply.protocol !== 1 ||
    typeof reply.session !== 'string' || !/^[a-f0-9]{16}$/.test(reply.session) ||
    !Number.isInteger(reply.seq) || reply.seq < 0 || reply.seq > MAX_SEQUENCE || !STATES.has(reply.state) ||
    reply.session !== expected.session || reply.seq !== expected.seq || reply.state !== expected.state) {
    throw new Error('Arduino USB device identity, session, sequence or state is invalid.');
  }
  return reply;
}

export function identifiedArduinoPorts(document) {
  if (!document || !Array.isArray(document.detected_ports)) throw new Error('Arduino USB discovery returned invalid data.');
  return [...new Set(document.detected_ports.filter(entry => entry?.port?.protocol === 'serial' && PORT.test(entry.port.address) &&
    entry.matching_boards?.some(board => board.fqbn === 'arduino:renesas_uno:unor4wifi'))
    .map(entry => entry.port.address))].sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)));
}

// Read-only board discovery: opening arbitrary COM or Bluetooth ports is never
// used to guess the board identity. An explicit port must still appear here.
export async function discoverArduinoUsbPorts({ signal, timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(ARDUINO_CLI, ['--config-file', CONFIG, 'board', 'list', '--format', 'json'],
      { windowsHide: true, signal, timeout: timeoutMs, maxBuffer: 256 * 1024 }, (error, stdout) => {
        if (error) { reject(new Error('Arduino USB discovery failed. Check the Arduino installation and USB cable.')); return; }
        try { resolve(identifiedArduinoPorts(JSON.parse(stdout))); }
        catch { reject(new Error('Arduino USB discovery returned invalid data.')); }
      });
  });
}

// One hidden, persistent Windows helper owns one serial stream. Only the relay
// issues commands; replies remain real board JSON and are validated separately.
export function createWindowsUsbTransport({ port, signal, spawnHelper = spawn }) {
  if (!PORT.test(port || '')) return Promise.reject(new Error('Invalid Arduino COM port.'));
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const child = spawnHelper('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', HELPER, '-Port', port],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let ready = false, closed = false, buffer = '', pending = null, errorListener = null;
    let startupTimer;
    const openingAbort = () => fail(abortError());
    signal?.addEventListener('abort', openingAbort, { once: true });

    function stop() {
      if (closed) return;
      closed = true; clearTimeout(startupTimer); signal?.removeEventListener('abort', openingAbort);
      child.stdin.destroy();
      child.kill();
    }
    function fail(error) {
      if (closed) return;
      const active = pending; pending = null;
      active?.cleanup(); active?.reject(error);
      if (!ready) reject(error); else errorListener?.(error);
      stop();
    }
    function line(text) {
      let item;
      try { item = JSON.parse(text); } catch { fail(new Error('Invalid Arduino USB helper response.')); return; }
      if (item?.type === 'ready' && !ready && item.port === port) {
        ready = true; clearTimeout(startupTimer); signal?.removeEventListener('abort', openingAbort);
        resolve({
          command(wireLine, { signal: commandSignal } = {}) {
            if (closed || !ready || pending) return Promise.reject(new Error('Arduino USB transport is unavailable.'));
            if (commandSignal?.aborted) return Promise.reject(abortError());
            if (typeof wireLine !== 'string' || Buffer.byteLength(wireLine) > MAX_WIRE_BYTES || /[\r\n]/.test(wireLine)) {
              return Promise.reject(new Error('Invalid Arduino USB command.'));
            }
            return new Promise((done, failed) => {
              const aborted = () => {
                if (pending?.reject !== failed) return;
                pending.cleanup(); pending = null; failed(abortError());
              };
              pending = { resolve: done, reject: failed, cleanup: () => commandSignal?.removeEventListener('abort', aborted) };
              commandSignal?.addEventListener('abort', aborted, { once: true });
              child.stdin.write(`${JSON.stringify({ type: 'write', line: wireLine })}\n`, error => { if (error) fail(new Error('Arduino USB write failed.')); });
            });
          },
          onError(listener) { errorListener = listener; },
          async close() { stop(); },
        });
      } else if (item?.type === 'board' && ready && typeof item.line === 'string' && Buffer.byteLength(item.line) <= MAX_WIRE_BYTES) {
        const active = pending;
        if (active) { pending = null; active.cleanup(); active.resolve(item.line); }
        // A late response to an already canceled handshake is never a command.
      } else { fail(new Error('Arduino USB serial connection failed.')); }
    }
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (closed) return;
      for (const character of chunk) {
        if (character === '\n') { const text = buffer.replace(/\r$/, ''); buffer = ''; if (text) line(text); }
        else { buffer += character; if (Buffer.byteLength(buffer) > MAX_WIRE_BYTES + 96) { fail(new Error('Arduino USB response exceeded its bound.')); break; } }
      }
    });
    // Drain, but never echo arbitrary child stderr or wire data into server logs.
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => fail(new Error('Arduino USB input closed.')));
    child.on('error', () => fail(new Error('Could not start the Arduino USB helper.')));
    child.on('exit', () => fail(new Error('Arduino USB disconnected.')));
    startupTimer = setTimeout(() => fail(new Error('Arduino USB port could not be opened. Close Serial Monitor and reconnect.')), 2200);
  });
}

function sameSecret(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Same loopback-host, Origin, Fetch-Site and JSON guards as the retained Wi-Fi relay.
function enforceLocalRequest(req, mutation) {
  const host = req.headers.host || '', localPort = req.socket.localPort;
  if (!new Set([`127.0.0.1:${localPort}`, `localhost:${localPort}`, `[::1]:${localPort}`]).has(host)) throw new RelayError(403, 'Use the local MotionTrial address.');
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== `http://${host}`) throw new RelayError(403, 'Same-origin requests only.');
  if (mutation) {
    const site = req.headers['sec-fetch-site'];
    if (site !== undefined && site !== 'same-origin') throw new RelayError(403, 'Same-origin requests only.');
    if (site !== undefined && origin === undefined) throw new RelayError(403, 'A browser origin is required.');
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || '')) throw new RelayError(415, 'Send application/json.');
  }
}
async function readJson(req) {
  if (Number(req.headers['content-length'] || 0) > MAX_BYTES) { req.resume(); throw new RelayError(413, 'Request is too large.'); }
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

export function createArduinoUsbRelay({
  portProvider = discoverArduinoUsbPorts, transportFactory = createWindowsUsbTransport,
  now = () => performance.now(), heartbeatMs = 125, leaseMs = 450, timeoutMs = 500, connectTimeoutMs = 8000,
} = {}) {
  if (!(heartbeatMs > 0 && heartbeatMs <= 150 && leaseMs > heartbeatMs && leaseMs <= 450 &&
    timeoutMs > 0 && timeoutMs <= 500 && connectTimeoutMs > 0 && connectTimeoutMs <= 8000)) throw new Error('Arduino USB timing exceeds the safety limits.');
  let closed = false, generation = 0, revision = 0, flight = null, attempt = null, activeTarget = null;
  let connected = false, port = null, sessionId = null, browserSequence = -1, desired = 'idle', lastSignalAt = -Infinity;
  let message = 'Arduino USB is not connected.';

  function effectiveState() {
    const age = now() - lastSignalAt;
    return connected && age >= 0 && age <= leaseMs ? desired : 'idle';
  }
  function status() { return { supported: true, transport: 'usb', connected, port, state: effectiveState(), message }; }
  function clearConnection(text) {
    connected = false; sessionId = null; browserSequence = -1; desired = 'idle'; lastSignalAt = -Infinity; revision++; message = text;
  }
  function expireLease() {
    const age = now() - lastSignalAt;
    if (connected && (age < 0 || age > leaseMs) && desired !== 'idle') {
      desired = 'idle'; revision++; message = 'Practice feedback paused; USB outputs are idle.';
      void tick();
    }
  }
  async function send(target, kind, state, tag, signal, deadlineMs = timeoutMs) {
    if (generation !== tag || flight) throw new Error('Arduino USB connection changed.');
    const seq = kind === 'HELLO' ? 0 : ++target.wireSequence;
    if (seq > MAX_SEQUENCE) throw new Error('Arduino USB sequence exhausted; reconnect.');
    const line = kind === 'HELLO' ? `HELLO ${target.wireSession}` : `${kind} ${target.wireSession} ${seq}${kind === 'SET' ? ` ${state}` : ''}`;
    const controller = new AbortController(), onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) controller.abort();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => { reject(timedOut()); controller.abort(); }, Math.max(1, deadlineMs));
    });
    const canceled = new Promise((_, reject) => {
      if (controller.signal.aborted) reject(abortError());
      else controller.signal.addEventListener('abort', () => reject(abortError()), { once: true });
    });
    const work = Promise.resolve().then(() => {
      if (controller.signal.aborted || generation !== tag) throw abortError();
      return target.transport.command(line, { signal: controller.signal });
    });
    const promise = Promise.race([work, deadline, canceled]).then(reply => parseUsbAcknowledgement(reply,
      { session: target.wireSession, seq, state: kind === 'HELLO' ? 'idle' : state })).finally(() => {
      clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
      if (flight?.controller === controller) flight = null;
    });
    flight = { target, promise, controller, state, tag };
    return promise;
  }
  async function retire(target, tag) {
    if (!target || target.retired) return;
    target.retired = true;
    if (flight?.target === target) await flight.promise.catch(() => {});
    if (generation === tag) {
      try { await send(target, 'SET', 'idle', tag); } catch { /* Independent device watchdog is the fallback. */ }
    }
    await target.transport.close().catch(() => {});
  }
  function lose(target, text) {
    if (activeTarget !== target || !connected) return;
    activeTarget = null; clearConnection(text);
    // A broken stream cannot be trusted for another command. Closing it prevents
    // stale queued alarms; the hardware lease independently returns to idle.
    void target.transport.close().catch(() => {});
  }
  async function tick() {
    if (closed || !connected || !activeTarget) return;
    expireLease();
    if (flight) return;
    const target = activeTarget, tag = generation, commandRevision = revision, state = effectiveState();
    try { await send(target, 'SET', state, tag); }
    catch {
      if (tag === generation && activeTarget === target) lose(target, 'Arduino USB connection lost. Outputs silence automatically; reconnect to continue.');
      return;
    }
    // Only the newest desired state is scheduled after an in-flight command.
    // A late old alarm ACK cannot restore state, renew the browser lease, or queue
    // another alarm after tracking becomes unknown or practice stops.
    if (tag === generation && connected && activeTarget === target && commandRevision !== revision) queueMicrotask(tick);
  }
  const heartbeat = setInterval(tick, heartbeatMs);
  heartbeat.unref?.();

  async function listPorts(signal) {
    const ports = await portProvider({ signal, timeoutMs: 5000 });
    if (!Array.isArray(ports) || ports.some(value => typeof value !== 'string' || !PORT.test(value))) throw new Error('Arduino USB discovery returned invalid ports.');
    return [...new Set(ports)];
  }
  async function connect(input, requestSignal) {
    if (closed) throw new RelayError(503, 'Arduino USB relay is stopped.');
    if (input.port !== undefined && (typeof input.port !== 'string' || !PORT.test(input.port))) throw new RelayError(400, 'Choose an identified Arduino COM port.');
    attempt?.controller.abort();
    const controller = new AbortController(), tag = ++generation;
    const old = activeTarget; activeTarget = null;
    clearConnection('Connecting to Arduino USB…');
    const thisAttempt = { controller, tag, target: null };
    attempt = thisAttempt;
    const abortRequest = () => {
      controller.abort();
      if (tag === generation && thisAttempt.target === activeTarget) {
        activeTarget = null; clearConnection('Arduino USB connection canceled.');
        void retire(thisAttempt.target, tag);
      }
    };
    requestSignal?.addEventListener('abort', abortRequest, { once: true });
    if (requestSignal?.aborted) abortRequest();
    const limit = setTimeout(() => controller.abort(), connectTimeoutMs);
    let target = null;
    function check() { if (controller.signal.aborted || generation !== tag || closed) throw abortError(); }
    async function bounded(work) {
      check();
      return new Promise((resolve, reject) => {
        const abort = () => reject(abortError());
        controller.signal.addEventListener('abort', abort, { once: true });
        Promise.resolve(work).then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', abort));
      });
    }
    try {
      await retire(old, tag); check();
      const ports = await bounded(listPorts(controller.signal)); check();
      if (ports.length === 0) throw new RelayError(404, 'No Arduino UNO R4 WiFi USB port was identified. Check the data cable.');
      if (input.port !== undefined && !ports.includes(input.port)) throw new RelayError(400, 'That port is not an identified Arduino UNO R4 WiFi.');
      if (input.port === undefined && ports.length !== 1) throw new RelayError(409, 'More than one Arduino is connected. Choose its COM port.');
      const selectedPort = input.port ?? ports[0]; port = selectedPort;
      const opening = Promise.resolve(transportFactory({ port: selectedPort, signal: controller.signal }));
      opening.then(transport => { if (controller.signal.aborted || tag !== generation || closed) void transport.close().catch(() => {}); }, () => {});
      const transport = await bounded(opening); check();
      if (!transport || typeof transport.command !== 'function' || typeof transport.close !== 'function') throw new Error('Invalid USB transport.');
      target = { transport, port: selectedPort, wireSession: randomBytes(8).toString('hex'), wireSequence: 0, retired: false };
      thisAttempt.target = target; activeTarget = target;
      transport.onError?.(() => lose(target, 'Arduino USB disconnected. Outputs silence automatically; reconnect to continue.'));
      // A native USB board may still be starting after opening the port. Retry
      // only the neutral HELLO, never a movement/warning command.
      while (true) {
        check();
        try { await send(target, 'HELLO', 'idle', tag, controller.signal); break; }
        catch (error) { check(); if (error.code !== 'USB_TIMEOUT') throw error; }
      }
      check(); connected = true; sessionId = randomBytes(24).toString('hex'); browserSequence = -1;
      desired = 'idle'; lastSignalAt = now(); message = 'Arduino USB connected. Feedback starts with your practice movement.';
      return { ...status(), sessionId };
    } catch (error) {
      if (target) {
        if (activeTarget === target) activeTarget = null;
        await target.transport.close().catch(() => {});
      }
      if (tag !== generation || closed) throw new RelayError(409, 'Arduino USB connection was replaced.');
      clearConnection(controller.signal.aborted ? 'Arduino USB connection canceled or timed out.' : 'Could not connect to Arduino USB. Close Serial Monitor and check the USB cable.');
      if (error instanceof RelayError) throw error;
      throw new RelayError(controller.signal.aborted ? 504 : 502, message);
    } finally {
      clearTimeout(limit); requestSignal?.removeEventListener('abort', abortRequest);
      if (attempt === thisAttempt) attempt = null;
    }
  }
  function signal(input) {
    if (closed || !connected || !sameSecret(input.sessionId, sessionId)) throw new RelayError(409, 'Reconnect this page to the Arduino USB device.');
    if (!Number.isSafeInteger(input.sequence) || input.sequence < 0 || input.sequence <= browserSequence) throw new RelayError(409, 'Out-of-order feedback was rejected.');
    if (!STATES.has(input.state)) throw new RelayError(400, 'Invalid feedback state.');
    browserSequence = input.sequence; lastSignalAt = now();
    if (desired !== input.state) { desired = input.state; revision++; }
    message = desired === 'idle' ? 'Connected; USB outputs are idle.' : 'Live USB practice feedback connected.';
    void tick(); return status();
  }
  async function disconnect(input) {
    if (!connected || !sameSecret(input.sessionId, sessionId)) throw new RelayError(409, 'This Arduino USB session is no longer active.');
    const target = activeTarget, tag = ++generation; activeTarget = null;
    clearConnection('Arduino USB disconnected.');
    await retire(target, tag);
    if (tag !== generation) throw new RelayError(409, 'Arduino USB connection was replaced.');
    return status();
  }
  async function close() {
    if (closed) return;
    closed = true; clearInterval(heartbeat); attempt?.controller.abort();
    const target = activeTarget, tag = ++generation; activeTarget = null;
    clearConnection('Arduino USB relay stopped.');
    await retire(target, tag);
  }
  async function handle(req, res) {
    let pathname;
    try { pathname = new URL(req.url, 'http://127.0.0.1').pathname; } catch { return false; }
    if (!pathname.startsWith('/api/arduino/')) return false;
    function json(code, body) {
      if (!res.writableEnded && !res.destroyed) res.writeHead(code, {
        'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      }).end(JSON.stringify(body));
    }
    const requestController = new AbortController();
    const abandoned = () => { if (!res.writableEnded) requestController.abort(); };
    req.once('aborted', abandoned); res.once('close', abandoned);
    try {
      const mutation = req.method === 'POST'; enforceLocalRequest(req, mutation);
      if (req.method === 'GET' && pathname === '/api/arduino/status') { expireLease(); json(200, status()); return true; }
      if (req.method === 'GET' && pathname === '/api/arduino/ports') { json(200, { ...status(), ports: await listPorts(requestController.signal) }); return true; }
      if (!mutation) throw new RelayError(405, 'Method not allowed.');
      if (!['/api/arduino/connect', '/api/arduino/signal', '/api/arduino/disconnect'].includes(pathname)) throw new RelayError(404, 'Arduino endpoint not found.');
      const input = await readJson(req);
      const result = pathname.endsWith('/connect') ? await connect(input, requestController.signal) : pathname.endsWith('/disconnect') ? await disconnect(input) : signal(input);
      // Never publish an orphaned device session if the requesting browser went
      // away during discovery or handshake. Explicitly neutralize and close it.
      if (requestController.signal.aborted || res.destroyed) {
        if (pathname.endsWith('/connect') && result.sessionId && sameSecret(result.sessionId, sessionId)) await disconnect({ sessionId: result.sessionId });
      } else json(200, result);
    } catch (error) {
      json(error instanceof RelayError ? error.status : 500,
        { ...status(), message: error instanceof RelayError ? error.message : 'Arduino USB request could not be completed.' });
    } finally { req.removeListener('aborted', abandoned); res.removeListener('close', abandoned); }
    return true;
  }
  return { handle, status, close };
}
