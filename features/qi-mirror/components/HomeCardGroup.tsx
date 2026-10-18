'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { useHomeMotion } from './HomeMotion';

/** Content is visible without JS; entry effects never gate content or navigation. */
export default function HomeCardGroup({ children, className }: { children: ReactNode; className: string }) {
  const root = useRef<HTMLDivElement>(null);
  const seen = useRef(new WeakSet<Element>());
  const animations = useRef(new Set<Animation>());
  const motion = useHomeMotion();
  const currentMotion = useRef(motion);
  currentMotion.current = motion;
  useEffect(() => {
    const cards = Array.from(root.current?.children ?? []).filter((element): element is HTMLElement => element instanceof HTMLElement);
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting || seen.current.has(entry.target)) continue;
        seen.current.add(entry.target); observer.unobserve(entry.target);
        const card = entry.target as HTMLElement;
        card.dataset.entered = 'true';
        const state = currentMotion.current;
        if (state.paused || state.reduced || !state.visible || !card.animate) continue;
        const index = cards.indexOf(card);
        // Focus may complete an entry between pointer down and up. Keep any
        // interactive group in place so that completion cannot move the target.
        const interactive=!!card.querySelector('button,a,[tabindex]');
        const horizontal = !interactive && innerWidth > 700 ? (index % 2 === 0 ? -20 : 20) : 0;
        const animation = card.animate([
          { opacity: .12, transform: interactive ? 'none' : `translate(${horizontal}px, 32px) scale(.98)` },
          { opacity: 1, transform: 'translate(0, 0) scale(1)' },
        ], { duration: 760, delay: innerWidth > 700 ? Math.min(index, 2) * 90 : 0, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' });
        animations.current.add(animation);
        animation.onfinish = animation.oncancel = () => animations.current.delete(animation);
      }
    }, { threshold: .08, rootMargin: '0px 0px -5% 0px' });
    cards.forEach(card => observer.observe(card));
    return () => { observer.disconnect(); animations.current.forEach(animation => animation.cancel()); animations.current.clear(); };
  }, []);
  useEffect(() => {
    if (motion.paused || motion.reduced || !motion.visible) {
      animations.current.forEach(animation => animation.finish());
      animations.current.clear();
    }
  }, [motion.paused, motion.reduced, motion.visible]);
  return <div ref={root} className={'home-card-group ' + className} onFocusCapture={() => {
    animations.current.forEach(animation => animation.finish()); animations.current.clear();
  }}>{children}</div>;
}
