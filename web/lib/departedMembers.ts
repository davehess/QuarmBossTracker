// Who left the Discord and still has a way in (the guild lead, 2026-11-01: a banned member could not be locked from
// /admin/access because the page listed current members only). Pure: the loader reads, this decides.
//
// Flagged = is_member false (the bot flips it the moment someone leaves, is kicked or banned, and stamps
// refreshed_at then), left within WINDOW_DAYS, not merged into another member, not under an active lockout, and
// still holding access worth closing: a website login (user_id) or a live Mimic session (revoked_at null).
// Display names are runtime data from the members table; nothing is named here.

import { isActiveRow } from './lockout';

// Effectively "ever": the 6-hourly member sync re-stamps refreshed_at on former members too (measured 2026-11-01: all 79
// former members carried a stamp from the last 30 days), so it is NOT a leave time and cannot bound a window. The
// access test below (a login or a live Mimic session) is what keeps the list short (3 people that night).
export const DEPARTED_WINDOW_DAYS = 3650;
export const DEPARTED_CAP = 20;

export type DepartedMemberRow = {
  discord_id: string;
  user_id: string | null;
  nickname: string | null;
  global_name: string | null;
  is_member: boolean | null;
  refreshed_at: string | null;
  merged_into_discord_id?: string | null;
};
export type DepartedLockRow = { discord_id: string; until: string | null };
export type Departed = { discordId: string; name: string; leftAt: string; hasLogin: boolean; liveMimic: boolean };

export function departedName(m: { nickname?: string | null; global_name?: string | null; discord_id: string }): string {
  return m.nickname?.trim() || m.global_name?.trim() || m.discord_id;
}

export function flagDeparted(input: {
  members: DepartedMemberRow[];
  locks: DepartedLockRow[];
  liveMimicIds: Iterable<string>;
  now?: number;
  windowDays?: number;
  cap?: number;
}): Departed[] {
  const now = input.now ?? Date.now();
  const cutoff = now - (input.windowDays ?? DEPARTED_WINDOW_DAYS) * 86_400_000;
  const locked = new Set(input.locks.filter(l => isActiveRow(l, now)).map(l => l.discord_id));
  const live = new Set(input.liveMimicIds);
  const out: Departed[] = [];
  for (const m of input.members) {
    if (m.is_member !== false) continue;
    if (m.merged_into_discord_id) continue;
    const t = m.refreshed_at ? Date.parse(m.refreshed_at) : NaN;
    if (!Number.isFinite(t) || t < cutoff) continue;
    if (locked.has(m.discord_id)) continue;
    const hasLogin = !!m.user_id;
    const liveMimic = live.has(m.discord_id);
    if (!hasLogin && !liveMimic) continue;
    out.push({ discordId: m.discord_id, name: departedName(m), leftAt: m.refreshed_at as string, hasLogin, liveMimic });
  }
  out.sort((a, b) => Date.parse(b.leftAt) - Date.parse(a.leftAt));
  return out.slice(0, input.cap ?? DEPARTED_CAP);
}
