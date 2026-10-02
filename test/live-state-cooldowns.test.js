// A character's own known timers ride their live-state upload and come back on
// character-live-state, so another raider's Target Info can show them (the guild
// lead, 2026-10-02: "When we have a known timer, for someone's disciplines or mend
// or area taunt, we should display those on target info").
import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, evalBlock, stripJs, BOT_INDEX } from './_source-slice.js';

const src = readSource(BOT_INDEX);
const { _sanitizeLiveCooldowns } = evalBlock(
  sliceBlock(src, 'const _LIVE_CD_MAX', '  return out.length ? out : null;\n}'),
  ['_sanitizeLiveCooldowns'],
);
const NOW = Date.parse('2026-10-02T06:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

describe('_sanitizeLiveCooldowns', () => {
  it('keeps a well-formed timer, normalising ready_at to ISO', () => {
    const out = _sanitizeLiveCooldowns([
      { key: 'disc', label: 'Aggressive', ready_at: iso(NOW + 600_000), total_ms: 1_620_000, est: true },
    ], NOW);
    expect(out).toEqual([{ key: 'disc', label: 'Aggressive', ready_at: iso(NOW + 600_000), total_ms: 1_620_000, est: true }]);
  });

  it('keeps an AA key and a timer that is already ready', () => {
    const out = _sanitizeLiveCooldowns([
      { key: 'aa:area_taunt', label: 'Area Taunt', ready_at: iso(NOW - 3600_000), total_ms: null, est: false },
    ], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe('aa:area_taunt');
    expect(out[0].total_ms).toBeNull();
    expect(out[0].est).toBe(false);
  });

  it('drops bad keys, empty labels and out-of-range times', () => {
    const out = _sanitizeLiveCooldowns([
      { key: 'Disc', label: 'x', ready_at: iso(NOW) },                    // upper case
      { key: 'mend', label: '', ready_at: iso(NOW) },                     // no label
      { key: 'mend', label: 'Mend', ready_at: 'soon' },                   // not a time
      { key: 'mend', label: 'Mend', ready_at: iso(NOW - 13 * 3600_000) }, // too old
      { key: 'loh', label: 'Lay on Hands', ready_at: iso(NOW + 5 * 3600_000) }, // too far out
      { key: 'ht', label: 'Harm Touch', ready_at: iso(NOW + 60_000), total_ms: 9e9 },
    ], NOW);
    expect(out).toEqual([{ key: 'ht', label: 'Harm Touch', ready_at: iso(NOW + 60_000), total_ms: null, est: false }]);
  });

  it('caps the list and returns null for nothing usable', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ key: 'k' + i, label: 'L' + i, ready_at: iso(NOW) }));
    expect(_sanitizeLiveCooldowns(many, NOW)).toHaveLength(12);
    expect(_sanitizeLiveCooldowns([], NOW)).toBeNull();
    expect(_sanitizeLiveCooldowns(null, NOW)).toBeNull();
    expect(_sanitizeLiveCooldowns([{ key: 'x' }], NOW)).toBeNull();
  });
});

describe('the column is written and read back', () => {
  it('the live-state upsert stores cooldowns', () => {
    const block = stripJs(sliceBlock(src, 'async function _handleAgentLiveState(', '\n}\n'));
    expect(block).toMatch(/const cooldowns = _sanitizeLiveCooldowns\(st\?\.cooldowns, Date\.now\(\)\);/);
    expect(block).toMatch(/^\s+cooldowns,$/m);
  });
  it('character-live-state selects and returns them', () => {
    const block = stripJs(sliceBlock(src, 'async function _handleAgentCharacterLiveState(', '\n}\n'));
    expect(block).toMatch(/select=character,[^`]*\bcooldowns\b/);
    expect(block).toMatch(/cooldowns: Array\.isArray\(r\.cooldowns\) \? r\.cooldowns : \[\]/);
  });
  it('the migration adds the column', () => {
    const mig = readSource(new URL('../supabase/migrations/20261002061352_live_state_cooldowns.sql', import.meta.url).pathname);
    expect(mig).toMatch(/ADD COLUMN IF NOT EXISTS cooldowns jsonb/);
  });
});
