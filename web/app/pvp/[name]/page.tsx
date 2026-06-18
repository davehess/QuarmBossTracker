// /pvp/[name] — a single killer's PvP record.
//
// PUBLIC (anyone signed in):
//   - total kills + unique victims
//   - full kill history (most recent first)
//   - per-victim breakdown: how many times this killer killed each opponent
//   - pet-kill asterisks
//
// PRIVATE (only when the signed-in user owns this character):
//   - deaths: how many times this character has BEEN killed, and by whom
//
// Ownership is resolved from the viewer's Discord identity: characters linked
// via characters.discord_id, plus exact nickname match, expanded across the
// family (main_name). Fail-closed — if ownership can't be proven, the deaths
// section simply doesn't render.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { isOfficer } from '@/lib/officer';
import { fmtTime, dayKey, dayLabel } from '@/lib/format';

export const dynamic = 'force-dynamic';

// Officer-only: remove a bogus PvP kill row (mis-parsed broadcast, NPC kill
// that leaked in, duplicate, etc.). Gated server-side on the officer role —
// the form only renders for officers, and this re-checks before deleting so
// a crafted POST from a non-officer can't slip through.
async function deletePvpKill(formData: FormData) {
  'use server';
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user || !(await isOfficer(user.id))) redirect('/?error=admin_required');
  const id = String(formData.get('id') || '');
  const back = String(formData.get('back') || '/pvp');
  if (!id) return;
  await supabaseAdmin().from('pvp_kills').delete().eq('guild_id', 'wolfpack').eq('id', id);
  revalidatePath(back);
}

type Kill = {
  id: string;
  killer: string;
  victim: string;
  victim_guild: string | null;
  zone: string | null;
  via_pet: boolean;
  pet_name: string | null;
  killed_at: string;
};
type Death = {
  killer: string;
  killer_guild: string | null;
  victim: string;
  zone: string | null;
  killed_at: string;
};
type Assist = {
  pvp_kill_id: number | null;
  killer: string;
  killer_is_npc: boolean | null;
  victim: string;
  victim_guild: string | null;
  zone: string | null;
  killed_at: string;
};

// Resolve the set of character names (lowercased) the signed-in viewer owns,
// so we can decide whether to reveal the private deaths section.
async function ownedNames(): Promise<Set<string>> {
  const owned = new Set<string>();
  try {
    const { data: { user } } = await supabaseServer().auth.getUser();
    if (!user) return owned;
    const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
    const discordId = (user.app_metadata as Record<string, unknown>)?.provider_id
      ?? meta.provider_id ?? meta.sub ?? null;
    if (!discordId) return owned;

    const sb = supabaseAdmin();
    // 1. Direct character links by discord_id.
    const { data: linked } = await sb
      .from('characters')
      .select('name, main_name')
      .eq('guild_id', 'wolfpack')
      .eq('discord_id', String(discordId));
    // 2. Exact nickname / global_name match (covers mains before the
    //    char<->discord link is populated).
    const { data: member } = await sb
      .from('wolfpack_members')
      .select('nickname, global_name')
      .eq('discord_id', String(discordId))
      .maybeSingle();

    const roots = new Set<string>();
    for (const c of (linked ?? []) as { name: string; main_name: string | null }[]) {
      owned.add(c.name.toLowerCase());
      roots.add((c.main_name || c.name).toLowerCase());
    }
    const nickNames = [member?.nickname, member?.global_name].filter(Boolean) as string[];
    if (nickNames.length > 0) {
      const { data: byNick } = await sb
        .from('characters')
        .select('name, main_name')
        .eq('guild_id', 'wolfpack')
        .in('name', nickNames);
      for (const c of (byNick ?? []) as { name: string; main_name: string | null }[]) {
        owned.add(c.name.toLowerCase());
        roots.add((c.main_name || c.name).toLowerCase());
      }
    }
    // 3. Expand each owned root to its whole family.
    if (roots.size > 0) {
      const { data: fam } = await sb
        .from('characters')
        .select('name, main_name')
        .eq('guild_id', 'wolfpack')
        .in('main_name', [...roots]);
      for (const c of (fam ?? []) as { name: string; main_name: string | null }[]) {
        owned.add(c.name.toLowerCase());
      }
      for (const r of roots) owned.add(r);
    }
  } catch { /* fail-closed */ }
  return owned;
}

