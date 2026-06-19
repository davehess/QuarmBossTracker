'use server';

// Web-side "buffs feel laggy" reporter. Inserts a row into buff_lag_reports
// so we can correlate when raiders FEEL the queue is stale against the
// throttle config in place at that moment. The /raid and /buffs pages both
// import this; client-side BuffLagButton handles the snappier refresh window
// (lowering router.refresh cadence from 15s to 3s for 60s) — no server
// involvement needed for that, the component just adjusts its own setInterval.

import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';

const SOURCES = new Set(['web_raid', 'web_buffs']);

export async function reportBuffLag(source: string): Promise<{ ok: boolean }> {
  if (!SOURCES.has(source)) return { ok: false };

  let discordId: string | null = null;
  try {
    const { data: { user } } = await supabaseServer().auth.getUser();
    if (user) {
      const admin = supabaseAdmin();
      const { data: pack } = await admin
        .from('wolfpack_members')
        .select('discord_id')
        .eq('user_id', user.id)
        .maybeSingle();
      discordId = pack?.discord_id ?? null;
    }
  } catch { /* anonymous fallback */ }

  const admin = supabaseAdmin();
  await admin.from('buff_lag_reports').insert([{
    source,
    discord_id: discordId,
    character:  null,
    client_settings: {
      web_refresh_ms_normal: 15000,
      web_refresh_ms_snappy: 3000,
      web_snappy_window_ms:  60000,
    },
  }]);

  return { ok: true };
}
