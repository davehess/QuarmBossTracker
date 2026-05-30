// /fun — guild-flavor counters that don't matter for raid optimization but
// are fun to track. First tenants: Peopleslayer LD counter (from the agent's
// fun_events stream) and Tunare mentions from Naggato's family (from the
// chat_messages table). Future tenants will join as the agent ships their
// detectors: CotH Pearl (Magician), DI Emerald, Aegolism/Rune Peridot, etc.

import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

async function loadCounters() {
  const sb = supabaseAdmin();
  const counters: { label: string; emoji: string; value: number; sub?: string }[] = [];

  // Peopleslayer LD card — count + a running tally of damage logged AFTER his
  // first LD. The joke: his DPS goes UP after he goes linkdead, so the post-LD
  // damage number keeps climbing. Queried via FK-joined filter on
  // encounter_players → encounters.started_at > earliest LD timestamp.
  try {
    const [ldRes, firstLdRow] = await Promise.all([
      sb.from('fun_events')
        .select('*', { count: 'exact', head: true })
        .eq('event_type', 'peopleslayer_ld'),
      sb.from('fun_events')
        .select('event_ts')
        .eq('event_type', 'peopleslayer_ld')
        .order('event_ts', { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);
    const ldCount = ldRes.count ?? 0;
    const firstLdTs = firstLdRow.data?.event_ts;

    let postLdDamage = 0;
    if (firstLdTs) {
      const { data: ep } = await sb
        .from('encounter_players')
        .select('total_damage, encounters!inner(started_at)')
        .ilike('character_name', 'Peopleslayer')
        .gt('encounters.started_at', firstLdTs);
      postLdDamage = (ep ?? []).reduce(
        (s: number, r: { total_damage: number | null }) => s + (r.total_damage || 0), 0);
    }

    counters.push({
      label: 'Peopleslayer linkdead',
      emoji: '🔌',
      value: ldCount,
      sub: postLdDamage > 0
        ? `…and ${postLdDamage.toLocaleString()} damage logged AFTER going LD. DPS doesn't stop for sleep.`
        : (ldCount > 0
            ? 'no damage logged after going LD yet — give him a minute.'
            : 'still online.'),
    });
  } catch (err) {
    counters.push({
      label: 'Peopleslayer linkdead',
      emoji: '🔌',
      value: 0,
      sub: 'no data yet.',
    });
    void err;
  }

  // Tunare mentions from Naggato + alts. Two queries: first the family name
  // list, then the chat scan.
  try {
    const { data: family } = await sb
      .from('characters')
      .select('name')
      .eq('guild_id', 'wolfpack')
      .or('main_name.eq.Naggato,name.eq.Naggato');
    const familyNames = (family ?? []).map((r: { name: string }) => r.name);
    if (familyNames.length > 0) {
      // PostgREST doesn't have a direct case-insensitive IN, so we build an
      // .or() chain of speaker.ilike for each family member.
      const orFilter = familyNames.map(n => `speaker.ilike.${n}`).join(',');
      const { count } = await sb
        .from('chat_messages')
        .select('*', { count: 'exact', head: true })
        .ilike('text', '%tunare%')
        .or(orFilter);
      counters.push({
        label: 'Tunare invocations',
        emoji: '🌿',
        value: count ?? 0,
        sub: `from Naggato's family (${familyNames.length} character${familyNames.length === 1 ? '' : 's'})`,
      });
    } else {
      counters.push({
        label: 'Tunare invocations',
        emoji: '🌿',
        value: 0,
        sub: 'Naggato family not resolved yet — characters sync needs to run',
      });
    }
  } catch (err) {
    counters.push({
      label: 'Tunare invocations',
      emoji: '🌿',
      value: 0,
      sub: 'query failed: ' + (err instanceof Error ? err.message : String(err)),
    });
  }

  // ── Malthur's Bounty — stacks of food + water distributed. Recipient-side
  // detector means each member's agent reports what THEY received; summing
  // approximates total stacks Malthur put out.
  try {
    const [{ count: food }, { count: water }] = await Promise.all([
      sb.from('fun_events').select('*', { count: 'exact', head: true }).eq('event_type', 'malthur_food_received'),
      sb.from('fun_events').select('*', { count: 'exact', head: true }).eq('event_type', 'malthur_water_received'),
    ]);
    const total = (food ?? 0) + (water ?? 0);
    counters.push({
      label: "Malthur's Bounty",
      emoji: '🍞',
      value: total,
      sub: total > 0
        ? `${(food ?? 0).toLocaleString()} burnt bread · ${(water ?? 0).toLocaleString()} water — across every opt-in log`
        : 'no provisions captured yet — agent v2.4.30+ collects these from recipient lines',
    });
  } catch (err) {
    counters.push({
      label: "Malthur's Bounty",
      emoji: '🍞',
      value: 0,
      sub: 'query failed: ' + (err instanceof Error ? err.message : String(err)),
    });
  }

  return counters;
}

export default async function FunPage() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/fun');

  const counters = await loadCounters();

  return (
    <div className="space-y-6">
      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-2xl text-gold flex items-center gap-3">
          <span aria-hidden>🎉</span>
          <span>Just for fun</span>
        </h2>
        <p className="text-sm text-dim mt-2">
          Counters that don&apos;t matter for raid optimization but are fun to
          track. More tenants land as the agent&apos;s detectors ship —
          CotH Pearls, DI Emeralds, Aegolism/Rune Peridots are queued.
        </p>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {counters.map(c => (
          <div key={c.label} className="bg-panel border border-border rounded-lg p-4">
            <div className="flex items-baseline justify-between">
              <div className="text-xs text-dim uppercase tracking-wide">{c.label}</div>
              <span aria-hidden className="text-2xl">{c.emoji}</span>
            </div>
            <div className="text-3xl text-gold font-bold mt-2">{c.value.toLocaleString()}</div>
            {c.sub && <div className="text-xs text-dim mt-1">{c.sub}</div>}
          </div>
        ))}
      </section>

      <section className="bg-panel border border-border rounded-lg p-4 text-xs text-dim">
        <div className="font-semibold text-text mb-2">Collecting now — cards land when data shows up</div>
        <ul className="space-y-1 list-disc list-inside">
          <li>⚰️ SK Harm Touch damage leaderboard (agent v2.4.31+)</li>
          <li>✋ Paladin Lay on Hands count + heal total (agent v2.4.31+; total uses count × paladin max HP when the line omits the number)</li>
          <li>⚔️ Currently PvP-flagged board (agent v2.4.34 captures the toggle)</li>
        </ul>
        <div className="font-semibold text-text mt-4 mb-2">Queued (need detectors)</div>
        <ul className="space-y-1 list-disc list-inside">
          <li>🦪 CotH Pearl tally (Magician Call of the Hero casts)</li>
          <li>💚 Emerald counter (Cleric Divine Intervention casts + saves)</li>
          <li>💛 Peridot counter (Rune + Aegolism + group buffs; MGB doubles)</li>
          <li>📚 Spell-cast leaderboard (per-character per-spell from agent castCounts)</li>
        </ul>
      </section>
    </div>
  );
}
