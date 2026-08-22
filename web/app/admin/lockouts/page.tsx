// /admin/lockouts — raid lockouts our characters are carrying, split by
// whether the kill was OURS.
//
// ⚠ A lockout is an ENGAGE lock, not a loot lock (Hitya 2026-08-21): the
// character cannot fight the mob at all — on engage the server teleports them
// OUT OF THE ZONE. So this is a pre-pull question, not a loot-distribution
// one: a locked raider who pulls anyway is a body that vanishes mid-fight.
// It is per character, so for a current-era boss it is normally an ALT that
// carries one — a main raiding with us has no way to pick one up elsewhere,
// which is why the Main/Alt column is worth a glance.
//
// Hitya 2026-08-21: "several raiders have spent time with Breakfast Club doing
// raids on alts. we need to remain vigilant about these not being included, but
// also capture loot lockouts for raid mobs when they don't occur with our
// guild — put those into another admin section."
//
// Two different jobs, deliberately kept apart:
//   • Foreign RAIDS stay out of our numbers — /admin/anomalies owns that, and
//     /parses already auto-hides them.
//   • Foreign LOCKOUTS are the opposite: they must be CAPTURED, because they
//     bind us. Someone who killed a boss with another guild on Tuesday cannot
//     loot it on our Sunday. We were reading /sll only to nudge boss timers and
//     throwing the rest away.
//
// `ours` is three-state on purpose. true = the kill is bound to one of our
// raid nights; false = it isn't, and it happened outside every raid window;
// null = we cannot say. Null is shown as "unknown", never as an accusation.
//
// TWO SOURCES (2026-08-22). `sll` is a relay of the character's own /sll — the
// server's remaining time, authoritative. `kill` is derived from a confirmed
// boss-kill parse we already had; its expiry is computed from the boss timer.
// The second exists because the first needs a human to type /sll in game, and
// in the day after this page shipped it produced ZERO rows while the encounter
// pipe had already captured three foreign raid kills from one player. Hitya,
// on that parse: "taeya reported this Ventani kill so they should have a
// lockout." A kill row never overwrites a live /sll row.
import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import { selectAll } from '@/lib/selectAll';
import { userTz, fmtAbs } from '@/lib/timezone';
import { isCurrentEraName, currentEraNames } from '@/lib/eras';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Loot lockouts — Wolf Pack admin' };

type Row = {
  character: string; boss_key: string; boss_name: string;
  expires_at: string; implied_kill_at: string | null;
  ours: boolean | null; observed_at: string; observed_by: string | null;
  source: 'sll' | 'kill' | 'manual'; encounter_id: string | null;
};
type Kind = 'main' | 'alt' | 'unknown';

