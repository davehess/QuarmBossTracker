'use server';

// Server action for the "Not in OpenDKP" table on /admin/links.
//
// Writes an OpenDKP registration request to the opendkp_register_requests
// queue (via the web's existing Supabase service-role access). The bot drains
// the queue every ~20s: createCharacter in OpenDKP, parent it under the
// uploader's family root, stamp the characters audit marker, and DM the owner
// a claim link.
//
// This replaced a direct web→bot HTTP call that required BOTH BOT_BASE_URL
// and WOLFPACK_AGENT_TOKEN to be set on Vercel — two repeated foot-guns that
// left the Register button dead ("BOT_BASE_URL not configured" / "token not
// set"). The queue needs no extra env var, and it gives officers a visible
// audit trail of who requested what + whether it succeeded.

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
  // OpenDKP CharacterId of the family root this character should be parented
  // under (the bot passes it as ParentId). null → ParentId 0 (self-rooted).
  parentOpenDkpId?: number | null;
  parentName?:      string | null;   // display only ("alt of Canopy")
  // Discord ID of the character's owner (the Mimic uploader). Target for the
  // claim DM. null → no DM target.
  uploaderDiscordId?: string | null;
  // Whether to DM the owner a claim link once the bot registers it.
  dmOwner?: boolean;
};

export async function registerInOpenDKP(args: RegisterArgs): Promise<{ ok: boolean; error?: string }> {
  // Auth gate: signed-in officer only.
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return { ok: false, error: 'not signed in' };
  const ok = await isOfficer(user.id);
  if (!ok) return { ok: false, error: 'officer role required' };

  // Reject the UNKNOWN sentinel — OpenDKP rejects it anyway, and a clear
  // "pick a class/race" beats a downstream failure row in the queue.
  if (!args.cls  || args.cls  === 'UNKNOWN') return { ok: false, error: 'class required — pick one before registering' };
  if (!args.race || args.race === 'UNKNOWN') return { ok: false, error: 'race required — pick one before registering' };
  if (!args.name) return { ok: false, error: 'name required' };
  if (!Number.isFinite(args.level)) return { ok: false, error: 'level required' };
  if (!args.rank) return { ok: false, error: 'rank required' };

  const admin = supabaseAdmin();

  // Officer's Discord ID — recorded so the queue shows who requested it.
  const { data: pack } = await admin
    .from('wolfpack_members')
    .select('discord_id')
    .eq('user_id', user.id)
    .maybeSingle();
  const requestedBy = pack?.discord_id || user.id;

  // Insert the queue row. The pending-unique index (guild_id, lower(name))
  // collapses a double-click into one row — treat that conflict as success.
  const { error } = await admin
    .from('opendkp_register_requests')
    .insert({
      guild_id:                'wolfpack',
      name:                    args.name,
      class:                   args.cls,
      race:                    args.race,
      level:                   args.level,
      rank:                    args.rank,
      parent_opendkp_id:       args.parentOpenDkpId ?? null,
      parent_name:             args.parentName ?? null,
      requested_by_discord_id: requestedBy,
      uploader_discord_id:     args.uploaderDiscordId ?? null,
      dm_owner:                args.dmOwner ?? true,
      status:                  'pending',
    });

  if (error) {
    // 23505 = unique violation on the pending index → already queued. That's
    // not an error from the officer's point of view.
    if ((error as { code?: string }).code === '23505') {
      revalidatePath('/admin/links');
      return { ok: true };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath('/admin/links');
  return { ok: true };
}
