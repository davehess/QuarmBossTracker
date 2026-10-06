// test/target-info-fqv.test.js — Target Info's F/Q/V tab (the guild lead, 2026-09-28: "Make it
// F/Q/V for Faction, Quests, and Vendor. Don't bother showing Vendor if its not a vendor mob.
// Then have sub-tabs underneath that."). Runs mobinfo.html's real render functions with a stub
// fetch: the sub-tabs, Vendor only for a merchant, and the copy chips carrying /say and /map.
//
// Run: npx vitest run test/target-info-fqv.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock, stripJs } from './_source-slice.js';

const html = readSource(path.join(ROOT, 'apps', 'mimic', 'mobinfo.html'));

function load(npcById) {
  const block = sliceBlock(html, '  var _fqvSub = \'quest\';', '\n  var _copyHoldUntil = 0;');
  const store = {};
  const env = {
    window: { localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } } },
    fetch: (url) => {
      const id = Number(new URL(url).searchParams.get('id'));
      return Promise.resolve({ json: () => Promise.resolve({ npc: npcById[id] || null }) });
    },
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  // eslint-disable-next-line no-new-func
  const api = new Function('window', 'fetch', 'esc', 'PORT', '_renderBody', '_lastMi', 'renderFactions',
    block + '\nreturn { renderFqv, _setSub: function(s){ _fqvSub = s; }, _open: function(k){ _qOpen[k] = true; } };')(
    env.window, env.fetch, esc, 7779, () => {}, null, () => '<div class="facwrap">factions</div>');
  return api;
}

const TARERD = { id: 202299, say: [{ keywords: ['from me'], replies: [{ kind: 'say', text: 'bring me the blood of a Sarnak' }], gated: false, flag: false, hints: [] }],
  trade: [], turnins: [], next: [{ id: 202223, name: 'Vicar Thiran', zone_long: 'The Plane of Knowledge', y: 121, x: -300 }], vendor: [] };
const WAUT = { id: 202194, say: [], trade: [], turnins: [], next: [], vendor: [{ id: 1, name: 'Spell: Stun', price: 12 }] };
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('F/Q/V', () => {
  it('a quest NPC gets Faction and Quest, with /say and /map chips', async () => {
    const f = load({ 202299: TARERD });
    f.renderFqv({ id: 202299 });
    await settle(); await settle();
    const out = f.renderFqv({ id: 202299 });
    expect([...out.matchAll(/data-fqv="(\w+)"/g)].map((m) => m[1])).toEqual(['faction', 'quest']);
    expect(out).toContain('data-copy="/say from me"');
    expect(out).toContain('data-copy="/map 121 -300"');
  });

  it('Vendor appears only for a merchant, and a remembered Vendor falls back to Quest elsewhere', async () => {
    const f = load({ 202194: WAUT, 202299: TARERD });
    f.renderFqv({ id: 202194 }); await settle(); await settle();
    f._setSub('vendor');
    const merchant = f.renderFqv({ id: 202194 });
    expect([...merchant.matchAll(/data-fqv="(\w+)"/g)].map((m) => m[1])).toEqual(['faction', 'quest', 'vendor']);
    expect(merchant).toContain('Spell: Stun');
    expect(merchant).toContain('1s 2c');
    f.renderFqv({ id: 202299 }); await settle(); await settle();
    const other = f.renderFqv({ id: 202299 });
    expect(other).not.toContain('data-fqv="vendor"');
    expect(other).toMatch(/class="fqvtab on" data-fqv="quest"/);
  });
});

describe('an NPC that only listens while you sit', () => {
  it('puts "sit first" and a /sit chip before the whole phrase the branch needs', async () => {
    const SEER = { id: 202006, say: [{ keywords: ['unlock', 'memories'], say: 'unlock memories', sit: true,
      replies: [{ kind: 'message', text: 'Please, sit down for a moment.' }], gated: false, flag: false, hints: [] }],
      trade: [], turnins: [], next: [], vendor: [] };
    const f = load({ 202006: SEER });
    f.renderFqv({ id: 202006 }); await settle(); await settle();
    const out = f.renderFqv({ id: 202006 });
    expect(out.indexOf('sit first')).toBeGreaterThan(-1);
    expect(out.indexOf('data-copy="/sit"')).toBeLessThan(out.indexOf('data-copy="/say unlock memories"'));
    expect(out).not.toContain('data-copy="/say unlock"');
  });
});

