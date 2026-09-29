// test/char-profile-active.test.js — the tray's "Save layout for <character>" follows the character.
//
// The guild lead, 2026-09-29, with the tray showing "Save layout (no active character yet)" greyed
// out: "Why doesn't this work". Two ways it stuck: the state poll that is the ONLY source of the
// active character dropped any response over 256 KB (a long session's state grows past that), and
// a quiet Zeal (zoning, camping) cleared the character without rebuilding the menu, so another
// rebuild in that gap froze the item disabled until the character changed.
//
// Runs Mimic's real _onActiveCharacter out of apps/mimic/main.js with stubbed config and menu.
//
// Run: npx vitest run test/char-profile-active.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock, stripJs } from './_source-slice.js';

const main = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));

function load({ enabled = false } = {}) {
  const block = sliceBlock(main, 'function _onActiveCharacter(name) {', '\n}');
  const calls = { builds: 0, applied: [] };
  // eslint-disable-next-line no-new-func
  const api = new Function('calls', 'enabled', `
    let _activeCharName = null, _lastProfileChar = null;
    function loadConfig() { return { charProfilesEnabled: enabled }; }
    function _applyCharProfile(cl) { calls.applied.push(cl); return false; }
    function buildTrayMenu() { calls.builds++; }
    ${block}
    return { on: _onActiveCharacter, get name() { return _activeCharName; } };
  `)(calls, enabled);
  return { api, calls };
}

describe('the active character behind "Save layout"', () => {
  it('the first character sets the label and rebuilds the menu', () => {
    const { api, calls } = load();
    api.on('Aldenmar');
    expect(api.name).toBe('Aldenmar');
    expect(calls.builds).toBe(1);
  });

  it('a quiet Zeal (no character reported) keeps the last one, and the menu is not rebuilt empty', () => {
    const { api, calls } = load();
    api.on('Aldenmar');
    api.on(null);
    expect(api.name).toBe('Aldenmar');
    expect(calls.builds).toBe(1);
    api.on('Aldenmar');                 // Back from zoning: nothing to redo.
    expect(calls.builds).toBe(1);
  });

  it('switching to another character rebuilds; switching back does too', () => {
    const { api, calls } = load();
    api.on('Aldenmar');
    api.on('Brackwyn');
    expect(api.name).toBe('Brackwyn');
    api.on('Aldenmar');
    expect(calls.builds).toBe(3);
  });

  it('with layouts on, each new character applies its profile', () => {
    const { api, calls } = load({ enabled: true });
    api.on('Aldenmar');
    api.on(null);
    api.on('Brackwyn');
    expect(calls.applied).toEqual(['aldenmar', 'brackwyn']);
  });
});

describe('the state poll does not silently drop a long session', () => {
  it('the cap is a runaway guard (16 MB), and hitting it is logged', () => {
    const code = stripJs(main);
    expect(code).toMatch(/const _STATE_POLL_MAX_BYTES = 16 \* 1024 \* 1024;/);
    expect(code).toMatch(/body\.length > _STATE_POLL_MAX_BYTES\)[\s\S]{0,200}appendAgentLog\(/);
    expect(code).not.toMatch(/body\.length > 256 \* 1024/);
  });
});
