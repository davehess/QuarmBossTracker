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
    block + '\nreturn { renderFqv, _setSub: function(s){ _fqvSub = s; } };')(
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

describe('a locked overlay still takes the clicks', () => {
  const code = stripJs(html);
  it('the hover handshake covers the sub-tabs and chips', () => {
    expect(code).toMatch(/closest\('\.pqdi, \.fqvtab, \.qcopy'\)[^\n]*\n[^\n]*overlayHoverInteractive\(true\)/);
    expect(code).toMatch(/closest\('\.pqdi, \.fqvtab, \.qcopy'\)[^\n]*\n[^\n]*overlayHoverInteractive\(false\)/);
  });
});
