// /character/[name]/factions — BETA. Per-character faction picture, COMPACT
// design (one rollup row per faction, latest-state cons):
//
//   faction_standing — additive counters per (character, faction) from the
//     "Your faction standing with X got better/worse." lines. Classic logs
//     print no point values, so counts are HITS, not points; PQDI's faction
//     pages carry per-mob / per-quest magnitudes to marry up against. The
//     at-cap timestamps ("could not possibly get any better/worse") pin the
//     character's absolute position — no amount of hit-counting can.
//
//   faction_cons — the LATEST non-hostile /consider standing per mob.
//     Scowls/threateningly are deliberately absent: an engaged mob cons
//     hostile regardless of faction, so those are combat noise. A mob that
//     cons dubiously-or-better is real faction signal — and the only
//     log-visible proof a Feign Death actually stuck.
//
// Data flows while the owner runs Mimic/Parser with logging on; the agent's
// complete-log backfill fills history (counters add; caps + cons are exact).

import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { groupFactions } from '@/lib/factionGroups';

export const dynamic = 'force-dynamic';

type StandingRow = {
  faction: string;
  better_count: number;
  worse_count: number;
  // Sum of magnitudes from agent-reported deltas (Quarm "got better by N" /
  // "(+N)" forms). 0 means we haven't captured any magnitudes yet — either
  // older agent or no magnitude in the log line. Web prefers totals when > 0.
  better_total?: number | null;
  worse_total?:  number | null;
  capped_max_at: string | null;
  capped_min_at: string | null;
  first_hit_at: string;
  last_hit_at: string;
  last_direction: number | null;
};
type ConRow = { mob: string; standing: string; rank: number | null; event_ts: string };

const STANDING_COLORS: Record<string, string> = {
  ally:           'text-green',
  warmly:         'text-green',
  kindly:         'text-green',
  amiably:        'text-green',
  indifferently:  'text-dim',
  apprehensively: 'text-orange',
  dubiously:      'text-orange',
  threateningly:  'text-red',
  scowls:         'text-red',
};

async function load(decoded: string) {
  const sb = supabaseAdmin();
  const [standingRes, consRes, charRes] = await Promise.all([
    sb.from('faction_standing')
      .select('faction, better_count, worse_count, better_total, worse_total, capped_max_at, capped_min_at, first_hit_at, last_hit_at, last_direction')
      .ilike('character', decoded)
      .order('last_hit_at', { ascending: false })
      .limit(500),
    sb.from('faction_cons')
      .select('mob, standing, rank, event_ts')
      .ilike('character', decoded)
      .order('event_ts', { ascending: false })
      .limit(500),
    // Race/class feed the estimated base standings for unrecorded factions.
    // Deity isn't captured anywhere yet — estimates say so.
    sb.from('characters')
      .select('race, class')
      .ilike('name', decoded)
      .limit(1),
  ]);
  const char = (charRes.data && charRes.data[0]) || null;
  return {
    standings: (standingRes.data ?? []) as StandingRow[],
    cons:      (consRes.data ?? []) as ConRow[],
    race:      (char?.race as string | null) ?? null,
    cls:       (char?.class as string | null) ?? null,
  };
}

