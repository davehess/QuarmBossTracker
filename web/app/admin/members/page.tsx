// Officer tool: member dashboard with character-linking.
//
// Default view is "Active" (Discord members holding any of the raid-team
// roles: Raid Pack, Officer, Raid Recruit, Pack Member, Pack Leader).
// Visitor/Inactive is its own tab. Each row shows linked characters when
// they exist; when none are linked, the row offers a "Link main" picker
// that resolves the entire family (every character with main_name = the
// picked main) to this member's discord_id in one click.
//
// Suggestions for the picker come from two sources:
//   1) Name-token match against character names in the member's Discord
//      nickname / global_name (the /admin/links heuristic). Many members
//      list "Hitya / Pyxil / Jankzer" style rosters in their nickname.
//   2) /who observations — characters who have been observed by an
//      uploader whose own character matches a token from this member's
//      nickname. Catches "Bob runs the agent and has been seen logged
//      in as Foo too" type signals.

import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { isOfficer } from '@/lib/officer';
import { supabaseServer } from '@/lib/supabase-server';
import { getDemoMode, maybeFake } from '@/lib/obfuscate';

export const dynamic = 'force-dynamic';

// Roles that count as "active raid team". Anything outside this set
// (with the explicit Visitor/Inactive role or no team role) goes to the
// Visitor tab.
const ACTIVE_ROLES = new Set(['Raid Pack', 'Officer', 'Raid Recruit', 'Pack Member', 'Pack Leader']);
const VISITOR_ROLE = 'Visitor/Inactive';
const APPLICANT_ROLE = 'Raid Applicant';

type Member = {
  discord_id: string;
  nickname: string | null;
  global_name: string | null;
  joined_at: string | null;
  refreshed_at: string | null;
  role_names: string[] | null;
  merged_into_discord_id: string | null;
};

type CharInfo = { name: string; className: string | null; mainName: string | null };

type Suggestion = {
  mainName: string;        // the main character of the family
  members: CharInfo[];     // every character with main_name = mainName
  source: 'nickname-token' | 'who-observation';
  matched: string;         // why we suggested it (token / observer name)
};

type MemberRow = Member & {
  charNames: CharInfo[];
  hasLink: boolean;
  chatLast30: number;
  parseLast30: number;
  whoLast30: number;
  suggestions: Suggestion[];
};

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
}

