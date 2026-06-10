// /character/[name]/factions — BETA. Per-character faction picture from two
// agent streams:
//
//   faction_hits — every "Your faction standing with X got better/worse."
//     line, tallied per faction. Classic logs print no numeric delta, so the
//     counts are HITS, not points; PQDI's faction pages carry the per-mob /
//     per-quest magnitudes to marry up against. The at-cap rows ("could not
//     possibly get any better/worse") pin the character's absolute position.
//
//   faction_cons — /consider standing TRANSITIONS per mob (scowls … ally).
//     The latest standing per mob is the character's live tier with that
//     mob's faction — and a non-scowling con on a previously-KOS mob is the
//     only log-visible proof a Feign Death actually stuck.
//
// Data only flows for characters whose owner runs Mimic/Parser with logging
// on; a complete-log backfill crawl fills history idempotently.

import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

type HitRow = { faction: string; direction: number; capped: boolean; event_ts: string };
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
  const [hitsRes, consRes] = await Promise.all([
    sb.from('faction_hits')
      .select('faction, direction, capped, event_ts')
      .ilike('character', decoded)
      .order('event_ts', { ascending: false })
      .limit(10000),
    sb.from('faction_cons')
      .select('mob, standing, rank, event_ts')
      .ilike('character', decoded)
      .order('event_ts', { ascending: false })
      .limit(1000),
  ]);
  return {
    hits: (hitsRes.data ?? []) as HitRow[],
    cons: (consRes.data ?? []) as ConRow[],
  };
}

export default async function CharacterFactionsPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const decoded = decodeURIComponent(name);
  if (!/^[A-Za-z]{2,}$/.test(decoded)) notFound();

  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect(`/auth/signin?next=/character/${encodeURIComponent(name)}/factions`);

  const { hits, cons } = await load(decoded);

  // Tally hits per faction: better/worse counts, last activity, cap flags.
  type Tally = { faction: string; better: number; worse: number; cappedMax: boolean; cappedMin: boolean; lastTs: string };
  const byFaction = new Map<string, Tally>();
  for (const h of hits) {
    let t = byFaction.get(h.faction);
    if (!t) { t = { faction: h.faction, better: 0, worse: 0, cappedMax: false, cappedMin: false, lastTs: h.event_ts }; byFaction.set(h.faction, t); }
    if (h.direction > 0) t.better++; else t.worse++;
    if (h.capped && h.direction > 0) t.cappedMax = true;
    if (h.capped && h.direction < 0) t.cappedMin = true;
    if (h.event_ts > t.lastTs) t.lastTs = h.event_ts;
  }
  const factions = Array.from(byFaction.values())
    .sort((a, b) => (b.better + b.worse) - (a.better + a.worse));

  // Latest standing per mob (rows arrive newest-first, so first wins).
  const latestCon = new Map<string, ConRow>();
  for (const c of cons) if (!latestCon.has(c.mob.toLowerCase())) latestCon.set(c.mob.toLowerCase(), c);
  const conRows = Array.from(latestCon.values())
    .sort((a, b) => (a.rank ?? 4) - (b.rank ?? 4) || a.mob.localeCompare(b.mob));

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
        <h3 className="text-sm text-orange mb-3">Faction hits ({factions.length} faction{factions.length === 1 ? '' : 's'})</h3>
        {factions.length === 0 ? (
          <div className="text-sm text-dim p-2">
            No faction hits recorded yet. They flow automatically while this character plays with the agent
            running — or crawl old logs via the agent&apos;s backfill to fill in history.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-dim text-xs text-left">
                <th className="py-1 pr-3">Faction</th>
                <th className="py-1 pr-3 text-right">Raised</th>
                <th className="py-1 pr-3 text-right">Lowered</th>
                <th className="py-1 pr-3">Position</th>
                <th className="py-1">Last hit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {factions.map(f => (
                <tr key={f.faction}>
                  <td className="py-1.5 pr-3 text-text">{f.faction}</td>
                  <td className="py-1.5 pr-3 text-right text-green">{f.better > 0 ? `+${f.better}` : '—'}</td>
                  <td className="py-1.5 pr-3 text-right text-red">{f.worse > 0 ? `−${f.worse}` : '—'}</td>
                  <td className="py-1.5 pr-3">
                    {f.cappedMax && <span className="text-gold text-xs">▲ at max cap</span>}
                    {f.cappedMax && f.cappedMin && <span className="text-dim text-xs"> · </span>}
                    {f.cappedMin && <span className="text-red text-xs">▼ at min cap</span>}
                    {!f.cappedMax && !f.cappedMin && <span className="text-dim text-xs">—</span>}
                  </td>
                  <td className="py-1.5 text-dim text-xs">{fmtDate(f.lastTs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="bg-panel border border-border rounded-lg p-4">
        <h3 className="text-sm text-orange mb-1">Consider standings ({conRows.length} mob{conRows.length === 1 ? '' : 's'})</h3>
        <p className="text-xs text-dim mb-3">
          Latest <code>/con</code> faction tier per mob, KOS first. Each row is the most recent
          <i> transition</i> the agent observed — con a mob in-game to refresh it.
        </p>
        {conRows.length === 0 ? (
          <div className="text-sm text-dim p-2">No considers recorded yet — <code>/con</code> mobs in-game with the agent running.</div>
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
