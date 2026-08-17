// test/fight-cards.test.js — the fight-card resolver (docs/DESIGN-fight-cards.md).
//
// The one behavior that must never regress: a trigger id that no longer
// resolves reports MISSING loudly. An enabled trigger reads as coverage —
// three dead-but-enabled triggers hid for weeks behind exactly that — and a
// pre-raid card that silently drops a broken link would repeat the mistake in
// the other direction.
//
// Run: npx vitest run test/fight-cards.test.js

import { describe, it, expect } from 'vitest';
import { resolveTriggers, triggerSummary, ttsOf, orderCards } from '../web/lib/fightCards.ts';

const trig = (id, name, enabled, extra = {}) => ({
  id, name, enabled,
  timer_duration_sec: null, warning_seconds: null, warning_text: null,
  cooldown_seconds: null, actions: null, updated_at: null,
  ...extra,
});
const byId = (...ts) => new Map(ts.map(t => [t.id, t]));

describe('resolveTriggers', () => {
  it('armed / denoted / missing tri-state', () => {
    const m = byId(trig('a', 'Freezing Breath', true), trig('b', 'LoS check — SAFE', false));
    const r = resolveTriggers(['a', 'b', 'ghost'], m);
    expect(r.map(x => x.state)).toEqual(['armed', 'denoted', 'missing']);
    expect(r[2].name).toBe('ghost');   // the raw id stays visible so an officer can fix it
  });

  it('carries timer/warning/cooldown through for the tactics line', () => {
    const m = byId(trig('a', 'Freezing Breath', true, {
      timer_duration_sec: 15, warning_seconds: 3, warning_text: 'Melee out', cooldown_seconds: 4,
      actions: [{ type: 'text_overlay', text: 'AOE' }, { type: 'tts', text: 'A O E' }],
    }));
    const [r] = resolveTriggers(['a'], m);
    expect(r).toMatchObject({ timerSec: 15, warningSec: 3, warningText: 'Melee out', cooldownSec: 4, tts: 'A O E' });
  });

  it('null/undefined id lists resolve to nothing rather than throwing', () => {
    expect(resolveTriggers(null, byId())).toEqual([]);
    expect(resolveTriggers(undefined, byId())).toEqual([]);
  });
});

describe('ttsOf — defensive over the actions jsonb', () => {
  it('finds tts in the array shape and the bare-object shape', () => {
    expect(ttsOf([{ type: 'tts', text: 'A O E' }])).toBe('A O E');
    expect(ttsOf({ type: 'tts', text: 'Melee out' })).toBe('Melee out');
    expect(ttsOf([{ tts: 'Shaman Slow' }])).toBe('Shaman Slow');
  });
  it('returns null for overlay-only, garbage, and empties', () => {
    expect(ttsOf([{ type: 'text_overlay', text: 'AOE' }])).toBe(null);
    expect(ttsOf('nonsense')).toBe(null);
    expect(ttsOf(null)).toBe(null);
    expect(ttsOf([{ type: 'tts', text: '  ' }])).toBe(null);
  });
});

describe('triggerSummary', () => {
  const R = (state) => ({ id: 'x', state, name: 'x', timerSec: null, warningSec: null, warningText: null, cooldownSec: null, tts: null });

  it('MISSING dominates every other state', () => {
    const s = triggerSummary([R('armed'), R('missing'), R('denoted')]);
    expect(s.level).toBe('bad');
    expect(s.label).toContain('MISSING');
  });
  it('all armed is ok; a deliberate denotation does not read as failure', () => {
    expect(triggerSummary([R('armed'), R('armed')])).toEqual({ label: '2 armed', level: 'ok' });
    expect(triggerSummary([R('armed'), R('denoted')]).level).toBe('ok');
    expect(triggerSummary([R('denoted')]).level).toBe('warn');
  });
  it('no linked callouts is its own quiet state, not a warning', () => {
    expect(triggerSummary([]).level).toBe('none');
  });
});

describe('orderCards', () => {
  it('sort_order first, stable title tiebreak (the two Tunares)', () => {
    const cards = [
      { sort_order: 2, title: 'Tunare — the kill', boss_npc_id: 127002 },
      { sort_order: 1, title: null, boss_npc_id: 124128 },
      { sort_order: 2, title: 'Tunare — the kite', boss_npc_id: 127001 },
    ];
    // Alphabetical title tiebreak: "kill" < "kite" ('l' < 't').
    expect(orderCards(cards).map(c => c.boss_npc_id)).toEqual([124128, 127002, 127001]);
  });
});