function fmtJoined(iso: string | null): string {
  if (!iso) return '—';
  const d = daysSince(iso);
  if (d == null) return '—';
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 30)  return `${d}d ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

// Tokenize a Discord display name. Matches the /admin/links logic so
// "Abrahms/Canniball/Fischer" → ["abrahms","canniball","fischer"].
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

async function loadMembers(): Promise<MemberRow[]> {
  const admin = supabaseAdmin();
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { data: membersRaw },
    { data: chars },
    { data: chats },
    { data: contribs },
    { data: whos },
  ] = await Promise.all([
    admin
      .from('wolfpack_members')
      .select('discord_id, nickname, global_name, joined_at, refreshed_at, role_names, merged_into_discord_id')
      .eq('is_member', true)
      .order('joined_at', { ascending: false, nullsFirst: false }),
    admin
      .from('characters')
      .select('name, class, discord_id, main_name, active')
      .eq('guild_id', 'wolfpack'),
    admin
      .from('chat_messages')
      .select('speaker, ts')
      .gte('ts', since30)
      .limit(50000),
    admin
      .from('contributions')
      .select('contributor_character, contributor_discord_id, created_at')
      .gte('created_at', since30)
      .limit(50000),
    admin
      .from('who_observations')
      .select('character, uploaded_by, observed_at')
      .gte('observed_at', since30)
      .limit(50000),
  ]);

  const members = (membersRaw ?? []) as Member[];
  const allChars = (chars ?? []) as { name: string; class: string | null; discord_id: string | null; main_name: string | null; active: boolean }[];

  // discord_id → [character info] (linked + active)
  const charsByDiscord = new Map<string, CharInfo[]>();
  for (const c of allChars) {
    if (c.discord_id && c.active) {
      const list = charsByDiscord.get(c.discord_id) ?? [];
      list.push({ name: c.name, className: c.class, mainName: c.main_name });
      charsByDiscord.set(c.discord_id, list);
    }
  }

  // Roster index for suggestion lookups
  const charByName = new Map<string, { name: string; className: string | null; mainName: string | null; discordId: string | null }>();
  for (const c of allChars) {
    charByName.set(c.name.toLowerCase(), { name: c.name, className: c.class, mainName: c.main_name, discordId: c.discord_id });
  }
  // Family: mainName (lowercased) → list of chars
  const family = new Map<string, CharInfo[]>();
  for (const c of allChars) {
    if (!c.active) continue;
    const main = (c.main_name || c.name).toLowerCase();
    const list = family.get(main) ?? [];
    list.push({ name: c.name, className: c.class, mainName: c.main_name });
    family.set(main, list);
  }

  // Activity windows
  const charToDiscord = new Map<string, string>();
  for (const c of allChars) {
    if (c.discord_id) charToDiscord.set(c.name.toLowerCase(), c.discord_id);
  }
  const chatCount = new Map<string, number>();
  for (const m of (chats ?? []) as { speaker: string }[]) {
    const d = charToDiscord.get((m.speaker || '').toLowerCase());
    if (d) chatCount.set(d, (chatCount.get(d) ?? 0) + 1);
  }
  const parseCount = new Map<string, number>();
  for (const c of (contribs ?? []) as { contributor_character: string | null; contributor_discord_id: string | null }[]) {
    const d = c.contributor_discord_id || charToDiscord.get((c.contributor_character || '').toLowerCase());
    if (d) parseCount.set(d, (parseCount.get(d) ?? 0) + 1);
  }
  const whoCount = new Map<string, number>();
  // uploaderToCharsSeen — for "Bob saw Foo in /who" cross-reference.
  // uploader (character name, lowercase) → set of character names they observed.
  const uploaderToCharsSeen = new Map<string, Set<string>>();
  for (const w of (whos ?? []) as { character: string; uploaded_by: string | null }[]) {
    const target = (w.character || '').toLowerCase();
    const d = charToDiscord.get(target);
    if (d) whoCount.set(d, (whoCount.get(d) ?? 0) + 1);
    if (w.uploaded_by) {
      const ub = w.uploaded_by.toLowerCase();
      let s = uploaderToCharsSeen.get(ub);
      if (!s) { s = new Set(); uploaderToCharsSeen.set(ub, s); }
      s.add(w.character);
    }
  }

  // Build suggestions for unlinked members
  function suggestionsFor(m: Member): Suggestion[] {
    if ((charsByDiscord.get(m.discord_id) ?? []).length > 0) return [];

    const seen = new Set<string>(); // dedup by mainName.lowercase
    const out: Suggestion[] = [];

    // 1) Nickname tokens → matching characters → roll up to their family
    const tokens = new Set([...tokenize(m.nickname), ...tokenize(m.global_name)]);
    for (const t of tokens) {
      const c = charByName.get(t);
      if (!c || c.discordId) continue;     // already linked or unknown
      const mainKey = (c.mainName || c.name).toLowerCase();
      if (seen.has(mainKey)) continue;
      const fam = family.get(mainKey);
      if (!fam || fam.length === 0) continue;
      seen.add(mainKey);
      out.push({
        mainName: c.mainName || c.name,
        members: fam,
        source: 'nickname-token',
        matched: t,
      });
    }

    // 2) /who cross-reference — characters observed BY an uploader whose
    //    name matches one of this member's tokens. Catches mains whose
    //    nickname uses an alt as the visible name.
    for (const t of tokens) {
      const observedSet = uploaderToCharsSeen.get(t);
      if (!observedSet) continue;
      for (const observedName of observedSet) {
        const c = charByName.get(observedName.toLowerCase());
        if (!c || c.discordId) continue;
        const mainKey = (c.mainName || c.name).toLowerCase();
        if (seen.has(mainKey)) continue;
        const fam = family.get(mainKey);
        if (!fam || fam.length === 0) continue;
        seen.add(mainKey);
        out.push({
          mainName: c.mainName || c.name,
          members: fam,
          source: 'who-observation',
          matched: `via ${t}'s /who`,
        });
      }
    }

    return out;
  }

  return members.map(m => {
    const charNames = charsByDiscord.get(m.discord_id) ?? [];
    return {
      ...m,
      charNames,
      hasLink:      charNames.length > 0,
      chatLast30:   chatCount.get(m.discord_id) ?? 0,
      parseLast30:  parseCount.get(m.discord_id) ?? 0,
      whoLast30:    whoCount.get(m.discord_id) ?? 0,
      suggestions:  suggestionsFor(m),
    };
  });
}

