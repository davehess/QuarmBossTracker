// Officer tool: /who directory. One row per character ever seen in a /who the
// agents have uploaded (members AND non-members), collapsed from the
// who_observations log via the who_directory view. Sortable + filterable, with
// inline officer edits for class (fills in /anon rows that never reported one)
// and the Zek flag (tag PvP-guild affiliates). Edits persist to who_overrides.
//
// Auth + officer gating handled by the parent /admin layout.

import { supabaseAdmin } from '@/lib/supabase';
import WhoTable, { type WhoRow } from './WhoTable';

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
};

type OverrideRow = {
  character: string;
  class: string | null;
  is_zek: boolean | null;
  set_by_name: string | null;
  updated_at: string | null;
};

async function loadRows(): Promise<WhoRow[]> {
  const admin = supabaseAdmin();
  // Directory — cap to a sane ceiling; the most-recently-seen come first so the
  // page is useful even if the catalog grows large.
  const { data: dir } = await admin
    .from('who_directory')
    .select('*')
    .order('last_seen', { ascending: false })
    .limit(5000);
  const rows = (dir ?? []) as DirRow[];

  const { data: ov } = await admin
    .from('who_overrides')
    .select('character, class, is_zek, set_by_name, updated_at')
    .eq('guild_id', 'wolfpack');
  const overrides = new Map<string, OverrideRow>();
  for (const o of (ov ?? []) as OverrideRow[]) {
    overrides.set(o.character.toLowerCase(), o);
  }

  return rows.map((r): WhoRow => {
    const o = overrides.get(r.character_key);
    const observedClass = r.observed_class || null;
    const classOverride = o?.class ?? null;
    const zekOverride = (o && o.is_zek != null) ? o.is_zek : null;
    const autoZek = !!r.ever_zek_guild;
    return {
      character: r.character,
      race: r.race,
      level: r.level,
      observedClass,
      classOverride,
      effectiveClass: classOverride ?? observedClass,
      guild: r.guild_name,
      guildRank: r.guild_rank,
      anonymous: !!r.anonymous,
      gm: !!r.gm,
      lastSeen: r.last_seen,
      firstSeen: r.first_seen,
      obsCount: r.obs_count ?? 0,
      autoZek,
      zekOverride,
      effectiveZek: zekOverride != null ? zekOverride : autoZek,
      setByName: o?.set_by_name ?? null,
    };
  });
}

export default async function AdminWhoPage() {
  const rows = await loadRows();
  return (
    <div className="space-y-4">
      <section className="bg-panel border border-border rounded-lg p-5">
        <h2 className="text-xl text-gold mb-2">👁 /who Directory</h2>
        <p className="text-sm text-dim leading-6">
          Every character the agents have ever seen in a <code>/who</code>, collapsed to
          one row each ({rows.length.toLocaleString()} total). Class/level/guild show the most
          recent <em>non-anon</em> value we observed. Set a class for rows that never reported
          one (always <code>/anon</code>), and flag <span className="text-red">Zek</span> for known
          PvP-guild affiliates. Overrides win over observed values and persist in
          <code> who_overrides</code>.
        </p>
      </section>
      <WhoTable rows={rows} />
    </div>
  );
}
