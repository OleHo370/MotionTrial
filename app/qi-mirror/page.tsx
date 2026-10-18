import type { Metadata } from 'next';
import Link from 'next/link';
import QiSymbol from '@/features/qi-mirror/components/QiSymbol';
import HomeWheelStory from '@/features/qi-mirror/components/HomeWheelStory';
import HomePracticeStudio from '@/features/qi-mirror/components/HomePracticeStudio';
import HomeDetails from '@/features/qi-mirror/components/HomeDetails';
import HomeCardGroup from '@/features/qi-mirror/components/HomeCardGroup';
import HomeExperienceEntrance from '@/features/qi-mirror/components/HomeExperienceEntrance';
import HomeInkMark from '@/features/qi-mirror/components/HomeInkMark';
import HomeScrollLink from '@/features/qi-mirror/components/HomeScrollLink';
import HomeMotion, { HomeFlow, HomeMotionToggle } from '@/features/qi-mirror/components/HomeMotion';
import './styles/homepage-base.css';
import './styles/home-story.css';
import './styles/home-exhibit.css';
import './styles/home-stage.css';
import './styles/home-practice.css';
import './styles/home-ink.css';
import './styles/home-unified.css';
import './styles/home-experience-entrance.css';
import './styles/home-identity.css';

export const metadata: Metadata = {
  title: 'Qi Mirror — Tai Chi, at your own pace',
  description: 'An interactive exploration of Tai Chi. Choose a form, watch a real demonstration, and find your own rhythm.',
};

export default function Home() {
  return <HomeMotion>
    <header className="home-masthead">
      <Link className="home-wordmark" href="/qi-mirror" aria-label="Qi Mirror home"><QiSymbol className="home-symbol-small" /><span><span lang="zh-CN">氣</span><i />MIRROR</span></Link>
      <nav aria-label="Homepage"><HomeScrollLink href="#experience">The experience</HomeScrollLink><HomeScrollLink href="#idea">The idea</HomeScrollLink></nav>
      <Link className="home-header-entry" href="/qi-mirror/levels">Explore the forms <span aria-hidden="true">↗</span></Link>
    </header>

    <HomeExperienceEntrance>
    <section className="home-scene home-cover" aria-labelledby="home-title">
      <HomeFlow />
      <div className="home-stage-frame home-hero">
        <HomeInkMark />
        <p className="home-heading">Tai Chi,<br />at your own pace.</p>
        <p className="home-intro">Choose a form. Follow a real demonstration.<br />Discover a quieter way to explore movement.</p>
        <div className="home-actions"><Link className="home-primary" href="/qi-mirror/levels"><span>Explore the 24 forms</span><span aria-hidden="true">↗</span></Link><HomeScrollLink className="home-text-link" href="#experience">See how it works <span aria-hidden="true">↓</span></HomeScrollLink></div>
        <p className="home-hero-note">An interactive Tai Chi exhibition prototype</p>
      </div>
      <div className="home-cover-foot"><HomeMotionToggle /><HomeScrollLink href="#experience" aria-label="Scroll to the experience">Scroll to discover <span aria-hidden="true">↓</span></HomeScrollLink></div>
    </section>

    <section id="experience" className="home-scene home-scene-experience" aria-labelledby="experience-title">
      <div className="home-stage-frame home-experience-frame">
        <div className="home-scene-heading"><h2 id="experience-title">One circle. Four ways in.</h2><p>Choose a moment. See where it leads.</p></div>
        <HomeWheelStory />
      </div>
    </section>
    </HomeExperienceEntrance>

    <section id="practice" className="home-scene home-scene-practice" aria-labelledby="practice-title">
      <HomePracticeStudio />
    </section>

    <section id="idea" className="home-scene home-scene-idea" aria-labelledby="culture-title">
      <div className="home-stage-frame home-idea-frame">
        <HomeCardGroup className="home-idea-group">
          <div className="home-idea-art"><HomeFlow variant="culture" /><div className="home-balance-mark" aria-hidden="true"><span lang="zh-CN">動靜相生</span></div></div>
          <div className="home-idea-copy"><h2 id="culture-title">Rooted in Tai Chi.<br />Expressed in ink.</h2><p>A pause gives movement its shape.<br />An empty space gives ink room to breathe.</p><p>Inspired by the continuity of Tai Chi, Qi Mirror invites you to pay attention to movement and imagine its expression in ink.</p><div className="home-idea-details"><HomeDetails kind="culture" /><HomeDetails kind="technology" /></div><p className="home-idea-truth">The homepage wheel is an illustration. Its marks use no camera or movement data.</p></div>
        </HomeCardGroup>
        <div className="home-closing"><span>Begin with a single form.</span><Link className="home-primary" href="/qi-mirror/levels"><span>Explore the 24 forms</span><span aria-hidden="true">↗</span></Link></div>
        <footer className="home-footer"><span>氣 MIRROR</span><p>A movement exploration. An exhibition prototype.</p></footer>
      </div>
    </section>
  </HomeMotion>;
}
