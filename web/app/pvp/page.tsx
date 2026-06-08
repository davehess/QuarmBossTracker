// /pvp — PvP kill leaderboard. One row per Wolf Pack killer: total kills
// (raw) and, in parens, the number of UNIQUE victims. Pet kills are credited
// to the owner with an asterisk on the row.
//
// Deaths (how often a killer has BEEN killed) are deliberately NOT shown here
// — that's private to the logged-in owner on their own /pvp/[name] page.
//
// Data comes from pvp_kills, fed live by the PvP Druzzil broadcast relay and
// (later) historical log backfill.

import Link from 'next/link';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { userTz, fmtDateOnly } from '@/lib/timezone';

export const dynamic = 'force-dynamic';

type KillRow = {
  killer: string;
  victim: string;
  via_pet: boolean;
  killed_at: string;
};

type LeaderboardRow = {
  killer:   string;
  total:    number;
  unique:   number;
  petKills: number;
  assists:  number;
  last:     string;
};
type SortKey = 'total' | 'unique' | 'assists' | 'last';

async function loadLeaderboard(sortKey: SortKey) {
  const sb = supabaseAdmin();
  // Ownership = "is the killer currently a Wolf Pack character", NOT "was the
  // killer's pvp_kills.killer_guild equal to 'Wolf Pack' at the time of the
  // broadcast". Older broadcasts had no guild suffix and members who
  // transferred IN from other guilds carry their prior guild on their old
  // rows — both cases would silently drop from the leaderboard otherwise.
  // (Concrete example: Malthur, 218 kills, 144 stamped 'Wolf Pack', 62 stamped
  // his prior guild Tranquility, 12 NULL — the broken filter showed 144 then
  // 73 once a partial fetch landed.) Filter by roster membership instead.
  //
  // We also pull main_name so each alt's kills fold up under their main on the
  // leaderboard. Concrete case: Adiwen (Wabumkin's alt) had her 1 kill listed
  // separately from Wabumkin's 19; we want one "Wabumkin · 20" row.
  const { data: roster } = await sb
    .from('characters')
    .select('name, main_name')
    .eq('guild_id', 'wolfpack');
  const rosterRows = (roster ?? []) as { name: string; main_name: string | null }[];
  const rosterNames = rosterRows.map(r => r.name);
  if (rosterNames.length === 0) return { rows: [] as LeaderboardRow[], error: null as string | null };

  // lowercase(any name) → main display name. Falls back to itself when no
  // main is set or when an alt's main_name doesn't resolve to a known char.
  const nameByLower = new Map(rosterRows.map(r => [r.name.toLowerCase(), r.name] as const));
  const mainFor = (n: string): string => {
    const lower = n.toLowerCase();
    const row   = rosterRows.find(r => r.name.toLowerCase() === lower);
    if (!row?.main_name) return nameByLower.get(lower) ?? n;
    return nameByLower.get(row.main_name.toLowerCase()) ?? row.main_name;
  };

  // Two queries in parallel — kills (the existing source-of-truth ledger) and
  // assists (the new pvp_assists table populated by the agent's correlation).
  // Merge by killer name into one row per character.
  const [killRes, assistRes] = await Promise.all([
    sb.from('pvp_kills')
      .select('killer, victim, via_pet, killed_at')
      .eq('guild_id', 'wolfpack')
      .in('killer', rosterNames)
      .order('killed_at', { ascending: false })
      .limit(20000),
    sb.from('pvp_assists')
      .select('assister')
      .eq('guild_id', 'wolfpack')
      .in('assister', rosterNames)
      .limit(20000),
  ]);
  if (killRes.error) return { rows: [] as LeaderboardRow[], error: killRes.error.message };

  const byKiller = new Map<string, {
    killer: string;
    total: number;
    victims: Set<string>;
    petKills: number;
    assists: number;
    last: string;
  }>();
  for (const k of (killRes.data ?? []) as KillRow[]) {
    // Fold alts into their main — leaderboard row is keyed on the family head,
    // not the individual character. mainFor() falls back to the raw name when
    // there's no main_name, so non-alts keep their own row.
    const display = mainFor(k.killer);
    const key = display.toLowerCase();
    let e = byKiller.get(key);
    if (!e) { e = { killer: display, total: 0, victims: new Set(), petKills: 0, assists: 0, last: k.killed_at }; byKiller.set(key, e); }
    e.total += 1;
    e.victims.add(k.victim.toLowerCase());
    if (k.via_pet) e.petKills += 1;
    if (k.killed_at > e.last) e.last = k.killed_at;
  }
  // Fold in assists. Assisters who have no kills still appear on the board
  // (set total=0 etc.) so the assists-leaders aren't hidden under a kills gate.
  for (const a of (assistRes.data ?? []) as { assister: string }[]) {
    const display = mainFor(a.assister);
    const key = display.toLowerCase();
    let e = byKiller.get(key);
    if (!e) { e = { killer: display, total: 0, victims: new Set(), petKills: 0, assists: 0, last: '' }; byKiller.set(key, e); }
    e.assists += 1;
  }
  const rows: LeaderboardRow[] = [...byKiller.values()].map(e => ({
    killer: e.killer, total: e.total, unique: e.victims.size, petKills: e.petKills, assists: e.assists, last: e.last,
  }));
  rows.sort((a, b) => {
    if (sortKey === 'assists') return b.assists - a.assists || b.total - a.total;
    if (sortKey === 'unique')  return b.unique  - a.unique  || b.total - a.total;
    if (sortKey === 'last')    return (b.last || '').localeCompare(a.last || '');
    return b.total - a.total || b.unique - a.unique;   // default
  });
  return { rows, error: null as string | null };
}

