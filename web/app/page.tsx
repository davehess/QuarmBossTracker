// Landing page — the only public marketing surface. Persuade: a prospective
// member or a returning raider decides this guild is worth their Sunday.
//
// Redesigned 2026-08-28 under the direction contract in app/layout.tsx
// (seed 29c36e6b): an engraved specimen plate on the night ground the audience
// already reads on. The proof is the live ledger, not adjectives.
//
// The signed-in data widgets are unchanged in behaviour — Recent Kills is still
// gated, still curated-boss filtered, still the viewer's timezone.
import Link from 'next/link';
import WolfPack from '@/components/WolfPack';
import { IconParse, IconTimer, IconBlades, IconRank, IconMap, IconSpark } from '@/components/PlateIcons';
import { PlatformMap, PlatformStats } from '@/components/PlatformMap';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { curatedNpcIds } from '@/lib/bossFilter';
import { fmtDmg, fmtTime, dayKey, dayLabel, cleanBossName } from '@/lib/format';
import { userTz } from '@/lib/timezone';

export const dynamic = 'force-dynamic';

type RecentRow = {
  id: string;
  started_at: string;
  total_damage: number;
  eqemu_npc_types: { name: string } | null;
};

async function loadRecent() {
  try {
    const sb = supabaseAdmin();
    // Curated bosses only — same filter as /parses, or the widget fills with
    // whatever someone farmed overnight (Hitya 2026-08-19).
    const curated = await curatedNpcIds(sb);
    const { data } = await sb
      .from('encounters')
      .select('id, started_at, total_damage, eqemu_npc_types ( name )')
      .gt('total_damage', 0)
      .in('npc_id', curated)
      .order('started_at', { ascending: false })
      .limit(6);
    return (data as unknown as RecentRow[]) ?? [];
  } catch { return []; }
}

const SURFACES = [
  { href: '/parses',       Icon: IconParse,  name: 'Parses',
    line: 'Every kill grouped by night and zone — damage, healing, deaths, and what dropped.' },
  { href: '/boards',       Icon: IconTimer,  name: 'Boards',
    line: 'Live raid-boss spawn timers across every expansion, and what is coming in the next 24 hours.' },
  { href: '/pvp',          Icon: IconBlades, name: 'PvP',
    line: 'Kill records per character, assists, and spawn windows on the PvP server.' },
  { href: '/leaderboards', Icon: IconRank,   name: 'Ranks',
    line: 'Top parses, raid attendance, and DKP spent over the last thirty days.' },
];

