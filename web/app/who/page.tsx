// /who directory — one row per character ever seen in a /who the agents have
// uploaded (members AND non-members), collapsed from the who_observations log
// via the who_directory view. Sortable + filterable. Open to any signed-in
// guild member (read-only); OFFICERS additionally get inline edits for class
// (fills in /anon rows that never reported one) and the Zek flag. Edits persist
// to who_overrides and are gated server-side in actions.ts too.

import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { isOfficer } from '@/lib/officer';
import { normalizeClass } from '@/lib/class-titles';
import WhoTable, { type WhoRow } from './WhoTable';
import WhoBreakdown from './WhoBreakdown';

export const dynamic = 'force-dynamic';

type DirRow = {
  character: string;
  character_key: string;
  race: string | null;
  observed_class: string | null;
  level: number | null;
  guild_name: string | null;
  guild_rank: string | null;
  anonymous: boolean | null;
  gm: boolean | null;
  last_seen: string | null;
  first_seen: string | null;
  obs_count: number | null;
  ever_zek_guild: boolean | null;
  ever_inferred_zek: boolean | null;
  zone: string | null;
};

type OverrideRow = {
  character: string;
  class: string | null;
  is_zek: boolean | null;
  set_by_name: string | null;
  updated_at: string | null;
};

async function loadRows(): Promise<{ rows: WhoRow[]; totalInDb: number | null }> {
  const admin = supabaseAdmin();
  // Directory — paginated full pull so client-side filters (class / guild /
  // search) see the WHOLE catalog, not just the most-recently-seen 1000.
  // Pre-2026-06-21 we used `.limit(5000)` and naively expected PostgREST to
  // honor it; the Supabase REST gateway silently caps any single response at
  // its `max-rows` (1000 by default), so a "Druids only" filter was scoping
  // to the top-1000 by last_seen and silently missing the rest of the
  // catalog (~7700 rows on the wire today). Uilnayar caught it 2026-06-21
  // ("76 shown · 1,000 loaded · 8,738 in catalog" → are these 76 in the
  // 1k or the 8.7k? — they were in the 1k). Loop with .range() now until
  // we drain.
  const PAGE = 1000;
  const HARD_CAP = 20_000;  // safety stop; we'll log if we ever hit it
  const allRows: DirRow[] = [];
  for (let from = 0; from < HARD_CAP; from += PAGE) {
    const { data: page, error } = await admin
      .from('who_directory')
      .select('*')
      .order('last_seen', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) break;
    if (!page || page.length === 0) break;
    allRows.push(...(page as DirRow[]));
    if (page.length < PAGE) break;  // last page
  }
  const rows = allRows;

  // Separately fetch the catalog total via a head-count so the header still
  // surfaces "X loaded of Y in catalog" if we ever truncate at the hard cap.
  const { count: totalCount } = await admin
    .from('who_directory')
    .select('character', { count: 'exact', head: true });
  const totalInDb = (typeof totalCount === 'number') ? totalCount : null;

  const { data: ov } = await admin
    .from('who_overrides')
    .select('character, class, is_zek, set_by_name, updated_at')
    .eq('guild_id', 'wolfpack');
  const overrides = new Map<string, OverrideRow>();
  for (const o of (ov ?? []) as OverrideRow[]) {
    overrides.set(o.character.toLowerCase(), o);
  }

  // OpenDKP roster classes — authoritative for our own members, and they fill
  // in the (very common) case where a Wolf Pack member's /who was always /anon
  // so we never observed a class. Used as a fallback below the observed class.
  // ALSO pull opendkp_id so the table can deep-link Wolf Pack member names to
  // their OpenDKP character page for easy edits (Uilnayar 2026-06-21).
  const { data: chars } = await admin
    .from('characters')
    .select('name, class, opendkp_id')
    .eq('guild_id', 'wolfpack');
  const rosterClassByName = new Map<string, string>();
  const opendkpIdByName  = new Map<string, number>();
  for (const c of (chars ?? []) as { name: string; class: string | null; opendkp_id: number | null }[]) {
    if (!c.name) continue;
    const k = c.name.toLowerCase();
    if (c.class) rosterClassByName.set(k, c.class);
    if (c.opendkp_id != null) opendkpIdByName.set(k, c.opendkp_id);
  }

  // Zone short → long display name (e.g. "oasis" → "The Oasis of Marr"). Fall
  // back to the short name if the catalog doesn't have it.
  const { data: zones } = await admin
    .from('eqemu_zone')
    .select('short_name, long_name');
  const zoneLongByShort = new Map<string, string>();
  for (const z of (zones ?? []) as { short_name: string | null; long_name: string | null }[]) {
    if (z.short_name && z.long_name) zoneLongByShort.set(z.short_name.toLowerCase(), z.long_name);
  }

  const mapped = rows.map((r): WhoRow => {
    const o = overrides.get(r.character_key);
    const observedClass = r.observed_class || null;
    const classOverride = o?.class ?? null;
    const rosterClass = rosterClassByName.get(r.character_key) ?? null;
    const zekOverride = (o && o.is_zek != null) ? o.is_zek : null;
    // autoZek = either guild-named Zek OR proximity-inferred Zek (PvP-derived
    // observation where another Zek-guilded character was in zone within ±3m).
    const inferredZek = !!r.ever_inferred_zek;
    const autoZek = !!r.ever_zek_guild || inferredZek;
    return {
      character: r.character,
      race: r.race,
      level: r.level,
      observedClass,
      classOverride,
      rosterClass,
      effectiveClass: classOverride ?? observedClass ?? rosterClass,
      guild: r.guild_name,
      guildRank: r.guild_rank,
      zone: r.zone,
      zoneName: r.zone ? (zoneLongByShort.get(r.zone.toLowerCase()) ?? r.zone) : null,
      anonymous: !!r.anonymous,
      gm: !!r.gm,
      lastSeen: r.last_seen,
      firstSeen: r.first_seen,
      obsCount: r.obs_count ?? 0,
      autoZek,
      inferredZek,
      zekOverride,
      effectiveZek: zekOverride != null ? zekOverride : autoZek,
      setByName: o?.set_by_name ?? null,
      // OpenDKP character link target — present only for Wolf Pack characters
      // we have a roster row for. The WhoTable wraps the name in a link when
      // this is set; otherwise it renders plain.
      opendkpId: opendkpIdByName.get(r.character_key) ?? null,
    };
  });
  return { rows: mapped, totalInDb };
}

