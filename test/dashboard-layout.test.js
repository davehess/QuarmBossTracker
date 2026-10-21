// test/dashboard-layout.test.js — Layout A, "Triage" (the guild lead, 2026-10-21).
//
// The guild lead: "Things are so spaced out, important sections are buried at the bottom of a huge scrolling
// page." Layout A is four changes, and this file pins each by RUNNING the real functions out of dashboard.html
// (the authoring source; WEB_HTML is its byte-checked fold) rather than matching comment text:
//   1. the rail is grouped under four headings, and every tab is still where the switcher, the tour and the
//      deep links expect it;
//   2. importance order: Fights runs Replay (folded) · Threat · Deaths · Incoming · Healers (+ Exceptional heals
//      folded) · DPS breakdown · Top abilities · then Pets / Damage shields / Weapon loadouts, folded;
//   3. a pinned index of chips names the open tab's cards, and is byte-stable;
//   4. every growing card is capped with the shared "N more" fold.
//
// Run: npx vitest run test/dashboard-layout.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, sliceBlock, stripJs } from './_source-slice.js';

const html = fs.readFileSync(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'), 'utf8');
const code = stripJs(html);

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtK = (n) => String(n);

// ── 1. the rail ───────────────────────────────────────────────────────────────────────────────────────────────
describe('the rail is grouped by when you reach for a tab', () => {
  const nav = sliceBlock(html, '<div class="nav">', '<div class="wp-rail-foot">');
  const groups = [];
  for (const m of nav.matchAll(/<div class="wp-rail-h">([^<]*)<\/div>|<button[^>]*data-tab="([a-z]+)"/g)) {
    if (m[1] != null) groups.push({ title: m[1].replace('&mdash;', '—'), tabs: [] });
    else groups[groups.length - 1].tabs.push(m[2]);
  }

  it('has the four groups, in order, with the tabs the guild lead named', () => {
    expect(groups).toEqual([
      { title: 'Live — raid night', tabs: ['dash', 'raid', 'fights'] },
      { title: 'After the raid', tabs: ['myparses', 'stats', 'loot'] },
      { title: 'Set up', tabs: ['overlays', 'triggers', 'voice', 'buffs'] },
      { title: 'Machine', tabs: ['diag', 'info', 'optin', 'admin'] },
    ]);
  });

  it('still reaches every tab: one button each, a section each, nothing else lost', () => {
    const tabs = groups.flatMap((g) => g.tabs);
    expect([...tabs].sort()).toEqual(['admin', 'buffs', 'dash', 'diag', 'fights', 'info', 'loot', 'myparses', 'optin', 'overlays', 'raid', 'stats', 'triggers', 'voice']);
    for (const t of tabs) expect(html, `section for ${t}`).toMatch(new RegExp('<div id="' + t + '" class="section[ "]'));
  });

  it('headings are plain divs: not buttons, no data-tab, so nothing that binds the tab buttons sees them', () => {
    for (const m of nav.matchAll(/<div class="wp-rail-h"[^>]*>/g)) expect(m[0]).not.toContain('data-tab');
    expect(code).toContain(".nav button[data-tab]");
    // the narrow-window row layout drops them rather than letting them wrap among the buttons
    expect(html).toMatch(/@media \(max-width: 700px\) \{[\s\S]*?\.nav \.wp-rail-h \{ display:none; \}/);
  });

  it('keeps the Admin tab hidden until the bot says the viewer is an officer', () => {
    expect(nav).toContain('<button data-tab="admin" id="wpAdminTab" style="display:none"');
  });
});

// ── 2. importance order ───────────────────────────────────────────────────────────────────────────────────────
// Run the Fights renderers for real, with a populated state, and read the cards back in DOM order.
function loadFights() {
  const writes = {};
  const block = sliceBlock(html, 'function renderTanks(s) {', '// ── Triggers tab')
    + '\n' + sliceBlock(html, 'var _wpMoreOpen = {};', "btn.textContent = wpMoreLabel(open, btn.getAttribute('data-n'), btn.getAttribute('data-noun'));\n}")
    + '\n' + sliceBlock(html, 'function wpFoldCard(', "'</details></div>';\n}")
    + '\n' + sliceBlock(html, 'function renderReplayCard(s) {', '\n// 🗣 Voice tab');
  const fn = new Function('esc', 'fmtK', 'fmtAgo', 'setSectionHTML', 'wpKeep', 'wpPartitionChars', 'wpLowToggleHtml', 'window', 'document', 'fetch', 'refresh', '_bindOnce', block
    + '\nreturn { renderTanks, renderDeeps, renderFightsMore, renderReplayCard, wpDeathRecapsHtml, buildHealersHtml, _wpMoreOpen, wpIndexLabelFor: null };');
  const keepStore = {};
  const api = fn(esc, fmtK, () => '1m ago', (id, h) => { writes[id] = h; return true; },
    (k, d) => 'data-keep="' + esc(k) + '"' + ((k in keepStore ? keepStore[k] : d) ? ' open' : ''),
    (l) => ({ shown: l, unknown: [], tucked: [] }), () => '', {}, { querySelectorAll: () => [], getElementById: () => null }, () => {}, () => {}, () => {});
  return { api, writes, keepStore };
}
const names = ['Aldenmar', 'Brackwyn', 'Corvale', 'Rethlan', 'Nyssara', 'Zarrin', 'Thessaly', 'Orvane'];
const many = (f) => Object.fromEntries(names.map((n, i) => [n, f(i)]));
function fightState() {
  return {
    currentEncounterThreat: { bossName: 'Aldenmar the Ruined', perPlayer: many((i) => ({ total: 1000 - i, swing: 1, proc: 1, spell: 1, heal: 1 })) },
    sessionDefenders: many((i) => ({ damageTaken: 900 - i, hits: 5 })),
    sessionDeaths: many((i) => 1 + i),
    deathRecaps: names.slice(0, 5).map((n, i) => ({ id: i + 1, name: n, ts: 1700000000000 + i, lastChOffMs: null, dmg6: 10, hits: [], heals: [] })),
    sessionHealers: many((i) => ({ healed: 500 - i, ticks: 3, targets: ['Corvale'] })),
    sessionCritHeals: many((i) => ({ count: 3, total: 100 - i, max: 9 })),
    sessionDeeps: many((i) => ({ melee: { total: 900 - i, count: 3, max: 9 }, topAbilities: { Kick: { total: 10, count: 1 } } })),
    damageShield: many((i) => ({ 'Legacy of Thorn': { total: 100 - i, count: 2 } })),
    knownPets: names.slice(0, 3).map((n) => ({ pet: 'Gobsy', owners: [n] })),
    characterInventories: { Aldenmar: { weapons: { primary: { id: 1, name: 'Blade' } }, _updatedAt: new Date().toISOString(), _path: 'C:\\EQ\\x' } },
    watchedLogs: [{ character: 'Aldenmar', logPath: 'C:/eq/eqlog_Aldenmar_pq.proj.txt' }],
  };
}
// The cards of the whole Fights tab, in DOM order, named the way the pinned index names them.
function fightsCards(s) {
  const { api, writes } = loadFights();
  api.renderReplayCard(s); api.renderTanks(s); api.renderDeeps(s); api.renderFightsMore(s);
  const dom = writes.fightsReplay + writes.tanks + writes.deeps + writes.fightsMore;
  const cards = [];
  for (const m of dom.matchAll(/<div class="card[^"]*"( data-index="([^"]*)")?>(?:<details[^>]*><summary>)?(?:[\s\S]*?)<h2>([^<]*)/g)) {
    cards.push(m[2] || m[3].split('(')[0].split('—')[0].split('·')[0].trim());
  }
  return { cards, dom, writes };
}

describe('⚔️ Fights runs most important first', () => {
  it('has the Replay target on top, then tanks, deeps, and the folded three last', () => {
    const fights = sliceBlock(html, '<div id="fights" class="section">', '</div>\n<div id="myparses"');
    const ids = [...fights.matchAll(/<div id="([A-Za-z]+)"><\/div>/g)].map((m) => m[1]);
    expect(ids).toEqual(['fightsReplay', 'tanks', 'deeps', 'fightsMore']);
    expect(code).toMatch(/\['fightsMore', renderFightsMore\]/);
  });

  it('lists the cards Replay · Threat · Deaths · Incoming · Healers · Exceptional heals · DPS · Abilities · Pets · Shields · Loadouts', () => {
    expect(fightsCards(fightState()).cards).toEqual(['Replay', 'Threat', 'Deaths', 'Incoming', 'Healers', 'Exceptional heals', 'DPS', 'Abilities', 'Pets', 'Shields', 'Loadouts']);
  });

  it('starts Replay, Exceptional heals, Pets, Damage shields and Weapon loadouts folded (wpKeep, closed)', () => {
    const { dom } = fightsCards(fightState());
    for (const k of ['fights|replay', 'fights|exceptional', 'fights|pets', 'fights|damage-shields', 'fights|loadouts']) {
      expect(dom, k).toContain('<details data-keep="' + k + '"><summary><h2>');   // no " open"
    }
  });

  it('puts every one of them behind the same wp-fold card shape, so the Panels hide and overlay matcher still see an h2', () => {
    const { dom } = fightsCards(fightState());
    expect((dom.match(/class="card[^"]*wp-fold"/g) || []).length).toBe(5);
    expect((dom.match(/<summary><h2>/g) || []).length).toBe(5);
  });

  it('every <details> it draws carries wpKeep', () => {
    const { dom } = fightsCards(fightState());
    for (const m of dom.matchAll(/<details[^>]*>/g)) expect(m[0]).toContain('data-keep=');
  });

  it('Damage shields, Pets and Loadouts left the Stats tab', () => {
    const stats = sliceBlock(code, 'function renderStats(s) {', "setSectionHTML('stats', h);");
    for (const f of ['buildLoadoutsHtml', 'buildPetsHtml', 'wireLoadoutControls']) expect(stats).not.toContain(f);
    expect(sliceBlock(code, 'function renderTanks(s) {', "setSectionHTML('tanks', h);")).not.toContain('Damage Shields');
  });

  it('keeps the panel titles the tray overlays look up', () => {
    const { dom } = fightsCards(fightState());
    for (const t of ['Incoming Damage', 'Threat Detail', 'DEEPS']) expect(dom).toContain(t);
  });

  it('a #replay deep link opens the folded card', () => {
    expect(code).toMatch(/_wpOpenDetails\['fights\|replay'\] = true/);
  });
});

// ── 4. every growing card is capped ───────────────────────────────────────────────────────────────────────────
describe('the growing cards show 3-5 rows and fold the rest behind "N more"', () => {
  const hiddenOf = (dom, key) => (dom.match(new RegExp('data-more-row="' + key.replace('|', '\\|') + '" hidden', 'g')) || []).length;

  it('Fights: threat, deaths, recaps, incoming, healers, exceptional heals, DPS and damage shields', () => {
    const { dom } = fightsCards(fightState());
    expect(hiddenOf(dom, 'fights|threat')).toBe(3);      // 8 players, 5 shown
    expect(hiddenOf(dom, 'fights|deaths')).toBe(3);
    expect(hiddenOf(dom, 'fights|recaps')).toBe(2);      // 5 recaps, 3 shown
    expect(hiddenOf(dom, 'fights|incoming')).toBe(3);
    expect(hiddenOf(dom, 'fights|healers')).toBe(3);
    expect(hiddenOf(dom, 'fights|crits')).toBe(3);
    expect(hiddenOf(dom, 'fights|deeps')).toBe(3);
    expect(hiddenOf(dom, 'fights|ds')).toBe(3);
    for (const noun of ['more players', 'older recaps', 'more tanks', 'more healers']) expect(dom).toContain(noun);
  });

  it('never leaves a lone row behind a toggle: a list one over the cap simply shows', () => {
    const s = fightState();
    s.sessionDeaths = { Aldenmar: 1, Brackwyn: 1, Corvale: 1, Rethlan: 1, Nyssara: 1, Zarrin: 1 };   // 6 = 5 + 1
    expect(hiddenOf(fightsCards(s).dom, 'fights|deaths')).toBe(0);
  });

  it('a recap the person targeted a corpse for is not left behind the fold', () => {
    const { api, writes } = loadFights();
    const s = fightState(); s.deathRecaps = names.map((n, i) => ({ id: i + 1, name: n, ts: 1700000000000 + i, lastChOffMs: null, dmg6: 10, hits: [], heals: [] })); s.deathRecapFocus = 7;
    api.renderTanks(s);
    expect(writes.tanks).not.toMatch(/id="deathrecap-7"[^>]*hidden|data-more-row="fights\|recaps" hidden[^>]*id="deathrecap-7"/);
    expect(api._wpMoreOpen['fights|recaps']).toBe(true);
  });

  it('the other cards use the shared fold too (source)', () => {
    for (const key of ["'stats|resisted'", "'stats|inbound'", "'loot|rolls'", "'trig|fires'", "'diag|zeal-raid'", '"bb|sets|"']) {
      expect(code, key).toContain('wpMoreList(' + key);
    }
  });
});

describe('⚡ Triggers: recent fires first and folded; the guild list starts folded', () => {
  it('Recent fires is the first card of the tab and keeps more than six, five showing', () => {
    const tr = sliceBlock(code, 'function renderTriggers(s) {', '\n}\n');
    expect(tr.indexOf('id="wpRecentFires"')).toBeGreaterThan(-1);
    expect(tr.indexOf('id="wpRecentFires"')).toBeLessThan(tr.indexOf('id="wpMutedTimers"'));
    expect(tr.indexOf('id="wpRecentFires"')).toBeLessThan(tr.indexOf('id="wpGuildTriggers"'));
    const body = sliceBlock(html, 'function renderRecentFires(s) {', '\n}\n') + '\n' + sliceBlock(html, 'var _wpMoreOpen = {};', "btn.textContent = wpMoreLabel(open, btn.getAttribute('data-n'), btn.getAttribute('data-noun'));\n}");
    let painted = '';
    const el = { contains: () => false };
    const fn = new Function('esc', 'document', 'fmtAgo', 'morphInto', 'voiceFireCell', 'enrageMuteCell', 'enrageMutedList', body + '\nreturn renderRecentFires;');
    fn(esc, { getElementById: () => el, activeElement: null }, () => '1m ago', (e, h) => { painted = h; }, () => '', () => '', () => '')({
      activeOverlays: Array.from({ length: 14 }, (_, i) => ({ shownAt: i, trigger: 'Callout ' + i, text: 'Move ' + i })),
    });
    expect((painted.match(/<tr data-more-row="trig\|fires" hidden>/g) || []).length).toBe(9);
    expect(painted).toContain('9 more fires');
    expect(painted).toContain('Callout 13');   // the 14th is kept, behind the fold
  });

  it('the guild triggers card is a wp-fold whose whole list sits inside one closed wpKeep <details>', () => {
    expect(code).toContain('<div id="wpGuildTriggers" class="card wide wp-fold" data-index="Guild triggers"></div>');
    const card = sliceBlock(code, 'function renderGuildTriggersCard(s) {', '\n}\n');
    expect(card).toContain("'<details ' + wpKeep('trig|guild') + '><summary><h2>🛡️ Guild triggers");
    expect(card).toContain("h += '</details>';\n  morphInto(el, h);");
  });
});

describe('ℹ️ Info leads with Parser info and Log archiving', () => {
  it('draws Parser Info, then Log archiving, then Client versions, then Zeal tag capture', () => {
    const info = sliceBlock(code, 'function renderInfo(s) {', "setSectionHTML('info', h);");
    const at = (s) => info.indexOf(s);
    expect(at('<h2>Parser Info</h2>')).toBeGreaterThan(-1);
    expect(at('<h2>Parser Info</h2>')).toBeLessThan(at('<h2>🗂 Log archiving</h2>'));
    expect(at('<h2>🗂 Log archiving</h2>')).toBeLessThan(at('h += _cvH;'));
    expect(at('h += _cvH;')).toBeLessThan(at('<h2>🏷 Zeal tag capture</h2>'));
    // the settings-backups placeholder moved below the grid, after the cards above
    expect(at('id="wpBackupsCard"')).toBeGreaterThan(at('<h2>🏷 Zeal tag capture</h2>'));
  });
});

// ── 3. the pinned index ───────────────────────────────────────────────────────────────────────────────────────
// A minimal DOM: one active section with cards; each card answers what the index reads.
function loadIndex(cards) {
  const block = sliceBlock(html, 'function wpCardLabel(card) {', "behavior: reduce ? 'auto' : 'smooth' });\n}");
  const indexEl = { hidden: true, _html: '', sets: 0, get innerHTML() { return this._html; }, set innerHTML(v) { this._html = v; this.sets++; } };
  const mkCard = (c) => ({
    classList: { contains: (k) => !!c.hiddenClass && k === 'wp-hidden' },
    getClientRects: () => (c.offscreen ? [] : [{}]),
    getAttribute: (k) => (k === 'data-index' ? c.index || null : null),
    querySelector: (sel) => (sel === 'h2' && c.title != null ? { childNodes: [{ nodeType: 3, nodeValue: c.title }, { nodeType: 1, textContent: 'chrome' }], textContent: c.title + 'chrome' } : null),
  });
  const state = { cards };
  const section = { id: 'fights', querySelectorAll: () => state.cards.map(mkCard) };
  const document = {
    getElementById: (id) => (id === 'wpIndex' ? indexEl : null),
    querySelector: (sel) => (sel === '.section.active' ? section : null),
  };
  const api = new Function('document', 'esc', block + '\nreturn { wpIndexSync, wpIndexCards, wpCardLabel };')(document, esc);
  return { api, indexEl, state };
}
const chipsOf = (el) => [...el.innerHTML.matchAll(/<button[^>]*data-ix="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));

describe('the pinned section index', () => {
  it('has a chip per card, named by data-index first and the card title second (cut at "(", "—", "·")', () => {
    const { api, indexEl } = loadIndex([
      { index: 'Threat', title: '⚔️ Threat Detail — Aldenmar' },
      { title: 'Deaths This Session ' },
      { title: 'Healers This Session (14) · beta' },
    ]);
    api.wpIndexSync();
    expect(indexEl.hidden).toBe(false);
    expect(chipsOf(indexEl)).toEqual(['Threat', 'Deaths This Session', 'Healers This Session']);
  });

  it('skips a card the Panels menu hid, one that is not on screen, and a repeated name', () => {
    const { api, indexEl } = loadIndex([
      { title: 'A card' }, { title: 'Hidden one', hiddenClass: true }, { title: 'Off screen', offscreen: true },
      { title: 'A card' }, { title: 'Another' },
    ]);
    api.wpIndexSync();
    expect(chipsOf(indexEl)).toEqual(['A card', 'Another']);
  });

  it('shows no row for fewer than two cards', () => {
    const { api, indexEl } = loadIndex([{ title: 'Only one' }]);
    api.wpIndexSync();
    expect(indexEl.hidden).toBe(true);
    expect(indexEl.innerHTML).toBe('');
  });

  it('is byte-stable: a poll that changes nothing never rewrites the row; a changed card list does', () => {
    const { api, indexEl, state } = loadIndex([{ title: 'One' }, { title: 'Two' }]);
    api.wpIndexSync();
    const first = indexEl.sets;
    api.wpIndexSync(); api.wpIndexSync();
    expect(indexEl.sets).toBe(first);
    state.cards = [{ title: 'One' }, { title: 'Two' }, { title: 'Three' }];
    api.wpIndexSync();
    expect(indexEl.sets).toBe(first + 1);
    expect(chipsOf(indexEl)).toEqual(['One', 'Two', 'Three']);
  });

  it('matches the cards of the real Fights tab', () => {
    const { cards } = fightsCards(fightState());
    const { api, indexEl } = loadIndex(cards.map((c) => ({ index: c })));
    api.wpIndexSync();
    expect(chipsOf(indexEl)).toEqual(cards);
  });

  it('is wired: filled after each poll and on each tab click, listeners at top level, hidden in overlay and feedback modes', () => {
    expect(code).toMatch(/try \{ wpIndexSync\(\); \} catch \(e\) \{ void e; \}\s*\/\/ the pinned section index/);
    expect(sliceBlock(code, "document.querySelectorAll('.nav button[data-tab]').forEach(b => b.addEventListener('click', () => {", '}));')).toContain('wpIndexSync()');
    expect(html).toContain('<div id="wpIndex" class="wp-index" hidden></div>');
    expect(html).toMatch(/body\.wp-overlay-mode \.wp-index, body\.wp-feedback-mode \.wp-index \{ display:none !important; \}/);
    // sticky UNDER the measured top bar
    expect(html).toMatch(/\.wp-index \{ position:sticky; top:var\(--wp-topbar-h, 118px\);/);
  });

  it('scrolls to the card under the top bar and the index, and honours reduced motion', () => {
    const go = sliceBlock(code, 'function wpIndexGo(card) {', "behavior: reduce ? 'auto' : 'smooth' });\n}");
    expect(go).toContain('wpTopBar');
    expect(go).toContain('wpIndex');
    expect(go).toContain('prefers-reduced-motion');
  });
});
