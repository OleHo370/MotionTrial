'use client';

import { useEffect, useState } from 'react';
import { preload } from 'react-dom';
import PracticeDemo from './PracticeDemo';
import TeachingPractice from './TeachingPractice';
import BambooLoadingScreen from './BambooLoadingScreen';

export default function PracticeWorkspace() {
  preload('/qi-mirror/landing-art/completion-paper-organic-v2.png', { as: 'image' });
  const [mode, setMode] = useState<'guided' | 'forms' | null>(null);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    setMode(query.get('mode') === 'forms' || (query.has('routine') && query.get('mode') !== 'guided') ? 'forms' : 'guided');
  }, []);
  const changeMode = (next: 'guided' | 'forms') => {
    setMode(next);
    const url = new URL(window.location.href);
    url.searchParams.set('mode', next);
    if (next === 'guided') url.searchParams.delete('routine');
    window.history.replaceState(null, '', url);
  };
  const control = <nav className="practice-mode-control" aria-label="Practice mode">
    <button aria-pressed={mode === 'guided'} onClick={() => changeMode('guided')}>Step-by-step learning</button>
    <button aria-pressed={mode === 'forms'} onClick={() => changeMode('forms')}>Whole-form practice</button>
  </nav>;
  if (!mode) return <BambooLoadingScreen progress={0} />;
  return mode === 'guided' ? <TeachingPractice modeControl={control} /> : <PracticeDemo modeControl={control} />;
}
