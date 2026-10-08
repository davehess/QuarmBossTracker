// Fight sizes on the /pvp fight cards and table (the guild lead, 2026-09-27: "try to figure out fight
// sizes for opponents vs allies when a fight happens in pvp").
//
// Run: npx vitest run test/pvp-fight-sizes.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fightSides } from '../web/lib/pvpMedia.ts';
import { ROOT, stripJs } from './_source-slice.js';

const migration = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20260927040000_pvp_fight_sizes.sql'), 'utf8');
const fights = stripJs(fs.readFileSync(path.join(ROOT, 'web', 'app', 'pvp', 'Fights.tsx'), 'utf8'));

const row = (over) => ({
  zone: 'Vex Thal', started_at: '2026-09-26T04:49:47+00:00', ended_at: '2026-09-26T06:05:07+00:00', waves: 4, deaths: 56,
  player_kills: 30, zek_deaths: 40, rest_deaths: 16, deaths_by_guild: {}, top_killers: [], ...over,
});

describe('fightSides', () => {
  it('reads the counts and sorts the guilds by size, then name', () => {
    const s = fightSides(row({ zek_players: 14, ally_players: 21, players_by_guild: { 'Wolf Pack': 9, Zek: 14, Freedom: 5, 'Dungeons and Dragons': 7 } }));
    expect(s).toEqual({ zek: 14, allies: 21, byGuild: [['Zek', 14], ['Wolf Pack', 9], ['Dungeons and Dragons', 7], ['Freedom', 5]] });
  });
  it('an older database sends nothing, and the card shows nothing rather than zeros', () => {
    expect(fightSides(row({}))).toBe(null);
    expect(fightSides(row({ zek_players: null, ally_players: 3 }))).toBe(null);
  });
});

describe('the database side', () => {
  it('the field is the dead, their killers, the assisters (±wave gap) and /who in the zone (4 min before, 1 after)', () => {
    expect(migration).toMatch(/drop function if exists public\.pvp_fights/);
    expect(migration).toMatch(/zek_players\s+integer,\s*ally_players\s+integer,\s*players_by_guild\s+jsonb/);
    expect(migration).toMatch(/select fd\.zone, fd\.fight, fd\.victim name, fd\.vg guild from fd/);
    expect(migration).toMatch(/select fd\.zone, fd\.fight, fd\.killer, coalesce\(fd\.killer_guild, ''\) from fd where fd\.pk/);
    expect(migration).toMatch(/pvp_assists a on a\.guild_id = 'wolfpack' and a\.zone = f\.zone\s*and a\.killed_at between f\.a - p_wave_gap and f\.b \+ p_wave_gap/);
    expect(migration).toMatch(/who_observations w on w\.guild_id = 'wolfpack' and lower\(w\.zone\) = lower\(f\.zone\)\s*and w\.observed_at between f\.a - interval '4 minutes' and f\.b \+ interval '1 minute'/);
  });
  it('a name counts once with the best guild any source gave; no guild is on neither side', () => {
    expect(migration).toMatch(/max\(nullif\(q\.guild, ''\)\) guild/);
    expect(migration).toMatch(/group by q\.zone, q\.fight, lower\(q\.name\)/);
    expect(migration).toMatch(/fp\.guild is not null and fp\.guild !~\* '\^\(zek\|rise of zek\)\$'/);
  });
});

describe('the page', () => {
  it('both layouts show the sides, and the card calls it a floor', () => {
    expect(fights).toMatch(/<Sides f=\{f\} \/>/);
    expect(fights).toMatch(/On the field: /);
    expect(fights).toMatch(/at least/);
    expect(fights).toMatch(/<th [^>]*>Sides<\/th>/);
    expect(fights).toMatch(/const s = fightSides\(f\); return s \?/);
  });
});
