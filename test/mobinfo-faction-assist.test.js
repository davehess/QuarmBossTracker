// test/mobinfo-faction-assist.test.js — Target Info's Faction sub-tab says which faction the
// mob IS on (linked to its wolfpack.quest page), who in the zone will assist it, and which
// factions it helps (the guild lead, 2026-10-06, looking at "an enforcer": the tab said
// "No faction change recorded for this mob." while a High Guardian of Justice joined the
// fight against the player).
//
// Runs mobinfo.html's real renderFactions + esc. The bot sends faction_primary {id,name},
// faction_assists [{id,name}], faction_assisted_by [{name,npc_id}] and
// faction_assisted_by_more; an older bot sends none of them and the tab must read as before.
//
// ⚠ A locked overlay is click-through: the faction link needs the hover handshake or the
// click lands on EverQuest instead. The wiring tests below read the source with comments
// stripped (a comment here names the very selectors being asserted).
//
// Run: npx vitest run test/mobinfo-faction-assist.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const src = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'mobinfo.html'), 'utf8');

// The page's own esc (one line), then the real function. The slice ends at the Loot tab
// marker the sibling faction test uses.
const { renderFactions } = evalBlock(
  sliceBlock(src, '  function esc(s){', '\n') + '\n'
  + sliceBlock(src, '  function renderFactions(mob){', '\n  // ── Loot tab '),
  ['renderFactions'],
);

const KAAVIN = [
  { name: 'Dain Frostreaver IV', value: -50 },
  { name: 'Coldain',             value: -50 },
  { name: 'King Tormax',         value:  25 },
];

// What the tab rendered before this change, character for character.
const OLD_NONE = '<div class="sn" style="font-size:10px;color:#6e7681;padding:2px 0">No faction change recorded for this mob.</div>';
const OLD_ROWS = '<div class="facwrap"><div class="sn" style="font-size:9px;color:#6e7681;margin-bottom:2px">on kill</div>'
  + '<div class="fac"><span class="fn">Dain Frostreaver IV</span><span class="fv dn">-50</span></div>'
  + '<div class="fac"><span class="fn">Coldain</span><span class="fv dn">-50</span></div>'
  + '<div class="fac"><span class="fn">King Tormax</span><span class="fv up">+25</span></div>'
  + '</div>';

// The report: an enforcer is on KOS, has no on-kill faction change, and the High Guardian
// of Justice came to its aid.
const ENFORCER = {
  id: 201123, name: 'an enforcer', factions: [],
  faction_primary: { id: 5017, name: 'KOS' },
  faction_assists: [],
  faction_assisted_by: [{ name: 'High Guardian of Justice', npc_id: 201446 }],
  faction_assisted_by_more: 0,
};

describe('a mob on a faction with nothing on kill (the enforcer)', () => {
  const h = renderFactions(ENFORCER);

  it('names the faction and links it to its wolfpack.quest page', () => {
    expect(h).toContain('<span class="fk">Faction:</span> ');
    expect(h).toContain('<a class="facl" data-facl="https://wolfpack.quest/db/faction/5017"');
    expect(h).toContain('>KOS ↗</a>');
  });

  it('lists who will assist it, as plain text', () => {
    expect(h).toContain('<span class="fk">Assisted by:</span> High Guardian of Justice');
    expect(h.match(/<a /g)).toHaveLength(1);      // only the faction is a link
  });

  it('says "No faction change on kill." instead of the old line, with no on-kill label', () => {
    expect(h).toContain('No faction change on kill.');
    expect(h).not.toContain('recorded for this mob');
    expect(h).not.toMatch(/>on kill</);
  });

  it('has no Helps line when the faction helps nobody, and no red', () => {
    expect(h).not.toContain('Helps:');
    expect(h).not.toContain('#f85149');
    expect(h).not.toContain('fv dn');
  });
});

describe('an older bot (none of the new fields)', () => {
  it('renders the empty-faction line exactly as before', () => {
    expect(renderFactions({ factions: [] })).toBe(OLD_NONE);
    expect(renderFactions({ factions: null })).toBe(OLD_NONE);
    expect(renderFactions({})).toBe(OLD_NONE);
  });

  it('renders the on-kill list exactly as before', () => {
    expect(renderFactions({ factions: KAAVIN })).toBe(OLD_ROWS);
  });

  it('treats null / empty new fields as absent', () => {
    expect(renderFactions({ factions: [], faction_primary: null, faction_assists: [], faction_assisted_by: [], faction_assisted_by_more: 0 })).toBe(OLD_NONE);
    expect(renderFactions({ factions: KAAVIN, faction_primary: null, faction_assisted_by: [] })).toBe(OLD_ROWS);
  });

  it('still claims nothing while the lookup is in flight', () => {
    expect(renderFactions(null)).toBe('<div class="sn" style="font-size:10px;color:#6e7681;padding:2px 0"></div>');
  });
});

