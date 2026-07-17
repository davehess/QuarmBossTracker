// /platform — the public showcase map. One page that answers "what IS all of
// this?" at a glance, mindmap-first, with drill-down cards for the minutiae.
// Deliberately public (no auth gate): it describes architecture and features,
// never member data. Audience: curious guildmates, and the ecosystem folks
// watching the repo. The map + branch data live in components/PlatformMap.tsx
// (shared with the signed-out homepage). Stats are measured from the repo/live
// system, not aspirational — update them when they drift.
import Link from 'next/link';
import type { Metadata } from 'next';
import { BRANCHES, TINT, PlatformMap, PlatformStats } from '@/components/PlatformMap';

export const metadata: Metadata = {
  title: 'The Platform — wolfpack.quest',
  description:
    'From a Discord respawn timer to a four-component raid intelligence platform: the map of everything Wolf Pack built.',
};

const TIMELINE: Array<[string, string, string]> = [
  ['Spring 2026', 'A respawn timer', 'One Discord bot answering one question: when does the boss come back?'],
  ['Late spring', 'Shared parses', 'Multi-perspective parse merging + the website — one fight, one card, every viewpoint.'],
  ['June', 'The agent era', 'A privacy-first log engine on every machine, then miMIC: overlays over the game itself.'],
  ['July', 'Raid intelligence', 'Cross-client CH chains, Command Center, DI coverage, DKP in-client — the raid thinks together.'],
  ['Now', 'A living platform', 'Redeploy-free fleet updates, beta/stable channels, remote tuning — and a roadmap that reaches PoP.'],
];

export default function PlatformPage() {
  return (
    <div className="space-y-10">
      {/* Hero */}
      <section className="text-center space-y-4 pt-2">
        <h1 className="text-3xl md:text-4xl text-gold font-bold tracking-tight">
          One guild. One platform. Built between pulls.
        </h1>
        <p className="max-w-3xl mx-auto text-sm md:text-base leading-7 text-text">
          What started as a Discord bot answering <em className="text-blue not-italic">&ldquo;when does the boss respawn?&rdquo;</em>{' '}
          grew into a four-component raid intelligence platform: a desktop cockpit over the game,
          a privacy-first engine on every raider&apos;s machine, a hub that merges every viewpoint of every
          fight, and a website that remembers all of it. This is the map.
        </p>
      </section>

      {/* Stat strip */}
      <section className="bg-panel border border-border rounded-lg px-4 py-5">
        <PlatformStats />
      </section>

      {/* The mindmap */}
      <section className="bg-panel border border-border rounded-lg p-2 md:p-6 overflow-x-auto">
        <div className="min-w-[760px]">
          <PlatformMap />
        </div>
        <p className="text-center text-[11px] text-dim mt-1 mb-2">
          click any node to drill into the minutiae ↓
        </p>
      </section>

      {/* Drill-down cards */}
      <section className="grid md:grid-cols-2 gap-4">
        {BRANCHES.map((b) => {
          const t = TINT[b.tint];
          return (
            <div
              key={b.id}
              id={b.id}
              className={`bg-panel border ${t.border} rounded-lg p-5 scroll-mt-24 transition-shadow ${t.glow}`}
            >
              <h2 className={`text-lg font-bold ${t.text}`}>
                {b.icon} {b.title}
              </h2>
              <div className="text-[11px] text-dim mb-2">{b.tag}</div>
              <p className="text-sm leading-6 mb-3">{b.summary}</p>
              <ul className="text-xs space-y-1.5">
                {b.details.slice(0, 4).map(([name, desc]) => (
                  <li key={name} className="leading-5">
                    <span className={`font-bold ${t.text}`}>{name}</span>
                    <span className="text-dim"> — {desc}</span>
                  </li>
                ))}
              </ul>
              {b.details.length > 4 && (
                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer text-blue hover:underline">
                    the minutiae ({b.details.length - 4} more)
                  </summary>
                  <ul className="mt-2 space-y-1.5">
                    {b.details.slice(4).map(([name, desc]) => (
                      <li key={name} className="leading-5">
                        <span className={`font-bold ${t.text}`}>{name}</span>
                        <span className="text-dim"> — {desc}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          );
        })}
      </section>

      {/* Evolution timeline */}
      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-lg text-gold font-bold mb-4">📈 The evolution</h2>
        <ol className="relative border-l border-border ml-2 space-y-5">
          {TIMELINE.map(([when, title, desc]) => (
            <li key={title} className="ml-5">
              <span className="absolute -left-[5px] mt-1.5 w-2.5 h-2.5 rounded-full bg-accent" />
              <div className="text-[11px] text-dim uppercase tracking-wide">{when}</div>
              <div className="text-sm text-blue font-bold">{title}</div>
              <div className="text-xs text-text leading-5">{desc}</div>
            </li>
          ))}
        </ol>
      </section>

      {/* Privacy */}
      <section className="bg-panel border border-green/40 rounded-lg p-6">
        <h2 className="text-lg text-green font-bold mb-2">🔒 What never leaves your machine</h2>
        <p className="text-sm leading-6">
          The agent filters at the byte level <em className="not-italic text-green">before</em> parsing:
          officer chat, tells, group chat, and private channels are dropped on-device and are never
          uploaded. Characters can be excluded entirely, stats carry explicit visibility scopes, and
          every raider controls their own toggles. The full policy ships in the repo as{' '}
          <span className="text-blue">PRIVACY.md</span> — readable before you ever install anything.
        </p>
      </section>

      {/* Footer */}
      <section className="text-center text-xs text-dim space-y-2 pb-4">
        <p>
          Built by Wolf Pack raiders, for Wolf Pack raiders — human-led, AI-accelerated, shipped
          raid-night by raid-night.
        </p>
        <p className="space-x-3">
          <a href="https://github.com/davehess/QuarmBossTracker" target="_blank" rel="noreferrer"
             className="text-blue hover:underline">source on GitHub ↗</a>
          <Link href="/roadmap" className="text-blue hover:underline">roadmap</Link>
          <Link href="/mimic" className="text-blue hover:underline">get miMIC</Link>
          <Link href="/privacy" className="text-blue hover:underline">privacy</Link>
        </p>
      </section>
    </div>
  );
}
