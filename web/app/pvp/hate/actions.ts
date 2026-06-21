'use server';

// /pvp/hate server actions — assign a spot to an unassigned hate kill row,
// or mark a spot available ahead of its respawn window. Auth-gated to any
// signed-in member; the write itself goes through the service-role client
// because RLS on hate_kills only grants SELECT to authenticated.
//
// Window math mirrors utils/hateKills.js in the bot: live = exact 72h,
// pvp = 72h ±20%. Both modules MUST agree — when the agent inserts an
// unassigned row, next_spawn_earliest/latest are still NULL; assignment
// here recomputes them off killed_at so the spot timer attaches.

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';

const HATE_TIMER_HOURS = 72;
const PVP_VARIANCE     = 0.2;
const VALID_SPOTS      = new Set([1, 2, 3, 5, 7, 8, 9, 10, 11, 12]);

function spawnWindow(server: 'live' | 'pvp', killedAtMs: number) {
  const baseMs = HATE_TIMER_HOURS * 3600000;
  if (server === 'live') {
    const exact = new Date(killedAtMs + baseMs).toISOString();
    return { earliest: exact, latest: exact };
  }
  return {
    earliest: new Date(killedAtMs + baseMs * (1 - PVP_VARIANCE)).toISOString(),
    latest:   new Date(killedAtMs + baseMs * (1 + PVP_VARIANCE)).toISOString(),
  };
}

async function _requireUser() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) throw new Error('not signed in');

  const admin = supabaseAdmin();
  const { data: pack } = await admin
    .from('wolfpack_members')
    .select('discord_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!pack?.discord_id) throw new Error('not a Wolf Pack member');
  return { discordId: pack.discord_id as string };
}

export async function assignSpot(killId: number, spotNum: number): Promise<{ ok: boolean; error?: string }> {
  if (!VALID_SPOTS.has(spotNum)) return { ok: false, error: 'invalid spot' };

  let discordId: string;
  try { ({ discordId } = await _requireUser()); }
  catch (e) { return { ok: false, error: (e as Error).message }; }

  const admin = supabaseAdmin();
  const { data: row, error: readErr } = await admin
    .from('hate_kills')
    .select('server, killed_at, spot_num, cleared_at')
    .eq('id', killId)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };
  if (!row) return { ok: false, error: 'kill not found' };
  if (row.cleared_at) return { ok: false, error: 'kill already cleared' };

  const server   = row.server as 'live' | 'pvp';
  const killedAt = Date.parse(row.killed_at as string);
  const { earliest, latest } = spawnWindow(server, killedAt);

  const { error: writeErr } = await admin
    .from('hate_kills')
    .update({
      spot_num:               spotNum,
      next_spawn_earliest:    earliest,
      next_spawn_latest:      latest,
      recorded_by_discord_id: discordId,
    })
    .eq('id', killId);
  if (writeErr) return { ok: false, error: writeErr.message };

  revalidatePath('/pvp/hate');
  return { ok: true };
}

export async function clearSpot(killId: number): Promise<{ ok: boolean; error?: string }> {
  let discordId: string;
  try { ({ discordId } = await _requireUser()); }
  catch (e) { return { ok: false, error: (e as Error).message }; }

  const admin = supabaseAdmin();
  const { error } = await admin
    .from('hate_kills')
    .update({ cleared_at: new Date().toISOString(), cleared_by_discord_id: discordId })
    .eq('id', killId);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/pvp/hate');
  return { ok: true };
}