function memberLabel(m: Member): string {
  const a = m.nickname?.trim();
  const b = m.global_name?.trim();
  if (a && b && a !== b) return `${a} (${b})`;
  return a || b || m.discord_id;
}

function isActive(m: Member): boolean {
  const roles = m.role_names ?? [];
  return roles.some(r => ACTIVE_ROLES.has(r));
}

function isVisitor(m: Member): boolean {
  const roles = m.role_names ?? [];
  if (roles.includes(VISITOR_ROLE)) return true;
  // Anyone without an active role AND not a raid applicant counts as visitor too
  if (!roles.some(r => ACTIVE_ROLES.has(r)) && !roles.includes(APPLICANT_ROLE)) return true;
  return false;
}

async function actionAssertOfficer() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return null;
  if (!(await isOfficer(user.id))) return null;
  return user;
}

// Server action: link an entire family of characters to a member's
// discord_id. The picked main is the family root; every character with
// main_name = mainName (plus the main itself) gets the discord_id set.
// Two updates instead of one .or() — avoids PostgREST quoting pitfalls
// when names contain backticks / quotes / special chars.
async function linkMainToMember(formData: FormData) {
  'use server';
  if (!(await actionAssertOfficer())) redirect('/?error=admin_required');
  const discordId = String(formData.get('discord_id') || '');
  const mainName  = String(formData.get('main_name')  || '');
  if (!discordId || !mainName) return;
  const admin = supabaseAdmin();
  // The main itself
  await admin.from('characters')
    .update({ discord_id: discordId })
    .eq('guild_id', 'wolfpack').eq('name', mainName);
  // All alts pointing at this main
  await admin.from('characters')
    .update({ discord_id: discordId })
    .eq('guild_id', 'wolfpack').eq('main_name', mainName);
  revalidatePath('/admin/members');
}

// Server action: merge one wolfpack_members row into another, declaring the
// FROM account is an alias of the INTO account (same person, two Discord
// identities). Officer-only. /me walks the household so both accounts'
// linked characters show up under either login.
//
// Submit fromDiscordId='' to UNMERGE (clear the alias pointer).
async function mergeMemberInto(formData: FormData) {
  'use server';
  if (!(await actionAssertOfficer())) redirect('/?error=admin_required');
  const fromDiscordId = String(formData.get('from_discord_id') || '');
  const intoDiscordId = String(formData.get('into_discord_id') || '') || null;
  if (!fromDiscordId) return;
  if (intoDiscordId && intoDiscordId === fromDiscordId) return;  // self-merge blocked
  const admin = supabaseAdmin();
  await admin.from('wolfpack_members')
    .update({ merged_into_discord_id: intoDiscordId })
    .eq('discord_id', fromDiscordId);
  revalidatePath('/admin/members');
}

type Tab = 'active' | 'visitor' | 'unlinked' | 'silent' | 'recent' | 'all';

