// /screen: the pure parts. No React, no Supabase, so the three API routes, the board and the tests share one
// copy of the rules that are easy to get wrong (what a mode is, what a slide may contain, where the slide
// index may point, how a slide body is read).
//
// The page is the raid screen the raid leader drives (the guild lead picked option B, 2026-10-06): an
// officer picks Map / Slides / Loot / Overview and every other viewer's page follows. The state is one row
// per guild (raid_screen_state) and the deck is raid_screen_slides; supabase/migrations/20261006120000.

import { canonicalClass, classAbbr, classColor, type Raider, type ZoneCount } from '@/lib/spectator';

export const SCREEN_GUILD = 'wolfpack';
export const SCREEN_MODES = ['map', 'slides', 'loot', 'overview'] as const;
export type ScreenMode = (typeof SCREEN_MODES)[number];
export const MODE_LABEL: Record<ScreenMode, string> = {
  map: 'Map', slides: 'Slides', loot: 'Loot', overview: 'Overview',
};

export const STATE_POLL_MS = 3000;    // how fast a viewer follows the leader
export const FEED_POLL_MS = 20000;    // loot, kills and spawns change slowly
export const FEED_CACHE_MS = 10000;   // one answer shared by everyone's poll, per server instance
export const TONIGHT_H = 6;           // "tonight" = the last six hours: a raid is four, plus the run-up and the loot

export const TITLE_MAX = 120;
export const BODY_MAX = 2000;
export const IMAGE_URL_MAX = 500;
export const SLIDES_MAX = 40;

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function isScreenMode(v: unknown): v is ScreenMode {
  return typeof v === 'string' && (SCREEN_MODES as readonly string[]).includes(v);
}

/** Where a slide index may point: a whole number from 0 to count - 1 (0 when the deck is empty), else 0. */
export function clampSlideIndex(index: unknown, count: number): number {
  const n = typeof index === 'number' && Number.isFinite(index) ? Math.trunc(index) : 0;
  const last = Math.max(0, Math.trunc(count) - 1);
  return Math.min(Math.max(n, 0), last);
}

export type StateInput = { mode?: ScreenMode; slideIndex?: number };

/**
 * The officer's POST /api/screen/state body. At least one of `mode` and `slideIndex`; `mode` must be one of
 * the four; `slideIndex` a whole number inside the deck (only 0 while the deck is empty). Out of range is an
 * error, not a clamp, so a stale tab cannot jump the whole raid to a slide that is no longer there.
 */
export function parseStateInput(body: unknown, slideCount: number): Parsed<StateInput> {
  if (!isRecord(body)) return { ok: false, error: 'send a JSON object' };
  const out: StateInput = {};
  if (body.mode !== undefined) {
    if (!isScreenMode(body.mode)) return { ok: false, error: `mode must be one of ${SCREEN_MODES.join(', ')}` };
    out.mode = body.mode;
  }
  if (body.slideIndex !== undefined) {
    const i = body.slideIndex;
    if (typeof i !== 'number' || !Number.isInteger(i)) return { ok: false, error: 'slideIndex must be a whole number' };
    const last = Math.max(0, Math.trunc(slideCount) - 1);
    if (i < 0 || i > last) return { ok: false, error: `slideIndex must be 0 to ${last}` };
    out.slideIndex = i;
  }
  if (out.mode === undefined && out.slideIndex === undefined) return { ok: false, error: 'send mode, slideIndex or both' };
  return { ok: true, value: out };
}

export type SlideInput = { id?: string; title: string; body: string; imageUrl: string | null };

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RX.test(v);

/** A picture address a slide may carry: https only, no embedded login, one line, at most IMAGE_URL_MAX. */
export function parseImageUrl(v: unknown): Parsed<string | null> {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v !== 'string') return { ok: false, error: 'imageUrl must be text' };
  const s = v.trim();
  if (!s) return { ok: true, value: null };
  if (s.length > IMAGE_URL_MAX) return { ok: false, error: `imageUrl is over ${IMAGE_URL_MAX} characters` };
  if (/\s/.test(s)) return { ok: false, error: 'imageUrl must not contain spaces' };
  let u: URL;
  try { u = new URL(s); } catch { return { ok: false, error: 'imageUrl must be a full https address' }; }
  if (u.protocol !== 'https:') return { ok: false, error: 'imageUrl must start with https://' };
  if (u.username || u.password) return { ok: false, error: 'imageUrl must not carry a login' };
  return { ok: true, value: s };
}

