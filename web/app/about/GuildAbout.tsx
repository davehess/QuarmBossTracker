// /about, reoriented to be about the GUILD, not the tool (the guild lead, 2026-10-18: the platform story is
// moving to eqmimic.quest; wolfpack.quest/about should be about Wolf Pack). Two layouts on beta until the
// guild lead picks one (CLAUDE.md, UI options). With no ?v= the page is still the platform story, so there
// is a baseline to compare against:
//   B (?v=b), By the record: a ledger. The guild as numbers: when it raids, how big, how much it has done.
//   C (?v=c), As a home:     people first. What a raid night is like, the film, and how to join.
//
// Visual family: the landing page's (Prata display, Faustina prose, the warm gold on the night ground),
// because this is the guild's own front door and should read like the page that links to it. Boldness is
// spent in ONE place per layout: B's three big numerals, C's film poster at the top.
//
// Copy rules: no member character names (the repo is public). Everything stated here is something the repo
// already says in public (raid hours, tick times, sealed bids, the Aten Ha Ra film); nothing is invented.
// Numbers come from the same `about_stats()` the platform story reads.
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Reveal, CountUp } from '@/components/about/Reveal';
import type { AboutStats } from './Story';

// Where "come say hello" points. The repo carries no Discord invite (it is not ours to guess), so this is
// null until the guild lead supplies one; with null, the join step says so instead of linking nowhere.
const DISCORD_INVITE: string | null = null;

const DISPLAY = 'font-[family-name:var(--font-display)]';
const PROSE = 'font-[family-name:var(--font-prose)]';
const WARM = 'text-[#f2ede1]';
const GOLD_BTN =
  'no-underline rounded-md bg-[#d29922] px-5 py-2.5 text-sm font-semibold text-[#1a1206] transition-colors hover:bg-[#e0a92c]';
const QUIET_BTN =
  'no-underline rounded-md border border-border px-5 py-2.5 text-sm text-text transition-colors hover:border-[#d29922] hover:text-[#f2ede1]';

function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="text-[11px] uppercase tracking-widest text-[#d29922]">{children}</div>;
}

