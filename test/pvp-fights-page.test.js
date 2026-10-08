// /pvp fights and fight film, on beta as two variants (DECISIONS-2026-09-21.md §46). The guild lead,
// 2026-09-26: "Lets start combining PVP encounters into history" and "Embed this video onto the PVP
// page along with these screenshots".
//
// Run: npx vitest run test/pvp-fights-page.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PVP_NIGHTS, nightForFight } from '../web/lib/pvpMedia.ts';
import { ROOT, stripJs } from './_source-slice.js';

const page = stripJs(fs.readFileSync(path.join(ROOT, 'web', 'app', 'pvp', 'page.tsx'), 'utf8'));
const migration = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20260926085942_pvp_deaths_and_fights.sql'), 'utf8');

const fight = (zone, start, end, deaths) => ({
  zone, started_at: start, ended_at: end, deaths, waves: 1, player_kills: 1, zek_deaths: 0, rest_deaths: deaths,
  deaths_by_guild: {}, top_killers: [],
});

describe('which fight the night’s film hangs on', () => {
  const night = PVP_NIGHTS[0];
  const small = fight('Vex Thal', '2026-09-26T04:06:24+00:00', '2026-09-26T04:24:44+00:00', 9);
  const big = fight('Vex Thal', '2026-09-26T04:49:47+00:00', '2026-09-26T06:05:07+00:00', 56);
  const other = fight('Grieg\'s End', '2026-09-26T05:37:07+00:00', '2026-09-26T05:41:40+00:00', 60);
  const later = fight('Vex Thal', '2026-09-27T04:00:00+00:00', '2026-09-27T04:30:00+00:00', 90);
  const all = [small, big, other, later];

  it('the biggest fight in its zone inside its window, and no other', () => {
    expect(nightForFight(big, all)).toBe(night);
    for (const f of [small, other, later]) expect(nightForFight(f, all)).toBe(null);
  });
  it('with no fight in its zone and window, nothing gets it', () => {
    expect(nightForFight(later, [other, later])).toBe(null);
    expect(nightForFight(other, [other, later])).toBe(null);
  });
});

describe('the film itself', () => {
  it('the two videos and four clips, each with our caption and a credit by role', () => {
    const m = PVP_NIGHTS[0].media;
    expect(m.filter(x => x.kind === 'youtube').map(x => x.id)).toEqual(['2z9vmYn0YwE', 'tqiBUsbQQlA']);
    expect(m.filter(x => x.kind === 'medal')).toHaveLength(4);
    for (const x of m) {
      expect(x.caption.length).toBeGreaterThan(3);
      expect(x.credit).toMatch(/^(Video|Clip)/);
      if (x.kind !== 'image') expect(x.id).toMatch(/^[A-Za-z0-9_-]{11,20}$/);
    }
  });
});

describe('the page', () => {
  it('with no ?v= it is what production shows: no fights read, nothing new drawn', () => {
    expect(page).toContain("const variant = sp?.v === 'b' || sp?.v === 'c' ? sp.v : null;");
    expect(page).toContain('variant ? loadFights() : Promise.resolve([] as PvpFightRow[]),');
    expect(page).toContain("{variant === 'b' && <FightCards fights={fights} tz={tz} />}");
    expect(page).toContain("{variant === 'c' && <FightTable fights={fights} tz={tz} />}");
  });
  it('it calls pvp_fights with the parameter names the function really has', () => {
    const call = page.slice(page.indexOf("rpc('pvp_fights', {"), page.indexOf('});', page.indexOf("rpc('pvp_fights', {")));
    const sig = migration.slice(migration.indexOf('create or replace function public.pvp_fights('), migration.indexOf('returns table'));
    for (const p of ['p_since', 'p_wave_gap', 'p_join_gap', 'p_limit']) {
      expect(call, p).toContain(p + ':');
      expect(sig, p).toContain(p);
    }
  });
});
