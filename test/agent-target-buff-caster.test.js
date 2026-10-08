// test/agent-target-buff-caster.test.js — Target Info names who cast an effect.
//
// The guild lead, 2026-10-08: mousing over the time left "should show you how long it lasted and who
// cast it". EverQuest's landing lines never name a caster, so the agent takes it from the bot's cast
// relay: GET /api/agent/target-casts now carries `last_casters` ([{ spell, caster, at_ms }]), kept
// beside the casts cache and merged onto each target_buffs row by spell name. When a caster is attached
// and the length is unknown, the catalog length fills total_secs (never below what is left).
//
// Runs the REAL shipped functions, sliced out of the agent. Names are invented example tokens.
//
// Run: npx vitest run test/agent-target-buff-caster.test.js

import { describe, it, expect } from 'vitest';
import { readSource, AGENT_INDEX, sliceBlock, stripJs } from './_source-slice.js';

const src = readSource(AGENT_INDEX);

const attachSrc = sliceBlock(src, 'function _attachBuffCasters(buffs, lastCasters) {', '\n}\n');
const fetchSrc = sliceBlock(src, 'function fetchTargetCasts(name, selfChar, targetId) {', '\n}\n');

// _catalogDurationSec stubbed to a small table (name lower → seconds); the real one is the era-cap
// level fallback and is covered by the duration tests.
function attach(secsByName = {}) {
  const calls = [];
  const _catalogDurationSec = (n) => { calls.push(n); return secsByName[String(n).toLowerCase()] ?? null; };
  const { _attachBuffCasters } = new Function('_catalogDurationSec', attachSrc + '\nreturn { _attachBuffCasters };')(_catalogDurationSec);
  return { _attachBuffCasters, calls };
}

const lc = (spell, caster, at_ms = 1) => ({ spell, caster, at_ms });

describe('_attachBuffCasters', () => {
  it('names the caster by spell name, case-insensitively', () => {
    const { _attachBuffCasters } = attach({ tashania: 999 });   // catalog disagrees; the known length stays
    const out = _attachBuffCasters(
      [{ name: 'Tashania', remaining_secs: 100, total_secs: 200, good: 0 }],
      [lc('tashania', 'Aldenmar')],
    );
    expect(out[0].caster).toBe('Aldenmar');
    expect(out[0].total_secs).toBe(200);   // a known length is never touched
  });

  it('matches a backtick and an apostrophe spelling of the same spell', () => {
    const { _attachBuffCasters } = attach();
    const out = _attachBuffCasters([{ name: "Largo's Assonant Binding", remaining_secs: 5 }], [lc('Largo`s Assonant Binding', 'Brackwyn')]);
    expect(out[0].caster).toBe('Brackwyn');
  });

  it('leaves a buff with no remembered caster untouched', () => {
    const { _attachBuffCasters } = attach({ malo: 300 });
    const buff = { name: 'Malo', remaining_secs: 50, total_secs: null };
    const out = _attachBuffCasters([buff], [lc('Tashania', 'Aldenmar')]);
    expect(out[0]).toBe(buff);
    expect(out[0].caster).toBeUndefined();
    expect(out[0].total_secs).toBeNull();   // no caster, so no catalog fill either
  });

  it('keeps a charm owner and an existing caster', () => {
    const { _attachBuffCasters } = attach();
    const rows = [
      { name: 'Allure', owner: 'Corvale', remaining_secs: 10 },
      { name: 'Malo', caster: 'Rethlan', remaining_secs: 10 },
    ];
    const out = _attachBuffCasters(rows, [lc('Allure', 'Aldenmar'), lc('Malo', 'Aldenmar')]);
    expect(out[0].caster).toBeUndefined();
    expect(out[0].owner).toBe('Corvale');
    expect(out[1].caster).toBe('Rethlan');
  });

  it('the newest remembered caster wins when the bot lists a spell twice', () => {
    const { _attachBuffCasters } = attach();
    const out = _attachBuffCasters([{ name: 'Malo', remaining_secs: 10 }], [lc('Malo', 'Nyssara', 9), lc('Malo', 'Zarrin', 1)]);
    expect(out[0].caster).toBe('Nyssara');
  });

  it('does not mutate its input rows', () => {
    const { _attachBuffCasters } = attach({ malo: 300 });
    const buff = { name: 'Malo', remaining_secs: 50, total_secs: null };
    _attachBuffCasters([buff], [lc('Malo', 'Aldenmar')]);
    expect(buff).toEqual({ name: 'Malo', remaining_secs: 50, total_secs: null });
  });

  it('passes through when there is nothing to merge', () => {
    const { _attachBuffCasters } = attach();
    const rows = [{ name: 'Malo', remaining_secs: 10 }];
    expect(_attachBuffCasters(rows, [])).toBe(rows);
    expect(_attachBuffCasters(rows, null)).toBe(rows);
    expect(_attachBuffCasters(rows, undefined)).toBe(rows);
    expect(_attachBuffCasters(rows, [null, { spell: 'Malo' }, { caster: 'Aldenmar' }])).toBe(rows);
    expect(_attachBuffCasters([], [lc('Malo', 'Aldenmar')])).toEqual([]);
    expect(_attachBuffCasters(null, [lc('Malo', 'Aldenmar')])).toBeNull();
  });
});

