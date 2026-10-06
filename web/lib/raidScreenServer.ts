// /screen: the reads and writes the three /api/screen routes share. Server only (it takes the service client).
//
// Every read here is bounded for the 1,000-row cap and test/db-read-discipline-web.test.js: the deck is at
// most SLIDES_MAX rows and is read with an explicit limit, the state is one row, a member is one row.
import type { SupabaseClient, User } from '@supabase/supabase-js';
import {
  SCREEN_GUILD, SLIDES_MAX, buildScreenState, toScreenSlide,
  type ScreenSlide, type ScreenState,
} from '@/lib/raidScreen';

type Db = SupabaseClient;

const SLIDE_COLS = 'id, position, title, body, image_url, updated_at';
// A little over SLIDES_MAX: rows past the cap (hand-edited in) still show up in the editor and can be deleted.
const DECK_READ_LIMIT = SLIDES_MAX + 20;

type DeckRow = { id: string; position: number | null; title: string | null; body: string | null; image_url: string | null; updated_at: string | null };

/** The whole deck in order. */
export async function listSlides(db: Db): Promise<ScreenSlide[]> {
  const { data, error } = await db.from('raid_screen_slides')
    .select(SLIDE_COLS)
    .eq('guild_id', SCREEN_GUILD)
    .order('position', { ascending: true })
    .order('id', { ascending: true })
    .limit(DECK_READ_LIMIT);
  if (error) throw new Error(error.message);
  return ((data ?? []) as DeckRow[]).map(toScreenSlide);
}

/** The deck's ids in order (a few dozen small rows): how many slides there are, and which one is at an index. */
export async function slideIds(db: Db): Promise<string[]> {
  const { data, error } = await db.from('raid_screen_slides')
    .select('id')
    .eq('guild_id', SCREEN_GUILD)
    .order('position', { ascending: true })
    .order('id', { ascending: true })
    .limit(DECK_READ_LIMIT);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string }[]).map(r => r.id);
}

/** The state the page polls: the row, the deck's size, and (only in Slides mode) the slide that is up. */
export async function loadScreenState(db: Db): Promise<ScreenState> {
  const [st, ids] = await Promise.all([
    db.from('raid_screen_state')
      .select('mode, slide_index, updated_by, updated_at')
      .eq('guild_id', SCREEN_GUILD)
      .maybeSingle(),
    slideIds(db),
  ]);
  if (st.error) throw new Error(st.error.message);
  const base = buildScreenState(st.data, ids.length, null);
  if (base.mode !== 'slides' || !ids.length) return base;
  const { data, error } = await db.from('raid_screen_slides')
    .select(SLIDE_COLS)
    .eq('id', ids[base.slideIndex])
    .maybeSingle();
  if (error) throw new Error(error.message);
  return buildScreenState(st.data, ids.length, data ? toScreenSlide(data as DeckRow) : null);
}

/**
 * "Driving: <name>": the signed-in officer's server nickname, else their Discord name. The member row is
 * found by auth user id, then by the Discord id on their sign-in (most rows have no user id stamped yet:
 * see components/AuthBadge.tsx). Service client only, and only ever the caller's own row.
 */
export async function driverName(db: Db, user: Pick<User, 'id' | 'user_metadata'>): Promise<string> {
  const pick = (r: { nickname?: string | null; global_name?: string | null } | null | undefined) =>
    r?.nickname || r?.global_name || null;
  const byUser = await db.from('wolfpack_members').select('nickname, global_name').eq('user_id', user.id).maybeSingle();
  let name = pick(byUser.data);
  if (!name) {
    const meta = (user.user_metadata || {}) as { provider_id?: string; sub?: string };
    const did = meta.provider_id || meta.sub || null;
    if (did) {
      const byDiscord = await db.from('wolfpack_members').select('nickname, global_name').eq('discord_id', did).maybeSingle();
      name = pick(byDiscord.data);
    }
  }
  return (name || 'An officer').slice(0, 60);
}

/**
 * Put the deck in `ids` order: position = place in the list, writing only the rows that moved. After every
 * add, delete and move the positions are 0..n-1 again, so "slide N" is the same slide for everyone.
 */
export async function writeOrder(db: Db, ids: string[], current: Map<string, number>): Promise<void> {
  const moves = ids.map((id, i) => ({ id, i })).filter(m => current.get(m.id) !== m.i);
  const results = await Promise.all(moves.map(m =>
    db.from('raid_screen_slides').update({ position: m.i }).eq('id', m.id).eq('guild_id', SCREEN_GUILD)));
  const failed = results.find(r => r.error);
  if (failed?.error) throw new Error(failed.error.message);
}