// The guild lead, 2026-09-29: "we should be collapse the npc text and put a warning on anything
// that despawns a mob or spawns something else, or causes negative faction. If there are turn-in
// requirements or you get an item as output from a quest we should denote that", and "we should
// also track faction for these quests as well where it makes sense".
describe('the Quest tab folds the NPC text, warns, and labels items', () => {
  const WARDEN = { id: 202300, say: [
    { keywords: ['fight'], say: 'fight', replies: [{ kind: 'say', text: 'Guards! Seize them!' }], gated: false, flag: false, hints: [],
      warn: { despawn: true, spawns: [{ id: 202401, name: 'a warden guard' }] } },
    { keywords: ['sword'], say: 'sword', replies: [{ kind: 'say', text: 'Take it.' }], gated: false, flag: false, hints: [],
      needs: [{ id: 1234, name: 'Rusty Key' }], gives: [{ id: 15392, name: 'Spell: Resurrection' }] },
  ], trade: [{ kind: 'say', text: 'old-bot words' }], turnins: [
    { inputs: [{ id: 22519, name: 'Sarnak Blood', qty: 2 }], outputs: [{ id: 15958, name: 'Note From Tarerd' }, { id: 15392, name: 'Spell: Resurrection' }],
      exp: 1000, random: true, warn: { despawns: [{ id: 202223, name: 'Vicar Thiran' }] },
      faction: [{ id: 1504, name: 'Knowledge Seekers', delta: 10 }, { id: 1505, name: 'Dark Reflection', delta: -25 }],
      says: [{ kind: 'say', text: 'Two of them. Good.' }] },
  ], next: [], vendor: [] };
  async function render(open) {
    const f = load({ 202300: WARDEN });
    f.renderFqv({ id: 202300 }); await settle(); await settle();
    f.renderFqv({ id: 202300 });
    for (const k of open || []) f._open(k);
    return f.renderFqv({ id: 202300 });
  }

  it('what the NPC says is folded behind a toggle until opened', async () => {
    const closed = await render();
    expect(closed).not.toContain('Guards! Seize them!');
    expect(closed).not.toContain('Two of them. Good.');
    expect(closed).toContain('data-qk="s0"');
    expect(closed).toContain('data-qk="t0"');
    const opened = await render(['s0']);
    expect(opened).toContain('Guards! Seize them!');
    expect(opened).not.toContain('Two of them. Good.');
  });

  it('warns on a despawn, a spawn and a faction loss', async () => {
    const out = await render();
    expect(out).toContain('⚠ despawns</span>');
    expect(out).toContain('⚠ spawns a warden guard');
    expect(out).toContain('⚠ despawns Vicar Thiran');
    expect(out).toMatch(/qtag bad" title="Dark Reflection -25">⚠ faction −/);
  });

  it('every faction change shows, gains and losses', async () => {
    const out = await render();
    expect(out).toContain('<span class="up">+10</span> Knowledge Seekers');
    expect(out).toContain('<span class="dn">−25</span> Dark Reflection');
  });

  it('a hand-in says what you give and what you get; a branch what it needs and gives', async () => {
    const out = await render();
    expect(out).toContain('<span class="qlbl">give</span><span>2× Sarnak Blood</span>');
    expect(out).toContain('<span class="qget">one of Note From Tarerd, Spell: Resurrection · exp</span>');
    expect(out).toContain('needs Rusty Key');
    expect(out).toContain('get Spell: Resurrection');
    expect(out).not.toContain('old-bot words');     // Per-hand-in words win over the old whole-NPC list.
  });
});

describe('a locked overlay still takes the clicks', () => {
  const code = stripJs(html);
  it('the hover handshake covers the sub-tabs, chips and the says toggles', () => {
    expect(code).toMatch(/closest\('\.pqdi, \.fqvtab, \.qcopy, \.qtoggle, \.facl'\)[^\n]*\n[^\n]*overlayHoverInteractive\(true\)/);
    expect(code).toMatch(/closest\('\.pqdi, \.fqvtab, \.qcopy, \.qtoggle, \.facl'\)[^\n]*\n[^\n]*overlayHoverInteractive\(false\)/);
  });
});
