import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const folder = path.join(root, 'hardware', 'uno-r4-wifi-feedback');
const sketch = readFileSync(path.join(folder, 'uno-r4-wifi-feedback.ino'), 'utf8').replaceAll('\r\n', '\n');
const out = path.join(root, '.test-data', 'arduino-host');
mkdirSync(out, { recursive: true });
assert.match(sketch, /GREEN_PIN = 5/);
assert.match(sketch, /RED_PIN = 6/);
assert.match(sketch, /BUZZER_PIN = 8/);
assert.doesNotMatch(sketch, /while\s*\(\s*!Serial\s*\)|\bdelay\s*\(|readString|readBytesUntil/);
assert.match(sketch, /forceIdle\(\);[\s\S]*?if\s*\(strlen\(SECRET_PASS\)\s*==\s*0\)\s*WiFi\.begin\(SECRET_SSID\);\s*else\s*WiFi\.begin\(SECRET_SSID, SECRET_PASS\);\s*forceIdle\(\);/);
assert.match(sketch, /tone\(BUZZER_PIN, 2000, 80\)/);
assert.match(sketch, /MotionTrial::REQUEST_MS/);
assert.doesNotMatch(sketch, /Serial\.(print|println)\(\s*(SECRET_PASS|SECRET_SSID|MOTIONTRIAL_SHARED_KEY)/);
assert.match(sketch, /\/\/ #define MOTIONTRIAL_ENABLE_WIFI\s*\n#ifdef MOTIONTRIAL_ENABLE_WIFI/);
const usbBuild = sketch.slice(sketch.indexOf('\n#else\n#include <Arduino.h>'));
assert.doesNotMatch(usbBuild, /WiFiS3\.h|arduino_secrets\.h|WiFi\.(begin|status)|serviceNetwork/);
assert.match(usbBuild, /Serial\.availableForWrite\(\)/);
assert.match(usbBuild, /i < 32/);
assert.match(usbBuild, /count > 16/);
assert.match(usbBuild, /defined\(NO_USB\) && defined\(ARDUINO_UNOR4_WIFI\)/);
assert.match(usbBuild, /count > 8/);
assert.match(usbBuild, /Serial\.flush\(\); \/\/ Wait only for UART TX_COMPLETE/);

for (const {name, sourceName, defines} of [
  {name:'protocol', sourceName:'protocol', defines:[]},
  {name:'sketch-protected', sourceName:'sketch', defines:['MOTIONTRIAL_ENABLE_WIFI']},
  {name:'sketch-open', sourceName:'sketch', defines:['MOTIONTRIAL_ENABLE_WIFI','MOTIONTRIAL_TEST_OPEN_NETWORK']},
  {name:'sketch-usb', sourceName:'usb-sketch', defines:[]},
  {name:'sketch-usb-uno-bridge', sourceName:'usb-sketch', defines:['NO_USB','ARDUINO_UNOR4_WIFI']}
]) {
const source = path.join(folder, 'tests', `${sourceName}.test.cpp`);
const executable = path.join(out, process.platform === 'win32' ? `${name}-test.exe` : `${name}-test`);
let compile;
if (process.platform === 'win32') {
  const configured = process.env.MOTIONTRIAL_VCVARS64;
  const candidates = [configured, 'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\VC\\Auxiliary\\Build\\vcvars64.bat',
    'C:\\Program Files\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Auxiliary\\Build\\vcvars64.bat'];
  const vcvars = candidates.find(candidate => candidate && existsSync(candidate));
  assert.ok(vcvars, 'MSVC is required for exact C++ host tests; set MOTIONTRIAL_VCVARS64 to its vcvars64.bat.');
  const batch = path.join(out, `compile-${name}.cmd`);
  writeFileSync(batch, `@echo off\r\ncall "${vcvars}" >nul\r\nif errorlevel 1 exit /b 1\r\ncl.exe /nologo /EHsc /W4 /std:c++14 ${defines.map(value=>`/D${value}`).join(' ')} /I"${path.join(folder, 'tests')}" "${source}" /Fe:"${executable}" /Fo:"${path.join(out, `${name}-test.obj`)}"\r\n`);
  compile = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', batch], { cwd: out, encoding: 'utf8' });
} else {
  compile = spawnSync(process.env.CXX || 'c++', ['-std=c++11', '-Wall', '-Wextra', '-pedantic', ...defines.map(value=>`-D${value}`), '-I', path.join(folder, 'tests'), source, '-o', executable], { cwd: out, encoding: 'utf8' });
}
process.stdout.write(compile.stdout || ''); process.stderr.write(compile.stderr || '');
assert.equal(compile.status, 0, 'Firmware host test compile failed.');
const run = spawnSync(executable, [], { encoding: 'utf8' });
process.stdout.write(run.stdout || ''); process.stderr.write(run.stderr || '');
assert.equal(run.status, 0, 'Firmware logic test failed.');
}
console.log('PASS: USB default framing/session/ordering/watchdog; preserved open/protected Wi-Fi builds, pins, bounded HTTP, and no credential logging.');
console.log('Host tests use simulated I/O and do not verify electrical behavior, actual USB/Wi-Fi transport, or board upload.');