export default async function WhoPage() {
  // Members-only (same gate as /parses, /buffs, /me).
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/who');
  const canEdit = await isOfficer(user.id);

  const { rows, totalInDb } = await loadRows();
  const totalLabel = totalInDb != null && totalInDb !== rows.length
    ? `${rows.length.toLocaleString()} loaded of ${totalInDb.toLocaleString()} in catalog`
    : `${rows.length.toLocaleString()} total`;

  // Class + guild breakdown — counts by *effective* class (folding titles +
  // overrides) and by *observed* guild. Excludes Wolf Pack from the guild
  // chart (it dominates and isn't an interesting datapoint to officers
  // looking at "who else is out there"). Excludes the empty bucket.
  const byClass = new Map<string, number>();
  const byGuild = new Map<string, number>();
  for (const r of rows) {
    const k = normalizeClass(r.effectiveClass);
    if (k) byClass.set(k, (byClass.get(k) || 0) + 1);
    const g = r.guild ? r.guild.trim() : '';
    if (g && g !== 'Wolf Pack') byGuild.set(g, (byGuild.get(g) || 0) + 1);
  }
  const classBreakdown = [...byClass.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const guildBreakdown = [...byGuild.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return (
    <div className="space-y-4">
      <section className="bg-panel border border-border rounded-lg p-5">
        <h2 className="text-xl text-gold mb-2">👁 /who Directory</h2>
        <p className="text-sm text-dim leading-6">
          Every character the agents have ever seen in a <code>/who</code>, collapsed to
          one row each ({totalLabel}). Class/level/guild show the most
          recent <em>non-anon</em> value we observed. Sort + filter to find anyone we&apos;ve crossed.
          {canEdit
            ? <> As an officer you can set a class for rows that never reported one (always <code>/anon</code>),
                and flag <span className="text-red">Zek</span> for known PvP-guild affiliates — overrides win
                over observed values and persist in <code>who_overrides</code>.</>
            : <> Class/Zek overrides are officer-curated.</>}
        </p>
      </section>
      <WhoBreakdown classBreakdown={classBreakdown} guildBreakdown={guildBreakdown} />
      <WhoTable rows={rows} canEdit={canEdit} totalInDb={totalInDb} />
    </div>
  );
}
