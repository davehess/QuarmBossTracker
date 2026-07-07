// /fun — guild-flavor counters that don't matter for raid optimization but
// are fun to track. First tenants: Peopleslayer LD counter (from the agent's
// fun_events stream) and Tunare mentions from Naggato's family (from the
// chat_messages table). Future tenants will join as the agent ships their
// detectors: CotH Pearl (Magician), DI Emerald, Aegolism/Rune Peridot, etc.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { unstable_cache } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { userTz, fmtAbs } from '@/lib/timezone';

export const dynamic = 'force-dynamic';

// value is `number | string` so cards like "Longest Dire Charm" can show
// a pre-formatted "4h 23m" string while normal counter cards stay numeric.
// The renderer calls value.toLocaleString() which works for both.
type Counter = { label: string; emoji: React.ReactNode; value: number | string; sub?: string | React.ReactNode; href?: string };
type Sb = ReturnType<typeof supabaseAdmin>;

// Each card is an independent SECTION closure; loadCounters runs them ALL
// CONCURRENTLY and concatenates results in declaration order. This page used
// to be one long sequential await chain — ~25 query round-trips SUMMED into
// the load time, and two of them scanned growing tables (the 2026-07-07
// regression: chat_messages hit 284k rows → the Tunare ILIKE scans cost ~1.5s
// EACH; encounter_combat_rollup hit 28k rows → the dirge card shipped 20k
// jsonb rows per load AND silently under-counted past its .limit). Those two
// now use SQL-side RPCs (fun_tunare_stats / fun_dirge_damage, see the
// 20260707050000 migration); everything else just runs in parallel.
const SECTIONS: Array<(sb: Sb, counters: Counter[]) => Promise<void>> = [];

// Dirge totals — SQL-side aggregate over encounter_combat_rollup's by_skill
// jsonb (fun_dirge_damage RPC, ~1.2s), cached 10 min: the number only moves
// when a bard uploads a new fight, so nearly every page view pays ~0 instead
// of the old 20k-row jsonb fetch (which was also silently truncated once the
// table outgrew its .limit(20000) — 28k rows as of 2026-07-07).
const getDirgeTotals = unstable_cache(
  async () => {
    const { data } = await supabaseAdmin().rpc('fun_dirge_damage');
    return (Array.isArray(data) ? data : []) as { character_name: string; dmg: number; hits: number }[];
  },
  ['fun-dirge-damage'],
  { revalidate: 600 },
);

// Standalone — fetched separately so the Kyinen execution card can render
// with its own gold-frame styling above the normal counter grid.
async function loadKyinen(sb: Sb) {
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
  return { executions: kyinenExecutions, latest: kyinenLatest, zone: kyinenZone };
}

