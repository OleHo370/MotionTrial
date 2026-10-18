'use client';
import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import QiSymbol from './QiSymbol';
import InkSurface from './InkSurface';

const MotionContext = createContext({ paused: false, reduced: false, visible: true, toggle: () => {} });
export const useHomeMotion = () => useContext(MotionContext);

/** Homepage-only decoration. No shared wheel state, tracking or animation frame loop. */
export default function HomeMotion({ children }: { children: ReactNode }) {
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    // A client-mounted homepage can appear after the browser has attempted its
    // initial fragment jump. Restore our known scene anchors once on mount.
    if (!['#experience', '#practice', '#idea'].includes(location.hash)) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start', behavior: 'instant' });
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => setReduced(preference.matches);
    const updateVisibility = () => setVisible(!document.hidden);
    updatePreference(); updateVisibility();
    preference.addEventListener('change', updatePreference);
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      preference.removeEventListener('change', updatePreference);
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, []);
  return <MotionContext.Provider value={{ paused, reduced, visible, toggle: () => setPaused(value => !value) }}>
    <div className="qi-landing qi-home" lang="en" data-ambient-motion={!paused && !reduced && visible ? 'running' : 'paused'}>{children}</div>
  </MotionContext.Provider>;
}

export function HomeMotionToggle() {
  const { paused, reduced, toggle } = useContext(MotionContext);
  return <button className="home-motion-toggle" type="button" onClick={toggle} disabled={reduced} aria-pressed={paused || reduced}>
    <span aria-hidden="true">{paused || reduced ? '▷' : 'Ⅱ'}</span>
    {reduced ? 'Reduced motion' : paused ? 'Resume ambient motion' : 'Pause ambient motion'}
  </button>;
}

export function useVisibleDecoration() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0 });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return { ref, visible };
}

export function HomeFlow({ variant = 'hero' }: { variant?: 'hero' | 'culture' }) {
  const id = useId();
  return <div className={'home-flow home-flow-' + variant}>
    <svg className="home-paper-grain" width="100%" height="100%" aria-hidden="true"><defs><filter id={id + '-paper'}><feTurbulence type="fractalNoise" baseFrequency=".65" numOctaves="2" stitchTiles="stitch" /><feColorMatrix type="saturate" values="0" /></filter></defs><rect width="100%" height="100%" filter={'url(#' + id + '-paper)'} /></svg>
    <InkSurface kind={variant} />
  </div>;
}

/** Retains the supplied screenshot's circle, crossed squares and fixed form labels. */
export function HomeOrbit() {
  const { ref, visible } = useVisibleDecoration();
  return <div ref={ref} className="home-demo-wheel" data-visible={visible} aria-hidden="true">
    <svg className="home-orbit-lines" viewBox="0 0 320 320" fill="none">
      <circle cx="160" cy="160" r="146" />
      <g className="home-orbit-turn"><rect x="57" y="57" width="206" height="206" transform="rotate(22.5 160 160)" /><rect x="57" y="57" width="206" height="206" transform="rotate(67.5 160 160)" /></g>
      <circle cx="160" cy="160" r="101" strokeDasharray="1 13" />
    </svg>
    <div className="home-orbit-core"><QiSymbol className="home-demo-symbol" /></div>
    <span>XXIV</span><span>II</span><span>III</span><span>IV</span><b>I</b>
  </div>;
}
