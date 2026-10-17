import { PRACTICE_JOINTS, type PoseSample, type PracticeLandmark } from './imitation';

export interface ImitationPoseClient {
  estimate: (video: HTMLVideoElement, frameTimeMs: number) => Pick<PoseSample, 'status' | 'landmarks'>;
  close: () => void;
}

/** One instance per input stream; reference playback and camera never share tracking state. */
export async function createImitationPoseClient(): Promise<ImitationPoseClient> {
  const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
  const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
  const model = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: '/models/pose_landmarker_lite.task', delegate: 'CPU' },
    runningMode: 'VIDEO', numPoses: 1,
    minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    outputSegmentationMasks: false,
  });
  return {
    estimate(video, frameTimeMs) {
      const pose = model.detectForVideo(video, frameTimeMs).landmarks[0];
      if (!pose) return { status: 'no_pose', landmarks: [] };
      const landmarks: PracticeLandmark[] = [];
      for (const index of PRACTICE_JOINTS) {
        const point = pose[index];
        if (!point || ![point.x, point.y, point.z, point.visibility].every(Number.isFinite)) {
          return { status: 'inference_error', landmarks: [] };
        }
        // Retain off-image coordinates; rendering and matching reject them rather than clamp.
        landmarks.push({ index, x: point.x, y: point.y, z: point.z, visibility: point.visibility });
      }
      return { status: 'pose', landmarks };
    },
    close() { model.close(); },
  };
}
