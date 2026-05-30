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
import ExclusionToggles from './ExclusionToggles';

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
  exclude_from_stats: boolean | null;
  exclude_inventory:  boolean | null;
  tell_relay:         boolean | null;
};

type SkillBucket = { hits: number; dmg: number };

type CharStats = {
  encounterCount: number;
  totalDamage: number;
  topDmg: number;
  topEncounterId: string | null;
  recentEncounters: { id: string; npc_name: string | null; started_at: string | null; damage: number; dps: number }[];

  uploadCount: number;
  lastUpload: string | null;
  // Most recent agent_version stamped on a contribution this char authored.
  // null when the char hasn't uploaded since the watermark cutover (bot v2.5.39+).
  latestAgentVersion: string | null;

  chat30: number;
  chatAll: number;

  pvpKills: number;
  pvpDeaths: number;

  lootCount: number;
  dkpSpent: number;

  wishlistCount: number;

  // Per-ability rollup (PRIVATE — only the owner sees this). Aggregated across
  // encounter_combat_rollup rows for this character. Empty for raids that
  // landed before the agent v2.4.26+ cutover.
  rollupHits: number;
  rollupDamage: number;
  selfAttackCount: number;
  topSkills: { skill: string; hits: number; dmg: number }[];   // top 5 by damage
  encountersWithDetail: number;
  encountersResubmittable: number;

  // Per-character data-floor signal: how far back this character's stats reach.
  memberSince: string | null;
  floorSource: 'guild_chat' | 'tick' | 'raid_chat' | null;
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
    .select('name, main_name, class, race, rank, active, quarmy_url, opendkp_id, exclude_from_stats, exclude_inventory, tell_relay')
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
    { data: rollupRows },
    { data: floorRow },
    { data: coverageRow },
  ] = await Promise.all([
    admin
      .from('encounter_players')
      .select('encounter_id, total_damage, dps')
      .eq('character_name', name)
      .limit(5000),
    admin
      .from('contributions')
      .select('encounter_id, created_at, source, agent_version, has_ability_detail')
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
    // Per-encounter verb rollups. Sum locally — typical char has at most ~hundreds
    // of rows, fine to aggregate in JS. by_skill is the jsonb bag per the
    // migration; total_hits / total_damage / self_attack_count are scalar.
    admin
      .from('encounter_combat_rollup')
      .select('total_hits, total_damage, self_attack_count, by_skill')
      .eq('character_name', name)
      .limit(5000),
    // Data floor row — single row per character_name (case-insensitive via the view).
    admin
      .from('character_data_floor')
      .select('member_since, floor_source')
      .ilike('character_name', name)
      .maybeSingle(),
    // Coverage — drives the "N raids could unlock verb totals; resubmit your logs" nudge.
    admin
      .from('character_rollup_coverage')
      .select('encounters_total, encounters_with_detail, encounters_resubmittable')
      .ilike('character_name', name)
      .maybeSingle(),
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

  const contribs = (contribRows ?? []) as { encounter_id: string; created_at: string; source: string | null; agent_version: string | null; has_ability_detail: boolean | null }[];
  const lootRows = (lootRes.data ?? []) as { id: string; dkp_spent: number | null }[];
  const dkpSpent = lootRows.reduce((s, r) => s + (r.dkp_spent || 0), 0);

  // ── Aggregate the per-ability rollups ──────────────────────────────────────
  // Each row: { total_hits, total_damage, self_attack_count, by_skill: jsonb }.
  // by_skill is { <skill>: {hits, dmg} } already in the agent's bucket shape.
  // We sum across the character's encounters; topSkills is the top 5 by dmg.
  const rollups = (rollupRows ?? []) as {
    total_hits: number | null;
    total_damage: number | null;
    self_attack_count: number | null;
    by_skill: Record<string, SkillBucket> | null;
  }[];
  let rollupHits = 0, rollupDamage = 0, selfAttackCount = 0;
  const skillTotals = new Map<string, SkillBucket>();
  for (const r of rollups) {
    rollupHits      += r.total_hits        || 0;
    rollupDamage    += r.total_damage      || 0;
    selfAttackCount += r.self_attack_count || 0;
    if (r.by_skill && typeof r.by_skill === 'object') {
      for (const [skill, b] of Object.entries(r.by_skill)) {
        const existing = skillTotals.get(skill) ?? { hits: 0, dmg: 0 };
        existing.hits += Number(b?.hits) || 0;
        existing.dmg  += Number(b?.dmg)  || 0;
        skillTotals.set(skill, existing);
      }
    }
  }
  const topSkills = Array.from(skillTotals.entries())
    .map(([skill, b]) => ({ skill, hits: b.hits, dmg: b.dmg }))
    .sort((a, b) => b.dmg - a.dmg)
    .slice(0, 5);

  // Most recent agent version this character uploaded under. Pre-2.5.39
  // contributions have null agent_version, so we look for the latest non-null.
  const latestAgentVersion = contribs.find(c => c.agent_version)?.agent_version ?? null;

  const floor = (floorRow ?? null) as { member_since: string | null; floor_source: string | null } | null;
  const coverage = (coverageRow ?? null) as {
    encounters_total: number | null;
    encounters_with_detail: number | null;
    encounters_resubmittable: number | null;
  } | null;

  return {
    encounterCount: new Set(parses.map(p => p.encounter_id)).size,
    totalDamage,
    topDmg,
    topEncounterId: topId,
    recentEncounters,
    uploadCount: contribs.length,
    lastUpload: contribs[0]?.created_at ?? null,
    latestAgentVersion,
    chat30:  chat30Res.count ?? 0,
    chatAll: chatAllRes.count ?? 0,
    pvpKills: pvpKillsRes.count ?? 0,
    pvpDeaths: pvpDeathsRes.count ?? 0,
    lootCount: lootRows.length,
    dkpSpent,
    wishlistCount: wishlistRes.count ?? 0,
    rollupHits,
    rollupDamage,
    selfAttackCount,
    topSkills,
    encountersWithDetail:    coverage?.encounters_with_detail   ?? 0,
    encountersResubmittable: coverage?.encounters_resubmittable ?? 0,
    memberSince: floor?.member_since ?? null,
    floorSource: (floor?.floor_source as CharStats['floorSource']) ?? null,
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

  const { discordId, nickname, chars: allChars } = await loadOwnedCharacters(user.id);

  // Honor the per-character data opt-out (characters.exclude_from_stats). We
  // still surface excluded chars in a small footer so the owner can see + flip
  // the flag, but they don't appear in the main per-char grid.
  const chars         = allChars.filter(c => !c.exclude_from_stats);
  const excludedChars = allChars.filter(c =>  c.exclude_from_stats);

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
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-xl text-gold mb-1">👤 My Characters</h2>
            <p className="text-sm text-dim">
              Everything we track about characters linked to your Discord account.
              {discordId && (
                <> Signed in as <span className="text-text">{nickname || discordId}</span>.</>
              )}
            </p>
          </div>
          <Link href="/me/tells" className="text-blue hover:underline text-sm whitespace-nowrap">
            📬 Inbound /tell →
          </Link>
        </div>

        {allChars.length === 0 ? (
          <div className="bg-bg border border-orange/40 rounded p-4 mt-4 text-sm">
            <div className="text-orange mb-1">No characters linked to your Discord account.</div>
            <div className="text-dim text-xs">
              An officer needs to link your characters via the admin tool, or you can
              ask in <code>#feedback</code>. Until then, this page will be empty.
            </div>
          </div>
        ) : chars.length === 0 ? (
          <div className="bg-bg border border-dim/40 rounded p-4 mt-4 text-sm text-dim">
            All your linked characters are set to <span className="text-orange">exclude_from_stats</span>.
            Nothing to show.
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

      {excludedChars.length > 0 && (
        <section className="bg-panel border border-border/60 rounded-lg p-4 text-xs">
          <div className="text-orange mb-2">Excluded from stats per your settings</div>
          <ul className="space-y-2">
            {excludedChars.map(c => (
              <li key={c.name} className="flex items-center justify-between gap-3 flex-wrap">
                <span className="text-text">{c.name}</span>
                <ExclusionToggles
                  character={c.name}
                  excludeFromStats={!!c.exclude_from_stats}
                  excludeInventory={!!c.exclude_inventory}
                  tellRelay={!!c.tell_relay}
                />
              </li>
            ))}
          </ul>
          <div className="text-[10px] text-dim/70 mt-3">
            Flip Stats off to bring a character back to the main grid. The agent picks up the
            change within ~10 minutes and resumes uploading for that character.
          </div>
        </section>
      )}

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
              <div className="flex items-center gap-2 text-xs flex-wrap">
                <ExclusionToggles
                  character={c.name}
                  excludeFromStats={!!c.exclude_from_stats}
                  excludeInventory={!!c.exclude_inventory}
                  tellRelay={!!c.tell_relay}
                />
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
                <Row label="Latest agent version">
                  {s.latestAgentVersion
                    ? <span className="text-text">v{s.latestAgentVersion}</span>
                    : <span className="text-dim text-[10px] italic">none recorded yet (pre-v2.4.26 uploads aren&apos;t stamped)</span>}
                </Row>
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

              {/* Verb totals + self-attack counter (PRIVATE scope per CLAUDE.md
                  disclosure spec: only the owner sees this; nothing here ever
                  appears named on a public page). Populated by
                  encounter_combat_rollup which started collecting at agent v2.4.26
                  on 2026-05-30 — older raids have no source data and will only
                  populate if the member opts in to resubmit those logs. */}
              <Panel
                title="Verb totals"
                badge="PRIVATE"
                tooltip="Only you see this — never named elsewhere. Crush/stab/bite/slash/spell/etc. across every raid where you ran the agent. Times you attacked yourself = swings/casts where your character resolved as both attacker and defender (charm-break, fat-finger /assist, riposted swings, etc)."
              >
                {s.rollupHits === 0 && s.encountersWithDetail === 0 ? (
                  <div className="text-dim text-xs italic">
                    No per-verb data collected for this character yet.{' '}
                    {s.encountersResubmittable > 0 && (
                      <>Re-run the agent (v2.4.26+) over your old logs to unlock totals for past raids.</>
                    )}
                  </div>
                ) : (
                  <>
                    <Row label="Total hits logged">{s.rollupHits.toLocaleString()}</Row>
                    <Row label="Total damage logged">{s.rollupDamage.toLocaleString()}</Row>
                    <Row label="Times you attacked yourself">
                      <span className={s.selfAttackCount > 0 ? 'text-orange' : 'text-text'}>
                        {s.selfAttackCount.toLocaleString()}
                      </span>
                    </Row>
                    {s.topSkills.length > 0 && (
                      <div className="pt-2 mt-1 border-t border-border/40">
                        <div className="text-[10px] text-dim mb-1">Top skills by damage</div>
                        <ul className="space-y-0.5 text-xs">
                          {s.topSkills.map(t => (
                            <li key={t.skill} className="flex items-center justify-between gap-2">
                              <span className="text-text truncate">{t.skill}</span>
                              <span className="text-dim text-[10px] whitespace-nowrap">{t.hits.toLocaleString()} hits</span>
                              <span className="text-text text-[10px] whitespace-nowrap w-20 text-right">{t.dmg.toLocaleString()}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}
                {s.encountersResubmittable > 0 && (
                  <div className="mt-2 pt-2 border-t border-border/40 text-[10px] text-dim">
                    <span className="text-orange">
                      {s.encountersResubmittable.toLocaleString()} past raid{s.encountersResubmittable === 1 ? '' : 's'}
                    </span>{' '}
                    could unlock verb totals if you resubmit those logs with agent v2.4.26+.
                  </div>
                )}
                {s.memberSince && (
                  <div className="mt-1 text-[10px] text-dim">
                    Counted from <span className="text-text">{new Date(s.memberSince).toLocaleDateString()}</span>
                    {s.floorSource && (
                      <span className="text-dim/70"> · floor: {s.floorSource.replace('_', ' ')}</span>
                    )}
                  </div>
                )}
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

function Panel({ title, children, badge, tooltip }: {
  title: string;
  children: React.ReactNode;
  badge?: 'PRIVATE' | 'ANON' | 'GUILD';
  tooltip?: string;
}) {
  // Scope badge follows the PRIVATE/ANON/GUILD contract in CLAUDE.md's "Stat
  // Visibility & Disclosure" section so members can always tell what's exposed.
  // The HTML `title` attribute is the minimum viable tooltip — works on hover
  // and assistive tech with no extra JS. Richer popovers are a Mimic concern.
  const badgeClass =
    badge === 'PRIVATE' ? 'bg-purple/20 text-purple border-purple/40' :
    badge === 'ANON'    ? 'bg-blue/20   text-blue   border-blue/40'   :
    badge === 'GUILD'   ? 'bg-green/20  text-green  border-green/40'  : '';
  return (
    <div className="p-4 border-b border-r border-border/40 last:border-r-0">
      <h4 className="text-xs text-orange mb-2 flex items-center gap-2">
        <span>{title}</span>
        {badge && (
          <span
            className={`text-[9px] px-1.5 py-0.5 rounded border ${badgeClass} font-mono cursor-help`}
            title={tooltip}
          >
            {badge}
          </span>
        )}
      </h4>
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
