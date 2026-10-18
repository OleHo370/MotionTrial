'use client';

import { useRouter } from 'next/navigation';
import PracticePaperDialog from './PracticePaperDialog';

type PracticeCompletionProps = {
  title: string;
  detail: string;
  onRestudy: () => void;
  onNext: () => void;
  nextLabel?: string;
};

export default function PracticeCompletion({ title, detail, onRestudy, onNext, nextLabel = 'Next' }: PracticeCompletionProps) {
  const router = useRouter();
  return <PracticePaperDialog
    heading="Congratulations"
    title={title}
    detail={detail}
    actions={[
      { label: 'Restudy', onChoose: onRestudy, arrow: '↶' },
      { label: nextLabel, onChoose: onNext, arrow: '↗' },
    ]}
    onHome={() => router.push('/qi-mirror')}
  />;
}
