// Personal hub for the signed-in member. Surfaces everything we track
// about characters they own, organized as one section per character with
// shared stats up top.
//
// Identity resolution:
//   1) auth.users.id (signed-in user)
//   2) → wolfpack_members.user_id → discord_id
//   3) → characters.discord_id = that → list of owned chars
//
// Characters without a discord_id link won't appear here even if the
// member owns them. The /admin/links page is the fix for that. The page
// surfaces a clear "no characters linked" CTA when the link is missing.
//
// Sections per character:
//   - Identity (class, race, rank, main/alt, quarmy URL)
//   - Parse stats (encounter count, total damage, top fight)
//   - Recent encounters (last 10, link to /parses/[id])
//   - Upload contributions (when this character was the agent uploader)
//   - Chat counts (30d / all-time)
//   - PvP record (kills + deaths)
//   - Loot won (item count + DKP spent)
//   - Wishlist (item count; full view via /mywishlist Discord command —
//     decryption requires WISHLIST_BID_KEY which only the bot has)

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

type CharRow = {
  name: string;
  main_name: string | null;
  class: string | null;
  race: string | null;
  rank: string | null;
  active: boolean;
  quarmy_url: string | null;
  opendkp_id: number | null;
};

type CharStats = {
  encounterCount: number;
  totalDamage: number;
  topDmg: number;
  topEncounterId: string | null;
  recentEncounters: { id: string; npc_name: string | null; started_at: string | null; damage: number; dps: number }[];

  uploadCount: number;
  lastUpload: string | null;

  chat30: number;
  chatAll: number;

  pvpKills: number;
  pvpDeaths: number;

  lootCount: number;
  dkpSpent: number;

  wishlistCount: number;
};

async function loadOwnedCharacters(userId: string): Promise<{ discordId: string | null; nickname: string | null; chars: CharRow[] }> {
  const admin = supabaseAdmin();
  const { data: pack } = await admin
    .from('wolfpack_members')
    .select('discord_id, nickname, global_name')
    .eq('user_id', userId)
    .maybeSingle();
  if (!pack?.discord_id) return { discordId: null, nickname: pack?.nickname ?? null, chars: [] };
  const { data: chars } = await admin
    .from('characters')
    .select('name, main_name, class, race, rank, active, quarmy_url, opendkp_id')
    .eq('guild_id', 'wolfpack')
    .eq('discord_id', pack.discord_id)
    .order('active', { ascending: false })
    .order('name');
  return { discordId: pack.discord_id, nickname: pack.nickname ?? null, chars: (chars ?? []) as CharRow[] };
}

