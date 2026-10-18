'use client';

import Link from 'next/link';
import BambooProgress from './BambooProgress';

type BambooLoadingScreenProps = {
  progress: number;
  error?: string;
  onRetry?: () => void;
};

/** Shared presentation for actual lesson preparation, without simulated progress. */
export default function BambooLoadingScreen({ progress, error, onRetry }: BambooLoadingScreenProps) {
  const value = Number.isFinite(progress) ? Math.round(Math.min(100, Math.max(0, progress))) : 0;
  return <div className="qi-landing qi-loading" lang="en">
    <div className="qi-loading-landscape" aria-hidden="true" />
    <div className="qi-loading-bamboo"><BambooProgress progress={value} /></div>
    <section className="qi-loading-main" aria-label="Loading the selected form">
      <p className="qi-loading-word">Loading</p>
      <div className="qi-loading-progress" role="progressbar" aria-label="Lesson preparation" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-valuetext={error ? `Loading stopped at ${value} percent` : `${value} percent`}>
        <span aria-hidden="true">{String(value).padStart(2, '0')}<small>%</small></span>
      </div>
      {error && <div className="qi-loading-error"><p role="alert">{error}</p>{onRetry && <button type="button" onClick={onRetry}>Try again</button>}<Link href="/qi-mirror/levels">Back to forms</Link></div>}
    </section>
  </div>;
}
