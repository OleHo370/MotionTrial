'use client';
import { useEffect, useId, useRef, useState } from 'react';

export default function HomeDetails({ kind }: { kind: 'culture' | 'technology' }) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const previousOverflow = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [closing, setClosing] = useState(false);
  const restore = () => { if (previousOverflow.current !== null) { document.body.style.overflow = previousOverflow.current; previousOverflow.current = null; } };
  useEffect(() => () => { clearTimeout(timer.current); restore(); }, []);
  const close = () => {
    if (!dialog.current?.open || closing) return;
    setClosing(true);
    const delay = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180;
    timer.current = setTimeout(() => { dialog.current?.close(); restore(); setClosing(false); trigger.current?.focus({ preventScroll: true }); }, delay);
  };
  const open = () => {
    if (!dialog.current || dialog.current.open) return;
    previousOverflow.current = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current.showModal();
  };
  const culture = kind === 'culture';
  return <>
    <button className="home-detail-trigger" type="button" ref={trigger} onClick={open} aria-haspopup="dialog"><span>{culture ? 'Behind the idea' : 'How the preview works'}</span><span aria-hidden="true">+</span></button>
    <dialog className="home-detail-dialog" ref={dialog} aria-labelledby={id + '-title'} data-closing={closing || undefined} onCancel={event => { event.preventDefault(); close(); }} onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]');
      if (!controls?.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }} onClick={event => { if (event.target === dialog.current) { const r = dialog.current.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close(); } }}>
      <div className="home-detail-header"><span>{culture ? 'Culture & expression' : 'About this demonstration'}</span><button type="button" onClick={close} aria-label="Close details">×</button></div>
      <h2 id={id + '-title'}>{culture ? 'Attention, expressed through movement.' : 'An illustration of the experience.'}</h2>
      {culture ? <><p>Tai Chi is a Chinese movement tradition. This exhibition takes inspiration from its continuous transitions, balance and shifts between stillness and movement.</p><p>Ink is our visual language for exploring those ideas. Its marks are an artistic response, not a judgement of whether a movement is correct.</p><h3>Space, rhythm and balance</h3><p>The ink washes, paper grain and turning symbol are visual interpretations of movement.</p><p>You can pause decorative motion and scroll effects. The page also follows your reduced-motion preference.</p><p className="home-detail-note">An introduction to exploration, not a substitute for instruction from a qualified teacher.</p></> : <><h3>Four moments, one wheel</h3><p>Choose, Watch, Follow and Ink introduce the experience through an interactive illustration. Select any chapter to turn the wheel; no video or camera is used here.</p><h3>An imagined response</h3><p>The orbits and brushstrokes are visual concepts. They do not come from a person, a recording or movement measurements, and do not represent a successful attempt.</p><h3>A place to practise</h3><p>The form collection leads to step-by-step and whole-form practice with recorded references. Available camera and observation features depend on the connected practice application.</p><p className="home-detail-note">This homepage does not upload video, record you, or produce movement scores or health assessments.</p></>}
    </dialog>
  </>;
}
