import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFollowSession, evaluateFollowObservation, prepareStepReference, FOLLOW_FOCUS_VERSION, FOLLOW_RULES_VERSION } from '../lib/follow-teacher';
import { RELAXED_COMPARISON_OPTIONS } from '../lib/imitation';
import { TEACHING_RULES_VERSION } from '../lib/teaching';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/practice-media/dual-view/manifest.json'), 'utf8'));
const rows: unknown[] = [];
const outcomes: Record<string, number> = { match: 0, mismatch: 0, unknown: 0 };
let usable = 0;
for (const form of manifest.forms) {
  const data = JSON.parse(fs.readFileSync(path.join(root, 'public', form.front.poseSrc), 'utf8'));
  for (const step of form.steps) {
    const reference = prepareStepReference(form, step, data);
    const session = createFollowSession(reference);
    const samples = data.samples.filter((s: {sourceTimeSeconds: number}) => s.sourceTimeSeconds >= step.front.startSeconds && s.sourceTimeSeconds < step.front.endSeconds);
    let result;
    for (const sample of samples) result = evaluateFollowObservation(reference, sample, {
      attemptAspectRatio: reference.referenceAspectRatio, liveAgeMs: 0, session,
    });
    if (!result) throw new Error(`No actual observations for ${step.id}`);
    outcomes[result.status]++;
    if (reference.referenceUsable) usable++;
    rows.push({ id: step.id, formNumber: form.formNumber, title: step.title, focusJoints: reference.focusJoints,
      focusLabel: reference.focusLabel, focusProvenance: reference.focusProvenance, sourceSpan: step.front,
      targetSourceSeconds: reference.targetSourceSeconds, sourceSampleCount: reference.sourceSampleCount,
      coverage: reference.coverage, motionRequired: reference.motionRequired, referenceUsable: reference.referenceUsable,
      unknownReason: reference.unknownReason, referenceEvidence: reference.referenceEvidence,
      recordedTraceReplay: { status: result.status, message: result.message, movementEvidence: result.motionEvidence } });
  }
}
const report = {
  generatedAt: new Date().toISOString(), schemaVersion: 'follow-matching-audit-v1',
  provenance: 'Reference observations are the existing real local MediaPipe front-video records. Attempts in this audit replay those same records into the matcher. This is a recorded-input software check, NOT a live camera, distinct learner, or physical-human acceptance test.',
  sourceSha256: manifest.sources.front.sha256, modelSha256: manifest.modelSha256,
  rulesVersion: FOLLOW_RULES_VERSION, focusVersion: FOLLOW_FOCUS_VERSION, endpointRulesVersion: TEACHING_RULES_VERSION,
  reusedEndpointThresholds: { weightedRms: 0.72, maximumFocusError: 1.05 },
  reusedMotionRuleValues: { sourceMinimumExcursion: RELAXED_COMPARISON_OPTIONS.minimumFocusExcursion,
    sourceMinimumNetDisplacement: RELAXED_COMPARISON_OPTIONS.minimumFocusPhaseDisplacement,
    minimumLiveDisplacementRatio: RELAXED_COMPARISON_OPTIONS.minimumExcursionRatio,
    minimumCoverage: RELAXED_COMPARISON_OPTIONS.minimumCoverage, maximumSampleGapMs: RELAXED_COMPARISON_OPTIONS.maximumSampleGapMs },
  localAdditionalMotionGuard: { minimumProjectedDisplacementTorsoUnits: 0.035, requireEverySourceActiveAnatomicalFocus: true,
    startAcquisitionMaximumProjectedPhase: 0.55, noAttemptDeadline: true, displayMirroringNotAnInput: true },
  totals: { forms: manifest.forms.length, steps: rows.length, referencesUsableForFeedback: usable, recordedTraceReplay: outcomes },
  limitations: [
    'Front records still contain real occlusion and small or ambiguous phase changes. These remain unknown; manual learning is always available.',
    'A span with sufficient aggregate reference coverage can lose tracking near its endpoint. Replay then resets movement evidence and can remain unmatched or unknown.',
    'The additional guard checks projected anatomical displacement and approximate held target proximity. It does not verify full choreography, weight transfer, palm orientation, force, or depth.',
    'Unspecified front/rear/stepping feet retain both ankle identities; anatomical side is never guessed from mirrored screen coordinates.',
    'Different people, camera angles, clothing, deliberate wrong-side attempts and actual physical camera switching still need human checks.',
  ], steps: rows,
};
const destination = path.join(root, 'artifacts/follow-teacher-review');
fs.mkdirSync(destination, { recursive: true });
fs.writeFileSync(path.join(destination, 'matching-audit.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.totals));
