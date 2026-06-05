// /fun — guild-flavor counters that don't matter for raid optimization but
// are fun to track. First tenants: Peopleslayer LD counter (from the agent's
// fun_events stream) and Tunare mentions from Naggato's family (from the
// chat_messages table). Future tenants will join as the agent ships their
// detectors: CotH Pearl (Magician), DI Emerald, Aegolism/Rune Peridot, etc.

import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { userTz, fmtAbs } from '@/lib/timezone';

export const dynamic = 'force-dynamic';

async function loadCounters() {
  const sb = supabaseAdmin();
  // value is `number | string` so cards like "Longest Dire Charm" can show
  // a pre-formatted "4h 23m" string while normal counter cards stay numeric.
  // The renderer calls value.toLocaleString() which works for both.
  const counters: { label: string; emoji: React.ReactNode; value: number | string; sub?: string }[] = [];

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

  // Peopleslayer LD card — count + damage he logged in fights he was ACTUALLY
  // disconnected during. The joke: he goes linkdead mid-fight and his character
  // keeps swinging. The earlier version summed his total_damage across EVERY
  // encounter that started after his first-ever LD — i.e. essentially his whole
  // damage history since the first LD, a meaningless multi-million number. Now
  // we only count an encounter if one of his LD timestamps falls inside that
  // encounter's window [started_at, started_at + duration_sec] — "damage dealt
  // while he was disconnected." Still only his own encounter_players rows.
  try {
    const LD_GRACE_MS = 5 * 60 * 1000; // a fight that kicked off ≤5m after an LD still counts (he stayed LD)
    const [ldRes, ldRows] = await Promise.all([
      sb.from('fun_events')
        .select('*', { count: 'exact', head: true })
        .eq('event_type', 'peopleslayer_ld'),
      sb.from('fun_events')
        .select('event_ts')
        .eq('event_type', 'peopleslayer_ld')
        .order('event_ts', { ascending: true }),
    ]);
    const ldCount = ldRes.count ?? 0;
    const ldTimes = ((ldRows.data ?? []) as { event_ts: string }[])
      .map(r => new Date(r.event_ts).getTime())
      .filter(t => !Number.isNaN(t));

    let postLdDamage = 0;
    if (ldTimes.length > 0) {
      const earliestLd = ldTimes[0];
      // His encounters that could overlap an LD must START at or before the
      // last LD. Pull them with duration so we can test the window in JS
      // (PostgREST can't filter started_at + duration). Bounded to his rows.
      const { data: ep } = await sb
        .from('encounter_players')
        .select('encounter_id, total_damage, encounters!inner(started_at, duration_sec)')
        .ilike('character_name', 'Peopleslayer')
        .gte('encounters.started_at', new Date(earliestLd - LD_GRACE_MS).toISOString())
        .lte('encounters.started_at', new Date(ldTimes[ldTimes.length - 1] + LD_GRACE_MS).toISOString())
        .limit(5000);
      type EpRow = { encounter_id: string; total_damage: number | null; encounters: { started_at: string; duration_sec: number | null } | { started_at: string; duration_sec: number | null }[] | null };
      const seen = new Set<string>();
      for (const r of (ep ?? []) as unknown as EpRow[]) {
        // PostgREST returns the to-one join as an object, but the generated
        // types model it as an array — accept either.
        const enc = Array.isArray(r.encounters) ? r.encounters[0] : r.encounters;
        if (!enc || !enc.started_at) continue;
        const start = new Date(enc.started_at).getTime();
        if (Number.isNaN(start)) continue;
        const end = start + (enc.duration_sec ?? 0) * 1000;
        // Counts if any LD happened during the fight, or the fight began within
        // the grace window after an LD (he hadn't reconnected yet).
        const overlapsLd = ldTimes.some(ld => (ld >= start - LD_GRACE_MS && ld <= end) || (start >= ld && start <= ld + LD_GRACE_MS));
        if (overlapsLd && !seen.has(r.encounter_id)) {
          seen.add(r.encounter_id);
          postLdDamage += r.total_damage || 0;
        }
      }
    }

    counters.push({
      label: 'Peopleslayer linkdead',
      emoji: '🔌',
      value: ldCount,
      sub: postLdDamage > 0
        ? `…and ${postLdDamage.toLocaleString()} damage logged while LD. DPS doesn't stop for sleep.`
        : (ldCount > 0
            ? 'no damage logged while LD yet — give him a minute.'
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
      // Two queries: total invocations + most recent for the "N days since"
      // rant timer. Running in parallel keeps the page snappy.
      const [{ count }, { data: latest }] = await Promise.all([
        sb.from('chat_messages')
          .select('*', { count: 'exact', head: true })
          .ilike('text', '%tunare%').or(orFilter),
        sb.from('chat_messages')
          .select('ts').ilike('text', '%tunare%').or(orFilter)
          .order('ts', { ascending: false }).limit(1).maybeSingle(),
      ]);
      const lastTs = latest?.ts ? new Date(latest.ts) : null;
      const days   = lastTs ? Math.floor((Date.now() - lastTs.getTime()) / 86400000) : null;
      const sub = days === null
        ? 'no Tunare invocations on record yet — first rant resets the clock.'
        : days === 0
          ? 'Last rant was today. Stay vigilant.'
          : `${days} day${days === 1 ? '' : 's'} since the last Tunare Text Rant™.`;
      counters.push({
        label: 'Tunare invocations',
        emoji: <TunareKissScene />,
        value: count ?? 0,
        sub,
      });
    } else {
      counters.push({
        label: 'Tunare invocations',
        emoji: <TunareKissScene />,
        value: 0,
        sub: 'Naggato family not resolved yet — characters sync needs to run',
      });
    }
  } catch (err) {
    counters.push({
      label: 'Tunare invocations',
      emoji: <TunareKissScene />,
      value: 0,
      sub: 'query failed: ' + (err instanceof Error ? err.message : String(err)),
    });
  }

  // ── Malthur's Bounty — stacks of food + water distributed. Recipient-side
  // detector means each member's agent reports what THEY received; summing
  // approximates total stacks Malthur put out. Plain captured count (the
  // 420 founders' baseline was removed per owner request).
  const MALTHUR_BASELINE = 0;
  try {
    const [{ count: food }, { count: water }] = await Promise.all([
      sb.from('fun_events').select('*', { count: 'exact', head: true }).eq('event_type', 'malthur_food_received'),
      sb.from('fun_events').select('*', { count: 'exact', head: true }).eq('event_type', 'malthur_water_received'),
    ]);
    const captured = (food ?? 0) + (water ?? 0);
    counters.push({
      label: "Malthur's Bounty",
      emoji: '🍞',
      value: captured + MALTHUR_BASELINE,
      sub: captured > 0
        ? `${(food ?? 0).toLocaleString()} 🍞 burnt bread + ${(water ?? 0).toLocaleString()} 💧 water`
        : `agent v2.4.30+ ticks this up from recipient lines.`,
    });
  } catch (err) {
    counters.push({
      label: "Malthur's Bounty",
      emoji: '🍞',
      value: MALTHUR_BASELINE,
      sub: `captured count unavailable`,
    });
    void err;
  }

  // ── Longest Dire Charm — for the bragging-rights enchanter who walked off
  //    with a charmed mob and held it the longest. Pulls from charm_sessions
  //    where is_dire_charm=true; pick the row with the highest duration_sec.
  //    Empty until the agent v2.5.5+ first DC fires.
  try {
    const { data: rows } = await sb
      .from('charm_sessions')
      .select('pet_name, owner, duration_sec, total_damage, ended_at')
      .eq('is_dire_charm', true)
      .not('duration_sec', 'is', null)
      .order('duration_sec', { ascending: false })
      .limit(1);
    const top = (rows ?? [])[0] as { pet_name: string; owner: string; duration_sec: number; total_damage: number; ended_at: string } | undefined;
    if (top && top.duration_sec > 0) {
      const fmtDur = (sec: number) => {
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = Math.floor(sec % 60);
        if (h > 0) return `${h}h ${m}m`;
        if (m > 0) return `${m}m ${s}s`;
        return `${s}s`;
      };
      const dps = top.duration_sec > 0 ? Math.round(top.total_damage / top.duration_sec) : 0;
      counters.push({
        label: 'Longest Dire Charm',
        emoji: '🔗',
        value: fmtDur(top.duration_sec),
        sub: `${top.pet_name} · ${top.owner}${dps > 0 ? ` · ${dps.toLocaleString()}/s avg` : ''}`,
      });
    } else {
      counters.push({
        label: 'Longest Dire Charm',
        emoji: '🔗',
        value: '—',
        sub: 'no Dire Charms recorded yet (agent v2.5.5+ will tick this up)',
      });
    }
  } catch (err) {
    void err;
  }

  // ── Lord of Ire vanquished — counts every Plane of Hate instance boss kill
  // 🐉 Dragon Punch — monk "Stunning Kick / Force of Disruption" proc card.
  // The proc line "<target> is stricken by the force of a dragon." names only
  // the TARGET, never the kicker, and is BYSTANDER-VISIBLE — every boxed /
  // grouped agent sees the same punch and the agent credited its own log owner,
  // so per-player attribution was both wrong AND over-counted (the same physical
  // punch counted once per watching character). So we anonymize it: count
  // DISTINCT (target, event_ts) — one physical reposition regardless of how many
  // agents logged it — and report a guild total with no names.
  try {
    const { data: dpRows } = await sb
      .from('fun_events')
      .select('target, event_ts')
      .eq('event_type', 'dragon_punch');
    const seen = new Set<string>();
    for (const r of (dpRows ?? []) as { target: string | null; event_ts: string | null }[]) {
      seen.add(`${(r.target || '?').toLowerCase()}|${r.event_ts || ''}`);
    }
    const total = seen.size;
    if (total > 0) {
      counters.push({
        label: 'Dragon punches landed',
        emoji: '🐉',
        value: total,
        sub: `Mobs have been repositioned by Dragon Punch ${total.toLocaleString()} time${total === 1 ? '' : 's'}`,
      });
    }
  } catch (err) { void err; }

  // by a Wolf Pack member. Sub-text shows the top killer + their tally so the
  // bragging rights are explicit. Source: fun_events emitted from the bot's
  // PvP relay when a Wolf-Pack-attributed broadcast names "Lord of Ire" as the
  // victim.
  try {
    const { data: loiRows, count: loiTotal } = await sb
      .from('fun_events')
      .select('caster', { count: 'exact' })
      .eq('event_type', 'lord_of_ire_killed');
    const tally = new Map<string, number>();
    for (const r of (loiRows ?? []) as { caster: string | null }[]) {
      const k = r.caster || 'unknown';
      tally.set(k, (tally.get(k) ?? 0) + 1);
    }
    const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
    const total  = loiTotal ?? 0;
    if (total > 0 && ranked.length > 0) {
      const subParts = ranked.slice(0, 3).map(([name, n]) => `${name} ×${n}`);
      counters.push({
        label: 'Lord of Ire vanquished',
        emoji: '😈',
        value: total,
        sub: subParts.join(' · '),
      });
    } else {
      counters.push({
        label: 'Lord of Ire vanquished',
        emoji: '😈',
        value: 0,
        sub: 'no kills tracked yet — fires on the next Plane of Hate (Instanced) clear',
      });
    }
  } catch (err) {
    void err;
  }

  return { counters, kyinen: { executions: kyinenExecutions, latest: kyinenLatest, zone: kyinenZone } };
}

export default async function FunPage() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/fun');

  const tz = await userTz();
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
        tz={tz}
      />

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {counters.map(c => (
          <div key={c.label} className="bg-panel border border-border rounded-lg p-4">
            <div className="flex items-baseline justify-between">
              <div className="text-xs text-dim uppercase tracking-wide">{c.label}</div>
              <span aria-hidden className="text-2xl shrink-0">{c.emoji}</span>
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
// ── Tunare kiss scene ─────────────────────────────────────────────────────────
// Tunare leaning in to kiss a high-elf paladin on the cheek; the paladin sits
// on horseback with a flaming epic sword raised. Stylized so the whole scene
// reads at ~60px (the fun card's emoji slot). Uses real SVG instead of
// emoji-collage because emoji at thumbnail size collapses to indistinct blobs.
function TunareKissScene() {
  return (
    <svg viewBox="0 0 80 64" width="60" height="48" aria-label="Tunare kissing a high-elf paladin on horseback" role="img" style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id="flameGrad" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%"   stopColor="#f97316" />
          <stop offset="55%"  stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#fef3c7" />
        </linearGradient>
        <linearGradient id="bladeGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor="#f1f5f9" />
          <stop offset="100%" stopColor="#94a3b8" />
        </linearGradient>
      </defs>

      {/* Pastoral ground line */}
      <ellipse cx="40" cy="60" rx="38" ry="2" fill="#4ade80" opacity="0.35" />

      {/* ── Horse ──────────────────────────────────────────────────── */}
      {/* body */}
      <ellipse cx="48" cy="44" rx="18" ry="7" fill="#92400e" />
      {/* legs */}
      <rect x="34" y="44" width="2" height="14" fill="#78350f" />
      <rect x="40" y="44" width="2" height="14" fill="#78350f" />
      <rect x="56" y="44" width="2" height="14" fill="#78350f" />
      <rect x="62" y="44" width="2" height="14" fill="#78350f" />
      {/* head + neck */}
      <path d="M 64 44 Q 70 38 70 30 L 72 30 Q 73 38 70 45 Z" fill="#92400e" />
      {/* mane */}
      <path d="M 66 32 Q 64 28 67 25 Q 70 30 68 35" fill="#3f1d0a" />
      {/* tail */}
      <path d="M 30 42 Q 22 44 24 52" fill="none" stroke="#3f1d0a" strokeWidth="2" strokeLinecap="round" />
      {/* eye */}
      <circle cx="69" cy="33" r="0.7" fill="#0e1116" />

      {/* ── Paladin on horse ──────────────────────────────────────── */}
      {/* torso (silver plate) */}
      <path d="M 44 32 L 52 32 L 53 42 L 43 42 Z" fill="#cbd5e1" stroke="#64748b" strokeWidth="0.4" />
      {/* tabard with green Tunare leaf */}
      <path d="M 47 33 L 49 33 L 49 42 L 47 42 Z" fill="#1f3b1f" />
      <circle cx="48" cy="37" r="1.1" fill="#86efac" />
      {/* head — high elf skin */}
      <circle cx="48" cy="27" r="3.4" fill="#fde7d3" />
      {/* elf ear point */}
      <path d="M 51.5 27 L 53 25 L 51.5 28 Z" fill="#fde7d3" />
      {/* hair (long, blond) */}
      <path d="M 44.6 25 Q 43 23 45 21 Q 48 19.5 51 21 Q 53 23 51.4 25.5 Q 50 24 48 24 Q 46 24 44.6 25 Z" fill="#fef08a" />
      {/* halo / divine glow */}
      <ellipse cx="48" cy="22" rx="3.5" ry="1" fill="none" stroke="#fde047" strokeWidth="0.5" opacity="0.9" />
      {/* sword arm raised */}
      <rect x="51" y="22" width="1.6" height="9" fill="#cbd5e1" transform="rotate(20 51.8 26)" />

      {/* ── Flaming epic sword ────────────────────────────────────── */}
      {/* hilt */}
      <rect x="55" y="16" width="1.6" height="3" fill="#a16207" />
      <rect x="53" y="18" width="6" height="1.2" fill="#facc15" />
      {/* blade */}
      <polygon points="55,3 57,3 56.6,18 55.4,18" fill="url(#bladeGrad)" stroke="#475569" strokeWidth="0.25" />
      {/* flame around blade */}
      <path d="M 55 6 Q 51 4 52 1 Q 55 3 56 0 Q 57 3 60 1 Q 61 4 57 6 Q 58 9 55 7 Z" fill="url(#flameGrad)" opacity="0.95" />
      <path d="M 55.5 4 Q 54 3 54.5 1 Q 56 2 56.5 0 Q 57 2 58.5 1 Q 59 3 57.5 4 Z" fill="#fff7c2" />

      {/* ── Tunare (left) ─────────────────────────────────────────── */}
      {/* hair flowing down */}
      <path d="M 20 22 Q 13 30 17 50 Q 21 38 24 24 Z" fill="#65a30d" opacity="0.85" />
      <path d="M 28 22 Q 35 30 31 50 Q 27 38 24 24 Z" fill="#65a30d" opacity="0.85" />
      {/* dress */}
      <path d="M 19 32 L 29 32 L 32 56 L 16 56 Z" fill="#16a34a" />
      <path d="M 21 38 L 27 38 L 28 50 L 20 50 Z" fill="#22c55e" opacity="0.7" />
      {/* arm reaching toward paladin */}
      <path d="M 28 33 Q 35 30 42 30" fill="none" stroke="#fde7d3" strokeWidth="1.6" strokeLinecap="round" />
      {/* face */}
      <circle cx="24" cy="26" r="3.3" fill="#fde7d3" />
      {/* floral crown */}
      <circle cx="22" cy="22" r="0.9" fill="#ec4899" />
      <circle cx="24" cy="21.4" r="1.0" fill="#facc15" />
      <circle cx="26" cy="22" r="0.9" fill="#ec4899" />
      {/* leaf in hair */}
      <path d="M 19 23 Q 17 22 18 24 Q 19.5 24 19 23 Z" fill="#16a34a" />
      {/* lips toward paladin's cheek */}
      <path d="M 27.5 27 Q 29 27 28.5 28 Q 27.5 28 27.5 27 Z" fill="#e11d48" />

      {/* ── Kiss spark between them ───────────────────────────────── */}
      <text x="34" y="24" fontSize="6" fill="#ec4899">💋</text>

      {/* ── Sparkles ──────────────────────────────────────────────── */}
      <text x="6"  y="14" fontSize="5" fill="#fde047" opacity="0.9">✨</text>
      <text x="62" y="12" fontSize="4" fill="#fde047" opacity="0.7">✨</text>
    </svg>
  );
}

function KyinenExecutionCard({ executions, latest, zone, tz }: {
  executions: number;
  latest: string | null;
  zone: string | null;
  tz: string;
}) {
  const dateLine = latest
    ? `Last execution: ${fmtAbs(latest, tz)}${zone ? ` · ${zone}` : ''}`
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
