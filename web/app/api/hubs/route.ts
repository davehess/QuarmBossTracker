// GET /api/hubs — the guild directory Mimic's guild picker reads (public, cached 5 minutes).
//
// Mimic asks https://raidmimic.com/api/hubs until the hosted bot serves its own directory. The shape is
// [{ slug, display_name, plan?, url, site? }], Wolf Pack first; web/lib/hubDirectory.ts builds it. hub_guilds has RLS on
// and no policies (the service role reads it), so the read is server-side only and selects just the columns the list needs.
// Any failure still answers the fixed Wolf Pack entry: a picker that cannot reach its directory must keep today's install working.
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { buildHubDirectory, type HubGuildRow } from '@/lib/hubDirectory';

export const revalidate = 300;

const HEADERS = { 'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600' };

export async function GET() {
  let rows: HubGuildRow[] = [];
  try {
    const { data, error } = await supabaseAdmin()
      .from('hub_guilds')
      .select('guild_id, display_name, plan, self_host_url, suspended_at')
      .is('suspended_at', null)
      .order('guild_id')
      .limit(500);
    if (!error && Array.isArray(data)) rows = data as HubGuildRow[];
  } catch { /* fall through to the fixed entry */ }
  return NextResponse.json(buildHubDirectory(rows, process.env.HUB_BOT_URL), { headers: HEADERS });
}
