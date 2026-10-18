// The bid winners of a raid session window, and each one's night of bidding: what they won, and the CLOSED
// auctions they bid on and lost. Pure builders on top, the reads at the bottom (server-side, service-role client).
//
// WHO IS A WINNER (the guild lead, 2026-10-17: "do not anonymize bid winners"): a character that won an item in the
// window, either in a closed OpenDKP auction (opendkp_auctions, `end_at` in the window and not in the future) or in
// an observed award (loot_observations, `posted_at` in the window). Winners are shown by name on the review and
// the share page even when they opted out (lib/raidSession.ts); this file is the one definition of the set, so the
// bundle, the replay and every fight's parse agree on it.
//
// OPEN AUCTIONS ARE SEALED. Every Wolf Pack auction is closed-bid, and the mirror can capture the current leader
// mid-auction, so an auction whose `end_at` has not passed contributes nothing here: not a win, not a bid, not a
// name. (lib/raidScreen.ts buildAwards holds the same rule for the screen feed.)
//
// WHERE THE BIDS COME FROM: opendkp_auction_bids (one row per bid, written by the bot's OpenDKP sync from the
// auctions list, so a closed auction's losing bids are mirrored in Supabase, not only in the bot's live cache).
// A bid's `character_name` is the OpenDKP account LOGIN, not the character; `character_id` resolves to the
// character through characters.opendkp_id, and the login is the fallback. A bid whose character_id is missing and
// whose login is not the winner's character name is therefore not attributed to anyone (TODO below).
//
// TODO: bids made under an account login that differs from the character name and carry no character_id are not
// matched to their bidder. They are rare (the sync stores character_id for every list-endpoint bid) and the
// failure is a missing line in someone's "lost" list, never a wrong name.
import type { SupabaseClient } from '@supabase/supabase-js';
import { selectAll } from './selectAll';
import { chunk } from './replayBosses';
import { windowIso, type ShareWindow } from './raidShare';
import { nameKey, opaqueKey, type BidderView, type BidLoss, type BidWin, type ObservedIn } from './raidSession';

export type AuctionIn = {
  auction_id: number; item_name: string | null; winner: string | null; winner_character_id: number | null;
  bid_amount: number | null; end_at: string | null;
};
export type AuctionBidIn = { auction_id: number; character_id: number | null; character_name: string | null; value: number | null };
export type CharIdRow = { opendkp_id: number | null; name: string; class: string | null };
export type WinnerInputs = { observed: ObservedIn[]; auctions: AuctionIn[]; chars: CharIdRow[] };

type Who = { name: string; cls: string | null };
type Won = Who & { wins: BidWin[] };

const itemKey = (s: string) => s.trim().toLowerCase();
const stamp = (s: string | null | undefined): number | null => { const t = s ? Date.parse(s) : NaN; return Number.isFinite(t) ? t : null; };

/** Closed: its end has a time and that time has passed. An auction with no end time cannot be shown to be closed. */
const isClosed = (a: Pick<AuctionIn, 'end_at'>, now: number): boolean => { const t = stamp(a.end_at); return t != null && t <= now; };

const charMap = (rows: readonly CharIdRow[]): Map<number, Who> => {
  const m = new Map<number, Who>();
  for (const c of rows) if (typeof c.opendkp_id === 'number' && c.name) m.set(c.opendkp_id, { name: c.name, cls: c.class ?? null });
  return m;
};

/** The character that won an auction: by character id when it resolves, else the OpenDKP login. Null: nobody won it. */
function winnerOf(a: AuctionIn, cm: ReadonlyMap<number, Who>): Who | null {
  const c = a.winner_character_id != null ? cm.get(a.winner_character_id) : undefined;
  if (c) return c;
  const login = (a.winner ?? '').trim();
  return login ? { name: login, cls: null } : null;
}

function group(wins: readonly BidWin[]): Map<string, BidWin[]> {
  const m = new Map<string, BidWin[]>();
  for (const w of wins) { const k = itemKey(w.item); const a = m.get(k); if (a) a.push(w); else m.set(k, [w]); }
  return m;
}

