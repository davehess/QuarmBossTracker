// /about — the walkthrough page.
//
// Built to be TALKED THROUGH: someone scrolls this on a phone while you explain
// it, so every section is one idea, one screenful, and the numbers are real.
//
// Two narratives run down the page together, because they actually happened
// together — each thing the platform learned to do forced a piece of
// infrastructure to exist. The left column is what raiders got; the right is
// what had to be stood up to deliver it. Dates come from the repo's own history
// (`git log --reverse` per path), not from memory.
//
// Stats are live from Supabase, cached for an hour — this page gets shared, and
// hammering the DB for a marketing page would be silly. `force-dynamic` is
// deliberately NOT used.

import Link from 'next/link';
import type { Metadata } from 'next';
import { supabaseAdmin } from '@/lib/supabase';
import { Reveal, CountUp } from '@/components/about/Reveal';
import { TankOverlayDemo, CommandCenterDemo, ChChainDemo, LootTtsDemo } from '@/components/about/OverlayDemo';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'About',
  description:
    'How a Discord bot that answered one question grew into a four-part raid platform for Project Quarm — and what it does now.',
};

type Stats = {
  characters: number; who: number; snapshots: number; buffs: number;
  uploads: number; members: number;
  raid_avg: number; raid_biggest: number; raids: number; max_parsers: number;
  pvp: number; fights_apr: number; damage_apr: number; bosses_apr: number;
};

const ZERO: Stats = {
  characters: 0, who: 0, snapshots: 0, buffs: 0, uploads: 0, members: 0,
  raid_avg: 0, raid_biggest: 0, raids: 0, max_parsers: 0,
  pvp: 0, fights_apr: 0, damage_apr: 0, bosses_apr: 0,
};

// One RPC, ~200ms. Doing this from PostgREST instead took 32 SECONDS — see the
// migration for why (full scans on million-row tables, plus three
// count(distinct) over the snapshot stream). Never re-expand this into
// per-table counts.
async function getStats(): Promise<Stats> {
  try {
    const { data, error } = await supabaseAdmin().rpc('about_stats');
    if (error || !data) return ZERO;
    return { ...ZERO, ...(data as Partial<Stats>) };
  } catch {
    // A stats outage must not 500 the page — the story is the point, the
    // numbers are the flourish. Zeros render as zeros.
    return ZERO;
  }
}

/* ── little building blocks ─────────────────────────────────────────────── */

function Stat({ value, label, sub, accent = 'text-blue', suffix, prefix, decimals }: {
  value: number; label: string; sub?: string; accent?: string;
  suffix?: string; prefix?: string; decimals?: number;
}) {
  return (
    <div className="rounded-lg border border-border bg-panel p-4 sm:p-5">
      <div className={`text-2xl sm:text-4xl font-bold ${accent}`}>
        <CountUp to={value} suffix={suffix} prefix={prefix} decimals={decimals} />
      </div>
      <div className="text-sm text-text mt-1">{label}</div>
      {sub && <div className="text-[11px] text-dim mt-1 leading-snug">{sub}</div>}
    </div>
  );
}

// One rung of the story. `plat` is what raiders got; `infra` is what had to
// exist underneath. Kept side by side so the causal link is the layout.
function Chapter({
  n, date, title, plat, infra, children, accent,
}: {
  n: string; date: string; title: string; plat: React.ReactNode; infra: React.ReactNode;
  children?: React.ReactNode; accent: string;
}) {
  return (
    <section className="scroll-mt-16">
      <Reveal>
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className={`text-4xl sm:text-6xl font-bold ${accent} opacity-30 leading-none`}>{n}</span>
          <div>
            <div className="text-[11px] uppercase tracking-widest text-dim">{date}</div>
            <h2 className="text-xl sm:text-3xl text-text font-bold leading-tight">{title}</h2>
          </div>
        </div>
      </Reveal>

      <div className="grid md:grid-cols-2 gap-4 sm:gap-5 mt-5">
        <Reveal from="left" delay={80}>
          <div className={`h-full rounded-lg border-l-2 ${accent.replace('text-', 'border-')} bg-panel/60 border-y border-r border-border p-4 sm:p-5`}>
            <div className={`text-[10px] uppercase tracking-widest ${accent} mb-2`}>What the guild got</div>
            <div className="text-sm text-text leading-relaxed space-y-2">{plat}</div>
          </div>
        </Reveal>
        <Reveal from="right" delay={160}>
          <div className="h-full rounded-lg border border-border bg-bg/40 p-4 sm:p-5">
            <div className="text-[10px] uppercase tracking-widest text-dim mb-2">What had to exist</div>
            <div className="text-sm text-dim leading-relaxed space-y-2">{infra}</div>
          </div>
        </Reveal>
      </div>

      {children && <Reveal delay={220}><div className="mt-5">{children}</div></Reveal>}
    </section>
  );
}

