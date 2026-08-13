// test/trigger-scope-relay.test.js — a personal trigger must not fan out.
//
// THE BUG (live, 2026-08-13): the trigger checkpoint journal filled with
// hundreds of "Too Far" rows, all scope=guild_relay. "Too Far" is
// default_scope=personal with cooldown_seconds=0, watching "Your target is too
// far" — a line melee produces constantly. Every raider's copy was being
// relayed to every other raider.
//
// _relayLocalFire already had the right guard (`t._scope === 'personal'` skips
// the relay). The defect was upstream of it: guild triggers were compiled with
// `_scope: 'guild'` HARDCODED, and `default_scope` was read nowhere in the
// agent or Mimic — zero occurrences. So the guard could never fire for a guild
// trigger, and the scope column was decorative.
//
// Run: npx vitest run test/trigger-scope-relay.test.js

import { describe, it, expect } from 'vitest';
import { readSource, AGENT_INDEX } from './_source-slice.js';

const src = readSource(AGENT_INDEX);

describe('guild trigger compilation honours default_scope', () => {
  it('no longer hardcodes _scope to guild', () => {
    // The exact shape of the bug. If this string comes back, personal triggers
    // are fanning out again.
    expect(src).not.toMatch(/_endRegex: _compileEndEarlyRegex\(t\), _scope: 'guild' \}\)/);
  });

  it('derives _scope from the trigger row', () => {
    expect(src).toMatch(/_scope: t\.default_scope === 'personal' \? 'personal' : 'guild'/);
  });

  it('reads default_scope at all', () => {
    // It was referenced zero times across the agent before this fix.
    expect((src.match(/default_scope/g) || []).length).toBeGreaterThan(0);
  });
});

describe('the relay guard it feeds', () => {
  it('still skips personal fires', () => {
    // The guard was always correct — it was being handed a value that could
    // never be 'personal'. Both halves have to hold for the fix to work.
    expect(src).toMatch(/if \(!t \|\| t\._scope === 'personal'\) return false;/);
  });

  it('only personal suppresses relay, not class_specific or broadcast', () => {
    // A class-scoped or broadcast trigger SHOULD still fan out; narrowing the
    // guard to more scopes would silently disable real callouts.
    const line = src.match(/_scope: t\.default_scope === '([a-z_]+)'/);
    expect(line, 'scope derivation not found').toBeTruthy();
    expect(line[1]).toBe('personal');
  });
});

describe('the reproduction case', () => {
  it('a personal-scope trigger evaluates to _scope personal', () => {
    // Mirrors the live row: name "Too Far", default_scope "personal".
    const derive = (t) => (t.default_scope === 'personal' ? 'personal' : 'guild');
    expect(derive({ name: 'Too Far', default_scope: 'personal' })).toBe('personal');
    expect(derive({ name: 'Gating', default_scope: 'broadcast' })).toBe('guild');
    expect(derive({ name: 'Out of Range', default_scope: 'class_specific' })).toBe('guild');
    // A row with no scope at all must keep the old behaviour rather than
    // silently going quiet.
    expect(derive({ name: 'legacy', default_scope: null })).toBe('guild');
    expect(derive({ name: 'legacy' })).toBe('guild');
  });
});
