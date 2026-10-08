// /about, rebuilt around pictures (the guild lead, 2026-09-26: "could use some updating, possibly some
// generated images and assets so it's not just blocks of text"). Two layouts on beta until the guild
// lead picks one (CLAUDE.md, UI options); with no ?v= the page is still the old one, so there is a
// baseline to compare against.
//   B (?v=b), Illustrated: the same story, and every chapter opens with a picture.
//   C (?v=c), Tour: pictures first, one line each; the long text folds away under each stop.
// The chapters are written once, below, and both layouts read them. Facts refreshed the same day:
// test and migration counts, "six weeks", and a chapter for what has shipped since July.
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Reveal, CountUp } from '@/components/about/Reveal';
import { TankOverlayDemo, CommandCenterDemo, ChChainDemo, LootTtsDemo } from '@/components/about/OverlayDemo';
import {
  BossBoardFigure, LogLineFigure, ParseCardFigure, OverlayShot, FollowYouFigure, RaidNightFigure,
  FreezeWeekFigure, TagStripFigure,
} from '@/components/about/Figures';

export type AboutStats = {
  characters: number; who: number; snapshots: number; buffs: number;
  uploads: number; members: number;
  raid_avg: number; raid_biggest: number; raids: number; max_parsers: number;
  pvp: number; fights_apr: number; damage_apr: number; bosses_apr: number;
};

// Counted from the repo on 2026-09-26; round numbers, so they stay true for a while.
const TESTS = '4,000+';
const TEST_FILES = '290+';
const MIGRATIONS = 240;

type Chapter = {
  n: string; date: string; accent: string; title: ReactNode; short: string;
  figure: ReactNode; plat: ReactNode; infra: ReactNode; extra?: ReactNode;
};

