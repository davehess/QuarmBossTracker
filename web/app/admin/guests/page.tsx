// /admin/guests — every guest Mimic link ever approved, and the fights each one uploaded (the guild lead, 2026-10-30:
// "we should be able to review their data and contributions after the fact").
//
// A guest session uploads parses under the stand-in id `guest:<session id>` (utils/mimicLink.js), and that id lands in
// contributions.uploaded_by_discord_id, so a guest's contributions are findable by it. One <details> per guest keeps the
// page a single read with no per-guest route; each fight links to the ordinary parse page.
//
// "Their damage" is the guest's row in encounter_players (the merged per-character numbers), not contributions.total_damage:
// that column is the whole fight's total as the guest's log saw it.
import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import { requireOfficer } from '@/lib/officer';
import { selectInChunks } from '@/lib/selectInChunks';
import { userTz, fmtAbs } from '@/lib/timezone';
import { fmtDmg, cleanBossName } from '@/lib/format';
import { GUILD_TAG } from '@/lib/guild';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Guest fights — Wolf Pack admin',
  description: 'Every guest Mimic link an officer approved, and the fights each guest uploaded.',
};

type Session = {
  id: string; guest_label: string | null; created_at: string; expires_at: string | null;
  last_used_at: string | null; revoked_at: string | null; linked_by_discord_id: string | null;
};
type Contribution = { id: string; uploaded_by_discord_id: string; contributor_character: string | null; encounter_id: string | null; created_at: string };
type Enc = { id: string; npc_id: number | null; started_at: string | null };
type Player = { encounter_id: string; character_name: string; total_damage: number | null; dps: number | null };

