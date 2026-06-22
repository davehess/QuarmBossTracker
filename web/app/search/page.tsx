// /search — full results page for the site-wide search box. Hitting Enter in
// the header search navigates here (the dropdown is the quick-pick; this is
// the "show me everything" view). Uilnayar 2026-06-23.
//
// Sections:
//   • Encounters — when the query matches an NPC name, every parse of that NPC
//     with the Main Tank + damage they took next to it (derived from the
//     agent's per-defender stats in contributions.raw_parse).
//   • Characters / Items / Spells — same sources as /api/search, more rows.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { userTz, fmtAbs } from '@/lib/timezone';
import { fmtDmg, fmtDuration, cleanBossName } from '@/lib/format';

export const dynamic = 'force-dynamic';

type Defender = { name?: string; damageTaken?: number; firstAttackAt?: number };
type RawParse = { defenders?: Defender[] };

type EncHit = {
  id: string;
  npcName: string;
  startedAt: string;
  durationSec: number | null;
  totalDamage: number | null;
  mtName: string | null;
  mtDamageTaken: number | null;
};

async function loadEncountersForNpc(sb: ReturnType<typeof supabaseAdmin>, q: string): Promise<EncHit[]> {
  const like = `%${q.replace(/[%_]/g, '')}%`;
  // NPCs whose name matches the query.
  const { data: npcs } = await sb
    .from('eqemu_npc_types')
    .select('id, name')
    .ilike('name', like)
    .limit(15);
  const npcIds = (npcs ?? []).map((n: { id: number }) => n.id);
  if (npcIds.length === 0) return [];
  const nameById = new Map<number, string>();
  for (const n of (npcs ?? []) as { id: number; name: string }[]) nameById.set(n.id, n.name);

  // Recent encounters for those NPCs. Capped — this is a search view.
  const { data: encs } = await sb
    .from('encounters')
    .select('id, npc_id, started_at, duration_sec, total_damage')
    .in('npc_id', npcIds)
    .order('started_at', { ascending: false })
    .limit(25);
  const encRows = (encs ?? []) as { id: string; npc_id: number; started_at: string; duration_sec: number | null; total_damage: number | null }[];
  if (encRows.length === 0) return [];

  // Main tank per encounter — load the tank-defense stats the agent stored in
  // contributions.raw_parse.defenders, pick the defender with the earliest
  // firstAttackAt (the one who engaged first = MT), fall back to most damage
  // taken when timestamps are absent (older agents). Bounded to the listed
  // encounters so the raw_parse payload stays small.
  const encIds = encRows.map(e => e.id);
  const { data: contribs } = await sb
    .from('contributions')
    .select('encounter_id, raw_parse')
    .in('encounter_id', encIds);
  // Gather every defender across all contributions per encounter, then pick the
  // MT: earliest firstAttackAt when any defender has timestamps, otherwise the
  // one who took the most damage. Same heuristic the parse detail page uses.
  const defsByEnc = new Map<string, { name: string; dmg: number; first: number | null }[]>();
  for (const c of (contribs ?? []) as { encounter_id: string; raw_parse: RawParse | null }[]) {
    const list = defsByEnc.get(c.encounter_id) ?? [];
    for (const d of (c.raw_parse?.defenders ?? [])) {
      if (!d.name || !(d.damageTaken && d.damageTaken > 0)) continue;
      list.push({ name: d.name, dmg: d.damageTaken, first: d.firstAttackAt ?? null });
    }
    defsByEnc.set(c.encounter_id, list);
  }
  const mtByEnc = new Map<string, { name: string; dmg: number }>();
  for (const [encId, list] of defsByEnc) {
    if (list.length === 0) continue;
    const haveTs = list.some(d => d.first != null);
    const ranked = [...list].sort((a, b) =>
      haveTs
        ? ((a.first ?? Infinity) - (b.first ?? Infinity)) || (b.dmg - a.dmg)
        : (b.dmg - a.dmg),
    );
    mtByEnc.set(encId, { name: ranked[0].name, dmg: ranked[0].dmg });
  }

  return encRows.map(e => {
    const mt = mtByEnc.get(e.id) || null;
    return {
      id: e.id,
      npcName: nameById.get(e.npc_id) || `npc ${e.npc_id}`,
      startedAt: e.started_at,
      durationSec: e.duration_sec,
      totalDamage: e.total_damage,
      mtName: mt?.name ?? null,
      mtDamageTaken: mt?.dmg ?? null,
    };
  });
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/search');
  const { q: qRaw } = await searchParams;
  const q = (qRaw || '').trim();
  const tz = await userTz();

  if (q.length < 2) {
    return (
      <div className="bg-panel border border-border rounded-lg p-6 text-sm text-dim">
        Type at least 2 characters in the search box to find characters, items, spells, or boss parses.
      </div>
    );
  }

  const sb = supabaseAdmin();
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const [encounters, charsRes, whoRes, itemsRes, spellsRes] = await Promise.all([
    loadEncountersForNpc(sb, q),
    sb.from('characters').select('name, class, main_name').eq('guild_id', 'wolfpack').ilike('name', like).limit(30),
    sb.from('who_directory').select('character, observed_class, level, guild_name').ilike('character', like).order('obs_count', { ascending: false }).limit(40),
    sb.from('eqemu_items').select('id, name').ilike('name', like).limit(30),
    sb.from('eqemu_spells').select('id, name').ilike('name', like).limit(30),
  ]);

  // Characters — roster first, then unique /who names.
  const seen = new Set<string>();
  const characters: { name: string; sub: string }[] = [];
  for (const c of (charsRes.data ?? []) as { name: string; class: string | null; main_name: string | null }[]) {
    const k = c.name.toLowerCase();
    if (seen.has(k)) continue; seen.add(k);
    characters.push({ name: c.name, sub: [c.class, c.main_name && c.main_name !== c.name ? `alt of ${c.main_name}` : 'Wolf Pack'].filter(Boolean).join(' · ') });
  }
  for (const w of (whoRes.data ?? []) as { character: string; observed_class: string | null; level: number | null; guild_name: string | null }[]) {
    const k = (w.character || '').toLowerCase();
    if (!k || seen.has(k)) continue; seen.add(k);
    characters.push({ name: w.character, sub: [w.level ? `L${w.level}` : null, w.observed_class, w.guild_name].filter(Boolean).join(' · ') || 'seen in /who' });
  }

  const items  = (itemsRes.data  ?? []) as { id: number; name: string }[];
  const spells = (spellsRes.data ?? []) as { id: number; name: string }[];
  const nothing = encounters.length === 0 && characters.length === 0 && items.length === 0 && spells.length === 0;

  return (
    <div className="space-y-6">
      <section className="bg-panel border border-border rounded-lg p-5">
        <h1 className="text-xl text-gold">🔍 Search — “{q}”</h1>
        <p className="text-sm text-dim mt-1">
          Characters, items, spells, and boss parses. Type a boss/NPC name to see every parse of it with the Main Tank.
        </p>
      </section>

      {nothing && (
        <section className="bg-panel border border-border rounded-lg p-6 text-sm text-dim">No matches for “{q}”.</section>
      )}

      {encounters.length > 0 && (
        <section className="bg-panel border border-border rounded-lg p-4">
          <h2 className="text-sm text-orange mb-2">⚔️ Parses ({encounters.length})</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-dim text-xs text-left">
                <th className="py-1 pr-3">Boss</th>
                <th className="py-1 pr-3">When</th>
                <th className="py-1 pr-3 text-right">Duration</th>
                <th className="py-1 pr-3 text-right">Raid dmg</th>
                <th className="py-1 pr-3">Main Tank</th>
                <th className="py-1 pr-3 text-right">Tank dmg taken</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {encounters.map(e => (
                <tr key={e.id} className="hover:bg-[#1a212c]">
                  <td className="py-1.5 pr-3">
                    <Link href={`/parses/${e.id}`} className="text-blue hover:underline">{cleanBossName(e.npcName)}</Link>
                  </td>
                  <td className="py-1.5 pr-3 text-dim text-xs">{fmtAbs(e.startedAt, tz)}</td>
                  <td className="py-1.5 pr-3 text-right text-dim">{e.durationSec ? fmtDuration(e.durationSec) : '—'}</td>
                  <td className="py-1.5 pr-3 text-right text-dim">{e.totalDamage != null ? fmtDmg(e.totalDamage) : '—'}</td>
                  <td className="py-1.5 pr-3 text-text">
                    {e.mtName
                      ? <Link href={`/character/${encodeURIComponent(e.mtName)}`} className="text-text hover:text-blue hover:underline">{e.mtName}</Link>
                      : <span className="text-dim">—</span>}
                  </td>
                  <td className="py-1.5 pr-3 text-right text-orange">{e.mtDamageTaken != null ? fmtDmg(e.mtDamageTaken) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-dim mt-2">Main Tank = the defender who engaged first (or took the most damage on older uploads). Click a boss to open the full parse.</p>
        </section>
      )}

      {characters.length > 0 && (
        <section className="bg-panel border border-border rounded-lg p-4">
          <h2 className="text-sm text-orange mb-2">🧑 Characters ({characters.length})</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 text-sm">
            {characters.map(c => (
              <Link key={c.name} href={`/character/${encodeURIComponent(c.name)}`} className="flex items-baseline justify-between gap-2 px-2 py-1 rounded hover:bg-[#1a212c]">
                <span className="text-text truncate">{c.name}</span>
                <span className="text-dim text-[10px] shrink-0">{c.sub}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {items.length > 0 && (
        <section className="bg-panel border border-border rounded-lg p-4">
          <h2 className="text-sm text-orange mb-2">🗡️ Items ({items.length})</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 text-sm">
            {items.map(i => (
              <a key={i.id} href={`https://www.pqdi.cc/item/${i.id}`} target="_blank" rel="noreferrer" className="flex items-baseline justify-between gap-2 px-2 py-1 rounded hover:bg-[#1a212c]">
                <span className="text-text truncate">{i.name}</span>
                <span className="text-dim text-[10px] shrink-0">#{i.id} ↗</span>
              </a>
            ))}
          </div>
        </section>
      )}

      {spells.length > 0 && (
        <section className="bg-panel border border-border rounded-lg p-4">
          <h2 className="text-sm text-orange mb-2">✨ Spells ({spells.length})</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 text-sm">
            {spells.map(s => (
              <a key={s.id} href={`https://www.pqdi.cc/spell/${s.id}`} target="_blank" rel="noreferrer" className="flex items-baseline justify-between gap-2 px-2 py-1 rounded hover:bg-[#1a212c]">
                <span className="text-text truncate">{s.name}</span>
                <span className="text-dim text-[10px] shrink-0">#{s.id} ↗</span>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
