export const TASK_ID = 'seated-arm-movement';
export const TASK_VERSION = 'v0.1';
export const INSTRUCTIONS = 'Sit comfortably and keep your upper body in view. For the next 20 seconds, slowly raise and lower your hands within a comfortable range. You may pause or stop at any time.';
export const CONSENT = 'This demonstration records video without audio and uploads the video and movement tracking data to this demo app’s server. Saved data remains until you delete the session or reset demo data. Continue only with your own authorized demonstration recording.';
export const MODEL_VERSION = '@mediapipe/tasks-vision 1.1.1 / pose_landmarker_lite float16 v1';
export type Provenance = 'live_camera' | 'prerecorded_demo' | 'synthetic_demo';
export type Disposition = 'accept' | 'recapture' | 'uncertain';
export interface Landmark { index: number; x: number; y: number; z: number; visibility: number }
export interface Observation { tMs: number; sourceVideoMs?: number; status: 'pose' | 'no_pose' | 'inference_error'; landmarks: Landmark[] }
export interface QualityEvent { type: 'no_pose' | 'low_visibility' | 'sampling_gap' | 'inference_error' | 'recording_interrupted'; startMs: number; endMs: number; affectedPoints: number[]; reason: string; ruleVersion: string }
export interface Analysis { ruleVersion: string; coverage: number; validMs: number; unknownMs: number; state: 'review_flags' | 'no_flags' | 'insufficient_tracking'; events: QualityEvent[] }
export interface CaptureMetadata { id: string; demoCode: string; provenance: Provenance; consentAt: string; recordedAt: string; durationMs: number; interrupted: boolean; interruptionReason?: string; taskId: string; taskVersion: string; instructions: string; modelVersion: string; parentSessionId?: string; timing: { performanceStartMs: number; recorderStartMs: number; videoStartMs: number }; demoCase?: string }
export interface ReviewEntry { disposition: Disposition; note: string; createdAt: string; reviewer: string }
export interface Session extends CaptureMetadata { mimeType: string; videoSize: number; createdAt: string; observations: Observation[]; analysis: Analysis; reviews: ReviewEntry[] }
export type SessionSummary = Omit<Session, 'observations'>;
