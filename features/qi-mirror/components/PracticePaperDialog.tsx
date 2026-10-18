'use client';

import { useEffect, useId, useRef, useState } from 'react';
import QiSymbol from './QiSymbol';

type PracticePaperAction = {
  label: string;
  onChoose: () => void;
  arrow?: string;
};

type PracticePaperDialogProps = {
  heading: string;
  title?: string;
  detail: string;
  actions: PracticePaperAction[];
  onHome?: () => void;
  variant?: 'completion' | 'instructions';
};

/** The same hand-shaped stroke used by the cover's Start game link. */
function PaperBrush({ className }: { className: string }) {
  return <svg className={className} viewBox="0 0 340 94" preserveAspectRatio="none" aria-hidden="true">
    <path d="M13 48c9-14 24-16 46-18 35-7 65-3 100-5 40-2 75 1 112 4 22 2 37 6 55 13l-13 8 9 5-18 6c-41 9-77 7-115 9-41 1-73-2-109-1-23-1-47-5-68-12l13-4Z" fill="currentColor" />
    <path d="M22 37c66-16 130-16 192-9l72 7M23 61c65 12 119 10 174 10l95-8M34 67l48 6 40-1" stroke="currentColor" strokeWidth="1.6" opacity=".36" />
    <path d="m35 34 44-2m-24 9 28-1m179 17 32-5m-153-23 40 2m-20 39 32-3" stroke="#f7f6f2" strokeWidth=".85" opacity=".28" />
    <circle cx="324" cy="41" r="1.8" fill="currentColor" opacity=".5" />
    <circle cx="17" cy="73" r="1.3" fill="currentColor" opacity=".45" />
  </svg>;
}

/** Shared modal shell; callers decide what an action does after the paper fades. */
export default function PracticePaperDialog({ heading, title, detail, actions, onHome, variant = 'completion' }: PracticePaperDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const acted = useRef(false);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [actionError, setActionError] = useState(false);
  const headingId = useId();
  const detailId = useId();

  useEffect(() => {
    const modal = dialog.current;
    if (!modal) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (!modal.open) modal.showModal();
    modal.focus({ preventScroll: true });
    return () => {
      if (exitTimer.current) clearTimeout(exitTimer.current);
      modal.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  function choose(action: () => void) {
    if (acted.current) return;
    acted.current = true;
    setBusy(true);
    setLeaving(true);
    setActionError(false);
    const finish = () => {
      exitTimer.current = undefined;
      try {
        action();
      } catch {
        // Restore the available actions if the parent cannot complete one.
        acted.current = false;
        setBusy(false);
        setLeaving(false);
        setActionError(true);
      }
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
    else exitTimer.current = setTimeout(finish, 520);
  }

  return <dialog ref={dialog} className={`practice-completion-dialog${variant === 'instructions' ? ' practice-instructions-dialog' : ''}`} data-stage={leaving ? 'leaving' : 'entered'} aria-labelledby={headingId} aria-describedby={detailId} tabIndex={-1} onCancel={event => event.preventDefault()}>
    <div className="practice-completion-paper">
      <div className="practice-completion-reveal">
        <div className="practice-completion-surface">
          {/* The transparent texture supplies the paper's actual fibrous edge. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="practice-completion-paper-art" src="/qi-mirror/landing-art/completion-paper-organic-v2.png" alt="" aria-hidden="true" draggable={false} fetchPriority="high" />
          <div className="practice-completion-content">
            <QiSymbol className="practice-completion-symbol" />
            <div className="practice-completion-heading">
              <PaperBrush className="practice-completion-stroke" />
              <h2 id={headingId}>{heading}</h2>
            </div>
            {title && <p className="practice-completion-form">{title}</p>}
            <p id={detailId} className="practice-completion-detail">{detail}</p>
            <div className="practice-completion-actions">
              {actions.map(action => <button key={action.label} type="button" className="practice-completion-button" onClick={() => choose(action.onChoose)} disabled={busy}>
                <PaperBrush className="practice-completion-button-brush" />
                <span>{action.label}</span>
                {action.arrow && <span className="practice-completion-arrow" aria-hidden="true">{action.arrow}</span>}
              </button>)}
            </div>
            {onHome && <button type="button" className="practice-completion-home" onClick={() => choose(onHome)} disabled={busy}>Back to home</button>}
            {actionError && <p className="practice-completion-error" role="alert">Please try again.</p>}
          </div>
        </div>
      </div>
    </div>
  </dialog>;
}
