import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
export const metadata: Metadata = { title: 'MotionTrial · Recording review', description: 'A local workspace for movement recording quality and human review.' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><a className="skip-link" href="#main">Skip to content</a><div className="app-shell">
    <aside className="sidebar"><Link className="brand" href="/"><span className="brand-mark">m<span>t</span></span><span>MotionTrial<small>RECORD. UNDERSTAND. REVIEW.</small></span></Link>
      <div className="workspace-label">LOCAL RESEARCH WORKSPACE</div><nav aria-label="Main navigation"><Link href="/" className="nav-link"><span aria-hidden="true">▤</span> Review workspace</Link><Link href="/assess/new" className="nav-link"><span aria-hidden="true">◉</span> New assessment</Link><Link href="/about" className="nav-link"><span aria-hidden="true">ⓘ</span> Methods & data</Link></nav>
      <div className="sidebar-bottom"><span className="local-dot"/> Local server <p>Demonstration only.<br/>Your recordings stay on this server until you delete them.</p><span className="badge">Prototype · v0.1</span></div>
    </aside><div className="main-shell"><header className="topbar"><span className="workspace-name">Movement assessment <span>/</span> Seated upper limb</span><span className="badge"><span className="local-dot"/> Local demo · no accounts</span></header><main id="main" tabIndex={-1}>{children}</main><footer>MotionTrial <span>Capture quality supports human review. It does not measure movement ability.</span></footer></div></div></body></html>;
}
