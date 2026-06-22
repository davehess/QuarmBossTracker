'use server';

// Server actions for the "Not in OpenDKP" table on /admin/links. Wraps the
// bot's POST /api/admin/opendkp-register endpoint with officer-auth + the
// shared agent bearer. The web has no direct OpenDKP credentials — it goes
// through the bot, which already has utils/opendkp.createCharacter wired
// for the /register Discord command. This action is the equivalent of an
// officer running that command, just driven from the dropdowns on the web.

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { isOfficer } from '@/lib/officer';

type RegisterArgs = {
  name:  string;
  cls:   string;
  race:  string;
  level: number;
  rank:  string;
};

export async function registerInOpenDKP(args: RegisterArgs): Promise<{ ok: boolean; error?: string }> {
  // Auth gate: signed-in officer only. The action assertion runs first so a
  // hostile browser session can't drive the action via a crafted request.
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return { ok: false, error: 'not signed in' };
  const ok = await isOfficer(user.id);
  if (!ok) return { ok: false, error: 'officer role required' };

  // Reject the UNKNOWN sentinel — OpenDKP rejects it server-side anyway, but
  // failing here gives the officer a clear "pick a class/race" error instead
  // of the bot's opaque "OpenDKP createCharacter failed" response.
  if (!args.cls  || args.cls  === 'UNKNOWN') return { ok: false, error: 'class required — pick one before registering' };
  if (!args.race || args.race === 'UNKNOWN') return { ok: false, error: 'race required — pick one before registering' };

  const botUrl = process.env.BOT_BASE_URL;
  const token  = process.env.WOLFPACK_AGENT_TOKEN;
  if (!botUrl) return { ok: false, error: 'BOT_BASE_URL not configured on the web — set it on Vercel to the Railway bot URL' };
  if (!token)  return { ok: false, error: 'WOLFPACK_AGENT_TOKEN not set' };

  // Officer's Discord ID — stamped on the bot log + recorded for audit.
  const admin = supabaseAdmin();
  const { data: pack } = await admin
    .from('wolfpack_members')
    .select('discord_id')
    .eq('user_id', user.id)
    .maybeSingle();
  const recordedBy = pack?.discord_id || user.id;

  try {
    const res = await fetch(`${botUrl.replace(/\/+$/, '')}/api/admin/opendkp-register`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        name:  args.name,
        class: args.cls,
        race:  args.race,
        level: args.level,
        rank:  args.rank,
        recorded_by_discord_id: recordedBy,
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, error: `bot HTTP ${res.status}: ${text.slice(0, 240)}` };
    }
    revalidatePath('/admin/links');
    return { ok: true };
  } catch (err: unknown) {
    return { ok: false, error: (err as Error).message };
  }
}
