// test/ext-target-self.test.js — Extended Target "Self" scope (FB-88, option A "Local roster").
//
// A member asked for a tab-through list: the mobs YOU have targeted lately, newest first, kept for a
// window you pick. The agent keeps it (fed by every Zeal report of the target), serves it on the route the
// overlay already polls (?scope=self&keep=<sec>), and the overlay renders it. No bot call, no schema.
// Raid and Group are untouched (ext-target-scope-toggle.test.js, ext-target-group-scope.test.js).
//
// Names are invented, per the repo's public-docs convention.
//
// Run: npx vitest run test/ext-target-self.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readSource, sliceBlock, evalBlock, stripJs, AGENT_INDEX } from './_source-slice.js';

// ── agent store ─────────────────────────────────────────────────────────────
const agentSrc = readSource(AGENT_INDEX);
function freshStore() {
  return evalBlock(
    sliceBlock(agentSrc, 'const SELF_TARGET_MAX_KEEP_S = 300;', "\n  return { scope: 'self', keep_secs: keep, targets };\n}"),
    ['_noteSelfTarget', 'selfTargetPayload', '_selfTargets'],
  );
}
const NOW = 1_700_000_000_000;
const st = (name, hp, id, extra) => ({ target_name: name, target_hp_pct: hp, target_id: id, ...extra });

