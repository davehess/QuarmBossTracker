// test/mobinfo-corpse-lastfight.test.js — Target Info's "last fight (top 5)" belongs to the corpse of the
// mob that fight was against, and to no other corpse (FB-63).
//
// A member, 2026-10-07 (3.0 alpha): "I'm targetting <a player>'s corpse but it shows the last fight
// data here and its not correct." The list is Target Info's own "last fight (top 5)" section (the
// Timers canvas draws the same section as its "Last fight (top 5)" piece). It was keyed on the
// target's NAME ENDING IN "'s corpse" and nothing else, so a raider's corpse showed whichever fight
// the agent still held — the live one, or the last for two minutes after.
//
// Runs the overlay's real corpseOwner / lastFightFits, and its real last-fight and note blocks as
// functions over a fake target. Names are invented.
//
// Run: npx vitest run test/mobinfo-corpse-lastfight.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_source-slice.js';

const html = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'mobinfo.html'), 'utf8');
const slice = (from, to) => {
  const a = html.indexOf(from);
  const b = html.indexOf(to, a + 1);
  if (a < 0 || b < 0) throw new Error('block not found: ' + from);
  return html.slice(a, b);
};
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const helpers = slice('  function corpseOwner(name){', '  function _renderBody(mi){');
const { corpseOwner, lastFightFits } = new Function(helpers + '\nreturn { corpseOwner, lastFightFits };')();

// The block that builds the scoreboard, run over (mi, corpseOf).
const lastFightBlock = slice("    var lastFight = '';", '    // PC target slot occupancy');
const lastFightFor = (mi) =>
  new Function('mi', 'corpseOf', 'lastFightFits', 'esc', lastFightBlock + '\nreturn lastFight;')(mi, corpseOwner(mi.target_name), lastFightFits, esc);

// The note under a target with no catalog row.
const noteBlock = slice('      var loadingNote = (!mob && mi.loading)', '      // A PLAYER target');
const noteFor = (mi, mob) =>
  new Function('mob', 'mi', 'corpseOf', 'esc', noteBlock + '\nreturn loadingNote;')(mob || null, mi, corpseOwner(mi.target_name), esc);

// The agent's snapshot of the fight the member just had: a gnoll warlord, three raiders on it.
const enc = (over = {}) => ({
  bossName: 'a gnoll warlord', targetName: 'a gnoll warlord', flushedAt: null,
  perPlayer: {
    Aldenmar: { dmg: 41000, took: 0 },
    Brackwyn: { dmg: 22500, took: 9000 },
    Corvale:  { dmg: 800, took: 0 },
  },
  ...over,
});
const target = (name, over = {}) => ({ target_name: name, mob: null, loading: false, _enc: enc(), ...over });

describe('corpseOwner — whose corpse is it', () => {
  it('a player\'s, an NPC\'s, a named NPC\'s', () => {
    expect(corpseOwner("Razek's corpse")).toBe('Razek');
    expect(corpseOwner("a gnoll warlord's corpse")).toBe('a gnoll warlord');
    expect(corpseOwner("A Temple Patroller's corpse")).toBe('A Temple Patroller');
  });
  it('a number after "corpse", a backtick, a curly apostrophe', () => {
    expect(corpseOwner("Aldenmar's corpse498")).toBe('Aldenmar');
    expect(corpseOwner('a gnoll`s corpse2')).toBe('a gnoll');
    expect(corpseOwner('Vyzh`dra`s corpse')).toBe('Vyzh`dra');
    expect(corpseOwner('Brackwyn’s corpse')).toBe('Brackwyn');
  });
  it('null for anything that is not a corpse\'s name', () => {
    for (const n of ['Aldenmar', 'a gnoll warlord', 'corpse', "Aldenmar's corpse of rot", "Aldenmar's body", '', null, undefined]) {
      expect(corpseOwner(n)).toBe(null);
    }
  });
});

