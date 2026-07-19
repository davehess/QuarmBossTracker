// /rolls — off-night NBG roll nights (#91). "It would be cool to see what
// people got that night." Per raid night: every /random roll session (item,
// range, who rolled, the winning roll), the LOOTED-BY attribution beside the
// winner when they differ (all loot is no-drop — re-rolls/passes mean the
// looter often isn't the roll winner), and the 🎲🔥 Hot Dice callouts (perfect
// rolls + the >20%-of-the-night award).
//
// Data: roll_sets (multi-uploader, merged at read via lib/rolls) + looted_items
// (the looter's own "You have looted" lines) + fun_events (hot_dice /
// hot_dice_night). Member-gated (GUILD scope), like the rest of the member site.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { userTz, fmtShort, fmtDateOnly, DEFAULT_TZ } from '@/lib/timezone';
import {
  mergeRollSets, attributeLoot, looterDiffersFromWinners, nightKey,
  type RollSetRow, type LootedRow, type RollSession,
} from '@/lib/rolls';

export const dynamic = 'force-dynamic';

const LOOKBACK_DAYS = 60;

type FunRow = { event_type: string; caster: string | null; event_ts: string; raw_text: string | null };

export default async function RollsPage() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/rolls');

  const tz = await userTz();
  const sb = supabaseAdmin();
  const sinceIso = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [rollRes, lootRes, funRes] = await Promise.all([
    sb.from('roll_sets')
      .select('roll_from, roll_to, item, qty, zone, rolls, started_at, last_at, uploaded_by_discord_id')
      .eq('guild_id', 'wolfpack')
      .gte('started_at', sinceIso)
      .order('started_at', { ascending: false })
      .limit(2000),
    sb.from('looted_items')
      .select('looter_character, item_name, zone, looted_at')
      .eq('guild_id', 'wolfpack')
      .gte('looted_at', sinceIso)
      .order('looted_at', { ascending: false })
      .limit(4000),
    sb.from('fun_events')
      .select('event_type, caster, event_ts, raw_text')
      .in('event_type', ['hot_dice', 'hot_dice_night'])
      .gte('event_ts', sinceIso)
      .order('event_ts', { ascending: false })
      .limit(2000),
  ]);

  const rollRows = (rollRes.data ?? []) as RollSetRow[];
  const lootRows = (lootRes.data ?? []) as LootedRow[];
  const funRows  = (funRes.data ?? []) as FunRow[];

  const sessions = mergeRollSets(rollRows);

  // Bucket everything by raid night (ET calendar day of the roll's start).
  type Night = {
    key: string;
    sessions: RollSession[];
    perfects: FunRow[];
    award: FunRow | null;
  };
  const nights = new Map<string, Night>();
  const nightFor = (key: string): Night => {
    let n = nights.get(key);
    if (!n) { n = { key, sessions: [], perfects: [], award: null }; nights.set(key, n); }
    return n;
  };
  for (const s of sessions) nightFor(nightKey(new Date(s.startMs).toISOString(), DEFAULT_TZ)).sessions.push(s);
  for (const f of funRows) {
    const key = nightKey(f.event_ts, DEFAULT_TZ);
    if (!key) continue;
    if (f.event_type === 'hot_dice_night') nightFor(key).award = f;
    else nightFor(key).perfects.push(f);
  }

  const orderedNights = [...nights.values()]
    .filter(n => n.sessions.length > 0 || n.perfects.length > 0 || n.award)
    .sort((a, b) => b.key.localeCompare(a.key));

  const totalSessions = sessions.length;
  const totalLoot = lootRows.length;

  return (
    <div className="space-y-6">
      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-2xl text-gold flex items-center gap-3">
          <span aria-hidden>🎲</span>
          <span>Roll nights</span>
        </h2>
        <p className="text-sm text-dim mt-2">
          Off-night NBG loot rolls, captured straight from the game. Each session
          shows the range, who rolled, and the winning roll. Since every drop is
          no-drop, whoever actually <em>looted</em> it (from their own log) shows
          beside the winner when they aren&apos;t the same person — a re-roll or a
          pass hands it on. 🎲🔥 marks a perfect roll; the night crown goes to
          whoever out-rolled everyone on more than 20% of the night&apos;s
          contested sets.
        </p>
        <p className="text-xs text-dim mt-2">
          Last {LOOKBACK_DAYS} days · {totalSessions} roll {totalSessions === 1 ? 'session' : 'sessions'} · {totalLoot} looted {totalLoot === 1 ? 'item' : 'items'}.
          {' '}Capture needs Mimic/Parser v3.3.97+ running during the raid.
        </p>
      </section>

      {orderedNights.length === 0 && (
        <section className="bg-panel border border-border rounded-lg p-6 text-sm text-dim">
          No roll nights captured yet. The next off-night loot raid with an
          up-to-date agent running will land here — sessions, winners, who looted
          what, and any Hot Dice.
          {' '}<Link href="/mimic" className="text-accent hover:underline">Get Mimic →</Link>
        </section>
      )}

      {orderedNights.map(night => (
        <section key={night.key} className="bg-panel border border-border rounded-lg p-4 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center gap-3 border-b border-border pb-3">
            <h3 className="text-lg text-gold">{fmtDateOnly(night.sessions[0]?.startMs ? new Date(night.sessions[0].startMs).toISOString() : night.key + 'T12:00:00Z', tz)}</h3>
            <span className="text-xs text-dim">
              {night.sessions.length} {night.sessions.length === 1 ? 'session' : 'sessions'}
            </span>
            {night.award && (
              <span
                className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-gold/60 bg-gold/10 px-3 py-1 text-xs text-gold"
                title={night.award.raw_text ?? ''}
              >
                <span aria-hidden>🎲🔥</span>
                <span>Hot Dice: <strong>{night.award.caster}</strong></span>
              </span>
            )}
          </div>

          {night.perfects.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {night.perfects.map((p, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded border border-purple/40 bg-purple/10 px-2 py-0.5 text-[11px] text-purple" title={p.raw_text ?? ''}>
                  <span aria-hidden>🎲🔥</span>
                  <span><strong>{p.caster}</strong> perfect</span>
                </span>
              ))}
            </div>
          )}

          {night.sessions.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-dim border-b border-border">
                    <th className="py-1.5 pr-3 font-medium">Item</th>
                    <th className="py-1.5 pr-3 font-medium">Range</th>
                    <th className="py-1.5 pr-3 font-medium text-center">Rollers</th>
                    <th className="py-1.5 pr-3 font-medium">Won by (roll)</th>
                    <th className="py-1.5 pr-3 font-medium">Looted by</th>
                    <th className="py-1.5 font-medium text-right">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {night.sessions.map((s, i) => {
                    const looters = attributeLoot(s, lootRows);
                    const differing = looters.filter(l => looterDiffersFromWinners(l.looter, s.winners));
                    return (
                      <tr key={i} className="border-b border-border/50 align-top">
                        <td className="py-1.5 pr-3 text-text">
                          {s.item
                            ? <span>{s.item}{s.qty && s.qty > 1 ? <span className="text-dim"> ×{s.qty}</span> : null}</span>
                            : <span className="text-dim italic">unlabeled roll</span>}
                          {s.zone && <div className="text-[11px] text-dim">{s.zone}</div>}
                        </td>
                        <td className="py-1.5 pr-3 text-dim tabular-nums">{s.from}–{s.to}</td>
                        <td className="py-1.5 pr-3 text-center tabular-nums text-dim">{s.rollers}</td>
                        <td className="py-1.5 pr-3">
                          {s.winners.length === 0
                            ? <span className="text-dim">—</span>
                            : s.winners.map((w, wi) => (
                                <div key={wi}>
                                  <span className="text-text">{w.name}</span>
                                  <span className="text-gold tabular-nums"> {w.value}</span>
                                </div>
                              ))}
                        </td>
                        <td className="py-1.5 pr-3">
                          {differing.length > 0
                            ? differing.map((l, li) => <div key={li} className="text-accent">{l.looter}</div>)
                            : looters.length > 0
                              ? <span className="text-dim text-[11px]">winner</span>
                              : <span className="text-dim">—</span>}
                        </td>
                        <td className="py-1.5 text-right text-[11px] text-dim whitespace-nowrap">{fmtShort(new Date(s.lastMs).toISOString(), tz)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
