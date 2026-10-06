// /api/screen/slides: the deck the raid screen's Slides mode shows.
//
//   GET     members -> { slides: [{ id, position, title, body, imageUrl, updatedAt }] } in order
//   POST    officers only. Two shapes, both answer with the fresh { slides }:
//             { id?, title, body, imageUrl }   add a slide at the end, or edit the one named by `id`
//             { action: 'move', id, dir }      dir 'up' | 'down': swap the slide with its neighbour
//   DELETE  officers only: ?id=<slide id>. The rest close up.
//
// The screen stores which slide is up as a position (raid_screen_state.slide_index), so a move or a delete
// carries that position to wherever the slide that was up now sits, in the same request and before the fresh
// deck is answered: editing the deck never changes what the raid is looking at. If the slide that was up is
// the one deleted, the screen stays at the same place (the next slide), pulled back to the last one.
//
// Limits (lib/raidScreen.ts): title 120, body 2,000, https image address, SLIDES_MAX slides. A body is plain
// text, never HTML: the page splits it into paragraphs and bullets and renders text nodes.
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { isOfficer } from '@/lib/officer';
import { SCREEN_GUILD, SLIDES_MAX, isUuid, moveId, parseSlideInput } from '@/lib/raidScreen';
import { keepSlideUp, listSlides, readSlideIndex, writeOrder } from '@/lib/raidScreenServer';

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
      const before = deck.map(s => s.id);
      const moved = moveId(before, b.id, b.dir);
      if (!moved) return fail(400, 'that slide cannot move that way');
      const was = await readSlideIndex(admin);
      await writeOrder(admin, moved, positions);
      await keepSlideUp(admin, was, before, moved);
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

    const was = await readSlideIndex(admin);
    const { error } = await admin.from('raid_screen_slides').delete().eq('id', id).eq('guild_id', SCREEN_GUILD);
    if (error) return fail(502, 'slides unavailable');

    const rest = deck.filter(s => s.id !== id);
    await writeOrder(admin, rest.map(s => s.id), new Map(rest.map(s => [s.id, s.position])));

    // The screen keeps showing the slide that was up (at its new place); if that one was deleted it stays at
    // the same place, pulled back inside the deck.
    await keepSlideUp(admin, was, deck.map(s => s.id), rest.map(s => s.id));

    return NextResponse.json({ slides: await listSlides(admin) }, { headers: NO_STORE });
  } catch {
    return fail(502, 'slides unavailable');
  }
}