/** One slide as an officer submits it (add, or edit when `id` is present). */
export function parseSlideInput(body: unknown): Parsed<SlideInput> {
  if (!isRecord(body)) return { ok: false, error: 'send a JSON object' };
  if (body.id !== undefined && !isUuid(body.id)) return { ok: false, error: 'id is not a slide id' };
  if (typeof body.title !== 'string') return { ok: false, error: 'title must be text' };
  const title = body.title.trim();
  if (!title) return { ok: false, error: 'a slide needs a title' };
  if (title.length > TITLE_MAX) return { ok: false, error: `title is over ${TITLE_MAX} characters` };
  const rawBody = body.body === undefined || body.body === null ? '' : body.body;
  if (typeof rawBody !== 'string') return { ok: false, error: 'body must be text' };
  const text = rawBody.replace(/\r\n?/g, '\n').trim();
  if (text.length > BODY_MAX) return { ok: false, error: `body is over ${BODY_MAX} characters` };
  const img = parseImageUrl(body.imageUrl);
  if (!img.ok) return img;
  return { ok: true, value: { ...(body.id ? { id: body.id as string } : {}), title, body: text, imageUrl: img.value } };
}

/** `ids` with `id` moved one place up (toward the front) or down; null when it is missing or already at that end. */
export function moveId(ids: string[], id: string, dir: 'up' | 'down'): string[] | null {
  const at = ids.indexOf(id);
  if (at < 0) return null;
  const to = dir === 'up' ? at - 1 : at + 1;
  if (to < 0 || to >= ids.length) return null;
  const next = [...ids];
  [next[at], next[to]] = [next[to], next[at]];
  return next;
}

// ── Slide text ──────────────────────────────────────────────────────────────

export type SlideBlock = { kind: 'p'; text: string } | { kind: 'ul'; items: string[] };

/**
 * A slide body is plain text: blank lines split paragraphs, and a line that starts with "- " or "* " is a
 * bullet (a run of them is one list). Nothing else is markup, so nothing in a body can become HTML.
 */
export function parseSlideBody(text: string): SlideBlock[] {
  const blocks: SlideBlock[] = [];
  let para: string[] = [];
  let list: string[] = [];
  const flushPara = () => { if (para.length) blocks.push({ kind: 'p', text: para.join('\n') }); para = []; };
  const flushList = () => { if (list.length) blocks.push({ kind: 'ul', items: list }); list = []; };
  for (const raw of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (!line) { flushPara(); flushList(); }
    else if (bullet) { flushPara(); list.push(bullet[1]); }
    else { flushList(); para.push(line); }
  }
  flushPara();
  flushList();
  return blocks;
}

// ── Times ───────────────────────────────────────────────────────────────────

/** "just now", "12 s ago", "3 min ago", "2 h ago" for a time in the past. */
export function agoText(iso: string | null | undefined, nowMs: number): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}

