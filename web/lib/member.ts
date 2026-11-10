// Guild-membership gate for member pages and member API routes (2026-11-10, "member pages re-check guild
// membership on every request").
//
// A signed-in session says who someone is, not that they are a current member: the session can come from a door
// that asks for no guild (raidmimic.com, DECISIONS §492) and it outlives a departure. So every page or route that
// serves guild data asks here as well, on each request. The answer is wolfpack_members.is_member = true for the
// session's user (the bot flips it on a departure and the sign-in callback sets it), read with the server key.
//
// Pages: `await requireMember(user.id)` right after the signed-in check. Route handlers: `isGuildMember(user.id)`,
// answered with their own 403 shape. /admin goes through requireOfficer, which asks the same question (lib/officer.ts).
//
// Deliberately NOT gated (test/web-member-gate.test.js keeps the list): public pages, the raidmimic open paths, the
// public share links, and /me, so that a member who has left can still reach their own data to export or delete it.

import { cache } from 'react';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from './supabase';

// cache() = one lookup per request, shared by every caller in the render tree (same pattern as isOfficer).
// Fails closed: a missing row, a false flag, or a failed read all read as "not a member".
export const isGuildMember = cache(async (userId: string | null | undefined): Promise<boolean> => {
  if (!userId) return false;
  try {
    const { data } = await supabaseAdmin()
      .from('wolfpack_members')
      .select('is_member')
      .eq('user_id', userId)
      .maybeSingle();
    return (data as { is_member?: boolean | null } | null)?.is_member === true;
  } catch {
    return false;
  }
});

export const NOT_MEMBER_MESSAGE =
  'This Discord account is not a current Wolf Pack EQ member. Sign in with the account you use in our server.';

// For pages: sends a signed-in non-member to the sign-in page with an explanation. Call it after the signed-in check.
export async function requireMember(userId: string): Promise<void> {
  if (await isGuildMember(userId)) return;
  redirect(`/auth/signin?error=${encodeURIComponent(NOT_MEMBER_MESSAGE)}`);
}