function chapters(s: AboutStats): Chapter[] {
  return [
    {
      n: '01', date: '21 April 2026', accent: 'text-gold',
      title: 'A Discord bot, and a text file',
      short: 'Someone kills a boss, types it in Discord, and the bot does the respawn arithmetic nobody wants to do at 11pm.',
      figure: <BossBoardFigure />,
      plat: <>
        <p>Someone kills a boss, someone types it in Discord, and the bot does the arithmetic nobody wants to do at 11pm: respawn windows, variance, the whole board of who is up and who is hours away.</p>
        <p className="text-dim">That was the entire product. It was already worth it.</p>
      </>,
      infra: <>
        <p>One Node process on <span className="text-text">Railway</span>, redeploying on every push to <code className="text-blue">main</code>. State lived in a JSON file on disk.</p>
        <p>Which is fine, right up until the host restarts and the file is gone. That single fact is why the next chapter exists.</p>
      </>,
    },
    {
      n: '02', date: '25 May 2026', accent: 'text-green',
      title: 'The agent: reading the log, on your machine',
      short: 'EverQuest writes everything you see to a text file. A small program reads it, keeps the private lines on your PC, and sends the fight.',
      figure: <LogLineFigure />,
      plat: <>
        <p>A small program watches the log and turns it into parses, attendance, buff coverage and boss kills, with no typing and no one having to remember.</p>
        <p>And not everyone has to run it. Each log sees the whole fight, so the uploads merge into one record: a raid night here averages <span className="text-text"><CountUp to={s.raid_avg} /> raiders</span>, and a fraction of them parsing covers everyone. The most we have seen upload in one night is <span className="text-text"><CountUp to={s.max_parsers} /></span>.</p>
      </>,
      infra: <>
        <p>A JSON file could not hold this. <span className="text-text">Supabase</span> (Postgres) became the memory: <CountUp to={MIGRATIONS} />-odd migrations later, it still is.</p>
        <p>The bot grew an authenticated HTTP surface for uploads, and <span className="text-text">GitHub Actions</span> started building and publishing the agent so people could actually get it.</p>
      </>,
    },
    {
      n: '03', date: '27 May 2026', accent: 'text-blue',
      title: 'wolfpack.quest: somewhere to look at it',
      short: 'Parses you can open, attendance that explains itself, and /me, where you see what we hold on you and switch any of it off.',
      figure: <ParseCardFigure />,
      plat: <>
        <p>Parses you can open and read. Attendance that explains itself. Every character&apos;s gear, buffs, spells and DKP. A raid guide, boards, leaderboards, and <Link href="/me" className="text-blue hover:underline">/me</Link>, where you can see exactly what we hold on you and switch any of it off.</p>
      </>,
      infra: <>
        <p><span className="text-text">Next.js on Vercel</span>, signing in through Discord, gated on guild role. Officer pages sit behind a second check.</p>
        <p>Same Postgres as the bot, read directly: no second copy of the truth to drift.</p>
      </>,
    },
    {
      n: '04', date: '31 May 2026', accent: 'text-purple',
      title: 'Mimic: the part you see mid-fight',
      short: 'A desktop app that puts overlays on top of the game: DPS, tank, triggers, the CH chain, the buff queue, and a board for bards.',
      figure: (
        <div className="grid grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,1fr)_minmax(0,300px)] gap-5 items-start">
          <div className="min-w-0">
            <div className="text-[11px] text-dim mb-2">Three seats, three views. <span className="text-text">These run the way they run in a raid.</span> Swipe →</div>
            <div className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-2">
              <div className="snap-center shrink-0 w-[88%] sm:w-[380px]"><TankOverlayDemo /></div>
              <div className="snap-center shrink-0 w-[88%] sm:w-[380px]"><CommandCenterDemo /></div>
              <div className="snap-center shrink-0 w-[88%] sm:w-[380px]"><ChChainDemo /></div>
            </div>
          </div>
          <OverlayShot src="/about/melody-dirge.png" width={636} height={850}
            alt="The Melody overlay with its Dirge board: five numbered Dirge buttons, the Puretone key turned"
            caption={<>The real Melody overlay, rendered: a bard&apos;s Dirge board. <Link href="/mimic/dirge" className="text-blue hover:underline">Watch it run →</Link></>} />
        </div>
      ),
      plat: <>
        <p>A desktop app that carries the agent, installs without admin rights, updates itself, and puts overlays on top of the game: DPS, tank, triggers, charm, pets, mob info, the buff queue.</p>
      </>,
      infra: <>
        <p><span className="text-text">Electron</span> bundling its own Node runtime, shipping on three separate update channels: stable, beta, and one for Steam Deck.</p>
        <p>Releases are cut by version bump, built in CI, and pulled by the app itself. Nobody hand-installs anything.</p>
      </>,
    },
    {
      n: '05', date: 'the part nothing else does', accent: 'text-green',
      title: <>It follows <span className="text-green">you</span>, not one character</>,
      short: 'Every other parser watches one log file. Mimic tails every character’s log at once and follows whoever you are playing.',
      figure: <FollowYouFigure />,
      plat: <>
        <p>Every other log parser points at <span className="text-text font-bold">one selected log file</span>. Change character and it is watching the wrong one until you go and re-point it.</p>
        <p>Mimic tails <span className="text-text">every</span> character&apos;s log in your EQ folder at once and follows whoever you are actually playing. The overlays re-aim themselves. Nothing to switch, mid-raid, with eleven people waiting.</p>
      </>,
      infra: <>
        <p>It is also why the platform counts <span className="text-text">people</span>, not character names: plenty of raiders are on a different character by the last pull than the one they zoned in on, and attendance, parses and loot all have to know those are the same person.</p>
      </>,
    },
    {
      n: '06', date: 'through the summer', accent: 'text-gold',
      title: 'Ticks, loot, and not missing your shot at it',
      short: 'Attendance records itself on the half hour; loot is read out of chat and read out loud, so nobody misses a bid.',
      figure: <RaidNightFigure />,
      plat: <>
        <p>Attendance <span className="text-text">records itself</span> at 8:30, 9:30, 10:30 and 11:30: who was actually in the raid at that moment, written down before the live roster is overwritten. Filing the tick stays a deliberate officer action.</p>
        <p>Loot is read <span className="text-text">straight out of guild and raid chat</span>. By the time an officer opens the post screen the drops are listed and two clicks from being up for bids, tagged <span className="text-gold">🆕 NEW</span> or <span className="text-gold">💎 ULTRA RARE</span> against our own history and the drop tables.</p>
      </>,
      infra: <>
        <p>The live raid roster is overwritten every few seconds and pruned within the hour, so who was there at 8:30 cannot be recovered at 9:30. It has to be captured at the moment, which is why this is a scheduled job and not a query.</p>
        <p>Bids are sealed: encrypted at rest and readable only by the bot, including by whoever is running the auction.</p>
      </>,
      extra: (
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="rounded-lg border border-gold/30 bg-panel/60 p-4 sm:p-5">
            <div className="text-[10px] uppercase tracking-widest text-gold mb-3">🔊 You will hear it</div>
            <LootTtsDemo />
          </div>
          <div className="rounded-lg border border-border bg-bg/40 p-4 sm:p-5">
            <div className="text-[10px] uppercase tracking-widest text-dim mb-3">💰 And bid without leaving the game</div>
            <p className="text-sm text-text leading-relaxed">The bid box is on the dashboard, next to the parse, with your DKP and what the item last went for.</p>
          </div>
        </div>
      ),
    },
    {
      n: '07', date: '18 July 2026', accent: 'text-orange',
      title: 'And then: not breaking it',
      short: 'Raids are three fixed nights a week, so nothing ships during them, and every change runs a few thousand tests first.',
      figure: <FreezeWeekFigure tests={TESTS} files={TEST_FILES} />,
      plat: <>
        <p>Something that breaks at 8pm on a Wednesday does not stop the raid, but every convenience that fails becomes hand-work for the people already spending their evening running the night. They volunteer their time; the platform&apos;s job is to never hand it back to them broken.</p>
      </>,
      infra: <>
        <p>Over {TESTS} tests in {TEST_FILES} files, a golden-log fixture that replays real combat through the parser, and a deploy freeze that blocks pushes during the raid window.</p>
        <p>Plus a kill switch: the whole fleet of agents can be paused from a web page, without anyone updating anything.</p>
      </>,
    },
    {
      n: '08', date: 'September 2026', accent: 'text-purple',
      title: 'Into the game itself',
      short: 'Marks over a target’s head that the whole raid sees, and PvP fights kept as history with their videos.',
      figure: <TagStripFigure />,
      plat: <>
        <p>Coming to Zeal: a wolf, a skull, a number over a mob&apos;s head. <span className="text-text">Tag marks</span> the whole raid sees, so a pull or a mez target is called once, not five times, and guilds can have their own icon.</p>
        <p>PvP fights are grouped into <span className="text-text">fights with a history</span>, every death kept whoever was fighting, with the night&apos;s videos hung on the fight they belong to.</p>
      </>,
      infra: <>
        <p>The marks are changes to <span className="text-text">Zeal</span>, the open-source client plugin, being tested in game before they go to its maintainers.</p>
        <p>The fights are one table of every PvP death broadcast and a query that groups them into waves and fights.</p>
      </>,
    },
  ];
}

