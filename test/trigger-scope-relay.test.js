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

// ---------------------------------------------------------------------------
describe('hide-all silences the screen, not the voice', () => {
  const main = readSource(new URL('../apps/mimic/main.js', import.meta.url).pathname);

  it('does NOT list enableTriggerTts in _HIDEALL_FLAGS', () => {
    // enableTriggerTts is the flag _OVERLAY_WINDOWS gates the trigger window's
    // EXISTENCE on. Listing it here made hide-all destroy the renderer that
    // owns speechSynthesis, so every callout — and Rehearse — went silent with
    // no error anywhere.
    const list = main.slice(main.indexOf('const _HIDEALL_FLAGS = ['));
    const body = list.slice(0, list.indexOf('];'));
    expect(body).not.toMatch(/'enableTriggerTts'/);
    expect(body).toMatch(/'showTriggerOverlay'/);
  });

  it('snapshots showTriggerOverlay as TRI-STATE, not with a bare !!', () => {
    // undefined means VISIBLE (applyTriggerVisibility tests `!== false`), so a
    // plain !! snapshot records "hidden" for anyone who never touched it and
    // unhide would leave the overlay off forever.
    expect(main).toMatch(/f === 'showTriggerOverlay'\) \? \(cfg\[f\] !== false\)/);
  });

  it('keeps the trigger window exempt from quiet mode and the EQ gate', () => {
    // The safeguards that were already right — the fix must not disturb them.
    expect(main).toMatch(/if \(e\.key === 'trigger'\) return true;/);
    expect(main).toMatch(/backgroundThrottling: false/);
  });
});

describe('spoken text is not the display text', () => {
  const html = readSource(new URL('../apps/mimic/triggers.html', import.meta.url).pathname);

  it('cleans the FALLBACK but never an explicit tts', () => {
    // t.tts wins untouched; only the reuse-display-text-as-speech path is
    // cleaned, so a deliberately-written spoken line is never mangled.
    expect(html).toMatch(/const spoken = t\.tts \|\| _speakable\(t\.text\)/);
  });

  it('strips symbols and separator dashes, keeping names and numbers', () => {
    const m = html.match(/function _speakable\(txt\)\{[\s\S]*?\n  \}/);
    expect(m, '_speakable not found').toBeTruthy();
    // eslint-disable-next-line no-new-func
    const fn = new Function('return (' + m[0].replace('function _speakable', 'function') + ')')();
    // The live report: preview spoke "HIGH VOLTAGE D. I. Fired Tank Saved".
    expect(fn('⚡ D.I. FIRED — Abrahms saved')).toBe('D.I. FIRED Abrahms saved');
    expect(fn('💀 Death Touch — Hitya')).toBe('Death Touch Hitya');
    // Must not damage ordinary callouts.
    expect(fn('CH ON TANK')).toBe('CH ON TANK');
    expect(fn('Kaas Thox Xi Ans Dyek at 20%')).toBe('Kaas Thox Xi Ans Dyek at 20%');
  });
});