SECTIONS.push(async (sb, counters) => {
  // Peopleslayer LD card — count + damage he logged in fights he was ACTUALLY
  // disconnected during. The joke: he goes linkdead mid-fight and his character
  // keeps swinging. The earlier version summed his total_damage across EVERY
  // encounter that started after his first-ever LD — i.e. essentially his whole
  // damage history since the first LD, a meaningless multi-million number. Now
  // we only count an encounter if one of his LD timestamps falls inside that
  // encounter's window [started_at, started_at + duration_sec] — "damage dealt
  // while he was disconnected." Still only his own encounter_players rows.
  // ── 🔌 Raids since Peopleslayer crashed ──────────────────────────────────
  // Peopleslayer got a new machine; we flipped the card from "lifetime LD
  // count" (the old one — strikethrough'd in the subtitle as a callback) to
  // "raids since the most recent LD", per his own suggestion. Shows the date
  // of the last LD in bold + the zone it happened in (agent v3.1.72+ enriches
  // the event with the zone from Zeal state). Previous-best streak strikes
  // through when broken — same pattern as the Moash card. (Uilnayar 2026-06-26.)
  try {
    const { data: ldRows, count: ldTotal } = await sb
      .from('fun_events')
      .select('event_ts, target', { count: 'exact' })
      .eq('event_type', 'peopleslayer_ld')
      .order('event_ts', { ascending: true });
    const lds = ((ldRows ?? []) as { event_ts: string; target: string | null }[])
      .map(r => ({ ts: new Date(r.event_ts).getTime(), zone: r.target }))
      .filter(r => Number.isFinite(r.ts));

    // "Raids since" = distinct UTC dates where Peopleslayer parsed an
    // encounter, from after his most recent LD until today. Each distinct
    // calendar date counts as one raid he survived without going LD.
    const fmtDay = (t: number) => new Date(t).toISOString().slice(0, 10);
    let raidsSince = 0;
    let prevRecordRaids = 0;
    if (lds.length > 0) {
      const lastLdMs = lds[lds.length - 1].ts;
      const { data: ep } = await sb
        .from('encounter_players')
        .select('encounters!inner(started_at)')
        .ilike('character_name', 'Peopleslayer')
        .gte('encounters.started_at', new Date(lastLdMs + 60_000).toISOString())
        .limit(5000);
      type EpRow = { encounters: { started_at: string } | { started_at: string }[] | null };
      const sinceDays = new Set<string>();
      for (const r of (ep ?? []) as unknown as EpRow[]) {
        const enc = Array.isArray(r.encounters) ? r.encounters[0] : r.encounters;
        if (!enc?.started_at) continue;
        sinceDays.add(enc.started_at.slice(0, 10));
      }
      raidsSince = sinceDays.size;

      // Previous-best streak — for each consecutive pair of LDs, count distinct
      // raid dates Peopleslayer parsed between them. The biggest one is the
      // record to beat. Cheap-and-correct: one extra query covering all gaps.
      if (lds.length >= 2) {
        const firstMs = lds[0].ts;
        const { data: epAll } = await sb
          .from('encounter_players')
          .select('encounters!inner(started_at)')
          .ilike('character_name', 'Peopleslayer')
          .gte('encounters.started_at', new Date(firstMs - 60_000).toISOString())
          .lte('encounters.started_at', new Date(lastLdMs + 60_000).toISOString())
          .limit(8000);
        const allStarts: number[] = [];
        for (const r of (epAll ?? []) as unknown as EpRow[]) {
          const enc = Array.isArray(r.encounters) ? r.encounters[0] : r.encounters;
          if (!enc?.started_at) continue;
          const t = new Date(enc.started_at).getTime();
          if (Number.isFinite(t)) allStarts.push(t);
        }
        for (let i = 0; i < lds.length - 1; i++) {
          const lo = lds[i].ts, hi = lds[i + 1].ts;
          const days = new Set<string>();
          for (const t of allStarts) if (t > lo && t < hi) days.add(fmtDay(t));
          if (days.size > prevRecordRaids) prevRecordRaids = days.size;
        }
      }
    }

    if (lds.length === 0) {
      counters.push({
        label: 'Raids since Peopleslayer crashed',
        emoji: '🔌',
        value: '—',
        sub: 'no LDs on record yet — first one resets the counter and lights the card up.',
      });
    } else {
      const lastLd  = lds[lds.length - 1];
      const lastDt  = new Date(lastLd.ts);
      const lastLbl = lastDt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
      const zoneLbl = lastLd.zone || '—';
      const showPrev = prevRecordRaids > raidsSince;
      counters.push({
        label: 'Raids since Peopleslayer crashed',
        emoji: '🔌',
        value: raidsSince,
        sub: (
          <>
            Last LD: <strong className="text-text">{lastLbl}</strong> in{' '}
            <strong className="text-text">{zoneLbl}</strong>
            {showPrev && (
              <>
                {' · '}
                <span className="line-through text-dim/60">previous record {prevRecordRaids}</span>
              </>
            )}
            {' · '}
            <span className="line-through text-dim/60" title="The card used to count his lifetime LDs — flipped now per his suggestion to count raids without an LD.">
              {(ldTotal ?? 0).toLocaleString()} lifetime LDs
            </span>
          </>
        ),
      });
    }
  } catch (err) {
    counters.push({
      label: 'Raids since Peopleslayer crashed',
      emoji: '🔌',
      value: 0,
      sub: 'no data yet.',
    });
    void err;
  }
});

