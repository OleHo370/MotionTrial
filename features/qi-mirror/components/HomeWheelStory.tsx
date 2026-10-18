'use client';
import { useId, useState, type CSSProperties } from 'react';
import QiSymbol from './QiSymbol';
import InkSurface from './InkSurface';
import HomeFormationCanvas from './HomeFormationCanvas';
import '@/app/qi-mirror/styles/home-formation.css';
import { HomeMotionToggle, useVisibleDecoration } from './HomeMotion';

const chapters = [
  { name: 'Choose', word: 'Begin', title: 'A single form.\nA place to start.', text: 'Explore the 24 forms. Find a beginning of your own.', note: 'The collection is your starting point.' },
  { name: 'Watch', word: 'Notice', title: 'A quiet moment\nto notice.', text: 'Look before you move. A real reference sets the rhythm in practice.', note: 'Watch first. Let the movement unfold.' },
  { name: 'Follow', word: 'Flow', title: 'Find a rhythm\nthat feels yours.', text: 'Follow a passage, pause, and begin again. Make room for your own pace.', note: 'There is no rush to move on.' },
  { name: 'Ink', word: 'Express', title: 'Movement passes.\nA mark remains.', text: 'Imagine a gesture becoming a brushstroke: a trace of motion, an invitation to explore.', note: 'An artistic response, not a movement score.' },
];

function ExperienceWheel({ step, angle }: { step: number; angle: number }) {
  const id = useId();
  const { ref, visible } = useVisibleDecoration();
  return <div ref={ref} className="home-wheel" data-visible={visible} data-phase={step} data-formation={step === 1 || step === 2} style={{ '--wheel-turn': angle + 'deg' } as CSSProperties}>
    <svg className="home-wheel-dial" viewBox="0 0 560 560" fill="none" aria-hidden="true">
      <defs>
        <radialGradient id={id + '-haze'}><stop stopColor="#b9c9a4" stopOpacity=".13" /><stop offset=".65" stopColor="#9bbda7" stopOpacity=".04" /><stop offset="1" stopColor="#8db09d" stopOpacity="0" /></radialGradient>
      </defs>
      <circle className="home-wheel-haze home-wheel-living" cx="280" cy="280" r="254" fill={'url(#' + id + '-haze)'} />
      <circle className="home-wheel-rim" cx="280" cy="280" r="241" />
      <circle className="home-wheel-rim home-wheel-inner-rim" cx="280" cy="280" r="188" />
      <g className="home-wheel-ticks home-wheel-living">{Array.from({ length: 48 }, (_, index) => <path key={index} d={index % 6 === 0 ? 'M280 58v13' : 'M280 62v5'} transform={'rotate(' + index * 7.5 + ' 280 280)'} />)}</g>
      <g className="home-wheel-geometry"><g className="home-wheel-geometry-drift home-wheel-living"><rect x="120" y="120" width="320" height="320" transform="rotate(22.5 280 280)" /><rect x="120" y="120" width="320" height="320" transform="rotate(67.5 280 280)" /><circle cx="280" cy="280" r="132" strokeDasharray="1 11" /></g></g>
      <g className="home-wheel-selector"><path d="M487.9 158A241 241 0 0 1 487.9 402" /><circle cx="521" cy="280" r="6" /><path className="home-wheel-pointer" d="M500 275l-8 5 8 5" /></g>
      <g className="home-wheel-chapter-marks"><text x="547" y="284" textAnchor="middle" data-active={step === 0}>01</text><text x="280" y="552" textAnchor="middle" data-active={step === 1}>02</text><text x="13" y="284" textAnchor="middle" data-active={step === 2}>03</text><text x="280" y="17" textAnchor="middle" data-active={step === 3}>04</text></g>
    </svg>
    <HomeFormationCanvas phase={step} visible={visible} />
    <InkSurface kind="wheel" active={step === 3} />
    <div className="home-wheel-core" aria-hidden="true"><QiSymbol className="home-wheel-symbol" /></div>
    <div className="home-wheel-word" key={step} aria-hidden="true">{chapters[step].word}</div>
  </div>;
}

/** One persistent wheel. Selection is immediate; animation never owns state. */
export default function HomeWheelStory() {
  const id = useId();
  const [{ step, angle }, setChapter] = useState({ step: 0, angle: 0 });
  const select = (next: number) => setChapter(previous => {
    let delta = (next - previous.step + 4) % 4;
    if (delta > 2) delta -= 4;
    return { step: next, angle: previous.angle + delta * 90 };
  });
  return <div className="home-exhibit" data-demo-stage={chapters[step].name.toLowerCase()} style={{ '--chapter': step } as CSSProperties}>
    <div className="home-exhibit-heading"><span>Inside the experience</span><span>Turn a moment into movement.</span></div>
    <div className="home-exhibit-tabs" role="tablist" aria-label="Experience chapters">
      {chapters.map((item, index) => <button className="home-exhibit-tab" type="button" role="tab" key={item.name} id={id + '-tab-' + index} aria-selected={step === index} aria-controls={id + '-panel'} tabIndex={step === index ? 0 : -1} onClick={() => select(index)} onKeyDown={event => {
        if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? 3 : (index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + 4) % 4;
        select(next); document.getElementById(id + '-tab-' + next)?.focus();
      }}><span className="home-exhibit-index">0{index + 1}</span><span>{item.name}</span><span className="home-exhibit-tab-mark" aria-hidden="true">↗</span></button>)}
    </div>
    <div className="home-exhibit-scene" id={id + '-panel'} role="tabpanel" aria-labelledby={id + '-tab-' + step} tabIndex={0}>
      <ExperienceWheel step={step} angle={angle} />
      <div className="home-exhibit-copy"><div className="home-exhibit-chapter" key={step}><span className="home-exhibit-count">0{step + 1}<span> / 04</span></span><h3>{chapters[step].title}</h3><p>{chapters[step].text}</p><div className="home-exhibit-note"><span aria-hidden="true" />{chapters[step].note}</div></div>
        <button className="home-exhibit-next" type="button" onClick={() => select((step + 1) % 4)}><span>{step === 3 ? 'Return to the beginning' : 'Next: ' + chapters[step + 1].name}</span><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" /></svg></button>
      </div>
    </div>
    <div className="home-exhibit-foot"><span>Interactive illustration. No camera or movement score.</span><HomeMotionToggle /></div>
  </div>;
}
