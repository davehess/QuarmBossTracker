// "Click here for more info": the fold-in-place pattern for long instruction text (the guild lead,
// 2026-10-14 on /pop; DECISIONS §168 pick A, §383). The first sentence stays on the page; the rest sits
// behind a one-line summary, right next to the thing it explains. A plain <details>, so it renders on
// the server with no script, and the folded text stays in the HTML for crawlers and /ai.
//
// Never fold a warning that must be seen (a fleet-wide button's caution, a red banner): leave those
// as plain text. And never put one inside a <p>, <span> or <label>: a <details> is block content.
import type { ReactNode } from 'react';
import { splitFirstSentence } from '@/lib/foldText';

export default function MoreInfo({
  children,
  summary = 'Click here for more info',
  className = 'mt-1',
}: { children: ReactNode; summary?: string; className?: string }) {
  return (
    <details className={className}>
      <summary className="cursor-pointer text-xs text-blue hover:underline">{summary}</summary>
      {children}
    </details>
  );
}

/** A plain-text paragraph: first sentence shown, the rest folded. Short text renders whole. */
export function FoldText({
  text,
  className = '',
  summary,
  moreClassName,
}: { text: string; className?: string; summary?: string; moreClassName?: string }) {
  const { first, rest } = splitFirstSentence(text);
  if (rest === null) return <p className={className}>{first}</p>;
  return (
    <div>
      <p className={className}>{first}</p>
      <MoreInfo summary={summary} className={moreClassName}>
        <p className={`${className} mt-1`}>{rest}</p>
      </MoreInfo>
    </div>
  );
}
