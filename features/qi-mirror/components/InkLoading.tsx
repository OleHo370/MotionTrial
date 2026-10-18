'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import BambooLoadingScreen from './BambooLoadingScreen';
import { prepareLesson, storePreparedLesson, type LessonLoadPlan, type PreparedLesson } from '../lib/lesson-preload';

export default function InkLoading({ plan }: { plan: LessonLoadPlan }) {
  const router = useRouter();
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const lesson = useRef<PreparedLesson | null>(null);
  const transferred = useRef(false);

  useEffect(() => {
    const enteredAt = performance.now();
    const controller = new AbortController();
    let frame = 0, nextProgress = 0;
    let navigate: ReturnType<typeof setTimeout> | undefined;
    transferred.current = false;
    setProgress(0); setError('');
    const destination = `/qi-mirror/practice?mode=guided&form=${plan.form}`;
    router.prefetch(destination);
    const update = (value: number) => {
      nextProgress = value;
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; setProgress(nextProgress); });
    };
    void prepareLesson(plan, controller.signal, update).then(prepared => {
      if (controller.signal.aborted) { URL.revokeObjectURL(prepared.videoUrl); return; }
      lesson.current = prepared;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      setProgress(100);
      navigate = setTimeout(() => {
        if (controller.signal.aborted) return;
        storePreparedLesson(prepared);
        transferred.current = true;
        router.replace(destination);
      }, Math.max(0, 1_000 - (performance.now() - enteredAt)));
    }).catch(cause => {
      if (controller.signal.aborted) return;
      controller.abort();
      if (frame) cancelAnimationFrame(frame);
      if (navigate) clearTimeout(navigate);
      frame = 0;
      setError(cause instanceof Error ? cause.message : 'The lesson could not be loaded. Please retry.');
    });
    return () => {
      controller.abort();
      if (frame) cancelAnimationFrame(frame);
      if (navigate) clearTimeout(navigate);
      if (lesson.current && !transferred.current) URL.revokeObjectURL(lesson.current.videoUrl);
      lesson.current = null;
    };
  }, [plan, attempt, router]);

  return <BambooLoadingScreen progress={progress} error={error} onRetry={() => setAttempt(value => value + 1)} />;
}
