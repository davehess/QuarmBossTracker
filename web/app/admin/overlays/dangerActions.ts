'use server';

// The writes behind /admin/overlays' Danger zone (the guild lead, 2026-10-31, DECISIONS §493): the fleet pause, every
// shed flag and the version floor. They used to be checkboxes inside the "Save tuning" form, one stray Save from a paused
// fleet. Now each is its own form, and SETTING one needs the typed phrase (lib/adminTyped.ts), checked here on the server.
// CLEARING one never asks: taking a lever back must always be easier than pulling it (the console's rule, console/actions.ts).
//
// Same read-modify-write as the console's `_writeKey` and the tuning form's save: only the named key (and its
// `flag_set_at_<key>` stamp, which the console's drift panel ages) changes, so nothing else in the tuning map is lost.
// Every outcome redirects back to #danger with a code the page words, so a refusal is seen, not swallowed.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { isOfficer } from '@/lib/officer';
import { GUILD_TAG } from '@/lib/guild';
import { actorName } from '@/lib/actorName';
import { setAtKey } from '@/lib/consoleHealth';
import { DANGER_FLAG_KEYS, VERSION_FLOOR_KEY, dangerPhrase, typedConfirmOk } from '@/lib/adminTyped';

const back = (code: string, key: string): never =>
  redirect(`/admin/overlays?danger=${encodeURIComponent(code)}&k=${encodeURIComponent(key)}#danger`);

/**
 * One Danger-zone control: `key` (a danger flag or the version floor), `mode` (`set` or `clear`), and for `set` the
 * typed `confirm` phrase (plus `value` for the floor, a positive whole number: major*10000 + minor*100 + patch).
 */
export async function applyDangerControl(formData: FormData): Promise<void> {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user || !(await isOfficer(user.id))) redirect('/?error=admin_required');

  const key = String(formData.get('key') ?? '');
  const mode = String(formData.get('mode') ?? '');
  const isFloor = key === VERSION_FLOOR_KEY;
  if (!isFloor && !DANGER_FLAG_KEYS.includes(key)) return back('unknown', key);
  if (mode !== 'set' && mode !== 'clear') return back('unknown', key);

  let value: number | null = null;
  if (mode === 'set') {
    if (!typedConfirmOk(formData.get('confirm'), dangerPhrase(key))) return back('wrong-phrase', key);
    if (isFloor) {
      const n = Number(String(formData.get('value') ?? '').trim());
      if (!Number.isInteger(n) || n <= 0) return back('bad-value', key);
      value = n;
    } else {
      value = 1;
    }
  }

  const sb = supabaseAdmin();
  const { data: row } = await sb.from('overlay_tuning').select('tuning').eq('guild_id', GUILD_TAG).maybeSingle();
  const tuning: Record<string, unknown> = { ...((row?.tuning as Record<string, unknown>) ?? {}) };
  if (value === null) {
    delete tuning[key];
    delete tuning[setAtKey(key)];
  } else {
    tuning[key] = value;
    tuning[setAtKey(key)] = new Date().toISOString();
  }
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const { error } = await sb.from('overlay_tuning').upsert({
    guild_id: GUILD_TAG,
    tuning,
    updated_by_discord_id: (user.app_metadata?.provider_id || meta.provider_id || null) as string | null,
    updated_by_name: actorName(user),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'guild_id' });
  if (error) return back('write-failed', key);

  revalidatePath('/admin/overlays');
  revalidatePath('/admin/console');
  return back(mode === 'set' ? 'set' : 'cleared', key);
}