/* ── page ───────────────────────────────────────────────────────────────── */

export default async function AboutPage() {
  const s = await getStats();

  return (
    <div className="space-y-20 sm:space-y-32 pb-24">

      {/* ── Hero ── */}
      <section className="pt-6 sm:pt-16">
        <Reveal>
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="text-[11px] uppercase tracking-widest text-gold">Wolf Pack · Project Quarm</div>
            <Link href="/shortabout" className="text-[11px] text-dim hover:text-blue whitespace-nowrap no-underline">
              in a hurry? the short version →
            </Link>
          </div>
          <h1 className="text-3xl sm:text-6xl font-bold text-text leading-[1.1]">
            It started as a bot that answered<br className="hidden sm:block" />{' '}
            <span className="text-blue">one question.</span>
          </h1>
        </Reveal>
        <Reveal delay={140}>
          <p className="mt-5 text-base sm:text-xl text-dim max-w-2xl leading-relaxed">
            <span className="text-text">“When does the boss come back?”</span> Everything on this
            site grew out of that — and out of the fact that EverQuest will happily tell you what
            just happened, as long as something is reading the log.
          </p>
        </Reveal>
        <Reveal delay={260}>
          <div className="mt-7 flex flex-wrap gap-2 text-[11px] text-dim">
            {['Discord bot', 'log parser', 'desktop overlays', 'this website'].map((x, i) => (
              <span key={x} className="rounded-full border border-border bg-panel px-3 py-1">
                {i + 1}. {x}
              </span>
            ))}
          </div>
        </Reveal>
        <Reveal delay={380}>
          <p className="mt-8 text-xs text-dim">
            Four pieces, built in about six weeks, still shipping. Scroll →
          </p>
        </Reveal>
      </section>

      {/* ── 01 ── */}
      <Chapter
        n="01" date="21 April 2026" accent="text-gold"
        title="A Discord bot, and a text file"
        plat={
          <>
            <p>
              Someone kills a boss, someone types it in Discord, and the bot does the arithmetic
              nobody wants to do at 11pm — respawn windows, variance, the whole board of who is
              up and who is hours away.
            </p>
            <p className="text-dim">
              That was the entire product. It was already worth it.
            </p>
          </>
        }
        infra={
          <>
            <p>
              One Node process on <span className="text-text">Railway</span>, redeploying on every
              push to <code className="text-blue">main</code>. State lived in a JSON file on disk.
            </p>
            <p>
              Which is fine, right up until the host restarts and the file is gone. That single
              fact is why the next chapter exists.
            </p>
          </>
        }
      />

      {/* ── 02 ── */}
      <Chapter
        n="02" date="25 May 2026" accent="text-green"
        title="The agent — reading the log, on your machine"
        plat={
          <>
            <p>
              EverQuest writes everything you see to a text file. A small program watches that
              file and turns it into parses, attendance, buff coverage and boss kills — with no
              typing, and no one having to remember.
            </p>
            <p>
              And not everyone has to run it. Each log sees the whole fight, so the uploads merge
              into one record — a raid night here averages{' '}
              <span className="text-text"><CountUp to={s.raid_avg} /> raiders</span>, and a
              fraction of them parsing covers everyone. The most we&apos;ve seen upload in one
              night is <span className="text-text"><CountUp to={s.max_parsers} /></span>.
            </p>
            <p className="text-dim">
              Officer chat, tells and private channels are filtered out{' '}
              <span className="text-text">on your own PC</span>, before anything is sent. That is
              a design constraint, not a setting.
            </p>
          </>
        }
        infra={
          <>
            <p>
              A JSON file could not hold this. <span className="text-text">Supabase</span> (Postgres)
              became the memory — <CountUp to={189} /> migrations later it still is.
            </p>
            <p>
              The bot grew an authenticated HTTP surface for uploads, and{' '}
              <span className="text-text">GitHub Actions</span> started building and publishing the
              agent so people could actually get it.
            </p>
          </>
        }
      />

      {/* ── 03 ── */}
      <Chapter
        n="03" date="27 May 2026" accent="text-blue"
        title="wolfpack.quest — somewhere to look at it"
        plat={
          <>
            <p>
              Parses you can open and read. Attendance that explains itself. Every character&apos;s
              gear, buffs, spells and DKP. A raid guide, boards, leaderboards — and{' '}
              <Link href="/me" className="text-blue hover:underline">/me</Link>, where you can see
              exactly what we hold on you and switch any of it off.
            </p>
          </>
        }
        infra={
          <>
            <p>
              <span className="text-text">Next.js on Vercel</span>, signing in through Discord, gated
              on guild role. Officer pages sit behind a second check.
            </p>
            <p>
              Same Postgres as the bot, read directly — no second copy of the truth to drift.
            </p>
          </>
        }
      />

      {/* ── 04 ── */}
      <Chapter
        n="04" date="31 May 2026" accent="text-purple"
        title="Mimic — the part you see mid-fight"
        plat={
          <>
            <p>
              A desktop app that carries the agent, installs without admin rights, updates itself,
              and puts overlays on top of the game: DPS, tank, triggers, charm, pets, mob info,
              the buff queue.
            </p>
            <p className="text-dim">
              Two of them are below, running the same way they run in a raid.
            </p>
          </>
        }
        infra={
          <>
            <p>
              <span className="text-text">Electron</span> bundling its own Node runtime, shipping on
              three separate update channels — stable, beta, and one for Steam Deck.
            </p>
            <p>
              Releases are cut by version bump, built in CI, and pulled by the app itself. Nobody
              hand-installs anything.
            </p>
          </>
        }
      >
        {/* Three seats, three overlays — a horizontal strip so each demo gets a
            full card on a phone. Every name, class, HP and spell value in these
            is real and was checked against the database before it went here. */}
        <div>
          <div className="text-[11px] text-dim mb-2">
            Three seats, three views — <span className="text-text">there&apos;s an overlay for every job in the raid</span>. Swipe →
          </div>
          <div className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-2 -mx-3 px-3 sm:-mx-4 sm:px-4">
            <div className="snap-center shrink-0 w-[88%] sm:w-[400px]"><TankOverlayDemo /></div>
            <div className="snap-center shrink-0 w-[88%] sm:w-[400px]"><CommandCenterDemo /></div>
            <div className="snap-center shrink-0 w-[88%] sm:w-[400px]"><ChChainDemo /></div>
          </div>
        </div>
      </Chapter>

      {/* ── 05 — the multi-character thing. Its own chapter because it is the
             one capability the alternatives structurally cannot match, and it
             is the reason the raid-size tiles above separate people from
             characters. ── */}
      <section className="scroll-mt-16">
        <Reveal>
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-4xl sm:text-6xl font-bold text-green opacity-30 leading-none">05</span>
            <div>
              <div className="text-[11px] uppercase tracking-widest text-dim">the part nothing else does</div>
              <h2 className="text-xl sm:text-3xl text-text font-bold leading-tight">
                It follows <span className="text-green">you</span>, not one character
              </h2>
            </div>
          </div>
        </Reveal>

        <Reveal delay={80}>
          <div className="mt-5 rounded-lg border border-green/30 bg-panel/60 p-4 sm:p-6">
            <p className="text-sm sm:text-base text-text leading-relaxed">
              Every other log parser points at <span className="text-text font-bold">one selected
              log file</span>. Change character and it is watching the wrong one until you go and
              re-point it.
            </p>
            <p className="text-sm sm:text-base text-dim leading-relaxed mt-3">
              Mimic tails <span className="text-text">every</span> character&apos;s log in your EQ
              folder at once and follows whoever you are actually playing. The overlays re-aim
              themselves. Nothing to switch, mid-raid, with eleven people waiting.
            </p>

            <div className="text-[10px] uppercase tracking-widest text-green mt-6 mb-3">
              Which matters if you fill whatever the raid is short of
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              {[
                { icon: '✚', t: 'Short a healer', d: 'Swap to the cleric and the CH chain overlay is already up, already knows your slot, already counting your beat.' },
                { icon: '🐺', t: 'Short a shaman', d: 'The buff queue re-aims — who still needs Feral Avatar, who has a curse counter waiting to be cured.' },
                { icon: '🎵', t: 'On the bard', d: "See which casters are missing Lcea's, and go and stand near them." },
              ].map((x, i) => (
                <Reveal key={x.t} delay={140 + i * 90} from="scale">
                  <div className="h-full rounded-lg border border-border bg-bg/40 p-4">
                    <div className="text-xl mb-1.5" aria-hidden>{x.icon}</div>
                    <div className="text-sm text-text font-bold">{x.t}</div>
                    <div className="text-xs text-dim mt-1.5 leading-relaxed">{x.d}</div>
                  </div>
                </Reveal>
              ))}
            </div>

            <p className="text-xs text-dim mt-5 leading-relaxed">
              It is also why the platform counts <span className="text-text">people</span>, not
              character names: plenty of raiders are on a different character by the last pull than
              the one they zoned in on, and everything — attendance, parses, loot — has to know
              those are the same person.
            </p>
          </div>
        </Reveal>
      </section>

      {/* ── 06 — the loot + attendance loop. The bit that costs an officer their
             raid night if it is slow, and costs a raider DKP if they miss it. ── */}
      <Chapter
        n="06" date="through the summer" accent="text-gold"
        title="Ticks, loot, and not missing your shot at it"
        plat={
          <>
            <p>
              Attendance <span className="text-text">records itself</span> at 8:30, 9:30, 10:30
              and 11:30 — who was actually in the raid at that moment, written down before the
              live roster is overwritten. Filing the tick stays a deliberate officer action; the
              record is just there so nobody gets missed, including on the nights we take the
              last tick early.
            </p>
            <p>
              Loot is read <span className="text-text">straight out of guild and raid chat</span> —
              by the time an officer opens the post screen, the drops are already listed and{' '}
              <span className="text-text">two clicks from being up for bids</span>. (Pasting works
              too.) Each item comes back tagged <span className="text-gold">🆕 NEW</span> if the
              guild has never seen it and <span className="text-gold">💎 ULTRA RARE</span> if it
              has dropped once and sits in the bottom quarter of that boss&apos;s table — checked
              against our own history and the drop tables, not somebody&apos;s memory.
            </p>
          </>
        }
        infra={
          <>
            <p>
              The live raid roster is overwritten every few seconds and pruned within the hour, so
              who was there at 8:30 genuinely cannot be recovered at 9:30. It has to be captured
              at the moment or it is gone — that is why this is a scheduled job and not a query.
            </p>
            <p>
              Bids are sealed: encrypted at rest and readable only by the bot, so nobody can see
              what anyone else put in — including whoever is running the auction.
            </p>
          </>
        }
      >
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="rounded-lg border border-gold/30 bg-panel/60 p-4 sm:p-5">
            <div className="text-[10px] uppercase tracking-widest text-gold mb-3">
              🔊 You will hear it
            </div>
            <LootTtsDemo />
            <p className="text-[11px] text-dim mt-3 leading-relaxed">
              Mimic says it out loud and puts the countdowns on screen. Two minutes is not long
              when you are mid-fight, tabbed out, or not reading chat — this way the window
              reaches you anyway, and nobody misses their shot at a bid.
            </p>
          </div>

          <div className="rounded-lg border border-border bg-bg/40 p-4 sm:p-5">
            <div className="text-[10px] uppercase tracking-widest text-dim mb-3">
              💰 And bid without leaving the game
            </div>
            <p className="text-sm text-text leading-relaxed">
              The bid box is on the dashboard, next to the parse. Your characters come from
              OpenDKP, your DKP balance is right there, and it remembers what the item last went
              for and what you bid last time.
            </p>
            <p className="text-[11px] text-dim mt-3 leading-relaxed">
              Which matters when the auction opens while you are tanking. No alt-tab hunt for a
              website, no working out whether you can afford it.
            </p>
          </div>
        </div>
      </Chapter>

      {/* ── 07 ── */}
      <Chapter
        n="07" date="18 July 2026" accent="text-orange"
        title="And then: not breaking it"
        plat={
          <>
            <p>
              Raids happen three nights a week at a fixed time. Something that breaks at 8pm on a
              Wednesday does not stop the raid — the guild raided for years without any of this —
              but every convenience that fails becomes hand-work for the people already spending
              their evening running the night. They volunteer their time; the platform&apos;s job
              is to never hand it back to them broken.
            </p>
          </>
        }
        infra={
          <>
            <p>
              <CountUp to={1372} /> tests over <CountUp to={84} /> files, a golden-log fixture that
              replays real combat through the parser, and a deploy freeze that blocks pushes during
              the raid window.
            </p>
            <p>
              Plus a kill switch: the whole fleet of agents can be paused from a web page, without
              anyone updating anything.
            </p>
          </>
        }
      />

      {/* ── Stats ── */}
      <section>
        <Reveal>
          <div className="text-[11px] uppercase tracking-widest text-gold mb-2">Where it stands</div>
          <h2 className="text-2xl sm:text-4xl font-bold text-text">Live numbers</h2>
          <p className="text-sm text-dim mt-2 max-w-2xl">
            Read from the database when this page was built. Nothing here is illustrative.
          </p>
        </Reveal>

        {/* Every figure here is TIME-OF-DAY STABLE by construction. Raid size is
            OPENDKP ATTENDANCE (distinct attendees per raid since Luclin opened)
            — the number the guild's own sheets use — and parser coverage counts
            PEOPLE, never characters. A live "users right now" count would read
            near zero outside the Sun/Wed/Thu window and say nothing true. */}
        <Reveal delay={100}>
          <div className="grid grid-cols-3 gap-3 sm:gap-4 mt-6">
            <Stat value={s.raid_avg} label="A raid night" accent="text-green"
                  sub={`raiders on average since Luclin opened · biggest ${s.raid_biggest}`} />
            <Stat value={s.max_parsers} label="Most parsers in one night" accent="text-green"
                  sub="people uploading — their logs merge into one record" />
            <Stat value={s.raids} label="Raids this expansion" accent="text-green"
                  sub="on the DKP books" />
          </div>
        </Reveal>

        <Reveal delay={160}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mt-3 sm:mt-4">
            <Stat value={s.fights_apr} label="Fights recorded" accent="text-blue"
                  sub="since the platform started in April" />
            <Stat value={s.damage_apr / 1_000_000} decimals={1} suffix="M" label="Damage parsed" accent="text-blue"
                  sub="since April" />
            <Stat value={s.bosses_apr} label="Distinct bosses" accent="text-blue"
                  sub="since April" />
            <Stat value={s.pvp} label="PvP broadcasts captured" accent="text-blue"
                  sub="kills and assists on Zek" />
          </div>
        </Reveal>

        <Reveal delay={220}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mt-3 sm:mt-4">
            <Stat value={s.who} label="/who sightings" accent="text-purple" />
            <Stat value={s.snapshots} label="Combat snapshots" accent="text-purple"
                  sub="every few seconds, per fight" />
            <Stat value={s.buffs} label="Buff landings tracked" accent="text-purple" />
            <Stat value={s.uploads} label="Parse uploads merged" accent="text-purple"
                  sub="many people, one record per fight" />
          </div>
        </Reveal>

        <Reveal delay={280}>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 mt-3 sm:mt-4">
            <Stat value={s.characters} label="Characters known" accent="text-gold" />
            <Stat value={s.members} label="Discord members" accent="text-gold" />
          </div>
        </Reveal>
      </section>

      {/* ── Close ── */}
      <section>
        <Reveal>
          <div className="rounded-xl border border-border bg-panel p-6 sm:p-10 text-center">
            <h2 className="text-xl sm:text-3xl font-bold text-text">
              All of it is optional, and all of it is yours
            </h2>
            <p className="text-sm sm:text-base text-dim mt-4 max-w-2xl mx-auto leading-relaxed">
              Turn logging off and nothing is collected. Exclude a character and it stops counting.
              Every line of this is open source, and{' '}
              <Link href="/privacy" className="text-blue hover:underline">the privacy page</Link>{' '}
              says plainly what is kept and who can see it.
            </p>
            <div className="mt-7 flex flex-wrap gap-3 justify-center">
              <Link href="/mimic"
                    className="px-5 py-2.5 rounded-lg border border-blue bg-[#1f6feb33] text-blue text-sm hover:bg-[#1f6feb66] transition-colors no-underline">
                Get Mimic
              </Link>
              <Link href="/roadmap"
                    className="px-5 py-2.5 rounded-lg border border-border bg-bg/40 text-text text-sm hover:border-blue transition-colors no-underline">
                What shipped lately
              </Link>
              <a href="https://github.com/davehess/QuarmBossTracker" target="_blank" rel="noreferrer"
                 className="px-5 py-2.5 rounded-lg border border-border bg-bg/40 text-dim text-sm hover:text-text transition-colors no-underline">
                Read the code ↗
              </a>
            </div>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
