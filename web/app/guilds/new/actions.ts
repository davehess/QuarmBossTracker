'use server';

// Start a guild (the guild lead, 2026-10-31, DECISIONS §492; docs/DESIGN-raidmimic-hosted.md §4 wizard step 2). The rules
// (shape of the name, slug and Discord server id, the reserved slugs, the one-a-day limit) are web/lib/hubGuilds.ts; this
// wires them to the session and to the hub_* tables, the way web/app/guilds/actions.ts wires the invite rules.
// The creator is the SIGNED-IN player, taken from the session, never from an argument. On success this redirects to the new
// guild's page and never returns; every refusal comes back as a result the form shows.

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { discordIdOf } from '@/lib/lockout';
import { profileOf } from '@/lib/hubRegistry';
import {
  validateGuildInput, GUILD_MESSAGES, CREATE_LIMIT, CREATE_WINDOW_MS,
  type GuildInput, type GuildFields,
} from '@/lib/hubGuilds';

export type CreateGuildResult = { ok: false; message?: string; errors?: Partial<Record<GuildFields, string>> };

const NO = (message: string): CreateGuildResult => ({ ok: false, message });

export async function createGuild(input: GuildInput): Promise<CreateGuildResult> {
  const { data: { user } } = await supabaseServer().auth.getUser();
  const discordId = discordIdOf(user);
  if (!user || !discordId) return NO('Sign in first.');

  const check = validateGuildInput(input ?? {});
  if (!check.ok) return { ok: false, errors: check.errors };
  const { displayName, slug, discordGuildId, openJoin } = check.values;

  const admin = supabaseAdmin();

  // A player who signed in on wolfpack.quest has no hub_players row yet; one is made here (only the columns this sets are
  // written, so an existing row's deleted_at and created_at are never touched).
  const profile = profileOf(user);
  const { data: player, error: playerError } = await admin.from('hub_players')
    .upsert({ discord_id: discordId, display_name: profile.displayName, avatar_url: profile.avatarUrl, last_seen_at: new Date().toISOString() }, { onConflict: 'discord_id' })
    .select('player_id')
    .single();
  if (playerError || !player) return NO('The guild registry is not open yet.');

  // One guild a day per player, counted from the guilds themselves so it holds on every server instance.
  const since = new Date(Date.now() - CREATE_WINDOW_MS).toISOString();
  const { count, error: countError } = await admin.from('hub_guilds')
    .select('guild_id', { count: 'exact', head: true })
    .eq('created_by', player.player_id)
    .gte('created_at', since);
  if (countError) return NO('The guild registry is not open yet.');
  if ((count ?? 0) >= CREATE_LIMIT) return NO('You started a guild in the last 24 hours. One a day: try again tomorrow.');

  const { data: takenSlug, error: slugError } = await admin.from('hub_guilds').select('guild_id').eq('guild_id', slug).maybeSingle();
  if (slugError) return NO('Could not start the guild just now. Try again in a minute.');
  if (takenSlug) return { ok: false, errors: { slug: GUILD_MESSAGES.slugTaken } };

  if (discordGuildId) {
    const { data: takenDiscord, error: discordError } = await admin.from('hub_guilds').select('guild_id').eq('discord_guild_id', discordGuildId).maybeSingle();
    if (discordError) return NO('Could not start the guild just now. Try again in a minute.');
    if (takenDiscord) return { ok: false, errors: { discordGuildId: GUILD_MESSAGES.discordTaken } };
  }

  const { error: guildError } = await admin.from('hub_guilds').insert({
    guild_id: slug,
    display_name: displayName,
    plan: 'commons',
    open_join: openJoin,
    discord_guild_id: discordGuildId,
    created_by: player.player_id,
  });
  if (guildError) {
    // Somebody took the slug (or the Discord server) between the check and the insert: the unique keys decide.
    if (guildError.code === '23505') {
      return /discord/i.test(guildError.message ?? '')
        ? { ok: false, errors: { discordGuildId: GUILD_MESSAGES.discordTaken } }
        : { ok: false, errors: { slug: GUILD_MESSAGES.slugTaken } };
    }
    return NO('Could not start the guild just now. Try again in a minute.');
  }

  const { error: ownerError } = await admin.from('hub_memberships').insert({ guild_id: slug, player_id: player.player_id, role: 'owner' });
  if (ownerError) {
    // A guild with no owner can never be run: take it back so the address is free and the player can try again.
    await admin.from('hub_guilds').delete().eq('guild_id', slug);
    return NO('Could not start the guild just now. Try again in a minute.');
  }

  // The record of who started it. Best effort: the guild already exists, so a failed audit row never undoes it.
  try {
    await admin.from('audit_log').insert({
      action: 'hub_guild_created',
      actor_discord_id: discordId,
      actor_name: profile.displayName,
      guild_id: slug,
      payload: { guild_id: slug, open_join: openJoin, has_discord_server: discordGuildId !== null },
    });
  } catch { /* the audit helper is optional */ }

  revalidatePath('/guilds');
  redirect(`/guilds/${slug}`);
}