/** The same win seen by two sources counts once: per item, whichever source saw MORE of them (the first on a tie). */
function mergeWins(a: readonly BidWin[], b: readonly BidWin[]): BidWin[] {
  const ga = group(a), gb = group(b), out: BidWin[] = [];
  for (const k of new Set([...ga.keys(), ...gb.keys()])) {
    const x = ga.get(k) ?? [], y = gb.get(k) ?? [];
    out.push(...(y.length > x.length ? y : x));
  }
  return out.sort((p, q) => (p.atMs ?? Number.MAX_SAFE_INTEGER) - (q.atMs ?? Number.MAX_SAFE_INTEGER) || p.item.localeCompare(q.item));
}

/** Every winner in the inputs, keyed by nameKey, with what they won. Closed auctions and observed awards only. */
export function winsOf(inp: WinnerInputs, now: number): Map<string, Won> {
  const cm = charMap(inp.chars);
  const fromAuctions = new Map<string, Won>();
  const fromObserved = new Map<string, Won>();
  const add = (m: Map<string, Won>, who: Who, win: BidWin) => {
    const k = nameKey(who.name);
    const cur = m.get(k);
    if (cur) cur.wins.push(win); else m.set(k, { ...who, wins: [win] });
  };
  for (const a of inp.auctions) {
    if (!isClosed(a, now) || !a.item_name) continue;
    const w = winnerOf(a, cm);
    if (w) add(fromAuctions, w, { item: a.item_name, dkp: a.bid_amount ?? null, atMs: stamp(a.end_at) });
  }
  for (const o of inp.observed) {
    const name = (o.winner_character ?? '').trim();
    if (name && o.item_name) add(fromObserved, { name, cls: null }, { item: o.item_name, dkp: o.dkp_amount ?? null, atMs: stamp(o.posted_at) });
  }
  const out = new Map<string, Won>();
  for (const k of new Set([...fromAuctions.keys(), ...fromObserved.keys()])) {
    const a = fromAuctions.get(k), o = fromObserved.get(k);
    out.set(k, { name: (a ?? o)!.name, cls: a?.cls ?? o?.cls ?? null, wins: mergeWins(a?.wins ?? [], o?.wins ?? []) });
  }
  return out;
}

/** The winners as nameKeys: the set that is exempt from anonymizing. */
export const winnerKeys = (inp: WinnerInputs, now: number): Set<string> => new Set(winsOf(inp, now).keys());

/**
 * Each winner's night: their wins, and the closed auctions they bid on and lost (their highest bid there, and who
 * won). Sorted by name. A bidder who won nothing has no entry: this is the winners' view, and a loser who never won
 * is exactly who the page does not name. `bids` of an open or unknown auction are ignored.
 */
export function buildBidders(
  inp: WinnerInputs, bids: readonly AuctionBidIn[], moreChars: readonly CharIdRow[], salt: string, now: number,
): BidderView[] {
  const won = winsOf(inp, now);
  if (!won.size) return [];
  const cm = charMap([...inp.chars, ...moreChars]);
  const closed = new Map<number, AuctionIn>();
  for (const a of inp.auctions) if (isClosed(a, now) && a.item_name) closed.set(a.auction_id, a);

  const best = new Map<string, { a: AuctionIn; key: string; value: number | null }>();
  for (const b of bids) {
    const a = closed.get(b.auction_id);
    if (!a) continue;
    const id = b.character_id;
    const name = (id != null ? cm.get(id)?.name : undefined) ?? (b.character_name ?? '').trim();
    const key = nameKey(name);
    if (!key || !won.has(key)) continue;
    const w = winnerOf(a, cm);
    if (w && nameKey(w.name) === key) continue;           // that is their win, not a loss
    const k = `${a.auction_id}|${key}`;
    const v = typeof b.value === 'number' ? b.value : null;
    const cur = best.get(k);
    if (!cur || (v ?? -1) > (cur.value ?? -1)) best.set(k, { a, key, value: v });
  }
  const lossesBy = new Map<string, BidLoss[]>();
  for (const { a, key, value } of best.values()) {
    const loss: BidLoss = { item: a.item_name as string, bid: value, winner: winnerOf(a, cm)?.name ?? null, atMs: stamp(a.end_at) };
    const l = lossesBy.get(key);
    if (l) l.push(loss); else lossesBy.set(key, [loss]);
  }
  const at = (t: number | null) => t ?? Number.MAX_SAFE_INTEGER;
  return [...won].map(([key, w]) => ({
    handle: `b${opaqueKey(salt, `bids|${key}`)}`,
    name: w.name,
    cls: w.cls,
    wins: w.wins,
    losses: (lossesBy.get(key) ?? []).sort((p, q) => at(p.atMs) - at(q.atMs) || p.item.localeCompare(q.item)),
  })).sort((p, q) => p.name.localeCompare(q.name));
}

