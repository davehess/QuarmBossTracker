// test/hud-guild-merge.test.js — the HUD's guild-merged row assembly.
//
// The row math decides what a raider believes about their own contribution
// mid-fight, and every way it can be wrong still renders a tidy scoreboard:
//   • dropping locally-seen players who the guild has not reported yet makes
//     people VANISH from the meter as the fight goes on;
//   • showing the parenthetical when the two agree is noise on every row;
//   • trusting a stale guild payload freezes the headline number while it still
//     looks live — and threat_snapshot is sheddable, so that WILL happen.
//
// Run: npx vitest run test/hud-guild-merge.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_source-slice.js';

const html = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'overlay.html'), 'utf8');

// Mirror of the shipped merge (the real one lives inside the poll handler and
// needs a DOM). The source assertions below keep this honest.
function mergeRows(allRows, guild, tabMode = 'dps') {
  const fresh = guild && Array.isArray(guild.players) && guild.players.length
             && (guild.ageSec == null || guild.ageSec < 45);
  if (tabMode !== 'dps' || !fresh) return { rows: allRows, GUILD: null };
  const localBy = new Map(allRows.map(r => [String(r[0]).toLowerCase(), r]));
  const merged = guild.players.map(p => {
    const loc = localBy.get(String(p.character).toLowerCase());
    return [p.character, p.dmg || 0, loc ? loc[2] : 0, loc ? loc[3] : null,
            0, 0, loc ? loc[6] : false, loc ? loc[1] : 0];
  });
  const seen = new Set(merged.map(m => String(m[0]).toLowerCase()));
  for (const r of allRows) {
    if (!seen.has(String(r[0]).toLowerCase())) merged.push(r.concat([r[1]]));
  }
  return { rows: merged.sort((a, b) => (b[1] || 0) - (a[1] || 0)), GUILD: guild };
}

const local = (name, dmg) => [name, dmg, 0, null, 0, 0, false];

describe('the shipped HUD still merges the way this models', () => {
  it('gates the guild view to DPS mode', () => {
    // Tank mode is damage TAKEN; there is no guild equivalent to overlay.
    expect(html).toMatch(/TAB_MODE === 'dps' && gd && Array\.isArray\(gd\.players\)/);
  });

  it('drops a stale guild payload rather than freezing the headline', () => {
    expect(html).toMatch(/gd\.ageSec == null \|\| gd\.ageSec < 45/);
  });

  it('shows the parenthetical only when it differs from the guild number', () => {
    expect(html).toMatch(/row\[7\] !== undefined && row\[7\] !== d/);
  });
});

describe('merge behaviour', () => {
  const guild = { players: [{ character: 'Wabumkin', dmg: 164000 },
                            { character: 'Hitya',    dmg: 90000 }], ageSec: 3 };

  it('shows a player the guild saw and this client did NOT, at local 0', () => {
    // The row that is the entire feature: 164k done, none of it witnessed here.
    const { rows } = mergeRows([local('Hitya', 90000)], guild);
    const wab = rows.find(r => r[0] === 'Wabumkin');
    expect(wab[1]).toBe(164000);   // guild headline
    expect(wab[7]).toBe(0);        // what we saw
  });

  it('keeps a locally-seen player the guild has not reported yet', () => {
    // The merge only ever ADDS. Dropping them would make people disappear from
    // the meter mid-fight, which reads as a parser bug.
    const { rows } = mergeRows([local('Hitya', 90000), local('Newcomer', 5000)], guild);
    expect(rows.map(r => r[0])).toContain('Newcomer');
    const n = rows.find(r => r[0] === 'Newcomer');
    expect(n[1]).toBe(5000);
    expect(n[7]).toBe(5000);       // equal → the renderer suppresses the parens
  });

  it('re-sorts on the GUILD number, not the local one', () => {
    // Locally Hitya looks like the top damage; guild-wide Wabumkin is.
    const { rows } = mergeRows([local('Hitya', 90000)], guild);
    expect(rows[0][0]).toBe('Wabumkin');
  });

  it('carries pet_owner and tookMax across from the local row', () => {
    const withPet = ['Hitya', 90000, 4200, 'Owner', 0, 0, true];
    const { rows } = mergeRows([withPet], guild);
    const h = rows.find(r => r[0] === 'Hitya');
    expect(h[2]).toBe(4200);
    expect(h[3]).toBe('Owner');
    expect(h[6]).toBe(true);
  });

  it('falls back to local-only when the guild payload is stale', () => {
    const { rows, GUILD } = mergeRows([local('Hitya', 90000)],
      { players: [{ character: 'Wabumkin', dmg: 164000 }], ageSec: 120 });
    expect(GUILD).toBeNull();
    expect(rows.map(r => r[0])).toEqual(['Hitya']);
  });

  it('falls back to local-only in tank mode and when there is no guild data', () => {
    expect(mergeRows([local('Hitya', 1)], guild, 'tank').GUILD).toBeNull();
    expect(mergeRows([local('Hitya', 1)], null).GUILD).toBeNull();
    expect(mergeRows([local('Hitya', 1)], { players: [] }).GUILD).toBeNull();
  });

  it('survives a guild row for someone with no local sighting at all', () => {
    const { rows } = mergeRows([], guild);
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r[7] === 0)).toBe(true);
  });
});
