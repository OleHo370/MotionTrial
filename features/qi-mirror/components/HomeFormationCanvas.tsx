'use client';
import { useEffect, useRef, useState } from 'react';
import { useHomeMotion } from './HomeMotion';
import { createFormationRenderer } from './formation-renderer';

/** Decorative formation; shared selection and pause remain in the existing homepage. */
export default function HomeFormationCanvas({ phase, visible }: { phase: number; visible: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<ReturnType<typeof createFormationRenderer> | null>(null);
  const motion = useHomeMotion();
  const playback = useRef({ phase, visible: visible && motion.visible, paused: motion.paused, reduced: motion.reduced });
  const synchronize = useRef<() => void>(() => {});
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!canvas.current) return;
    const target = canvas.current;
    let scrollFrame = 0;
    try {
      renderer.current = createFormationRenderer(target);
      synchronize.current = () => {
        const box = target.getBoundingClientRect();
        const onScreen = box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth;
        renderer.current?.update({ ...playback.current, visible: onScreen && !document.hidden });
      };
      const resize = () => { const box = target.getBoundingClientRect(); renderer.current?.resize(box.width, box.height); synchronize.current(); };
      const observer = new ResizeObserver(resize); observer.observe(target);
      const intersection = new IntersectionObserver(() => synchronize.current()); intersection.observe(target);
      // An immediate anchor jump can precede an observer delivery. Selection and
      // scroll both reconcile the real rectangle, so a visible field cannot stick suspended.
      const scrolled = () => { if (!scrollFrame) scrollFrame = requestAnimationFrame(() => { scrollFrame = 0; synchronize.current(); }); };
      window.addEventListener('scroll', scrolled, { passive: true, capture: true });
      resize(); setReady(true);
      return () => { synchronize.current = () => {}; cancelAnimationFrame(scrollFrame); window.removeEventListener('scroll', scrolled, true); intersection.disconnect(); observer.disconnect(); renderer.current?.dispose(); renderer.current = null; };
    } catch { renderer.current?.dispose(); renderer.current = null; }
  }, []);
  useEffect(() => {
    playback.current = { phase, visible: visible && motion.visible, paused: motion.paused, reduced: motion.reduced || matchMedia('(prefers-reduced-motion: reduce)').matches };
    synchronize.current();
  }, [phase, visible, motion.visible, motion.paused, motion.reduced]);
  return <canvas ref={canvas} className="home-formation-canvas" data-active={phase === 1 || phase === 2} data-ready={ready} aria-hidden="true" />;
}
