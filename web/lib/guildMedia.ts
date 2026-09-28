// Guild media: pictures and clips of our characters, kept long-term (the guild lead, 2026-09-28: "a gallery
// available for our players on their character pages ... longterm storage"). The files sit in the private
// `guild-media` bucket, indexed by the `guild_media` table; pages get short-lived signed links from the
// server (web/lib/guildMediaLoad.ts). Everything here is pure, so the tests can run it.
//
// The Aten Ha Ra film was the first set in. Its facts (how each name is said, when each take sings it,
// the lyric sheet) live in bot_kv `film_making`, not in the repo: the repo is public and they name raiders.

export const MEDIA_BUCKET = 'guild-media';

export type MediaItem = {
  id: number;
  section: string;
  character: string | null;
  kind: 'image' | 'video';
  title: string | null;
  used: boolean;
  thumbUrl: string | null;
  url: string | null;
  name: string;               // the file name a download is saved as
};

// Every section a set can have, in the order a character's gallery shows them: its heading, and what
// one item of it is called.
export const SECTIONS: { key: string; label: string; one: string }[] = [
  { key: 'clip', label: 'Clips', one: 'Clip' },
  { key: 'song-clip', label: 'Clips with the song', one: 'Clip with the song' },
  { key: 'action-still', label: 'Action stills', one: 'Action still' },
  { key: 'first-still', label: 'First stills', one: 'First still' },
  { key: 'take', label: 'Animation takes', one: 'Animation take' },
  { key: 'cold-open', label: 'The cold open', one: 'Cold open' },
  { key: 'class-intro', label: 'Class intros', one: 'Class intro' },
  { key: 'opening-ending', label: 'Opening and ending', one: 'Opening or ending' },
  { key: 'transition', label: 'Transitions', one: 'Transition' },
  { key: 'cut', label: 'Earlier cuts', one: 'Earlier cut' },
  { key: 'test', label: 'Early tests', one: 'Early test' },
  { key: 'cover', label: 'Covers', one: 'Cover' },
  { key: 'film', label: 'The film', one: 'The film' },
];
const SECTION_KEYS = new Set(SECTIONS.map((s) => s.key));
const ORDER = new Map(SECTIONS.map((s, i) => [s.key, i]));
export const sectionLabel = (key: string) => SECTIONS.find((s) => s.key === key)?.label ?? key;
export const oneLabel = (key: string) => SECTIONS.find((s) => s.key === key)?.one ?? key;
export const isSection = (key: unknown): key is string => typeof key === 'string' && SECTION_KEYS.has(key);

// Items grouped by section, in SECTIONS order, each group in its stored order.
export function bySection(items: MediaItem[]): { key: string; label: string; items: MediaItem[] }[] {
  return SECTIONS.map((s) => ({ ...s, items: items.filter((i) => i.section === s.key) })).filter((g) => g.items.length);
}

// The same items as one list in gallery order (sections in SECTIONS order, stored order inside each).
export const inGalleryOrder = (items: MediaItem[]): MediaItem[] => bySection(items).flatMap((g) => g.items)
  .concat(items.filter((i) => !ORDER.has(i.section)));

// A character's name as the character pages take it: letters only (EQ names), so it is also safe to
// hand to a case-insensitive match without escaping.
export const isCharacterName = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z]{2,}$/.test(s);

// 45.05 -> "0:45"
export function clock(t: number): string {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export type FilmRaider = {
  n: number;
  name: string;
  cls: string;
  race: string;
  inFilm: boolean;
  say: string | null;
  regular: { t: number; heard: string } | null;
  remix: { t: number; heard: string } | null;
};
export type FilmMaking = {
  raiders: FilmRaider[];
  song: { bpm: number | null; style: string; lyrics: string; takes: { key: string; title: string; secs: number }[] };
  stats: { cards: number; inFilm: number; pictures: number; renders: number };
};

function sung(v: unknown): { t: number; heard: string } | null {
  const r = (v ?? {}) as Record<string, unknown>;
  return typeof r.t === 'number' && Number.isFinite(r.t) ? { t: r.t, heard: typeof r.heard === 'string' ? r.heard : '' } : null;
}
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

// The bot_kv value -> the film's facts. A malformed raider is dropped, never thrown on; no value -> null.
export function parseFilmMaking(value: unknown): FilmMaking | null {
  const v = (value ?? null) as Record<string, unknown> | null;
  if (!v || !Array.isArray(v.raiders)) return null;
  const raiders = v.raiders.flatMap((x): FilmRaider[] => {
    const r = (x ?? {}) as Record<string, unknown>;
    if (!isCharacterName(r.name) || typeof r.n !== 'number') return [];
    return [{
      n: r.n, name: r.name, cls: str(r.cls), race: str(r.race), inFilm: r.in_film === true,
      say: typeof r.say === 'string' && r.say ? r.say : null, regular: sung(r.regular), remix: sung(r.remix),
    }];
  });
  const s = (v.song ?? {}) as Record<string, unknown>;
  const st = (v.stats ?? {}) as Record<string, unknown>;
  return {
    raiders,
    song: {
      bpm: typeof s.bpm === 'number' ? s.bpm : null,
      style: str(s.style),
      lyrics: str(s.lyrics),
      takes: (Array.isArray(s.takes) ? s.takes : []).flatMap((t) => {
        const r = (t ?? {}) as Record<string, unknown>;
        return typeof r.key === 'string' && typeof r.title === 'string' ? [{ key: r.key, title: r.title, secs: num(r.secs) }] : [];
      }),
    },
    stats: { cards: num(st.cards), inFilm: num(st.in_film), pictures: num(st.pictures), renders: num(st.renders) },
  };
}

// A signed link that saves the file instead of playing it (the storage API's `download` parameter).
export function downloadUrl(url: string, name: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}download=${encodeURIComponent(name)}`;
}
