// Soft Reserve (SR) per raid (the guild lead, 2026-10-26; DECISIONS §448). The pure rules: the caps, when picks lock,
// what a pick must satisfy and who sees what. No database here, so test/soft-reserve.test.js runs all of it; the
// reads are in lib/softReserveLoad.ts and the writes in app/raid/sr/actions.ts.
//
// What SR is: before a raid a member picks, for the ONE character they bring, the drops they want first claim on.
// When the item drops, reservers get it before the rest of the raid. A reserver may pass; it then goes to the next
// reserver, then to everyone. An item nobody reserved is open to the whole raid as usual. The bot enforces the
// order where it can (event-night rolls) and only shows it where it cannot (DKP bidding): lib/rolls.ts and
// utils/rollLoot.js hold the roll side.
//
// Relative imports only: the test loads this file as it is, with no `@/` alias.

export type Visibility = 'names' | 'counts' | 'hidden';
export type LockMode = 'start' | 'time' | 'first_loot' | 'manual';
export type NoReserve = 'open' | 'officer';

export type SrRules = {
  enabled: boolean;
  per_person: number;
  per_boss: number | null;
  visibility: Visibility;
  /** The bosses (npc ids) SR covers for the event. Empty = none picked yet. */
  npc_ids: number[];
  lock_mode: LockMode;
  lock_at: string | null;
  locked: boolean;
  no_reserve: NoReserve;
};

/** What an event with no sr_rules row gets: on, five picks, counts shown, locked when the raid starts. */
export const DEFAULT_RULES: SrRules = {
  enabled: true, per_person: 5, per_boss: null, visibility: 'counts', npc_ids: [],
  lock_mode: 'start', lock_at: null, locked: false, no_reserve: 'open',
};

export const VISIBILITIES: Visibility[] = ['counts', 'names', 'hidden'];
export const LOCK_MODES: LockMode[] = ['start', 'time', 'first_loot', 'manual'];

export const VISIBILITY_LABEL: Record<Visibility, string> = {
  counts: 'Counts open (names at drop time)',
  names: 'Names open',
  hidden: 'Hidden',
};
export const LOCK_LABEL: Record<LockMode, string> = {
  start: 'When the raid starts',
  time: 'At a set time',
  first_loot: 'At the first loot post',
  manual: 'When an officer locks it',
};

export type Pick = { npc_id: number; item_id: number };

/** Anything from the database is clamped back into the table's own checks, so a bad row cannot break the page. */
export function normalizeRules(raw: Partial<SrRules> | null | undefined): SrRules {
  const r = raw ?? {};
  const int = (v: unknown, lo: number, hi: number, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.trunc(n))) : d;
  };
  const per_boss = r.per_boss == null ? null : int(r.per_boss, 1, 10, 1);
  return {
    enabled: r.enabled !== false,
    per_person: int(r.per_person, 0, 20, DEFAULT_RULES.per_person),
    per_boss,
    visibility: VISIBILITIES.includes(r.visibility as Visibility) ? (r.visibility as Visibility) : DEFAULT_RULES.visibility,
    npc_ids: Array.isArray(r.npc_ids) ? [...new Set(r.npc_ids.map(Number).filter(n => Number.isInteger(n) && n > 0))] : [],
    lock_mode: LOCK_MODES.includes(r.lock_mode as LockMode) ? (r.lock_mode as LockMode) : DEFAULT_RULES.lock_mode,
    lock_at: r.lock_at ? String(r.lock_at) : null,
    locked: r.locked === true,
    no_reserve: r.no_reserve === 'officer' ? 'officer' : 'open',
  };
}

/**
 * Whether picks are closed. `locked` (set by an officer, or by the bot at the first /loot) closes them in every mode;
 * `start` closes at the event's start; `time` at lock_at. `first_loot` and `manual` otherwise stay open.
 */
export function isLocked(rules: SrRules, eventStartMs: number, nowMs: number): boolean {
  if (rules.locked) return true;
  if (rules.lock_mode === 'start') return Number.isFinite(eventStartMs) && nowMs >= eventStartMs;
  if (rules.lock_mode === 'time') {
    const at = rules.lock_at ? Date.parse(rules.lock_at) : NaN;
    return Number.isFinite(at) && nowMs >= at;
  }
  return false;
}

/** One line for the page: when picks close. */
export function lockLine(rules: SrRules, eventStartText: string, lockAtText: string | null): string {
  if (rules.locked) return 'Picks are locked.';
  switch (rules.lock_mode) {
    case 'start': return `Picks lock when the raid starts (${eventStartText}).`;
    case 'time': return lockAtText ? `Picks lock at ${lockAtText}.` : 'Picks lock at a time an officer sets.';
    case 'first_loot': return 'Picks lock when the first loot is posted.';
    default: return 'Picks stay open until an officer locks them.';
  }
}

export type PickCheck =
  | { ok: true }
  | { ok: false; reason: 'off' | 'locked' | 'not-a-target' | 'not-a-drop' | 'already' | 'person-cap' | 'boss-cap'; message: string };

