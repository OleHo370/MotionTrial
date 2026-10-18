import Link from 'next/link';
import './isolation.css';
import './host-links.css';

export default function QiMirrorLayout({ children }: { children: React.ReactNode }) {
  return <div data-qimirror-root className="qi-mirror-scope">
    {children}
    <details className="qi-host-links">
      <summary>MotionTrial pages</summary>
      <nav aria-label="Existing MotionTrial pages">
        <Link href="/">Existing workspace</Link>
        <Link href="/practice">Existing practice</Link>
        <a href="http://127.0.0.1:8766/first-three.html">Opening practice · USB ↗</a>
        <Link href="/qi-mirror">Qi Mirror exhibition</Link>
        <Link href="/qi-mirror/cover">Original ink cover</Link>
      </nav>
    </details>
  </div>;
}
