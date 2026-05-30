// Officer tool: new-member outreach + activity overview.
//
// Three questions answered:
//   1) Who joined recently and is silent? (no character, no DKP, no chat,
//      no parse appearance) — outreach candidates.
//   2) Who is linked to a character (officer link tool done) vs not?
//   3) Top of the funnel: counts by join cohort, by role.

import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import { getDemoMode, maybeFake } from '@/lib/obfuscate';

export const dynamic = 'force-dynamic';

type Member = {
  discord_id: string;
  nickname: string | null;
  global_name: string | null;
  joined_at: string | null;
  refreshed_at: string | null;
  role_names: string[] | null;
};

type CharInfo = { name: string; className: string | null };

type MemberRow = Member & {
  charCount: number;
  charNames: CharInfo[];
  hasLink: boolean;        // any character.discord_id == this member
  chatLast30: number;
  parseLast30: number;
  whoLast30: number;
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
      .select('discord_id, nickname, global_name, joined_at, refreshed_at, role_names')
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
      .select('character, observed_at, uploaded_by')
      .gte('observed_at', since30)
      .limit(50000),
  ]);

  const members = (membersRaw ?? []) as Member[];
  const allChars = (chars ?? []) as { name: string; class: string | null; discord_id: string | null; main_name: string | null; active: boolean }[];

  // discord_id → [character info] (only active)
  const charsByDiscord = new Map<string, CharInfo[]>();
  for (const c of allChars) {
    if (c.discord_id && c.active) {
      const list = charsByDiscord.get(c.discord_id) ?? [];
      list.push({ name: c.name, className: c.class });
      charsByDiscord.set(c.discord_id, list);
    }
  }

  // Activity windows — bucket per discord_id by joining to character names.
  // We don't know discord_id for many chat/parse rows (speakers are character
  // names, not Discord IDs), so we resolve through the character → discord
  // map first.
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
  for (const w of (whos ?? []) as { character: string }[]) {
    const d = charToDiscord.get((w.character || '').toLowerCase());
    if (d) whoCount.set(d, (whoCount.get(d) ?? 0) + 1);
  }

  return members.map(m => {
    const charNames = charsByDiscord.get(m.discord_id) ?? [];
    return {
      ...m,
      charCount:    charNames.length,
      charNames,
      hasLink:      charNames.length > 0,
      chatLast30:   chatCount.get(m.discord_id) ?? 0,
      parseLast30:  parseCount.get(m.discord_id) ?? 0,
      whoLast30:    whoCount.get(m.discord_id) ?? 0,
    };
  });
}

function memberLabel(m: Member): string {
  const a = m.nickname?.trim();
  const b = m.global_name?.trim();
  if (a && b && a !== b) return `${a} (${b})`;
  return a || b || m.discord_id;
}

type Tab = 'silent' | 'unlinked' | 'recent' | 'all';

export default async function AdminMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: Tab }>;
}) {
  const { tab: tabRaw } = await searchParams;
  const tab: Tab = (['silent', 'unlinked', 'recent', 'all'] as const).includes(tabRaw as Tab) ? (tabRaw as Tab) : 'silent';
  const demoMode = getDemoMode();
  const members = await loadMembers();

  // Activity = any of chat/parse/who in last 30 days
  const isSilent = (m: MemberRow) => m.chatLast30 === 0 && m.parseLast30 === 0 && m.whoLast30 === 0;
  // "Recent" — joined in last 30 days. joined_at is the guild-join timestamp
  // as reported by Discord; some old members have null joined_at, treat as
  // not-recent in that case.
  const isRecent = (m: MemberRow) => {
    if (!m.joined_at) return false;
    return Date.now() - new Date(m.joined_at).getTime() < 30 * 24 * 60 * 60 * 1000;
  };

  const counts = {
    total:    members.length,
    silent:   members.filter(isSilent).length,
    unlinked: members.filter(m => !m.hasLink).length,
    recent:   members.filter(isRecent).length,
  };

  let rows: MemberRow[];
  if (tab === 'silent')   rows = members.filter(isSilent);
  else if (tab === 'unlinked') rows = members.filter(m => !m.hasLink);
  else if (tab === 'recent')   rows = members.filter(isRecent);
  else rows = members;

  // For "recent" sort by joined_at desc; for "silent" emphasize the loudest
  // signal-of-absence (most recent join with no activity).
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
          parses, and <code>/who</code> observations to surface silent
          members and roster gaps. "Last 30d" windows match the standard
          inactive threshold; sort emphasizes loudest signal first.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-xs">
          <Stat label="Members"      value={counts.total} />
          <Stat label="Silent 30d"   value={counts.silent}   color="text-orange" />
          <Stat label="No character" value={counts.unlinked} color="text-orange" />
          <Stat label="Recent joins" value={counts.recent}   color="text-blue" />
        </div>
      </section>

      <nav className="text-xs flex items-center gap-2 flex-wrap">
        <Toggle href="/admin/members" active={tab === 'silent'} label={`Silent 30d (${counts.silent})`} />
        <Toggle href="/admin/members?tab=unlinked" active={tab === 'unlinked'} label={`No character link (${counts.unlinked})`} />
        <Toggle href="/admin/members?tab=recent" active={tab === 'recent'}   label={`Recent joins (${counts.recent})`} />
        <Toggle href="/admin/members?tab=all"    active={tab === 'all'}      label={`All (${counts.total})`} />
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
                <tr key={m.discord_id} className="border-b border-border/40 hover:bg-[#1a212c]">
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
                    {m.charNames.length === 0 ? (
                      <span className="text-orange">— none —</span>
                    ) : (
                      <span className="text-text">
                        {m.charNames.slice(0, 3).map((c, i) => (
                          <span key={c.name}>
                            {i > 0 && <span className="text-dim">, </span>}
                            <Link href={`/character/${encodeURIComponent(c.name)}`} className="text-blue hover:underline">{maybeFake(demoMode, c.name, c.className)}</Link>
                          </span>
                        ))}
                        {m.charNames.length > 3 && <span className="text-dim"> +{m.charNames.length - 3}</span>}
                      </span>
                    )}
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
