'use client';

import PracticePaperDialog from './PracticePaperDialog';

type PracticeInstructionsProps = {
  onBegin: () => void;
};

/** A first-form introduction; Begin never requests camera permission itself. */
export default function PracticeInstructions({ onBegin }: PracticeInstructionsProps) {
  return <PracticePaperDialog
    variant="instructions"
    heading="How to play"
    detail="Watch the movement in the video, then follow the on-screen guide in your camera view to complete the task."
    actions={[{ label: 'Begin', onChoose: onBegin }]}
  />;
}
