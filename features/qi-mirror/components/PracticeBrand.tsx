import Link from 'next/link';
import QiSymbol from './QiSymbol';

export default function PracticeBrand() {
  return <Link className="practice-brand" href="/qi-mirror/levels" aria-label="Qi mirror — level selection">
    <QiSymbol className="practice-brand-symbol" />
    <span className="practice-brand-qi" lang="zh">氣</span>
    <span className="practice-brand-word">mirror</span>
  </Link>;
}
