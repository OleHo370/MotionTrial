'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameLevel } from '../lib/level-selection';

function indexAt(bounds: DOMRect, clientX: number, count: number) {
  return Math.max(0, Math.min(count - 1, Math.floor((clientX - bounds.left) / Math.max(1, bounds.width) * count)));
}

export default function LevelScrubber({ levels, current, onChoose }: {
  levels: GameLevel[];
  current: number;
  onChoose: (index: number) => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const track = useRef<HTMLElement>(null);
  const dragging = useRef<number | null>(null);
  const lastChoice = useRef<number | null>(null);
  const hoveredIndex = useRef<number | null>(null);
  const bounds = useRef<DOMRect | null>(null);
  const boundsDirty = useRef(true);
  const pointerFrame = useRef<number | null>(null);
  const pendingPointer = useRef<{ x: number; y: number; id: number } | null>(null);
  const active = hovered ?? focused;
  const activeLevel = active === null ? null : levels[active];

  const showHover = useCallback((index: number | null) => {
    if (hoveredIndex.current === index) return;
    hoveredIndex.current = index;
    setHovered(index);
  }, []);
  const cancelPointerFrame = useCallback(() => {
    if (pointerFrame.current !== null) cancelAnimationFrame(pointerFrame.current);
    pointerFrame.current = null;
    pendingPointer.current = null;
  }, []);
  const measure = useCallback((refresh = false) => {
    if ((refresh || boundsDirty.current || !bounds.current) && track.current) {
      bounds.current = track.current.getBoundingClientRect();
      boundsDirty.current = false;
    }
    return bounds.current;
  }, []);

  useEffect(() => {
    const invalidateBounds = () => { boundsDirty.current = true; };
    const followNearbyPointer = (event: PointerEvent) => {
      if (!event.isPrimary || (dragging.current !== event.pointerId && !['mouse', 'pen'].includes(event.pointerType))) return;
      pendingPointer.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
      if (pointerFrame.current !== null) return;
      pointerFrame.current = requestAnimationFrame(() => {
        pointerFrame.current = null;
        const pointer = pendingPointer.current;
        pendingPointer.current = null;
        const rect = measure();
        if (!pointer || !rect) return;
        setFocused(value => value === null ? value : null);
        const index = indexAt(rect, pointer.x, levels.length);
        const nearby = pointer.x >= rect.left - 20 && pointer.x <= rect.right + 20
          && pointer.y >= rect.top - 32 && pointer.y <= rect.bottom + 32;
        showHover(dragging.current === pointer.id || nearby ? index : null);
        if (dragging.current === pointer.id && lastChoice.current !== index) {
          lastChoice.current = index;
          onChoose(index);
        }
      });
    };
    const clearPointer = () => { cancelPointerFrame(); showHover(null); };
    const endDrag = () => {
      const pointerId = dragging.current;
      dragging.current = null;
      if (pointerId !== null && track.current?.hasPointerCapture(pointerId)) track.current.releasePointerCapture(pointerId);
      clearPointer();
    };
    // The hit areas never animate. Re-measure only when their actual layout moves.
    const observer = new ResizeObserver(invalidateBounds);
    if (track.current) observer.observe(track.current);
    observer.observe(document.body);
    window.addEventListener('pointermove', followNearbyPointer, { passive: true });
    window.addEventListener('scroll', invalidateBounds, { passive: true, capture: true });
    window.addEventListener('resize', invalidateBounds, { passive: true });
    window.addEventListener('blur', endDrag);
    document.addEventListener('pointerleave', clearPointer);
    return () => {
      cancelPointerFrame();
      observer.disconnect();
      window.removeEventListener('pointermove', followNearbyPointer);
      window.removeEventListener('scroll', invalidateBounds, true);
      window.removeEventListener('resize', invalidateBounds);
      window.removeEventListener('blur', endDrag);
      document.removeEventListener('pointerleave', clearPointer);
    };
  }, [levels.length, onChoose, showHover, cancelPointerFrame, measure]);

  return <div className="ql-level-scrubber" data-active-level={activeLevel?.number}>
    <nav ref={track} className="ql-level-track" aria-label="Choose any of the 24 levels"
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary) return;
        cancelPointerFrame();
        const index = indexAt(measure(true)!, event.clientX, levels.length);
        dragging.current = event.pointerId;
        lastChoice.current = index;
        event.currentTarget.setPointerCapture(event.pointerId);
        setFocused(null);
        showHover(index);
        onChoose(index);
      }}
      onPointerUp={event => {
        if (dragging.current !== event.pointerId) return;
        cancelPointerFrame();
        const rect = measure(true)!;
        const index = indexAt(rect, event.clientX, levels.length);
        if (lastChoice.current !== index) onChoose(index);
        event.currentTarget.querySelectorAll('button')[index]?.focus({ preventScroll: true });
        dragging.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
        showHover(event.pointerType === 'mouse' && event.clientX >= rect.left - 20 && event.clientX <= rect.right + 20 && event.clientY >= rect.top - 32 && event.clientY <= rect.bottom + 32 ? index : null);
      }}
      onLostPointerCapture={() => { if (dragging.current !== null) { dragging.current = null; cancelPointerFrame(); showHover(null); } }}
      onPointerCancel={() => { dragging.current = null; cancelPointerFrame(); showHover(null); }}
      onPointerLeave={event => { if (dragging.current === null && event.pointerType === 'touch') { cancelPointerFrame(); showHover(null); } }}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(null); }}
      onKeyDown={event => {
        const buttons = [...event.currentTarget.querySelectorAll('button')];
        const from = buttons.indexOf(event.target as HTMLButtonElement);
        if (from < 0) return;
        cancelPointerFrame();
        showHover(null);
        setFocused(event.key === 'Escape' ? null : from);
        if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? levels.length - 1 : (from + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1) + levels.length) % levels.length;
        onChoose(next);
        setFocused(next);
        buttons[next]?.focus({ preventScroll: true });
      }}>
      {levels.map((form, index) => <button key={form.number} type="button"
        className={`ql-level-stop${index === current ? ' is-current' : ''}${index === active ? ' is-active' : ''}${active !== null && Math.abs(index - active) === 1 ? ' is-near' : ''}`}
        aria-label={`Choose level ${form.number}: ${form.title}`} aria-current={index === current ? 'step' : undefined}
        onFocus={event => { if (event.currentTarget.matches(':focus-visible')) setFocused(index); }}
        onClick={event => { if (event.detail === 0) onChoose(index); }}>
        <span className="ql-level-mark" aria-hidden="true"><span className="ql-level-mark-number">{String(form.number).padStart(2, '0')}</span></span>
      </button>)}
    </nav>
  </div>;
}
