// Officer tool: link characters.discord_id to wolfpack_members.discord_id.
//
// The bot's PvP "deaths" view (and any future owner-only view) needs to know
// which Discord user owns each character. Zero characters were linked at the
// time this page was built — auto-population via the OpenDKP sync only gets
// us as far as the OpenDKP `discord` field, which most members leave blank.
//
// We infer ownership from wolfpack_members.nickname / global_name, which
// many members already use to list their roster (e.g. "Abrahms/Canniball/
// Fischer", "Ang/Ness/Hass/Catt/Shuttle", "Antero | Person | HotG"). Two
// passes:
//   1) Direct token match — character name appears as a /, |, comma, hyphen,
//      or space-separated token of nickname or global_name.
//   2) Main-name fallback — character is an alt whose main_name matches.
//
// In our roster this resolves 98 of 113 unlinked active characters
// unambiguously. The remaining 15 (alts of mains not in Discord, etc.) get
// a manual dropdown so officers can pick.

import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { isOfficer } from '@/lib/officer';
import { supabaseServer } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

type Character = {
  guild_id: string;
  name: string;
  main_name: string | null;
  class: string | null;
  rank: string | null;
  active: boolean;
  discord_id: string | null;
};

type Member = {
  discord_id: string;
  nickname: string | null;
  global_name: string | null;
};

// Split a string on /, |, comma, dash, or whitespace. Strip <guild> tags and
// parenthetical asides first so "<TSS>Grizzox/Drmagic" and "Ally Rose (rosali143)"
// don't pollute the token set.
function tokenize(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const cleaned = raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ');
  return cleaned
    .split(/[\/|,\-\s]+/)
    .map(s => s.trim().toLowerCase())
    .filter(t => t.length >= 3);
}

type TokenIndex = Map<string, string[]>; // token → discord_ids that contain it

function buildTokenIndex(members: Member[]): TokenIndex {
  const ix: TokenIndex = new Map();
  for (const m of members) {
    const tokens = new Set([...tokenize(m.nickname), ...tokenize(m.global_name)]);
    for (const t of tokens) {
      const list = ix.get(t) ?? [];
      if (!list.includes(m.discord_id)) list.push(m.discord_id);
      ix.set(t, list);
    }
  }
  return ix;
}

type Suggestion = {
  source: 'self' | 'main' | 'none' | 'ambiguous';
  discord_id: string | null;
  candidates: string[];
};

function suggestFor(c: Character, ix: TokenIndex): Suggestion {
  const direct = ix.get(c.name.toLowerCase());
  if (direct && direct.length === 1) return { source: 'self', discord_id: direct[0], candidates: direct };
  if (direct && direct.length > 1)   return { source: 'ambiguous', discord_id: null, candidates: direct };
  if (c.main_name) {
    const viaMain = ix.get(c.main_name.toLowerCase());
    if (viaMain && viaMain.length === 1) return { source: 'main', discord_id: viaMain[0], candidates: viaMain };
    if (viaMain && viaMain.length > 1)   return { source: 'ambiguous', discord_id: null, candidates: viaMain };
  }
  return { source: 'none', discord_id: null, candidates: [] };
}

function memberLabel(m: Member): string {
  const a = m.nickname?.trim();
  const b = m.global_name?.trim();
  if (a && b && a !== b) return `${a} (${b})`;
  return a || b || m.discord_id;
}

async function actionAssertOfficer() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return false;
  return await isOfficer(user.id);
}

// ── Server actions ────────────────────────────────────────────────────────

async function setLink(formData: FormData) {
  'use server';
  const ok = await actionAssertOfficer();
  if (!ok) redirect('/?error=admin_required');
  const name = String(formData.get('name') || '').trim();
  const discordId = String(formData.get('discord_id') || '').trim();
  if (!name) return;
  const admin = supabaseAdmin();
  if (!discordId) {
    await admin.from('characters').update({ discord_id: null }).eq('guild_id', 'wolfpack').eq('name', name);
  } else {
    await admin.from('characters').update({ discord_id: discordId }).eq('guild_id', 'wolfpack').eq('name', name);
  }
  revalidatePath('/admin/links');
}

