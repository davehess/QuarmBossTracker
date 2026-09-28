// The Aten Ha Ra film (the guild lead, 2026-09-27: the film goes on YouTube; the raider clips stay
// members-only on the site). The takes and their YouTube links live in bot_kv `film_youtube`, not in
// the repo: the repo is public, and a link arriving later is a data change, not a deploy.

export type FilmTake = { key: string; title: string; length: string; youtube: string | null; poster: string };

const POSTERS: Record<string, string> = {
  regular: '/film/wolfpack-rise.jpg',
  remix: '/film/wolfpack-rise-remix.jpg',
};
const ID_RX = /^[A-Za-z0-9_-]{11}$/;

// A YouTube video id from whatever was pasted: the bare 11-character id, or a watch?v=, youtu.be/,
// /shorts/, /embed/ or /live/ link. Anything else is null, never a guess.
export function youtubeId(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (ID_RX.test(s)) return s;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  const host = u.hostname.replace(/^(?:www\.|m\.)/, '');
  let id: string | null = null;
  if (host === 'youtu.be') {
    id = u.pathname.slice(1).split('/')[0] || null;
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'music.youtube.com') {
    id = u.searchParams.get('v') || (u.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/) || [])[1] || null;
  }
  return id && ID_RX.test(id) ? id : null;
}

// The bot_kv value -> the takes, in their stored order. A malformed entry is dropped, never thrown on.
export function parseFilm(value: unknown): FilmTake[] {
  const takes = (value as { takes?: unknown } | null)?.takes;
  if (!Array.isArray(takes)) return [];
  return takes.flatMap((t) => {
    const r = (t ?? {}) as Record<string, unknown>;
    if (typeof r.key !== 'string' || typeof r.title !== 'string') return [];
    return [{
      key: r.key,
      title: r.title,
      length: typeof r.length === 'string' ? r.length : '',
      youtube: youtubeId(r.youtube),
      poster: POSTERS[r.key] || POSTERS.regular,
    }];
  });
}