describe('lastFightFits — is that fight this corpse\'s', () => {
  it('the corpse of the mob the fight was against', () => {
    expect(lastFightFits('a gnoll warlord', enc())).toBe(true);
  });
  it('case, a backtick vs an apostrophe, and spacing do not matter', () => {
    expect(lastFightFits('A Gnoll  Warlord', enc())).toBe(true);
    expect(lastFightFits('Vyzh`dra', enc({ bossName: "Vyzh'dra", targetName: null }))).toBe(true);
  });
  it('either name the agent keeps for the fight counts', () => {
    expect(lastFightFits('a gnoll warlord', enc({ bossName: null }))).toBe(true);
    expect(lastFightFits('a gnoll warlord', enc({ targetName: null }))).toBe(true);
  });
  it('a raider\'s corpse, or another mob\'s, is not that fight\'s', () => {
    expect(lastFightFits('Razek', enc())).toBe(false);
    expect(lastFightFits('Aldenmar', enc())).toBe(false);     // even one who was IN the fight
    expect(lastFightFits('a gnoll pawn', enc())).toBe(false);
  });
  it('proves nothing, shows nothing: no fight, no names on it, no owner', () => {
    expect(lastFightFits('a gnoll warlord', null)).toBe(false);
    expect(lastFightFits('a gnoll warlord', enc({ bossName: null, targetName: null }))).toBe(false);
    expect(lastFightFits('', enc())).toBe(false);
    expect(lastFightFits(null, enc())).toBe(false);
  });
});

describe('the "last fight (top 5)" section', () => {
  it('THE REPORT: a player\'s corpse shows no fight data, though a fight is held', () => {
    expect(lastFightFor(target("Razek's corpse"))).toBe('');
    expect(lastFightFor(target("Aldenmar's corpse498"))).toBe('');
  });
  it('the corpse of the mob that fight was against still shows it — that is what it is for', () => {
    const out = lastFightFor(target("a gnoll warlord's corpse"));
    expect(out).toContain('last fight (top 5)');
    expect(out).toContain('data-wp-sect="lastfight"');
    expect(out.indexOf('Aldenmar')).toBeGreaterThan(-1);
    expect(out.indexOf('Aldenmar')).toBeLessThan(out.indexOf('Brackwyn'));
  });
  it('and when the pipe puts a number after "corpse", or a backtick for the apostrophe', () => {
    expect(lastFightFor(target("a gnoll warlord's corpse2"))).toContain('last fight (top 5)');
    expect(lastFightFor(target('a gnoll warlord`s corpse'))).toContain('last fight (top 5)');
  });
  it('another mob\'s corpse, targeted while that fight is still held, shows nothing', () => {
    expect(lastFightFor(target("a gnoll pawn's corpse"))).toBe('');
  });
  it('a living target never shows it, whatever its name', () => {
    expect(lastFightFor(target('a gnoll warlord'))).toBe('');
    expect(lastFightFor(target('Aldenmar'))).toBe('');
  });
  it('no fight held, or one with nobody in it, shows nothing', () => {
    expect(lastFightFor(target("a gnoll warlord's corpse", { _enc: null }))).toBe('');
    expect(lastFightFor(target("a gnoll warlord's corpse", { _enc: enc({ perPlayer: { Aldenmar: { dmg: 0, took: 0 } } }) }))).toBe('');
  });
});

describe('the line under a corpse with no catalog row', () => {
  it('says whose corpse it is, instead of "no catalog stats"', () => {
    expect(noteFor(target("Razek's corpse"))).toBe('<div class="sub">corpse of Razek</div>');
  });
  it('still says "looking up stats" while the lookup is out, and "no catalog stats" for a living target', () => {
    expect(noteFor(target("Razek's corpse", { loading: true }))).toContain('looking up stats');
    expect(noteFor(target('Razek'))).toContain('no catalog stats for this target');
  });
  it('says nothing extra for a corpse the catalog does know', () => {
    expect(noteFor(target("a gnoll warlord's corpse"), { name: 'a gnoll warlord' })).toBe('');
  });
  it('the owner is escaped', () => {
    expect(noteFor(target("<b>x</b>'s corpse"))).toBe('<div class="sub">corpse of &lt;b&gt;x&lt;/b&gt;</div>');
  });
});
