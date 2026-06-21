// /pvp/hate — Plane of Hate mini-boss tracker (PvP server).
//
// Reads public.hate_kills (Supabase-backed since 2026-06-21). Three blocks:
//
//   1. Spots known down  — assigned rows with an active spawn window; this
//      is the source of truth for "what's already on cooldown".
//   2. Unassigned kills  — auto-broadcast rows where the agent saw a [PVP]
//      echo but no guildmate has clicked which spot died yet. Each card
//      shows the spots that were already down at kill time, directing the
//      user to check the OTHER spots first; clicking a candidate spot here
//      (or in Discord, via the spot-picker buttons) assigns the row and
//      starts its timer. Per the user spec 2026-06-21 — when a foreign
//      guild kills a hate mini, we don't know which spot they hit, but we
//      can narrow it by elimination from what we DO know is down.
//   3. Recent kill log  — full feed (assigned + cleared + unassigned) for
//      the last 30 days, useful for audit + post-mortem.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase-server';
import AssignKillCard from './AssignKillCard';

export const dynamic = 'force-dynamic';

// Keep in lock-step with data/hate-spots.js + utils/hateKills.js
const HATE_SPOTS: Record<number, { label: string; desc: string }> = {
  1:  { label: 'Spot 1 — Organ Hall Upper',    desc: 'First floor, Organ Hall (upstairs)' },
  2:  { label: 'Spot 2 — Organ Hall West',     desc: 'First floor, Organ Hall (west)' },
  3:  { label: 'Spot 3 — East Building Upper', desc: 'First floor, East Building (upstairs)' },
  5:  { label: 'Spot 5 — Church Middle Upper', desc: 'First floor, Church (upstairs middle)' },
  7:  { label: 'Spot 7 — Church South Lower',  desc: 'First floor, Church (downstairs south)' },
  8:  { label: 'Spot 8 — Church South Upper',  desc: 'First floor, Church (upstairs south)' },
  9:  { label: 'Spot 9 — Church West Upper',   desc: 'First floor, Church (upstairs west)' },
  10: { label: 'Spot 10 — 2F North Spawn',     desc: 'Second floor, North spawn' },
  11: { label: 'Spot 11 — 2F East Spawn',      desc: 'Second floor, East spawn' },
  12: { label: 'Spot 12 — 2F South Spawn',     desc: 'Second floor, South spawn' },
};
const ALL_SPOT_NUMS = [1, 2, 3, 5, 7, 8, 9, 10, 11, 12];
const ALL_SPOT_META = ALL_SPOT_NUMS.map(num => ({ num, ...HATE_SPOTS[num] }));

type HateKillRow = {
  id:                     number;
  server:                 'live' | 'pvp';
  spot_num:               number | null;
  killer_name:            string | null;
  killer_guild:           string | null;
  killed_at:              string;
  next_spawn_earliest:    string | null;
  next_spawn_latest:      string | null;
  timer_unknown:          boolean;
  source:                 string;
  raw_text:               string | null;
  notes:                  string | null;
  cleared_at:             string | null;
};

function fmtAgo(ms: number) {
  const diff = Math.max(0, Date.now() - ms);
  const minutes = Math.round(diff / 60000);
  if (minutes < 60)    return `${minutes}m ago`;
  if (minutes < 1440)  return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
}
function fmtIn(ms: number) {
  const diff = ms - Date.now();
  if (diff <= 0) return 'now';
  const minutes = Math.round(diff / 60000);
  if (minutes < 60)    return `in ${minutes}m`;
  if (minutes < 1440)  return `in ${Math.round(minutes / 60)}h`;
  return `in ${Math.round(minutes / 1440)}d`;
}

