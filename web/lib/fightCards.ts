// Fight Cards — pure resolution helpers (docs/DESIGN-fight-cards.md, task #43).
//
// A card's tactics column is only trustworthy if it reflects guild_triggers AS
// THEY ARE, not as they were when the card was written — an enabled trigger
// reads as coverage, which is exactly how three dead triggers hid for weeks.
// So the card stores trigger IDS and this module resolves them against the
// live rows at render time: armed / denoted (exists but disabled — the LoS
// probes, deliberately) / MISSING (id no longer resolves — deleted or
// mistyped; the loud state, because a card promising a callout that cannot
// fire is the worst lie on a pre-raid page).
//
// No React/Next imports on purpose: the root vitest suite real-imports it.

export type FightCardRow = {
  id: string;
  boss_npc_id: number;
  title: string | null;
  comp_notes: string | null;
  kit_notes: string | null;
  tactics: string | null;
  trigger_ids: string[] | null;
  guide_ref: string | null;
  sort_order: number;
  active: boolean;
  updated_by: string | null;
  updated_at: string;
};

export type TriggerRow = {
  id: string;
  name: string;
  enabled: boolean;
  timer_duration_sec: number | null;
  warning_seconds: number | null;
  warning_text: string | null;
  cooldown_seconds: number | null;
  actions: unknown;
  updated_at: string | null;
};

export type ResolvedTrigger = {
  id: string;
  state: 'armed' | 'denoted' | 'missing';
  name: string;                 // '(missing)' ids keep the raw id as the name
  timerSec: number | null;
  warningSec: number | null;
  warningText: string | null;
  cooldownSec: number | null;
  tts: string | null;           // what the callout SAYS, from the actions jsonb
};

// The actions jsonb is agent-shaped and has grown fields over time; be
// defensive and only pull the one thing the card wants to show — the spoken
// text. Accepts both the array-of-actions shape and a bare object.
export function ttsOf(actions: unknown): string | null {
  const list = Array.isArray(actions) ? actions : (actions && typeof actions === 'object' ? [actions] : []);
  for (const a of list as Record<string, unknown>[]) {
    if (!a || typeof a !== 'object') continue;
    if (a.type === 'tts' && typeof a.text === 'string' && a.text.trim()) return a.text.trim();
    if (typeof a.tts === 'string' && a.tts.trim()) return a.tts.trim();
  }
  return null;
}

export function resolveTriggers(
  ids: string[] | null | undefined,
  triggersById: Map<string, TriggerRow>,
): ResolvedTrigger[] {
  return (Array.isArray(ids) ? ids : []).map(id => {
    const t = triggersById.get(id);
    if (!t) {
      return { id, state: 'missing' as const, name: id, timerSec: null,
               warningSec: null, warningText: null, cooldownSec: null, tts: null };
    }
    return {
      id,
      state: t.enabled ? ('armed' as const) : ('denoted' as const),
      name: t.name,
      timerSec: t.timer_duration_sec ?? null,
      warningSec: t.warning_seconds ?? null,
      warningText: t.warning_text ?? null,
      cooldownSec: t.cooldown_seconds ?? null,
      tts: ttsOf(t.actions),
    };
  });
}

// sort_order wins; ties break on title/boss so the order is stable for two
// cards an officer never explicitly ordered (the two Tunares).
export function orderCards<T extends Pick<FightCardRow, 'sort_order' | 'title' | 'boss_npc_id'>>(cards: T[]): T[] {
  return [...cards].sort((a, b) =>
    (a.sort_order - b.sort_order)
    || (a.title || '').localeCompare(b.title || '')
    || (a.boss_npc_id - b.boss_npc_id));
}

// One-line readiness verdict for the card header. MISSING dominates (a broken
// promise beats everything); otherwise armed counts against the total, and a
// card with no triggers at all is simply "no callouts" — plenty of fights
// legitimately have none.
export function triggerSummary(resolved: ResolvedTrigger[]): { label: string; level: 'ok' | 'warn' | 'bad' | 'none' } {
  if (resolved.length === 0) return { label: 'no callouts linked', level: 'none' };
  const missing = resolved.filter(r => r.state === 'missing').length;
  if (missing > 0) return { label: `${missing} callout${missing === 1 ? '' : 's'} MISSING`, level: 'bad' };
  const armed = resolved.filter(r => r.state === 'armed').length;
  if (armed === resolved.length) return { label: `${armed} armed`, level: 'ok' };
  return { label: `${armed} armed · ${resolved.length - armed} denoted (off)`, level: armed > 0 ? 'ok' : 'warn' };
}
