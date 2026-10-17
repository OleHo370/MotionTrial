import test from 'node:test';
import assert from 'node:assert/strict';
import { listPracticeCameras, practiceCameraConstraints, requestPracticeCamera } from '../lib/practice-camera';

function device(kind: MediaDeviceKind, deviceId: string, label: string): MediaDeviceInfo {
  return { kind, deviceId, label, groupId: '', toJSON: () => ({ kind, deviceId, label }) };
}

test('default camera uses soft user-facing constraints, while a selected camera uses only its exact ID', () => {
  const defaults = practiceCameraConstraints();
  assert.equal(defaults.audio, false);
  assert.deepEqual(defaults.video, {
    width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: { ideal: 'user' },
  });
  const selected = practiceCameraConstraints('usb-camera');
  assert.equal(selected.audio, false);
  assert.deepEqual(selected.video, {
    width: { ideal: 1280 }, height: { ideal: 720 }, deviceId: { exact: 'usb-camera' },
  });
});

test('request uses the selected camera once and returns its actual stream', async () => {
  const stream = {} as MediaStream;
  const requests: MediaStreamConstraints[] = [];
  const actual = await requestPracticeCamera('usb-camera', {
    getUserMedia: async (constraints) => { requests.push(constraints!); return stream; },
  });
  assert.equal(actual, stream);
  assert.deepEqual(requests, [practiceCameraConstraints('usb-camera')]);
});

test('an unavailable saved camera never silently opens another camera', async () => {
  for (const name of ['NotFoundError', 'OverconstrainedError']) {
    let requests = 0;
    const cause = Object.assign(new Error('The exact device cannot be opened.'), { name });
    await assert.rejects(requestPracticeCamera('disconnected-camera', {
      getUserMedia: async () => { requests++; throw cause; },
    }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /selected camera.*no longer available/i);
      assert.match(error.message, /choose another camera/i);
      assert.equal(error.cause, cause);
      return true;
    });
    assert.equal(requests, 1);
  }
});

test('permission and busy-camera failures keep browser error identity for specific recovery messages', async () => {
  for (const name of ['NotAllowedError', 'NotReadableError']) {
    const cause = Object.assign(new Error('Camera request failed.'), { name });
    await assert.rejects(requestPracticeCamera('usb-camera', {
      getUserMedia: async () => { throw cause; },
    }), (error: unknown) => error === cause);
  }
});

test('camera picker lists unique usable video inputs, preserves labels, and sorts names naturally', async () => {
  const options = await listPracticeCameras({ enumerateDevices: async () => [
    device('audioinput', 'mic', 'Microphone'),
    device('videoinput', 'camera-10', 'Camera 10'),
    device('videoinput', 'camera-2', 'Camera 2'),
    device('videoinput', 'camera-2', 'Duplicate camera'),
    device('videoinput', '', 'Permission-hidden device'),
    device('audiooutput', 'speaker', 'Speaker'),
    device('videoinput', 'usb', '  USB Camera  '),
  ] });
  assert.deepEqual(options, [
    { deviceId: 'camera-2', label: 'Camera 2' },
    { deviceId: 'camera-10', label: 'Camera 10' },
    { deviceId: 'usb', label: 'USB Camera' },
  ]);
});

test('unlabeled cameras have distinct usable choices until browser permission reveals their names', async () => {
  const options = await listPracticeCameras({ enumerateDevices: async () => [
    device('videoinput', 'one', ''), device('videoinput', 'two', '   '),
  ] });
  assert.deepEqual(options, [
    { deviceId: 'one', label: 'Camera 1' }, { deviceId: 'two', label: 'Camera 2' },
  ]);
});
