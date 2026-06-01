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

  const [{ data: kills }, { data: deaths }] = await Promise.all([
    sb.from('pvp_kills')
      .select('id, killer, victim, victim_guild, zone, via_pet, pet_name, killed_at')
      .eq('guild_id', 'wolfpack')
      .ilike('killer', decoded)
      .order('killed_at', { ascending: false })
      .limit(10000),
    sb.from('pvp_kills')
      .select('killer, killer_guild, victim, zone, killed_at')
      .eq('guild_id', 'wolfpack')
      .ilike('victim', decoded)
      .order('killed_at', { ascending: false })
      .limit(10000),
  ]);

  return {
    kills: (kills ?? []) as Kill[],
    deaths: (deaths ?? []) as Death[],
    displayName: ((kills ?? [])[0] as Kill | undefined)?.killer
      ?? ((deaths ?? [])[0] as Death | undefined)?.victim
      ?? decoded,
  };
}

export default async function PvpPlayerPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect(`/auth/signin?next=/pvp/${encodeURIComponent(name)}`);

  const { kills, deaths, displayName } = await load(name);
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

  // Deaths breakdown (private)
  const byKiller = new Map<string, { killer: string; count: number }>();
  for (const d of deaths) {
    const key = d.killer.toLowerCase();
    let e = byKiller.get(key);
    if (!e) { e = { killer: d.killer, count: 0 }; byKiller.set(key, e); }
    e.count += 1;
  }
  const killerRows = [...byKiller.values()].sort((a, b) => b.count - a.count);

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/pvp" className="text-blue hover:underline">← back to PvP</Link>
      </div>

      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-2xl text-gold">{displayName}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
          <Stat label="Total kills" value={String(kills.length)} accent="text-text" />
          <Stat label="Unique victims" value={String(uniqueVictims)} accent="text-blue" />
          <Stat
            label="Pet kills"
            value={String(kills.filter(k => k.via_pet).length)}
            accent="text-orange"
          />
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
                  <td className="py-1 pr-2 text-text">
                    {k.victim}{k.victim_guild ? <span className="text-dim"> {'<'}{k.victim_guild}{'>'}</span> : null}
                    {k.via_pet && <span className="text-orange ml-1" title={k.pet_name ? `pet: ${k.pet_name}` : 'pet kill'}>*</span>}
                  </td>
                  <td className="py-1 pr-2 text-dim">{k.zone || '—'}</td>
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
          {officer && (
            <div className="text-[10px] text-dim mt-2">Officer: removing a kill deletes it from the ledger and recomputes the leaderboard. There is no undo — re-running the killer&apos;s log backfill restores any real kill.</div>
          )}
          </>
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