SECTIONS.push(async (sb, counters) => {
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
      // ONE indexed RPC (count + latest together). The old version ran two
      // parallel `text ILIKE '%tunare%'` scans through PostgREST — each a
      // full seq scan of chat_messages, ~1.5s apiece by the time the table
      // hit 284k rows. fun_tunare_stats walks the lower(speaker) index to
      // touch only the family's rows: ~18ms measured.
      const { data: stats } = await sb.rpc('fun_tunare_stats', { p_names: familyNames });
      const row = (Array.isArray(stats) ? stats[0] : stats) as { invocations: number | null; last_ts: string | null } | undefined;
      const count = Number(row?.invocations ?? 0);
      const lastTs = row?.last_ts ? new Date(row.last_ts) : null;
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
});

SECTIONS.push(async (sb, counters) => {
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
});

SECTIONS.push(async (sb, counters) => {
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
});

SECTIONS.push(async (sb, counters) => {
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
});

SECTIONS.push(async (sb, counters) => {
  // ── 🎵 Dirge damage — bard targeted-AoE damage songs (Denon's Desperate
  //    Dirge et al.) ────────────────────────────────────────────────────────
  // DAMAGE-driven, not cast-count-driven. The old card gated on a
  // `dirge_cast` fun_event that never fired (no such detector shipped), so it
  // sat at 0 forever even though the damage was in the data. Denon's
  // Desperate Dirge is a targeted PBAoE that can hit 4-5 players for several
  // hundred to thousands each; the agent logs it in encounter_combat_rollup
  // by_skill under the song name. We sum every by_skill key containing
  // "dirge" (folds Denon's + any other Dirge-of-* damage song), per bard, and
  // headline the TOTAL DAMAGE. by_skill is upload-side only (agent with
  // ability detail), so bards who never ran the agent contribute 0 — the
  // number grows as more bards upload. Cast count is parked until/if a
  // bystander-side "begins singing Dirge of …" detector ships.
  try {
    const totals = await getDirgeTotals();
    let dirgeDamage = 0;
    let dirgeHits = 0;
    const byBard = new Map<string, number>();
    for (const r of totals) {
      const dmg = Number(r.dmg) || 0;
      dirgeDamage += dmg;
      dirgeHits   += Number(r.hits) || 0;
      if (dmg > 0) byBard.set(r.character_name, (byBard.get(r.character_name) ?? 0) + dmg);
    }
    const ranked = [...byBard.entries()].sort((a, b) => b[1] - a[1]);
    if (dirgeDamage > 0) {
      const top = ranked.slice(0, 3).map(([n, d]) => `${n} ${d.toLocaleString()}`);
      counters.push({
        label: 'Dirge damage — killed a whole guild',
        emoji: '🎵',
        value: dirgeDamage,
        sub: `${dirgeHits.toLocaleString()} hit${dirgeHits === 1 ? '' : 's'} across ${ranked.length} bard${ranked.length === 1 ? '' : 's'}${top.length ? ` · top: ${top.join(' · ')}` : ''}`,
      });
    } else {
      counters.push({
        label: 'Dirge damage — killed a whole guild',
        emoji: '🎵',
        value: 0,
        sub: 'no dirge damage captured yet — lands in encounter_combat_rollup once a bard uploads a fight with ability detail (Denon’s Desperate Dirge etc.)',
      });
    }
  } catch (err) {
    void err;
  }

  // (Avg-haste card removed 2026-06-22 per owner request — it was a noisy
  // "right now" snapshot that depended on two specific buffs being live and
  // mostly read "—".)
});

SECTIONS.push(async (sb, counters) => {
  // ── 😈 Lord of Ire vanquished ─────────────────────────────────────────────
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
        href: '/fun/lord-of-ire',
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
});

