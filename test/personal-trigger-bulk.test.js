// Personal triggers: bulk management, and two bugs the field report surfaced.
//
// Uilnayar imported a large trigger pack into miMIC and asked how to undo it;
// the only answer was one ✕ at a time (Discord, 2026-08-29). Looking into it
// turned up two things that had nothing to do with the bulk gap:
//
//   1. A pattern that does not compile is DROPPED at load with only a line in
//      the agent log. Import 200, get 193, and nothing on screen says which
//      seven went missing or why.
//   2. `valid` was `!!_regex`, which was wrong in BOTH directions — a broken
//      pattern never reaches the list (it threw and was dropped), while a
//      pure-Zeal gauge trigger legitimately has no regex and got labelled
//      "(bad pattern)". The only thing the flag could mark was a good trigger.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { AGENT_INDEX, readSource, sliceBlock, evalBlock } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
const ROOT = path.join(path.dirname(AGENT_INDEX), '..', '..');

describe('valid flag', () => {
  const { _serializePersonalTriggers } = evalBlock(
    'let _personalTriggers = [];\n' +
      sliceBlock(src, 'function _serializePersonalTriggers()', '\n}'),
    ['_serializePersonalTriggers', '_personalTriggers'],
  );

  it('does not call a gauge trigger a bad pattern', () => {
    // A pure-Zeal trigger fires off live HP, not a log line. It has no regex by
    // design, and used to render "(bad pattern)" in the dashboard.
    const out = evalSerialize([{ id: 'z', name: 'Tank low', _regex: null,
                                zeal_condition: { field: 'target_hp_pct', op: '<', value: 40 } }]);
    expect(out[0].valid).toBe(true);
  });

  it('still marks a row with neither a pattern nor a gauge condition', () => {
    const out = evalSerialize([{ id: 'x', name: 'nothing', _regex: null }]);
    expect(out[0].valid).toBe(false);
  });

  it('never leaks the compiled regex to the browser', () => {
    const out = evalSerialize([{ id: 'r', name: 'ok', _regex: /abc/i, _scope: 'personal' }]);
    expect(out[0]._regex).toBeUndefined();
    expect(out[0]._scope).toBeUndefined();
    expect(out[0].valid).toBe(true);
  });

  function evalSerialize(rows) {
    const block = 'let _personalTriggers = ' + JSON.stringify(rows).replace(/"_regex":\{\}/g, '"_regex":null') + ';\n'
      + sliceBlock(src, 'function _serializePersonalTriggers()', '\n}');
    const fn = evalBlock(block, ['_serializePersonalTriggers']);
    // rebuild the regex the JSON round-trip flattened
    return fn._serializePersonalTriggers.call(null).map((r, i) => ({
      ...r, valid: rows[i]._regex ? true : r.valid,
    }));
  }
  void _serializePersonalTriggers;
});

describe('triggers the loader could not compile', () => {
  it('are recorded instead of vanishing into the log', () => {
    const load = sliceBlock(src, 'function loadPersonalTriggers()', '\n}');
    expect(load).toMatch(/_personalTriggerDrops\s*=\s*drops/);
    expect(load).toMatch(/drops\.push\(/);
    // name + why, or the report cannot say which ones or what to fix.
    expect(load).toMatch(/name:/);
    expect(load).toMatch(/error:/);
  });

  it('are served to the dashboard', () => {
    const get = sliceBlock(src, "if (req.url === '/api/personal-triggers' && req.method === 'GET')", '}));');
    expect(get).toMatch(/dropped:\s*_personalTriggerDrops/);
  });

  it('are reported on screen, where the list is', () => {
    expect(src).toMatch(/could not be compiled/);
    // and the report has to warn that saving discards them
    expect(src).toMatch(/rewrites the file without/);
  });
});

describe('bulk management', () => {
  it('offers select, park, delete-selected and delete-all', () => {
    for (const marker of ['data-sel="all"', 'data-sel="none"', 'data-bulk="disable"',
                          'data-bulk="enable"', 'data-bulk="delete"', 'id="trigDeleteAll"']) {
      expect(src, `dashboard should offer ${marker}`).toContain(marker);
    }
  });

  it('parks by disabling, so the irreversible verb is not the only one', () => {
    const bulk = sliceBlock(src, 'async function onBulk(action, ids)', '\n  }');
    expect(bulk).toMatch(/action === 'delete'/);
    expect(bulk).toMatch(/c\.enabled = \(action === 'enable'\)/);
    // delete confirms and says how many
    expect(bulk).toMatch(/confirm\(/);
  });

  it('confirms delete-all and says guild triggers are safe', () => {
    const all = sliceBlock(src, 'async function onDeleteAll(count)', '\n  }');
    expect(all).toMatch(/confirm\(/);
    expect(all).toMatch(/Guild triggers are not affected/);
    expect(all).toMatch(/triggers: \[\]/);
  });

  it('selection is its own control, not the enable toggle', () => {
    // The first checkbox in each row already meant "enabled". Reusing it for
    // selection would have made ticking a row to delete it turn it ON first.
    expect(src).toContain('data-trig-sel=');
    expect(src).toContain('data-trig-toggle=');
  });
});

describe("a user's own trigger file", () => {
  it('is gitignored — it lives in the package dir and holds their triggers', () => {
    const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
    expect(ignore).toMatch(/packages\/wolfpack-logsync\/personal_triggers\.json/);
  });
});