describe('the agent store', () => {
  it('records a target, keyed by spawn id, with name and HP', () => {
    const s = freshStore();
    s._noteSelfTarget('Aldenmar', st('a gnoll', 80, 4425), NOW);
    expect(s.selfTargetPayload('Aldenmar', 60, NOW).targets)
      .toEqual([{ name: 'a gnoll', kind: 'npc', spawn_id: 4425, hp_pct: 80, seen_secs: 0 }]);
  });

  it('updates the same spawn id in place (HP changes) instead of adding a row', () => {
    const s = freshStore();
    s._noteSelfTarget('Aldenmar', st('a gnoll', 80, 4425), NOW);
    s._noteSelfTarget('Aldenmar', st('a gnoll', 55, 4425), NOW + 3000);
    const t = s.selfTargetPayload('Aldenmar', 60, NOW + 3000).targets;
    expect(t).toHaveLength(1);
    expect(t[0].hp_pct).toBe(55);
  });

  it('keeps two same-name mobs apart when their spawn ids differ', () => {
    const s = freshStore();
    s._noteSelfTarget('Aldenmar', st('a gnoll', 80, 11), NOW);
    s._noteSelfTarget('Aldenmar', st('a gnoll', 80, 12), NOW + 1000);
    expect(s.selfTargetPayload('Aldenmar', 60, NOW + 1000).targets.map(t => t.spawn_id)).toEqual([12, 11]);
  });

  it('ignores spawn id 0 as an id: it means NO target', () => {
    const s = freshStore();
    s._noteSelfTarget('Aldenmar', st('a gnoll', 80, 0), NOW);
    const t = s.selfTargetPayload('Aldenmar', 60, NOW).targets;
    expect(t).toHaveLength(1);
    expect(t[0].spawn_id).toBeNull();
    expect([...s._selfTargets.get('aldenmar').keys()]).toEqual(['n:a gnoll']);
  });

  it('records nothing when there is no target name', () => {
    const s = freshStore();
    s._noteSelfTarget('Aldenmar', st('', 80, 5), NOW);
    s._noteSelfTarget('Aldenmar', { target_id: 7 }, NOW);
    s._noteSelfTarget('Aldenmar', null, NOW);
    expect(s.selfTargetPayload('Aldenmar', 60, NOW).targets).toEqual([]);
  });

  it('keys a mob with no id by name, so the same name is one row', () => {
    const s = freshStore();
    s._noteSelfTarget('Aldenmar', st('Lord Nagafen', 100, null), NOW);
    s._noteSelfTarget('Aldenmar', st('lord nagafen', 90, undefined), NOW + 2000);
    const t = s.selfTargetPayload('Aldenmar', 60, NOW + 2000).targets;
    expect(t).toHaveLength(1);
    expect(t[0].spawn_id).toBeNull();
    expect(t[0].hp_pct).toBe(90);
  });

  it('reads HP from the slot-6 gauge when the state carries no target_hp_pct', () => {
    const s = freshStore();
    s._noteSelfTarget('Aldenmar', { target_name: 'a gnoll', target_id: 9, gauges: [{ slot: 6, hp_pct: 42, text: 'a gnoll' }] }, NOW);
    expect(s.selfTargetPayload('Aldenmar', 60, NOW).targets[0].hp_pct).toBe(42);
  });

  it('sorts most-recent first, and an old mob re-targeted jumps back to the top', () => {
    const s = freshStore();
    s._noteSelfTarget('Aldenmar', st('first', 100, 1), NOW);
    s._noteSelfTarget('Aldenmar', st('second', 100, 2), NOW + 5000);
    s._noteSelfTarget('Aldenmar', st('third', 100, 3), NOW + 9000);
    expect(s.selfTargetPayload('Aldenmar', 60, NOW + 9000).targets.map(t => t.name)).toEqual(['third', 'second', 'first']);
    s._noteSelfTarget('Aldenmar', st('first', 70, 1), NOW + 12000);
    expect(s.selfTargetPayload('Aldenmar', 60, NOW + 12000).targets.map(t => t.name)).toEqual(['first', 'third', 'second']);
  });

  it('reports how long ago each was seen, in seconds', () => {
    const s = freshStore();
    s._noteSelfTarget('Aldenmar', st('first', 100, 1), NOW);
    s._noteSelfTarget('Aldenmar', st('second', 100, 2), NOW + 20000);
    expect(s.selfTargetPayload('Aldenmar', 60, NOW + 30000).targets.map(t => t.seen_secs)).toEqual([10, 30]);
  });

  it('answers only rows inside the keep window', () => {
    const s = freshStore();
    s._noteSelfTarget('Aldenmar', st('old', 100, 1), NOW);
    s._noteSelfTarget('Aldenmar', st('new', 100, 2), NOW + 50000);
    expect(s.selfTargetPayload('Aldenmar', 30, NOW + 50000).targets.map(t => t.name)).toEqual(['new']);
    expect(s.selfTargetPayload('Aldenmar', 60, NOW + 50000).targets.map(t => t.name)).toEqual(['new', 'old']);
  });

  it('defaults a missing or junk keep to 60s and caps it at 5 minutes', () => {
    const s = freshStore();
    expect(s.selfTargetPayload('Aldenmar', null, NOW).keep_secs).toBe(60);
    expect(s.selfTargetPayload('Aldenmar', 'abc', NOW).keep_secs).toBe(60);
    expect(s.selfTargetPayload('Aldenmar', '0', NOW).keep_secs).toBe(60);
    expect(s.selfTargetPayload('Aldenmar', '9999', NOW).keep_secs).toBe(300);
  });

  it('prunes entries older than the retention ceiling when the next target lands', () => {
    const s = freshStore();
    s._noteSelfTarget('Aldenmar', st('ancient', 100, 1), NOW);
    s._noteSelfTarget('Aldenmar', st('fresh', 100, 2), NOW + 301_000);
    expect([...s._selfTargets.get('aldenmar').keys()]).toEqual(['id:2']);
  });

  it('caps the list so a long session cannot grow it without bound', () => {
    const s = freshStore();
    for (let i = 1; i <= 250; i++) s._noteSelfTarget('Aldenmar', st('mob ' + i, 100, i), NOW + i);
    const m = s._selfTargets.get('aldenmar');
    expect(m.size).toBe(200);
    expect(m.has('id:250')).toBe(true);
    expect(m.has('id:1')).toBe(false);
  });

  it('keeps each character its own list, and falls back to the freshest list for an unknown one', () => {
    const s = freshStore();
    s._noteSelfTarget('Aldenmar', st('mine', 100, 1), NOW);
    s._noteSelfTarget('Brackwyn', st('theirs', 100, 2), NOW + 4000);
    expect(s.selfTargetPayload('aldenmar', 60, NOW + 4000).targets.map(t => t.name)).toEqual(['mine']);
    expect(s.selfTargetPayload('Corvale', 60, NOW + 4000).targets.map(t => t.name)).toEqual(['theirs']);
  });
});

