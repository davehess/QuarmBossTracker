// The raid timeline: the night's boss deaths in order, the gap between each, and the "kill both within N minutes"
// windows the Plane of Tactics fights turn on (the guild lead, 2026-10-21: "the death timers between mobs is
// something we want easily and clearly displayed versus having to say it out loud").
//
// Pure: no clock, no network. The caller passes `nowMs`, which is the wall clock on the live page and the replay
// playhead on the replay page; a kill after `nowMs` has not happened yet and is left out, so scrubbing back
// un-kills it. Times are epoch ms in, seconds out.
//
// The pair rules: NONE for the Plane of Tactics, per the encounter script (the guild lead, 2026-10-21: "we should
// always go off of the scripts and database instead of the guides"). The guide's "Decorins within 6 minutes" and
// "Tallon + Vallon within about 20" do not exist in SecretsOTheP/quests potactics/encounters/Rallos.lua: the
// Decorins only need both dead (L269, no time compared; a guard that RESPAWNS loses its kill, L379-389), and each
// brother has its own out-of-combat allowance (20 min, 150 min in a guild instance; L220-247, L456), not a window
// between the two deaths. The machinery stays for a rule a script does carry.

export type Kill = { npcId: number; name: string; atMs: number };

export type PairRule = { ids: [number, number]; windowSec: number; label: string };

export const PAIR_RULES: PairRule[] = [];

export type TimelineDeath = Kill & {
  /** Seconds since the death before this one; null for the first of the night. */
  gapSec: number | null;
};

type Who = { npcId: number; name: string; atMs: number };

export type PairState =
  | { rule: PairRule; status: 'waiting' }
  | {
      rule: PairRule; status: 'open';
      first: Who; secondId: number; secondName: string;
      /** Epoch ms the second one must die by. */
      dueAtMs: number; secondsLeft: number;
    }
  | { rule: PairRule; status: 'made'; first: Who; second: Who; tookSec: number }
  /** `second` is set when it died, but too late; null when the window ran out with it still up. */
  | { rule: PairRule; status: 'missed'; first: Who; secondId: number; secondName: string; second: Who | null; tookSec: number | null };

export type Timeline = {
  deaths: TimelineDeath[];
  /** The newest death at or before `nowMs`, null on an empty night. */
  last: TimelineDeath | null;
  /** Seconds since `last`; null when there is none. */
  sinceLastSec: number | null;
  pairs: PairState[];
};

const secs = (ms: number) => Math.round(ms / 1000);

/** The name shown for a pair member we have not seen die: the catalog fallback, so "due" still reads. */
const FALLBACK_NAME: Record<number, string> = {
  214056: 'Decorin Berik', 214057: 'Decorin Grunhork', 214026: 'Tallon Zek', 214316: 'Vallon Zek',
};

function pairState(rule: PairRule, deaths: TimelineDeath[], nowMs: number): PairState {
  const [a, b] = rule.ids;
  const pairDeaths = deaths.filter(d => d.npcId === a || d.npcId === b);
  if (!pairDeaths.length) return { rule, status: 'waiting' };
  const nameOf = (id: number, d: TimelineDeath | null) => d?.name ?? FALLBACK_NAME[id] ?? `#${id}`;
  const who = (d: TimelineDeath): Who => ({ npcId: d.npcId, name: d.name, atMs: d.atMs });

  // The newest death of the two is the anchor. Its partner is the newest death of the OTHER boss before it. A
  // partner inside the window makes the pair; one up to three windows back is a late kill (the pair was missed);
  // an older one (or none) is last pull's, so the anchor is the first death of a new attempt and opens the window.
  const anchor = pairDeaths[pairDeaths.length - 1];
  const otherId = anchor.npcId === a ? b : a;
  let partner: TimelineDeath | null = null;
  for (let i = pairDeaths.length - 2; i >= 0; i--) if (pairDeaths[i].npcId === otherId) { partner = pairDeaths[i]; break; }
  if (partner) {
    const took = secs(anchor.atMs - partner.atMs);
    if (took <= rule.windowSec) return { rule, status: 'made', first: who(partner), second: who(anchor), tookSec: took };
    if (took <= rule.windowSec * 3) {
      return { rule, status: 'missed', first: who(partner), secondId: anchor.npcId, secondName: anchor.name, second: who(anchor), tookSec: took };
    }
  }
  const first = anchor;
  const secondId = otherId;
  const secondName = nameOf(secondId, null);
  const dueAtMs = first.atMs + rule.windowSec * 1000;
  const left = secs(dueAtMs - nowMs);
  return left > 0
    ? { rule, status: 'open', first: who(first), secondId, secondName, dueAtMs, secondsLeft: left }
    : { rule, status: 'missed', first: who(first), secondId, secondName, second: null, tookSec: null };
}

/** Kills (any order) -> the ordered deaths with gaps, the clock since the last, and the state of each pair rule. */
export function buildTimeline(kills: Kill[], nowMs: number, rules: PairRule[] = PAIR_RULES): Timeline {
  const sorted = kills
    .filter(k => Number.isFinite(k.atMs) && k.atMs <= nowMs)
    .slice()
    .sort((x, y) => x.atMs - y.atMs || x.npcId - y.npcId);
  const deaths: TimelineDeath[] = sorted.map((k, i) => ({ ...k, gapSec: i === 0 ? null : secs(k.atMs - sorted[i - 1].atMs) }));
  const last = deaths.length ? deaths[deaths.length - 1] : null;
  return {
    deaths,
    last,
    sinceLastSec: last ? Math.max(0, secs(nowMs - last.atMs)) : null,
    pairs: rules.map(r => pairState(r, deaths, nowMs)),
  };
}

/** 7 -> "0:07", 502 -> "8:22", 3725 -> "1:02:05". */
export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return (h ? `${h}:` : '') + `${mm}:${String(r).padStart(2, '0')}`;
}

/** The shortest honest name for a mob on a tick: "Decorin Berik" -> "Berik", "Tallon Zek" stays. */
export function shortName(name: string): string {
  const m = /^Decorin (\w+)$/.exec(name);
  return m ? m[1] : name;
}