SECTIONS.push(async (sb, counters) => {
  // ── 🤬 Pottymouth award — chat-filter asterisk redactions ────────────────
  // Fires when the bot sees a chat line where EQ's filter scrubbed a word with
  // asterisks ('f***ing nice'). Sub-text: top 3 offenders. (Uilnayar 2026-06-26.)
  try {
    const { data: pmRows, count: pmTotal } = await sb
      .from('fun_events')
      .select('caster', { count: 'exact' })
      .eq('event_type', 'pottymouth');
    const tally = new Map<string, number>();
    for (const r of (pmRows ?? []) as { caster: string | null }[]) {
      const k = r.caster || 'unknown';
      tally.set(k, (tally.get(k) ?? 0) + 1);
    }
    const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
    const total  = pmTotal ?? 0;
    counters.push({
      label: 'Pottymouth award',
      emoji: '🤬',
      value: total,
      sub: total > 0
        ? ranked.slice(0, 3).map(([n, c]) => `${n} ×${c}`).join(' · ')
        : 'no asterisks logged yet — fires when EQ filters a word ("f*** zerg")',
    });
  } catch (err) { void err; }
});

SECTIONS.push(async (sb, counters) => {
  // ── 🍺 Drunkard award — multiple EQ slur variants of the same line ───────
  // EQ's drunk effect mutates a broadcast's letters per-receiver, so the bot
  // sees a different version per agent. The bot's fuzzy chat dedup catches
  // these and emits a drunkard fun_event on the SECOND distinct variant of
  // one underlying line — meaning at least two agents saw differently-slurred
  // copies, the signal Uilnayar called out ("really observed when seen by
  // multiple people and when a player is the one that says the word").
  try {
    const { data: drRows, count: drTotal } = await sb
      .from('fun_events')
      .select('caster', { count: 'exact' })
      .eq('event_type', 'drunkard');
    const tally = new Map<string, number>();
    for (const r of (drRows ?? []) as { caster: string | null }[]) {
      const k = r.caster || 'unknown';
      tally.set(k, (tally.get(k) ?? 0) + 1);
    }
    const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
    const total  = drTotal ?? 0;
    counters.push({
      label: 'Drunkard award',
      emoji: '🍺',
      value: total,
      sub: total > 0
        ? ranked.slice(0, 3).map(([n, c]) => `${n} ×${c}`).join(' · ')
        : 'no slurred broadcasts yet — fires when ≥2 agents see different mutations of one line',
    });
  } catch (err) { void err; }
});

SECTIONS.push(async (sb, counters) => {
  // ── 💀 Days since Moash died to enrage ───────────────────────────────────
  // Loud-and-tall card with the date bolded + the previous-best streak
  // strikethrough'd when broken. Source: fun_events emitted by the
  // /enragedeath officer command (Uilnayar 2026-06-26 — Shavimo's manual
  // "It has been ~~167~~ 0 days since Moash died to enrage" gag goes live).
  try {
    const { data: enrageRows } = await sb
      .from('fun_events')
      .select('event_ts, caster')
      .eq('event_type', 'enrage_death')
      .ilike('caster', 'Moash')
      .order('event_ts', { ascending: true });
    const rows = ((enrageRows ?? []) as { event_ts: string; caster: string }[])
      .map(r => new Date(r.event_ts).getTime())
      .filter(t => Number.isFinite(t));
    if (rows.length > 0) {
      const lastMs   = rows[rows.length - 1];
      const todayMs  = Date.now();
      const dayMs    = 24 * 60 * 60 * 1000;
      const currentDays = Math.max(0, Math.floor((todayMs - lastMs) / dayMs));
      // Previous-best streak = the longest gap (in days) between any two
      // consecutive enrage deaths in history. If there's only one death so
      // far we have no prior record to compare against.
      let prevRecordDays = 0;
      for (let i = 1; i < rows.length; i++) {
        const gap = Math.floor((rows[i] - rows[i - 1]) / dayMs);
        if (gap > prevRecordDays) prevRecordDays = gap;
      }
      const lastDate = new Date(lastMs).toISOString().slice(0, 10);
      const lastDateLabel = new Date(lastMs).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
      const showPrev = prevRecordDays > currentDays;   // only strikeout the prior record when we just broke it
      counters.push({
        label: 'Days since Moash died to enrage',
        emoji: '💀',
        value: currentDays,
        sub: (
          <>
            Last death: <strong className="text-text">{lastDateLabel}</strong>
            {' · '}
            <span className="text-dim/70">{rows.length} on record</span>
            {showPrev && (
              <>
                {' · '}
                <span className="line-through text-dim/60">previous record {prevRecordDays}d</span>
              </>
            )}
          </>
        ),
        href: undefined,
      });
      void lastDate;
    } else {
      counters.push({
        label: 'Days since Moash died to enrage',
        emoji: '💀',
        value: '—',
        sub: 'no enrage death recorded yet — an officer can log one with /enragedeath',
      });
    }
  } catch (err) { void err; }
});