// ── the route ───────────────────────────────────────────────────────────────
describe('the local route', () => {
  const clean = stripJs(agentSrc);
  const route = clean.slice(clean.indexOf("req.url.indexOf('/api/extended-target') === 0"));
  const self = route.slice(0, route.indexOf('fetchExtendedTarget(selfCharacter);'));

  it('answers scope=self from the store, with the keep param, before any bot fetch', () => {
    expect(self).toContain('/[?&]scope=self(?:&|$)/.test(req.url)');
    expect(self).toContain('/[?&]keep=(\\d+)/.exec(req.url)');
    expect(self).toContain('selfTargetPayload(selfCharacter, km ? km[1] : null, Date.now())');
    expect(self).toMatch(/return res\.end\(/);
  });

  it('leaves the raid and group path as it was', () => {
    expect(route).toContain("/[?&]scope=group(?:&|$)/.test(req.url) ? 'group' : 'raid'");
  });

  it('is fed from every Zeal state report', () => {
    const feed = clean.slice(clean.indexOf('_zealState[character] = { ...st, updatedAt: Date.now() };'));
    expect(feed.slice(0, 4000)).toContain('_noteSelfTarget(character, st, Date.now());');
  });
});

// ── the overlay ─────────────────────────────────────────────────────────────
const html = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'extarget.html'), 'utf8');
const clean = stripJs(html);
const { selfAgo, selfRowHtml } = evalBlock(
  sliceBlock(html, 'function esc(s){', '\n') + '\n'
    + sliceBlock(html, 'function hpTier(h){', '\n') + '\n'
    + sliceBlock(html, 'function selfAgo(s){', '\n') + '\n'
    + sliceBlock(html, 'function selfRowHtml(t, keep){', "\n      +  '</div>';\n  }"),
  ['selfAgo', 'selfRowHtml'],
);

describe('the overlay: Self tab and keep selector', () => {
  const head = clean.slice(clean.indexOf('<div class="head'), clean.indexOf('<div id="rows"'));
  it('adds a Self button beside Raid and Group', () => {
    expect(head).toContain('<button type="button" id="scopeSelf" data-scope="self">Self</button>');
    expect(head).toContain('<button type="button" id="scopeRaid" data-scope="raid">Raid</button>');
    expect(head).toContain('<button type="button" id="scopeGroup" data-scope="group">Group</button>');
  });
  it('has a keep-for selector with 30s / 60s / 2m / 5m, shown only on Self', () => {
    expect(head).toMatch(/<select id="keepSel"[^>]*><option value="30">30s<\/option><option value="60">60s<\/option><option value="120">2m<\/option><option value="300">5m<\/option><\/select>/);
    expect(head).toContain('id="keepBar"');
    expect(clean).toContain("kb.style.display = _scope === 'self' ? 'flex' : 'none';");
  });
  it('defaults to 60s and remembers the choice in storage that may throw', () => {
    expect(clean).toContain('var _keep = 60;');
    expect(clean).toMatch(/try \{ var _k0 = parseInt\(localStorage\.getItem\('wp_ext_self_keep'\), 10\);[^}]*\} catch \(e\) \{\}/);
    expect(clean).toMatch(/try \{ localStorage\.setItem\('wp_ext_self_keep', String\(_keep\)\); \} catch \(e\) \{\}/);
  });
  it('restores the Self scope from storage, inside try/catch, and the Raid default is unchanged', () => {
    expect(clean).toContain("var _scope = 'raid';");
    expect(clean).toMatch(/try \{ if \(localStorage\.getItem\('wp_ext_scope'\) === 'self'\) _scope = 'self'; \} catch \(e\) \{\}/);
  });
  it('asks the agent for the keep window on Self, and re-polls when it changes', () => {
    expect(clean).toContain("'/api/extended-target?scope='+asked+(asked === 'self' ? '&keep='+_keep : '')");
    const change = clean.slice(clean.indexOf("keepSel.addEventListener('change'"));
    expect(change.slice(0, change.indexOf('});'))).toContain('tick();');
  });
  it('is a real <select>, which the preload arms for the hover handshake', () => {
    expect(clean).toContain('<select id="keepSel"');
  });
  it('routes a Self payload to its own renderer', () => {
    expect(clean).toContain("if (payload && payload.scope === 'self') return renderSelf(payload);");
  });
});