/** "now", "12m", "3h 05m" for a time ahead. */
export function untilText(iso: string | null | undefined, nowMs: number): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '';
  const s = Math.round((t - nowMs) / 1000);
  if (s <= 30) return 'now';
  const m = Math.ceil(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

export const sinceIso = (nowMs: number, hours = TONIGHT_H): string => new Date(nowMs - hours * 3600_000).toISOString();

// ── The screen's own feed (/api/screen/state) ───────────────────────────────

export type ScreenSlide = { id: string; position: number; title: string; body: string; imageUrl: string | null; updatedAt: string | null };

export type ScreenState = {
  mode: ScreenMode;
  slideIndex: number;
  slide: ScreenSlide | null;
  slideCount: number;
  updatedBy: string | null;
  updatedAt: string | null;
};

type StateRow = {
  mode?: unknown; slide_index?: unknown; updated_by?: unknown; updated_at?: unknown;
};
type SlideRow = {
  id: string; position: number | null; title: string | null; body: string | null; image_url: string | null; updated_at: string | null;
};

export function toScreenSlide(r: SlideRow): ScreenSlide {
  return {
    id: r.id, position: r.position ?? 0, title: r.title ?? '', body: r.body ?? '',
    imageUrl: r.image_url || null, updatedAt: r.updated_at ?? null,
  };
}

/**
 * The state row (or none yet) + the deck's size + the slide at that index -> what the page gets. A missing
 * row is the Map; a mode the page does not know (a newer deploy wrote it) falls back to the Map; the index
 * is clamped to the deck, so deleting the last slide while it is up shows the new last one, not nothing.
 */
export function buildScreenState(row: StateRow | null, slideCount: number, slide: ScreenSlide | null): ScreenState {
  const mode: ScreenMode = row && isScreenMode(row.mode) ? row.mode : 'map';
  return {
    mode,
    slideIndex: clampSlideIndex(row?.slide_index, slideCount),
    slide: mode === 'slides' ? slide : null,
    slideCount,
    updatedBy: row && typeof row.updated_by === 'string' && row.updated_by ? row.updated_by : null,
    updatedAt: row && typeof row.updated_at === 'string' ? row.updated_at : null,
  };
}

// ── Loot (/api/screen/feed) ─────────────────────────────────────────────────

export type AwardRow = { auction_id: number; item_name: string | null; winner: string | null; bid_amount: number | null; end_at: string | null };
export type NameRow = { auction_id: number; character_name: string | null };
/** `open`: bidding had not closed when the bot last mirrored OpenDKP (so `who` is the high bidder so far, if any). */
export type Award = { id: number; item: string; who: string | null; dkp: number | null; at: string | null; open: boolean };

/**
 * opendkp_auctions' `winner` is the bidder's OpenDKP login, which is often not the character; the
 * opendkp_loot_recent view resolves the character. Prefer the view's name, fall back to the login. A closed
 * auction with no winner is dropped (nobody bid); one still open is kept, with or without a bid. Rows with
 * no item name are dropped. Open ones first (soonest to close), then the closed, newest first.
 */
export function buildAwards(auctions: AwardRow[], names: NameRow[], nowMs: number): Award[] {
  const byId = new Map<number, string>();
  for (const n of names) if (n.character_name) byId.set(n.auction_id, n.character_name);
  const out: Award[] = [];
  for (const a of auctions) {
    if (!a.item_name) continue;
    const end = a.end_at ? Date.parse(a.end_at) : NaN;
    const open = Number.isFinite(end) && end > nowMs;
    const who = byId.get(a.auction_id) ?? a.winner ?? null;
    if (!who && !open) continue;
    out.push({ id: a.auction_id, item: a.item_name, who, dkp: a.bid_amount ?? null, at: a.end_at ?? null, open });
  }
  const t = (a: Award) => Date.parse(a.at ?? '') || 0;
  return out.sort((a, b) => Number(b.open) - Number(a.open) || (a.open ? t(a) - t(b) : t(b) - t(a)));
}

export type LootedRow = { looter_character: string | null; item_name: string | null; looted_at: string | null };
export type LootedGroup = { item: string; count: number; who: string[]; at: string | null };

/**
 * What the agents saw picked up, folded by item: "Strand of Ether x3 (Nyssara, Zarrin)". Newest item first,
 * looters in the order they looted, each named once. `limit` groups.
 */
export function groupLooted(rows: LootedRow[], limit = 30): LootedGroup[] {
  const sorted = [...rows].sort((a, b) => (Date.parse(b.looted_at ?? '') || 0) - (Date.parse(a.looted_at ?? '') || 0));
  const groups = new Map<string, LootedGroup>();
  for (const r of sorted) {
    if (!r.item_name) continue;
    const key = r.item_name.trim().toLowerCase();
    let g = groups.get(key);
    if (!g) groups.set(key, g = { item: r.item_name.trim(), count: 0, who: [], at: r.looted_at });
    g.count++;
    if (r.looter_character && !g.who.includes(r.looter_character)) g.who.push(r.looter_character);
  }
  return [...groups.values()].slice(0, limit);
}

// ── Overview ────────────────────────────────────────────────────────────────

export type ZoneSummary = {
  zone: string;
  name: string;
  count: number;
  classes: { cls: string; abbr: string; color: string; count: number }[];
  groups: { group: number | null; count: number }[];
};

/**
 * The raid by zone, then by class and by group, from the positions feed. Zones by head count; classes by
 * count then name; groups by number (ungrouped last).
 */
export function summarizeRaid(raiders: Raider[], zones: ZoneCount[]): ZoneSummary[] {
  const nameOf = new Map(zones.map(z => [z.zone, z.name]));
  const by = new Map<string, Raider[]>();
  for (const r of raiders) by.set(r.zone, [...(by.get(r.zone) ?? []), r]);
  const out: ZoneSummary[] = [];
  for (const [zone, rs] of by) {
    const classes = new Map<string, { cls: string; abbr: string; color: string; count: number }>();
    const groups = new Map<number | null, number>();
    for (const r of rs) {
      const cls = canonicalClass(r.cls) ?? 'Unknown';
      const c = classes.get(cls);
      if (c) c.count++; else classes.set(cls, { cls, abbr: classAbbr(r.cls), color: classColor(r.cls), count: 1 });
      groups.set(r.group, (groups.get(r.group) ?? 0) + 1);
    }
    out.push({
      zone, name: nameOf.get(zone) ?? zone, count: rs.length,
      classes: [...classes.values()].sort((a, b) => b.count - a.count || a.cls.localeCompare(b.cls)),
      groups: [...groups].map(([group, count]) => ({ group, count })).sort((a, b) => (a.group ?? 1e9) - (b.group ?? 1e9)),
    });
  }
  return out.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export type FeedKill = { id: string; name: string; at: string | null; durationSec: number | null };
export type FeedSpawn = { id: string; name: string; zone: string | null; at: string };

export type ScreenFeed = {
  at: string;
  awards: Award[];
  looted: LootedGroup[];
  kills: FeedKill[];
  spawns: FeedSpawn[];
  /** False when a part could not be read; the page says so rather than showing an empty list as fact. */
  partial: boolean;
};