SECTIONS.push(async (sb, counters) => {
  // ── ⚡ Mana donated to casters — necromancer "Subversion" twitches ─────────
  // Two signals (agent v3.1.50 caster-side, v3.1.51 recipient-side):
  //   • `mana_twitch` (caster-side) — exact: reagent_qty = mana gifted per cast
  //     (60 Rapacious / 100 Covetous / 150 Sedulous). Needs the NECRO on the agent.
  //   • `mana_twitch_received` (recipient-side) — count only: fires on every
  //     caster the necro twitches who runs the agent, so it covers the necro
  //     even when HE isn't running it. No amount in the line, so we estimate.
  // The headline stays the exact total; when only recipient data exists we lead
  // with a clearly-marked ~estimate (count × the 60–150 tier range) so the card
  // isn't stuck at zero before the necro installs.
  const TWITCH_MID = 100;  // mid-tier (Covetous) mana for the point estimate
  try {
    const [{ data: twRows }, { count: recvCount }] = await Promise.all([
      sb.from('fun_events').select('caster, reagent_qty').eq('event_type', 'mana_twitch'),
      sb.from('fun_events').select('*', { count: 'exact', head: true }).eq('event_type', 'mana_twitch_received'),
    ]);
    const rows = (twRows ?? []) as { caster: string | null; reagent_qty: number | null }[];
    const received = recvCount ?? 0;
    let totalMana = 0;
    const byCaster = new Map<string, number>();
    for (const r of rows) {
      const mana = Number(r.reagent_qty) || 0;
      totalMana += mana;
      const k = r.caster || 'unknown';
      byCaster.set(k, (byCaster.get(k) ?? 0) + mana);
    }
    const top = [...byCaster.entries()].sort((a, b) => b[1] - a[1])[0];
    if (totalMana > 0) {
      counters.push({
        label: 'Mana donated to casters',
        emoji: '⚡',
        value: totalMana,
        sub: `across ${rows.length.toLocaleString()} twitches${top ? ` · top battery: ${top[0]} (${top[1].toLocaleString()} mana)` : ''}${received > 0 ? ` · +${received.toLocaleString()} more seen from the receiving end` : ''}`,
      });
    } else if (received > 0) {
      counters.push({
        label: 'Mana donated to casters',
        emoji: '⚡',
        value: `~${(received * TWITCH_MID).toLocaleString()}`,
        sub: `est. from ${received.toLocaleString()} twitches seen in casters' logs (~${(received * 60).toLocaleString()}–${(received * 150).toLocaleString()} mana). Exact total lights up when the necro runs the agent.`,
      });
    } else {
      counters.push({
        label: 'Mana donated to casters',
        emoji: '⚡',
        value: 0,
        sub: 'no twitches captured yet — agent v3.1.51+ ticks this up from each necro "Subversion" cast (caster-side exact, recipient-side covers necros not yet on the agent)',
      });
    }
  } catch (err) { void err; }
});

