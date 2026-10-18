interface FormStep {
  id: string;
  parentFormId: string;
  parentFormOrder: number;
}

export interface TeachingFormProgress {
  formId: string;
  formOrder: number;
  stepIds: string[];
  firstStepIndex: number;
  nextStepIndex: number | null;
  nextFormIndex: number | null;
  complete: boolean;
}

/** A learner stays in the current form until all of its small steps are done. */
export function teachingFormProgress(steps: readonly FormStep[], currentIndex: number, confirmed: readonly string[]): TeachingFormProgress | null {
  const current = steps[currentIndex];
  if (!current) return null;
  const indices = steps.flatMap((step, index) => step.parentFormId === current.parentFormId ? [index] : []);
  const done = new Set(confirmed);
  const remaining = indices.filter(index => !done.has(steps[index].id));
  const nextFormIndex = steps.findIndex((step, index) => index > indices[indices.length - 1] && step.parentFormId !== current.parentFormId);
  return {
    formId: current.parentFormId,
    formOrder: current.parentFormOrder,
    stepIds: indices.map(index => steps[index].id),
    firstStepIndex: indices[0],
    nextStepIndex: remaining.find(index => index > currentIndex) ?? remaining[0] ?? null,
    nextFormIndex: nextFormIndex < 0 ? null : nextFormIndex,
    complete: remaining.length === 0,
  };
}

export function restudyForm(confirmed: readonly string[], form: TeachingFormProgress): string[] {
  const restarting = new Set(form.stepIds);
  return confirmed.filter(id => !restarting.has(id));
}