async function load(name: string) {
  const sb = supabaseAdmin();
  const decoded = decodeURIComponent(name);

  // Fold alts into the requested name. If `decoded` is a main, we want
  // their kills + every alt's kills under one heading (e.g. Wabumkin's page
  // should include Adiwen's 1 kill). Resolve the family up front so all
  // four queries can use a single .in() filter.
  const { data: famRows } = await sb
    .from('characters')
    .select('name, main_name')
    .eq('guild_id', 'wolfpack')
    .or(`name.ilike.${decoded},main_name.ilike.${decoded}`);
  const familyNames = new Set<string>([decoded]);
  for (const r of (famRows ?? []) as { name: string; main_name: string | null }[]) {
    familyNames.add(r.name);
    // If `decoded` was an alt's name, walk up to the main and pull in siblings.
    if (r.main_name && r.main_name.toLowerCase() === decoded.toLowerCase()) {
      // r is a sibling under the main `decoded` — already added
    }
    if (r.name.toLowerCase() === decoded.toLowerCase() && r.main_name) {
      familyNames.add(r.main_name);
    }
  }
  // Second pass: if we discovered a main via an alt match above, grab the
  // rest of the siblings.
  const mains = [...familyNames];
  if (mains.length > 1) {
    const { data: more } = await sb
      .from('characters')
      .select('name')
      .eq('guild_id', 'wolfpack')
      .in('main_name', mains);
    for (const r of (more ?? []) as { name: string }[]) familyNames.add(r.name);
  }
  const family = [...familyNames];

  const [{ data: kills }, { data: deaths }, { data: assistData }] = await Promise.all([
    sb.from('pvp_kills')
      .select('id, killer, victim, victim_guild, zone, via_pet, pet_name, killed_at')
      .eq('guild_id', 'wolfpack')
      .in('killer', family)
      .order('killed_at', { ascending: false })
      .limit(10000),
    sb.from('pvp_kills')
      .select('killer, killer_guild, victim, zone, killed_at')
      .eq('guild_id', 'wolfpack')
      .in('victim', family)
      .order('killed_at', { ascending: false })
      .limit(10000),
    // Kills THIS character assisted on (someone else landed the killing blow,
    // this character was on the damage). Co-assisters are resolved below.
    sb.from('pvp_assists')
      .select('pvp_kill_id, killer, killer_is_npc, victim, victim_guild, zone, killed_at')
      .eq('guild_id', 'wolfpack')
      .in('assister', family)
      .order('killed_at', { ascending: false })
      .limit(5000),
  ]);

  const assists = (assistData ?? []) as Assist[];
  // Co-assisters: assists frequently aren't linked to a pvp_kill_id — each
  // agent correlates its OWN assist independently with no shared FK, and clocks
  // skew a second or two between machines (Wabumkin's row stamped :48, Hitya's
  // :47 on the same Bardtholemu→Rylex kill). So match on killer+victim within a
  // time window rather than relying on the id; pvp_kill_id is still honored when
  // both rows happen to carry it.
  const killers = [...new Set(assists.map(a => a.killer).filter(Boolean))];
  const victims = [...new Set(assists.map(a => a.victim).filter(Boolean))];
  type Related = { assister: string; killer: string; victim: string; killed_at: string; pvp_kill_id: number | null };
  let related: Related[] = [];
  if (killers.length > 0 && victims.length > 0) {
    const { data } = await sb
      .from('pvp_assists')
      .select('assister, killer, victim, killed_at, pvp_kill_id')
      .eq('guild_id', 'wolfpack')
      .in('killer', killers)
      .in('victim', victims)
      .limit(20000);
    related = (data ?? []) as Related[];
  }
  const CO_WINDOW_MS = 2 * 60 * 1000;   // same kill ⇔ killer+victim within 2 min
  const lc = (s: string) => (s || '').toLowerCase();
  const enrichedAssists = assists.map(a => {
    const t = new Date(a.killed_at).getTime();
    const co = new Set<string>();
    for (const r of related) {
      if (lc(r.killer) !== lc(a.killer) || lc(r.victim) !== lc(a.victim)) continue;
      const sameId   = a.pvp_kill_id != null && r.pvp_kill_id != null && a.pvp_kill_id === r.pvp_kill_id;
      const sameTime = Math.abs(new Date(r.killed_at).getTime() - t) <= CO_WINDOW_MS;
      if (!sameId && !sameTime) continue;
      // Treat the whole family as "this character" — alt assists in the same
      // fight aren't shown as co-assisters with their main.
      if (!family.some(f => lc(f) === lc(r.assister))) co.add(r.assister);
    }
    return { ...a, co: [...co] };
  });

  return {
    kills: (kills ?? []) as Kill[],
    deaths: (deaths ?? []) as Death[],
    assists: enrichedAssists,
    displayName: decoded,
    family,
  };
}