SECTIONS.push(async (sb, counters) => {
  // ── 🧠 Mind Wrack — enemy mana burned ─────────────────────────────────────
  // Caster-side `mind_wrack_cast` (one per cast, the true count) + recipient-side
  // `mind_wrack_recourse` ("You feel foreign mana strengthen your mind." — the
  // group-mana refund, one per groupmate per cast). Recourse covers the necro
  // when he's not on the agent, but it's inflated by group size, so we never
  // present it AS the cast count — just as coverage / a "feeding the group" note.
  try {
    const [{ data: mwRows, count: mwTotal }, { count: recourseCount }] = await Promise.all([
      sb.from('fun_events').select('caster', { count: 'exact' }).eq('event_type', 'mind_wrack_cast'),
      sb.from('fun_events').select('*', { count: 'exact', head: true }).eq('event_type', 'mind_wrack_recourse'),
    ]);
    const tally = new Map<string, number>();
    for (const r of (mwRows ?? []) as { caster: string | null }[]) {
      const k = r.caster || 'unknown';
      tally.set(k, (tally.get(k) ?? 0) + 1);
    }
    const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
    const total = mwTotal ?? 0;
    const recourse = recourseCount ?? 0;
    if (total > 0) {
      counters.push({
        label: 'Mind Wracks — mana burned off mobs',
        emoji: '🧠',
        value: total,
        sub: `${top ? `top burner: ${top[0]} ×${top[1]}` : ''}${recourse > 0 ? `${top ? ' · ' : ''}${recourse.toLocaleString()} group mana-backs logged` : ''}` || undefined,
      });
    } else {
      counters.push({
        label: 'Mind Wracks — mana burned off mobs',
        emoji: '🧠',
        value: 0,
        sub: recourse > 0
          ? `${recourse.toLocaleString()} group mana-backs seen in groupmates' logs (≈ casts × group size) — the exact Mind Wrack count lights up when the necro runs the agent`
          : 'no Mind Wracks captured yet — agent v3.1.51+ ticks this up (caster-side count + recipient-side group recourse)',
      });
    }
  } catch (err) { void err; }
});

async function loadCounters() {
  const sb = supabaseAdmin();
  const kyinenP = loadKyinen(sb);
  // All sections in flight at once — page latency ≈ the slowest single
  // section instead of the sum of every query. Each section already has its
  // own try/catch; this outer guard is belt-and-suspenders so one bad card
  // can never blank the page.
  const results = await Promise.all(SECTIONS.map(async fn => {
    const out: Counter[] = [];
    try { await fn(sb, out); } catch { /* card omitted */ }
    return out;
  }));
  return { counters: results.flat(), kyinen: await kyinenP };
}

