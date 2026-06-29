// Compact encounter summary card. Links to /parses/[id] for the full breakdown.
// Non-kill classifications (wipe / live / pvp / test) render with a colored
// chip in the title row and dimmed card body so officers can spot them at a
// glance on a busy raid night. Officer admin actions hook in via `adminBar`
// (any node — rendered OUTSIDE the link wrapper so form submits don't navigate).
import Link from 'next/link';
import type { ReactNode } from 'react';
import { fmtDmg, fmtDuration, fmtTime } from '@/lib/format';

export type KillCardData = {
  id: string;
  started_at: string;
  duration_sec: number | null;
  total_damage: number;
  total_dps: number;
  boss_name: string;
  player_count: number;
  top_players: { character_name: string; total_damage: number; dps: number }[];
  classification?: string | null;
  // True ⇒ encounter is still ENGAGED (no slain line observed yet — encounters.ended_at
  // is null). Drives the "ENGAGED" badge + sort-to-top on /parses.
  inProgress?: boolean;
};

// One place that owns the chip styling so the listing card + detail page show
// identical pills. Keep these values aligned with the encounters.classification
// CHECK constraint in supabase/migrations.
const CHIP: Record<string, { label: string; cls: string; title: string }> = {
  wipe: { label: 'WIPE',  cls: 'bg-orange/20 text-orange border-orange/40',
          title: 'Engaged but did not kill — excluded from kill counts' },
  live: { label: 'LIVE',  cls: 'bg-blue/20   text-blue   border-blue/40',
          title: 'Live server, not guild instance — excluded from kill counts' },
  pvp:  { label: 'PVP',   cls: 'bg-red/20    text-red    border-red/40',
          title: 'PvP / Zek server — excluded from kill counts' },
  test: { label: 'TEST',  cls: 'bg-dim/20    text-dim    border-dim/40',
          title: 'Practice / dummy pull — excluded from kill counts' },
};

export function ClassificationChip({ classification }: { classification: string | null | undefined }) {
  if (!classification) return null;
  const c = CHIP[classification];
  if (!c) return null;
  return (
    <span
      title={c.title}
      className={`text-[9px] uppercase tracking-wide font-semibold px-1 py-px rounded border ${c.cls}`}
    >
      {c.label}
    </span>
  );
}

// `tz` is the viewer's chosen zone (wp_tz cookie, resolved server-side and
// passed down). Omitted → fmtTime falls back to RAID_TZ (Eastern). Passing the
// same resolved value on server + client keeps the rendered string identical,
// so there's no hydration mismatch.
export default function KillCard({ kill, adminBar, tz }: { kill: KillCardData; adminBar?: ReactNode; tz?: string }) {
  const top = kill.top_players.slice(0, 5);
  const extra = kill.player_count - top.length;
  const dim = !!kill.classification;   // not a guild kill — visually de-emphasize

  // Show when the boss DIED (fight start + duration), not when it was engaged.
  // started_at is fight-START, which mis-orders gated/overlapping fights (e.g.
  // Emperor Ssraeshza is engaged before the Blood add that gates it but dies
  // after). No stored ended_at, so we derive it.
  const killAt = kill.duration_sec
    ? new Date(new Date(kill.started_at).getTime() + kill.duration_sec * 1000).toISOString()
    : kill.started_at;

  return (
    <div className={`bg-panel border ${kill.inProgress ? 'border-orange/60' : 'border-border'} rounded-lg ${dim ? 'opacity-75' : ''}`}>
      <Link
        href={`/parses/${kill.id}`}
        className="block p-3 hover:border-blue hover:bg-[#1a212c] transition-colors no-underline rounded-lg"
      >
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <div className="text-gold text-sm font-medium truncate flex items-center gap-2 min-w-0" title={kill.boss_name}>
            <span className="truncate">{kill.boss_name}</span>
            <ClassificationChip classification={kill.classification} />
            {kill.inProgress && (
              <span
                className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded border bg-orange/20 text-orange border-orange/50 animate-pulse"
                title="Encounter is still in progress — no slain line observed yet. The boss timer is NOT set yet."
              >ENGAGED</span>
            )}
          </div>
          <div
            className="text-dim text-xs whitespace-nowrap"
            title={kill.inProgress
              ? `engaged ${fmtTime(kill.started_at, tz)} · last upload ${fmtDuration(kill.duration_sec)} in`
              : `killed ~${fmtTime(killAt, tz)} · engaged ${fmtTime(kill.started_at, tz)} (${fmtDuration(kill.duration_sec)})`}
          >
            {kill.inProgress ? `engaged ${fmtTime(kill.started_at, tz)}` : fmtTime(killAt, tz)}
          </div>
        </div>

        <div className="text-xs text-dim mb-2 flex gap-3">
          <span>{fmtDuration(kill.duration_sec)}</span>
          <span className="text-text">{fmtDmg(kill.total_damage)}</span>
          <span>{kill.total_dps ? `${fmtDmg(kill.total_dps)}/s` : '—'}</span>
          <span className="ml-auto">{kill.player_count} player{kill.player_count === 1 ? '' : 's'}</span>
        </div>

        {top.length > 0 ? (
          <ol className="text-xs space-y-0.5">
            {top.map((p, i) => (
              <li key={p.character_name} className="flex justify-between gap-2">
                <span className="truncate">
                  <span className="text-dim mr-1">{i + 1}.</span>
                  <span className="text-text">{p.character_name}</span>
                </span>
                <span className="text-dim whitespace-nowrap">
                  {fmtDmg(p.total_damage)}
                  {p.dps ? <span className="opacity-50"> · {fmtDmg(p.dps)}/s</span> : null}
                </span>
              </li>
            ))}
            {extra > 0 && <li className="text-dim italic">+{extra} more</li>}
          </ol>
        ) : (
          <div className="text-xs text-dim italic">no contributions yet</div>
        )}
      </Link>
      {adminBar}
    </div>
  );
}
