import { z } from 'zod';
import { INSTRUCTIONS, TASK_ID, TASK_VERSION, type CaptureMetadata, type Observation } from '../types';

export const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
export const MAX_OBSERVATION_BYTES = 2 * 1024 * 1024;
export const MAX_REQUEST_BYTES = MAX_VIDEO_BYTES + MAX_OBSERVATION_BYTES + 64 * 1024;

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const finite = z.number().finite();
const anchor = finite.min(0).max(1e12);
export const metadataSchema = z.object({
  id: z.uuid(), demoCode: z.string().trim().min(1).max(60).regex(/^[A-Za-z0-9 _-]+$/, 'Use only letters, numbers, spaces, hyphens or underscores for a demo code.'),
  provenance: z.enum(['live_camera', 'prerecorded_demo', 'synthetic_demo']),
  consentAt: z.iso.datetime({ offset: true }), recordedAt: z.iso.datetime({ offset: true }),
  durationMs: finite.min(1).max(30_000), interrupted: z.boolean(),
  interruptionReason: z.string().max(300).optional(),
  taskId: z.literal(TASK_ID), taskVersion: z.literal(TASK_VERSION), instructions: z.literal(INSTRUCTIONS),
  modelVersion: z.string().min(1).max(200), parentSessionId: z.uuid().optional(),
  timing: z.object({ performanceStartMs: anchor, recorderStartMs: anchor, videoStartMs: anchor }).strict(),
  demoCase: z.string().max(80).optional(),
}).strict().superRefine((value, ctx) => {
  if (Date.parse(value.consentAt) > Date.parse(value.recordedAt) + 1000) {
    ctx.addIssue({ code: 'custom', path: ['consentAt'], message: 'Consent must be recorded before capture.' });
  }
  if (value.parentSessionId === value.id) ctx.addIssue({ code: 'custom', path: ['parentSessionId'], message: 'A recapture must link to a different session.' });
});

const landmarkSchema = z.object({
  index: z.number().int().min(11).max(16), x: finite.min(-5).max(5), y: finite.min(-5).max(5),
  z: finite.min(-20).max(20), visibility: finite.min(0).max(1),
}).strict();
const observationSchema = z.object({
  tMs: finite.min(0).max(30_000), sourceVideoMs: finite.min(0).max(31_000).optional(),
  status: z.enum(['pose', 'no_pose', 'inference_error']), landmarks: z.array(landmarkSchema).max(6),
}).strict().superRefine((value, ctx) => {
  if (value.status === 'pose' && (value.landmarks.length !== 6 || new Set(value.landmarks.map(p => p.index)).size !== 6)) {
    ctx.addIssue({ code: 'custom', path: ['landmarks'], message: 'Pose observations must include each upper-limb landmark (11–16) once.' });
  }
  if (value.status !== 'pose' && value.landmarks.length) ctx.addIssue({ code: 'custom', path: ['landmarks'], message: 'Unavailable tracking must not contain stale landmarks.' });
});

function parseJson(text: string, label: string, maxBytes: number): unknown {
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new ApiError(413, `${label} exceeds the allowed size.`);
  try { return JSON.parse(text); } catch { throw new ApiError(400, `${label} must be valid JSON.`); }
}
function schemaError(error: z.ZodError, label: string): ApiError {
  return new ApiError(400, `${label}: ${error.issues.slice(0, 4).map(issue => `${issue.path.join('.') || 'value'} ${issue.message}`).join('; ')}`);
}

export function parseCapture(metadataJson: string, observationsJson: string): { metadata: CaptureMetadata; observations: Observation[] } {
  const metadataResult = metadataSchema.safeParse(parseJson(metadataJson, 'Metadata', 16 * 1024));
  if (!metadataResult.success) throw schemaError(metadataResult.error, 'Invalid metadata');
  const observationResult = z.array(observationSchema).max(1500).safeParse(parseJson(observationsJson, 'Observations', MAX_OBSERVATION_BYTES));
  if (!observationResult.success) throw schemaError(observationResult.error, 'Invalid observations');
  const metadata = metadataResult.data;
  const observations = observationResult.data;
  let previous = -1;
  for (const observation of observations) {
    if (observation.tMs <= previous || observation.tMs > metadata.durationMs || (observation.sourceVideoMs !== undefined && observation.sourceVideoMs > metadata.durationMs + 1000)) {
      throw new ApiError(400, 'Observation timestamps must be strictly increasing and within the recording duration.');
    }
    previous = observation.tMs;
  }
  return { metadata, observations };
}

export const reviewSchema = z.object({
  disposition: z.enum(['accept', 'recapture', 'uncertain']), note: z.string().trim().max(2000),
  reviewer: z.string().trim().min(1).max(80).optional(),
}).strict();

export function parseReview(value: unknown) {
  const result = reviewSchema.safeParse(value);
  if (!result.success) throw schemaError(result.error, 'Invalid review');
  return result.data;
}

export function validateId(id: string): void {
  if (!z.uuid().safeParse(id).success) throw new ApiError(400, 'Session ID must be a UUID.');
}

export function validateVideo(bytes: Buffer, mimeType: string): string {
  if (!bytes.length) throw new ApiError(400, 'The recording is empty. Please record again.');
  if (bytes.length > MAX_VIDEO_BYTES) throw new ApiError(413, 'Video exceeds the 25 MB limit.');
  const mime = mimeType.toLowerCase().split(';')[0].trim();
  const webm = mime === 'video/webm' && bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  const mp4 = mime === 'video/mp4' && bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp';
  if (!webm && !mp4) throw new ApiError(415, 'Use a supported WebM or MP4 recording with a matching video header.');
  return mime;
}
