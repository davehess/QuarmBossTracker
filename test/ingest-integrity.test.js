// test/ingest-integrity.test.js — data-integrity checks on the agent ingest routes (security overhaul, phase 2).
// Behaviour tests: the real helpers are evaluated from index.js / required from utils, with stubbed collaborators.
//
// Run: npx vitest run test/ingest-integrity.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, BOT_INDEX, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const require = createRequire(import.meta.url);
const src = readSource(BOT_INDEX);

describe('character ownership on the fight upload', () => {
  const block = sliceBlock(src, 'async function _characterBelongsToAnotherMember(', '\n}\n');
  const make = (owner, household) => new Function('_CHAR_NAME_RX', '_characterOwnerDiscordId', '_householdDiscordIds',
    block + '\nreturn _characterBelongsToAnotherMember;')(
    /^[A-Za-z]{2,24}$/, async () => owner, async () => new Set(household));
  const id = { discord_id: '1' };

  it('flags a character linked to a different household', async () => {
    expect(await make('2', ['1'])(id, 'Aldenmar')).toBe(true);
  });
  it('allows own, household, unlinked and lookup-failed characters', async () => {
    expect(await make('1', ['1'])(id, 'Aldenmar')).toBe(false);
    expect(await make('3', ['1', '3'])(id, 'Aldenmar')).toBe(false);
    expect(await make(null, ['1'])(id, 'Brackwyn')).toBe(false);
    expect(await make(undefined, ['1'])(id, 'Brackwyn')).toBe(false);
  });
  it('the upload handler nulls the character when the check says so', () => {
    const body = stripJs(sliceBlock(src, 'async function _handleAgentUpload(', 'const isGuest'));
    expect(body).toMatch(/_characterBelongsToAnotherMember\(identity, character\)[\s\S]*?character = null/);
  });
});

describe('plausibility ceilings', () => {
  const { splitImplausible } = require('../utils/parsePlausibility');
  const row = (name, damage, dps) => ({ name, damage, dps });

  it('keeps every value seen in real data (max damage 1.09M, max dps 10.2k)', () => {
    const r = splitImplausible([row('A', 1090194, 1735), row('B', 265000, 10227)], 1000000);
    expect(r.flagged).toHaveLength(0);
    expect(r.kept).toHaveLength(2);
  });
  it('flags damage over max(10 x HP, 2.5M) and dps over 25k, with a reason', () => {
    const r = splitImplausible([row('A', 2600000, 100), row('B', 1000, 30000), row('C', 5000, 10)], 100000);
    expect(r.flagged.map(f => [f.name, f.reason])).toEqual([['A', 'damage_over_ceiling'], ['B', 'dps_over_ceiling']]);
    expect(r.kept.map(p => p.name)).toEqual(['C']);
  });
  it('scales the damage ceiling with a big catalog HP and works without one', () => {
    expect(splitImplausible([row('A', 5000000, 100)], 1000000).flagged).toHaveLength(0);
    expect(splitImplausible([row('A', 5000000, 100)], null).flagged).toHaveLength(1);
  });
  it('recordParse feeds the helper and stores flags', () => {
    const s = stripJs(require('node:fs').readFileSync(new URL('../utils/supabase.js', import.meta.url), 'utf8'));
    expect(s).toMatch(/splitImplausible\(parsed\.players/);
    expect(s).toMatch(/flags: flagged/);
  });
});

describe('relay timestamp bounds', () => {
  const { _relayTsInBounds } = evalBlock(
    sliceBlock(src, 'function _relayTsInBounds(', '\n}\n'), ['_relayTsInBounds']);
  const now = Date.parse('2026-11-10T20:00:00Z');
  const iso = (ms) => new Date(now + ms).toISOString();

  it('accepts now-48h .. now+5min and a missing ts (a long bot outage keeps its queued kills)', () => {
    expect(_relayTsInBounds(iso(-47 * 3600000), now)).toBe(true);
    expect(_relayTsInBounds(iso(4 * 60000), now)).toBe(true);
    expect(_relayTsInBounds(undefined, now)).toBe(true);
  });
  it('rejects older, future and unparseable times', () => {
    expect(_relayTsInBounds(iso(-49 * 3600000), now)).toBe(false);
    expect(_relayTsInBounds(iso(10 * 60000), now)).toBe(false);
    expect(_relayTsInBounds('not a date', now)).toBe(false);
  });
  it('bosskill and lockout loops use the bounds', () => {
    const code = stripJs(src);
    expect(code).toMatch(/if \(!_relayTsInBounds\(ts\)\)/);
    expect(code).toMatch(/remainingMs > 8 \* 24 \* 3600000/);
  });
});