async function loadCharStats(name: string): Promise<CharStats> {
  const admin = supabaseAdmin();
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const nameLower = name.toLowerCase();

  const [
    { data: parseRows },
    { data: contribRows },
    chat30Res,
    chatAllRes,
    pvpKillsRes,
    pvpDeathsRes,
    lootRes,
    wishlistRes,
  ] = await Promise.all([
    admin
      .from('encounter_players')
      .select('encounter_id, total_damage, dps')
      .eq('character_name', name)
      .limit(5000),
    admin
      .from('contributions')
      .select('encounter_id, created_at, source')
      .eq('contributor_character', name)
      .order('created_at', { ascending: false })
      .limit(500),
    admin
      .from('chat_messages')
      .select('id', { count: 'exact', head: true })
      .eq('speaker', name)
      .gte('ts', since30),
    admin
      .from('chat_messages')
      .select('id', { count: 'exact', head: true })
      .eq('speaker', name),
    admin
      .from('pvp_kills')
      .select('id', { count: 'exact', head: true })
      .ilike('killer', name),
    admin
      .from('pvp_kills')
      .select('id', { count: 'exact', head: true })
      .ilike('victim', name),
    admin
      .from('loot_drops')
      .select('id, dkp_spent')
      .eq('winner_character', name),
    admin
      .from('wishlists')
      .select('id', { count: 'exact', head: true })
      .eq('character_name', name),
  ]);

  const parses = (parseRows ?? []) as { encounter_id: string; total_damage: number | null; dps: number | null }[];
  const totalDamage = parses.reduce((s, r) => s + (r.total_damage || 0), 0);
  let topDmg = 0, topId: string | null = null;
  for (const p of parses) {
    if ((p.total_damage || 0) > topDmg) { topDmg = p.total_damage || 0; topId = p.encounter_id; }
  }

  // Recent encounters — join encounter_players to encounters for npc_id +
  // started_at. PostgREST doesn't traverse without a declared FK, so a
  // second targeted lookup.
  let recentEncounters: CharStats['recentEncounters'] = [];
  if (parses.length > 0) {
    // Limit to most recent 30 contributions to keep the join cheap.
    const lastIds = Array.from(new Set(parses.map(p => p.encounter_id))).slice(0, 60);
    const { data: encRows } = await admin
      .from('encounters')
      .select('id, started_at, npc_id')
      .in('id', lastIds)
      .order('started_at', { ascending: false })
      .limit(10);
    const npcIds = (encRows ?? []).map((e: any) => e.npc_id).filter((x: any) => x != null);
    const { data: npcRows } = npcIds.length
      ? await admin.from('eqemu_npc_types').select('id, name').in('id', npcIds)
      : { data: [] };
    const npcName = new Map<number, string>(((npcRows ?? []) as { id: number; name: string }[]).map(n => [n.id, n.name.replace(/_/g,' ').replace(/^#/,'')]));
    const dmgByEnc = new Map<string, { dmg: number; dps: number }>();
    for (const p of parses) {
      const existing = dmgByEnc.get(p.encounter_id);
      if (!existing || (p.total_damage || 0) > existing.dmg) {
        dmgByEnc.set(p.encounter_id, { dmg: p.total_damage || 0, dps: p.dps || 0 });
      }
    }
    recentEncounters = ((encRows ?? []) as { id: string; started_at: string; npc_id: number | null }[]).map(e => ({
      id: e.id,
      npc_name: e.npc_id != null ? (npcName.get(e.npc_id) ?? null) : null,
      started_at: e.started_at,
      damage: dmgByEnc.get(e.id)?.dmg ?? 0,
      dps:    dmgByEnc.get(e.id)?.dps ?? 0,
    }));
  }

  const contribs = (contribRows ?? []) as { encounter_id: string; created_at: string; source: string | null }[];
  const lootRows = (lootRes.data ?? []) as { id: string; dkp_spent: number | null }[];
  const dkpSpent = lootRows.reduce((s, r) => s + (r.dkp_spent || 0), 0);

  return {
    encounterCount: new Set(parses.map(p => p.encounter_id)).size,
    totalDamage,
    topDmg,
    topEncounterId: topId,
    recentEncounters,
    uploadCount: contribs.length,
    lastUpload: contribs[0]?.created_at ?? null,
    chat30:  chat30Res.count ?? 0,
    chatAll: chatAllRes.count ?? 0,
    pvpKills: pvpKillsRes.count ?? 0,
    pvpDeaths: pvpDeathsRes.count ?? 0,
    lootCount: lootRows.length,
    dkpSpent,
    wishlistCount: wishlistRes.count ?? 0,
  };
}

function fmtTs(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function relTime(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days === 0) {
    const hours = Math.floor(ms / (60 * 60 * 1000));
    return hours <= 0 ? 'just now' : `${hours}h ago`;
  }
  if (days === 1) return 'yesterday';
  if (days < 30)  return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export default async function MePage() {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/signin?next=/me');

  const { discordId, nickname, chars } = await loadOwnedCharacters(user.id);

  // Build per-character stats in parallel
  const stats = await Promise.all(chars.map(c => loadCharStats(c.name).then(s => [c.name, s] as const)));
  const byName = new Map(stats);

  // Page-level aggregates
  const agg = {
    chars: chars.length,
    encounters: stats.reduce((s, [, x]) => s + x.encounterCount, 0),
    totalDamage: stats.reduce((s, [, x]) => s + x.totalDamage, 0),
    uploads: stats.reduce((s, [, x]) => s + x.uploadCount, 0),
    pvpKills: stats.reduce((s, [, x]) => s + x.pvpKills, 0),
    pvpDeaths: stats.reduce((s, [, x]) => s + x.pvpDeaths, 0),
    lootCount: stats.reduce((s, [, x]) => s + x.lootCount, 0),
    dkpSpent: stats.reduce((s, [, x]) => s + x.dkpSpent, 0),
  };

  return (
    <div className="space-y-6">
      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-1">👤 My Characters</h2>
        <p className="text-sm text-dim">
          Everything we track about characters linked to your Discord account.
          {discordId && (
            <> Signed in as <span className="text-text">{nickname || discordId}</span>.</>
          )}
        </p>

        {chars.length === 0 ? (
          <div className="bg-bg border border-orange/40 rounded p-4 mt-4 text-sm">
            <div className="text-orange mb-1">No characters linked to your Discord account.</div>
            <div className="text-dim text-xs">
              An officer needs to link your characters via the admin tool, or you can
              ask in <code>#feedback</code>. Until then, this page will be empty.
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-xs">
            <Stat label="Characters" value={agg.chars} />
            <Stat label="Encounters" value={agg.encounters} />
            <Stat label="Total damage" value={agg.totalDamage} compact />
            <Stat label="Uploads"      value={agg.uploads}      color="text-blue" />
            <Stat label="PvP kills"    value={agg.pvpKills}     color="text-green" />
            <Stat label="PvP deaths"   value={agg.pvpDeaths}    color="text-red-400" />
            <Stat label="Loot won"     value={agg.lootCount}    color="text-purple" />
            <Stat label="DKP spent"    value={agg.dkpSpent}     compact />
          </div>
        )}
      </section>

      {chars.map(c => {
        const s = byName.get(c.name)!;
        return (
          <section key={c.name} className="bg-panel border border-border rounded-lg">
            <header className="px-4 py-3 border-b border-border flex items-center justify-between flex-wrap gap-2">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-lg text-text">{c.name}</h3>
                  {!c.active && <span className="text-dim text-xs">(inactive)</span>}
                  {c.main_name && c.main_name !== c.name && (
                    <span className="text-dim text-xs">alt of {c.main_name}</span>
                  )}
                </div>
                <div className="text-xs text-dim">
                  {[c.race, c.class, c.rank].filter(Boolean).join(' · ') || '—'}
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <Link href={`/character/${encodeURIComponent(c.name)}`} className="text-blue hover:underline">public page →</Link>
                {c.quarmy_url && (
                  <a href={c.quarmy_url} target="_blank" rel="noreferrer" className="text-blue hover:underline">quarmy →</a>
                )}
                {c.opendkp_id && (
                  <span className="text-dim">opendkp id {c.opendkp_id}</span>
                )}
              </div>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
              <Panel title="Parses">
                <Row label="Encounters">{s.encounterCount.toLocaleString()}</Row>
                <Row label="Total damage">{s.totalDamage.toLocaleString()}</Row>
                <Row label="Top fight">
                  {s.topDmg > 0 ? (
                    <Link href={`/parses/${s.topEncounterId}`} className="text-blue hover:underline">
                      {s.topDmg.toLocaleString()} dmg →
                    </Link>
                  ) : '—'}
                </Row>
              </Panel>

              <Panel title="Agent uploads">
                <Row label="Total contributions">{s.uploadCount.toLocaleString()}</Row>
                <Row label="Last upload">
                  {s.lastUpload ? <>{relTime(s.lastUpload)} <span className="text-dim text-[10px]">· {fmtTs(s.lastUpload)}</span></> : '—'}
                </Row>
                <div className="text-[10px] text-dim mt-1">
                  Agent version is not stored yet — coming with the next bot+agent push.
                </div>
              </Panel>

              <Panel title="Chat">
                <Row label="Last 30 days">{s.chat30.toLocaleString()}</Row>
                <Row label="All-time">{s.chatAll.toLocaleString()}</Row>
              </Panel>

              <Panel title="PvP">
                <Row label="Kills"  green>{s.pvpKills.toLocaleString()}</Row>
                <Row label="Deaths" red>{s.pvpDeaths.toLocaleString()}</Row>
              </Panel>

              <Panel title="Loot">
                <Row label="Items won">{s.lootCount.toLocaleString()}</Row>
                <Row label="DKP spent">{s.dkpSpent.toLocaleString()}</Row>
                <Row label="Wishlist entries">
                  {s.wishlistCount.toLocaleString()}
                  {s.wishlistCount > 0 && <span className="text-dim text-[10px] ml-2">use /mywishlist in Discord for decrypted bids</span>}
                </Row>
              </Panel>

              <Panel title="Recent encounters">
                {s.recentEncounters.length === 0 ? (
                  <div className="text-dim text-xs italic">No parses recorded.</div>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {s.recentEncounters.map(e => (
                      <li key={e.id} className="flex items-center justify-between gap-2">
                        <Link href={`/parses/${e.id}`} className="text-blue hover:underline truncate">
                          {e.npc_name || 'unknown'}
                        </Link>
                        <span className="text-dim text-[10px] whitespace-nowrap">{fmtTs(e.started_at)}</span>
                        <span className="text-text text-[10px] whitespace-nowrap w-20 text-right">{e.damage.toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Stat({ label, value, color = 'text-text', compact = false }: { label: string; value: number; color?: string; compact?: boolean }) {
  const formatted = compact && value >= 1000
    ? value >= 1_000_000
      ? `${(value / 1_000_000).toFixed(1)}M`
      : `${(value / 1000).toFixed(1)}K`
    : value.toLocaleString();
  return (
    <div className="bg-bg border border-border rounded p-3">
      <div className={`text-2xl ${color}`}>{formatted}</div>
      <div className="text-dim text-xs">{label}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-4 border-b border-r border-border/40 last:border-r-0">
      <h4 className="text-xs text-orange mb-2">{title}</h4>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({ label, children, green, red }: { label: string; children: React.ReactNode; green?: boolean; red?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-dim">{label}</span>
      <span className={green ? 'text-green' : red ? 'text-red-400' : 'text-text'}>{children}</span>
    </div>
  );
}