// The one call to action both layouts end on. Sign-in is the real door (Discord OAuth, gated on guild
// role); /start is the public install walkthrough, readable before anyone has an account.
function JoinCall({ lead }: { lead: string }) {
  return (
    <section>
      <Reveal>
        <div className="border-t border-border/70 pt-10 text-center">
          <h2 className={`${DISPLAY} text-[clamp(1.75rem,6vw,3rem)] leading-tight ${WARM}`}>Run with us.</h2>
          <p className={`${PROSE} mx-auto mt-4 max-w-[52ch] text-base leading-7 text-text`}>{lead}</p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            {DISCORD_INVITE && (
              <a href={DISCORD_INVITE} target="_blank" rel="noreferrer" className={GOLD_BTN}>Join the Discord</a>
            )}
            <Link href="/start" className={DISCORD_INVITE ? QUIET_BTN : GOLD_BTN}>Get set up in five minutes</Link>
            <Link href="/auth/signin" className={QUIET_BTN}>Sign in with Discord</Link>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/* ── B: By the record ───────────────────────────────────────────────────── */

// One figure in the three-wide ledger strip. Rules above, no card: the numeral is the whole object.
function Figure({ value, label, sub }: { value: number; label: string; sub: string }) {
  return (
    <div className="border-t border-[#d29922]/60 pt-3">
      <div className={`${DISPLAY} tnum text-[clamp(2.25rem,9vw,4.5rem)] leading-none text-[#d29922]`}>
        <CountUp to={value} />
      </div>
      <div className={`${PROSE} mt-2 text-sm font-semibold ${WARM}`}>{label}</div>
      <div className="mt-1 text-[11px] leading-snug text-dim">{sub}</div>
    </div>
  );
}

// One line of the record: what, and how many. Same row shape as the landing page's lists.
function Row({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <li className="flex items-baseline justify-between gap-4 border-b border-border/40 py-3 last:border-0">
      <span className="min-w-0">
        <span className={`${PROSE} text-[0.95rem] text-[#e8e2d4]`}>{label}</span>
        {note && <span className="ml-2 text-xs text-dim">{note}</span>}
      </span>
      <span className="tnum whitespace-nowrap text-lg text-[#d29922]">{children}</span>
    </li>
  );
}

const RAID_NIGHTS: { day: string; note: string }[] = [
  { day: 'Sunday', note: '8pm to midnight, Eastern' },
  { day: 'Wednesday', note: '8pm to midnight, Eastern' },
  { day: 'Thursday', note: '8pm to midnight, Eastern' },
];

export function AboutByTheRecord({ s }: { s: AboutStats }) {
  return (
    <div className="space-y-16 pb-24 sm:space-y-24">
      {/* ── Who ── */}
      <section className="pt-6 sm:pt-14">
        <Reveal>
          <Eyebrow>Wolf Pack · Project Quarm</Eyebrow>
          <h1 className={`${DISPLAY} mt-3 text-[clamp(2rem,7.5vw,4.5rem)] leading-[1.05] tracking-[-0.02em] ${WARM}`}>
            Wolf Pack, by the record.
          </h1>
        </Reveal>
        <Reveal delay={120}>
          <p className={`${PROSE} mt-5 max-w-[56ch] text-lg leading-8 text-text`}>
            We are a raiding guild on Project Quarm. We raid three nights a week, at the same hours, and we
            write all of it down. This page is that record.
          </p>
        </Reveal>
      </section>

      {/* ── The three numbers ── */}
      <section aria-labelledby="ledger-h">
        <Reveal>
          <h2 id="ledger-h" className="sr-only">The raid, in three numbers</h2>
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-3 sm:gap-6">
            <Figure value={s.raid_avg} label="raiders on a normal night"
                    sub="average attendance on the DKP books since Luclin opened" />
            <Figure value={s.raid_biggest} label="in our biggest raid"
                    sub="the most distinct raiders on one night's books" />
            <Figure value={s.raids} label="raids on the books"
                    sub="every one filed, tick by tick, since Luclin opened" />
          </div>
        </Reveal>
      </section>

      {/* ── When ── */}
      <section>
        <Reveal>
          <Eyebrow>When we raid</Eyebrow>
          <h2 className={`${DISPLAY} mt-2 text-2xl sm:text-3xl ${WARM}`}>Three nights, same hours</h2>
        </Reveal>
        <Reveal delay={100}>
          <ul className="mt-4">
            {RAID_NIGHTS.map((n) => (
              <li key={n.day} className="flex items-baseline justify-between gap-4 border-b border-border/40 py-3 last:border-0">
                <span className={`${DISPLAY} text-lg text-[#e8e2d4]`}>{n.day}</span>
                <span className="text-sm text-dim">{n.note}</span>
              </li>
            ))}
          </ul>
          <p className={`${PROSE} mt-4 max-w-[60ch] text-[0.95rem] leading-7 text-dim`}>
            Attendance is taken on the half hour: <span className="text-text">8:30, 9:30, 10:30 and 11:30</span>.
            Loot goes to sealed bids, so nobody sees what anyone else put in, including whoever is running the
            auction. The officers who run the night are volunteers; the record is there so none of it is
            hand-work.
          </p>
        </Reveal>
      </section>

      {/* ── What the record holds ── */}
      <section>
        <Reveal>
          <Eyebrow>What we have done</Eyebrow>
          <h2 className={`${DISPLAY} mt-2 text-2xl sm:text-3xl ${WARM}`}>Since we started keeping the log</h2>
          <p className="mt-2 max-w-[60ch] text-sm text-dim">
            Read from the database when this page was built. Nothing here is illustrative. Combat figures start
            in April 2026, when every raider&apos;s log began merging into one record.
          </p>
        </Reveal>
        <Reveal delay={100}>
          <ul className="mt-4">
            <Row label="Distinct bosses fought" note="since April"><CountUp to={s.bosses_apr} /></Row>
            <Row label="Fights recorded" note="since April"><CountUp to={s.fights_apr} /></Row>
            <Row label="Damage dealt and parsed" note="since April">
              <CountUp to={s.damage_apr / 1_000_000} decimals={1} suffix="M" />
            </Row>
            <Row label="Most raiders parsing one night" note="their logs merge into one record">
              <CountUp to={s.max_parsers} />
            </Row>
          </ul>
        </Reveal>
        <Reveal delay={160}>
          <p className={`${PROSE} mt-5 max-w-[60ch] text-[0.95rem] leading-7 text-dim`}>
            Luclin is complete. The film of the Aten Ha Ra kill is on{' '}
            <Link href="/film" className="text-[#d29922] hover:underline">the film page</Link> for members.
          </p>
        </Reveal>
      </section>

      {/* ── The alliance ── */}
      <section>
        <Reveal>
          <Eyebrow>Beside us</Eyebrow>
          <h2 className={`${DISPLAY} mt-2 text-2xl sm:text-3xl ${WARM}`}>We do not fight alone</h2>
        </Reveal>
        <Reveal delay={100}>
          <div className="mt-4 grid items-end gap-6 sm:grid-cols-[minmax(0,1fr)_auto]">
            <p className={`${PROSE} max-w-[56ch] text-base leading-7 text-text`}>
              On the PvP server we run as part of an alliance. One night in Vex Thal four guilds stood
              together against the Zek train and wiped it at the zone in. Every kill and assist we see
              broadcast is kept, and the biggest fights are grouped with their videos.
            </p>
            <div className="sm:text-right">
              <div className={`${DISPLAY} tnum text-4xl leading-none text-[#d29922]`}><CountUp to={s.pvp} /></div>
              <div className="mt-1 text-[11px] text-dim">PvP kills and assists captured</div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ── How we count ── */}
      <section>
        <Reveal>
          <Eyebrow>How we count</Eyebrow>
          <p className={`${PROSE} mt-2 max-w-[60ch] text-base leading-7 text-text`}>
            In people, not characters. Plenty of us are on a different character by the last pull than the one
            we zoned in on, so attendance, parses and loot all follow the person. Our Discord holds{' '}
            <span className="text-[#d29922]"><CountUp to={s.members} /></span> members.
          </p>
        </Reveal>
      </section>

      <JoinCall lead="If you raid on Quarm and want a pack that turns up on the same three nights, come and run with us." />
    </div>
  );
}

/* ── C: As a home ───────────────────────────────────────────────────────── */

// A short beat: a name for the thing, one plain sentence about it. No card, no icon; the display face does it.
function Beat({ title, children, delay = 0 }: { title: string; children: ReactNode; delay?: number }) {
  return (
    <Reveal delay={delay}>
      <div>
        <h3 className={`${DISPLAY} text-xl sm:text-2xl ${WARM}`}>{title}</h3>
        <p className={`${PROSE} mt-2 max-w-[52ch] text-base leading-7 text-text`}>{children}</p>
      </div>
    </Reveal>
  );
}

const NIGHT: { when: string; what: string }[] = [
  { when: '8:00', what: 'The raid starts.' },
  { when: '8:30', what: 'First attendance tick. There is one on every half hour after it, up to 11:30, so nobody who was there goes unrecorded.' },
  { when: 'Between pulls', what: 'Loot is read out of chat and put up for sealed bids. Mimic reads the window out loud, so a bid is not missed while you are tanking.' },
  { when: 'Midnight', what: 'The night closes, the kills are filed, and the record is waiting for you on the website in the morning.' },
];

export function AboutAsAHome({ s }: { s: AboutStats }) {
  return (
    <div className="space-y-16 pb-24 sm:space-y-24">
      {/* ── The welcome: the film's own poster is the one bold thing on this page ── */}
      <section className="-mx-3 sm:-mx-4">
        <Reveal>
          <div className="relative overflow-hidden sm:rounded-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/film/wolfpack-rise.jpg" width={1280} height={720}
                 alt="Wolf Pack raiders raising weapons before the four-armed queen Aten Ha Ra, in a cartoon title card"
                 className="aspect-[16/10] w-full object-cover sm:aspect-video" />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-bg via-bg/40 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 px-4 pb-5 sm:px-8 sm:pb-8">
              <Eyebrow>Wolf Pack · Project Quarm</Eyebrow>
              <h1 className={`${DISPLAY} mt-2 text-[clamp(1.9rem,7vw,4rem)] leading-[1.05] tracking-[-0.02em] ${WARM}`}>
                Come raid with us.
              </h1>
            </div>
          </div>
        </Reveal>
        <Reveal delay={120}>
          <p className={`${PROSE} mt-5 max-w-[56ch] px-3 text-lg leading-8 text-text sm:px-4`}>
            Wolf Pack is a raiding guild on Project Quarm. Three nights a week we get together and take on
            the raid content, and we look after each other while we do it. That poster is ours, from the
            film we made of the Aten Ha Ra kill.
          </p>
        </Reveal>
      </section>

      {/* ── What it is like ── */}
      <section>
        <Reveal>
          <Eyebrow>What it is like</Eyebrow>
        </Reveal>
        <div className="mt-5 space-y-9">
          <Beat title="We show up">
            Sunday, Wednesday and Thursday, eight to midnight Eastern. The same nights every week, so you can
            plan around us and we can plan around you.
          </Beat>
          <Beat title="Nobody hunts alone" delay={80}>
            No single client sees the whole fight, so every log we have merges into one record, and a raider
            who has to fill whatever the raid is short of for the night is never doing it blind.
          </Beat>
          <Beat title="We make a fuss over the kills" delay={160}>
            When Aten Ha Ra went down we made a film of it, with every raider called by name, to a song written
            for the kill.
          </Beat>
          <Beat title="The night is run by volunteers" delay={240}>
            The officers give their evenings to this. A lot of what we have built exists so that
            attendance and loot take them minutes, not their raid.
          </Beat>
        </div>
      </section>

      {/* ── A raid night ── */}
      <section>
        <Reveal>
          <Eyebrow>A raid night</Eyebrow>
          <h2 className={`${DISPLAY} mt-2 text-2xl sm:text-3xl ${WARM}`}>Eight to midnight</h2>
        </Reveal>
        <Reveal delay={100}>
          <ol className="mt-4 list-none">
            {NIGHT.map((n) => (
              <li key={n.when} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-4 border-b border-border/40 py-4 last:border-0 sm:grid-cols-[8rem_minmax(0,1fr)]">
                <span className={`${DISPLAY} text-lg text-[#d29922]`}>{n.when}</span>
                <span className={`${PROSE} text-[0.95rem] leading-7 text-text`}>{n.what}</span>
              </li>
            ))}
          </ol>
        </Reveal>
      </section>

      {/* ── The film ── */}
      <section>
        <Reveal>
          <div className="grid items-center gap-6 sm:grid-cols-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/film/wolfpack-rise-remix.jpg" width={1280} height={720} loading="lazy"
                 alt="The second take of the Wolf Pack Aten Ha Ra film, as its title card"
                 className="aspect-video w-full rounded-lg border border-border object-cover" />
            <div>
              <Eyebrow>Our film</Eyebrow>
              <h2 className={`${DISPLAY} mt-2 text-2xl ${WARM}`}>Aten Ha Ra, in two takes</h2>
              <p className={`${PROSE} mt-3 text-base leading-7 text-text`}>
                A short film of the Vex Thal kill. Two takes of the song, and every raider named in it.
              </p>
              <Link href="/film" className="mt-3 inline-block text-sm text-[#d29922] hover:underline">
                Watch it (members sign in) →
              </Link>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ── Beside us ── */}
      <section>
        <Reveal>
          <Eyebrow>Friends</Eyebrow>
          <p className={`${PROSE} mt-2 max-w-[56ch] text-base leading-7 text-text`}>
            We are not the only pack out there. On the PvP server we fight as part of an alliance of four
            guilds. One night in Vex Thal we wiped the Zek train at the zone in, together.
          </p>
        </Reveal>
      </section>

      {/* ── Getting in ── */}
      <section>
        <Reveal>
          <Eyebrow>Getting in</Eyebrow>
          <h2 className={`${DISPLAY} mt-2 text-2xl sm:text-3xl ${WARM}`}>Three steps</h2>
        </Reveal>
        <Reveal delay={100}>
          <ol className="mt-4 list-none">
            <li className="border-b border-border/40 py-4">
              <div className={`${DISPLAY} text-lg ${WARM}`}>1. Say hello in Discord</div>
              <p className={`${PROSE} mt-1 text-[0.95rem] leading-7 text-text`}>
                Discord is where the guild lives: the board of who is up, the loot auctions, the chatter.{' '}
                {DISCORD_INVITE ? (
                  <a href={DISCORD_INVITE} target="_blank" rel="noreferrer" className="text-[#d29922] hover:underline">
                    Join the Discord.
                  </a>
                ) : (
                  <span className="text-dim">The invite link goes here.</span>
                )}
              </p>
            </li>
            <li className="border-b border-border/40 py-4">
              <div className={`${DISPLAY} text-lg ${WARM}`}>2. Get set up</div>
              <p className={`${PROSE} mt-1 text-[0.95rem] leading-7 text-text`}>
                Mimic is the small app most of us run. It takes about five minutes, once, and{' '}
                <Link href="/start" className="text-[#d29922] hover:underline">the walkthrough</Link> takes you
                through it click by click. It is optional, and you can turn any of it off.
              </p>
            </li>
            <li className="py-4">
              <div className={`${DISPLAY} text-lg ${WARM}`}>3. Come to a raid</div>
              <p className={`${PROSE} mt-1 text-[0.95rem] leading-7 text-text`}>
                Sunday, Wednesday or Thursday, eight o&apos;clock Eastern. Zone in with us.
              </p>
            </li>
          </ol>
        </Reveal>
        <Reveal delay={160}>
          <p className="mt-4 text-xs text-dim">
            A normal night is about <CountUp to={s.raid_avg} /> of us, and the Discord has{' '}
            <CountUp to={s.members} /> members.
          </p>
        </Reveal>
      </section>

      <JoinCall lead="Never hunt alone. AWROOOOOO!" />
    </div>
  );
}
