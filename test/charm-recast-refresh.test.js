// test/charm-recast-refresh.test.js — re-casting a charm that is still running re-arms the overlay timer.
//
// The guild lead, 2026-10-09: "fix the charm re-cast timer bug". The same-owner recast branch of the
// builder's charm-land handling gated its _bumpCharmTick on `pcSpell.dur || pcSpell.cls`, but
// _consumePendingCharmSpell returns { charm_class, duration_sec, charm_spell_name } — so the gate was
// never true, the tracker was never bumped, and the overlay kept counting from the FIRST land. The
// decision is now the pure _recastBumpOpts(pcSpell, existing). charm.html re-arms its per-charm aging
// memory when started_at changes, so a bumped started_at is all the overlay needs.
//
// Run: npx vitest run test/charm-recast-refresh.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, evalBlock, stripJs, AGENT_INDEX } from './_source-slice.js';

const agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js');
const src = readSource(AGENT_INDEX);

const { _recastBumpOpts } = evalBlock(
  sliceBlock(src, 'function _recastBumpOpts(pcSpell, existing) {', '\n}'),
  ['_recastBumpOpts'],
);

const stamp = (hms, text) => `[Mon Oct 05 ${hms} 2026] ${text}`;
function feed(b, hms, text) {
  const line = stamp(hms, text);
  const ev = agent.parseEvent(line, agent.parseEqTimestamp(line));
  if (ev) b.add(ev);
}
const builder = () => new agent.EncounterBuilder({ character: 'Brackwyn', onFlush: () => {} });
const PET = 'a glyphed familiar';
const LAND = `${PET} regards Brackwyn as an ally.`;
const tracked = () => agent._charmTickTracker.get(PET.toLowerCase());

beforeEach(() => { agent._charmTickTracker.clear(); });

describe('_recastBumpOpts (the pure decision)', () => {
  const staged = { charm_class: 'enchanter', duration_sec: 720, charm_spell_name: 'Allure' };

  it('a staged spell bumps with its class, duration and name, carrying the dire flag', () => {
    expect(_recastBumpOpts(staged, { is_dire_charm: false })).toEqual({ is_dire_charm: false, ...staged });
    expect(_recastBumpOpts(staged, { is_dire_charm: true }).is_dire_charm).toBe(true);
  });

  it('no staged spell (a bare pet-ack) bumps nothing, so acks cannot reset the up-timer', () => {
    expect(_recastBumpOpts(null, { is_dire_charm: false })).toBe(null);
  });

  it('a staged spell with no known duration still bumps (the tracker carries the old values)', () => {
    expect(_recastBumpOpts({ charm_class: 'enchanter', duration_sec: undefined, charm_spell_name: null }, {})).not.toBe(null);
  });
});

describe('through the real EncounterBuilder', () => {
  it('a first land arms the tracker from the staged cast (unchanged)', () => {
    const b = builder();
    feed(b, '02:47:00', 'You begin casting Allure.');
    feed(b, '02:47:03', LAND);
    expect(tracked()).toMatchObject({ is_active: true, charm_class: 'enchanter', is_dire_charm: false });
    expect(tracked().duration_sec).toBeGreaterThan(0);
  });

  it('a recast while the charm runs moves started_at to the new land and keeps class + duration', () => {
    const b = builder();
    feed(b, '02:47:00', 'You begin casting Allure.');
    feed(b, '02:47:03', LAND);
    const first = tracked();
    feed(b, '02:55:00', 'You begin casting Allure.');
    feed(b, '02:55:03', LAND);
    const again = tracked();
    expect(again.started_at).toBeGreaterThan(first.started_at);
    expect(again.started_at - first.started_at).toBe(8 * 60 * 1000);
    expect(again.last_tick_at).toBe(again.started_at);
    expect(again).toMatchObject({ is_active: true, charm_class: first.charm_class, duration_sec: first.duration_sec });
    // one session, not two: the recast does not end it, and ran_full stays unknowable
    expect(b._activeCharms.size).toBe(1);
    expect(b.charmSessions).toHaveLength(0);
  });

  it('a bare pet-ack with no cast leaves the tracker where it was', () => {
    const b = builder();
    feed(b, '02:47:00', 'You begin casting Allure.');
    feed(b, '02:47:03', LAND);
    const first = tracked().started_at;
    // a combat line first, so the builder's clock actually moves; otherwise the ack would
    // carry the old timestamp and this could not tell "left alone" from "re-armed to the same instant"
    feed(b, '02:50:00', 'Orc pawn hits YOU for 10 points of damage.');
    feed(b, '02:50:00', LAND);
    expect(Date.parse(b.lastEvent)).toBeGreaterThan(first);
    expect(tracked().started_at).toBe(first);
  });
});

describe('the old gate is gone (comment-stripped source)', () => {
  const code = stripJs(src);
  it('no pcSpell.dur / pcSpell.cls condition remains, and the recast uses the helper', () => {
    expect(code).not.toMatch(/pcSpell\.dur\b/);
    expect(code).not.toMatch(/pcSpell\.cls\b/);
    expect(code).toMatch(/const bumpOpts = _recastBumpOpts\(pcSpell, existing\);/);
  });
});
