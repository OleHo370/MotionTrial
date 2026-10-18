'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type PendingFinish = {
  ticket: number;
  promise: Promise<boolean>;
  resolve: (finished: boolean) => void;
};

/** Coordinates real preparation with a one-second minimum; never estimates progress. */
export function useBambooLoading() {
  const [view, setView] = useState({ loading: false, progress: 0 });
  const mounted = useRef(true);
  const current = useRef({ ticket: 0, enteredAt: 0, active: false });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<PendingFinish | null>(null);

  const invalidate = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = undefined;
    const previous = pending.current;
    pending.current = null;
    current.current.active = false;
    current.current.ticket += 1;
    previous?.resolve(false);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      invalidate();
    };
  }, [invalidate]);

  const begin = useCallback(() => {
    invalidate();
    const ticket = current.current.ticket;
    current.current = { ticket, enteredAt: performance.now(), active: true };
    if (mounted.current) setView({ loading: true, progress: 0 });
    return ticket;
  }, [invalidate]);

  const update = useCallback((ticket: number, progress: number) => {
    if (!mounted.current || !current.current.active || current.current.ticket !== ticket || !Number.isFinite(progress)) return;
    const value = Math.min(100, Math.max(0, progress));
    setView(previous => ({ ...previous, progress: Math.max(previous.progress, value) }));
  }, []);

  const finish = useCallback((ticket: number): Promise<boolean> => {
    if (!mounted.current || !current.current.active || current.current.ticket !== ticket) return Promise.resolve(false);
    if (pending.current?.ticket === ticket) return pending.current.promise;
    setView(previous => ({ ...previous, progress: 100 }));
    let resolve!: (finished: boolean) => void;
    const promise = new Promise<boolean>(settle => { resolve = settle; });
    pending.current = { ticket, promise, resolve };
    const complete = () => {
      timer.current = undefined;
      if (!mounted.current || !current.current.active || current.current.ticket !== ticket) {
        resolve(false);
        return;
      }
      const remaining = 1_000 - (performance.now() - current.current.enteredAt);
      if (remaining > 0) {
        timer.current = setTimeout(complete, Math.ceil(remaining));
        return;
      }
      current.current.active = false;
      pending.current = null;
      setView({ loading: false, progress: 100 });
      resolve(true);
    };
    const remaining = Math.max(0, 1_000 - (performance.now() - current.current.enteredAt));
    if (remaining > 0) timer.current = setTimeout(complete, Math.ceil(remaining));
    else complete();
    return promise;
  }, []);

  const cancel = useCallback(() => {
    invalidate();
    if (mounted.current) setView(previous => ({ ...previous, loading: false }));
  }, [invalidate]);

  return { ...view, begin, update, finish, cancel };
}