export default async function HomePage() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  const recent = user ? await loadRecent() : [] as RecentRow[];
  const tz = await userTz();   // viewer's chosen zone (wp_tz cookie) → all times below

  return (
    <div className="[--wolf-line:#e8e2d4]">

      {/* ── The plate ──────────────────────────────────────────────────── */}
      {/* The plate is symmetric and frontal, so the type is centred on its axis.
          Left-aligned type beside a centred wolf read as two unrelated objects
          — the first render proved it. */}
      <section className="relative isolate -mx-3 sm:-mx-4">
        {/* Sized for the BOLD mark. The earlier thin wolf could run 1040px
            wide; these filled forms carry far more weight, and at that size the
            ears alone filled the viewport while the face fell below the fold. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 mx-auto w-[104%] max-w-[600px] sm:w-[66%]">
          <WolfPack />
        </div>
        {/* Clears the type without erasing her: transparent across the ears and
            eyes, opaque where the headline lands. */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-bg/60 via-62% to-bg" />

        <div className="relative px-4 pt-[74vw] pb-10 text-center sm:pt-[40vw] sm:pb-14 lg:pt-[25rem]">
          <h1 className="font-[family-name:var(--font-display)] mx-auto text-[clamp(2rem,7vw,4.25rem)] leading-[1.04] tracking-[-0.02em] text-[#f2ede1] text-balance max-w-[18ch]">
            One wolf sees a fight.<br />The pack sees the raid.
          </h1>
          <p className="font-[family-name:var(--font-prose)] mx-auto mt-5 max-w-[58ch] text-[1.0625rem] leading-7 text-text">
            Forty people log the same four hours from forty different places on the
            field. Wolf Pack merges them into one record — who did the damage, who
            held the chain together, who was standing where when it went wrong.
            No single client can see it. This is where it lives afterwards.
          </p>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            {user ? (
              <Link href="/me" className="no-underline rounded-md bg-[#d29922] px-5 py-2.5 text-sm font-semibold text-[#1a1206] transition-colors hover:bg-[#e0a92c]">
                Your record
              </Link>
            ) : (
              <Link href="/auth/signin" className="no-underline rounded-md bg-[#d29922] px-5 py-2.5 text-sm font-semibold text-[#1a1206] transition-colors hover:bg-[#e0a92c]">
                Sign in with Discord
              </Link>
            )}
            <Link href="/platform" className="no-underline rounded-md border border-border px-5 py-2.5 text-sm text-text transition-colors hover:border-[#d29922] hover:text-[#f2ede1]">
              See everything it tracks
            </Link>
          </div>
        </div>
      </section>

      {/* ── The proof ──────────────────────────────────────────────────── */}
      {recent.length > 0 && (
        <section className="mt-2 border-t border-border/70 pt-6">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="font-[family-name:var(--font-display)] text-xl text-[#f2ede1]">Last six kills</h2>
            <Link href="/parses" className="text-xs text-dim no-underline transition-colors hover:text-[#d29922]">
              all parses →
            </Link>
          </div>
          <ol className="mt-4">
            {recent.map((r) => (
              <li key={r.id} className="border-b border-border/40 last:border-0">
                <Link href={`/parses/${r.id}`}
                      className="group flex items-baseline justify-between gap-4 py-2.5 no-underline">
                  <span className="min-w-0 truncate">
                    <span className="font-[family-name:var(--font-prose)] text-[0.95rem] text-[#e8e2d4] transition-colors group-hover:text-[#d29922]">
                      {cleanBossName(r.eqemu_npc_types?.name)}
                    </span>
                    <span className="ml-2 text-xs text-dim">
                      {dayLabel(dayKey(r.started_at, tz), tz)} · {fmtTime(r.started_at, tz)}
                    </span>
                  </span>
                  <span className="tnum whitespace-nowrap text-sm text-[#d29922]">{fmtDmg(r.total_damage)}</span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Signed-out visitors get the map here — the "what IS all of this?"
          answer without having to find /platform first. */}
      {!user && (
        <section className="mt-2 border-t border-border/70 pt-6">
          <h2 className="font-[family-name:var(--font-display)] flex items-center gap-2 text-xl text-[#f2ede1]">
            <IconMap className="text-[#d29922]" /> The whole platform
          </h2>
          <div className="mt-4 overflow-x-auto">
            <div className="min-w-[760px]"><PlatformMap anchorBase="/platform" /></div>
          </div>
          <div className="pb-1 pt-3"><PlatformStats /></div>
          <p className="mt-3 text-xs">
            <Link href="/platform" className="text-dim no-underline transition-colors hover:text-[#d29922]">
              every branch, how it grew, and what it does not collect →
            </Link>
          </p>
        </section>
      )}

      {/* ── Where to go ────────────────────────────────────────────────── */}
      <section className="mt-8 border-t border-border/70 pt-6">
        <ul>
          {SURFACES.map(({ href, Icon, name, line }) => (
            <li key={href} className="border-b border-border/40 last:border-0">
              <Link href={href} className="group flex items-start gap-4 py-4 no-underline">
                <Icon className="mt-0.5 shrink-0 text-dim transition-colors group-hover:text-[#d29922]" />
                <span className="min-w-0">
                  <span className="font-[family-name:var(--font-display)] block text-lg text-[#e8e2d4] transition-colors group-hover:text-[#d29922]">
                    {name}
                  </span>
                  <span className="font-[family-name:var(--font-prose)] mt-0.5 block max-w-[68ch] text-sm leading-6 text-dim">
                    {line}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8 flex flex-col gap-3 border-t border-border/70 pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-[family-name:var(--font-prose)] max-w-[58ch] text-sm leading-6 text-dim">
          {user
            ? 'Built and maintained in the open — the methodology, the mistakes, and what the agents are allowed to touch.'
            : 'Parses, ranks, and per-character history need a Wolf Pack Discord sign-in. The platform map above is open to anyone.'}
        </p>
        <Link href="/ai" className="inline-flex shrink-0 items-center gap-2 text-sm text-dim no-underline transition-colors hover:text-[#d29922]">
          <IconSpark /> How this is built with AI
        </Link>
      </section>
    </div>
  );
}
