// test/pet-owners-stream.test.js — the bot hands its pooled pet owners back to every agent (FB-35).
//
// A member, 2026-09-29: "This doesn't show pets? maybe its only if they dont use /pet leader, not
// sure". A summoned pet names its owner only in "My leader is <Owner>.", so a client that missed the
// line cannot tell the pet from a raider. The bot already pools every declaration uploaded by any
// raider (addPetOwners); the poll's `pet_owners` stream serves that pool, so one declaration seen by
// anyone names the pet on every client's live meter.
//
// Run: npx vitest run test/pet-owners-stream.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const { petOwnerEntries } = require(path.join(ROOT, 'utils', 'state.js'));
const bot = readSource(path.join(ROOT, 'index.js'));
const fnSrc = sliceBlock(bot, 'function _petOwnersForAgents(now) {', '  return { owners: out, ids };\n}');
// eslint-disable-next-line no-new-func
const build = (map, ids) => new Function('getPetOwners', 'petOwnerEntries', 'getPetSpawnIds', fnSrc + '\nreturn _petOwnersForAgents;')(
  () => map, petOwnerEntries, () => ids || {});

describe('the pooled pet owners the poll serves', () => {
  const NOW = Date.parse('2026-09-29T12:00:00Z');
  it('the latest declaration wins; summoned one-word names only; nothing older than 12 h', () => {
    const out = build({
      kebantik: [{ o: 'Nyssara', at: NOW - 3600_000 }, { o: 'Zarrin', at: NOW - 60_000 }],
      gobeker:  [{ o: 'Rethlan', at: NOW - 13 * 3600_000 }],
      'a shissar arbiter': [{ o: 'Corvale', at: NOW - 60_000 }],
      jarn:     'Aldenmar',                       // legacy string shape: kept (no timestamp to age out)
    })(NOW);
    expect(out).toEqual({ owners: { kebantik: 'Zarrin', jarn: 'Aldenmar' }, ids: {} });
  });
  it('a named pet\'s spawn id rides along for the DPS HUD\'s +pet line — only within the hour, only for a named pet', () => {
    const out = build({ kebantik: [{ o: 'Zarrin', at: NOW - 60_000 }], jarn: [{ o: 'Aldenmar', at: NOW - 60_000 }] },
      { kebantik: { id: 1234, at: NOW - 60_000 }, jarn: { id: 77, at: NOW - 2 * 3600_000 }, gobeker: { id: 9, at: NOW } })(NOW);
    expect(out.ids).toEqual({ kebantik: 1234 });
  });
  it('the encounter upload pools the spawn id each pet row carries', () => {
    const ing = stripJs(sliceBlock(bot, 'const uploadedPetLeaders = encounter.pet_leaders || {};', '    addPetSpawnIds(petIds);'));
    expect(ing).toMatch(/for \(const p of Array\.isArray\(encounter\.pets\) \? encounter\.pets : \[\]\)/);
    expect(ing).toMatch(/Number\.isInteger\(id\) && id > 0\) petIds\[String\(p\.name\)\.toLowerCase\(\)\] = id;/);
    const st = require(path.join(ROOT, 'utils', 'state.js'));
    expect(typeof st.addPetSpawnIds).toBe('function');
    expect(stripJs(readSource(path.join(ROOT, 'utils', 'state.js')))).toMatch(/function clearPetOwners\(\) \{ const s = loadState\(\); s\.petOwners = \{\}; s\.petSpawnIds = \{\};/);
  });
  it('is a poll stream the agent can ask for, and a shed flag can switch off', () => {
    const poll = stripJs(sliceBlock(bot, 'async function _handleAgentPoll(req, res) {', '\n}'));
    expect(poll).toMatch(/if \(_pollStreamDecision\('pet_owners', want, tune, null, null\) === 'send'\) \{\s*out\.streams\.pet_owners = _petOwnersForAgents\(\);/);
  });
});
