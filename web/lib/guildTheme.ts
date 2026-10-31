// The guild theme, server half: read the row, hand the root layout something it can emit.
//
// The pure rules (slots, validation, hex -> triplet, the CSS variables) live in guildThemeCore.ts so the
// /admin/theme editor can share them in the browser; this file re-exports them and adds the one read.
//
// COST. The root layout already runs per request (it reads the session), so this adds no dynamic rendering. It
// adds one tiny read (four columns, one row) behind a 60 s in-process copy, so a warm server instance reads the
// table about once a minute, not once a page (no React cache(): the root test run has no web/node_modules, and
// the TTL already dedupes a request's renders). A
// theme change therefore reaches every page within a minute; the editor reads the table directly so an
// officer sees their own save at once. A failed read keeps the last good theme (and falls back to today's
// values on a cold start): a Supabase blip must never repaint, or blank, the site.

import { supabaseAdmin } from './supabase';
import { GUILD_TAG } from './guild';
import { DEFAULT_THEME, normalizeStoredTheme, type GuildTheme } from './guildThemeCore';

export * from './guildThemeCore';

const TTL_MS = 60_000;
const _memo = new Map<string, { at: number; theme: GuildTheme }>();

// The row as it stands, uncached. Returns null when the read failed (so a caller can tell "no row yet", which
// is today's values, from "could not look").
export async function readGuildTheme(guildId: string = GUILD_TAG): Promise<GuildTheme | null> {
  try {
    const { data, error } = await supabaseAdmin()
      .from('guild_theme')
      .select('slots, logo_url, font, embed_color')
      .eq('guild_id', guildId)
      .maybeSingle();
    if (error) return null;
    return data ? normalizeStoredTheme(data) : DEFAULT_THEME;
  } catch {
    return null;
  }
}

export async function loadGuildTheme(guildId: string = GUILD_TAG): Promise<GuildTheme> {
  const hit = _memo.get(guildId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.theme;
  const fresh = await readGuildTheme(guildId);
  if (fresh) {
    _memo.set(guildId, { at: Date.now(), theme: fresh });
    return fresh;
  }
  // Could not read: serve the last good copy (or today's values on a cold start) and look again in 10 s, not on
  // every request.
  const theme = hit?.theme ?? DEFAULT_THEME;
  _memo.set(guildId, { at: Date.now() - TTL_MS + 10_000, theme });
  return theme;
}

// After an officer saves: drop this instance's copy so the next render re-reads.
export function forgetGuildTheme(guildId: string = GUILD_TAG): void {
  _memo.delete(guildId);
}
