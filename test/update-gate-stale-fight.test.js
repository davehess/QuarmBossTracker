// test/update-gate-stale-fight.test.js — the update gate no longer sees a fight that ended long ago.
//
// The guild lead, 2026-09-30, with a screenshot of the "Update blocked: active fight in progress" prompt
// while standing still: "I'm legit not doing anything and this is notifying every time". flush()'s early
// exits (under 10 events, a player or no target, an "eye of" pet) reset the builder without stamping
// flushedAt, so a few stray hits left the live-threat snapshot "live" forever. A fight is now live only
// while it is still publishing.
//
// Runs the real gate functions against stubbed agent state.
//
// Run: npx vitest run test/update-gate-stale-fight.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, stripJs, AGENT_INDEX } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
const block = [
  sliceBlock(src, 'const LIVE_FIGHT_QUIET_MS = ', ';'),
  sliceBlock(src, 'function _liveFightActive() {', '\n}'),
  sliceBlock(src, 'function _updateBlockedReason() {', '\n}'),
].join('\n');
function gate(state) {
  // eslint-disable-next-line no-new-func
  return new Function('stats', '_raidHold', '_uploadQueue', '_activeBackfills',
    block + '\nreturn { _liveFightActive, _updateBlockedReason, LIVE_FIGHT_QUIET_MS };')(
    state.stats, state.raidHold || false, state.queue || [], state.backfills || new Set());
}
const now = Date.now();

describe('a fight is live only while it is still publishing', () => {
  it('a fight that published a moment ago blocks the update', () => {
    const g = gate({ stats: { currentEncounterThreat: { flushedAt: null, publishedAt: now - 5_000 } } });
    expect(g._liveFightActive()).toBe(true);
    expect(g._updateBlockedReason()).toBe('active fight in progress');
  });
  it('a fight never flushed but quiet for longer than any real fight lasts does not', () => {
    const g = gate({ stats: { currentEncounterThreat: { flushedAt: null, publishedAt: now - 10 * 60_000 } } });
    expect(g._liveFightActive()).toBe(false);
    expect(g._updateBlockedReason()).toBeNull();
  });
  it('the window outlasts the idle flush, so a fight in a lull still counts', () => {
    const g = gate({ stats: {} });
    expect(g.LIVE_FIGHT_QUIET_MS).toBeGreaterThan(120_000);
    const lull = gate({ stats: { currentEncounterThreat: { flushedAt: null, publishedAt: now - 119_000 } } });
    expect(lull._liveFightActive()).toBe(true);
  });
  it('a flushed fight never blocks, and nothing at all does not either', () => {
    expect(gate({ stats: { currentEncounterThreat: { flushedAt: now - 1000, publishedAt: now - 2000 } } })._updateBlockedReason()).toBeNull();
    expect(gate({ stats: {} })._updateBlockedReason()).toBeNull();
  });
  it('the other blockers are unchanged', () => {
    expect(gate({ stats: {}, queue: [1, 2] })._updateBlockedReason()).toBe('2 pending uploads');
    expect(gate({ stats: {}, raidHold: true })._updateBlockedReason()).toMatch(/^raid hold/);
  });
  it('every published snapshot carries its time', () => {
    expect(stripJs(src)).toMatch(/flushedAt: null,\s*publishedAt: Date\.now\(\),/);
  });
});
