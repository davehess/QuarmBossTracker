// test/charm-session-spell-ran-full.test.js — the bot stores the agent's charm `spell` and `ran_full`.
//
// The guild lead, 2026-10-08: enchanters say charms break early and the recorded sessions could not
// answer it (no spell; end_reason cannot split a fade from a resist break). The agent now sends `spell`
// and `ran_full` on each charm_sessions[] entry; the bot writes them to charm_sessions.spell_name /
// ran_full. Older agents send neither and must keep working row for row.
//
// Behaviour: the REAL row mapper is lifted out of index.js and run against agent payloads, old and new.
//
// Run: npx vitest run test/charm-session-spell-ran-full.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, stripSql, BOT_INDEX, ROOT } from './_source-slice.js';

const require_ = createRequire(import.meta.url);
const { charmSpellName, charmRanFull } = require_('../utils/charmSession.js');

describe('charmSpellName', () => {
  it('keeps a short string, trimmed', () => {
    expect(charmSpellName('allure')).toBe('allure');
    expect(charmSpellName('  beguile ')).toBe('beguile');
  });
  it('caps at 80 characters: 80 passes, 81 is dropped', () => {
    expect(charmSpellName('a'.repeat(80))).toBe('a'.repeat(80));
    expect(charmSpellName('a'.repeat(81))).toBe(null);
  });
  it('anything that is not a non-empty string is null', () => {
    for (const v of [undefined, null, '', '   ', 7, true, {}, ['allure']]) expect(charmSpellName(v)).toBe(null);
  });
});

describe('charmRanFull', () => {
  it('a real boolean passes through, false included', () => {
    expect(charmRanFull(true)).toBe(true);
    expect(charmRanFull(false)).toBe(false);
  });
  it('everything else is null, so "true" the string or 1 never reads as a measurement', () => {
    for (const v of [undefined, null, 'true', 'false', 1, 0, {}]) expect(charmRanFull(v)).toBe(null);
  });
});

const botSrc = readSource(BOT_INDEX);
const mapBlock = sliceBlock(botSrc, 'const charmRows = encounter.charm_sessions.map(', '}));');
// eslint-disable-next-line no-new-func
const mapSessions = new Function('encounter', 'recParseResult', 'character', 'guildId', 'charmSpellName', 'charmRanFull',
  mapBlock + '\nreturn charmRows;');
const rowsFor = (sessions) => mapSessions({ charm_sessions: sessions }, { encounterId: 'enc-1' }, 'Brackwyn', 'wolfpack', charmSpellName, charmRanFull);

const OLD_AGENT = {
  pet: 'a glyphed familiar', owner: 'Brackwyn', started_at: '2026-10-05T02:47:00.000Z',
  ended_at: '2026-10-05T02:47:36.000Z', duration_sec: 36, total_damage: 120, is_dire_charm: false, end_reason: 'charm_break',
};

describe('the charm_sessions row the upsert writes', () => {
  it('an older agent (no spell, no ran_full) still produces a row, with both new columns null', () => {
    const [row] = rowsFor([OLD_AGENT]);
    expect(row).toMatchObject({ pet_name: 'a glyphed familiar', owner: 'Brackwyn', end_reason: 'charm_break', duration_sec: 36, spell_name: null, ran_full: null });
  });
  it('a current agent\'s spell and ran_full land in spell_name / ran_full', () => {
    const [row] = rowsFor([{ ...OLD_AGENT, spell: 'allure', ran_full: true }]);
    expect(row).toMatchObject({ spell_name: 'allure', ran_full: true });
    expect(rowsFor([{ ...OLD_AGENT, spell: 'allure', ran_full: false }])[0].ran_full).toBe(false);
  });
  it('explicit nulls from a new agent that did not know the spell stay null', () => {
    expect(rowsFor([{ ...OLD_AGENT, spell: null, ran_full: null }])[0]).toMatchObject({ spell_name: null, ran_full: null });
  });
  it('a malformed value is nulled, never carried into the upsert', () => {
    const [row] = rowsFor([{ ...OLD_AGENT, spell: 'x'.repeat(200), ran_full: 'yes' }]);
    expect(row).toMatchObject({ spell_name: null, ran_full: null });
  });
  it('every row has the same keys, so a mixed old/new batch is one valid upsert', () => {
    const rows = rowsFor([OLD_AGENT, { ...OLD_AGENT, started_at: '2026-10-05T03:47:00.000Z', spell: 'allure', ran_full: true }]);
    expect(Object.keys(rows[0]).sort()).toEqual(Object.keys(rows[1]).sort());
  });
  it('end_reason is passed through unvalidated (no allow-list exists to extend)', () => {
    expect(rowsFor([{ ...OLD_AGENT, end_reason: 'encounter_flush' }])[0].end_reason).toBe('encounter_flush');
  });
});

describe('wiring (comment-stripped source)', () => {
  it('index.js imports the helpers from utils/charmSession and the row calls them', () => {
    const code = stripJs(botSrc);
    expect(code).toMatch(/const \{ charmSpellName, charmRanFull \} = require\('\.\/utils\/charmSession'\);/);
    expect(code).toMatch(/spell_name:\s+charmSpellName\(s\.spell\),/);
    expect(code).toMatch(/ran_full:\s+charmRanFull\(s\.ran_full\),/);
  });
  it('the migration adds both columns idempotently, nullable, and does not touch end_reason', () => {
    const sql = stripSql(fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20261009010000_charm_sessions_spell_ran_full.sql'), 'utf8'));
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS spell_name text;/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS ran_full\s+boolean;/);
    expect(sql).not.toMatch(/NOT NULL/i);
    expect(sql).not.toMatch(/end_reason/);
  });
});
