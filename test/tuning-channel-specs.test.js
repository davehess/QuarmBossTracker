// test/tuning-channel-specs.test.js — the bot resolves the join specs; the
// agent never holds policy or a secret.
//
// Hitya, 2026-09-03: "We can save the channel:pass as an environmental
// variable for officer chat and for tagging. The tagging piece is critical."
//
// Env is the default, the /admin/overlays tuning row overrides it live, and
// both agent-facing paths (overlay-tuning GET, /poll bundle) go through
// _overlayTuningMap, so resolving there covers everything.
//
// Run: npx vitest run test/tuning-channel-specs.test.js

import { describe, it, expect } from 'vitest';
import { readSource, BOT_INDEX, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const src = readSource(BOT_INDEX);
function load(env) {
  return evalBlock(
    `const process = { env: ${JSON.stringify(env)} };\n`
    + sliceBlock(src, "const TAG_CHANNEL_SPEC     = (process.env.TAG_CHANNEL_SPEC", '\nasync function _overlayTuningMap() {'),
    ['_withChannelSpecs'],
  )._withChannelSpecs;
}
const RAID = 'Ztwolfpacktag:envpw', OFF = 'officers:envpw';   // placeholders, never real

describe('resolving the specs', () => {
  it('serves the env values when tuning has none', () => {
    expect(load({ TAG_CHANNEL_SPEC: RAID, OFFICER_CHANNEL_SPEC: OFF })({}))
      .toMatchObject({ tag_channel_spec: RAID, officer_channel_spec: OFF });
  });
  it('lets an officer override env live from /admin/overlays', () => {
    const out = load({ TAG_CHANNEL_SPEC: RAID })({ tag_channel_spec: 'Ztwolfpacktag:newpw' });
    expect(out.tag_channel_spec).toBe('Ztwolfpacktag:newpw');
  });
  it('omits a key entirely when neither is set — never an empty string', () => {
    // An empty spec written into ChannelAutoJoin would be a broken join.
    const out = load({})({});
    expect('tag_channel_spec' in out).toBe(false);
    expect('officer_channel_spec' in out).toBe(false);
  });
  it('trims whitespace from both sources', () => {
    expect(load({ TAG_CHANNEL_SPEC: '  ' + RAID + ' ' })({}).tag_channel_spec).toBe(RAID);
    expect(load({})({ tag_channel_spec: ' ' + RAID + '  ' }).tag_channel_spec).toBe(RAID);
  });
  it('returns a COPY and leaves every other tuning key untouched', () => {
    const cache = { flag_agent_kill: 0, budget_chat_per_min: 30 };
    const out = load({ TAG_CHANNEL_SPEC: RAID })(cache);
    expect(out).toMatchObject({ flag_agent_kill: 0, budget_chat_per_min: 30, tag_channel_spec: RAID });
    expect(cache).not.toHaveProperty('tag_channel_spec');   // cache object not mutated
  });
});

describe('it is the single resolution point', () => {
  const clean = stripJs(src);
  it('_overlayTuningMap wraps the cache with the specs', () => {
    expect(clean).toMatch(/return _withChannelSpecs\(_overlayTuningCache\.values\);/);
  });
  it('the bot source holds no name:password literal', () => {
    expect(clean).not.toMatch(/ztwolfpacktag:[A-Za-z0-9]/i);
    expect(clean).not.toMatch(/wolfpackofficer:[A-Za-z0-9]/i);
  });
});
