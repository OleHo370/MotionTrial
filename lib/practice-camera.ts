export interface PracticeCameraOption {
  deviceId: string;
  label: string;
}

type CameraRequester = Pick<MediaDevices, 'getUserMedia'>;
type CameraEnumerator = Pick<MediaDevices, 'enumerateDevices'>;

function browserMediaDevices(): MediaDevices | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
}

/** An explicit selection must never silently fall back to a different camera. */
export function practiceCameraConstraints(deviceId = ''): MediaStreamConstraints {
  return {
    audio: false,
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'user' } }),
    },
  };
}

export async function requestPracticeCamera(
  deviceId = '',
  mediaDevices: CameraRequester | undefined = browserMediaDevices(),
): Promise<MediaStream> {
  if (!mediaDevices?.getUserMedia) {
    throw new Error('The camera API is unavailable. Use http://127.0.0.1:3000 in desktop Chrome on this computer.');
  }
  try {
    return await mediaDevices.getUserMedia(practiceCameraConstraints(deviceId));
  } catch (cause) {
    const name = cause && typeof cause === 'object' && 'name' in cause ? cause.name : '';
    if (deviceId && ['NotFoundError', 'OverconstrainedError', 'ConstraintNotSatisfiedError'].includes(String(name))) {
      throw new Error('The selected camera is no longer available. Choose another camera in Camera settings, then start it again.', { cause });
    }
    // Keep permission and busy-device error names for the caller's recovery UI.
    throw cause;
  }
}

/** Browser labels become available after permission; refresh the list then. */
export async function listPracticeCameras(
  mediaDevices: CameraEnumerator | undefined = browserMediaDevices(),
): Promise<PracticeCameraOption[]> {
  if (!mediaDevices?.enumerateDevices) return [];
  const devices = await mediaDevices.enumerateDevices();
  const seen = new Set<string>();
  const cameras: PracticeCameraOption[] = [];
  for (const device of devices) {
    if (device.kind !== 'videoinput' || !device.deviceId || seen.has(device.deviceId)) continue;
    seen.add(device.deviceId);
    cameras.push({ deviceId: device.deviceId, label: device.label.trim() || `Camera ${cameras.length + 1}` });
  }
  return cameras.sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true, sensitivity: 'base' })
    || a.deviceId.localeCompare(b.deviceId));
}
