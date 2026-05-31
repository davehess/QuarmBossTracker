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

  // Standalone — fetched separately so the Kyinen execution card can render
  // with its own gold-frame styling above the normal counter grid.
  let kyinenExecutions = 0;
  let kyinenLatest: string | null = null;
  let kyinenZone:   string | null = null;
  try {
    const { data, count } = await sb
      .from('pvp_kills')
      .select('killed_at, zone', { count: 'exact' })
      .ilike('killer', 'kyinen')
      .ilike('victim', 'malthur')
      .order('killed_at', { ascending: false })
      .limit(1);
    kyinenExecutions = count ?? 0;
    kyinenLatest = data?.[0]?.killed_at ?? null;
    kyinenZone   = data?.[0]?.zone      ?? null;
  } catch { /* table not yet populated — show 0 */ }

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

  return { counters, kyinen: { executions: kyinenExecutions, latest: kyinenLatest, zone: kyinenZone } };
}

export default async function FunPage() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/fun');

  const { counters, kyinen } = await loadCounters();

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

      <KyinenExecutionCard
        executions={kyinen.executions}
        latest={kyinen.latest}
        zone={kyinen.zone}
      />

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

// ── The Kyinen Execution Card ────────────────────────────────────────────────
// A reserved, rich-person's-picture-frame card commemorating each time the
// Quarm lead CSR has executed Wolf Pack's longest-tenured player. Detected
// from pvp_kills (killer=Kyinen, victim=Malthur) — no new agent detector
// needed; the kill broadcast lands via the standard PvP-channel relay.
//
// Visual: double gold frame with inset glow + inline SVG of an actual
// guillotine, since there's no native Unicode guillotine character. Renders
// even at 0 executions ("…yet.") because the card is the joke.
function KyinenExecutionCard({ executions, latest, zone }: {
  executions: number;
  latest: string | null;
  zone: string | null;
}) {
  const dateLine = latest
    ? `Last execution: ${new Date(latest).toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false,
      })}${zone ? ` · ${zone}` : ''}`
    : 'Awaiting the inaugural execution.';

  return (
    <section
      className="relative rounded-lg p-5"
      style={{
        background: 'linear-gradient(135deg, #1a1208 0%, #0e1116 100%)',
        border: '3px solid #d4af37',
        boxShadow: [
          'inset 0 0 0 1px #8b6914',
          'inset 0 0 0 5px #f5e6a8',
          'inset 0 0 0 6px #8b6914',
          '0 0 24px rgba(212, 175, 55, 0.35)',
        ].join(', '),
      }}
    >
      <div className="flex items-center gap-5">
        <Guillotine />
        <div className="min-w-0 flex-1">
          <div
            className="text-[10px] uppercase tracking-[0.18em] font-semibold"
            style={{ color: '#d4af37' }}
          >
            By Royal Decree
          </div>
          <div className="text-xl mt-1" style={{ color: '#f5e6a8' }}>
            Times <span className="font-bold">Kyinen</span> has executed <span className="font-bold">Malthur</span>
          </div>
          <div
            className="font-bold mt-2"
            style={{ fontSize: '3.5rem', lineHeight: 1, color: '#d4af37', textShadow: '0 0 12px rgba(212,175,55,0.5)' }}
          >
            {executions.toLocaleString()}
          </div>
          <div className="text-xs mt-2" style={{ color: '#b3a373' }}>
            {dateLine}
          </div>
          <div className="text-[10px] mt-1 italic" style={{ color: '#8b7d4d' }}>
            Lead Quarm CSR · sealed in gold by the pack
          </div>
        </div>
      </div>
    </section>
  );
}

function Guillotine() {
  // Inline SVG so we don't need an asset pipeline. Two posts, crossbar,
  // angled blade, basket — small and unmistakably a guillotine.
  return (
    <svg viewBox="0 0 64 96" width="64" height="96" aria-label="guillotine" role="img" style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id="gold" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%"   stopColor="#f5e6a8" />
          <stop offset="50%"  stopColor="#d4af37" />
          <stop offset="100%" stopColor="#8b6914" />
        </linearGradient>
        <linearGradient id="blade" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%"  stopColor="#e8e8e8" />
          <stop offset="100%" stopColor="#9aa0a6" />
        </linearGradient>
      </defs>
      {/* posts */}
      <rect x="8"  y="8" width="6" height="76" fill="url(#gold)" />
      <rect x="50" y="8" width="6" height="76" fill="url(#gold)" />
      {/* top crossbar */}
      <rect x="6"  y="8" width="52" height="6" fill="url(#gold)" />
      {/* blade (angled, hovering at the cut line) */}
      <polygon points="14,30 50,30 50,46 14,38" fill="url(#blade)" stroke="#8b6914" strokeWidth="0.6" />
      {/* lunette plank (the slot where the neck would rest) */}
      <rect x="6" y="58" width="52" height="4" fill="#3a2a14" />
      <circle cx="32" cy="60" r="4" fill="#0e1116" stroke="#8b6914" strokeWidth="0.8" />
      {/* base */}
      <rect x="2"  y="84" width="60" height="6" fill="url(#gold)" />
      <rect x="6"  y="80" width="52" height="4" fill="#3a2a14" />
      {/* basket */}
      <path d="M 22 90 Q 32 96 42 90" fill="none" stroke="#3a2a14" strokeWidth="2" />
    </svg>
  );
}
