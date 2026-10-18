import type { Metadata } from 'next';
import Link from 'next/link';
import QiSymbol from '@/features/qi-mirror/components/QiSymbol';
import '../styles/homepage-base.css';
import '../styles/landing.css';

export const metadata: Metadata = {
  title: '氣mirror · 动静之间，以身为镜',
  description: '在水墨山水之间，开启你的太极练习。慢慢起势，循着自己的节奏。',
};

function Brush({ intro = false }: { intro?: boolean }) {
  return <svg className={intro ? 'qi-brush qi-brush-intro' : 'qi-brush qi-brush-hover'} viewBox="0 0 340 94" preserveAspectRatio="none" aria-hidden="true">
    <path d="M13 48c9-14 24-16 46-18 35-7 65-3 100-5 40-2 75 1 112 4 22 2 37 6 55 13l-13 8 9 5-18 6c-41 9-77 7-115 9-41 1-73-2-109-1-23-1-47-5-68-12l13-4Z" fill="currentColor" />
    <path d="M22 37c66-16 130-16 192-9l72 7M23 61c65 12 119 10 174 10l95-8M34 67l48 6 40-1" stroke="currentColor" strokeWidth="1.6" opacity=".36" />
    <path d="m35 34 44-2m-24 9 28-1m179 17 32-5m-153-23 40 2m-20 39 32-3" stroke="#f7f6f2" strokeWidth=".85" opacity=".28" />
    <circle cx="324" cy="41" r="1.8" fill="currentColor" opacity=".5" />
    <circle cx="17" cy="73" r="1.3" fill="currentColor" opacity=".45" />
  </svg>;
}

export default function Home() {
  return <div className="qi-landing" lang="zh-CN">
    <div className="qi-scenery" aria-hidden="true">
      {/* Locally served museum Open Access image; provenance is kept with the asset. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="qi-landscape" src="/qi-mirror/landing-art/ink-landscape.jpg" alt="" fetchPriority="high" />
      <div className="qi-mist" />
      <svg className="qi-paper" width="100%" height="100%"><filter id="qi-paper-grain"><feTurbulence type="fractalNoise" baseFrequency=".78" numOctaves="3" stitchTiles="stitch" /><feColorMatrix type="saturate" values="0" /></filter><rect width="100%" height="100%" filter="url(#qi-paper-grain)" opacity=".13" /></svg>
    </div>

    <header className="qi-masthead">
      <Link className="qi-wordmark" href="/qi-mirror" aria-label="氣mirror 首页"><QiSymbol className="qi-symbol qi-symbol-small" /><span><span lang="zh-CN">氣</span><span className="qi-wordmark-divider" /><span lang="en">MIRROR</span></span></Link>
      <span className="qi-edition">一 呼 一 吸<span />一 动 一 静</span>
      <Link className="qi-workspace-link" href="/">研究工作台 <span aria-hidden="true">↗</span></Link>
    </header>

    <section className="qi-hero" aria-labelledby="qi-title">
      <div className="qi-emblem"><QiSymbol className="qi-symbol" /></div>
      <p className="qi-eyebrow">以 身 为 镜 · 以 气 入 境</p>
      <h1 id="qi-title" className="qi-title" aria-label="氣mirror"><span className="qi-title-character" aria-hidden="true">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/qi-mirror/landing-art/qi-brush-mark.png" alt="" width="1254" height="1254" fetchPriority="high" /></span><span className="qi-title-mirror" aria-hidden="true">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/qi-mirror/landing-art/mirror-brush-word.png" alt="" width="2152" height="731" fetchPriority="high" /></span></h1>
      <p className="qi-subtitle">在动静之间，遇见自己的节奏。</p>
      <div className="qi-entry">
        <Brush intro />
        <Link href="/qi-mirror/levels" className="qi-start" aria-label="开始游戏">
          <Brush />
          <span className="qi-start-label">开始游戏</span><span className="qi-start-arrow" aria-hidden="true">↗</span>
        </Link>
      </div>
      <span className="qi-entry-caption">起 势 ， 从 此 刻</span>
    </section>

    <footer className="qi-footer">
      <span className="qi-footer-note">山水有形，行气无界。</span>
      <span className="qi-footer-rule" />
    </footer>
  </div>;
}
