// test/tuning-for-agent.test.js — what an agent is sent of the tuning map.
//
// The officer channel goes only to an officer's session, and the hide-main list
// (applied bot-side) is never sent. Runs the real _tuningForAgent from index.js,
// and checks that both places that serve the whole map go through it.
//
// Run: npx vitest run test/tuning-for-agent.test.js

import { describe, it, expect } from 'vitest';
import { readSource, BOT_INDEX, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const bot = readSource(BOT_INDEX);
const { _tuningForAgent } = evalBlock(sliceBlock(bot, 'function _tuningForAgent(tune, identity) {', '\n}'), ['_tuningForAgent']);

const TUNE = { officer_channel_spec: 'offchan:secret', tag_channel_spec: 'tagchan:pw', hide_main_names: 'Aldenmar,Brackwyn', ext_hurt_pct: 70 };

describe('_tuningForAgent', () => {
  it('a member who is not an officer gets no officer channel and no hide list', () => {
    const t = _tuningForAgent(TUNE, { is_officer: false });
    expect(t.officer_channel_spec).toBeUndefined();
    expect(t.hide_main_names).toBeUndefined();
    expect(t.tag_channel_spec).toBe('tagchan:pw');
    expect(t.ext_hurt_pct).toBe(70);
  });

  it('an officer gets the officer channel, still no hide list', () => {
    const t = _tuningForAgent(TUNE, { is_officer: true });
    expect(t.officer_channel_spec).toBe('offchan:secret');
    expect(t.hide_main_names).toBeUndefined();
  });

  it('no identity is treated as not an officer, and the cached map is never changed', () => {
    const t = _tuningForAgent(TUNE, null);
    expect(t.officer_channel_spec).toBeUndefined();
    expect(TUNE.officer_channel_spec).toBe('offchan:secret');
    expect(TUNE.hide_main_names).toBe('Aldenmar,Brackwyn');
    expect(_tuningForAgent(undefined, null)).toEqual({});
  });

  it('both whole-map responses go through it', () => {
    const src = stripJs(bot);
    const tuningRoute = sliceBlock(src, 'async function _handleAgentOverlayTuning(req, res) {', '\n}');
    expect(tuningRoute).toMatch(/tuning: _tuningForAgent\(tuning, identity\)/);
    expect(src).toMatch(/_tuningBundleFor\(_tuningForAgent\(tune, identity\)\)/);
    expect(src).not.toMatch(/await _tuningBundleFor\(tune\)/);   // a call that skips the filter
  });
});