function Stat({ value, label, sub, accent = 'text-blue', suffix, decimals }: {
  value: number; label: string; sub?: string; accent?: string; suffix?: string; decimals?: number;
}) {
  return (
    <div className="rounded-lg border border-border bg-panel p-4 sm:p-5">
      <div className={`text-2xl sm:text-4xl font-bold ${accent}`}><CountUp to={value} suffix={suffix} decimals={decimals} /></div>
      <div className="text-sm text-text mt-1">{label}</div>
      {sub && <div className="text-[11px] text-dim mt-1 leading-snug">{sub}</div>}
    </div>
  );
}

function StatsBand({ s }: { s: AboutStats }) {
  return (
    <section>
      <Reveal>
        <div className="text-[11px] uppercase tracking-widest text-gold mb-2">Where it stands</div>
        <h2 className="text-2xl sm:text-4xl font-bold text-text">Live numbers</h2>
        <p className="text-sm text-dim mt-2 max-w-2xl">Read from the database. Nothing here is illustrative.</p>
      </Reveal>
      <Reveal delay={100}>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mt-6">
          <Stat value={s.raid_avg} label="A raid night" accent="text-green" sub={`raiders on average · biggest ${s.raid_biggest}`} />
          <Stat value={s.fights_apr} label="Fights recorded" accent="text-blue" sub="since April" />
          <Stat value={s.damage_apr / 1_000_000} decimals={1} suffix="M" label="Damage parsed" accent="text-blue" sub="since April" />
          <Stat value={s.who} label="/who sightings" accent="text-purple" />
          <Stat value={s.buffs} label="Buff landings tracked" accent="text-purple" />
          <Stat value={s.characters} label="Characters known" accent="text-gold" />
        </div>
      </Reveal>
    </section>
  );
}

