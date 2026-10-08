'use server';

// Anonymous feedback intake for eqmimic.quest (the guild lead, 2026-10-08).
//
// Order matters and is the point of this file:
//   honeypot -> shape checks -> CLEAN -> rate limit -> insert.
// Nothing reaches the database (or any log) that has not come out of lib/anonFeedbackClean.ts, and a
// message that fails the cleaner is never stored. Rejected and dropped submissions cost no write.
//
// ⚠ Never log the message, the contact or a caught error here. console.* is deliberately absent from
// this file: a PostgREST error can echo the failing row, and the whole point of the cleaner is that
// the raw text goes nowhere. A failure is reported to the caller as a plain sentence only.

import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';
import { cleanAnonMessage, cleanDiscordContact } from '@/lib/anonFeedbackClean';

const CATEGORIES = ['bug', 'idea'] as const;
const CLIENTS = ['mimic', 'web'] as const;
const PER_HOUR = 5;

// Self-reported strings from the page fragment. Not free text, so a strict shape is cleaner than
// running them through the message cleaner: anything off-shape is dropped, not stored.
const VERSION_RX = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,31}$/;
const PLATFORM_RX = /^[a-z0-9_-]{1,16}$/;

export type AnonFeedbackInput = {
  category: string;
  message: string;
  contact?: string;
  // Honeypot: a real person never sees this field, so any value means a bot.
  website?: string;
  client?: string;
  appVersion?: string;
  platform?: string;
};

export type AnonFeedbackResult = { ok: boolean; ref?: number; error?: string };

function ipHash(): string | null {
  const salt = process.env.ANON_FEEDBACK_SALT || process.env.DEMO_OBFUSCATE_SALT;
  if (!salt) return null;
  const h = headers();
  const ip = (h.get('x-forwarded-for') || '').split(',')[0].trim() || h.get('x-real-ip') || 'unknown';
  return createHash('sha256').update(`${ip}|${salt}`).digest('hex');
}

export async function submitAnonFeedback(input: AnonFeedbackInput): Promise<AnonFeedbackResult> {
  // Bots fill every field. Say thanks and store nothing, so there is nothing to learn from the reply.
  if (typeof input?.website === 'string' && input.website.trim() !== '') return { ok: true };

  const category = (CATEGORIES as readonly string[]).includes(input?.category) ? input.category : '';
  if (!category) return { ok: false, error: 'Pick Bug or Idea first.' };

  const msg = cleanAnonMessage(input.message);
  if (msg.reject) return { ok: false, error: msg.reject };
  const contact = cleanDiscordContact(input.contact);

  const hash = ipHash();
  if (!hash) return { ok: false, error: 'Feedback is not set up on this server yet.' };

  const admin = supabaseAdmin();
  // The hash only exists for the hourly limit, so nothing older than a day keeps one. Pruned on every
  // save (cheap: an indexless update over a small table), so there is no separate job to forget.
  await admin.from('anon_feedback').update({ ip_hash: null })
    .lt('submitted_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .not('ip_hash', 'is', null);
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error: countErr } = await admin
    .from('anon_feedback')
    .select('id', { count: 'exact', head: true })
    .eq('ip_hash', hash)
    .gte('submitted_at', since);
  if (countErr) return { ok: false, error: 'Could not save, please try again in a bit.' };
  if ((count ?? 0) >= PER_HOUR) {
    return { ok: false, error: 'That is a lot of reports in an hour. Please try again later.' };
  }

  const client = (CLIENTS as readonly string[]).includes(input.client ?? '') ? input.client : 'web';
  const version = typeof input.appVersion === 'string' && VERSION_RX.test(input.appVersion) ? input.appVersion : null;
  const platform = typeof input.platform === 'string' && PLATFORM_RX.test(input.platform) ? input.platform : null;

  const { data, error } = await admin
    .from('anon_feedback')
    .insert([{
      category,
      message: msg.text,
      discord_contact: contact.contact,
      client,
      app_version: version,
      platform,
      flags: Array.from(new Set([...msg.flags, ...contact.flags])),
      ip_hash: hash,
    }])
    .select('ref')
    .single();
  if (error || !data) return { ok: false, error: 'Could not save, please try again in a bit.' };
  return { ok: true, ref: data.ref as number };
}