// Latest kill per boss (dedup by boss_id, keep the most recent killed_at). The
// bot mirrors every Druzzil-broadcast PvP-server boss kill into pvp_boss_kills
// with the +/-20% spawn window baked into spawn_earliest / spawn_latest. We
// pull a generous slice (last 90 days, sorted newest-first) and collapse in JS
// so we always show the latest known timer per boss — no stale display when
// the same boss was killed twice in the window.
type BossKill = {
  boss_id: string;
  boss_name: string;
  zone: string | null;
  timer_hours: number;
  killed_at: string;
  killed_by: string | null;
  killed_by_guild: string | null;
  spawn_earliest: string;
  spawn_latest: string;
  spawn_earliest_override: string | null;
};
async function loadBossTimers(): Promise<BossKill[]> {
  const sb = supabaseAdmin();
  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
  const { data } = await sb
    .from('pvp_boss_kills')
    .select('boss_id, boss_name, zone, timer_hours, killed_at, killed_by, killed_by_guild, spawn_earliest, spawn_latest, spawn_earliest_override')
    .eq('guild_id', 'wolfpack')
    .gte('killed_at', since)
    .order('killed_at', { ascending: false })
    .limit(2000);
  const seen = new Set<string>();
  const out: BossKill[] = [];
  for (const r of (data ?? []) as BossKill[]) {
    if (seen.has(r.boss_id)) continue;
    seen.add(r.boss_id);
    out.push(r);
  }
  // Sort by spawn_earliest ascending → "soonest spawns first" up top, then
  // "already-open" rows (spawn_latest passed) drop to the bottom.
  const now = Date.now();
  out.sort((a, b) => {
    const aOpen = new Date(a.spawn_latest).getTime() < now;
    const bOpen = new Date(b.spawn_latest).getTime() < now;
    if (aOpen !== bOpen) return aOpen ? 1 : -1;
    // A quake override (window opened "now") makes earliest = override.
    const aE = new Date(a.spawn_earliest_override ?? a.spawn_earliest).getTime();
    const bE = new Date(b.spawn_earliest_override ?? b.spawn_earliest).getTime();
    return aE - bE;
  });
  return out;
}