// ── The reads ────────────────────────────────────────────────────────────────

/** characters rows by OpenDKP character id (winners' and bidders' real names). Chunked for the 1,000-row cap. */
export async function loadCharsByOpendkpId(sb: SupabaseClient, guild: string, ids: readonly (number | null | undefined)[]): Promise<CharIdRow[]> {
  const uniq = [...new Set(ids.filter((n): n is number => typeof n === 'number'))];
  const out: CharIdRow[] = [];
  for (const part of chunk(uniq, 100)) {
    out.push(...await selectAll<CharIdRow>((from, to) => sb.from('characters')
      .select('name, class, opendkp_id')
      .eq('guild_id', guild)
      .in('opendkp_id', part)
      .order('name')
      .range(from, to)));
  }
  return out;
}

const INPUT_TTL_MS = 60_000;
const INPUT_CAP = 40;
const inputMemo = new Map<string, { at: number; value: WinnerInputs }>();

/** Forgets the memoised winner inputs (tests). */
export function clearWinnerMemo() {
  inputMemo.clear();
}

/**
 * What decides who a window's winners are: the observed awards and the auctions that ended in it, with the winners'
 * characters. Both reads carry the window's exact bounds. Held a minute per process and window, so a replay slice, a
 * fight's parse and the page do not each re-read it.
 */
export async function loadWinnerInputs(sb: SupabaseClient, guild: string, win: ShareWindow): Promise<WinnerInputs> {
  const key = `${guild}|${win.fromMs}|${win.toMs}`;
  const hit = inputMemo.get(key);
  if (hit && Date.now() - hit.at < INPUT_TTL_MS) return hit.value;
  const { from: lo, to: hi } = windowIso(win);
  const [observed, auctions] = await Promise.all([
    selectAll<ObservedIn>((from, to) => sb.from('loot_observations')
      .select('item_name, winner_character, dkp_amount, posted_at')
      .eq('guild_id', guild)
      .gte('posted_at', lo).lt('posted_at', hi)
      .order('id')
      .range(from, to)),
    selectAll<AuctionIn>((from, to) => sb.from('opendkp_auctions')
      .select('auction_id, item_name, winner, winner_character_id, bid_amount, end_at')
      .gte('end_at', lo).lt('end_at', hi)
      .order('auction_id')
      .range(from, to)),
  ]);
  const chars = await loadCharsByOpendkpId(sb, guild, auctions.map(a => a.winner_character_id));
  const value: WinnerInputs = { observed, auctions, chars };
  inputMemo.delete(key);
  if (inputMemo.size >= INPUT_CAP) inputMemo.delete(inputMemo.keys().next().value as string);
  inputMemo.set(key, { at: Date.now(), value });
  return value;
}

/** The window's winners as nameKeys. */
export async function loadWinnerKeys(sb: SupabaseClient, guild: string, win: ShareWindow, now = Date.now()): Promise<Set<string>> {
  return winnerKeys(await loadWinnerInputs(sb, guild, win), now);
}

/** Each winner's night for the bundle: the bids of the window's CLOSED auctions, read for ids the windowed read gave. */
export async function loadBidders(sb: SupabaseClient, guild: string, win: ShareWindow, salt: string, now = Date.now()): Promise<BidderView[]> {
  const inp = await loadWinnerInputs(sb, guild, win);
  if (!winsOf(inp, now).size) return [];
  const ids = inp.auctions.filter(a => isClosed(a, now)).map(a => a.auction_id);
  const bids: AuctionBidIn[] = [];
  for (const part of chunk(ids, 100)) {
    bids.push(...await selectAll<AuctionBidIn>((from, to) => sb.from('opendkp_auction_bids')
      .select('auction_id, character_id, character_name, value')
      .in('auction_id', part)
      .order('id')
      .range(from, to)));
  }
  const known = new Set(inp.chars.map(c => c.opendkp_id));
  const more = await loadCharsByOpendkpId(sb, guild, bids.map(b => b.character_id).filter(id => !known.has(id)));
  return buildBidders(inp, bids, more, salt, now);
}
