// The hub directory Mimic's guild picker reads (apps/mimic/hubs.js; DECISIONS §475, §490).
//
// A list of the guilds a raider can point Mimic at: Wolf Pack first and fixed (so an install that never picks sees no
// change), then every registered guild that is not suspended and has somewhere to talk to. The hosted bot is one
// shared process for the commons (and a managed guild until it gets its own), so a 'commons' or 'managed' guild's url is
// that bot's; a 'self_hosted' guild answers at its own self_host_url. Public by design: it names guilds that chose to be
// listed and a bot address, nothing about their members.

import { GUILD_NAME, GUILD_TAG, PROD_SITE_URL } from '@/lib/guild';

export const WOLFPACK_BOT_URL = 'https://wolfpackparse.up.railway.app';

export interface HubGuildRow {
  guild_id: string;
  display_name: string;
  plan: string;
  self_host_url: string | null;
  suspended_at?: string | null;
}

export interface HubEntry {
  slug: string;
  display_name: string;
  plan?: string;
  url: string;
  site?: string;
}

/** An https origin, or '' (http is allowed for a machine's own loopback only, so a guild can try its server first). */
export function httpsOrigin(raw: string | null | undefined): string {
  try {
    const u = new URL(String(raw ?? ''));
    const loop = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loop)) return '';
    if (u.username || u.password) return '';
    return u.origin;
  } catch { return ''; }
}

export function buildHubDirectory(rows: HubGuildRow[] | null | undefined, hostedBotUrl?: string | null): HubEntry[] {
  const hosted = httpsOrigin(hostedBotUrl) || WOLFPACK_BOT_URL;
  const out: HubEntry[] = [{ slug: GUILD_TAG, display_name: GUILD_NAME, url: WOLFPACK_BOT_URL, site: PROD_SITE_URL }];
  for (const r of rows ?? []) {
    if (!r || r.suspended_at || !r.guild_id || r.guild_id === GUILD_TAG) continue;
    const url = r.plan === 'self_hosted' ? httpsOrigin(r.self_host_url) : hosted;
    if (!url) continue;
    out.push({ slug: r.guild_id, display_name: r.display_name || r.guild_id, plan: r.plan, url });
  }
  return out;
}