function fmtCountdown(toIso: string, fromMs: number = Date.now()): string {
  const diff = new Date(toIso).getTime() - fromMs;
  const abs  = Math.abs(diff);
  const d = Math.floor(abs / 86400000);
  const h = Math.floor((abs % 86400000) / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0 || d > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return (diff < 0 ? '-' : '') + parts.join(' ');
}

export default async function PvpPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/pvp');

  const sp = await searchParams;
  const sortKey: SortKey = (
    sp?.sort === 'assists' || sp?.sort === 'unique' || sp?.sort === 'last'
      ? sp.sort
      : 'total'
  );

  const tz = await userTz();
  const [{ rows, error }, bossTimers] = await Promise.all([
    loadLeaderboard(sortKey),
    loadBossTimers(),
  ]);
  if (error) {
    return (
      <div className="bg-panel border border-red rounded-lg p-4 text-red text-sm font-mono">
        Failed to load PvP data: {error}
      </div>
    );
  }

  const totalKills = rows.reduce((s, r) => s + r.total, 0);

  return (
    <div className="space-y-6">
      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-2xl text-gold flex items-center gap-3">
          <span aria-hidden>⚔️</span>
          <span>PvP Kills</span>
        </h2>
        <p className="text-sm text-dim mt-2">
          Wolf Pack PvP kill leaderboard. Each row shows total kills and, in
          parentheses, the number of unique players killed. <span className="text-orange">*</span> marks
          rows where a pet landed the kill (credited to the owner). Click a name
          for the full kill history — your own deaths are visible only to you.
        </p>
        <div className="text-xs text-dim mt-2 flex items-center gap-3 flex-wrap">
          <span>{rows.length} killer{rows.length === 1 ? '' : 's'} · {totalKills} total kill{totalKills === 1 ? '' : 's'}</span>
          <Link href="/pvp/server" className="text-blue hover:underline">See the server-wide top 10 →</Link>
        </div>
      </section>

      <section className="bg-panel border border-border rounded-lg p-4">
        {rows.length === 0 ? (
          <div className="text-sm text-dim italic">
            No PvP kills recorded yet. Kills land here from the PvP channel relay
            as they happen (and from historical log backfill once that runs).
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-dim text-left">
              <tr className="border-b border-border">
                <th className="py-1 pr-2 w-8">#</th>
                <th className="py-1 pr-2">Killer</th>
                <th className="py-1 pr-2 text-right">
                  <Link href="/pvp?sort=total" className={`hover:text-blue ${sortKey === 'total' ? 'text-text' : ''}`}>
                    Kills {sortKey === 'total' && '▾'}
                  </Link>
                  {' '}
                  <Link href="/pvp?sort=unique" className={`hover:text-blue text-[10px] ${sortKey === 'unique' ? 'text-text' : ''}`} title="Sort by unique victims">
                    (unique{sortKey === 'unique' && ' ▾'})
                  </Link>
                </th>
                <th
                  className="py-1 pr-2 text-right"
                  title="Wayne Gretzky scored 894 goals, but he had 1,963 assists."
                >
                  <Link href="/pvp?sort=assists" className={`hover:text-blue ${sortKey === 'assists' ? 'text-text' : ''}`}>
                    Assists {sortKey === 'assists' && '▾'}
                  </Link>
                </th>
                <th className="py-1 pr-2 text-right">
                  <Link href="/pvp?sort=last" className={`hover:text-blue ${sortKey === 'last' ? 'text-text' : ''}`}>
                    Last kill {sortKey === 'last' && '▾'}
                  </Link>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.killer} className="border-b border-border/30 hover:bg-[#1a212c]">
                  <td className="py-1 pr-2 text-dim">{i + 1}</td>
                  <td className="py-1 pr-2">
                    <Link href={`/pvp/${encodeURIComponent(r.killer)}`} className="text-text hover:text-blue hover:underline">
                      {r.killer}
                    </Link>
                    {/* No per-row pet asterisk on the leaderboard — the
                        breakdown lives on the per-character page (each kill
                        row carries its own * with the pet's name in the
                        tooltip). The aggregate flag here was just noise. */}
                  </td>
                  <td className="py-1 pr-2 text-right text-text">
                    {r.total} <span className="text-dim">({r.unique})</span>
                  </td>
                  <td
                    className="py-1 pr-2 text-right text-text"
                    title="Wayne Gretzky scored 894 goals, but he had 1,963 assists."
                  >
                    {r.assists > 0 ? r.assists : <span className="text-dim">—</span>}
                  </td>
                  <td className="py-1 pr-2 text-right text-dim">
                    {r.last ? fmtDateOnly(r.last, tz) : <span className="text-dim/60">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Boss timers — PvP-server spawn windows fed by the bot from Druzzil
          broadcasts and manual /pvpkill. Sorted soonest-spawning first; rows
          where the spawn window is already open drop to the bottom. */}
      {bossTimers.length > 0 && (
        <section className="bg-panel border border-border rounded-lg p-6">
          <h2 className="text-xl text-gold flex items-center gap-3">
            <span aria-hidden>⏰</span>
            <span>PvP Boss Timers</span>
          </h2>
          <p className="text-sm text-dim mt-2">
            Respawn windows for PvP-server bosses with a ±20% variance applied
            to the base timer. Fed live by Druzzil broadcasts in <code className="text-text">#pvp</code> and by
            manual <code className="text-text">/pvpkill</code>. Sorted by earliest spawn; rows whose window has
            already opened drop to the bottom (mob is in <span className="text-green">camp now</span>).
          </p>
          <div className="text-xs text-dim mt-2">
            {bossTimers.length} boss{bossTimers.length === 1 ? '' : 'es'} tracked · last kill {fmtDateOnly(bossTimers[0].killed_at, tz)}
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-dim text-left">
                <tr className="border-b border-border">
                  <th className="py-1 pr-2">Boss</th>
                  <th className="py-1 pr-2">Zone</th>
                  <th className="py-1 pr-2 text-right">Killed</th>
                  <th className="py-1 pr-2 text-right">Earliest spawn</th>
                  <th className="py-1 pr-2 text-right">Latest spawn</th>
                  <th className="py-1 pr-2">Killed by</th>
                </tr>
              </thead>
              <tbody>
                {bossTimers.map(b => {
                  const now = Date.now();
                  // Quake override opens the early edge to "now" while keeping latest.
                  const earliestIso = b.spawn_earliest_override ?? b.spawn_earliest;
                  const earliestMs = new Date(earliestIso).getTime();
                  const latestMs   = new Date(b.spawn_latest).getTime();
                  const isOpen    = latestMs   < now;          // window already passed → mob is up
                  const inWindow  = earliestMs <= now && !isOpen; // spawning now-ish
                  const colorEarliest = inWindow ? 'text-orange' : isOpen ? 'text-green' : 'text-text';
                  return (
                    <tr key={b.boss_id} className="border-b border-border/30 hover:bg-[#1a212c]">
                      <td className="py-1 pr-2 text-text">{b.boss_name}</td>
                      <td className="py-1 pr-2 text-dim">{b.zone ?? '—'}</td>
                      <td className="py-1 pr-2 text-right text-dim">{fmtDateOnly(b.killed_at, tz)}</td>
                      <td className={`py-1 pr-2 text-right ${colorEarliest}`}>
                        {isOpen ? (
                          <span title="Spawn window already opened — mob may be up">camp now</span>
                        ) : inWindow ? (
                          <span title={`window opened ${fmtCountdown(earliestIso)} ago`}>open · {fmtCountdown(earliestIso)}</span>
                        ) : (
                          <span title={new Date(earliestIso).toLocaleString()}>in {fmtCountdown(earliestIso)}</span>
                        )}
                      </td>
                      <td className="py-1 pr-2 text-right text-dim" title={new Date(b.spawn_latest).toLocaleString()}>
                        {isOpen ? 'opened' : `+${fmtCountdown(b.spawn_latest, earliestMs)}`}
                      </td>
                      <td className="py-1 pr-2 text-dim">
                        {b.killed_by
                          ? <>{b.killed_by}{b.killed_by_guild ? <span className="text-dim/70"> of &lt;{b.killed_by_guild}&gt;</span> : null}</>
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Trophy wall — bottom of the page on purpose. Stats answer "who's
          winning the season"; these answer "what does winning look like."
          The full battlefield panorama gets pride of place; the close-up
          GIF (Dread + Owl standing over Meatyocre) sits beside it as the
          single-frame summary of the same outcome. */}
      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold flex items-center gap-3">
          <span aria-hidden>🏆</span>
          <span>For the Pack</span>
        </h2>
        <p className="text-sm text-dim mt-2">
          A field of corpses, courtesy of the Pack. Pinned here because the
          numbers above don&apos;t do it justice on their own.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-[2fr_1fr]">
          <figure className="m-0">
            <Image
              src="/pvp/wolf-pack-victory.png"
              alt="Wolf Pack members standing over a field of enemy corpses after a PvP fight"
              width={1280}
              height={720}
              className="w-full h-auto rounded border border-border"
              sizes="(min-width: 768px) 66vw, 100vw"
            />
            <figcaption className="text-xs text-dim mt-2">
              After the dust settled. Corpses include Tweeder, Mestyocre, Stratus, Jaggs, Celone, and friends.
            </figcaption>
          </figure>
          <figure className="m-0">
            {/* GIFs are not optimized through next/image — use a plain <img> so
                the animation plays. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/pvp/dread-and-owl.gif"
              alt="Duke Malthur Dreadscale the Damned and Venerable Timbber Owl of the Wolf Pack, with Meatyocre dead at their feet"
              className="w-full h-auto rounded border border-border"
              loading="lazy"
            />
            <figcaption className="text-xs text-dim mt-2">
              Dread &amp; Owl, Meatyocre at their feet.
            </figcaption>
          </figure>
        </div>
      </section>
    </div>
  );
}