function Section({
  title, blurb, rows, tz, tone, kindOf,
}: { title: string; blurb: string; rows: Row[]; tz: string; tone: string;
     kindOf: (name: string) => Kind }) {
  return (
    <section className="bg-panel border border-border rounded-lg p-4">
      <h2 className={`text-sm mb-1 ${tone}`}>{title} ({rows.length})</h2>
      <p className="text-xs text-dim mb-3 max-w-3xl leading-5">{blurb}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-dim">None.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-dim text-xs text-left">
              <th className="py-1 pr-3">Character</th>
              <th className="py-1 pr-3">Main/Alt</th>
              <th className="py-1 pr-3">Boss</th>
              <th className="py-1 pr-3">Locked until</th>
              <th className="py-1 pr-3">Implied kill</th>
              <th className="py-1 pr-3">How we know</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {rows.map(r => (
              <tr key={`${r.character}|${r.boss_key}|${r.expires_at}`} className="hover:bg-[#1a212c]">
                <td className="py-1.5 pr-3">
                  <Link href={`/character/${encodeURIComponent(r.character)}`} className="text-blue hover:underline">{r.character}</Link>
                </td>
                <td className="py-1.5 pr-3 text-xs">
                  {(() => {
                    const k = kindOf(r.character);
                    // A MAIN locked to a current-era boss is the surprising
                    // case — a main raiding with us can't pick one up
                    // elsewhere — so it's the one worth flagging.
                    return k === 'main'
                      ? <span className="text-orange font-semibold">main</span>
                      : k === 'alt' ? <span className="text-dim">alt</span>
                      : <span className="text-dim/60">—</span>;
                  })()}
                </td>
                <td className="py-1.5 pr-3 text-text">{r.boss_name}</td>
                <td className="py-1.5 pr-3 text-dim">{fmtAbs(r.expires_at, tz)}</td>
                <td className="py-1.5 pr-3 text-dim">{r.implied_kill_at ? fmtAbs(r.implied_kill_at, tz) : '—'}</td>
                <td className="py-1.5 pr-3 text-dim text-xs">
                  {r.source === 'kill' && r.encounter_id ? (
                    <Link href={`/parses/${r.encounter_id}`} className="text-blue hover:underline">
                      their parse
                    </Link>
                  ) : r.source === 'kill' ? 'a kill parse'
                    : r.source === 'manual' ? 'entered by an officer'
                    : `/sll${r.observed_by ? ` — ${r.observed_by}` : ''}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default async function LockoutsPage() {
  const sb = supabaseAdmin();
  const tz = await userTz();
  // Only lockouts that are still BINDING — an expired one is history, and the
  // question this page answers ("can they loot it with us?") is about now.
  // Paginated, not .limit() — kill-derived lockouts took this table past 700
  // rows on day one, and PostgREST caps a response at 1000 SILENTLY, so a bare
  // limit would drop the tail with no error (web/lib/selectAll.ts).
  const rows = await selectAll<Row>((from, to) => sb
    .from('character_lockouts')
    .select('character, boss_key, boss_name, expires_at, implied_kill_at, ours, observed_at, observed_by, source, encounter_id')
    .eq('guild_id', 'wolfpack')
    .gt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: true })
    .order('character', { ascending: true })
    .order('boss_key', { ascending: true })
    .range(from, to));

  // Main vs alt, so a MAIN on the foreign list stands out — that's the case
  // that shouldn't normally happen for a current-era boss.
  const names = [...new Set(rows.map(r => r.character))];
  const { data: charRows } = names.length
    ? await sb.from('characters').select('name, main_name').eq('guild_id', 'wolfpack').in('name', names)
    : { data: [] as { name: string; main_name: string | null }[] };
  const kindByName = new Map<string, Kind>();
  for (const c of (charRows ?? []) as { name: string; main_name: string | null }[]) {
    kindByName.set(c.name.toLowerCase(),
      !c.main_name || c.main_name.toLowerCase() === c.name.toLowerCase() ? 'main' : 'alt');
  }
  const kindOf = (n: string): Kind => kindByName.get(n.toLowerCase()) ?? 'unknown';

  // Era, so the page can lead with the content we actually raid (Hitya
  // 2026-08-22: "only the lockouts from current era or night's targets really
  // matter"). expansion_label is populated for every curated boss, which is
  // the only kind that produces a lockout.
  const bossKeys = [...new Set(rows.map(r => r.boss_key))];
  const { data: bossRows } = bossKeys.length
    ? await sb.from('bosses_local').select('internal_id, expansion_label').in('internal_id', bossKeys)
    : { data: [] as { internal_id: string; expansion_label: string | null }[] };
  const eraByBoss = new Map<string, string | null>(
    ((bossRows ?? []) as { internal_id: string; expansion_label: string | null }[])
      .map(b => [b.internal_id, b.expansion_label]));
  const isCurrent = (r: Row) => isCurrentEraName(eraByBoss.get(r.boss_key));

  // A kill parse of a raid one of ours joined carries the OTHER guild's whole
  // roster, and those are real lockouts — on characters that are not ours to
  // plan around. Split them out rather than letting sixty strangers bury the
  // handful of names an officer has to act on.
  const mine    = rows.filter(r => kindOf(r.character) !== 'unknown');
  const notMine = rows.filter(r => kindOf(r.character) === 'unknown');
  const current = mine.filter(isCurrent);
  const legacy  = mine.filter(r => !isCurrent(r));
  // Within current era, mains first — a blocked main is a hole in the raid,
  // a blocked alt is a swap.
  const byMainFirst = (a: Row, b: Row) =>
    (kindOf(a.character) === 'main' ? 0 : 1) - (kindOf(b.character) === 'main' ? 0 : 1)
    || a.character.localeCompare(b.character);
  const foreign = current.filter(r => r.ours === false).sort(byMainFirst);
  const unknown = current.filter(r => r.ours === null).sort(byMainFirst);
  const ours    = current.filter(r => r.ours === true).sort(byMainFirst);
  const eraLabel = currentEraNames().join(' + ');

  return (
    <div className="space-y-6">
      <section className="bg-panel border border-border rounded-lg p-5">
        <h1 className="text-xl text-gold">🔒 Loot lockouts</h1>
        <p className="text-sm text-dim mt-1 max-w-3xl leading-6">
          Who is currently locked out of which raid boss — from a <code>/sll</code> relay, or worked out from a
          boss-kill parse they uploaded. A lockout is an{' '}
          <b className="text-text">engage lock, not a loot lock</b> — a locked character can&apos;t fight the mob
          at all, and gets <b className="text-text">teleported out of the zone on engage</b>. So this is a
          before-the-pull question: someone locked who engages anyway is a body that vanishes mid-fight. The point
          The first three sections cover <b className="text-text">{eraLabel}</b> — the content we actually raid;
          anything older is real but changes nothing about a raid night, so it sits at the bottom. The point
          of the split is the first section — a character who killed a boss with{' '}
          <b className="text-text">another guild</b> is locked on ours, and we used to read those relays only to
          nudge boss timers and throw the rest away. Foreign <i>raids</i> are a different problem and stay on{' '}
          <Link href="/admin/anomalies" className="text-blue hover:underline">Anomalies</Link> — they are kept out
          of our parses; these are kept <i>in</i>, on purpose.
        </p>
      </section>

      <Section
        title="⚠ Locked from a kill that wasn't ours"
        tone="text-orange"
        blurb="We have a kill of this boss on the board and their lockout does NOT line up with it — so they got it somewhere else. They cannot ENGAGE this boss on our raid until it expires; if they try, the server teleports them out of the zone. Lockouts are per character, so this is normally an alt."
        rows={foreign} tz={tz} kindOf={kindOf}
      />
      <Section
        title="❔ Unknown"
        tone="text-dim"
        blurb="We have no kill of this boss on our board at all, so we can't say whose it was. Usually just a boss we don't track — not evidence of anything."
        rows={unknown} tz={tz} kindOf={kindOf}
      />
      <Section
        title="✓ From our own raids"
        tone="text-green"
        blurb="Bound to a Wolf Pack raid night. Here for completeness — this is the expected case."
        rows={ours} tz={tz} kindOf={kindOf}
      />
      <Section
        title="· Older content"
        tone="text-dim"
        blurb="Lockouts on expansions we are past. Real, and they still stop that character engaging that mob — but they do not touch a raid night, so they stay out of the way."
        rows={legacy} tz={tz} kindOf={kindOf}
      />
      <Section
        title="· Not on our roster"
        tone="text-dim"
        blurb="Characters we don't have in the roster, picked up from the damage lists of parses our people uploaded — mostly the other guild's raiders on a joint or pickup raid. Real lockouts, but not ours to plan around, so they're kept out of the officer briefing."
        rows={notMine} tz={tz} kindOf={kindOf}
      />
    </div>
  );
}