describe('a mob with a faction AND on-kill rows', () => {
  const h = renderFactions({
    factions: KAAVIN,
    faction_primary: { id: 405, name: 'Dain Frostreaver IV' },
    faction_assists: [{ id: 406, name: 'Coldain' }, { id: 407, name: 'Kromrif' }],
    faction_assisted_by: [{ name: 'Royal Guard Brokk', npc_id: 1 }],
  });

  it('puts the faction, the helpers, the faction it helps, then the on-kill list', () => {
    const at = (s) => h.indexOf(s);
    expect(at('Faction:')).toBeGreaterThan(-1);
    expect(at('Faction:')).toBeLessThan(at('Assisted by:'));
    expect(at('Assisted by:')).toBeLessThan(at('Helps:'));
    expect(at('Helps:')).toBeLessThan(at('>on kill<'));
    expect(at('>on kill<')).toBeLessThan(at('<div class="fac">'));
  });

  it('lists the factions it helps, comma-separated', () => {
    expect(h).toContain('<span class="fk">Helps:</span> Coldain, Kromrif');
  });

  it('keeps the on-kill rows exactly as before (and no "No faction change" line)', () => {
    expect(h).toContain(OLD_ROWS.replace('<div class="facwrap">', ''));
    expect(h).not.toContain('No faction change');
  });
});

describe('many assisters', () => {
  const by = Array.from({ length: 12 }, (_, i) => ({ name: 'Guard ' + String.fromCharCode(65 + i), npc_id: 1000 + i }));

  it('lists every name the bot sent and a muted "+N more" for the rest', () => {
    const h = renderFactions({ factions: [], faction_primary: { id: 1, name: 'KOS' }, faction_assisted_by: by, faction_assisted_by_more: 5 });
    for (const b of by) expect(h).toContain(b.name);
    expect(h).toContain('Guard L <span class="fk">+5 more</span>');
  });

  it('shows no "+N more" when the bot sent none', () => {
    const h = renderFactions({ factions: [], faction_primary: { id: 1, name: 'KOS' }, faction_assisted_by: by, faction_assisted_by_more: 0 });
    expect(h).not.toContain('more</span>');
  });

  it('folds a repeated name to a count, so five guards read as one entry', () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ name: 'a guard', npc_id: i }));
    const h = renderFactions({ factions: [], faction_primary: { id: 1, name: 'KOS' }, faction_assisted_by: [...five, { name: 'a captain', npc_id: 9 }] });
    expect(h).toContain('a guard ×5, a captain');
  });

  it('wraps rather than overflows the small window', () => {
    const css = src.slice(src.indexOf('.fmeta{'), src.indexOf('.fmeta{') + 160);
    expect(css).toMatch(/overflow-wrap:\s*anywhere/);
    expect(css).not.toMatch(/white-space:\s*nowrap/);
  });
});

describe('names come from the catalog and are escaped', () => {
  const h = renderFactions({
    factions: [],
    faction_primary: { id: 7, name: '<img src=x onerror=1>' },
    faction_assists: [{ id: 8, name: '"><script>x</script>' }],
    faction_assisted_by: [{ name: '<b>Guard</b> & co', npc_id: 3 }],
  });

  it('never emits a raw tag from a faction or NPC name', () => {
    expect(h).not.toContain('<img');
    expect(h).not.toContain('<script');
    expect(h).not.toContain('<b>');
    expect(h).toContain('&lt;img src=x onerror=1&gt; ↗');
    expect(h).toContain('&lt;b&gt;Guard&lt;/b&gt; &amp; co');
  });

  it('links only a plain integer faction id, never an id that could break the attribute', () => {
    const bad = renderFactions({ factions: [], faction_primary: { id: '5017" onmouseover="x', name: 'KOS' } });
    expect(bad).not.toContain('data-facl');
    expect(bad).not.toContain('onmouseover');
    expect(bad).toContain('KOS');
    const noId = renderFactions({ factions: [], faction_primary: { name: 'KOS' } });
    expect(noId).not.toContain('data-facl');
    expect(noId).toContain('KOS');
  });

  it('survives garbage in the new fields', () => {
    expect(() => renderFactions({ factions: [], faction_primary: 'KOS', faction_assisted_by: 'x', faction_assists: { a: 1 }, faction_assisted_by_more: 'many' })).not.toThrow();
    const g = renderFactions({ factions: [], faction_assisted_by: [null, {}, { name: '' }, { name: 'Real' }] });
    expect(g).toContain('Assisted by:</span> Real');
  });
});

describe('the link works on a locked overlay', () => {
  const code = stripJs(src);

  it('opens the faction page through the same IPC as the PQDI chip', () => {
    expect(code).toMatch(/closest\('\.facl'\)[\s\S]{0,200}getAttribute\('data-facl'\)[\s\S]{0,120}window\.mimic\.openExternal\(furl\)/);
  });

  it('arms and releases the hover handshake on the link', () => {
    expect(code).toMatch(/closest\('[^']*\.facl'\)[^\n]*\n[^\n]*overlayHoverInteractive\(true\)/);
    expect(code).toMatch(/closest\('[^']*\.facl'\)[^\n]*\n[^\n]*overlayHoverInteractive\(false\)/);
  });

  it('is an <a> element, which the preload also arms on its own', () => {
    expect(renderFactions(ENFORCER)).toMatch(/<a class="facl" /);
  });

  it('is on the allow-list main.js checks before opening anything', () => {
    const main = stripJs(fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'main.js'), 'utf8'));
    const m = main.match(/ipcMain\.handle\('open-external'[\s\S]*?const ALLOW = (\/.*\/i);/);
    expect(m).not.toBeNull();
    // eslint-disable-next-line no-new-func
    const allow = new Function('return ' + m[1])();
    expect(allow.test('https://wolfpack.quest/db/faction/5017')).toBe(true);
    expect(allow.test('https://evil.example/db/faction/5017')).toBe(false);
  });
});
