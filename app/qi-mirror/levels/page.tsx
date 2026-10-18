import type { Metadata } from 'next';
import LevelSelection from '@/features/qi-mirror/components/LevelSelection';
import playlist from '@/public/practice-media/24-playlist.json';
import '../styles/homepage-base.css';
import '../styles/landing.css';
import '../styles/levels.css';

export const metadata: Metadata = {
  title: '氣mirror · 二十四式 · Choose your form',
  description: 'Turn the bagua wheel and discover 24 tai chi forms. A quiet beginning, one form at a time.',
};

export default function LevelsPage() {
  const levels = playlist.clips.map(clip => ({
    number: clip.formNumber,
    title: clip.title,
    chineseTitle: clip.chineseTitle,
    src: clip.src,
    durationSeconds: clip.durationSeconds,
  }));
  return <LevelSelection levels={levels} />;
}
