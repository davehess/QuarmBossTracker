// /shortabout — the two-minute version of /about (Hitya 2026-08-09).
//
// One scrolling story: the bot appears, the agent starts feeding it, the
// database grows between them, the chest swallows the agent (that is Mimic),
// the platform frames the lot — then the same verified numbers the long page
// carries. Deeper detail lives on /about.

import Link from 'next/link';
import type { Metadata } from 'next';
import { supabaseAdmin } from '@/lib/supabase';
import { Reveal, CountUp } from '@/components/about/Reveal';
import PlatformSpin from '@/components/about/PlatformSpin';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'The short version',
  description: 'The Wolf Pack platform in two minutes: how it grew, where it lives, and the numbers.',
};

type Stats = {
  raid_avg: number; raid_biggest: number; raids: number; max_parsers: number;
  fights_apr: number; damage_apr: number; bosses_apr: number; pvp: number;
};
const ZERO: Stats = { raid_avg: 0, raid_biggest: 0, raids: 0, max_parsers: 0,
                      fights_apr: 0, damage_apr: 0, bosses_apr: 0, pvp: 0 };

async function getStats(): Promise<Stats> {
  try {
    const { data, error } = await supabaseAdmin().rpc('about_stats');
    if (error || !data) return ZERO;
    return { ...ZERO, ...(data as Partial<Stats>) };
  } catch { return ZERO; }
}

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

function MiniStat({ v, label, suffix, decimals, accent = 'text-green' }: {
  v: number; label: string; suffix?: string; decimals?: number; accent?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-panel p-3 text-center">
      <div className={`text-xl sm:text-2xl font-bold ${accent}`}>
        <CountUp to={v} suffix={suffix} decimals={decimals} />
      </div>
      <div className="text-[10px] text-dim mt-0.5 leading-tight">{label}</div>
    </div>
  );
}

export default async function ShortAboutPage() {
  const s = await getStats();

  return (
    <div className="pb-24">

      <section className="pt-6 sm:pt-12 text-center">
        <Reveal>
          <div className="text-[11px] uppercase tracking-widest text-gold mb-3">Wolf Pack · Project Quarm</div>
          <h1 className="text-3xl sm:text-5xl font-bold text-text leading-tight">
            How the platform <span className="text-blue">grew</span>
          </h1>
          <p className="mt-4 text-sm sm:text-base text-dim max-w-xl mx-auto leading-relaxed">
            It started with one Discord bot answering{' '}
            <span className="text-text">&ldquo;when does the boss come back?&rdquo;</span>{' '}
            Scroll, and watch what happened next.
          </p>
        </Reveal>
      </section>

      {/* The story — bot, agent, database, chest, platform. */}
      <section className="mt-6">
        <PlatformSpin />
      </section>

      {/* The numbers, popping in at the end of the story — same verified
          figures as the long page: OpenDKP attendance for raid size, people
          (never characters) for parsers, platform-lifetime combat totals. */}
      <section className="mt-8">
        <Reveal from="scale">
          <div className="text-[10px] uppercase tracking-widest text-dim mb-3 text-center">And where that leaves us</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
            <MiniStat v={s.raid_avg} label="raiders on an average night" />
            <MiniStat v={s.raid_biggest} label="on the biggest one" />
            <MiniStat v={s.raids} label="raids this expansion" />
            <MiniStat v={s.max_parsers} label="most parsers in one night" />
            <MiniStat v={s.fights_apr} label="fights recorded since April" accent="text-blue" />
            <MiniStat v={s.damage_apr / 1_000_000} decimals={1} suffix="M" label="damage parsed" accent="text-blue" />
            <MiniStat v={s.bosses_apr} label="distinct bosses" accent="text-blue" />
            <MiniStat v={s.pvp} label="PvP broadcasts captured" accent="text-blue" />
          </div>
        </Reveal>
      </section>

      {/* One card per piece — the durable reference under the animation. */}
      <section className="mt-12 space-y-4">
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
