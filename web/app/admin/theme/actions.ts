'use server';

// /admin/theme server actions: an officer saves the guild theme, or resets it to today's values. The page is
// gated by the /admin layout and requireOfficer(), but a server action is its own public POST endpoint, so each
// one starts at requireOfficer() again and validates what it was handed: the editor's own checks are a courtesy.
// Every save writes an audit_log row ('guild_theme_updated') naming which slots moved.

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';
import { requireOfficer } from '@/lib/officer';
import { GUILD_TAG } from '@/lib/guild';
import {
  DEFAULT_THEME, THEME_SLOTS, normalizeStoredTheme, themeToRow, validateThemeInput, forgetGuildTheme,
  type GuildTheme, type ThemeErrors,
} from '@/lib/guildTheme';

export type SaveResult =
  | { ok: true; theme: GuildTheme; changed: string[] }
  | { ok: false; error?: string; errors?: ThemeErrors };

async function actorOf(userId: string) {
  const { data } = await supabaseAdmin()
    .from('wolfpack_members')
    .select('discord_id, nickname, global_name')
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) return null;
  const d = data as { discord_id: string; nickname?: string | null; global_name?: string | null };
  return { discordId: String(d.discord_id), name: d.nickname?.trim() || d.global_name?.trim() || String(d.discord_id) };
}

// Which parts differ between two themes, for the audit row. Names only, never values.
function diff(a: GuildTheme, b: GuildTheme): string[] {
  const out: string[] = THEME_SLOTS.filter(s => a.slots[s] !== b.slots[s]);
  if (a.logoUrl !== b.logoUrl) out.push('logo');
  if (a.font !== b.font) out.push('font');
  if (a.embedColor !== b.embedColor) out.push('embed');
  return out;
}

async function write(theme: GuildTheme, action: 'save' | 'reset'): Promise<SaveResult> {
  const userId = await requireOfficer();
  const actor = await actorOf(userId);
  if (!actor) return { ok: false, error: 'Your member record was not found, so the change cannot be attributed to you.' };

  const admin = supabaseAdmin();
  const { data: before } = await admin
    .from('guild_theme')
    .select('slots, logo_url, font, embed_color')
    .eq('guild_id', GUILD_TAG)
    .maybeSingle();

  const { error } = await admin.from('guild_theme').upsert({
    guild_id:   GUILD_TAG,
    ...themeToRow(theme),
    updated_at: new Date().toISOString(),
    updated_by: actor.discordId,
  }, { onConflict: 'guild_id' });
  if (error) return { ok: false, error: 'The theme could not be saved. Try again in a moment.' };

  const changed = diff(before ? normalizeStoredTheme(before) : DEFAULT_THEME, theme);
  await admin.from('audit_log').insert({
    action:           'guild_theme_updated',
    actor_discord_id: actor.discordId,
    actor_name:       actor.name,
    payload:          { mode: action, changed },
  });

  forgetGuildTheme(GUILD_TAG);
  revalidatePath('/admin/theme');
  return { ok: true, theme, changed };
}

export async function saveGuildTheme(input: unknown): Promise<SaveResult> {
  await requireOfficer();
  const v = validateThemeInput(input);
  if (!v.ok) return { ok: false, errors: v.errors };
  return write(v.theme, 'save');
}

export async function resetGuildTheme(): Promise<SaveResult> {
  await requireOfficer();
  return write(DEFAULT_THEME, 'reset');
}
