'use client';

import Link from 'next/link';
import { memo, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import QiSymbol from './QiSymbol';
import LevelScrubber from './LevelScrubber';
import { chineseLevel, nearestLevelStep, romanLevel, wheelSlot, wrapLevel, WHEEL_STEP_DEGREES, type GameLevel } from '../lib/level-selection';

const WheelArtwork = memo(function WheelArtwork() {
  const polygon = (radius: number) => Array.from({ length: 8 }, (_, i) => {
    const angle = i * Math.PI / 4;
    return `${500 + Math.cos(angle) * radius},${500 + Math.sin(angle) * radius}`;
  }).join(' ');
  return <svg className="ql-wheel-art" viewBox="0 0 1000 1000" fill="none" aria-hidden="true">
    <polygon points={polygon(481)} stroke="currentColor" strokeWidth=".6" opacity=".22" />
    <polygon points={polygon(460)} stroke="currentColor" strokeWidth="1.5" opacity=".55" />
    <polygon points={polygon(324)} stroke="currentColor" strokeWidth=".7" opacity=".35" />
    <circle cx="500" cy="500" r="260" stroke="currentColor" strokeWidth=".6" opacity=".18" />
    <circle cx="500" cy="500" r="202" stroke="currentColor" strokeWidth=".6" opacity=".25" />
    {[7, 3, 5, 1, 0, 4, 2, 6].map((pattern, slot) => <g key={slot} transform={`rotate(${slot * 45} 500 500)`}>
      <path d="M674 80 626 196" stroke="currentColor" strokeWidth=".6" opacity=".26" />
      {[0, 1, 2].map(row => (pattern & (1 << row))
        ? <path key={row} d={`M467 ${265 + row * 14}h66`} stroke="currentColor" strokeWidth="7" />
        : <path key={row} d={`M467 ${265 + row * 14}h26m14 0h26`} stroke="currentColor" strokeWidth="7" />)}
      <circle cx="500" cy="40" r="3" fill="currentColor" opacity=".6" />
    </g>)}
  </svg>;
});
const WheelCenter = memo(QiSymbol);

const LevelInkTitle = memo(function LevelInkTitle({ title }: { title: string }) {
  const initialTitle = useRef(title);
  const shownTitle = useRef(title);
  const first = useRef<HTMLSpanElement>(null);
  const second = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    // Coalesce quick scrubber passes. Two permanent layers keep this ornament
    // bounded, and interrupted fades continue from the visible layer's opacity.
    const pending = setTimeout(() => {
      const layers = [first.current, second.current];
      if (!layers[0] || !layers[1] || shownTitle.current === title) return;
      const opacity = layers.map(layer => Number(getComputedStyle(layer!).opacity));
      const outgoingIndex = opacity[0] >= opacity[1] ? 0 : 1;
      const outgoing = layers[outgoingIndex]!;
      const incoming = layers[1 - outgoingIndex]!;
      const outgoingTransform = getComputedStyle(outgoing).transform;
      layers.forEach(layer => layer!.getAnimations().forEach(animation => animation.cancel()));
      outgoing.dataset.active = 'false';
      incoming.dataset.active = 'true';
      incoming.textContent = title;
      incoming.style.setProperty('--ink-characters', String([...title].length));
      shownTitle.current = title;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      outgoing.animate([
        { opacity: opacity[outgoingIndex], transform: outgoingTransform },
        { opacity: 0, transform: 'translateY(-12px)' },
      ], { duration: 320, easing: 'cubic-bezier(.22,.8,.26,1)', fill: 'forwards' });
      incoming.animate([
        { opacity: 0, transform: 'translateY(14px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ], { duration: 400, easing: 'cubic-bezier(.22,.8,.26,1)', fill: 'forwards' });
    }, 64);
    return () => clearTimeout(pending);
  }, [title]);

  useEffect(() => {
    const layers = [first.current, second.current];
    return () => layers.forEach(layer => layer?.getAnimations().forEach(animation => animation.cancel()));
  }, []);

  return <div className="ql-ink-title" lang="zh-CN" aria-hidden="true">
    <span ref={first} className="ql-ink-title-layer" data-active="true" style={{ '--ink-characters': [...initialTitle.current].length } as CSSProperties}>{initialTitle.current}</span>
    <span ref={second} className="ql-ink-title-layer" data-active="false" />
  </div>;
});

function LevelPreview({ level }: { level: GameLevel }) {
  const [previewReady, setPreviewReady] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const autoplayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sourceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadSource = () => {
    if (sourceTimer.current !== null) clearTimeout(sourceTimer.current);
    sourceTimer.current = null;
    const preview = video.current;
    if (preview && !preview.getAttribute('src')) preview.src = level.src;
    return preview;
  };

  const cancelAutoplay = () => {
    if (autoplayTimer.current !== null) clearTimeout(autoplayTimer.current);
    autoplayTimer.current = null;
  };
  const handlePlayError = (error: unknown) => {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (error instanceof DOMException && error.name === 'NotAllowedError') setPlaybackBlocked(true);
    else setVideoError(true);
  };

  useEffect(() => {
    const preview = video.current;
    let disposed = false;
    // Skip loading/decoding clips that the pointer only passes over. The dwell
    // deadline stays two seconds from selection, independent of this short wait.
    sourceTimer.current = setTimeout(loadSource, 160);
    autoplayTimer.current = setTimeout(() => {
      autoplayTimer.current = null;
      if (!preview || preview.error) return;
      void preview.play().catch(error => { if (!disposed) handlePlayError(error); });
    }, 2000);
    return () => {
      disposed = true;
      if (sourceTimer.current !== null) clearTimeout(sourceTimer.current);
      cancelAutoplay();
      preview?.pause();
      preview?.removeAttribute('src');
      preview?.load();
    };
  }, []);

  const togglePreview = async () => {
    cancelAutoplay();
    const preview = loadSource();
    if (!preview) return;
    if (!preview.paused) preview.pause();
    else {
      try { await preview.play(); }
      catch (error) { handlePlayError(error); }
    }
  };

  return <>
    <div className="ql-video-frame">
      <video ref={video} preload="auto" muted playsInline loop controls={previewReady} aria-label={`Level ${level.number} preview: ${level.title}`}
        onCanPlay={() => setPreviewReady(true)}
        onPlay={() => { cancelAutoplay(); setPlaybackBlocked(false); }}
        onPause={cancelAutoplay}
        onError={() => { cancelAutoplay(); setVideoError(true); }} />
      <span className="ql-video-corner" aria-hidden="true" />
    </div>
    {videoError ? <p className="ql-video-status" role="status">Preview unavailable. <button type="button" onClick={() => { setVideoError(false); setPreviewReady(false); video.current?.load(); void togglePreview(); }}>Retry</button></p> : <p className="ql-video-caption"><span>{playbackBlocked ? 'Use the video controls to play' : 'Original-speed preview'} <span lang="zh-CN">· 原速示范</span></span><span>{level.durationSeconds.toFixed(1)}s</span></p>}
  </>;
}

export default function LevelSelection({ levels }: { levels: GameLevel[] }) {
  const [step, setStep] = useState(0);
  const wheel = useRef<HTMLDivElement>(null);
  const current = wrapLevel(step), level = levels[current];

  useEffect(() => {
    const target = wheel.current;
    if (!target) return;
    let total = 0, lastDirection = 0, lastAccepted = -Infinity;
    const turn = (event: WheelEvent) => {
      if (event.ctrlKey) return; // Preserve the browser's pinch-to-zoom gesture.
      if (!(event.target instanceof Element) || !event.target.closest('.ql-wheel-rotor')) return;
      const raw = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      if (!raw) return;
      event.preventDefault();
      const direction = Math.sign(raw), now = performance.now();
      if (now - lastAccepted < 260) return;
      if (direction !== lastDirection) total = 0;
      lastDirection = direction;
      total += raw * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? target.clientHeight : 1);
      if (Math.abs(total) >= 24) {
        setStep(value => value + direction);
        lastAccepted = now;
        total = 0;
      }
    };
    target.addEventListener('wheel', turn, { passive: false });
    return () => target.removeEventListener('wheel', turn);
  }, []);

  const choose = useCallback((index: number) => setStep(value => nearestLevelStep(value, index)), []);

  return <div className="qi-landing ql-page" lang="en">
    <div className="ql-scenery" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/qi-mirror/landing-art/ink-landscape.jpg" alt="" />
    </div>
    <div className="ql-main">
      <section className="ql-selection" aria-labelledby="ql-title">
        <div className="ql-introduction"><Link href="/qi-mirror" className="ql-home-heading" aria-label="Back to home"><span className="ql-overline">The twenty-four forms</span><h1 id="ql-title">Choose your form<span>Follow the wheel. Find your flow.</span></h1></Link></div>
        <div className="ql-wheel-window" ref={wheel} tabIndex={0} role="group" aria-label="24-form level wheel. Scroll or use arrow keys to choose a level."
          onKeyDown={event => {
            if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
              event.preventDefault();
              if (event.key === 'Home') choose(0);
              else if (event.key === 'End') choose(23);
              else setStep(value => value + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1));
            }
          }}>
          <div className="ql-wheel-rotor" data-wheel-step={step} data-selected-level={level.number} style={{ '--wheel-turn': `${-step * WHEEL_STEP_DEGREES}deg` } as CSSProperties}>
            <WheelArtwork />
            <WheelCenter className="ql-wheel-center" trigrams={false} />
            {Array.from({ length: 8 }, (_, slot) => {
              const item = wheelSlot(step, slot), form = levels[item.index];
              return <div key={slot} className="ql-wheel-slot" style={{ transform: `rotate(${slot * 45}deg) translateX(calc(var(--wheel-size) * .393))` }}>
                <button type="button" className={`ql-form${item.selected ? ' is-selected' : ''}`} tabIndex={-1}
                  style={{ transform: `translate(-50%, -50%) rotate(${(step - slot) * 45}deg)` }}
                  aria-label={`Level ${form.number}: ${form.chineseTitle} · ${form.title}`} aria-pressed={item.selected} onClick={() => choose(item.index)}>
                  <span className="ql-form-numeral" lang="en">{romanLevel(form.number)}</span>
                  <span>Level {String(form.number).padStart(2, '0')}</span><small lang="zh-CN">{form.chineseTitle}</small>
                </button>
              </div>;
            })}
          </div>
          <div className="ql-needle" aria-hidden="true"><span /><i /></div>
          <LevelInkTitle title={level.chineseTitle} />
        </div>
      </section>

      <aside className="ql-preview" aria-labelledby="ql-preview-title">
        <div className="ql-preview-head"><span>Form in focus</span><span>{String(level.number).padStart(2, '0')} <i>/</i> 24</span></div>
        <div className="ql-level-copy" aria-live="polite" aria-atomic="true">
          <p className="ql-level-ordinal">Level {String(level.number).padStart(2, '0')}<span lang="zh-CN">{chineseLevel(current)}</span></p>
          <h2 id="ql-preview-title" className={level.title.length > 34 ? 'ql-long-title' : undefined}>{level.title}</h2><p className="ql-chinese-title" lang="zh-CN">{level.chineseTitle}</p>
        </div>
        <LevelPreview key={level.src} level={level} />
        <Link className="ql-enter" href={level.number === 1 ? '/qi-mirror/enter?form=1&lesson=opening' : `/qi-mirror/enter?form=${level.number}`} prefetch={false}><span>Begin this form<small lang="zh-CN">习此一式</small></span><span aria-hidden="true">↗</span></Link>
        <p className="ql-preview-note">Watch the form. Then make it your own.<br /><span lang="zh-CN">先观其形，再循其势。</span></p>
      </aside>
    </div>
    <footer className="ql-footer"><div className="ql-wheel-navigation">
      <div className="ql-turn-controls"><button type="button" onClick={() => setStep(value => value - 1)} aria-label="Previous level">←</button><span><span>Scroll to choose a form</span><small lang="zh-CN">每转一格，遇见一式</small></span><button type="button" onClick={() => setStep(value => value + 1)} aria-label="Next level">→</button></div>
    </div><LevelScrubber levels={levels} current={current} onChoose={choose} /></footer>
  </div>;
}
