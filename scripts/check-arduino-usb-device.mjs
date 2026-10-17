// Explicit real-device diagnostic. This is never a learner assessment.
// Run only after confirming 1 kohm LED resistors and a <=8 mA piezo/driver.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as wait } from 'node:timers/promises';
import { discoverArduinoUsbPorts, createWindowsUsbTransport, parseUsbAcknowledgement } from './arduino-usb-relay.mjs';

if (!process.argv.includes('--confirmed-safe-circuit')) {
  throw new Error('This diagnostic activates the LEDs and buzzer. Confirm the circuit, then use --confirmed-safe-circuit.');
}
const ports = await discoverArduinoUsbPorts();
assert.equal(ports.length, 1, 'Connect exactly one identified UNO R4 WiFi.');
const transport = await createWindowsUsbTransport({ port: ports[0] });
const session = randomBytes(8).toString('hex');
let sequence = 0, handshaken = false;
const observations = [];
async function command(kind, expectedState) {
  const seq = kind === 'HELLO' ? 0 : ++sequence;
  const line = kind === 'HELLO' ? `HELLO ${session}` : `${kind} ${session} ${seq}${kind === 'SET' ? ` ${expectedState}` : ''}`;
  const raw = await transport.command(line, { signal: AbortSignal.timeout(500) });
  const reply = parseUsbAcknowledgement(raw, { session, seq, state: expectedState });
  observations.push({ kind, sequence: seq, state: reply.state, device: reply.device, protocol: reply.protocol });
  return reply;
}
async function sustain(state, durationMs) {
  const end = performance.now() + durationMs;
  do { await command('SET', state); await wait(100); } while (performance.now() < end);
}
try {
  const deadline = performance.now() + 6000;
  while (!handshaken) {
    try { await command('HELLO', 'idle'); handshaken = true; }
    catch (error) { if (performance.now() >= deadline) throw error; }
  }
  console.log(`Real USB diagnostic on ${ports[0]}: green, then red/beeps, then idle.`);
  await sustain('good', 900);
  await command('SET', 'idle');
  await wait(250);
  await sustain('off', 1000);
  await command('SET', 'idle');
  await command('SET', 'good');
  await wait(1200); // No host heartbeats: independent firmware lease must expire.
  await command('STATUS', 'idle');
  await command('SET', 'idle');
  const report = {
    provenance: 'Actual USB hardware command/ACK diagnostic; no camera, poses, learner matching or physical optical/audio measurement.',
    circuit: 'User confirmed 1 kohm LED resistors and suitable <=8 mA passive buzzer/driver before activation.',
    port: ports[0], wifiUsed: false, result: 'PASS',
    checked: ['USB device/session/state acknowledgements', 'good command', 'off command', 'explicit idle', '900 ms firmware lease expired after 1200 ms without commands'],
    observations,
    limitation: 'Board ACKs verify firmware state. User must confirm the actual LED colors and audible beep, and real movement feedback.',
  };
  await mkdir('artifacts/arduino-usb-review', { recursive: true });
  await writeFile('artifacts/arduino-usb-review/device-qa.json', JSON.stringify(report, null, 2) + '\n');
  console.log(`PASS: ${observations.length} real board acknowledgements, including independent watchdog returning idle.`);
} finally {
  if (handshaken) await command('SET', 'idle').catch(() => {});
  await transport.close();
}
