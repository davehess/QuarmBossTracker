// The bot's half of "the debuffer's landing takes precedence" (the guild lead, 2026-11-01): buff_casts stores
// whether a landing came from its CASTER's own agent (self_cast), and target-buffs serves it (`by_caster`) with the
// caster's row winning over a bystander's of the same cast. The agent's half is test/debuffer-precedence.test.js on
// beta. Names are invented example tokens.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, stripSql, BOT_INDEX, ROOT } from './_source-slice.js';

const bot = readSource(BOT_INDEX);

describe('the bot: carries who cast it', () => {
  const cleanBot = stripJs(bot);
  it('ingest stores the agent\'s self-cast flag, and target-buffs selects and serves it', () => {
    expect(cleanBot).toMatch(/self_cast:\s+c\._selfCast === true/);
    expect(cleanBot).toContain('&select=spell_name,dur_ticks,cast_at,observer,is_charm_spell,target_id,self_cast&order=cast_at.desc');
    expect(cleanBot).toContain('by_caster:      !!v.row.self_cast');
  });

  // The per-spell pick, run for real: newest wins, but the caster's own report beats a bystander's of the SAME cast.
  const pick = sliceBlock(bot, '    const bySpell = new Map();', '    const buffs = [];');
  function run(rows, now) {
    // eslint-disable-next-line no-new-func
    return new Function('rows', 'now', 'requesterZone', 'zoneMap', '_nameZones', 'targetId',
      '_zoneScopeKeepForName', '_idScopeKeep', '_isJunkSpellName',
      pick + '\nreturn [...bySpell.values()].map(v => v.row.observer);')(
      rows, now, null, new Map(), 1, null, () => true, () => true, () => false);
  }
  const now = Date.now();
  const row = (observer, ageSec, self_cast) => ({
    spell_name: "Togor's Insects", dur_ticks: 65, observer, self_cast, target_id: null,
    cast_at: new Date(now - ageSec * 1000).toISOString(),
  });
  it('a caster\'s row beats a bystander\'s newer-by-seconds row of the same cast', () => {
    // Newest first, as the query returns them: the bystander is 3 s newer.
    expect(run([row('Corvale', 20, false), row('Brackwyn', 23, true)], now)).toEqual(['Brackwyn']);
  });
  it('a clearly newer bystander row is a recast and still wins', () => {
    expect(run([row('Corvale', 5, false), row('Brackwyn', 60, true)], now)).toEqual(['Corvale']);
  });
  it('with no caster row, the newest wins as before', () => {
    expect(run([row('Corvale', 5, false), row('Zarrin', 9, false)], now)).toEqual(['Corvale']);
  });
});

describe('the migration', () => {
  const sql = stripSql(fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261102090000_buff_casts_self_cast.sql'), 'utf8'));
  it('adds the column and promotes a stored row when the caster\'s copy lost the dedup race', () => {
    expect(sql).toMatch(/add column if not exists self_cast boolean not null default false/i);
    expect(sql).toMatch(/on conflict do nothing/i);
    expect(sql).toMatch(/set self_cast = true/i);
    expect(sql).toMatch(/revoke all on function public\.insert_buff_casts\(jsonb\) from public, anon, authenticated/);
    expect(sql).toMatch(/grant execute on function public\.insert_buff_casts\(jsonb\) to service_role/);
  });
});