function Close() {
  return (
    <section>
      <Reveal>
        <div className="rounded-xl border border-border bg-panel p-6 sm:p-10 text-center">
          <h2 className="text-xl sm:text-3xl font-bold text-text">All of it is optional, and all of it is yours</h2>
          <p className="text-sm sm:text-base text-dim mt-4 max-w-2xl mx-auto leading-relaxed">
            Turn logging off and nothing is collected. Exclude a character and it stops counting. Every line of this is open source, and{' '}
            <Link href="/privacy" className="text-blue hover:underline">the privacy page</Link> says plainly what is kept and who can see it.
          </p>
          <div className="mt-7 flex flex-wrap gap-3 justify-center">
            <Link href="/mimic" className="px-5 py-2.5 rounded-lg border border-blue bg-[#1f6feb33] text-blue text-sm hover:bg-[#1f6feb66] transition-colors no-underline">Get Mimic</Link>
            <Link href="/roadmap" className="px-5 py-2.5 rounded-lg border border-border bg-bg/40 text-text text-sm hover:border-blue transition-colors no-underline">What shipped lately</Link>
            <Link href="/platform/architecture" className="px-5 py-2.5 rounded-lg border border-border bg-bg/40 text-text text-sm hover:border-blue transition-colors no-underline">How it fits together</Link>
            <a href="https://github.com/davehess/QuarmBossTracker" target="_blank" rel="noreferrer" className="px-5 py-2.5 rounded-lg border border-border bg-bg/40 text-dim text-sm hover:text-text transition-colors no-underline">Read the code ↗</a>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

// The landing page's wolf, as one still plate: the filled silhouette, the linework, then the eyes lit
// (the layers WolfPack.tsx animates; see its header for why the silhouette sits underneath).
function Wolf({ className = '' }: { className?: string }) {
  const layer = 'absolute inset-0 w-full h-full pointer-events-none select-none';
  return (
    <div className={`relative aspect-square ${className}`} aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/wolf-solid.png" alt="" width={973} height={973} className={layer} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/wolf.png" alt="" width={973} height={973} className={layer} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/wolf-eyes.png" alt="" width={973} height={973} className={`${layer} drop-shadow-[0_0_10px_rgba(210,153,34,0.9)]`} />
    </div>
  );
}

/* ── B: Illustrated ─────────────────────────────────────────────────────── */

export function AboutIllustrated({ s }: { s: AboutStats }) {
  return (
    <div className="space-y-20 sm:space-y-28 pb-24">
      <section className="pt-6 sm:pt-12 grid md:grid-cols-[minmax(0,1fr)_280px] gap-6 items-center">
        <div>
          <Reveal>
            <div className="text-[11px] uppercase tracking-widest text-gold mb-3">Wolf Pack · Project Quarm</div>
            <h1 className="text-3xl sm:text-5xl font-bold text-text leading-[1.1]">It started as a bot that answered <span className="text-blue">one question.</span></h1>
          </Reveal>
          <Reveal delay={140}>
            <p className="mt-5 text-base sm:text-lg text-dim max-w-2xl leading-relaxed">
              <span className="text-text">“When does the boss come back?”</span> Everything on this site grew out of that, and out of the fact that EverQuest will happily tell you what just happened, as long as something is reading the log.
            </p>
            <p className="mt-4 text-xs text-dim">Four pieces, five months in, still shipping. <Link href="/shortabout" className="text-blue hover:underline">The short version →</Link></p>
          </Reveal>
        </div>
        <Reveal delay={200} from="scale"><Wolf className="w-40 sm:w-56 md:w-full mx-auto opacity-90" /></Reveal>
      </section>

      {chapters(s).map(c => (
        <section key={c.n} className="scroll-mt-16">
          <Reveal>
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className={`text-4xl sm:text-6xl font-bold ${c.accent} opacity-30 leading-none`}>{c.n}</span>
              <div>
                <div className="text-[11px] uppercase tracking-widest text-dim">{c.date}</div>
                <h2 className="text-xl sm:text-3xl text-text font-bold leading-tight">{c.title}</h2>
              </div>
            </div>
          </Reveal>
          <Reveal delay={80}><div className="mt-5">{c.figure}</div></Reveal>
          <div className="grid md:grid-cols-2 gap-4 sm:gap-5 mt-5">
            <Reveal from="left" delay={120}>
              <div className={`h-full rounded-lg border-l-2 ${c.accent.replace('text-', 'border-')} bg-panel/60 border-y border-r border-border p-4 sm:p-5`}>
                <div className={`text-[10px] uppercase tracking-widest ${c.accent} mb-2`}>What the guild got</div>
                <div className="text-sm text-text leading-relaxed space-y-2">{c.plat}</div>
              </div>
            </Reveal>
            <Reveal from="right" delay={180}>
              <div className="h-full rounded-lg border border-border bg-bg/40 p-4 sm:p-5">
                <div className="text-[10px] uppercase tracking-widest text-dim mb-2">What had to exist</div>
                <div className="text-sm text-dim leading-relaxed space-y-2">{c.infra}</div>
              </div>
            </Reveal>
          </div>
          {c.extra && <Reveal delay={220}><div className="mt-5">{c.extra}</div></Reveal>}
        </section>
      ))}

      <StatsBand s={s} />
      <Close />
    </div>
  );
}

/* ── C: Tour ────────────────────────────────────────────────────────────── */

export function AboutTour({ s }: { s: AboutStats }) {
  const list = chapters(s);
  return (
    <div className="space-y-16 sm:space-y-24 pb-24">
      <section className="pt-6 sm:pt-12 text-center">
        <Reveal from="scale"><Wolf className="w-28 sm:w-36 mx-auto" /></Reveal>
        <Reveal delay={120}>
          <h1 className="mt-4 text-3xl sm:text-5xl font-bold text-text leading-[1.1]">From one question to <span className="text-blue">a raid platform.</span></h1>
          <p className="mt-4 text-base text-dim max-w-xl mx-auto leading-relaxed">A Discord bot, a log reader, this website, and overlays on top of the game. Eight stops, five months. Tap any stop for the long version.</p>
        </Reveal>
        <Reveal delay={220}>
          <nav className="mt-6 flex flex-wrap gap-2 justify-center text-[11px]" aria-label="Stops">
            {list.map(c => (
              <a key={c.n} href={`#stop-${c.n}`} className="rounded-full border border-border bg-panel px-3 py-1 text-dim hover:text-text no-underline">{c.n}</a>
            ))}
          </nav>
        </Reveal>
      </section>

      <ol className="relative space-y-14 sm:space-y-20 list-none p-0 m-0">
        <div className="absolute left-[11px] top-2 bottom-2 w-px bg-border hidden sm:block" aria-hidden />
        {list.map(c => (
          <li key={c.n} id={`stop-${c.n}`} className="relative sm:pl-12 scroll-mt-20">
            <span className={`hidden sm:block absolute left-[5px] top-1.5 h-3.5 w-3.5 rounded-full border-2 border-bg ${c.accent.replace('text-', 'bg-')}`} aria-hidden />
            <Reveal>
              <div className="text-[11px] uppercase tracking-widest text-dim"><span className={c.accent}>{c.n}</span> · {c.date}</div>
              <h2 className="text-xl sm:text-3xl text-text font-bold leading-tight mt-1">{c.title}</h2>
              <p className="text-sm sm:text-base text-dim mt-2 max-w-2xl leading-relaxed">{c.short}</p>
            </Reveal>
            <Reveal delay={100}><div className="mt-5">{c.figure}</div></Reveal>
            <details className="mt-4 group">
              <summary className="cursor-pointer text-xs text-blue hover:underline list-none">
                <span className="group-open:hidden">The long version ↓</span><span className="hidden group-open:inline">Hide ↑</span>
              </summary>
              <div className="grid md:grid-cols-2 gap-4 mt-3">
                <div className="text-sm text-text leading-relaxed space-y-2">{c.plat}</div>
                <div className="text-sm text-dim leading-relaxed space-y-2">{c.infra}</div>
              </div>
              {c.extra && <div className="mt-4">{c.extra}</div>}
            </details>
          </li>
        ))}
      </ol>

      <StatsBand s={s} />
      <Close />
    </div>
  );
}
