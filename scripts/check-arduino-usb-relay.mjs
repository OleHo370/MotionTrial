import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import {
  createArduinoUsbRelay, createWindowsUsbTransport, identifiedArduinoPorts, parseUsbAcknowledgement,
} from './arduino-usb-relay.mjs';

// SIMULATED transport/protocol evidence only. This suite never opens a COM port,
// invokes Arduino CLI, sends a hardware command, or uses LAN/Wi-Fi networking.
const DEVICE = 'motiontrial-uno-r4-usb';
const SESSION = '1'.repeat(16);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = [];
const filter = process.argv.find(argument => argument.startsWith('--match='))?.slice(8);
const acknowledgement = (session = SESSION, seq = 0, state = 'idle') => ({ device: DEVICE, protocol: 1, session, seq, state });

async function waitFor(condition, message = 'Condition did not become true.', timeout = 1500) {
  const until = Date.now() + timeout;
  while (!condition()) { if (Date.now() > until) throw new Error(message); await sleep(3); }
}
async function group(name, action) {
  if (filter && !name.includes(filter)) return;
  await action(); report.push(name); console.log(`PASS ${name}`);
}

async function fixture(options = {}) {
  const calls = [], events = [], transports = [];
  let mode = 'normal', boardState = 'idle', active = 0, maxActive = 0, discoveries = 0, simulatedNow = 1000;
  let pendingOff = null, failureListener = null;
  const factory = async ({ port, signal }) => {
    const local = { port, closed: false, session: null, wireSequence: 0 };
    transports.push(local); events.push(`open:${port}`);
    return {
      async command(line, { signal: commandSignal }) {
        assert.equal(commandSignal.aborted, false);
        active++; maxActive = Math.max(maxActive, active);
        const [kind, session, rawSequence, state] = line.split(' ');
        const seq = kind === 'HELLO' ? 0 : Number(rawSequence);
        calls.push({ line, kind, session, seq, state, port }); events.push(`command:${kind}:${state ?? 'idle'}`);
        try {
          if (mode === 'fail') throw new Error('Simulated USB unplug.');
          if (kind === 'HELLO') { local.session = session; local.wireSequence = 0; boardState = 'idle'; }
          else {
            assert.equal(session, local.session); assert.ok(seq > local.wireSequence);
            local.wireSequence = seq; if (kind === 'SET') boardState = state;
          }
          if (mode === 'hang' || (mode === 'hold-off' && state === 'off') || (mode === 'hello-once' && calls.length === 1)) {
            await new Promise((resolve, reject) => {
              const aborted = () => reject(new Error('Simulated command canceled.'));
              commandSignal.addEventListener('abort', aborted, { once: true });
              if (mode === 'hold-off') pendingOff = () => { commandSignal.removeEventListener('abort', aborted); resolve(); };
            });
          }
          const reply = acknowledgement(session, seq, kind === 'HELLO' ? 'idle' : state);
          if (mode === 'wrong-device') reply.device = 'other-device';
          if (mode === 'wrong-protocol') reply.protocol = 2;
          if (mode === 'wrong-session') reply.session = 'f'.repeat(16);
          if (mode === 'wrong-sequence') reply.seq++;
          if (mode === 'wrong-state') reply.state = reply.state === 'idle' ? 'off' : 'idle';
          if (mode === 'malformed') return '{';
          events.push(`ack:${kind}:${reply.state}`);
          return JSON.stringify(reply);
        } finally { active--; }
      },
      onError(callback) { failureListener = callback; },
      async close() { if (!local.closed) { local.closed = true; events.push(`close:${port}`); } },
    };
  };
  const relay = createArduinoUsbRelay({
    portProvider: async () => { discoveries++; return ['COM16']; }, transportFactory: factory,
    now: () => simulatedNow, heartbeatMs: 15, leaseMs: 90, timeoutMs: 35, connectTimeoutMs: 300,
    ...options,
  });
  const server = http.createServer(async (req, res) => { if (!(await relay.handle(req, res))) res.writeHead(404).end(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const serverPort = server.address().port, host = `127.0.0.1:${serverPort}`;
  function rawRequest(pathname, { method = 'GET', body, raw, headers = {}, chunks, abortSignal } = {}) {
    const bytes = raw === undefined ? (body === undefined ? '' : JSON.stringify(body)) : raw;
    return new Promise((resolve, reject) => {
      const finalHeaders = { Host: host,
        ...(method === 'POST' ? { Origin: `http://${host}`, 'Content-Type': 'application/json' } : {}),
        ...(chunks ? { 'Transfer-Encoding': 'chunked' } : { 'Content-Length': Buffer.byteLength(bytes) }), ...headers };
      for (const key of Object.keys(finalHeaders)) if (finalHeaders[key] === undefined) delete finalHeaders[key];
      const req = http.request({ hostname: '127.0.0.1', port: serverPort, path: pathname, method, headers: finalHeaders, signal: abortSignal }, res => {
        const parts = []; res.on('data', chunk => parts.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(parts).toString('utf8'); let json;
          try { json = JSON.parse(text); } catch { }
          resolve({ code: res.statusCode, headers: res.headers, text, json });
        });
      });
      req.on('error', reject);
      if (chunks) for (const chunk of chunks) req.write(chunk);
      req.end(chunks ? undefined : bytes);
    });
  }
  const request = (pathname, options) => rawRequest(`/api/arduino/${pathname}`, options);
  async function connect(body = {}) {
    const result = await request('connect', { method: 'POST', body });
    assert.equal(result.code, 200, result.text); return result.json;
  }
  return { relay, request, rawRequest, calls, events, transports, connect,
    signal: (sessionId, sequence, state) => request('signal', { method: 'POST', body: { sessionId, sequence, state } }),
    setMode: value => { mode = value; }, advance: delta => { simulatedNow += delta; },
    releaseOff: () => pendingOff?.(), unplug: () => failureListener?.(new Error('Simulated physical unplug.')),
    get boardState() { return boardState; }, get maxActive() { return maxActive; }, get discoveries() { return discoveries; },
    async close() { await relay.close(); await new Promise(resolve => server.close(resolve)); },
  };
}
async function using(action, options) { const f = await fixture(options); try { await action(f); } finally { await f.close(); } }

await group('Discovery accepts only Arduino CLI identified UNO R4 WiFi ports, never Bluetooth guesses', async () => {
  const entry = (address, fqbn = 'arduino:renesas_uno:unor4wifi', protocol = 'serial') => ({ port: { address, protocol }, matching_boards: [{ fqbn }] });
  const ports = identifiedArduinoPorts({ detected_ports: [entry('COM16'), entry('COM16'), entry('COM3'), entry('COM8', 'other:board'),
    { port: { address: 'COM15', protocol: 'serial' } }, entry('COM0'), entry('COM016'), entry('COM1000'), entry('COM2', undefined, 'network')] });
  assert.deepEqual(ports, ['COM3', 'COM16']);
  assert.throws(() => identifiedArduinoPorts({ ports: [] }), /invalid data/);
  assert.throws(() => createArduinoUsbRelay({ heartbeatMs: 151 }), /safety limits/);
  assert.throws(() => createArduinoUsbRelay({ leaseMs: 451 }), /safety limits/);
  assert.throws(() => createArduinoUsbRelay({ timeoutMs: 501 }), /safety limits/);
});

await group('USB ACK parser verifies exact identity, protocol, session, unsigned sequence and applied state', async () => {
  const expected = { session: SESSION, seq: 42, state: 'off' }, good = acknowledgement(SESSION, 42, 'off');
  assert.deepEqual(parseUsbAcknowledgement(JSON.stringify(good), expected), good);
  for (const override of [{ device: 'other' }, { protocol: 2 }, { session: '2'.repeat(16) }, { session: SESSION.toUpperCase() + 'A' },
    { seq: 41 }, { seq: '42' }, { seq: -1 }, { seq: 0x100000000 }, { state: 'good' }, { state: 'unknown' }]) {
    assert.throws(() => parseUsbAcknowledgement(JSON.stringify({ ...good, ...override }), expected));
  }
  for (const raw of ['{', '[]', 'null', JSON.stringify(good) + '\n', 'x'.repeat(513)]) assert.throws(() => parseUsbAcknowledgement(raw, expected));
});

function helperFixture({ startup = true } = {}) {
  let child, spawnOptions, spawnArgs, spawnExecutable;
  const writes = [];
  const spawnHelper = (executable, args, options) => {
    spawnExecutable = executable; spawnArgs = args; spawnOptions = options;
    child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.stdin = new EventEmitter(); child.stdin.destroy = () => {};
    child.stdin.write = (text, callback) => { writes.push(JSON.parse(text)); callback?.(); };
    child.kill = () => { child.killed = true; };
    if (startup) queueMicrotask(() => child.stdout.write(`${JSON.stringify({ type: 'ready', port: 'COM16' })}\n`));
    return child;
  };
  return { spawnHelper, writes, get child() { return child; }, get options() { return spawnOptions; },
    get args() { return spawnArgs; }, get executable() { return spawnExecutable; },
    board: line => child.stdout.write(`${JSON.stringify({ type: 'board', line })}\n`),
  };
}

await group('Windows transport stays hidden, keeps one stream, bounds lines, cancels and never invents ACKs', async () => {
  const f = helperFixture(), transport = await createWindowsUsbTransport({ port: 'COM16', spawnHelper: f.spawnHelper });
  assert.equal(f.executable, 'powershell.exe'); assert.equal(f.options.windowsHide, true);
  assert.deepEqual(f.args.slice(-2), ['-Port', 'COM16']); assert.ok(f.args.includes('-NonInteractive'));
  assert.equal(f.args.some(arg => /EncodedCommand|Command$/.test(arg)), false);
  const command = transport.command(`HELLO ${SESSION}`);
  assert.deepEqual(f.writes, [{ type: 'write', line: `HELLO ${SESSION}` }]);
  await assert.rejects(transport.command(`HELLO ${SESSION}`), /unavailable/);
  f.board(JSON.stringify(acknowledgement())); assert.equal(await command, JSON.stringify(acknowledgement()));
  await assert.rejects(transport.command('SET bad\nline'), /Invalid/);
  const controller = new AbortController();
  const waiting = transport.command(`SET ${SESSION} 1 good`, { signal: controller.signal });
  controller.abort(); await assert.rejects(waiting, /canceled/);
  f.board(JSON.stringify(acknowledgement(SESSION, 1, 'good'))); // ignored late canceled ACK
  const neutral = transport.command(`SET ${SESSION} 2 idle`);
  f.board(JSON.stringify(acknowledgement(SESSION, 2, 'idle'))); await neutral;
  let error = null; transport.onError(value => { error = value; });
  f.child.stdout.write('x'.repeat(609)); assert.ok(error); assert.equal(f.child.killed, true);
  await assert.rejects(transport.command(`HELLO ${SESSION}`), /unavailable/);
  await transport.close();
  let called = false;
  await assert.rejects(createWindowsUsbTransport({ port: 'COM16 & cmd', spawnHelper: () => { called = true; } }), /Invalid/);
  assert.equal(called, false);
  const before = helperFixture({ startup: false }), signal = new AbortController();
  const opening = createWindowsUsbTransport({ port: 'COM16', spawnHelper: before.spawnHelper, signal: signal.signal });
  signal.abort(); await assert.rejects(opening, /canceled/); assert.equal(before.child.killed, true);
});

await group('HTTP connection auto-selects the sole identified board and verifies neutral HELLO before a private client session', () => using(async f => {
  const before = await f.request('status');
  assert.deepEqual([before.code, before.json.transport, before.json.connected, before.json.state], [200, 'usb', false, 'idle']);
  assert.equal(f.discoveries, 0); assert.equal(f.transports.length, 0);
  const ports = await f.request('ports'); assert.deepEqual(ports.json.ports, ['COM16']); assert.equal(f.transports.length, 0);
  const connection = await f.connect();
  assert.equal(connection.port, 'COM16'); assert.equal(connection.transport, 'usb'); assert.equal(connection.connected, true);
  assert.match(connection.sessionId, /^[a-f0-9]{48}$/);
  assert.equal(f.calls[0].kind, 'HELLO'); assert.match(f.calls[0].session, /^[a-f0-9]{16}$/); assert.equal(f.boardState, 'idle');
  assert.notEqual(connection.sessionId, f.calls[0].session);
  const status = await f.request('status'); assert.equal('sessionId' in status.json, false);
  assert.equal(status.headers['cache-control'], 'no-store'); assert.equal(status.headers['access-control-allow-origin'], undefined);
}));

await group('No absent, ambiguous, arbitrary or unrecognized COM device is opened', async () => {
  await using(async f => {
    const result = await f.request('connect', { method: 'POST', body: {} }); assert.equal(result.code, 404); assert.equal(f.transports.length, 0);
  }, { portProvider: async () => [] });
  await using(async f => {
    const result = await f.request('connect', { method: 'POST', body: {} }); assert.equal(result.code, 409); assert.equal(f.transports.length, 0);
    const selected = await f.connect({ port: 'COM16' }); assert.equal(selected.port, 'COM16');
  }, { portProvider: async () => ['COM12', 'COM16'] });
  await using(async f => {
    for (const port of ['COM15', 'COM0', 'COM016', 'COM1000', 'com16', 'COM16\n', '127.0.0.1', null, 16]) {
      const result = await f.request('connect', { method: 'POST', body: { port } }); assert.equal(result.code, 400);
    }
    assert.equal(f.transports.length, 0);
  });
});

await group('Wrong board, protocol, session, sequence, state and malformed handshake each fail closed', async () => {
  for (const mode of ['wrong-device', 'wrong-protocol', 'wrong-session', 'wrong-sequence', 'wrong-state', 'malformed']) {
    await using(async f => {
      f.setMode(mode); const result = await f.request('connect', { method: 'POST', body: {} });
      assert.equal(result.code, 502, mode); assert.equal(result.json.connected, false); assert.equal(result.json.state, 'idle');
      assert.equal(f.transports.every(transport => transport.closed), true);
    });
  }
});

await group('Only neutral startup HELLO may retry, with the same fresh wire session and no alarm', () => using(async f => {
  f.setMode('hello-once'); const result = await f.connect(); assert.equal(result.connected, true);
  const hello = f.calls.filter(call => call.kind === 'HELLO');
  assert.equal(hello.length, 2); assert.equal(f.calls.every(call => call.kind === 'HELLO' || call.state === 'idle'), true);
  assert.equal(hello[0].session, hello[1].session); assert.equal(f.maxActive, 1); f.setMode('normal');
}));

await group('Browser sessions and monotonic sequences are independent from unsigned board sequences', () => using(async f => {
  const connection = await f.connect();
  assert.equal((await f.signal('wrong-session', 0, 'off')).code, 409);
  for (const sequence of [-1, 1.2, '0', Number.MAX_SAFE_INTEGER + 1]) assert.equal((await f.signal(connection.sessionId, sequence, 'good')).code, 409);
  assert.equal((await f.signal(connection.sessionId, 0, 'good')).code, 200);
  await waitFor(() => f.boardState === 'good');
  assert.equal((await f.signal(connection.sessionId, 0, 'off')).code, 409);
  assert.equal((await f.signal(connection.sessionId, 1, 'unknown')).code, 400);
  assert.equal((await f.signal(connection.sessionId, 1, 'off')).code, 200);
  await waitFor(() => f.boardState === 'off');
  assert.equal((await f.signal(connection.sessionId, Number.MAX_SAFE_INTEGER, 'idle')).code, 200);
  await waitFor(() => f.boardState === 'idle');
  const sequences = f.calls.filter(call => call.kind === 'SET').map(call => call.seq);
  assert.ok(sequences.every((seq, index) => seq > 0 && seq < 100 && (!index || seq > sequences[index - 1])));
  assert.equal(f.maxActive, 1);
}));

await group('Fresh device heartbeats do not renew the browser lease; expiry and clock rewind send idle', () => using(async f => {
  const connection = await f.connect(); await f.signal(connection.sessionId, 0, 'off');
  await waitFor(() => f.calls.filter(call => call.kind === 'SET').length >= 3);
  assert.equal(f.boardState, 'off');
  f.advance(91); const expired = await f.request('status'); assert.equal(expired.json.state, 'idle');
  await waitFor(() => f.boardState === 'idle'); assert.equal(expired.json.connected, true);
  await f.signal(connection.sessionId, 1, 'good'); await waitFor(() => f.boardState === 'good');
  f.advance(-1); const reversed = await f.request('status'); assert.equal(reversed.json.state, 'idle');
  await waitFor(() => f.boardState === 'idle');
}));

await group('Neutral cancels queued warnings without concurrent commands or stale ACK state restoration', () => using(async f => {
  const connection = await f.connect(); f.setMode('hold-off');
  await f.signal(connection.sessionId, 0, 'off'); await waitFor(() => f.calls.some(call => call.state === 'off'));
  await f.signal(connection.sessionId, 1, 'idle');
  assert.equal(f.relay.status().state, 'idle'); f.releaseOff(); f.setMode('normal');
  await waitFor(() => f.boardState === 'idle');
  const idleIndex = f.calls.findIndex(call => call.kind === 'SET' && call.state === 'idle');
  assert.ok(idleIndex > 0); await sleep(45);
  assert.equal(f.calls.slice(idleIndex).every(call => call.state === 'idle'), true); assert.equal(f.maxActive, 1);
}));

await group('USB unplug, bad runtime ACK and command timeout clear connection and close the helper', async () => {
  for (const mode of ['unplug', 'wrong-sequence', 'wrong-state', 'hang']) {
    await using(async f => {
      const connection = await f.connect();
      if (mode === 'unplug') f.unplug(); else { f.setMode(mode); await f.signal(connection.sessionId, 0, 'off'); }
      await waitFor(() => !f.relay.status().connected);
      assert.equal(f.relay.status().state, 'idle'); assert.equal(f.transports.every(transport => transport.closed), true);
      assert.equal((await f.signal(connection.sessionId, 1, 'good')).code, 409);
    });
  }
});

await group('Disconnect and server close verify idle before releasing the serial port', async () => {
  await using(async f => {
    const connection = await f.connect(); await f.signal(connection.sessionId, 0, 'off'); await waitFor(() => f.boardState === 'off');
    const result = await f.request('disconnect', { method: 'POST', body: { sessionId: connection.sessionId } });
    assert.equal(result.code, 200); assert.equal(result.json.connected, false); assert.equal(f.boardState, 'idle');
    assert.deepEqual(f.events.slice(-3), ['command:SET:idle', 'ack:SET:idle', 'close:COM16']);
    assert.equal((await f.request('disconnect', { method: 'POST', body: { sessionId: connection.sessionId } })).code, 409);
    const replacement = await f.connect(); assert.notEqual(replacement.sessionId, connection.sessionId);
    assert.notEqual(f.calls.filter(call => call.kind === 'HELLO')[0].session, f.calls.filter(call => call.kind === 'HELLO')[1].session);
    assert.equal((await f.signal(connection.sessionId, 1, 'off')).code, 409);
    await f.signal(replacement.sessionId, 0, 'good'); await waitFor(() => f.boardState === 'good');
    await f.relay.close(); assert.equal(f.boardState, 'idle'); assert.equal(f.relay.status().connected, false);
    assert.deepEqual(f.events.slice(-3), ['command:SET:idle', 'ack:SET:idle', 'close:COM16']);
    assert.equal((await f.request('connect', { method: 'POST', body: {} })).code, 503);
  });
});

await group('Abandoned browser connect during discovery never opens or publishes an orphan device session', async () => {
  let releaseDiscovery;
  await using(async f => {
    const abort = new AbortController();
    const connection = f.request('connect', { method: 'POST', body: {}, abortSignal: abort.signal }).catch(error => error);
    await waitFor(() => Boolean(releaseDiscovery)); abort.abort(); await connection;
    await waitFor(() => /canceled/.test(f.relay.status().message)); releaseDiscovery(['COM16']);
    await sleep(35); assert.equal(f.transports.length, 0); assert.equal(f.relay.status().connected, false); assert.equal(f.relay.status().state, 'idle');
  }, { portProvider: () => new Promise(resolve => { releaseDiscovery = resolve; }) });
});

await group('Abandoned browser connect during port open or HELLO closes even a late helper', async () => {
  let releaseOpening, closeCount = 0;
  await using(async f => {
    const abort = new AbortController();
    const connection = f.request('connect', { method: 'POST', body: {}, abortSignal: abort.signal }).catch(error => error);
    await waitFor(() => Boolean(releaseOpening)); abort.abort(); await connection;
    await waitFor(() => /canceled/.test(f.relay.status().message));
    releaseOpening({ async command() { throw new Error('Must never send a command after cancellation.'); }, async close() { closeCount++; } });
    await waitFor(() => closeCount > 0); assert.equal(f.relay.status().connected, false);
  }, { transportFactory: () => new Promise(resolve => { releaseOpening = resolve; }) });
  await using(async f => {
    f.setMode('hang'); const abort = new AbortController();
    const connection = f.request('connect', { method: 'POST', body: {}, abortSignal: abort.signal }).catch(error => error);
    await waitFor(() => f.calls.length > 0); abort.abort(); await connection;
    await waitFor(() => f.transports.every(transport => transport.closed)); assert.equal(f.relay.status().connected, false);
  });
});

await group('Connect deadline is bounded and replacement rejects late previous sessions', async () => {
  await using(async f => {
    const result = await f.request('connect', { method: 'POST', body: {} });
    assert.equal(result.code, 504); assert.equal(f.transports.length, 0); assert.equal(f.relay.status().connected, false);
  }, { portProvider: () => new Promise(() => {}), connectTimeoutMs: 60 });
  let releaseFirst, discoveries = 0;
  await using(async f => {
    const first = f.request('connect', { method: 'POST', body: {} });
    await waitFor(() => Boolean(releaseFirst));
    const second = await f.connect(); releaseFirst(['COM16']);
    const replaced = await first; assert.equal(replaced.code, 409);
    assert.equal(f.relay.status().connected, true); assert.equal(f.transports.length, 1);
    assert.equal((await f.signal(second.sessionId, 0, 'good')).code, 200);
  }, { portProvider: () => ++discoveries === 1 ? new Promise(resolve => { releaseFirst = resolve; }) : Promise.resolve(['COM16']) });
});

await group('HTTP local-host, same-origin, JSON-only, session and body bounds preserve the Wi-Fi relay guards', () => using(async f => {
  for (const headers of [{ Host: '192.168.1.2:8766' }, { Origin: 'http://evil.example' }, { 'Sec-Fetch-Site': 'cross-site' },
    { Origin: undefined, 'Sec-Fetch-Site': 'same-origin' }]) {
    assert.equal((await f.request('connect', { method: 'POST', body: {}, headers })).code, 403);
  }
  assert.equal((await f.request('connect', { method: 'POST', body: {}, headers: { 'Content-Type': 'text/plain' } })).code, 415);
  for (const raw of ['', '{', 'null', '[]', '"string"']) assert.equal((await f.request('connect', { method: 'POST', raw })).code, 400);
  assert.equal((await f.request('connect', { method: 'POST', raw: 'x'.repeat(2049) })).code, 413);
  assert.equal((await f.request('connect', { method: 'POST', chunks: ['x'.repeat(1025), 'x'.repeat(1025)] })).code, 413);
  assert.equal((await f.request('connect', { method: 'OPTIONS' })).code, 405);
  assert.equal((await f.request('unknown', { method: 'POST', body: {} })).code, 404);
  assert.equal((await f.rawRequest('/other')).code, 404);
  assert.equal(f.transports.length, 0);
  const localCli = await f.request('connect', { method: 'POST', body: {}, headers: { Origin: undefined } }); assert.equal(localCli.code, 200);
}));

await group('Helper source keeps bounded parent input, partial serial framing and watchdog fallback without Wi-Fi APIs', async () => {
  const source = await readFile(new URL('./arduino-usb-helper.ps1', import.meta.url), 'utf8');
  assert.match(source, /buffer\.Length >= 512/); assert.match(source, /Lines\.Count >= 8/);
  assert.match(source, /reader\.Ended/); assert.match(source, /serialBuffer\.Length -ge 512/);
  assert.match(source, /serial\.Write\("`n"\)/); assert.match(source, /serial\.Write\(\$line \+ "`n"\)/);
  assert.match(source, /900 ms/); assert.match(source, /ReadExisting\(\)/);
  assert.doesNotMatch(source, /ReadLineAsync\s*\(|WiFi\.begin|HttpClient|Invoke-WebRequest/);
});

const summary = { provenance: 'Simulated USB transport, genuine HTTP API and production protocol parser; no physical Arduino commands or LAN access.',
  groupsPassed: report.length, groups: report };
if (!filter) {
  const output = new URL('../artifacts/arduino-usb-review/relay-checks.json', import.meta.url);
  await mkdir(new URL('.', output), { recursive: true }); await writeFile(output, JSON.stringify(summary, null, 2) + '\n');
}
console.log(JSON.stringify(summary));