describe('the overlay: a Self row', () => {
  const row = { name: 'a gnoll', spawn_id: 4425, hp_pct: 63.4, seen_secs: 0 };
  it('shows the name, #spawn_id, the HP % and the bar', () => {
    const h = selfRowHtml(row, 60);
    expect(h).toContain('<span class="nm">a gnoll</span>');
    expect(h).toContain('#4425</span>');
    expect(h).toContain('>63%</span>');
    expect(h).toContain('style="width:63.4%"');
  });
  it('says "no id" when Zeal sent none', () => {
    const h = selfRowHtml({ ...row, spawn_id: null }, 60);
    expect(h).toContain('<span class="noid"');
    expect(h).toContain('>no id</span>');
    expect(h).not.toContain('#');
  });
  it('shows "now" for a fresh row and Ns ago for an older one, rounded to 5s', () => {
    expect(selfAgo(0)).toBe('now');
    expect(selfAgo(4)).toBe('now');
    expect(selfAgo(5)).toBe('5s ago');
    expect(selfAgo(37)).toBe('35s ago');
    expect(selfRowHtml(row, 60)).toContain('<span class="ago">now</span>');
    expect(selfRowHtml({ ...row, seen_secs: 37 }, 60)).toContain('<span class="ago">35s ago</span>');
  });
  it('fades older rows in steps, by age against the keep window', () => {
    const cls = (secs, keep) => /class="row selfrow([^"]*)"/.exec(selfRowHtml({ ...row, seen_secs: secs }, keep))[1];
    expect(cls(0, 60)).toBe(' now');
    expect(cls(10, 60)).toBe('');
    expect(cls(20, 60)).toBe(' fade-1');
    expect(cls(30, 60)).toBe(' fade-2');
    expect(cls(45, 60)).toBe(' fade-3');
    expect(cls(45, 120)).toBe(' fade-1');   // the same age fades less in a longer window
  });
  it('escapes the mob name', () => {
    expect(selfRowHtml({ ...row, name: '<b>x</b>' }, 60)).not.toContain('<b>x');
  });
  it('is byte-stable for the same input', () => {
    expect(selfRowHtml({ ...row, seen_secs: 12 }, 60)).toBe(selfRowHtml({ ...row, seen_secs: 14 }, 60));
  });
  it('defines the four fade steps in CSS', () => {
    expect(clean).toMatch(/\.row\.fade-1\{opacity:\.8\} \.row\.fade-2\{opacity:\.6\} \.row\.fade-3\{opacity:\.45\}/);
  });
});

describe('the header comment no longer says the pipe has no spawn id', () => {
  it('names Zeal 1.4.6 instead', () => {
    expect(html).toContain('Zeal 1.4.6+');
    expect(html).not.toContain('no spawn id, so same-name');
  });
});
