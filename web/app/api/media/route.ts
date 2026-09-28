// GET /api/media — guild media for signed-in members (web/lib/guildMedia.ts).
//   ?section=take&collection=aten-ha-ra[&offset=n]  -> { items, total }: one section, signed links
//   ?character=<name>[&collection=...]              -> { items, total }: one character's gallery
//   ?id=<n>                                          -> { prompt, model, resolution }: how one file was made
// Never the whole store in one call: a section or a character is required.
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { isCharacterName, isSection } from '@/lib/guildMedia';
import { loadMedia, mediaInfo } from '@/lib/guildMediaLoad';

export const dynamic = 'force-dynamic';

const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });

export async function GET(req: Request) {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return bad('sign in first', 401);

  const u = new URL(req.url);
  const cache = { headers: { 'Cache-Control': 'private, max-age=1800' } };
  if (u.searchParams.has('id')) {
    const id = Number(u.searchParams.get('id'));
    if (!Number.isInteger(id) || id <= 0) return bad('bad id');
    const info = await mediaInfo(id);
    return info ? NextResponse.json(info, cache) : bad('not found', 404);
  }

  const section = u.searchParams.get('section');
  const character = u.searchParams.get('character');
  const collection = u.searchParams.get('collection');
  if (section !== null && !isSection(section)) return bad('bad section');
  if (character !== null && !isCharacterName(character)) return bad('bad character');
  if (collection !== null && !/^[a-z0-9-]{1,40}$/.test(collection)) return bad('bad collection');
  if (!section && !character) return bad('a section or a character is required');
  const offset = Math.min(10000, Math.max(0, Number(u.searchParams.get('offset')) || 0));
  return NextResponse.json(await loadMedia({ collection, section, character }, { offset, limit: 200 }), cache);
}