export default async function CharacterFactionsPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const decoded = decodeURIComponent(name);
  if (!/^[A-Za-z]{2,}$/.test(decoded)) notFound();

  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect(`/auth/signin?next=/character/${encodeURIComponent(name)}/factions`);

  const { standings, cons, race, cls } = await load(decoded);

  // Bloc grouping — factions render next to the ones whose hits arrive
  // together (Velious war, Seru vs Katta, Chardok vs the goblin mines, …),
  // most-active bloc first. Catalog members with no recorded hits show as
  // "?" rows with an estimated base standing from race/class.
  const grouped = groupFactions(standings, f => f.better_count + f.worse_count, { race, cls });
  const conRows = cons
    .slice()
    .sort((a, b) => (b.rank ?? 4) - (a.rank ?? 4) || a.mob.localeCompare(b.mob));

  const fmtDate = (ts: string) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href={`/character/${encodeURIComponent(decoded)}`} className="text-blue hover:underline">← back to {decoded}</Link>
      </div>

      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-2xl text-gold flex items-center gap-3 mb-1">
          <span>🤝 {decoded} — Factions</span>
          <span className="text-[10px] tracking-widest font-bold px-2 py-0.5 rounded bg-orange/20 border border-orange/60 text-orange uppercase">Beta</span>
        </h2>
        <p className="text-sm text-dim leading-6">
          Faction hits and <code>/consider</code> standings mined from this character&apos;s logs.
          Classic logs don&apos;t print point values — counts below are <b>hits</b>, not points; cross-reference
          per-mob and per-quest magnitudes on{' '}
          <a href="https://www.pqdi.cc/factions" target="_blank" rel="noreferrer" className="text-blue hover:underline">PQDI&apos;s faction pages</a>.
          An <span className="text-gold">at-cap</span> flag means the server said standing could not possibly get any
          better/worse — that pins the absolute position. Re-running the agent over old logs backfills history.
        </p>
      </section>

      <section className="bg-panel border border-border rounded-lg p-4">
        <h3 className="text-sm text-orange mb-1">Faction standing ({standings.length} recorded)</h3>
        <p className="text-xs text-dim mb-3">
          Grouped by the wars you grind them in — raising one side of a bloc usually lowers the other.
          <span className="text-text"> ? rows</span> are bloc factions with no recorded hits yet; their{' '}
          <i>est. base</i> tier is a coarse estimate from race/class
          {race || cls ? <> ({[race, cls].filter(Boolean).join(' ')})</> : null} —{' '}
          <b>deity isn&apos;t tracked yet</b>, so deity-shifted factions may sit a tier off. <code>/con</code> something
          on that faction in-game to pin the real tier.
        </p>
        {grouped.length === 0 ? (
          <div className="text-sm text-dim p-2">
            No faction hits recorded yet. They flow automatically while this character plays with the agent
            running — or crawl old logs via the agent&apos;s backfill to fill in history.
          </div>
        ) : (
          <div className="space-y-4">
            {grouped.map(({ group, rows, missing }) => (
              <div key={group.key}>
                <div className="flex items-baseline gap-2 mb-1">
                  <h4 className="text-xs text-gold uppercase tracking-wider">{group.label}</h4>
                  <span className="text-[10px] text-dim italic">{group.hint}</span>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-dim text-xs text-left">
                      <th className="py-1 pr-3 w-[40%]">Faction</th>
                      <th className="py-1 pr-3 text-right">Raised</th>
                      <th className="py-1 pr-3 text-right">Lowered</th>
                      <th className="py-1 pr-3">Position</th>
                      <th className="py-1">Last hit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {rows.map(f => {
                      // Prefer summed magnitudes when the agent has captured
                      // any (Quarm prints per-line deltas); fall back to hit
                      // counts when not. Tooltip surfaces whichever number
                      // ISN'T the headline so officers can sanity-check
                      // "+96 points (8 hits)" vs "+8 hits (no per-hit deltas
                      // captured)" (Uilnayar 2026-06-23).
                      const bTot = f.better_total ?? 0;
                      const wTot = f.worse_total  ?? 0;
                      const betterHead = bTot > 0
                        ? { val: `+${bTot.toLocaleString()}`, tip: `+${bTot.toLocaleString()} points across ${f.better_count.toLocaleString()} hit${f.better_count === 1 ? '' : 's'}` }
                        : f.better_count > 0
                          ? { val: `+${f.better_count}`, tip: `${f.better_count.toLocaleString()} hit${f.better_count === 1 ? '' : 's'} — no per-line magnitude captured (older agent, or the server didn’t print one)` }
                          : { val: '—', tip: '' };
                      const worseHead = wTot > 0
                        ? { val: `−${wTot.toLocaleString()}`, tip: `−${wTot.toLocaleString()} points across ${f.worse_count.toLocaleString()} hit${f.worse_count === 1 ? '' : 's'}` }
                        : f.worse_count > 0
                          ? { val: `−${f.worse_count}`, tip: `${f.worse_count.toLocaleString()} hit${f.worse_count === 1 ? '' : 's'} — no per-line magnitude captured` }
                          : { val: '—', tip: '' };
                      return (
                      <tr key={f.faction}>
                        <td className="py-1.5 pr-3 text-text">{f.faction}</td>
                        <td className="py-1.5 pr-3 text-right text-green" title={betterHead.tip}>{betterHead.val}</td>
                        <td className="py-1.5 pr-3 text-right text-red"   title={worseHead.tip}>{worseHead.val}</td>
                        <td className="py-1.5 pr-3">
                          {f.capped_max_at && <span className="text-gold text-xs" title={`hit the max cap ${fmtDate(f.capped_max_at)}`}>▲ at max cap</span>}
                          {f.capped_max_at && f.capped_min_at && <span className="text-dim text-xs"> · </span>}
                          {f.capped_min_at && <span className="text-red text-xs" title={`hit the min cap ${fmtDate(f.capped_min_at)}`}>▼ at min cap</span>}
                          {!f.capped_max_at && !f.capped_min_at && <span className="text-dim text-xs">—</span>}
                        </td>
                        <td className="py-1.5 text-dim text-xs">
                          {fmtDate(f.last_hit_at)}
                          {f.last_direction != null && (
                            <span className={f.last_direction > 0 ? 'text-green ml-1' : 'text-red ml-1'}>
                              {f.last_direction > 0 ? '↑' : '↓'}
                            </span>
                          )}
                        </td>
                      </tr>
                      );
                    })}
                    {missing.map(m => (
                      <tr key={m.name} className="opacity-70">
                        <td className="py-1.5 pr-3 text-dim">{m.name}</td>
                        <td className="py-1.5 pr-3 text-right text-dim">?</td>
                        <td className="py-1.5 pr-3 text-right text-dim">?</td>
                        <td className="py-1.5 pr-3">
                          <span
                            className={`text-xs ${STANDING_COLORS[m.base] ?? 'text-dim'}`}
                            title="Estimated base standing from race/class — deity not tracked yet; /con in-game to pin it"
                          >
                            est. base: {m.base}
                          </span>
                        </td>
                        <td className="py-1.5 text-dim text-xs">—</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="bg-panel border border-border rounded-lg p-4">
        <h3 className="text-sm text-orange mb-1">Consider standings ({conRows.length} mob{conRows.length === 1 ? '' : 's'})</h3>
        <p className="text-xs text-dim mb-3">
          Latest <b>non-hostile</b> <code>/con</code> per mob, best standing first. Scowling/threatening cons are
          deliberately excluded — an engaged mob always cons hostile, so they carry no faction signal. A row
          here means this mob&apos;s faction visibly accepts {decoded} (and is the proof a Feign Death stuck).
        </p>
        {conRows.length === 0 ? (
          <div className="text-sm text-dim p-2">No non-hostile considers recorded yet — <code>/con</code> mobs in-game with the agent running.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-dim text-xs text-left">
                <th className="py-1 pr-3">Mob</th>
                <th className="py-1 pr-3">Standing</th>
                <th className="py-1">Observed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {conRows.map(c => (
                <tr key={c.mob}>
                  <td className="py-1.5 pr-3 text-text">{c.mob}</td>
                  <td className={`py-1.5 pr-3 ${STANDING_COLORS[c.standing] ?? 'text-dim'}`}>{c.standing}</td>
                  <td className="py-1.5 text-dim text-xs">{fmtDate(c.event_ts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="bg-panel border border-border rounded-lg p-4 text-xs text-dim leading-5">
        <b className="text-text">Coming next:</b> base standing by class/race/deity (the starting offset before any
        hits), Ornate Velium Pendant (+100) attempt tracking, per-class faction-raising spells/songs, and PQDI
        per-faction deep links once we mirror their faction ↔ mob/quest tables.
      </section>
    </div>
  );
}
