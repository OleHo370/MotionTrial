import type { Landmark, Observation } from './types';

export type PoseEstimate = Pick<Observation, 'status' | 'landmarks'>;
export interface PoseClient {
  estimate: (video: HTMLVideoElement, frameTimeMs: number) => PoseEstimate;
  close: () => void;
}

/** Real local MediaPipe inference. No fixtures or fallback coordinates enter this path. */
export async function createPoseClient(): Promise<PoseClient> {
  const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
  const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
  const model = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: '/models/pose_landmarker_lite.task', delegate: 'CPU' },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputSegmentationMasks: false,
  });

  return {
    estimate(video, frameTimeMs) {
      // frameTimeMs is sampled BEFORE synchronous inference, never on completion.
      const result = model.detectForVideo(video, frameTimeMs);
      const pose = result.landmarks[0];
      if (!pose) return { status: 'no_pose', landmarks: [] };
      const landmarks: Landmark[] = [];
      for (const index of [11, 12, 13, 14, 15, 16]) {
        const point = pose[index];
        if (!point || ![point.x, point.y, point.z, point.visibility].every(Number.isFinite)) {
          return { status: 'inference_error', landmarks: [] };
        }
        // Off-frame estimates stay off-frame; clamping would invent an edge position.
        landmarks.push({ index, x: point.x, y: point.y, z: point.z, visibility: point.visibility });
      }
      return { status: 'pose', landmarks };
    },
    close() { model.close(); },
  };
}
