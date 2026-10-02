// test/xp-events-ingest.test.js — XP events (FB-37 option B): what the bot keeps from an upload.
//
// The guild lead, 2026-10-02: "observe group composition and xp totals for groups that are together
// during the day and find what compositions work and in what area in what zone, with what mobs we're
// killing" · "Also track when we have an XP potion on".
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, BOT_INDEX, ROOT } from './_source-slice.js';

const src = readSource(BOT_INDEX);
const { _sanitizeXpEvent } = evalBlock(
  sliceBlock(src, 'const _XP_KINDS = ', 'async function _handleAgentXpEvents(').replace(/async function _handleAgentXpEvents\($/, ''),
  ['_sanitizeXpEvent'],
);
const NOW = Date.parse('2026-10-02T18:00:00Z');
const base = {
  character: 'Aldenmar', at: '2026-10-02T17:59:30Z', kind: 'party', level: 58, level_after: 58,
  xp_before: 41.25, xp_after: 41.9, aa_before: 0, aa_after: 0, aa_banked_before: 3, aa_banked_after: 3,
  zone_id: 206, zone_name: 'Plane of Innovation', loc_x: 100, loc_y: 1000, loc_z: -50,
  mob: 'an obsolete model', potion: true, race: 'Dark Elf', class: 'Enchanter', agent_version: '3.7.67',
  group_members: [{ name: 'Brackwyn', class: 'Warrior', level: 59 }, { name: 'not a name!', class: 'x' }],
};

describe('_sanitizeXpEvent', () => {
  it('keeps a whole event, the group\'s real names, and the potion flag', () => {
    const r = _sanitizeXpEvent(base, 'wolfpack', '123', NOW);
    expect(r).toMatchObject({
      guild_id: 'wolfpack', character: 'Aldenmar', kind: 'party', level: 58, xp_before: 41.25, xp_after: 41.9,
      zone_name: 'Plane of Innovation', loc_y: 1000, mob: 'an obsolete model', potion: true, uploaded_by: '123',
    });
    expect(r.group_members).toEqual([{ name: 'Brackwyn', class: 'Warrior', level: 59 }]);
  });
  it('the potion flag is only ever true when sent true', () => {
    expect(_sanitizeXpEvent({ ...base, potion: 'yes' }, 'wolfpack', null, NOW).potion).toBe(false);
  });
  it('drops bad characters, kinds and times', () => {
    expect(_sanitizeXpEvent({ ...base, character: 'Bob Smith' }, 'w', null, NOW)).toBeNull();
    expect(_sanitizeXpEvent({ ...base, kind: 'quest' }, 'w', null, NOW)).toBeNull();
    expect(_sanitizeXpEvent({ ...base, at: '2026-10-02T19:00:00Z' }, 'w', null, NOW)).toBeNull();
    expect(_sanitizeXpEvent({ ...base, at: '2026-09-20T00:00:00Z' }, 'w', null, NOW)).toBeNull();
  });
  it('out-of-range numbers become null, not garbage', () => {
    const r = _sanitizeXpEvent({ ...base, xp_before: 140, level: 99, loc_x: 'far' }, 'w', null, NOW);
    expect(r.xp_before).toBeNull();
    expect(r.level).toBeNull();
    expect(r.loc_x).toBeNull();
  });
});

describe('the route and the sweep', () => {
  const code = stripJs(src);
  it('POST /api/agent/xp-events, sheddable', () => {
    expect(code).toMatch(/req\.url === '\/api\/agent\/xp-events'\) \{\n\s+if \(await _isShedded\('xp_events', res\)\) return;/);
    expect(code).toMatch(/'xp_events',\s+\n?/);
  });
  it('kept 30 days', () => {
    expect(code).toMatch(/const keep = Number\.isFinite\(d\) \? d : 30;\n\s+if \(supabase\.isEnabled\(\) && keep > 0\) \{\n\s+const cutoff = [^\n]+\n\s+await supabase\.del\('xp_events'/);
  });
  it('the migration creates the table with the potion column', () => {
    const mig = readSource(path.join(ROOT, 'supabase', 'migrations', '20261002070000_xp_events.sql'));
    expect(mig).toMatch(/create table if not exists public\.xp_events/);
    expect(mig).toMatch(/potion\s+boolean not null default false/);
  });
});