export type PickContext = {
  rules: SrRules;
  eventStartMs: number;
  nowMs: number;
  /** Items each target drops (npc id → item ids), from the drop tables. */
  drops: ReadonlyMap<number, ReadonlySet<number>>;
  /** The bosses SR covers (rules.npc_ids, or the fallback the loader chose). */
  targets: readonly number[];
};

const no = (reason: Extract<PickCheck, { ok: false }>['reason'], message: string): PickCheck => ({ ok: false, reason, message });

/** Whether `add` may join this character's `mine` picks. Caps count the character's picks for the one event. */
export function checkAdd(ctx: PickContext, mine: readonly Pick[], add: Pick): PickCheck {
  const { rules } = ctx;
  if (!rules.enabled) return no('off', 'Soft Reserve is off for this raid.');
  if (isLocked(rules, ctx.eventStartMs, ctx.nowMs)) return no('locked', 'Picks are locked.');
  if (!ctx.targets.includes(add.npc_id)) return no('not-a-target', 'That boss is not one of this raid\'s targets.');
  if (!ctx.drops.get(add.npc_id)?.has(add.item_id)) return no('not-a-drop', 'That boss does not drop that item.');
  if (mine.some(p => p.npc_id === add.npc_id && p.item_id === add.item_id)) return no('already', 'Already picked.');
  if (mine.length >= rules.per_person) {
    return no('person-cap', `You have used all ${rules.per_person} of your picks. Drop one to pick another.`);
  }
  if (rules.per_boss != null && mine.filter(p => p.npc_id === add.npc_id).length >= rules.per_boss) {
    return no('boss-cap', `You can pick ${rules.per_boss} from this boss. Drop one to pick another.`);
  }
  return { ok: true };
}

/** Removing a pick is allowed only while picks are open (a locked list is the list the raid was told about). */
export function checkRemove(ctx: PickContext): PickCheck {
  if (!ctx.rules.enabled) return no('off', 'Soft Reserve is off for this raid.');
  if (isLocked(ctx.rules, ctx.eventStartMs, ctx.nowMs)) return no('locked', 'Picks are locked.');
  return { ok: true };
}

export type Surface = 'page' | 'card' | 'officer';
export type Shown = 'names' | 'counts' | 'none';

/**
 * What a surface may show of who reserved an item (rule 5). Officers always see names. The pick page shows what
 * the officer chose. The loot card at drop time names the reservers unless the raid is hidden, where it shows only
 * how many (the order still has to be known to settle the item; officers hold the names).
 */
export function shownOn(visibility: Visibility, surface: Surface): Shown {
  if (surface === 'officer') return 'names';
  if (surface === 'page') return visibility === 'names' ? 'names' : visibility === 'counts' ? 'counts' : 'none';
  return visibility === 'hidden' ? 'counts' : 'names';
}

/** The targets SR covers: the officers' picks, else the fallback (the night's plan), else none. */
export function chooseTargets(rules: SrRules, fallback: readonly number[]): number[] {
  return rules.npc_ids.length ? [...rules.npc_ids] : [...fallback];
}

/** "3 of 5 picks used" for a header; `per_boss` adds the boss's own count when asked for one. */
export function usedLine(rules: SrRules, mine: readonly Pick[]): string {
  return `${mine.length} of ${rules.per_person} picks used`;
}

/** Officer form input → rules. Returns an error text instead of clamping, so a typo is told rather than saved. */
export function parseRulesForm(input: {
  enabled: boolean; per_person: string; per_boss: string; visibility: string; npc_ids: number[]; lock_mode: string;
  lock_at: string; no_reserve: string;
}): { ok: true; rules: Omit<SrRules, 'locked'> } | { ok: false; message: string } {
  const pp = Number(input.per_person);
  if (!Number.isInteger(pp) || pp < 0 || pp > 20) return { ok: false, message: 'Picks per person must be a whole number from 0 to 20.' };
  let per_boss: number | null = null;
  if (input.per_boss.trim() !== '') {
    const pb = Number(input.per_boss);
    if (!Number.isInteger(pb) || pb < 1 || pb > 10) return { ok: false, message: 'Picks per boss must be blank or a whole number from 1 to 10.' };
    per_boss = pb;
  }
  if (!VISIBILITIES.includes(input.visibility as Visibility)) return { ok: false, message: 'Pick who sees the names.' };
  if (!LOCK_MODES.includes(input.lock_mode as LockMode)) return { ok: false, message: 'Pick when picks lock.' };
  let lock_at: string | null = null;
  if (input.lock_mode === 'time') {
    const ms = Date.parse(input.lock_at);
    if (!Number.isFinite(ms)) return { ok: false, message: 'Enter the time picks lock.' };
    lock_at = new Date(ms).toISOString();
  }
  const npc_ids = [...new Set(input.npc_ids.filter(n => Number.isInteger(n) && n > 0))];
  return {
    ok: true,
    rules: {
      enabled: input.enabled, per_person: pp, per_boss, visibility: input.visibility as Visibility, npc_ids,
      lock_mode: input.lock_mode as LockMode, lock_at, no_reserve: input.no_reserve === 'officer' ? 'officer' : 'open',
    },
  };
}
