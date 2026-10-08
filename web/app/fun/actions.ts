'use server';

// Mark an LD on the /fun card as "it was a /quit" (the guild lead, 2026-10-04),
// or take the mark back. A /quit looks exactly like a crash from every observer's
// log, so the player or an officer says so by hand. Only an LD during a real raid
// is on the card, so only one of those can be marked.
//
// The gate is HERE, not only in the page: an action can be invoked directly, so
// the button being hidden proves nothing. The write goes through the service role
// into fun_events.detail only — no RLS policy opens that table to a client.
//
// The caller sends the timestamp of the LD it was looking at. The server works
// out for itself which LD "mark" or "undo" would act on, and refuses when they
// differ (a new LD arrived while the page sat open): better an error than a
// different crash forgiven than the one on screen.

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { viewerMayMarkQuit } from '@/lib/funLdAuth';
import { loadRaidDates } from '@/lib/funLdRaids';
import {
  QUIT_WINDOW_MS, isQuit, ldView, parseLds, siblingsOf, viewerDiscordId, withQuit, withoutQuit,
  type LdRow,
} from '@/lib/funLd';

export async function setLdQuit(quit: boolean, ts: string): Promise<{ ok: boolean; error?: string }> {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user || !(await viewerMayMarkQuit(user))) {
    return { ok: false, error: "Only that character's player or an officer can do this." };
  }
  const at = Date.parse(String(ts));
  if (!Number.isFinite(at)) return { ok: false, error: 'Bad timestamp.' };

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from('fun_events')
    .select('id, event_ts, target, detail')
    .eq('event_type', 'peopleslayer_ld')
    .order('event_ts', { ascending: true });
  if (error) return { ok: false, error: error.message };

  // The same raid dates the page reads, so "the LD I would mark" is the LD on the
  // card: an LD outside a real raid is not on the card and cannot be marked.
  let raidDates: Set<string>;
  try {
    raidDates = await loadRaidDates(sb);
  } catch {
    return { ok: false, error: 'Could not read the raid list — try again.' };
  }

  const lds = parseLds((data ?? []) as LdRow[]);
  const view = ldView(lds, raidDates);
  const target = quit ? view.mark : view.undo;
  if (!target || Math.abs(target.ts - at) > QUIT_WINDOW_MS) {
    return { ok: false, error: 'The LD list changed — refresh the page.' };
  }

  const nowIso = new Date().toISOString();
  const by = viewerDiscordId(user);
  const rows = siblingsOf(lds, target.ts).filter(l => l.id != null && (quit || isQuit(l.detail)));
  const results = await Promise.all(rows.map(l => sb
    .from('fun_events')
    .update({ detail: quit ? withQuit(l.detail, by, nowIso) : withoutQuit(l.detail) })
    .eq('id', l.id as number | string)));
  const failed = results.find(r => r.error);
  if (failed?.error) return { ok: false, error: failed.error.message };

  revalidatePath('/fun');
  return { ok: true };
}