async function applyAllAutoMatches() {
  'use server';
  const ok = await actionAssertOfficer();
  if (!ok) redirect('/?error=admin_required');
  const admin = supabaseAdmin();
  const [{ data: chars }, { data: members }] = await Promise.all([
    admin.from('characters').select('guild_id, name, main_name, class, rank, active, discord_id').eq('guild_id', 'wolfpack'),
    admin.from('wolfpack_members').select('discord_id, nickname, global_name').eq('is_member', true),
  ]);
  const ix = buildTokenIndex((members ?? []) as Member[]);
  const updates: { name: string; discord_id: string }[] = [];
  for (const c of (chars ?? []) as Character[]) {
    if (c.discord_id) continue;
    const s = suggestFor(c, ix);
    if (s.discord_id && (s.source === 'self' || s.source === 'main')) {
      updates.push({ name: c.name, discord_id: s.discord_id });
    }
  }
  // No batch upsert helper — issue parallel updates (small set, 100ish).
  await Promise.all(updates.map(u =>
    admin.from('characters').update({ discord_id: u.discord_id }).eq('guild_id', 'wolfpack').eq('name', u.name)
  ));
  revalidatePath('/admin/links');
}

// ── Page ──────────────────────────────────────────────────────────────────

export default async function AdminLinksPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const { show } = await searchParams;
  const showInactive = show === 'inactive' || show === 'all';
  const showLinked   = show === 'linked'   || show === 'all';

  const admin = supabaseAdmin();
  const [{ data: chars }, { data: members }] = await Promise.all([
    admin
      .from('characters')
      .select('guild_id, name, main_name, class, rank, active, discord_id')
      .eq('guild_id', 'wolfpack')
      .order('active', { ascending: false })
      .order('name'),
    admin
      .from('wolfpack_members')
      .select('discord_id, nickname, global_name')
      .eq('is_member', true)
      .order('nickname'),
  ]);

  const allChars = (chars ?? []) as Character[];
  const memberList = (members ?? []) as Member[];
  const ix = buildTokenIndex(memberList);
  const memberById = new Map(memberList.map(m => [m.discord_id, m] as const));

  const unlinkedActive   = allChars.filter(c =>  c.active && !c.discord_id);
  const unlinkedInactive = allChars.filter(c => !c.active && !c.discord_id);
  const linked           = allChars.filter(c =>  c.discord_id);

  const rowsFor = (list: Character[]) =>
    list.map(c => ({ char: c, suggestion: suggestFor(c, ix) }));
  const activeRows   = rowsFor(unlinkedActive);
  const inactiveRows = rowsFor(unlinkedInactive);

  const counts = {
    total: allChars.length,
    unlinkedActive: unlinkedActive.length,
    unlinkedInactive: unlinkedInactive.length,
    linked: linked.length,
    autoActive: activeRows.filter(r => r.suggestion.discord_id).length,
    autoInactive: inactiveRows.filter(r => r.suggestion.discord_id).length,
    manualActive: activeRows.filter(r => !r.suggestion.discord_id).length,
  };

  return (
    <div className="space-y-6">
      <div className="text-sm flex items-center gap-2">
        <Link href="/admin" className="text-blue hover:underline">← back to admin</Link>
      </div>

      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-1">🔗 Character → Discord links</h2>
        <p className="text-sm text-dim leading-6">
          Owner-only views (private death history on{' '}
          <Link href="/pvp" className="text-blue hover:underline">/pvp</Link>, future
          loot history, etc.) gate on <code>characters.discord_id</code>. We infer
          most matches by reading the character names members already list in
          their Discord nickname / display name; the rest need a manual pick.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-xs">
          <Stat label="Total characters" value={counts.total} />
          <Stat label="Linked"   value={counts.linked}   color="text-green" />
          <Stat label="Unlinked (active)"   value={counts.unlinkedActive}   color="text-orange" />
          <Stat label="Auto-matchable" value={counts.autoActive} color="text-blue" />
        </div>
      </section>

      {/* View toggles */}
      <nav className="text-xs flex items-center gap-2 flex-wrap">
        <Toggle href="/admin/links" active={!showInactive && !showLinked} label="Active unlinked only" />
        <Toggle href="/admin/links?show=inactive" active={showInactive && !showLinked} label={`+ inactive (${counts.unlinkedInactive})`} />
        <Toggle href="/admin/links?show=linked"   active={!showInactive && showLinked}  label={`+ already linked (${counts.linked})`} />
        <Toggle href="/admin/links?show=all"      active={showInactive && showLinked}   label="Show all" />
      </nav>

      {/* Bulk apply */}
      {counts.autoActive > 0 && (
        <section className="bg-panel border border-border rounded-lg p-4 flex items-center gap-4">
          <div className="text-sm flex-1">
            <div className="text-blue">{counts.autoActive} active character{counts.autoActive === 1 ? '' : 's'} have an unambiguous auto-match.</div>
            <div className="text-dim text-xs mt-1">
              Self-matches first (character name appears as a token in someone's
              Discord nickname), then alt-via-main fallbacks. Includes inactive
              characters too if "+ inactive" is on.
            </div>
          </div>
          <form action={applyAllAutoMatches}>
            <button type="submit" className="px-4 py-2 rounded border border-blue bg-[#1f6feb] text-white text-sm">
              Apply all auto-matches
            </button>
          </form>
        </section>
      )}

      {activeRows.length === 0 ? (
        <section className="bg-panel border border-border rounded-lg p-6 text-sm text-dim">
          No active characters left to link. 🎉
        </section>
      ) : (
        <LinkTable
          title="Active characters — needs review"
          rows={activeRows}
          memberById={memberById}
          memberList={memberList}
        />
      )}

      {showInactive && inactiveRows.length > 0 && (
        <LinkTable
          title={`Inactive characters (${inactiveRows.length})`}
          rows={inactiveRows}
          memberById={memberById}
          memberList={memberList}
        />
      )}

      {showLinked && linked.length > 0 && (
        <LinkTable
          title={`Already linked (${linked.length}) — pick a different member or clear to undo`}
          rows={linked.map(c => ({ char: c, suggestion: suggestFor(c, ix) }))}
          memberById={memberById}
          memberList={memberList}
          alreadyLinked
        />
      )}
    </div>
  );
}

