'use server';

// #87 — officer console writes.
//
// The console MIRRORS the control plane, it does not own it. Every write is the
// SAME read-modify-write on overlay_tuning.tuning that /admin/overlays'
// saveOverlayTuning and the bot's POST /api/agent/flag-override already do, so
// all three surfaces (web tuning editor, Mimic 🛡 Admin tab, this console) stay
// consistent and no key ever gets silently wiped.
//
// Safety classes (docs/DESIGN-87-officer-console.md §5.5):
//   Class A — CLEAR a control key. One click, no confirm. Clearing a mitigation
//             must always be easier than setting one.
//   Class B — SET a fleet-scale lever. Requires a typed confirmation phrase.
//   Class C — not here at all (bulk trigger edits, data repair, deploys).
//
// The bot's own whitelist (_FLAG_OVERRIDE_KEYS) is the outer boundary; this
// module's CLEARABLE/SETTABLE sets are a deliberately NARROWER subset of it.

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { isOfficer } from '@/lib/officer';
import { isControlKey, setAtKey } from '@/lib/consoleHealth';

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

// Class B confirmation phrases. Typed exactly, case-sensitive.
export const CONFIRM_PHRASES: Record<string, string> = {
  flag_agent_kill: 'PAUSE FLEET',
};

// Class B: the only keys the console will SET (as opposed to clear). Everything
// else is set from /admin/overlays or the Mimic Admin tab, which is where the
// full catalog with its long-form descriptions lives.
const SETTABLE = new Set<string>([
  'flag_agent_kill',
  'flag_shed_live_state',
  'flag_shed_raid_roster',
  'flag_shed_casting',
  'flag_shed_threat_snapshot',
  'flag_shed_buff_casts',
  'flag_raid_hold',
  'dedup_chat',
]);

async function _officer() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return null;
  if (!(await isOfficer(user.id))) return null;
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  return {
    user,
    display: String(
      meta.full_name || meta.name || meta.preferred_username || meta.email || 'officer',
    ),
    discordId: (user.app_metadata?.provider_id || meta.provider_id || null) as string | null,
  };
}

/**
 * Read-modify-write one key on overlay_tuning.tuning. `value === null` deletes
 * the key (= back to the compiled default). Everything not named is preserved —
 * the wholesale rebuild that used to wipe out-of-band keys is the bug this
 * pattern exists to avoid.
 */
async function _writeKey(key: string, value: number | null, who: { display: string; discordId: string | null }) {
  const sb = supabaseAdmin();
  const { data: row } = await sb
    .from('overlay_tuning').select('tuning').eq('guild_id', 'wolfpack').maybeSingle();
  const tuning: Record<string, unknown> = { ...((row?.tuning as Record<string, unknown>) ?? {}) };

  // The companion `flag_set_at_<key>` stamp is what lets the drift panel show an
  // age and nag past 7 days (a mitigation nobody reverted is a feature quietly
  // disabled — dedup_chat sat at 0 for a fortnight). Zero-migration: an extra
  // string key rides the same jsonb and every other consumer ignores it.
  if (value === null) {
    delete tuning[key];
    delete tuning[setAtKey(key)];
  } else {
    tuning[key] = value;
    tuning[setAtKey(key)] = new Date().toISOString();
  }

  const { error } = await sb.from('overlay_tuning').upsert({
    guild_id: 'wolfpack',
    tuning,
    updated_by_discord_id: who.discordId,
    updated_by_name: who.display,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'guild_id' });
  return error?.message ?? null;
}

/** Class A — clear a control-plane override. One click, no confirmation. */
export async function clearOverride(key: string): Promise<ActionResult> {
  const who = await _officer();
  if (!who) return { ok: false, error: 'Not authorized — officer role required.' };
  if (!isControlKey(key)) {
    // Numeric overlay knobs and config keys are edited on /admin/overlays; the
    // console must never be able to delete one by mistake.
    return { ok: false, error: `"${key}" is not a control-plane key — edit it on /admin/overlays.` };
  }
  const err = await _writeKey(key, null, who);
  if (err) return { ok: false, error: err };
  revalidatePath('/admin/console');
  revalidatePath('/admin/overlays');
  return { ok: true, message: `Cleared ${key}. The bot picks this up within ~60s; agents within ~90s.` };
}

/**
 * Class B — set a control-plane lever. Requires the typed confirmation phrase
 * when the key has one (flag_agent_kill silences the entire fleet).
 */
export async function setOverride(key: string, value: number, confirm: string): Promise<ActionResult> {
  const who = await _officer();
  if (!who) return { ok: false, error: 'Not authorized — officer role required.' };
  if (!SETTABLE.has(key)) {
    return { ok: false, error: `"${key}" is not settable from the console — use /admin/overlays or the Mimic Admin tab.` };
  }
  if (!Number.isFinite(value)) return { ok: false, error: 'Value must be a number.' };
  const phrase = CONFIRM_PHRASES[key];
  if (phrase && confirm !== phrase) {
    return { ok: false, error: `Type "${phrase}" exactly to confirm — this one affects every agent in the guild.` };
  }
  const err = await _writeKey(key, value >= 1 ? 1 : 0, who);
  if (err) return { ok: false, error: err };
  revalidatePath('/admin/console');
  revalidatePath('/admin/overlays');
  return { ok: true, message: `Set ${key} = ${value >= 1 ? 1 : 0}. Live in ~60s. Clear it as soon as the incident is over.` };
}
