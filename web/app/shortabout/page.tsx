// /shortabout — the two-minute version of /about (Hitya 2026-08-09).
//
// For handing to someone who will not scroll a long page: the four pieces spin
// out of the central platform circle as you scroll, then one card each on what
// they are and where they run, then the one diagram of how data flows through
// them. Everything deeper links to /about.

import Link from 'next/link';
import type { Metadata } from 'next';
import { Reveal } from '@/components/about/Reveal';
import PlatformSpin from '@/components/about/PlatformSpin';

export const metadata: Metadata = {
  title: 'The short version',
  description: 'The Wolf Pack platform in two minutes: four pieces, where they live, and how they connect.',
};

const PIECES = [
  {
    icon: '🤖', name: 'The Bot', color: 'border-gold',
    what: 'Discord bot. Boss respawn timers, attendance ticks, loot auctions, DKP — the raid’s bookkeeping, in the server everyone already has open.',
    home: 'Runs on Railway. Ships itself on every update.',
  },
  {
    icon: '📜', name: 'The Agent', color: 'border-green',
    what: 'A small program on your PC that reads the combat log EverQuest already writes, and turns it into parses, attendance and buff coverage. Tells and officer chat are filtered out on your machine — they never leave it.',
    home: 'Runs on your PC, bundled inside Mimic. Zero setup beyond signing in.',
  },
  {
    icon: '🖥️', name: 'Mimic', color: 'border-purple',
    what: 'The desktop app: overlays on top of the game. Tank health with heals in flight, the CH chain as a rhythm game, DPS, triggers with spoken callouts, loot countdowns.',
    home: 'Runs on your screen. Installs without admin rights, updates itself.',
  },
  {
    icon: '🌐', name: 'wolfpack.quest', color: 'border-blue',
    what: 'This website. Every parse, every character, attendance that explains itself, the raid guide — and /me, where you see everything held about you and can switch any of it off.',
    home: 'Runs on Vercel. Sign in with Discord.',
  },
];

export default function ShortAboutPage() {
  return (
    <div className="pb-24">

      <section className="pt-6 sm:pt-12 text-center">
        <Reveal>
          <div className="text-[11px] uppercase tracking-widest text-gold mb-3">Wolf Pack · Project Quarm</div>
          <h1 className="text-3xl sm:text-5xl font-bold text-text leading-tight">
            One platform, <span className="text-blue">four pieces</span>
          </h1>
          <p className="mt-4 text-sm sm:text-base text-dim max-w-xl mx-auto leading-relaxed">
            Everything below grew out of one Discord bot answering{' '}
            <span className="text-text">&ldquo;when does the boss come back?&rdquo;</span>{' '}
            Scroll, and watch it grow.
          </p>
        </Reveal>
      </section>

      {/* The spin-out. Tall section; the diagram is sticky inside it. */}
      <section className="mt-8">
        <PlatformSpin />
      </section>

      {/* One card per piece — what it is, where it lives. */}
      <section className="mt-10 space-y-4">
        {PIECES.map((p, i) => (
          <Reveal key={p.name} delay={i * 60} from={i % 2 ? 'right' : 'left'}>
            <div className={`rounded-lg border-l-2 ${p.color} border-y border-r border-border bg-panel/60 p-4`}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-lg" aria-hidden>{p.icon}</span>
                <span className="text-base font-bold text-text">{p.name}</span>
              </div>
              <p className="text-sm text-text leading-relaxed">{p.what}</p>
              <p className="text-[11px] text-dim mt-2">{p.home}</p>
            </div>
          </Reveal>
        ))}
      </section>

      {/* How it connects — one line of data flow, the whole architecture. */}
      <section className="mt-12">
        <Reveal>
          <div className="rounded-lg border border-border bg-bg/40 p-4 sm:p-6">
            <div className="text-[10px] uppercase tracking-widest text-dim mb-4">How it all connects</div>
            <div className="flex items-center gap-1.5 sm:gap-3 flex-wrap justify-center text-[11px] sm:text-sm font-mono">
              {[
                { t: 'your combat log', c: 'text-dim' },
                { t: 'Agent', c: 'text-green' },
                { t: 'Bot', c: 'text-gold' },
                { t: 'one shared database', c: 'text-text' },
              ].map((x, i) => (
                <span key={x.t} className="flex items-center gap-1.5 sm:gap-3">
                  {i > 0 && <span className="text-dim" aria-hidden>→</span>}
                  <span className={`${x.c} rounded border border-border bg-panel px-2 py-1 whitespace-nowrap`}>{x.t}</span>
                </span>
              ))}
              <span className="text-dim" aria-hidden>→</span>
              <span className="flex flex-col gap-1">
                <span className="text-purple rounded border border-border bg-panel px-2 py-1 whitespace-nowrap">Mimic overlays</span>
                <span className="text-blue rounded border border-border bg-panel px-2 py-1 whitespace-nowrap">wolfpack.quest</span>
              </span>
            </div>
            <p className="text-[11px] text-dim mt-4 text-center leading-relaxed">
              One database is the whole trick: the bot, the website and every overlay read the same
              truth, so a fight parsed by a handful of people shows up everywhere for everyone.
            </p>
          </div>
        </Reveal>
      </section>

      <section className="mt-10 text-center">
        <Reveal>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link href="/about"
                  className="px-5 py-2.5 rounded-lg border border-blue bg-[#1f6feb33] text-blue text-sm hover:bg-[#1f6feb66] transition-colors no-underline">
              The full story →
            </Link>
            <Link href="/mimic"
                  className="px-5 py-2.5 rounded-lg border border-border bg-bg/40 text-text text-sm hover:border-blue transition-colors no-underline">
              Get Mimic
            </Link>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
