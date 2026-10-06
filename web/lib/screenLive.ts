// /screen and /spectator: how the page reads the raid every three seconds.
//
// The reads used to be three Vercel polls per viewer (state, positions, and the spectator board's own positions)
// and sixty viewers for a raid is most of a month's function allowance on Vercel's Hobby plan. Now the page asks
// the BOT, which already holds every raider's position in memory and is flat-rate:
//
//   1. GET /api/screen/ticket (Vercel, once per viewer per ~two hours) -> a signed ticket and the bot's address
//   2. GET <bot>/api/screen/live every 3 s with `Authorization: Bearer <ticket>` -> positions + screen state
//
// and falls back to the Vercel polls it always had when the bot feed is not set up (the ticket says token: null),
// or when it keeps failing (it is tried again once a minute, so a bot restart does not park every viewer on
// Vercel for the rest of the night).
//
// This file is the framework-free part, so the whole decision tree is testable: parseLive turns the bot's answer
// into the same Positions and ScreenState the Vercel routes return (by running the SAME shaping functions the
// routes run, buildPositions and buildScreenState: the bot ships their inputs), the small decision functions say
// what to do after a failure, and createScreenLive is the poll loop. lib/useScreenLive.ts is the React wrapper.
import { buildPositions, type Positions, type RosterPosRow } from '@/lib/spectator';
import { STATE_POLL_MS, buildScreenState, isScreenMode, toScreenSlide, type ScreenState } from '@/lib/raidScreen';

export const LIVE_POLL_MS = STATE_POLL_MS;
export const TICKET_RENEW_BEFORE_MS = 5 * 60_000;   // ask for a new ticket this long before the old one ends
export const TICKET_SKEW_MS = 30_000;               // a ticket this close to its end is not used any more
export const TICKET_RETRY_MS = 30_000;              // after a failed ticket request
// After a good one, no scheduled renewal for this long: a viewer whose clock is hours off would otherwise judge
// every ticket "about to end" and ask for a new one every poll, which is the Vercel traffic this feed removes.
export const TICKET_MIN_GAP_MS = 60_000;
export const BOT_FAILS_BEFORE_FALLBACK = 3;
export const BOT_REPROBE_MS = 60_000;               // while on the Vercel fallback, try the bot again this often
export const WRITE_TRUST_MS = 8_000;                // the leader's own click outranks a poll older than itself this long

export type LiveAuction = { item: string; endsAt: string | null };
export type PositionsFeed = { data: Positions; rxAt: number };
/** `positions` is null when the bot could not say where the raid is (a part that failed, as the Vercel route's 502 would). */
export type ParsedLive = { positions: Positions | null; state: ScreenState | null; auctions: LiveAuction[] | null };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/**
 * The bot's /api/screen/live answer -> what the page uses, or null when it is not that shape.
 * `at` is the BOT's clock and is the "now" the positions are built with, so a viewer whose own clock is off
 * still sees raiders as fresh as they are.
 */
export function parseLive(j: unknown): ParsedLive | null {
  if (!isRecord(j)) return null;
  const at = typeof j.at === 'string' ? Date.parse(j.at) : NaN;
  if (!Number.isFinite(at)) return null;
  const p = j.positions;
  let positions: Positions | null = null;
  if (p !== null) {
    if (!isRecord(p) || !Array.isArray(p.rows) || !Array.isArray(p.live) || !Array.isArray(p.zones)) return null;
    const rows = p.rows.filter(isRecord) as unknown as RosterPosRow[];
    const live = new Map<string, number>();
    for (const e of p.live) if (Array.isArray(e) && typeof e[0] === 'string' && finite(e[1])) live.set(e[0], e[1]);
    const zones = new Map<number, { short: string; long: string | null }>();
    for (const e of p.zones) {
      if (Array.isArray(e) && finite(e[0]) && typeof e[1] === 'string') zones.set(e[0], { short: e[1], long: typeof e[2] === 'string' ? e[2] : null });
    }
    positions = buildPositions(rows, live, zones, at);
  }

  let state: ScreenState | null = null;
  const s = j.state;
  if (isRecord(s) && finite(s.slideCount)) {
    const slide = isRecord(s.slide) && typeof s.slide.id === 'string' ? toScreenSlide(s.slide as Parameters<typeof toScreenSlide>[0]) : null;
    state = buildScreenState(isRecord(s.row) ? s.row : null, s.slideCount, slide);
  }

  let auctions: LiveAuction[] | null = null;
  if (Array.isArray(j.auctions)) {
    auctions = [];
    for (const a of j.auctions) {
      if (isRecord(a) && typeof a.item === 'string' && a.item) auctions.push({ item: a.item, endsAt: typeof a.endsAt === 'string' ? a.endsAt : null });
    }
  }
  return { positions, state, auctions };
}

/** What to do after a failed read of the bot. `failures` counts this one. */
export function afterBotFailure(f: { status: number; failures: number; justRenewed: boolean }): 'renew' | 'retry' | 'fallback' {
  if (f.status === 401) return f.justRenewed ? 'fallback' : 'renew';   // an expired ticket is renewed once; a fresh one that is refused is not our luck to push
  return f.failures >= BOT_FAILS_BEFORE_FALLBACK ? 'fallback' : 'retry';
}

