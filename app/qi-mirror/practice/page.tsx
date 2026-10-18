import type { Metadata } from 'next';
import PracticeWorkspace from '@/features/qi-mirror/components/PracticeWorkspace';
import '../styles/game-type.css';
import '../styles/landing.css';
import '../styles/enter.css';
import '../styles/practice-base.css';
import '../styles/practice-ink.css';
import '../styles/practice-completion.css';

export const metadata: Metadata = {
  title: '氣 mirror · Movement practice',
  description: 'Learn one small tai chi step at a time, with slow demonstrations, unlimited imitation time, and real pose overlays.',
};

export default function PracticePage() {
  return <PracticeWorkspace />;
}
