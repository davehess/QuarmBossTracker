// test/hud-guild-merge.test.js — the HUD's guild-merged row assembly.
//
// ⚠ Moved surface, 2026-08-14 (agent 3.5.80). This merge used to run LIVE on the
// DPS tab against `s.guildDamage`. It now runs only on the **History** tab,
// against a captured fight whose numbers have settled. Hitya, watching the live
// version double people's damage: "the overcount from time skew and whatnot is
// too much to account for in a live stat review and it is legitimately doubling
// damage." Mid-fight the bot has under three independent readings of most
// players, so `_corroboratedDamage` falls back to max and one bad client sets
// the number for the raid.
//
// The row math still decides what a raider believes about their contribution,
// and every way it can be wrong still renders a tidy scoreboard:
//   • dropping locally-seen players the guild did not report makes people VANISH;
//   • showing the parenthetical when the two agree is noise on every row;
//   • sorting on the local number hides who actually topped the fight.
//
// Run: npx vitest run test/hud-guild-merge.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_source-slice.js';

const html = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'overlay.html'), 'utf8');

// Mirror of the shipped merge (the real one lives inside the poll handler and
// needs a DOM). The source assertions below keep this honest.
// Row shape: [name, guildDmg, tookMax, petOwner, rank, extra, petCharm, localDmg, hasPet]
function mergeRows(histEntry) {
  if (!histEntry) return { rows: [], GUILD: null };
  const histLocal = (histEntry.local || []).map(p =>
    [p.character, p.dmg || 0, 0, p.pet_owner || null, 0, 0, false, p.dmg || 0, false]);
  if (!Array.isArray(histEntry.players) || !histEntry.players.length) {
    return { rows: histLocal.sort((a, b) => (b[1] || 0) - (a[1] || 0)), GUILD: null };
  }
  const localBy = new Map(histLocal.map(r => [String(r[0]).toLowerCase(), r]));
  const merged = histEntry.players.map(p => {
    const loc = localBy.get(String(p.character).toLowerCase());
    return [p.character, p.dmg || 0, 0, loc ? loc[3] : null,
            0, 0, false, loc ? loc[1] : 0, false];
  });
  const seen = new Set(merged.map(m => String(m[0]).toLowerCase()));
  for (const r of histLocal) {
    if (!seen.has(String(r[0]).toLowerCase())) merged.push(r);
  }
  return { rows: merged.sort((a, b) => (b[1] || 0) - (a[1] || 0)), GUILD: histEntry };
}

const lp = (character, dmg, pet_owner = null) => ({ character, dmg, pet_owner });

describe('the shipped HUD still merges the way this models', () => {
  it('merges against the captured fight, not the live guild stream', () => {
    expect(html).toMatch(/HIST && Array\.isArray\(HIST\.players\) && HIST\.players\.length/);
  });

  it('does NOT read s.guildDamage for the live rows any more', () => {
    // The regression this guards: someone "restores" the live merge and the
    // doubling comes straight back with no other visible change.
    const merge = html.slice(html.indexOf('var GUILD = null, localBy = null;'),
                             html.indexOf('const totalDmg'));
    expect(merge).not.toMatch(/s\.guildDamage/);
    expect(merge.length).toBeGreaterThan(200);      // the slice actually found the block
  });

  it('shows the parenthetical only when it differs from the guild number', () => {
    expect(html).toMatch(/row\[7\] !== undefined && row\[7\] !== d/);
  });

  it('scores History rows on that fight\'s own duration', () => {
    // Reusing the LIVE encounter's elapsed time would put a wrong DPS on every
    // row of a fight that ended ten minutes ago.
    expect(html).toMatch(/HIST \? \(HIST\.durationSec \|\| 0\)/);
  });
});

describe('merge behaviour', () => {
  const entry = {
    boss: 'Aten Ha Ra', durationSec: 604, settled: true, uploaders: 11,
    players: [{ character: 'Wabumkin', dmg: 164000 }, { character: 'Hitya', dmg: 90000 }],
    local: [lp('Hitya', 90000)],
  };

  it('shows a player the guild saw and this client did NOT, at local 0', () => {
    // The row that is the entire feature: 164k done, none of it witnessed here.
    const { rows } = mergeRows(entry);
    const wab = rows.find(r => r[0] === 'Wabumkin');
    expect(wab[1]).toBe(164000);   // guild headline
    expect(wab[7]).toBe(0);        // what we saw
  });

  it('keeps a locally-seen player the guild never reported', () => {
    // The merge only ever ADDS. Dropping them would make someone this machine
    // definitely watched fighting disappear from the record of the fight.
    const { rows } = mergeRows({ ...entry, local: [lp('Hitya', 90000), lp('Newcomer', 5000)] });
    expect(rows.map(r => r[0])).toContain('Newcomer');
    const n = rows.find(r => r[0] === 'Newcomer');
    expect(n[1]).toBe(5000);
    expect(n[7]).toBe(5000);       // equal → the renderer suppresses the parens
  });

  it('re-sorts on the GUILD number, not the local one', () => {
    // Locally Hitya looks like the top damage; guild-wide Wabumkin is.
    expect(mergeRows(entry).rows[0][0]).toBe('Wabumkin');
  });

  it('carries pet_owner across from the local row', () => {
    const { rows } = mergeRows({ ...entry, local: [lp('Hitya', 90000, 'Owner')] });
    expect(rows.find(r => r[0] === 'Hitya')[3]).toBe('Owner');
  });

  it('falls back to local-only while the fight is still settling', () => {
    // A kill recorded but not yet answered for. Showing this machine's slice is
    // right; showing it as the GUILD's answer would not be, which is why GUILD
    // stays null and the header says "settling…".
    const { rows, GUILD } = mergeRows({ ...entry, settled: false, players: [] });
    expect(GUILD).toBeNull();
    expect(rows.map(r => r[0])).toEqual(['Hitya']);
  });

  it('renders nothing at all with no fight selected', () => {
    expect(mergeRows(null).rows).toEqual([]);
  });

  it('survives a guild row for someone with no local sighting at all', () => {
    const { rows } = mergeRows({ ...entry, local: [] });
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r[7] === 0)).toBe(true);
  });
});
