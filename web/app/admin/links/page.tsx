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
  link_ignored: boolean;
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

// Dismiss an erroneous character from the matching workflow (or restore it).
// `ignored=1` parks it in the Ignored view and removes it from review +
// auto-matching; `ignored=0` brings it back. Leaves discord_id untouched.
async function setLinkIgnored(formData: FormData) {
  'use server';
  const ok = await actionAssertOfficer();
  if (!ok) redirect('/?error=admin_required');
  const name = String(formData.get('name') || '').trim();
  const ignored = String(formData.get('ignored') || '') === '1';
  if (!name) return;
  await supabaseAdmin()
    .from('characters')
    .update({ link_ignored: ignored })
    .eq('guild_id', 'wolfpack')
    .eq('name', name);
  revalidatePath('/admin/links');
}

async function applyAllAutoMatches() {
  'use server';
  const ok = await actionAssertOfficer();
  if (!ok) redirect('/?error=admin_required');
  const admin = supabaseAdmin();
  const [{ data: chars }, { data: members }] = await Promise.all([
    admin.from('characters').select('guild_id, name, main_name, class, rank, active, discord_id, link_ignored').eq('guild_id', 'wolfpack'),
    admin.from('wolfpack_members').select('discord_id, nickname, global_name').eq('is_member', true),
  ]);
  const ix = buildTokenIndex((members ?? []) as Member[]);
  const updates: { name: string; discord_id: string }[] = [];
  for (const c of (chars ?? []) as Character[]) {
    if (c.discord_id || c.link_ignored) continue;
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

// ── Family-link requests (from Mimic UI-Studio uploads of unlinked toons) ───

type LinkRequest = {
  id: string;
  character_name: string;
  requester_discord_id: string;
  requester_name: string | null;
  source: string;
  created_at: string;
};

// Resolve the Discord user's main: a character they own (discord_id = them)
// that is its own main (main_name null or == name). Null if they have no
// linked characters yet — the toon then becomes its own main.
async function resolveMainName(admin: ReturnType<typeof supabaseAdmin>, discordId: string): Promise<string | null> {
  const { data } = await admin
    .from('characters')
    .select('name, main_name')
    .eq('guild_id', 'wolfpack')
    .eq('discord_id', discordId);
  const rows = (data ?? []) as { name: string; main_name: string | null }[];
  const main = rows.find(c => !c.main_name || c.main_name.toLowerCase() === c.name.toLowerCase());
  return main ? main.name : null;
}

// Approve: link the toon into the requester's family (discord_id + main_name),
// merge in the held UI backups (clear pending_link), and resolve the request.
async function approveLinkRequest(formData: FormData) {
  'use server';
  const ok = await actionAssertOfficer();
  if (!ok) redirect('/?error=admin_required');
  const id = String(formData.get('id') || '').trim();
  if (!id) return;
  const admin = supabaseAdmin();

  const { data: reqRows } = await admin
    .from('character_link_requests')
    .select('id, character_name, requester_discord_id, status')
    .eq('id', id).limit(1);
  const req = (reqRows ?? [])[0] as { character_name: string; requester_discord_id: string; status: string } | undefined;
  if (!req || req.status !== 'pending') { revalidatePath('/admin/links'); return; }

  const mainName = await resolveMainName(admin, req.requester_discord_id);

  // Link the toon. Update if a characters row exists; insert otherwise — so we
  // never clobber an existing row's class/rank by upserting a partial object.
  const { data: existing } = await admin
    .from('characters')
    .select('name')
    .eq('guild_id', 'wolfpack')
    .ilike('name', req.character_name)
    .limit(1);
  if (Array.isArray(existing) && existing.length > 0) {
    await admin.from('characters')
      .update({ discord_id: req.requester_discord_id, main_name: mainName, active: true })
      .eq('guild_id', 'wolfpack')
      .ilike('name', req.character_name);
  } else {
    await admin.from('characters').insert({
      guild_id: 'wolfpack',
      name: req.character_name,
      discord_id: req.requester_discord_id,
      main_name: mainName,
      active: true,
    });
  }

  // Merge in the held backups — clear the pending flag so they're restorable.
  await admin.from('ui_snapshots')
    .update({ pending_link: false })
    .eq('owner_discord_id', req.requester_discord_id)
    .ilike('character_name', req.character_name);

  const { data: { user } } = await supabaseServer().auth.getUser();
  await admin.from('character_link_requests')
    .update({ status: 'approved', resolved_by_discord_id: user?.id ?? null, resolved_at: new Date().toISOString() })
    .eq('id', id);
  revalidatePath('/admin/links');
}

async function dismissLinkRequest(formData: FormData) {
  'use server';
  const ok = await actionAssertOfficer();
  if (!ok) redirect('/?error=admin_required');
  const id = String(formData.get('id') || '').trim();
  if (!id) return;
  const { data: { user } } = await supabaseServer().auth.getUser();
  await supabaseAdmin()
    .from('character_link_requests')
    .update({ status: 'dismissed', resolved_by_discord_id: user?.id ?? null, resolved_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending');
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
  const showIgnored  = show === 'ignored'  || show === 'all';

  const admin = supabaseAdmin();
  const [{ data: chars }, { data: members }, { data: reqs }] = await Promise.all([
    admin
      .from('characters')
      .select('guild_id, name, main_name, class, rank, active, discord_id, link_ignored')
      .eq('guild_id', 'wolfpack')
      .order('active', { ascending: false })
      .order('name'),
    admin
      .from('wolfpack_members')
      .select('discord_id, nickname, global_name')
      .eq('is_member', true)
      .order('nickname'),
    admin
      .from('character_link_requests')
      .select('id, character_name, requester_discord_id, requester_name, source, created_at')
      .eq('guild_id', 'wolfpack')
      .eq('status', 'pending')
      .order('created_at', { ascending: true }),
  ]);
  const pendingRequests = (reqs ?? []) as LinkRequest[];

  const allChars = (chars ?? []) as Character[];
  const memberList = (members ?? []) as Member[];
  const ix = buildTokenIndex(memberList);
  const memberById = new Map(memberList.map(m => [m.discord_id, m] as const));

  // Dismissed (link_ignored) characters are parked in their own view and
  // excluded from every other list + the auto-match logic.
  const ignoredChars     = allChars.filter(c =>  c.link_ignored);
  const unlinkedActive   = allChars.filter(c =>  c.active && !c.discord_id && !c.link_ignored);
  const unlinkedInactive = allChars.filter(c => !c.active && !c.discord_id && !c.link_ignored);
  const linked           = allChars.filter(c =>  c.discord_id && !c.link_ignored);

  const rowsFor = (list: Character[]) =>
    list.map(c => ({ char: c, suggestion: suggestFor(c, ix) }));
  const activeRows   = rowsFor(unlinkedActive);
  const inactiveRows = rowsFor(unlinkedInactive);
  const ignoredRows  = rowsFor(ignoredChars);

  const counts = {
    total: allChars.length,
    unlinkedActive: unlinkedActive.length,
    unlinkedInactive: unlinkedInactive.length,
    linked: linked.length,
    ignored: ignoredChars.length,
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

      {/* Family-link requests from Mimic UI-Studio uploads of unlinked toons */}
      <section className="bg-panel border border-border rounded-lg">
        <h3 className="text-sm text-orange px-4 py-3 border-b border-border">
          🧩 Family-link requests {pendingRequests.length > 0 && <span className="text-gold">({pendingRequests.length})</span>}
        </h3>
        {pendingRequests.length === 0 ? (
          <div className="p-4 text-xs text-dim leading-6">
            None pending. When a member backs up a toon in Mimic (UI Studio) that
            isn&apos;t linked to anyone, the backup is held and a request lands here.
            Approving adds the toon to that member&apos;s family and releases the
            held backup.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-dim hidden sm:table-header-group">
              <tr className="border-b border-border">
                <th className="text-left px-3 py-2 font-normal">Toon</th>
                <th className="text-left px-3 py-2 font-normal">Requested by</th>
                <th className="text-left px-3 py-2 font-normal hidden md:table-cell">When</th>
                <th className="text-left px-3 py-2 font-normal">Action</th>
              </tr>
            </thead>
            <tbody>
              {pendingRequests.map(r => {
                const m = memberById.get(r.requester_discord_id);
                return (
                  <tr key={r.id} className="border-b border-border/40 hover:bg-[#1a212c]">
                    <td className="px-3 py-2 text-text font-medium">{r.character_name}</td>
                    <td className="px-3 py-2 text-dim">
                      {m ? memberLabel(m) : (r.requester_name || r.requester_discord_id)}
                      <span className="text-[10px] text-dim ml-2">· {r.source}</span>
                    </td>
                    <td className="px-3 py-2 text-dim hidden md:table-cell">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <form action={approveLinkRequest}>
                          <input type="hidden" name="id" value={r.id} />
                          <button type="submit" title="Add this toon to the member's family and release the held backup" className="px-2.5 py-1 rounded border border-green bg-[#1a7f3733] text-green text-xs hover:bg-[#1a7f3766]">
                            ✓ Approve
                          </button>
                        </form>
                        <form action={dismissLinkRequest}>
                          <input type="hidden" name="id" value={r.id} />
                          <button type="submit" title="Reject — the held backup stays unlinked" className="px-2.5 py-1 rounded border border-border text-dim text-xs hover:border-red hover:text-red">
                            Dismiss
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* View toggles */}
      <nav className="text-xs flex items-center gap-2 flex-wrap">
        <Toggle href="/admin/links" active={!showInactive && !showLinked && !showIgnored} label="Active unlinked only" />
        <Toggle href="/admin/links?show=inactive" active={showInactive && !showLinked && !showIgnored} label={`+ inactive (${counts.unlinkedInactive})`} />
        <Toggle href="/admin/links?show=linked"   active={!showInactive && showLinked && !showIgnored}  label={`+ already linked (${counts.linked})`} />
        <Toggle href="/admin/links?show=ignored"  active={!showInactive && !showLinked && showIgnored}  label={`dismissed (${counts.ignored})`} />
        <Toggle href="/admin/links?show=all"      active={showInactive && showLinked && showIgnored}   label="Show all" />
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

      {showIgnored && (
        ignoredRows.length > 0 ? (
          <LinkTable
            title={`Dismissed (${ignoredRows.length}) — erroneous matches, hidden from review + auto-matching`}
            rows={ignoredRows}
            memberById={memberById}
            memberList={memberList}
            ignored
          />
        ) : (
          <section className="bg-panel border border-border rounded-lg p-6 text-sm text-dim">
            Nothing dismissed. Use “Dismiss” on a row to park an erroneous character here.
          </section>
        )
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
  title, rows, memberById, memberList, alreadyLinked = false, ignored = false,
}: {
  title: string;
  rows: { char: Character; suggestion: Suggestion }[];
  memberById: Map<string, Member>;
  memberList: Member[];
  alreadyLinked?: boolean;
  ignored?: boolean;
}) {
  return (
    <section className="bg-panel border border-border rounded-lg">
      <h3 className="text-sm text-orange px-4 py-3 border-b border-border">{title}</h3>
      <table className="w-full text-xs">
        <thead className="text-dim hidden sm:table-header-group">
          <tr className="border-b border-border">
            <th className="text-left px-2 sm:px-3 py-2 font-normal">Character</th>
            <th className="text-left px-2 sm:px-3 py-2 font-normal hidden md:table-cell">Main</th>
            <th className="text-left px-2 sm:px-3 py-2 font-normal hidden lg:table-cell">Class</th>
            <th className="text-left px-2 sm:px-3 py-2 font-normal">{ignored ? 'Was' : alreadyLinked ? 'Linked to' : 'Suggested'}</th>
            <th className="text-left px-2 sm:px-3 py-2 font-normal">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ char, suggestion }) => {
            const linkedMember = char.discord_id ? memberById.get(char.discord_id) : null;
            const suggestedMember = suggestion.discord_id ? memberById.get(suggestion.discord_id) : null;
            return (
              <tr key={char.name} className="border-b border-border/40 hover:bg-[#1a212c]">
                <td className="px-2 sm:px-3 py-2 text-text">
                  <div>{char.name}</div>
                  <div className="text-dim text-[10px] md:hidden">
                    {char.main_name && char.main_name !== char.name && <>alt of {char.main_name} · </>}
                    {char.class || '—'}
                  </div>
                </td>
                <td className="px-2 sm:px-3 py-2 text-dim hidden md:table-cell">
                  {char.main_name && char.main_name !== char.name ? char.main_name : '—'}
                </td>
                <td className="px-2 sm:px-3 py-2 text-dim hidden lg:table-cell">{char.class || '—'}</td>
                <td className="px-2 sm:px-3 py-2">
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
                <td className="px-2 sm:px-3 py-2">
                  {ignored ? (
                    <form action={setLinkIgnored} className="flex items-center gap-1.5">
                      <input type="hidden" name="name" value={char.name} />
                      <input type="hidden" name="ignored" value="0" />
                      <button type="submit" className="px-2 py-1 rounded border border-blue text-blue text-xs hover:bg-[#1f6feb22]">
                        Restore
                      </button>
                    </form>
                  ) : (
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-1.5">
                      <form action={setLink} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-1.5">
                        <input type="hidden" name="name" value={char.name} />
                        <select
                          name="discord_id"
                          defaultValue={char.discord_id ?? suggestion.discord_id ?? ''}
                          className="bg-bg border border-border rounded px-2 py-1 text-xs sm:min-w-[200px]"
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
                      <form action={setLinkIgnored}>
                        <input type="hidden" name="name" value={char.name} />
                        <input type="hidden" name="ignored" value="1" />
                        <button
                          type="submit"
                          title="Erroneous — hide from review + auto-matching"
                          className="px-2 py-1 rounded border border-border text-dim text-xs hover:border-orange hover:text-orange"
                        >
                          Dismiss
                        </button>
                      </form>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