/**
 * Is a state read OLDER than the one the leader just wrote? The bot answers the screen state from a two-second
 * memo, so a poll right after the leader's click can still carry the screen as it was; showing it would flip
 * the leader's own page back for a moment. Compared on the row's updatedAt, which the write returns.
 */
export function writeIsStale(liveUpdatedAt: string | null | undefined, wroteUpdatedAt: string | null | undefined): boolean {
  const w = wroteUpdatedAt ? Date.parse(wroteUpdatedAt) : NaN;
  if (!Number.isFinite(w)) return false;
  const l = liveUpdatedAt ? Date.parse(liveUpdatedAt) : NaN;
  return !Number.isFinite(l) || l < w;
}

export type WriteMark = { updatedAt: string; until: number };

/**
 * Should a read of the screen state replace what the page shows, given the leader's last write (`mark`, from the
 * POST's answer)? A read older than the write is ignored for WRITE_TRUST_MS, after which the mark is dropped
 * whatever the read says. Returns the verdict and the mark to keep.
 */
export function judgeRead(
  readUpdatedAt: string | null | undefined, mark: WriteMark | null, nowMs: number,
): { show: boolean; mark: WriteMark | null } {
  if (!mark) return { show: true, mark: null };
  if (nowMs < mark.until && writeIsStale(readUpdatedAt, mark.updatedAt)) return { show: false, mark };
  return { show: true, mark: null };
}

// ── The poll loop ───────────────────────────────────────────────────────────

export type LiveStatus = {
  transport: 'connecting' | 'bot' | 'vercel';
  /** The positions could not be read (the last attempt failed). */
  netErr: boolean;
  /** The screen state could not be read (only when it is wanted). */
  stateErr: boolean;
  /** The session ended (a 401 from Vercel): the loop has stopped for good. */
  signedOut: boolean;
};

export type LiveSinks = {
  onPositions: (feed: PositionsFeed) => void;
  onState?: (s: ScreenState) => void;
  /** The live open-auction list, or null when there is none (Vercel fallback, or the bot holds none fresh). */
  onAuctions?: (a: LiveAuction[] | null) => void;
  /** Called only when the status changed. */
  onStatus?: (s: LiveStatus) => void;
};

export type LiveOptions = {
  wantState: boolean;
  isHidden: () => boolean;
  sinks: LiveSinks;
  fetchFn?: typeof fetch;
  now?: () => number;
};

type Ticket = { token: string; exp: number; liveUrl: string };
type Json = { status: number; json?: unknown } | null;   // null = aborted

const isAbort = (e: unknown) => (e as Error | null)?.name === 'AbortError';

