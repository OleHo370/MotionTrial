import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FOUR_POINT_GUIDE_VERSION, FOUR_POINT_RULES_VERSION, prepareFourPointStep } from '../lib/four-point-game';
import { FOLLOW_FOCUS_VERSION } from '../lib/follow-teacher';

/** Deterministic eligibility index from the unchanged local front-source observations. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/practice-media/dual-view/manifest.json'), 'utf8'));
let modelSha256: string | null = null;
const forms = manifest.forms.map((form: any) => {
  const data = JSON.parse(fs.readFileSync(path.join(root, 'public', form.front.poseSrc), 'utf8'));
  if (data.sourceSha256 !== manifest.sources.front.sha256 || !/^[a-f0-9]{64}$/i.test(data.modelSha256)) {
    throw new Error(`Front-source/model provenance is missing or inconsistent for ${form.id}.`);
  }
  if (modelSha256 !== null && modelSha256 !== data.modelSha256) throw new Error('All forms must use the same pinned model.');
  modelSha256 = data.modelSha256;
  const eligibleStepIds = form.steps.filter((step: any) => prepareFourPointStep(form, step, data).referenceUsable)
    .map((step: any) => step.id);
  return { id: form.id, formNumber: form.formNumber, totalSteps: form.steps.length,
    eligibleStepIds, visualOnlyCount: form.steps.length - eligibleStepIds.length,
    availableStars: eligibleStepIds.length > 0 ? 3 : 0 };
});
const metadata = {
  schemaVersion: 'four-point-levels-v1',
  sourceSha256: manifest.sources.front.sha256,
  modelSha256,
  rulesVersion: FOUR_POINT_RULES_VERSION,
  guideVersion: FOUR_POINT_GUIDE_VERSION,
  focusVersion: FOLLOW_FOCUS_VERSION,
  availableStars: forms.reduce((sum: number, form: { availableStars: number }) => sum + form.availableStars, 0),
  visualOnlyFormIds: forms.filter((form: { availableStars: number }) => form.availableStars === 0).map((form: { id: string }) => form.id),
  forms,
};
fs.writeFileSync(path.join(root, 'public/game-levels.json'), `${JSON.stringify(metadata, null, 2)}\n`);
console.log(`Built public/game-levels.json: ${forms.length} forms, ${forms.reduce((sum: number, form: { eligibleStepIds: string[] }) => sum + form.eligibleStepIds.length, 0)} eligible steps, ${metadata.availableStars} available stars.`);