export default async function AdminMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: Tab }>;
}) {
  const { tab: tabRaw } = await searchParams;
  const tab: Tab = (['active','visitor','unlinked','silent','recent','all'] as const).includes(tabRaw as Tab) ? (tabRaw as Tab) : 'active';
  const demoMode = getDemoMode();
  const members = await loadMembers();

  const isSilent = (m: MemberRow) => m.chatLast30 === 0 && m.parseLast30 === 0 && m.whoLast30 === 0;
  const isRecent = (m: MemberRow) => {
    if (!m.joined_at) return false;
    return Date.now() - new Date(m.joined_at).getTime() < 30 * 24 * 60 * 60 * 1000;
  };

  const counts = {
    total:    members.length,
    active:   members.filter(isActive).length,
    visitor:  members.filter(isVisitor).length,
    silent:   members.filter(isSilent).length,
    unlinked: members.filter(m => !m.hasLink).length,
    recent:   members.filter(isRecent).length,
  };

  let rows: MemberRow[];
  if (tab === 'active')        rows = members.filter(isActive);
  else if (tab === 'visitor')  rows = members.filter(isVisitor);
  else if (tab === 'unlinked') rows = members.filter(m => !m.hasLink);
  else if (tab === 'silent')   rows = members.filter(isSilent);
  else if (tab === 'recent')   rows = members.filter(isRecent);
  else rows = members;

  // Sort: silent/recent emphasize recency; everything else alpha by name
  if (tab === 'recent' || tab === 'silent') {
    rows = rows.sort((a, b) => {
      const ax = a.joined_at ? new Date(a.joined_at).getTime() : 0;
      const bx = b.joined_at ? new Date(b.joined_at).getTime() : 0;
      return bx - ax;
    });
  } else {
    rows = rows.sort((a, b) => (memberLabel(a).toLowerCase() < memberLabel(b).toLowerCase() ? -1 : 1));
  }

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/admin" className="text-blue hover:underline">← back to admin</Link>
      </div>

      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-1">👥 Member dashboard</h2>
        <p className="text-sm text-dim leading-6">
          Cross-references guild members against character roster, chat,
          parses, and <code>/who</code> observations. Default tab is{' '}
          <b>Active</b> (Discord members holding Raid Pack / Officer /
          Raid Recruit / Pack Member / Pack Leader). Unlinked rows offer a
          one-click family link based on nickname tokens + <code>/who</code>{' '}
          cross-references.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4 text-xs">
          <Stat label="Active"        value={counts.active}   color="text-green" />
          <Stat label="Visitor/Inactive" value={counts.visitor} color="text-dim" />
          <Stat label="No character"  value={counts.unlinked} color="text-orange" />
          <Stat label="Silent 30d"    value={counts.silent}   color="text-orange" />
          <Stat label="Recent joins"  value={counts.recent}   color="text-blue" />
        </div>
      </section>

      <nav className="text-xs flex items-center gap-2 flex-wrap">
        <Toggle href="/admin/members"               active={tab === 'active'}   label={`Active (${counts.active})`} />
        <Toggle href="/admin/members?tab=visitor"   active={tab === 'visitor'}  label={`Visitor/Inactive (${counts.visitor})`} />
        <Toggle href="/admin/members?tab=unlinked"  active={tab === 'unlinked'} label={`No character link (${counts.unlinked})`} />
        <Toggle href="/admin/members?tab=silent"    active={tab === 'silent'}   label={`Silent 30d (${counts.silent})`} />
        <Toggle href="/admin/members?tab=recent"    active={tab === 'recent'}   label={`Recent joins (${counts.recent})`} />
        <Toggle href="/admin/members?tab=all"       active={tab === 'all'}      label={`All (${counts.total})`} />
      </nav>

      <section className="bg-panel border border-border rounded-lg">
        <table className="w-full text-xs">
          <thead className="text-dim hidden sm:table-header-group">
            <tr className="border-b border-border">
              <th className="text-left px-2 sm:px-3 py-2 font-normal">Member</th>
              <th className="text-left px-2 sm:px-3 py-2 font-normal">Joined</th>
              <th className="text-left px-2 sm:px-3 py-2 font-normal">Characters</th>
              <th className="text-right px-2 sm:px-3 py-2 font-normal hidden md:table-cell">Chat 30d</th>
              <th className="text-right px-2 sm:px-3 py-2 font-normal hidden md:table-cell">Parses 30d</th>
              <th className="text-right px-2 sm:px-3 py-2 font-normal hidden md:table-cell">/who 30d</th>
              <th className="text-left px-2 sm:px-3 py-2 font-normal hidden lg:table-cell">Roles</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-dim italic">No members match this filter.</td></tr>
            )}
            {rows.map(m => {
              const silent = isSilent(m);
              return (
                <tr key={m.discord_id} className="border-b border-border/40 hover:bg-[#1a212c] align-top">
                  <td className="px-2 sm:px-3 py-2 text-text">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span>{memberLabel(m)}</span>
                      {silent && <span className="text-orange text-[10px]">· silent</span>}
                    </div>
                    <div className="text-dim text-[10px] sm:hidden">
                      {fmtJoined(m.joined_at)}
                      {(m.chatLast30 || m.parseLast30 || m.whoLast30) > 0 && (
                        <> · {m.chatLast30}💬 {m.parseLast30}📊 {m.whoLast30}👁</>
                      )}
                    </div>
                    <div className="text-dim text-[10px] hidden sm:block">{m.discord_id}</div>
                  </td>
                  <td className="px-2 sm:px-3 py-2 text-dim whitespace-nowrap hidden sm:table-cell">{fmtJoined(m.joined_at)}</td>
                  <td className="px-2 sm:px-3 py-2">
                    {m.charNames.length > 0 ? (
                      <span className="text-text">
                        {m.charNames.slice(0, 4).map((c, i) => (
                          <span key={c.name}>
                            {i > 0 && <span className="text-dim">, </span>}
                            <Link href={`/character/${encodeURIComponent(c.name)}`} className="text-blue hover:underline">{maybeFake(demoMode, c.name, c.className)}</Link>
                          </span>
                        ))}
                        {m.charNames.length > 4 && <span className="text-dim"> +{m.charNames.length - 4}</span>}
                      </span>
                    ) : m.suggestions.length > 0 ? (
                      <form action={linkMainToMember} className="flex items-center gap-1 flex-wrap">
                        <input type="hidden" name="discord_id" value={m.discord_id} />
                        <select name="main_name"
                          className="bg-bg border border-border rounded px-2 py-0.5 text-xs"
                          defaultValue={m.suggestions[0].mainName}>
                          {m.suggestions.map(s => (
                            <option key={s.mainName} value={s.mainName}>
                              {maybeFake(demoMode, s.mainName, s.members[0]?.className ?? null)}
                              {s.members.length > 1 ? ` +${s.members.length - 1} alts` : ''}
                              {' '}({s.source === 'nickname-token' ? `name: ${s.matched}` : s.matched})
                            </option>
                          ))}
                        </select>
                        <button type="submit" className="px-2 py-0.5 rounded border border-blue bg-[#1f6feb] text-white text-[10px]">
                          Link family
                        </button>
                      </form>
                    ) : (
                      <span className="text-orange text-[11px]">— none —</span>
                    )}
                    {/* Household merge — declare this Discord account an
                        alias of another (same person, multiple identities).
                        When already merged, show the unmerge button instead. */}
                    {m.merged_into_discord_id ? (
                      <form action={mergeMemberInto} className="mt-1.5 flex items-center gap-1.5 text-[10px]">
                        <span className="text-dim">Alias of</span>
                        <code className="text-text">{members.find(x => x.discord_id === m.merged_into_discord_id)?.nickname || m.merged_into_discord_id.slice(0,8)+'…'}</code>
                        <input type="hidden" name="from_discord_id" value={m.discord_id} />
                        <input type="hidden" name="into_discord_id" value="" />
                        <button type="submit" className="px-1.5 py-0 rounded border border-border text-dim hover:text-orange hover:border-orange/60">unmerge</button>
                      </form>
                    ) : (
                      <details className="mt-1.5 text-[10px]">
                        <summary className="cursor-pointer text-dim hover:text-text">Merge into another Discord account…</summary>
                        <form action={mergeMemberInto} className="mt-1 flex items-center gap-1 flex-wrap">
                          <input type="hidden" name="from_discord_id" value={m.discord_id} />
                          <select name="into_discord_id" required defaultValue=""
                            className="bg-bg border border-border rounded px-1.5 py-0.5 text-[10px]">
                            <option value="" disabled>Pick primary account…</option>
                            {members
                              .filter(x => x.discord_id !== m.discord_id && !x.merged_into_discord_id)
                              .sort((a,b) => (a.nickname||'').localeCompare(b.nickname||''))
                              .map(x => (
                                <option key={x.discord_id} value={x.discord_id}>
                                  {x.nickname || x.global_name || x.discord_id.slice(0,8)+'…'}
                                </option>
                              ))}
                          </select>
                          <button type="submit" className="px-1.5 py-0.5 rounded border border-blue bg-[#1f6feb] text-white">
                            Merge
                          </button>
                          <span className="text-dim">— characters of both surface together on /me</span>
                        </form>
                      </details>
                    )}
                    <div className="text-dim text-[10px] mt-1 sm:hidden">
                      Roles: {(m.role_names ?? []).filter(r => ACTIVE_ROLES.has(r) || r === VISITOR_ROLE || r === APPLICANT_ROLE).join(', ') || '—'}
                    </div>
                  </td>
                  <td className={`px-2 sm:px-3 py-2 text-right hidden md:table-cell ${m.chatLast30  === 0 ? 'text-dim' : 'text-text'}`}>{m.chatLast30.toLocaleString()}</td>
                  <td className={`px-2 sm:px-3 py-2 text-right hidden md:table-cell ${m.parseLast30 === 0 ? 'text-dim' : 'text-text'}`}>{m.parseLast30.toLocaleString()}</td>
                  <td className={`px-2 sm:px-3 py-2 text-right hidden md:table-cell ${m.whoLast30   === 0 ? 'text-dim' : 'text-text'}`}>{m.whoLast30.toLocaleString()}</td>
                  <td className="px-2 sm:px-3 py-2 text-dim text-[10px] hidden lg:table-cell">
                    {(m.role_names ?? []).slice(0, 3).join(', ') || '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
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
