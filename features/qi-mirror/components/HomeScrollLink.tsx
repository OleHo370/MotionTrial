'use client';
import { useEffect, useRef, type AnchorHTMLAttributes, type MouseEvent } from 'react';
import { useHomeMotion } from './HomeMotion';

/** Native anchor semantics with a finite, interruptible journey between scenes. */
export default function HomeScrollLink(props: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const { paused, reduced, visible } = useHomeMotion();
  const cancel = useRef<() => void>(() => {});
  useEffect(() => () => cancel.current(), []);
  useEffect(() => { if (paused || reduced || !visible) cancel.current(); }, [paused, reduced, visible]);
  const navigate = (event: MouseEvent<HTMLAnchorElement>) => {
    props.onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || props.target || props.download) return;
    if (!props.href.startsWith('#')) return;
    const destination = document.getElementById(props.href.slice(1));
    if (!destination) return;
    event.preventDefault();
    // A different link cancels the previous journey too.
    window.dispatchEvent(new Event('qi:scene-navigation'));
    cancel.current();
    const start = window.scrollY;
    const finish = Math.max(0, Math.min(document.documentElement.scrollHeight - innerHeight, destination.getBoundingClientRect().top + start));
    const distance = finish - start;
    // Reserve the new entry before moving, so Back retains the departure
    // position. Its URL gets the destination fragment only after arrival.
    if (window.location.hash !== props.href) history.pushState(history.state, '', location.href);
    const complete = () => {
      if (window.location.hash !== props.href) history.replaceState(history.state, '', props.href);
      const heading = destination.querySelector<HTMLElement>('h2') || destination;
      const previousTabIndex = heading.getAttribute('tabindex');
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
      heading.addEventListener('blur', () => {
        if (previousTabIndex === null) heading.removeAttribute('tabindex');
        else heading.setAttribute('tabindex', previousTabIndex);
      }, { once: true });
    };
    if (paused || reduced || matchMedia('(prefers-reduced-motion: reduce)').matches || Math.abs(distance) < 2) {
      window.scrollTo({ top: finish, behavior: 'instant' }); complete(); return;
    }
    let frame = 0, began = 0;
    const duration = Math.min(1250, 800 + Math.abs(distance) * .15);
    const stop = () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('wheel', stop);
      window.removeEventListener('touchstart', stop);
      window.removeEventListener('pointerdown', stop);
      window.removeEventListener('resize', stop);
      window.removeEventListener('popstate', stop);
      window.removeEventListener('hashchange', stop);
      window.removeEventListener('qi:scene-navigation', stop);
      window.removeEventListener('keydown', key);
      cancel.current = () => {};
    };
    const key = (e: KeyboardEvent) => { if (['Escape','Tab','ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(e.key)) stop(); };
    const tick = (now: number) => {
      if (!began) began = now;
      const t = Math.min(1, (now - began) / duration);
      // Smooth acceleration, a readable middle, then an unhurried arrival.
      const eased = t * t * t * (t * (t * 6 - 15) + 10);
      window.scrollTo({ top: start + distance * eased, behavior: 'instant' });
      if (t < 1) frame = requestAnimationFrame(tick);
      else { stop(); complete(); }
    };
    for (const name of ['wheel','touchstart','pointerdown','resize','popstate','hashchange','qi:scene-navigation']) window.addEventListener(name, stop, { passive: true });
    window.addEventListener('keydown', key);
    cancel.current = stop;
    frame = requestAnimationFrame(tick);
  };
  return <a {...props} onClick={navigate} />;
}