describe('real length', () => {
  it('fills an unknown total from the catalog when a caster is attached', () => {
    const { _attachBuffCasters } = attach({ celerity: 1800 });
    const out = _attachBuffCasters([{ name: 'Celerity', remaining_secs: 1200, total_secs: null }], [lc('Celerity', 'Aldenmar')]);
    expect(out[0]).toMatchObject({ caster: 'Aldenmar', total_secs: 1800 });
  });

  it('never goes below what is left on the timer', () => {
    // Catalog says 12 min but the live timer still has 20 (a longer-than-catalog focus, say).
    const { _attachBuffCasters } = attach({ celerity: 720 });
    const out = _attachBuffCasters([{ name: 'Celerity', remaining_secs: 1200, total_secs: null }], [lc('Celerity', 'Aldenmar')]);
    expect(out[0].total_secs).toBe(1200);
  });

  it('stays null when the catalog has no length for it', () => {
    const { _attachBuffCasters } = attach();
    const out = _attachBuffCasters([{ name: 'Mystery', remaining_secs: 40, total_secs: null }], [lc('Mystery', 'Aldenmar')]);
    expect(out[0]).toMatchObject({ caster: 'Aldenmar', total_secs: null });
  });

  it('copes with a live buff that has no time left reading', () => {
    const { _attachBuffCasters } = attach({ celerity: 720 });
    const out = _attachBuffCasters([{ name: 'Celerity', remaining_secs: null, total_secs: null }], [lc('Celerity', 'Aldenmar')]);
    expect(out[0].total_secs).toBe(720);
  });
});

describe('the casts cache keeps last_casters', () => {
  // fetchTargetCasts with its network and caches stubbed; the response body is whatever the test says.
  function run(body) {
    const cache = new Map();
    const http = {
      request(_opts, cb) {
        const handlers = {};
        const res = { on: (e, f) => { handlers[e] = f; } };
        return {
          on() {}, destroy() {},
          end() { cb(res); handlers.data(body); handlers.end(); },
        };
      },
    };
    const fetchTargetCasts = new Function(
      '_uploadOpts', '_relayCacheKey', '_targetCastsInflight', '_targetCastsByName', 'TARGET_CASTS_TTL_MS',
      'https', 'http', 'AGENT_VERSION', 'URL',
      fetchSrc + '\nreturn fetchTargetCasts;',
    )(
      { botUrl: 'http://bot.invalid/api/agent/encounter', token: 't' },
      (n) => String(n).toLowerCase(), new Set(), cache, 2000, http, http, '0.0.0', URL,
    );
    fetchTargetCasts('a gnoll pup', 'Rethlan', null);
    return cache.get('a gnoll pup');
  }

  it('stores what the bot sent', () => {
    const got = run(JSON.stringify({ casts: [], last_casters: [{ spell: 'Malo', caster: 'Aldenmar', at_ms: 5 }] }));
    expect(got.last_casters).toEqual([{ spell: 'Malo', caster: 'Aldenmar', at_ms: 5 }]);
    expect(got.casts).toEqual([]);
  });

  it('an older bot (no field) and a bad body both give an empty list, casts unaffected', () => {
    expect(run(JSON.stringify({ casts: [{ caster: 'Aldenmar', spell: 'Malo' }] }))).toMatchObject({
      casts: [{ caster: 'Aldenmar', spell: 'Malo' }], last_casters: [],
    });
    expect(run('not json')).toMatchObject({ casts: [], last_casters: [] });
    expect(run(JSON.stringify({ casts: [], last_casters: 'nope' })).last_casters).toEqual([]);
  });
});

describe('Target Info build applies it', () => {
  // The builder is far too large to lift whole, so this pins the call, comments stripped.
  const code = stripJs(src);
  it('merges last_casters onto the finished buff list, for mobs and players alike', () => {
    const wired = code.indexOf('buffs = _attachBuffCasters(buffs, ctc ? ctc.last_casters : null);');
    expect(wired).toBeGreaterThan(-1);
    // After every branch that fills `buffs` (Zeal, live-state, observed+relayed) and before the slot counts.
    expect(wired).toBeGreaterThan(code.indexOf('buffs = _collapseObservedBuffSlots(buffs);'));
    expect(wired).toBeLessThan(code.indexOf('let slotCounts = null;'));
  });
});
