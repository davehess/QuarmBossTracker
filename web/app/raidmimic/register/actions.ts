'use server';

// "Register your guild" intake for raidmimic.com/register (the guild lead, 2026-11-01). Same order and same protections
// as the anonymous feedback form (app/eqmimic/feedback/actions.ts):
//   honeypot -> VALIDATE + CLEAN (lib/guildInterest.ts) -> rate limit -> insert.
// Nothing reaches the database that has not come out of validateInterest(); a rejected submission costs no write.
//
// ⚠ Never log a field, the contact or a caught error here. console.* is deliberately absent from this file: a PostgREST
// error can echo the failing row. A failure is reported to the caller as a plain sentence only.
//
// The salted hash of the sender's address exists only for the hourly limit and is erased after a day (the same
// ANON_FEEDBACK_SALT as the feedback form, so no second secret to set). The helper is a copy of that file's ipHash():
// it is a private function inside a 'use server' module, which cannot export a non-action.

import { createHmac } from 'node:crypto';
import { headers } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';
import { INTEREST_PER_HOUR, validateInterest, type InterestInput } from '@/lib/guildInterest';

export type InterestSubmitResult = { ok: boolean; error?: string };

function ipHash(): string | null {
  const salt = process.env.ANON_FEEDBACK_SALT || process.env.DEMO_OBFUSCATE_SALT;
  if (!salt) return null;
  const h = headers();
  const ip = (h.get('x-forwarded-for') || '').split(',')[0].trim() || h.get('x-real-ip') || 'unknown';
  return createHmac('sha256', salt).update(ip).digest('hex');
}

export async function submitGuildInterest(input: InterestInput): Promise<InterestSubmitResult> {
  const v = validateInterest(input);
  // Bots fill every field. Say thanks and store nothing, so there is nothing to learn from the reply.
  if (v.ok && 'bot' in v) return { ok: true };
  if (!v.ok) return { ok: false, error: v.error };

  const hash = ipHash();
  if (!hash) return { ok: false, error: 'Registration is not set up on this server yet.' };

  const admin = supabaseAdmin();
  // Nothing older than a day keeps a hash. Pruned on every save, so there is no separate job to forget.
  await admin.from('guild_interest').update({ ip_hash: null })
    .lt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .not('ip_hash', 'is', null);
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error: countErr } = await admin
    .from('guild_interest')
    .select('id', { count: 'exact', head: true })
    .eq('ip_hash', hash)
    .gte('created_at', since);
  if (countErr) return { ok: false, error: 'Could not save, please try again in a bit.' };
  if ((count ?? 0) >= INTEREST_PER_HOUR) {
    return { ok: false, error: 'That is a lot of registrations in an hour. Please try again later.' };
  }

  const { error } = await admin.from('guild_interest').insert([{ ...v.row, ip_hash: hash }]);
  if (error) return { ok: false, error: 'Could not save, please try again in a bit.' };
  return { ok: true };
}
