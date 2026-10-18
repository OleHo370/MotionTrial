'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { useHomeMotion } from './HomeMotion';

/** Two normal-height scenes: the cover stays behind the incoming experience. */
export default function HomeExperienceEntrance({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const { paused, reduced, visible } = useHomeMotion();
  const enabled = !paused && !reduced;

  useEffect(() => {
    const element = root.current;
    const cover = element?.querySelector<HTMLElement>('.home-cover');
    if (!element || !cover) return;
    if (!enabled) {
      element.style.removeProperty('--experience-reveal');
      element.style.removeProperty('--experience-frost');
      delete element.dataset.coverGlass;
      cover.inert = false;
      return;
    }
    if (!visible) return;

    let frame = 0, origin = 0, distance = 1, previous = -1;
    const update = () => {
      frame = 0;
      const progress = Math.min(1, Math.max(0, (window.scrollY - origin) / distance));
      if (Math.abs(progress - previous) < .0001) return;
      previous = progress;
      element.style.setProperty('--experience-reveal', progress.toFixed(4));
      // Frost belongs to the departing white cover, never the incoming scene.
      const frost = Math.min(1, progress / .72);
      element.style.setProperty('--experience-frost', (frost * frost * (3 - 2 * frost)).toFixed(4));
      element.dataset.coverGlass = String(progress > 0 && progress < 1);
      // Covered controls must not receive invisible keyboard focus.
      cover.inert = progress >= 1;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const measure = () => {
      origin = element.getBoundingClientRect().top + window.scrollY;
      distance = Math.max(1, cover.offsetHeight);
      schedule();
    };
    const resize = new ResizeObserver(measure);
    resize.observe(element); resize.observe(cover);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', measure, { passive: true });
    measure();
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', measure);
      resize.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [enabled, visible]);

  return <div ref={root} className="home-experience-entrance" data-entrance-enabled={enabled} onFocusCapture={event => {
    if (!enabled || !(event.target instanceof HTMLElement) || !event.target.matches(':focus-visible')) return;
    const cover = root.current?.querySelector('.home-cover');
    if (cover?.contains(event.target) && Number(root.current?.style.getPropertyValue('--experience-reveal')) > 0) {
      // Keyboard users return to a fully clear, unobscured control.
      window.scrollTo({ top: root.current!.getBoundingClientRect().top + window.scrollY, behavior: 'instant' });
    }
  }}>{children}</div>;
}
