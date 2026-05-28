// Top-of-page banner: tonight (or most-recent-night) headline numbers.
// Picks the freshest day in the encounter set, totals damage, finds the top
// DPS contributor by damage, longest fight, and any deaths.
import { fmtDmg, fmtDuration, dayLabel } from '@/lib/format';

export type NightStats = {
  date: string;            // YYYY-MM-DD
  encounters: number;
  total_damage: number;
  total_duration_sec: number;
  top_player: { name: string; damage: number } | null;
  longest_fight: { boss: string; duration_sec: number } | null;
  deaths: number;
};

export default function NightSummary({ stats }: { stats: NightStats }) {
  return (
    <section className="bg-panel border border-border rounded-lg p-6">
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-4">
        <h2 className="text-xl text-gold">
          🐺 {dayLabel(stats.date)}
          <span className="text-dim text-sm ml-2">— {stats.date}</span>
        </h2>
        <div className="text-sm text-dim">
          {stats.encounters} kill{stats.encounters === 1 ? '' : 's'}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Total damage" value={fmtDmg(stats.total_damage)} accent="text-blue" />
        <Stat label="Fight time" value={fmtDuration(stats.total_duration_sec)} />
        <Stat
          label="Top damage"
          value={stats.top_player ? `${stats.top_player.name}` : '—'}
          sub={stats.top_player ? fmtDmg(stats.top_player.damage) : null}
          accent="text-gold"
        />
        <Stat
          label="Longest fight"
          value={stats.longest_fight ? stats.longest_fight.boss : '—'}
          sub={stats.longest_fight ? fmtDuration(stats.longest_fight.duration_sec) : null}
          accent="text-orange"
        />
      </div>

      {stats.deaths > 0 && (
        <div className="mt-3 text-xs text-red">
          💀 {stats.deaths} death{stats.deaths === 1 ? '' : 's'} recorded across the night
        </div>
      )}
    </section>
  );
}

function Stat({
  label, value, sub, accent,
}: {
  label: string;
  value: string;
  sub?: string | null;
  accent?: string;
}) {
  return (
    <div className="bg-bg border border-border/60 rounded p-2">
      <div className="text-[10px] text-dim uppercase tracking-wide">{label}</div>
      <div className={`text-sm font-medium truncate ${accent || 'text-text'}`} title={value}>
        {value}
      </div>
      {sub && <div className="text-xs text-dim truncate">{sub}</div>}
    </div>
  );
}
