// A guild's settings, server half: read the row, merge it over the defaults, keep it for a minute.
//
// The rules (shape, validation, the schedule helpers) are guildSettings.ts so the settings form can share them in the
// browser; this file adds the one read. Same shape as guildTheme.ts: a 60 s in-process copy, so a warm instance reads the
// table about once a minute; a save drops this instance's copy, other instances catch up within the minute. A failed read
// never throws: the last good copy is kept, and a cold start falls back to the defaults, or to Wolf Pack's seed for the
// built-in guild (so the home guild keeps working before the table exists).

import { supabaseAdmin } from './supabase';
import { GUILD_TAG } from './guild';
import { DEFAULT_SETTINGS, WOLFPACK_SEED, mergeSettings, type GuildSettings } from './guildSettings';

export * from './guildSettings';

const TTL_MS = 60_000;
const _memo = new Map<string, { at: number; settings: GuildSettings }>();

const fallbackFor = (guildId: string): GuildSettings => structuredClone(guildId === GUILD_TAG ? WOLFPACK_SEED : DEFAULT_SETTINGS);

export type StoredSettings = { settings: GuildSettings; saved: boolean; updatedBy: string | null; updatedAt: string | null };

// The row as it stands, uncached. Returns null when the read failed (so a caller can tell "no row yet" from "could not look").
export async function readGuildSettingsRow(guildId: string): Promise<StoredSettings | null> {
  try {
    const { data, error } = await supabaseAdmin()
      .from('guild_settings')
      .select('settings, updated_by, updated_at')
      .eq('guild_id', guildId)
      .maybeSingle();
    if (error) return null;
    if (!data) return { settings: fallbackFor(guildId), saved: false, updatedBy: null, updatedAt: null };
    return { settings: mergeSettings(data.settings), saved: true, updatedBy: data.updated_by ?? null, updatedAt: data.updated_at ?? null };
  } catch {
    return null;
  }
}

export async function readGuildSettings(guildId: string = GUILD_TAG): Promise<GuildSettings> {
  const hit = _memo.get(guildId);
  if (hit && Date.now() - hit.at < TTL_MS) return structuredClone(hit.settings);
  const fresh = await readGuildSettingsRow(guildId);
  if (fresh) {
    _memo.set(guildId, { at: Date.now(), settings: fresh.settings });
    return structuredClone(fresh.settings);
  }
  // Could not read: serve the last good copy (or the fallback on a cold start) and look again in 10 s, not on every request.
  const settings = hit?.settings ?? fallbackFor(guildId);
  _memo.set(guildId, { at: Date.now() - TTL_MS + 10_000, settings });
  return structuredClone(settings);
}

// After an officer saves: drop this instance's copy so the next read goes to the table.
export function forgetGuildSettings(guildId: string): void {
  _memo.delete(guildId);
}