export function createScreenLive(opts: LiveOptions) {
  const doFetch: typeof fetch = opts.fetchFn ?? ((input, init) => fetch(input, init));
  const now = opts.now ?? Date.now;
  const { sinks } = opts;

  let stopped = false;
  let busy = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ctrl: AbortController | undefined;

  let ticket: Ticket | null = null;
  let ticketRetryAt = 0;
  let unconfigured = false;          // the server said token: null: never ask again this visit
  let failures = 0;
  let justRenewed = false;
  let probeAt = 0;
  let status: LiveStatus = { transport: 'connecting', netErr: false, stateErr: false, signedOut: false };

  const setStatus = (patch: Partial<LiveStatus>) => {
    const next = { ...status, ...patch };
    if (next.transport === status.transport && next.netErr === status.netErr
      && next.stateErr === status.stateErr && next.signedOut === status.signedOut) return;
    status = next;
    sinks.onStatus?.(status);
  };

  const endSession = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = undefined;
    ctrl?.abort();
    setStatus({ signedOut: true });
  };

  async function getJson(url: string): Promise<Json> {
    try {
      const res = await doFetch(url, { cache: 'no-store', signal: ctrl?.signal });
      if (res.status === 401) return { status: 401 };
      if (!res.ok) return { status: res.status };
      return { status: 200, json: await res.json() };
    } catch (e) {
      return isAbort(e) ? null : { status: 0 };
    }
  }

  // 'ok': a ticket is held. 'none': the bot feed is not set up. 'error': try again later (or stopped).
  async function getTicket(): Promise<'ok' | 'none' | 'error'> {
    const r = await getJson('/api/screen/ticket');
    if (!r) return 'error';
    if (r.status === 401) { endSession(); return 'error'; }
    const j = r.json;
    if (r.status === 200 && isRecord(j) && j.token === null) { unconfigured = true; return 'none'; }
    if (r.status === 200 && isRecord(j) && typeof j.token === 'string' && typeof j.liveUrl === 'string' && finite(j.exp)) {
      ticket = { token: j.token, exp: j.exp, liveUrl: j.liveUrl };
      ticketRetryAt = now() + TICKET_MIN_GAP_MS;
      probeAt = 0;
      return 'ok';
    }
    ticketRetryAt = now() + TICKET_RETRY_MS;
    return 'error';
  }

  function apply(p: ParsedLive) {
    failures = 0;
    justRenewed = false;
    if (p.positions) sinks.onPositions({ data: p.positions, rxAt: now() });
    if (opts.wantState && p.state) sinks.onState?.(p.state);
    sinks.onAuctions?.(p.auctions);
    setStatus({ transport: 'bot', netErr: !p.positions, stateErr: opts.wantState ? !p.state : false });
  }

  // 'ok' and 'retry' mean the bot is the transport (nothing more to do this tick); 'fallback' means read Vercel
  // now; 'abort' means the tab was hidden mid-request.
  async function pollBot(probing: boolean): Promise<'ok' | 'retry' | 'fallback' | 'abort'> {
    const t = ticket as Ticket;
    let code = 0;
    try {
      const res = await doFetch(t.liveUrl, { headers: { Authorization: `Bearer ${t.token}` }, credentials: 'omit', signal: ctrl?.signal });
      code = res.status;
      if (res.ok) {
        const parsed = parseLive(await res.json());
        if (parsed) { apply(parsed); return 'ok'; }
        code = 0;
      }
    } catch (e) {
      if (isAbort(e)) return 'abort';
      code = 0;
    }
    if (probing) {   // the bot is still down: stay on Vercel, ask again in a minute
      probeAt = now() + BOT_REPROBE_MS;
      // Refused: ask for a new ticket when the next probe is due, not before (a bot that keeps refusing what
      // Vercel signs, a secret that does not match, must cost one ticket a minute, not one a poll).
      if (code === 401) { ticket = null; ticketRetryAt = probeAt; }
      return 'fallback';
    }
    failures++;
    let next = afterBotFailure({ status: code, failures, justRenewed });
    if (next === 'renew') {
      if ((await getTicket()) === 'ok') { justRenewed = true; failures = 0; return pollBot(false); }
      next = 'fallback';   // no new ticket to be had: Vercel it is
    }
    setStatus({ netErr: true, stateErr: opts.wantState });
    if (next === 'fallback') {
      probeAt = now() + BOT_REPROBE_MS;
      return 'fallback';
    }
    return 'retry';
  }

  // Returns true when the tab was hidden mid-request.
  async function pollVercel(): Promise<boolean> {
    setStatus({ transport: 'vercel' });
    sinks.onAuctions?.(null);
    const [p, s] = await Promise.all([
      getJson('/api/spectator/positions'),
      opts.wantState ? getJson('/api/screen/state') : Promise.resolve({ status: 200 } as Json),
    ]);
    if ((p && p.status === 401) || (s && s.status === 401)) { endSession(); return false; }
    if (p) {
      const j = p.json as Positions | undefined;
      if (p.status === 200 && Array.isArray(j?.raiders) && Array.isArray(j?.zones)) {
        sinks.onPositions({ data: j as Positions, rxAt: now() });
        setStatus({ netErr: false });
      } else {
        setStatus({ netErr: true });
      }
    }
    if (opts.wantState && s) {
      const j = s.json as ScreenState | undefined;
      if (s.status === 200 && j && isScreenMode(j.mode) && typeof j.slideCount === 'number') {
        sinks.onState?.(j);
        setStatus({ stateErr: false });
      } else {
        setStatus({ stateErr: true });
      }
    }
    return !p || (opts.wantState && !s);
  }

  async function tick() {
    timer = undefined;
    if (stopped || busy || opts.isHidden()) return;
    busy = true;
    ctrl = new AbortController();
    let aborted = false;
    try {
      if (!unconfigured) {
        const t = now();
        if (ticket && t >= ticket.exp * 1000 - TICKET_SKEW_MS) ticket = null;                        // no longer usable
        const wanted = !ticket || t >= ticket.exp * 1000 - TICKET_RENEW_BEFORE_MS;                   // none yet, or one due for renewal
        if (wanted && t >= ticketRetryAt) await getTicket();                                          // a failed renewal keeps the old one
      }
      if (!stopped) {
        let done = false;
        if (ticket && (status.transport !== 'vercel' || now() >= probeAt)) {
          const r = await pollBot(status.transport === 'vercel');
          aborted = r === 'abort';
          done = r === 'ok' || r === 'retry' || aborted;
        }
        if (!done && !stopped) aborted = await pollVercel();
      }
    } finally {
      busy = false;
    }
    if (!stopped && !opts.isHidden()) timer = setTimeout(tick, aborted ? 0 : LIVE_POLL_MS);
  }

  return {
    start() { void tick(); },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      ctrl?.abort();
    },
    /** Read again now (after the leader's click, so the page does not wait out the interval). */
    kick() {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      timer = undefined;
      void tick();
    },
    /** The tab was hidden or shown. Hidden: stop at once. Shown: read at once. */
    visibilityChanged() {
      if (stopped) return;
      if (opts.isHidden()) {
        if (timer) clearTimeout(timer);
        timer = undefined;
        ctrl?.abort();
      } else if (!timer && !busy) {
        void tick();
      }
    },
  };
}