function Stat({ label, value, color = 'text-text' }: { label: string; value: number; color?: string }) {
  return (
    <div className="bg-bg border border-border rounded p-3">
      <div className={`text-2xl ${color}`}>{value.toLocaleString()}</div>
      <div className="text-dim text-xs">{label}</div>
    </div>
  );
}

function Toggle({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={[
        'px-3 py-1 rounded border text-xs transition-colors no-underline',
        active ? 'border-blue bg-[#1f6feb33] text-blue' : 'border-border bg-bg text-text hover:border-blue',
      ].join(' ')}
    >
      {label}
    </Link>
  );
}

function LinkTable({
  title, rows, memberById, memberList, alreadyLinked = false,
}: {
  title: string;
  rows: { char: Character; suggestion: Suggestion }[];
  memberById: Map<string, Member>;
  memberList: Member[];
  alreadyLinked?: boolean;
}) {
  return (
    <section className="bg-panel border border-border rounded-lg">
      <h3 className="text-sm text-orange px-4 py-3 border-b border-border">{title}</h3>
      <div className="overflow-x-auto">
      <table className="w-full text-xs min-w-[720px]">
        <thead className="text-dim">
          <tr className="border-b border-border">
            <th className="text-left px-3 py-2 font-normal">Character</th>
            <th className="text-left px-3 py-2 font-normal">Main</th>
            <th className="text-left px-3 py-2 font-normal">Class</th>
            <th className="text-left px-3 py-2 font-normal">{alreadyLinked ? 'Linked to' : 'Suggested'}</th>
            <th className="text-left px-3 py-2 font-normal">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ char, suggestion }) => {
            const linkedMember = char.discord_id ? memberById.get(char.discord_id) : null;
            const suggestedMember = suggestion.discord_id ? memberById.get(suggestion.discord_id) : null;
            return (
              <tr key={char.name} className="border-b border-border/40 hover:bg-[#1a212c]">
                <td className="px-3 py-2 text-text">{char.name}</td>
                <td className="px-3 py-2 text-dim">
                  {char.main_name && char.main_name !== char.name ? char.main_name : '—'}
                </td>
                <td className="px-3 py-2 text-dim">{char.class || '—'}</td>
                <td className="px-3 py-2">
                  {linkedMember ? (
                    <span className="text-green">{memberLabel(linkedMember)}</span>
                  ) : suggestedMember ? (
                    <span className="text-blue">
                      {memberLabel(suggestedMember)}
                      <span className="text-dim text-[10px] ml-2">
                        {suggestion.source === 'self' ? 'self' : suggestion.source === 'main' ? `via main "${char.main_name}"` : ''}
                      </span>
                    </span>
                  ) : suggestion.source === 'ambiguous' ? (
                    <span className="text-orange">{suggestion.candidates.length} candidates — pick one →</span>
                  ) : (
                    <span className="text-dim italic">no suggestion</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <form action={setLink} className="flex items-center gap-2">
                    <input type="hidden" name="name" value={char.name} />
                    <select
                      name="discord_id"
                      defaultValue={char.discord_id ?? suggestion.discord_id ?? ''}
                      className="bg-bg border border-border rounded px-2 py-1 text-xs min-w-[200px]"
                    >
                      <option value="">— unlinked —</option>
                      {memberList.map(m => (
                        <option key={m.discord_id} value={m.discord_id}>{memberLabel(m)}</option>
                      ))}
                    </select>
                    <button type="submit" className="px-2 py-1 rounded border border-blue bg-[#1f6feb] text-white text-xs">
                      Save
                    </button>
                  </form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </section>
  );
}
