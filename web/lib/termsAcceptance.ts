// Records that someone signed in under a version of the terms (the guild lead's pre-launch checklist, 2026-11-01).
// Both sign-in callbacks call this once the session is good: web/app/auth/callback/route.ts (Wolf Pack) and
// web/lib/openSignIn.ts (raidmimic). One row per (user, terms version); the first acceptance of a version keeps its
// time, a later sign-in under the same version changes nothing.
//
// FAIL OPEN, on purpose: a missing table, a database error or a throw is swallowed and sign-in goes on. A record we
// could not write is a gap in the log; a person locked out of their own account because the log failed is worse.
// The table has RLS on and no policies, so only the service-role client the callbacks already hold can write it.
import type { SupabaseClient } from '@supabase/supabase-js';
import { TERMS_VERSION } from './legal';

export interface TermsAcceptanceRow {
  user_id: string;
  discord_id: string | null;
  terms_version: string;
  host: string | null;
}

export function termsAcceptanceRow(userId: string, discordId: string | null | undefined, host: string | null | undefined): TermsAcceptanceRow {
  return {
    user_id: userId,
    discord_id: discordId ? String(discordId) : null,
    terms_version: TERMS_VERSION,
    host: host ? String(host).toLowerCase().slice(0, 100) : null,
  };
}

/** `origin` is what web/lib/request-origin.ts returns (scheme://host); the host is stored. Never throws, never blocks. */
export async function recordTermsAcceptance(
  admin: Pick<SupabaseClient, 'from'>, userId: string, discordId: string | null | undefined, origin: string | null | undefined,
): Promise<void> {
  try {
    // ignoreDuplicates = ON CONFLICT DO NOTHING: the first acceptance of this version stays as it was.
    await admin.from('terms_acceptances')
      .upsert(termsAcceptanceRow(userId, discordId, origin ? new URL(origin).host : null), { onConflict: 'user_id,terms_version', ignoreDuplicates: true });
  } catch {
    /* fail open: see the header */
  }
}