export default async function FunPage() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/fun');

  const tz = await userTz();
  const { counters, kyinen } = await loadCounters();

  // Bucket cards: "live" ones carry real data; "dormant" ones are still at
  // zero / "—" (detector hasn't fired or nobody's triggered them yet) and
  // get demoted to a dimmer section at the bottom so the live stats lead.
  // Uilnayar 2026-06-22 ("any empty fun ones should be moved to the bottom
  // section").
  const isLive = (c: { value: number | string }) =>
    !(c.value === 0 || c.value === '—');
  const liveCounters    = counters.filter(isLive);
  const dormantCounters = counters.filter(c => !isLive(c));

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

      {/* What's new tonight — small callout marking the fresh fun cards so
          guildies can laugh at them (and at each other). Hard-coded ledger
          rather than a feed; intentionally short. Update this list as new
          fun stuff lands and rotate older items out. (Uilnayar 2026-06-26.) */}
      <section className="bg-panel border border-purple/50 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
          <span aria-hidden className="text-base">🆕</span>
          <h3 className="text-sm text-purple uppercase tracking-wide">What&apos;s new</h3>
          <span className="text-[10px] text-dim">2026-06-26</span>
        </div>
        <ul className="text-xs space-y-1 text-text leading-5">
          <li><strong>🎯 Mimic v1.1.1 (beta)</strong> — Mimic now <em>scans your machine</em> for GINA + EQ Log Parser libraries and shows what it found. Visibility only — nothing leaves your dashboard. Settings → Info card lights up the moment a known pack (Safe Space, custom, etc.) is detected.</li>
          <li><strong>🗳 Mimic v1.1.2 (beta)</strong> — every trigger fire shows three buttons: <code className="text-dim">« Earlier · ✓ Good! · » Too early</code>. Tap one and the vote rides the agent&apos;s durable queue up to the bot.</li>
          <li><strong>📊 v1.1.3 — officer aggregate</strong> — those votes now show up on <code className="text-dim">/admin/triggers</code> with a per-trigger recommendation chip (≥3 votes, ≥60% consensus before it lights up). Tunes the guild trigger pack from real raid evidence.</li>
          <li><strong>🤬 Pottymouth award</strong> — chat-filter caught a word with asterisks (<code className="text-dim">f***ing nice</code>) and we know who said it.</li>
          <li><strong>🍺 Drunkard award</strong> — EQ slurs a drunk player&apos;s broadcast differently for every receiver. When ≥2 agents see different mutations of the same line, you&apos;re drunk and we have receipts.</li>
          <li><strong>💀 Days since Moash died to enrage</strong> — Shavimo&apos;s hand-typed gag is now a real card. Officers log a death with <code className="text-dim">/enragedeath player:Moash</code> and the previous streak strikes through automatically.</li>
          <li><strong>🔌 Raids since Peopleslayer crashed</strong> — flipped per his own suggestion (new machine, fresh start). Shows the date of his last LD <em>and</em> the zone it happened in. The old &quot;lifetime LD count&quot; lives on in the subtitle, scribbled out.</li>
          <li className="text-dim">Plus, in case the bug-and-fix is funny too: <strong>chat dedup now collapses drunk-slur variants</strong> so Discord doesn&apos;t double-post when 5 agents each see a different mutation. (Bardtholemu&apos;s <code>FUCK ZERG → Esev ZERG → Ljyu ZERG → Tgfq ZERG</code> spree caught fewer eyes this week.)</li>
        </ul>
      </section>

      {/* Live cards first. */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {liveCounters.map(c => <FunCard key={c.label} c={c} />)}
      </section>

      {/* The Kyinen decree — moved below the live counters (Uilnayar
          2026-06-22 "move the decree to the bottom"). Still its own gold
          frame, just no longer hogging the top of the page. */}
      <KyinenExecutionCard
        executions={kyinen.executions}
        latest={kyinen.latest}
        zone={kyinen.zone}
        tz={tz}
      />

      {/* Dormant cards — real cards that just haven't lit up yet. Dimmed and
          parked at the bottom so they read as "waiting on data," not noise. */}
      {dormantCounters.length > 0 && (
        <section>
          <div className="text-xs text-dim uppercase tracking-wide mb-2">Quiet for now — waiting on data</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 opacity-60">
            {dormantCounters.map(c => <FunCard key={c.label} c={c} />)}
          </div>
        </section>
      )}

      <section className="bg-panel border border-border rounded-lg p-4 text-xs text-dim">
        <div className="font-semibold text-text mb-2">Queued — need an agent detector before a card can appear</div>
        <ul className="space-y-1 list-disc list-inside">
          <li>⚰️ SK Harm Touch damage total + per-type breakdown table</li>
          <li>✋ Paladin Lay on Hands count + heal total</li>
          <li>🦪 CotH Pearl tally (Magician Call of the Hero casts)</li>
          <li>💚 Emerald counter (Cleric Divine Intervention casts + saves)</li>
          <li>💛 Peridot counter (Rune + Aegolism + group buffs; MGB doubles)</li>
          <li>📚 Spell-cast leaderboard (per-character per-spell from agent castCounts)</li>
        </ul>
      </section>
    </div>
  );
}

// One fun counter card. Emoji is absolutely positioned in the top-right so a
// tall SVG emoji (the Tunare kiss scene) can't push the number down and break
// vertical alignment with sibling cards in the same grid row — that was the
// "Tunare Invocations is off" misalignment (Uilnayar 2026-06-22). Label +
// number reserve right padding so they never run under the emoji.
function FunCard({ c }: { c: { label: string; emoji: React.ReactNode; value: number | string; sub?: string | React.ReactNode; href?: string } }) {
  return (
    <div className="relative bg-panel border border-border rounded-lg p-4 overflow-hidden">
      <span aria-hidden className="absolute top-3 right-3 flex items-start justify-end" style={{ width: 60, height: 48, fontSize: 28, lineHeight: 1 }}>
        {c.emoji}
      </span>
      <div className="text-xs text-dim uppercase tracking-wide pr-16 min-h-[2rem]">{c.label}</div>
      <div className="text-3xl text-gold font-bold mt-2">
        {c.href
          ? <Link href={c.href} className="text-gold hover:underline" title="View full breakdown">{c.value.toLocaleString()}</Link>
          : c.value.toLocaleString()}
      </div>
      {c.sub && <div className="text-xs text-dim mt-1">{c.sub}</div>}
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
