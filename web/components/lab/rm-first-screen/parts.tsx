import type { ReactNode } from 'react';

// Shared bits of the three raidmimic first-screen drafts. The gold button is the page's own (same classes as
// web/app/raidmimic/_landing/Parts.tsx PRIMARY_BTN); the quiet one is the same box with the panel colour.
const BASE = 'inline-flex min-h-11 items-center justify-center rounded-md border px-4 py-2 text-sm font-semibold no-underline transition-colors hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold motion-reduce:transition-none';
const GOLD = `${BASE} border-gold bg-gold text-bg hover:bg-gold/90`;
const QUIET = `${BASE} border-border bg-panel text-text hover:border-gold`;

/** A button or a link that looks like one. At most two per first screen. */
export function Btn({ href, onClick, gold, children, pressed }: { href?: string; onClick?: () => void; gold?: boolean; children: ReactNode; pressed?: boolean }) {
  const cls = gold ? GOLD : QUIET;
  if (href) return <a href={href} className={cls}>{children}</a>;
  return <button type="button" onClick={onClick} aria-pressed={pressed} className={cls}>{children}</button>;
}

export const H1 = 'm-0 max-w-[22ch] text-3xl font-semibold leading-[1.2] text-text sm:text-4xl lg:text-[2.5rem]';
export const LEAD = 'm-0 mt-4 max-w-[52ch] text-base leading-7 text-text';

export function Lockup() {
  return (
    <div className="flex items-center gap-2">
      <img src="/mimic-logo.png" alt="" width={40} height={40} className="block h-10 w-10 rounded-lg" />
      <span className="text-lg font-semibold text-text">Raid Mimic</span>
    </div>
  );
}

export function Shot({ shot, className = '', eager }: { shot: { src: string; w: number; h: number; alt: string }; className?: string; eager?: boolean }) {
  return <img src={shot.src} alt={shot.alt} width={shot.w} height={shot.h} loading={eager ? 'eager' : 'lazy'} decoding="async"
    className={`block h-auto w-full rounded-md border border-border bg-panel ${className}`} />;
}
