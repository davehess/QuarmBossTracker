// The three download channels, as a symbol plus an optional label.
//
// Hitya, 2026-08-28: "a download symbol next to miMIC, beta, and a Linux
// penguin logo 🐧" — and when space is short, "just show the mimic icon, beta
// symbol, then Linux symbol". So each channel owns its glyph, the label is what
// drops, and the accessible name is pinned with aria-label so nothing is lost
// when the words go.
import type { ReactNode } from 'react';

export function DownloadArrow({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true" className={className}>
      <path d="M6 1v6.2M3.4 5.1 6 7.7l2.6-2.6M2 10h8" fill="none" stroke="currentColor"
            strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ClockFace({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" className={className}>
      <circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 4.4V8l2.5 1.6" fill="none" stroke="currentColor" strokeWidth="1.3"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export type Channel = {
  key: string;
  href: string;
  label: string;      // the word that drops when space is short
  name: string;       // the accessible name, which never drops
  glyph: ReactNode;
  title: string;
  primary?: boolean;
};

export const CHANNELS: Channel[] = [
  {
    key: 'stable',
    href: '/mimic?direct=1',
    label: 'miMIC',
    name: 'Download miMIC',
    primary: true,
    /* eslint-disable-next-line @next/next/no-img-element */
    glyph: <img src="/mimic-logo.png" alt="" width={14} height={14} className="rounded-sm" />,
    title: "Wolf Pack miMIC — the all-in-one desktop client (bundles the wolfpack-logsync agent + DPS overlay, trigger TTS, charm tracker, /tells). Downloads the latest STABLE installer directly. SmartScreen will warn (not code-signed yet) — More info → Run anyway.",
  },
  {
    key: 'beta',
    href: '/mimic/beta?direct=1',
    label: 'Beta',
    name: 'Download miMIC beta',
    glyph: <span aria-hidden className="font-semibold leading-none">β</span>,
    title: "Wolf Pack miMIC — BETA channel. Latest prerelease build with in-progress features. Less stable than the main download; only grab this if you're testing or have been asked to.",
  },
  {
    key: 'linux',
    href: '/mimic/linux?direct=1',
    label: 'Linux',
    name: 'Download miMIC for Linux and SteamOS',
    glyph: <span aria-hidden className="leading-none">🐧</span>,
    title: "Wolf Pack Mimic — Linux / SteamOS (Steam Deck) BETA. Native AppImage: UI Studio, dashboard, log-based callouts. Auto-updates on its own channel. Experimental — grab this only if you're testing on Linux/Deck.",
  },
];

export function ChannelLink({ c, showLabel }: { c: Channel; showLabel: boolean }) {
  const tone = c.primary
    ? 'border-blue bg-[#1f6feb33] text-blue hover:bg-[#1f6feb66]'
    : 'border-border bg-bg/40 text-dim hover:bg-bg/70 hover:text-fg';
  return (
    <a
      href={c.href}
      target="_blank"
      rel="noreferrer"
      aria-label={c.name}
      title={c.title}
      className={`inline-flex items-center gap-1.5 rounded border py-1 text-xs no-underline
                  whitespace-nowrap transition-colors ${showLabel ? 'px-2' : 'px-1.5'} ${tone}`}
    >
      {c.glyph}
      {/* Compact is the symbol ALONE — "just show the mimic icon, beta symbol,
          then Linux symbol". Keeping the arrow there cost 45px across the three
          chips and pushed the bar 12px past a 360px viewport. */}
      {showLabel && <><span>{c.label}</span><DownloadArrow className="opacity-70" /></>}
    </a>
  );
}
