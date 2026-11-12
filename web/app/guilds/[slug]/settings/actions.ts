'use server';

// Save a guild's settings (the guild lead, 2026-11-12). The access check is repeated here: a server action is its own public
// POST endpoint, so the page hiding the form from a member is a courtesy. The values are validated by validateSettings, the
// same function the form previews with. Every save writes an audit_log row naming the sections that moved, never the values.

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';
import { settingsActor } from '@/lib/guildSettingsAccess';
import { readGuildSettingsRow, forgetGuildSettings, validateSettings, DEFAULT_SETTINGS, type GuildSettings, type SettingsErrors } from '@/lib/guildSettingsLoad';

export type SettingsSaveResult =
  | { ok: true; message: string; values: GuildSettings }
  | { ok: false; message: string; errors?: SettingsErrors };

const SECTIONS = ['schedule', 'roles', 'jobs', 'dkp', 'guests', 'links'] as const;

export async function saveGuildSettings(slug: string, input: unknown): Promise<SettingsSaveResult> {
  const who = await settingsActor(String(slug));
  if (!who) return { ok: false, message: 'Only the guild’s owner or an officer can do that.' };
  const check = validateSettings(input);
  if (!check.ok) return { ok: false, message: 'Some settings need another look.', errors: check.errors };

  const before = (await readGuildSettingsRow(slug))?.settings ?? DEFAULT_SETTINGS;
  const admin = supabaseAdmin();
  const { error } = await admin.from('guild_settings').upsert({
    guild_id: slug,
    settings: check.values,
    updated_at: new Date().toISOString(),
    updated_by: who.discordId,
  }, { onConflict: 'guild_id' });
  if (error) return { ok: false, message: 'Could not save that just now. Try again in a minute.' };

  const changed = SECTIONS.filter(s => JSON.stringify(before[s]) !== JSON.stringify(check.values[s]));
  try {
    await admin.from('audit_log').insert({
      action: 'guild_settings_updated',
      actor_discord_id: who.discordId,
      actor_name: who.name,
      guild_id: slug,
      payload: { guild_id: slug, changed },
    });
  } catch { /* best effort: the settings are already saved */ }

  forgetGuildSettings(slug);
  revalidatePath(`/guilds/${slug}`);
  revalidatePath(`/guilds/${slug}/settings`);
  return { ok: true, message: 'Saved.', values: check.values };
}
