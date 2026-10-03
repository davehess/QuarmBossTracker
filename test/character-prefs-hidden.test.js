// characters.hidden_from_lists rides the character-prefs payload — SOURCE-SLICE fidelity tier.
//
// The guild lead, 2026-10-03: "put any unknown characters into a minimized area and make it so I
// can hide these characters from anything but account inventory". The owner-set column is display
// only; the bot's whole job is to hand it to the agent beside the other per-character prefs
// (GET /api/agent/character-prefs and the multiplexed /poll both call _characterPrefsFor). Runs the
// REAL function against a fake utils/supabase: what it asks PostgREST for, and what shape each
// prefs entry comes back in.
//
// Run: npx vitest run test/character-prefs-hidden.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { readSource, sliceBlock, evalBlock, BOT_INDEX } from './_source-slice.js';

const src = readSource(BOT_INDEX);
const fn = sliceBlock(src, 'async function _characterPrefsFor(characters) {', '\n  return { prefs };\n}');

let selects, rows, enabled;
function load() {
  globalThis.__prefsTest = { selects, get rows() { return rows; }, get enabled() { return enabled; } };
  const prefix = `
    const __t = globalThis.__prefsTest;
    const require = (m) => {
      if (m === './utils/supabase') {
        return {
          isEnabled: () => __t.enabled,
          select: async (table, query) => { __t.selects.push({ table, query }); return __t.rows; },
        };
      }
      throw new Error('unexpected require: ' + m);
    };
  `;
  return evalBlock(prefix + fn, ['_characterPrefsFor']);
}

beforeEach(() => {
  selects = [];
  rows = [];
  enabled = true;
});

describe('_characterPrefsFor hidden_from_lists', () => {
  it('asks the characters table for the column', async () => {
    const { _characterPrefsFor } = load();
    await _characterPrefsFor(['Aldenmar']);
    expect(selects).toHaveLength(1);
    expect(selects[0].table).toBe('characters');
    const select = decodeURIComponent(selects[0].query).match(/select=([^&]*)/)[1].split(',');
    expect(select).toContain('hidden_from_lists');
    // the three prefs it always carried are still asked for
    for (const col of ['name', 'exclude_from_stats', 'exclude_inventory', 'tell_relay']) {
      expect(select).toContain(col);
    }
  });

  it('puts a boolean on every entry, true only where the owner set it', async () => {
    rows = [
      { name: 'Aldenmar', exclude_from_stats: false, exclude_inventory: false, tell_relay: false, hidden_from_lists: true },
      { name: 'Brackwyn', exclude_from_stats: false, exclude_inventory: false, tell_relay: false, hidden_from_lists: false },
      { name: 'Corvale',  exclude_from_stats: true,  exclude_inventory: false, tell_relay: true },   // column absent / null
      { name: 'Rethlan',  hidden_from_lists: null },
    ];
    const { _characterPrefsFor } = load();
    const { prefs } = await _characterPrefsFor(['Aldenmar', 'Brackwyn', 'Corvale', 'Rethlan']);
    expect(prefs.Aldenmar.hidden_from_lists).toBe(true);
    expect(prefs.Brackwyn.hidden_from_lists).toBe(false);
    expect(prefs.Corvale.hidden_from_lists).toBe(false);
    expect(prefs.Rethlan.hidden_from_lists).toBe(false);
  });

  it('is independent of the data-handling prefs: hiding stops no upload', async () => {
    rows = [{ name: 'Nyssara', exclude_from_stats: false, exclude_inventory: false, tell_relay: false, hidden_from_lists: true }];
    const { _characterPrefsFor } = load();
    const { prefs } = await _characterPrefsFor(['Nyssara']);
    expect(prefs.Nyssara).toEqual({
      exclude_from_stats: false,   // the agent keeps uploading everything for a hidden character
      exclude_inventory:  false,
      tell_relay:         false,
      hidden_from_lists:  true,
    });
  });

  it('keeps the empty and disabled answers it had', async () => {
    const { _characterPrefsFor } = load();
    expect(await _characterPrefsFor([])).toEqual({ prefs: {} });
    enabled = false;
    expect(await _characterPrefsFor(['Zarrin'])).toEqual({ prefs: {}, note: 'supabase disabled' });
    expect(selects).toHaveLength(0);
  });
});
