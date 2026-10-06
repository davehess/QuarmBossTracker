// /api/screen/state: what the raid screen is showing, and who changed it last.
//
//   GET   members (signed in, the same gate as /api/spectator/positions)
//         -> { mode, slideIndex, slide, slideCount, updatedBy, updatedAt }
//         `slide` is the slide that is up, only while mode is 'slides'; the index is clamped to the deck.
//   POST  officers only (lib/officer.ts isOfficer): { mode?, slideIndex? } sets what everyone sees and
//         stamps "Driving: <name>". An out-of-range index is a 400, not a clamp (lib/raidScreen.ts).
//
// Nothing here is cached: the page polls it every few seconds and must see the leader's last click.
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { isOfficer } from '@/lib/officer';
import { SCREEN_GUILD, parseStateInput } from '@/lib/raidScreen';
import { driverName, loadScreenState, slideIds } from '@/lib/raidScreenServer';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: NO_STORE });

export async function GET() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return fail(401, 'unauthorized');
  try {
    return NextResponse.json(await loadScreenState(supabaseAdmin()), { headers: NO_STORE });
  } catch {
    return fail(502, 'screen unavailable');
  }
}

export async function POST(req: Request) {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return fail(401, 'unauthorized');
  if (!(await isOfficer(user.id))) return fail(403, 'officers only');

  let body: unknown;
  try { body = await req.json(); } catch { return fail(400, 'send JSON'); }

  try {
    const admin = supabaseAdmin();
    const ids = await slideIds(admin);
    const parsed = parseStateInput(body, ids.length);
    if (!parsed.ok) return fail(400, parsed.error);

    const { mode, slideIndex } = parsed.value;
    const { error } = await admin.from('raid_screen_state').upsert({
      guild_id: SCREEN_GUILD,
      ...(mode !== undefined ? { mode } : {}),
      ...(slideIndex !== undefined ? { slide_index: slideIndex } : {}),
      updated_by: await driverName(admin, user),
      updated_by_id: user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'guild_id' });
    if (error) return fail(502, 'screen unavailable');

    return NextResponse.json(await loadScreenState(admin), { headers: NO_STORE });
  } catch {
    return fail(502, 'screen unavailable');
  }
}
