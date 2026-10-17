import type { Metadata } from 'next';
import PracticeWorkspace from '../../components/PracticeWorkspace';
import './practice.css';

export const metadata: Metadata = {
  title: 'MotionTrial · Movement practice',
  description: 'Learn one small tai chi step at a time, with slow demonstrations, unlimited imitation time, and real pose overlays.',
};

export default function PracticePage() {
  return <PracticeWorkspace />;
}