export default async function AdminGuestsPage() {
  await requireOfficer();
  const tz = await userTz();
  const admin = supabaseAdmin();

  const { data: sessionRows, error: sessErr } = await admin
    .from('mimic_sessions')
    .select('id, guest_label, created_at, expires_at, last_used_at, revoked_at, linked_by_discord_id')
    .eq('guild_id', GUILD_TAG)
    .eq('scope', 'guest')
    .order('created_at', { ascending: false })
    .limit(200);
  const sessions = (sessionRows ?? []) as Session[];

  const approverIds = [...new Set(sessions.map(s => s.linked_by_discord_id).filter((x): x is string => !!x))];
  const { data: memberRows } = approverIds.length
    ? await admin.from('wolfpack_members').select('discord_id, nickname, global_name').in('discord_id', approverIds)
    : { data: [] as { discord_id: string; nickname: string | null; global_name: string | null }[] };
  const approver = new Map((memberRows ?? []).map(m => [m.discord_id, m.nickname || m.global_name || m.discord_id]));

  // Fights: contributions by guest id, then the encounter, boss and the guest's own numbers for each.
  let loadFailed = !!sessErr;
  let contribs: Contribution[] = [];
  const encById = new Map<string, Enc>();
  const bossById = new Map<number, string>();
  const playerKey = (encId: string, name: string) => `${encId}|${name.toLowerCase()}`;
  const playerByKey = new Map<string, Player>();
  try {
    contribs = await selectInChunks<string, Contribution>(sessions.map(s => `guest:${s.id}`), (part, from, to) => admin
      .from('contributions')
      .select('id, uploaded_by_discord_id, contributor_character, encounter_id, created_at')
      .in('uploaded_by_discord_id', part)
      .order('created_at', { ascending: false }).order('id')
      .range(from, to));
    const encIds = [...new Set(contribs.map(c => c.encounter_id).filter((x): x is string => !!x))];
    const encs = await selectInChunks<string, Enc>(encIds, (part, from, to) => admin
      .from('encounters').select('id, npc_id, started_at').eq('guild_id', GUILD_TAG).in('id', part).order('id').range(from, to));
    for (const e of encs) encById.set(e.id, e);
    const npcIds = [...new Set(encs.map(e => e.npc_id).filter((x): x is number => x != null))];
    const npcs = await selectInChunks<number, { id: number; name: string }>(npcIds, (part, from, to) => admin
      .from('eqemu_npc_types').select('id, name').in('id', part).order('id').range(from, to));
    for (const n of npcs) bossById.set(n.id, n.name);
    const chars = [...new Set(contribs.map(c => c.contributor_character).filter((x): x is string => !!x))];
    if (chars.length) {
      const players = await selectInChunks<string, Player>(encIds, (part, from, to) => admin
        .from('encounter_players')
        .select('encounter_id, character_name, total_damage, dps')
        .in('encounter_id', part).in('character_name', chars)
        .order('encounter_id').order('character_name')
        .range(from, to));
      for (const p of players) playerByKey.set(playerKey(p.encounter_id, p.character_name), p);
    }
  } catch { loadFailed = true; }

  const fightsOf = new Map<string, Contribution[]>();
  for (const c of contribs) {
    const list = fightsOf.get(c.uploaded_by_discord_id) ?? [];
    list.push(c);
    fightsOf.set(c.uploaded_by_discord_id, list);
  }
  const now = Date.now();
  const when = (iso: string | null) => (iso ? fmtAbs(iso, tz) : '—');
  const stateOf = (s: Session) =>
    s.revoked_at ? `revoked ${when(s.revoked_at)}`
      : s.expires_at && Date.parse(s.expires_at) > now ? `until ${when(s.expires_at)}`
      : `expired ${when(s.expires_at)}`;

  return (
    <div className="space-y-6">
      <div className="text-sm flex items-center gap-2">
        <Link href="/admin/links" className="text-blue hover:underline">← back to character links</Link>
      </div>

      <section className="bg-panel border border-border rounded-lg p-6">
        <h1 className="text-2xl text-gold mb-1">🎟 Guest fights</h1>
        <p className="text-sm text-dim leading-6 max-w-3xl">
          Every guest link an officer approved, newest first, and the fights each guest uploaded. Open a guest to see them.
          The damage shown is the guest&apos;s own row in the merged parse; the fight links open the normal parse page.
          Extending or ending a link is on <Link href="/admin/links" className="text-blue hover:underline">Character links</Link>.
        </p>
        {loadFailed && (
          <p className="mt-3 text-sm text-red">Couldn&apos;t load all of this (database error). Reload in a moment.</p>
        )}

        {sessions.length === 0 ? (
          <p className="mt-4 text-sm text-dim">No guest link has been approved yet.</p>
        ) : (
          <div className="mt-4 space-y-2">
            {sessions.map(s => {
              const fights = fightsOf.get(`guest:${s.id}`) ?? [];
              return (
                <details key={s.id} className="border border-border rounded-lg bg-bg">
                  <summary className="cursor-pointer px-4 py-3 flex flex-wrap items-baseline gap-x-5 gap-y-1">
                    <span className="text-text font-medium">{s.guest_label || 'Guest'}</span>
                    <span className="text-dim text-xs">approved by {s.linked_by_discord_id ? (approver.get(s.linked_by_discord_id) ?? 'unknown') : 'unknown'}</span>
                    <span className="text-dim text-xs">created {when(s.created_at)}</span>
                    <span className="text-dim text-xs">{stateOf(s)}</span>
                    <span className="text-dim text-xs">last used {when(s.last_used_at)}</span>
                    <span className="text-gold text-xs ml-auto">{fights.length} fight{fights.length === 1 ? '' : 's'}</span>
                  </summary>
                  <div className="px-4 pb-4 overflow-x-auto">
                    {fights.length === 0 ? (
                      <p className="text-sm text-dim">Nothing uploaded on this link.</p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead className="text-dim text-xs text-left">
                          <tr>
                            <th className="px-3 py-1">Boss</th>
                            <th className="px-3 py-1">Fight started</th>
                            <th className="px-3 py-1">Character</th>
                            <th className="px-3 py-1 text-right">Damage</th>
                            <th className="px-3 py-1 text-right">DPS</th>
                            <th className="px-3 py-1">Uploaded</th>
                            <th className="px-3 py-1"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {fights.map(f => {
                            const enc = f.encounter_id ? encById.get(f.encounter_id) : undefined;
                            const boss = enc?.npc_id != null ? bossById.get(enc.npc_id) : undefined;
                            const mine = f.encounter_id && f.contributor_character
                              ? playerByKey.get(playerKey(f.encounter_id, f.contributor_character)) : undefined;
                            return (
                              <tr key={f.id} className="border-t border-border">
                                <td className="px-3 py-2">{boss ? cleanBossName(boss) : 'Unknown boss'}</td>
                                <td className="px-3 py-2 text-dim">{when(enc?.started_at ?? null)}</td>
                                <td className="px-3 py-2">{f.contributor_character || '—'}</td>
                                <td className="px-3 py-2 text-right">{fmtDmg(mine?.total_damage)}</td>
                                <td className="px-3 py-2 text-right">{mine?.dps != null ? fmtDmg(Math.round(mine.dps)) : '—'}</td>
                                <td className="px-3 py-2 text-dim">{when(f.created_at)}</td>
                                <td className="px-3 py-2 text-right">
                                  {f.encounter_id ? <Link href={`/parses/${f.encounter_id}`} className="text-blue hover:underline">Open →</Link> : null}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
