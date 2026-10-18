'use client';

import { memo, useId } from 'react';

type BambooProgressProps = {
  progress: number;
};

/** Decorative, locally drawn ink bamboo. The surrounding loader owns its label. */
function BambooProgress({ progress }: BambooProgressProps) {
  const clipId = useId();
  const value = Number.isFinite(progress) ? Math.min(100, Math.max(0, progress)) : 0;
  const revealHeight = 28 + value * 5.58;

  return <svg
    className="qi-bamboo-progress"
    viewBox="0 0 170 600"
    width="170"
    height="600"
    preserveAspectRatio="xMidYMax meet"
    fill="none"
    aria-hidden="true"
    focusable="false"
  >
    <defs>
      <clipPath id={clipId}>
        <rect
          className="qi-bamboo-reveal"
          x="0"
          y="0"
          width="170"
          height="600"
          style={{ transform: `translateY(${590 - revealHeight}px)` }}
        />
      </clipPath>
    </defs>

    <g fill="currentColor" opacity=".12">
      <path d="M52 588c18-3 47-4 67-1-22 4-47 5-67 1Z" />
      <path d="m63 592 42-1-21 3Z" />
    </g>

    <g clipPath={`url(#${clipId})`}>
      {/* Each irregular taper is a separate ink stroke, with paper left at the joints. */}
      <g fill="currentColor">
        <path d="m83 586 1-54 10-1-1 54-5 4Z" opacity=".87" />
        <path d="m84 527-.3-54 10-1-.7 55-5 2Z" opacity=".93" />
        <path d="m84 468 .5-55 9-1-.3 56-5 2Z" opacity=".85" />
        <path d="m84.5 408-.2-55 9-1 .2 56-5 2Z" opacity=".94" />
        <path d="m84.5 348 .4-55 8.5-1-.2 56-4.5 2Z" opacity=".84" />
        <path d="m85 288-.1-54 8.3-1 .1 55-4.3 2Z" opacity=".92" />
        <path d="m85 229 .5-54 7.5-1-.1 55-4 2Z" opacity=".85" />
        <path d="m85.5 170 .1-53 7.1-1 .3 54-4 2Z" opacity=".93" />
        <path d="m86 112 .8-52 5.6-1 .3 53-3.3 2Z" opacity=".85" />
        <path d="m87 55 1-36 2-8 2.3 43-3 3Z" opacity=".9" />
      </g>

      <g stroke="currentColor" strokeLinecap="round">
        <g strokeWidth="2" opacity=".9">
          <path d="m81 531 7-2 8 1m-14-59 6-2 8 1m-14-60 7-2 7 1m-14-60 6-2 8 1m-14-60 6-2 8 1m-14-59 6-2 8 1m-13-59 6-2 7 1m-13-58 6-2 7 1m-12-57 5-2 7 1" />
        </g>

        <g strokeWidth="1.2" opacity=".77">
          <path d="M89 471c-16-18-31-27-48-31m19 11c-3-10-8-18-15-24M90 351c14-18 29-27 47-31m-27 15c3-11 8-20 15-28M89 232c-13-17-28-26-45-29m19 9c-3-9-7-17-14-25M90 118c11-15 24-23 39-26m-22 11c3-9 7-16 12-22" />
        </g>
      </g>

      <g fill="currentColor">
        <path d="M66 454c-10-4-17-13-20-25 10 5 16 13 20 25Zm-11-9c-11-1-22-7-28-16 12 0 21 6 28 16Zm-4-2c-11-2-23 2-32 9 12 1 22-2 32-9Zm11 10c-9 2-16 10-19 20 10-5 16-11 19-20Z" opacity=".79" />
        <path d="M109 336c-1-11 3-22 9-30 1 11-2 21-9 30Zm11-9c5-9 15-15 25-15-6 9-14 14-25 15Zm10-4c9-3 20-1 28 5-11 1-20-1-28-5Zm-15 9c11 0 22 5 28 14-11-2-20-7-28-14Z" opacity=".86" />
        <path d="M68 216c-10-4-17-13-20-25 10 6 16 14 20 25Zm-11-8c-11-1-21-7-27-15 12 1 21 6 27 15Zm-5-2c-11-1-22 3-30 10 12 0 21-3 30-10Zm10 7c-8 3-15 11-18 20 10-5 15-11 18-20Z" opacity=".8" />
        <path d="M107 104c-1-10 2-20 8-28 1 11-2 20-8 28Zm10-8c5-8 13-13 22-13-5 8-13 12-22 13Zm6-2c9-2 19 0 26 6-11 1-18-1-26-6Z" opacity=".86" />
      </g>

      {/* Fine breaks keep the trunks dry-brushed without expensive texture filters. */}
      <g stroke="#f5f3ec" strokeWidth=".7" opacity=".5">
        <path d="m87 545-.3 22m1-80-.3 18m-.3-76 .3 21m0-81-.2 19m.2-80-.1 22m.2-80-.1 17m.6-74-.1 19m.4-78-.1 17m.5-74-.1 17" />
      </g>
    </g>

    <g
      className="qi-bamboo-shoot"
      fill="currentColor"
      style={{ opacity: Math.max(0, 1 - value / 16) }}
    >
      <path d="M78 587c-1-12 2-24 10-35 7 12 11 23 9 35l-9 3Z" opacity=".92" />
      <path d="M82 571c-6-4-8-10-8-15 7 4 11 8 12 15Zm10 8c1-8 5-14 11-17-1 9-5 14-11 17Z" opacity=".78" />
      <path d="m82 581 9-4m-6-5 5-3" stroke="#f5f3ec" strokeWidth=".8" opacity=".7" />
    </g>
  </svg>;
}

export default memo(BambooProgress);
