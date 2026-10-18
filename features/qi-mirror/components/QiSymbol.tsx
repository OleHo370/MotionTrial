type QiSymbolProps = {
  className?: string;
  trigrams?: boolean;
};

/** A shared taiji symbol with contrasting eyes inside each yin-yang fish. */
export default function QiSymbol({ className, trigrams = true }: QiSymbolProps) {
  return <svg className={className} viewBox="0 0 200 200" fill="none" aria-hidden="true">
    {trigrams && <>
      <circle cx="100" cy="100" r="77" stroke="currentColor" strokeWidth="0.5" opacity=".22" />
      {[7, 3, 5, 1, 0, 4, 2, 6].map((pattern, index) => <g key={pattern} transform={`rotate(${index * 45} 100 100)`}>
        {[0, 1, 2].map(row => (pattern & (1 << (2 - row))) ?
          <path key={row} d={`M89 ${28 + row * 5}h22`} stroke="currentColor" strokeWidth="2.3" /> :
          <path key={row} d={`M89 ${28 + row * 5}h8m6 0h8`} stroke="currentColor" strokeWidth="2.3" />)}
      </g>)}
    </>}
    <circle cx="100" cy="100" r="43" fill="currentColor" />
    <path d="M100 57a43 43 0 0 1 0 86Z" fill="#f7f6f2" />
    <circle cx="100" cy="78.5" r="21.5" fill="#f7f6f2" />
    <circle cx="100" cy="121.5" r="21.5" fill="currentColor" />
    <circle cx="100" cy="78.5" r="6.5" fill="currentColor" />
    <circle cx="100" cy="121.5" r="6.5" fill="#f7f6f2" />
  </svg>;
}
