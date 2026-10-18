'use client';

import { useEffect, useState } from 'react';
import BambooLoadingScreen from './BambooLoadingScreen';
import { useBambooLoading } from '../lib/use-bamboo-loading';

/** The original opening player uses its own server and preparation lifecycle. */
export default function OpeningLoading() {
  const { progress, begin, update, finish, cancel } = useBambooLoading();
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const ticket = begin();
    let complete: ReturnType<typeof setTimeout> | undefined;
    setError('');
    // A same-origin, fixed-target check avoids cross-port CORS changes and
    // doesn't boot a hidden player or touch its camera, hardware or AI clients.
    void fetch('/api/qi-mirror/opening-ready', { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok || (await response.json()).ready !== true) throw new Error('The practice page is unavailable. Please try again.');
        if (controller.signal.aborted) return;
        update(ticket, 100);
        // Let the 420 ms ink reveal finish, including on slower readiness checks.
        complete = setTimeout(async () => {
          if (await finish(ticket) && !controller.signal.aborted) {
            window.location.replace('http://127.0.0.1:8766/first-three.html?step=1');
          }
        }, 500);
      }).catch(() => {
        if (controller.signal.aborted) return;
        cancel();
        setError('The practice page is unavailable. Please try again.');
      });
    return () => {
      controller.abort();
      if (complete) clearTimeout(complete);
      cancel();
    };
  }, [attempt, begin, update, finish, cancel]);

  return <BambooLoadingScreen progress={progress} error={error} onRetry={() => setAttempt(value => value + 1)} />;
}
