// Compact encounter summary card. Links to /parses/[id] for the full breakdown.
import Link from 'next/link';
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
};

export default function KillCard({ kill }: { kill: KillCardData }) {
  const top = kill.top_players.slice(0, 5);
  const extra = kill.player_count - top.length;

  return (
    <Link
      href={`/parses/${kill.id}`}
      className="block bg-panel border border-border rounded-lg p-3 hover:border-blue hover:bg-[#1a212c] transition-colors no-underline"
    >
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <div className="text-gold text-sm font-medium truncate" title={kill.boss_name}>
          {kill.boss_name}
        </div>
        <div className="text-dim text-xs whitespace-nowrap">{fmtTime(kill.started_at)}</div>
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
  );
}