export default async function PvpPlayerPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect(`/auth/signin?next=/pvp/${encodeURIComponent(name)}`);

  const { kills, deaths, assists, displayName } = await load(name);
  const owned = await ownedNames();
  const viewerOwns = owned.has(displayName.toLowerCase());
  const officer = await isOfficer(user.id);
  const backPath = `/pvp/${encodeURIComponent(name)}`;

  // Per-victim breakdown (public)
  const byVictim = new Map<string, { victim: string; count: number; pet: number }>();
  for (const k of kills) {
    const key = k.victim.toLowerCase();
    let e = byVictim.get(key);
    if (!e) { e = { victim: k.victim, count: 0, pet: 0 }; byVictim.set(key, e); }
    e.count += 1;
    if (k.via_pet) e.pet += 1;
  }
  const victimRows = [...byVictim.values()].sort((a, b) => b.count - a.count);
  const uniqueVictims = byVictim.size;

  // Most-killed-guilds breakdown (public) — same kills, grouped by the
  // victim's guild instead of the individual victim. Answers "which enemy
  // guilds does this player farm the most." Kills on unguilded / unknown
  // victims fold into one bucket so the named guilds aren't diluted.
  const byGuild = new Map<string, { guild: string; count: number; victims: Set<string>; pet: number }>();
  for (const k of kills) {
    const g = (k.victim_guild && k.victim_guild.trim()) ? k.victim_guild.trim() : null;
    const key = g ? g.toLowerCase() : '__none__';
    let e = byGuild.get(key);
    if (!e) { e = { guild: g ?? 'Unguilded / unknown', count: 0, victims: new Set(), pet: 0 }; byGuild.set(key, e); }
    e.count += 1;
    e.victims.add(k.victim.toLowerCase());
    if (k.via_pet) e.pet += 1;
  }
  const guildRows = [...byGuild.values()].sort((a, b) => b.count - a.count);

  // Deaths breakdown (private)
  const byKiller = new Map<string, { killer: string; count: number }>();
  for (const d of deaths) {
    const key = d.killer.toLowerCase();
    let e = byKiller.get(key);
    if (!e) { e = { killer: d.killer, count: 0 }; byKiller.set(key, e); }
    e.count += 1;
  }
  const killerRows = [...byKiller.values()].sort((a, b) => b.count - a.count);

  // Assists made by this character — co-assisters precomputed in load() by
  // killer+victim+time matching (assist rows aren't reliably linked by id).
  const assistRows = assists;

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/pvp" className="text-blue hover:underline">← back to PvP</Link>
      </div>

      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-2xl text-gold">{displayName}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          <Stat label="Total kills" value={String(kills.length)} accent="text-text" />
          <Stat label="Unique victims" value={String(uniqueVictims)} accent="text-blue" />
          <Stat
            label="Pet kills"
            value={String(kills.filter(k => k.via_pet).length)}
            accent="text-orange"
          />
          <Stat label="Assists" value={String(assists.length)} accent="text-green" />
        </div>
      </section>

      {/* Per-victim breakdown (public) */}
      <section className="bg-panel border border-border rounded-lg p-4">
        <h3 className="text-sm text-orange mb-3 flex items-center gap-2">
          <span aria-hidden>🎯</span>
          <span>Victims</span>
          <span className="text-dim text-xs">· times {displayName} killed each opponent</span>
        </h3>
        {victimRows.length === 0 ? (
          <div className="text-sm text-dim italic">No kills recorded.</div>
        ) : (
          <ul className="text-xs grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5">
            {victimRows.map(v => (
              <li key={v.victim} className="flex justify-between gap-2 border-b border-border/40 py-0.5">
                <span className="text-text truncate">
                  {v.victim}
                  {v.pet > 0 && <span className="text-orange ml-1" title={`${v.pet} by pet`}>*</span>}
                </span>
                <span className="text-dim whitespace-nowrap">{v.count}×</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Most killed guilds (public) — victims grouped by their guild */}
      <section className="bg-panel border border-border rounded-lg p-4">
        <h3 className="text-sm text-orange mb-3 flex items-center gap-2">
          <span aria-hidden>🏰</span>
          <span>Most killed guilds</span>
          <span className="text-dim text-xs">· enemy guilds {displayName} has killed the most</span>
        </h3>
        {guildRows.length === 0 ? (
          <div className="text-sm text-dim italic">No kills recorded.</div>
        ) : (
          <ul className="text-xs grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5">
            {guildRows.map(g => (
              <li key={g.guild} className="flex justify-between gap-2 border-b border-border/40 py-0.5">
                <span className="text-text truncate">
                  {g.guild === 'Unguilded / unknown'
                    ? <span className="text-dim italic">{g.guild}</span>
                    : <>{'<'}{g.guild}{'>'}</>}
                  {g.pet > 0 && <span className="text-orange ml-1" title={`${g.pet} by pet`}>*</span>}
                </span>
                <span className="text-dim whitespace-nowrap">{g.count}× <span className="text-dim/60">({g.victims.size} {g.victims.size === 1 ? 'foe' : 'foes'})</span></span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Full kill history (public) */}
      <section className="bg-panel border border-border rounded-lg p-4">
        <h3 className="text-sm text-blue mb-3 flex items-center gap-2">
          <span aria-hidden>📜</span>
          <span>Kill history</span>
          <span className="text-dim text-xs">· {kills.length} total</span>
        </h3>
        {kills.length === 0 ? (
          <div className="text-sm text-dim italic">No kills recorded.</div>
        ) : (
          <>
          <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-dim text-left">
              <tr className="border-b border-border">
                <th className="py-1 pr-2">When</th>
                <th className="py-1 pr-2">Victim</th>
                <th className="py-1 pr-2">Zone</th>
                {officer && <th className="py-1 pr-2 text-right">Officer</th>}
              </tr>
            </thead>
            <tbody>
              {kills.slice(0, 200).map((k) => (
                <tr key={k.id} className="border-b border-border/30 hover:bg-[#1a212c]">
                  <td className="py-1 pr-2 text-dim whitespace-nowrap">
                    {dayLabel(dayKey(k.killed_at))} · {fmtTime(k.killed_at)}
                  </td>
                  <td className="py-1 pr-2 text-text whitespace-nowrap">
                    {k.victim}{k.victim_guild ? <span className="text-dim"> {'<'}{k.victim_guild}{'>'}</span> : null}
                    {k.via_pet && <span className="text-orange ml-1" title={k.pet_name ? `pet: ${k.pet_name}` : 'pet kill'}>*</span>}
                  </td>
                  <td className="py-1 pr-2 text-dim whitespace-nowrap">{k.zone || '—'}</td>
                  {officer && (
                    <td className="py-1 pr-2 text-right">
                      <form action={deletePvpKill} className="inline">
                        <input type="hidden" name="id" value={k.id} />
                        <input type="hidden" name="back" value={backPath} />
                        <button
                          type="submit"
                          className="text-dim hover:text-red-400 border border-border hover:border-red-400/60 rounded px-1.5 py-0.5 text-[10px]"
                          title="Remove this kill (officer) — for mis-parsed broadcasts, NPC kills, or duplicates"
                        >✕ remove</button>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {officer && (
            <div className="text-[10px] text-dim mt-2">Officer: removing a kill deletes it from the ledger and recomputes the leaderboard. There is no undo — re-running the killer&apos;s log backfill restores any real kill.</div>
          )}
          </>
        )}
      </section>

      {/* Assists — kills this character helped land (someone else got the
          killing blow); shows who landed it + who else was on the assist. */}
      <section className="bg-panel border border-border rounded-lg p-4">
        <h3 className="text-sm text-green mb-3 flex items-center gap-2">
          <span aria-hidden>🤝</span>
          <span>Assists</span>
          <span className="text-dim text-xs">· kills {displayName} was on — who landed it &amp; who else assisted · {assistRows.length} total</span>
        </h3>
        {assistRows.length === 0 ? (
          <div className="text-sm text-dim italic">No assists recorded.</div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-dim text-left">
              <tr className="border-b border-border">
                <th className="py-1 pr-2">When</th>
                <th className="py-1 pr-2">Got the kill</th>
                <th className="py-1 pr-2">Victim</th>
                <th className="py-1 pr-2">Assisted with</th>
                <th className="py-1 pr-2">Zone</th>
              </tr>
            </thead>
            <tbody>
              {assistRows.slice(0, 200).map((a, i) => (
                <tr key={`${a.pvp_kill_id ?? 'x'}-${i}`} className="border-b border-border/30 hover:bg-[#1a212c]">
                  <td className="py-1 pr-2 text-dim whitespace-nowrap">
                    {dayLabel(dayKey(a.killed_at))} · {fmtTime(a.killed_at)}
                  </td>
                  <td className="py-1 pr-2 text-text">
                    {a.killer
                      ? (a.killer_is_npc
                          ? <span className="text-dim italic">{a.killer} (NPC)</span>
                          : <Link href={`/pvp/${encodeURIComponent(a.killer)}`} className="text-text hover:text-blue hover:underline">{a.killer}</Link>)
                      : <span className="text-dim italic">an NPC</span>}
                  </td>
                  <td className="py-1 pr-2 text-text whitespace-nowrap">
                    {a.victim}{a.victim_guild ? <span className="text-dim"> {'<'}{a.victim_guild}{'>'}</span> : null}
                  </td>
                  <td className="py-1 pr-2 text-dim">
                    {a.co.length === 0
                      ? <span className="text-dim/60">— solo assist</span>
                      : a.co.map((n, j) => (
                          <span key={n}>
                            {j > 0 ? ', ' : ''}
                            <Link href={`/pvp/${encodeURIComponent(n)}`} className="text-dim hover:text-blue hover:underline">{n}</Link>
                          </span>
                        ))}
                  </td>
                  <td className="py-1 pr-2 text-dim whitespace-nowrap">{a.zone || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </section>

      {/* Deaths — PRIVATE, owner-only */}
      {viewerOwns ? (
        <section className="bg-panel border border-red/40 rounded-lg p-4">
          <h3 className="text-sm text-red mb-3 flex items-center gap-2">
            <span aria-hidden>💀</span>
            <span>Your deaths</span>
            <span className="text-dim text-xs">· private — only you can see this · {deaths.length} total</span>
          </h3>
          {killerRows.length === 0 ? (
            <div className="text-sm text-dim italic">No recorded deaths. Respectable.</div>
          ) : (
            <ul className="text-xs grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5">
              {killerRows.map(r => (
                <li key={r.killer} className="flex justify-between gap-2 border-b border-border/40 py-0.5">
                  <span className="text-text truncate">{r.killer}</span>
                  <span className="text-dim whitespace-nowrap">{r.count}×</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section className="bg-panel border border-border rounded-lg p-4 text-xs text-dim">
          💀 Death history is private — visible only when you&apos;re signed in as the
          owner of this character.
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="bg-bg border border-border/60 rounded p-2">
      <div className="text-[10px] text-dim uppercase tracking-wide">{label}</div>
      <div className={`text-lg font-medium ${accent || 'text-text'}`}>{value}</div>
    </div>
  );
}
