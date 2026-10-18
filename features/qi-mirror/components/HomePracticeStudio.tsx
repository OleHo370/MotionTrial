'use client';
import { useId, useState } from 'react';
import Link from 'next/link';
import HomeCardGroup from './HomeCardGroup';
import { useVisibleDecoration } from './HomeMotion';
import InkSurface from './InkSurface';

const modes = [
  { name: 'Step by step', hint: 'Time to pause and repeat', title: 'Stay with\na moment.', copy: 'Watch a short passage. Try it again. Move on when you feel ready.', action: 'Begin step-by-step practice', href: '/qi-mirror/practice?mode=guided&form=1', caption: 'Pause. Repeat. Continue.' },
  { name: 'Full flow', hint: 'Space to keep moving', title: 'Let the movement\nunfold.', copy: 'Follow the complete reference in one flow. Pause whenever you need.', action: 'Begin whole-form practice', href: '/qi-mirror/practice?mode=forms&routine=original24', caption: 'One movement. One continuous flow.' },
];

/** An abstract rhythm study, never source poses or an observation trace. */
function RhythmStudy({ mode }: { mode: number }) {
  const { ref, visible } = useVisibleDecoration();
  return <div ref={ref} className="practice-study" data-mode={mode} data-visible={visible}>
    <div className="practice-study-visual">
      <InkSurface kind="rhythm" mode={mode} />
      <svg className="practice-study-art" viewBox="0 0 680 420" fill="none" aria-hidden="true">
        <g className="practice-study-focus" stroke="#637b67" strokeWidth=".8"><path d="M218 80h-15v20m0 220v20h15M437 80h15v20m0 220v20h-15" /><path d="M203 110v200m249-200v200" strokeDasharray="1 7" opacity=".25" /></g>
        <g className="practice-study-flow" stroke="#69806c" strokeWidth="1"><path d="M37 350h606" opacity=".25" /><path d="m632 345 11 5-11 5" /><circle cx="37" cy="350" r="3" fill="#69806c" /></g>
      </svg>
    </div>
    <div className="practice-study-caption"><span>{modes[mode].caption}</span><span>Rhythm illustration</span></div>
  </div>;
}

export default function HomePracticeStudio() {
  const [mode, setMode] = useState(0);
  const id = useId();
  return <HomeCardGroup className="home-stage-frame home-practice-studio">
    <div className="practice-studio-heading"><h2 id="practice-title">Find your rhythm.</h2><p>A single passage.<br />Or the whole movement.</p></div>
    <div className="practice-studio-composition" data-practice-mode={mode === 0 ? 'guided' : 'flow'}>
      <div className="practice-studio-controls" role="tablist" aria-label="Practice rhythm">
        {modes.map((item, index) => <button key={item.name} className="practice-mode" type="button" role="tab" id={id + '-tab-' + index} aria-selected={mode === index} aria-controls={id + '-panel'} tabIndex={mode === index ? 0 : -1} onClick={() => setMode(index)} onKeyDown={event => {
          if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - mode;
          setMode(next); document.getElementById(id + '-tab-' + next)?.focus();
        }}><span className="practice-mode-name">{item.name}<span aria-hidden="true">↗</span></span><span className="practice-mode-hint">{item.hint}</span></button>)}
      </div>
      <RhythmStudy mode={mode} />
      <div className="practice-studio-copy" role="tabpanel" id={id + '-panel'} aria-labelledby={id + '-tab-' + mode} tabIndex={0}>
        <div className="practice-studio-message" key={mode}><h3>{modes[mode].title}</h3><p>{modes[mode].copy}</p></div>
        <Link className="practice-studio-entry" href={modes[mode].href}><span>{modes[mode].action}</span><span aria-hidden="true">↗</span></Link>
      </div>
    </div>
  </HomeCardGroup>;
}