export default async function HateTrackerPage() {
  // Auth gate — same shape as /me. Anyone signed in via Discord can view.
  const sb = supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/auth/signin?next=/pvp/hate');

  // 96h lookback covers the longest PvP window (72h * 1.2 = 86.4h) plus a
  // few hours of slack. The full log feed widens to 30d.
  const since96h = new Date(Date.now() - 96 * 3600000).toISOString();
  const since30d = new Date(Date.now() - 30 * 86400000).toISOString();

  const { data: activeRows } = await sb
    .from('hate_kills')
    .select('id, server, spot_num, killer_name, killer_guild, killed_at, next_spawn_earliest, next_spawn_latest, timer_unknown, source, raw_text, notes, cleared_at')
    .eq('server', 'pvp')
    .gte('killed_at', since96h)
    .order('killed_at', { ascending: false });
  const { data: logRows } = await sb
    .from('hate_kills')
    .select('id, server, spot_num, killer_name, killer_guild, killed_at, next_spawn_earliest, next_spawn_latest, timer_unknown, source, raw_text, notes, cleared_at')
    .eq('server', 'pvp')
    .gte('killed_at', since30d)
    .order('killed_at', { ascending: false })
    .limit(100);

  const active = (activeRows ?? []) as HateKillRow[];
  const log    = (logRows ?? []) as HateKillRow[];
  const now    = Date.now();

  // Per-spot "current state" = the latest active assigned row, mirroring
  // utils/hateKills.getSpotStateForServer's selection rule. Active = NOT
  // cleared AND (timer unknown OR next_spawn_latest in the future).
  const spotState = new Map<number, HateKillRow>();
  for (const r of active) {
    if (r.spot_num == null || r.cleared_at) continue;
    const stillActive = r.timer_unknown ||
      (r.next_spawn_latest && Date.parse(r.next_spawn_latest) > now);
    if (!stillActive) continue;
    if (!spotState.has(r.spot_num)) spotState.set(r.spot_num, r);
  }
  const knownDownSpotNums = Array.from(spotState.keys()).sort((a, b) => a - b);

  // Unassigned auto-broadcast rows are the call-to-action stack. We cap at
  // the ones still within their possible spawn window — older ones are
  // historical noise (the boss would've respawned already).
  const unassigned = active
    .filter(r => r.spot_num == null && !r.cleared_at && r.source !== 'manual_slash')
    .filter(r => {
      // Cull foreign-instance kills older than 72h * 1.2 — they can't be
      // affecting current spawn windows. Open-world ones with no notes get
      // the same treatment.
      const ageH = (now - Date.parse(r.killed_at)) / 3600000;
      return ageH <= 72 * 1.2;
    });

  // For each unassigned kill, compute which spots were ALREADY down at the
  // moment of its kill — that's the "probably elsewhere" prompt per the
  // user spec. For a kill at time T, a spot was "already down" if any
  // row for that spot had killed_at < T AND next_spawn_latest > T.
  const downAtTime = (atMs: number): number[] => {
    const set = new Set<number>();
    for (const r of active) {
      if (r.spot_num == null || r.cleared_at) continue;
      const killedAtMs = Date.parse(r.killed_at);
      if (killedAtMs >= atMs) continue;
      if (!r.next_spawn_latest) continue;
      if (Date.parse(r.next_spawn_latest) <= atMs) continue;
      set.add(r.spot_num);
    }
    return Array.from(set).sort((a, b) => a - b);
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 text-zinc-100">
      <div className="mb-1 flex items-center gap-3">
        <Link href="/pvp" className="text-sm text-zinc-400 hover:text-zinc-200">← /pvp</Link>
        <h1 className="text-2xl font-semibold">Plane of Hate — PvP Tracker</h1>
      </div>
      <p className="mb-6 text-sm text-zinc-500">
        10 mini-boss spots · 72h ±20% respawn · auto-fed by the Mimic agent from [PVP] channel echoes.
        Spawns reshuffle when nobody's in zone, so the same spot can host different mini-bosses across kills.
      </p>

      {/* ─── Section 1: spots known down ─────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
          Spots known down ({knownDownSpotNums.length} of 10)
        </h2>
        {knownDownSpotNums.length === 0 ? (
          <div className="rounded border border-zinc-800 bg-zinc-900/40 p-3 text-sm text-zinc-500">
            No spots currently tracked as down. Treat all 10 as candidates when assigning kills below.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {knownDownSpotNums.map(n => {
              const r = spotState.get(n)!;
              const earliestMs = r.next_spawn_earliest ? Date.parse(r.next_spawn_earliest) : null;
              const latestMs   = r.next_spawn_latest   ? Date.parse(r.next_spawn_latest)   : null;
              const desc = HATE_SPOTS[n];
              return (
                <div key={n} className="rounded border border-rose-800/60 bg-rose-950/30 p-2.5 text-sm">
                  <div className="flex items-baseline justify-between">
                    <span className="font-semibold text-rose-200">#{n} {desc.label.replace(/^Spot \d+ — /, '')}</span>
                    {r.killer_name && (
                      <span className="text-xs text-rose-300/80">
                        killed by {r.killer_name}
                        {r.killer_guild && <> &lt;{r.killer_guild}&gt;</>}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-zinc-400">{desc.desc}</div>
                  {r.timer_unknown ? (
                    <div className="mt-1 text-xs text-zinc-300">❓ Timer unknown — check manually.</div>
                  ) : (
                    <div className="mt-1 text-xs text-zinc-300">
                      {earliestMs && latestMs && earliestMs <= now && latestMs > now
                        ? <>🟡 Window open · latest {fmtIn(latestMs)}</>
                        : <>⏰ Earliest {earliestMs ? fmtIn(earliestMs) : '?'} · Latest {latestMs ? fmtIn(latestMs) : '?'}</>
                      }
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ─── Section 2: unassigned kills ─────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
          Unassigned kills · needs spot ({unassigned.length})
        </h2>
        {unassigned.length === 0 ? (
          <div className="rounded border border-zinc-800 bg-zinc-900/40 p-3 text-sm text-zinc-500">
            No unassigned kills. Foreign-guild and own-guild [PVP] echoes will appear here for spot assignment.
          </div>
        ) : (
          <div className="space-y-2">
            {unassigned.map(r => {
              const downSet  = new Set(downAtTime(Date.parse(r.killed_at)));
              const knownDown = ALL_SPOT_META.filter(s => downSet.has(s.num));
              const candidates = ALL_SPOT_META.filter(s => !downSet.has(s.num));
              return (
                <AssignKillCard
                  key={r.id}
                  killId={r.id}
                  killer={r.killer_name}
                  killerGuild={r.killer_guild}
                  boss={r.raw_text ? extractBossFromRaw(r.raw_text) : null}
                  zone="Plane of Hate"
                  killedAt={r.killed_at}
                  instanced={!!(r.notes && /instanced/i.test(r.notes))}
                  knownDownSpots={knownDown}
                  candidateSpots={candidates}
                  allSpots={ALL_SPOT_META}
                />
              );
            })}
          </div>
        )}
      </section>

      {/* ─── Section 3: recent kill log ─────────────────────────────────── */}
      <section className="mb-12">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
          Recent kill log · last 30 days ({log.length})
        </h2>
        <div className="overflow-x-auto rounded border border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-900/60 text-xs uppercase tracking-wide text-zinc-400">
              <tr>
                <th className="px-2 py-1.5">When</th>
                <th className="px-2 py-1.5">Spot</th>
                <th className="px-2 py-1.5">Killer</th>
                <th className="px-2 py-1.5">Guild</th>
                <th className="px-2 py-1.5">Boss</th>
                <th className="px-2 py-1.5">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/80">
              {log.map(r => (
                <tr key={r.id} className={r.cleared_at ? 'text-zinc-500' : ''}>
                  <td className="px-2 py-1.5 whitespace-nowrap">{fmtAgo(Date.parse(r.killed_at))}</td>
                  <td className="px-2 py-1.5">{r.spot_num != null ? `#${r.spot_num}` : '—'}</td>
                  <td className="px-2 py-1.5">{r.killer_name ?? '—'}</td>
                  <td className="px-2 py-1.5">{r.killer_guild ?? '—'}</td>
                  <td className="px-2 py-1.5">{r.raw_text ? extractBossFromRaw(r.raw_text) ?? '—' : '—'}</td>
                  <td className="px-2 py-1.5 text-xs text-zinc-500">
                    {r.source.replace(/_/g, ' ')}
                    {r.notes && <span className="ml-1 italic">({r.notes})</span>}
                    {r.cleared_at && <span className="ml-1 text-emerald-500">cleared</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// "Singzu of <Freedom> has killed Lord of Ire in Plane of Hate (Instanced)!"
// → "Lord of Ire". Returns null if we can't pluck it; the row's still
// renderable, the boss column just shows —.
function extractBossFromRaw(raw: string): string | null {
  const m = /has killed (.+?)(?: in [^!]+)?!/i.exec(raw);
  return m ? m[1].trim() : null;
}
