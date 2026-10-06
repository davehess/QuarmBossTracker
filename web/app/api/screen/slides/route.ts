// /api/screen/slides: the deck the raid screen's Slides mode shows.
//
//   GET     members -> { slides: [{ id, position, title, body, imageUrl, updatedAt }] } in order
//   POST    officers only. Two shapes, both answer with the fresh { slides }:
//             { id?, title, body, imageUrl }   add a slide at the end, or edit the one named by `id`
//             { action: 'move', id, dir }      dir 'up' | 'down': swap the slide with its neighbour
//   DELETE  officers only: ?id=<slide id>. The rest close up, and if the slide that was up is gone the
//           screen's index is pulled back inside the deck.
//
// Limits (lib/raidScreen.ts): title 120, body 2,000, https image address, SLIDES_MAX slides. A body is plain
// text, never HTML: the page splits it into paragraphs and bullets and renders text nodes.
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { isOfficer } from '@/lib/officer';
import { SCREEN_GUILD, SLIDES_MAX, isUuid, moveId, parseSlideInput } from '@/lib/raidScreen';
import { listSlides, writeOrder } from '@/lib/raidScreenServer';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: NO_STORE });

export async function GET() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return fail(401, 'unauthorized');
  try {
    return NextResponse.json({ slides: await listSlides(supabaseAdmin()) }, { headers: NO_STORE });
  } catch {
    return fail(502, 'slides unavailable');
  }
}

export async function POST(req: Request) {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return fail(401, 'unauthorized');
  if (!(await isOfficer(user.id))) return fail(403, 'officers only');

  let body: unknown;
  try { body = await req.json(); } catch { return fail(400, 'send JSON'); }
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;

  try {
    const admin = supabaseAdmin();
    const deck = await listSlides(admin);
    const positions = new Map(deck.map(s => [s.id, s.position]));

    if (b.action === 'move') {
      if (!isUuid(b.id)) return fail(400, 'id is not a slide id');
      if (b.dir !== 'up' && b.dir !== 'down') return fail(400, "dir must be 'up' or 'down'");
      const moved = moveId(deck.map(s => s.id), b.id, b.dir);
      if (!moved) return fail(400, 'that slide cannot move that way');
      await writeOrder(admin, moved, positions);
      return NextResponse.json({ slides: await listSlides(admin) }, { headers: NO_STORE });
    }

    const parsed = parseSlideInput(body);
    if (!parsed.ok) return fail(400, parsed.error);
    const { id, title, body: text, imageUrl } = parsed.value;
    const now = new Date().toISOString();

    if (id) {
      if (!positions.has(id)) return fail(404, 'no such slide');
      const { error } = await admin.from('raid_screen_slides')
        .update({ title, body: text, image_url: imageUrl, updated_at: now })
        .eq('id', id).eq('guild_id', SCREEN_GUILD);
      if (error) return fail(502, 'slides unavailable');
    } else {
      if (deck.length >= SLIDES_MAX) return fail(400, `the deck is full (${SLIDES_MAX} slides)`);
      const { error } = await admin.from('raid_screen_slides')
        .insert({ guild_id: SCREEN_GUILD, position: deck.length, title, body: text, image_url: imageUrl, updated_at: now });
      if (error) return fail(502, 'slides unavailable');
    }
    return NextResponse.json({ slides: await listSlides(admin) }, { headers: NO_STORE });
  } catch {
    return fail(502, 'slides unavailable');
  }
}

export async function DELETE(req: Request) {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return fail(401, 'unauthorized');
  if (!(await isOfficer(user.id))) return fail(403, 'officers only');

  const id = new URL(req.url).searchParams.get('id');
  if (!isUuid(id)) return fail(400, 'id is not a slide id');

  try {
    const admin = supabaseAdmin();
    const deck = await listSlides(admin);
    if (!deck.some(s => s.id === id)) return fail(404, 'no such slide');

    const { error } = await admin.from('raid_screen_slides').delete().eq('id', id).eq('guild_id', SCREEN_GUILD);
    if (error) return fail(502, 'slides unavailable');

    const rest = deck.filter(s => s.id !== id);
    await writeOrder(admin, rest.map(s => s.id), new Map(rest.map(s => [s.id, s.position])));

    // The slide that was up may have been the last one: keep the screen's index inside the deck. Only the
    // index moves; "Driving" still names whoever last drove.
    const last = Math.max(0, rest.length - 1);
    await admin.from('raid_screen_state').update({ slide_index: last }).eq('guild_id', SCREEN_GUILD).gt('slide_index', last);

    return NextResponse.json({ slides: await listSlides(admin) }, { headers: NO_STORE });
  } catch {
    return fail(502, 'slides unavailable');
  }
}
