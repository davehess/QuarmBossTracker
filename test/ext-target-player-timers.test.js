// test/ext-target-player-timers.test.js — a targeted player's timers ride their Extended Target row.
//
// The guild lead, 2026-10-19, picked A for DECISIONS §126 ("say if this should also show on Extended
// Target rows"): the chips Target Info shows for a targeted player (disc, Mend, Lay on Hands, Harm
// Touch, Area Taunt: ✓ ready, time left, ~ estimate) now appear on that player's row, from the same
// source (_targetPlayerTimers), on the Raid, Group and Self tabs. NPC rows are untouched. One compact
// chip line, overflow as "+N".
//
// Names are invented. Run: npx vitest run test/ext-target-player-timers.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readSource, sliceBlock, evalBlock, stripJs, AGENT_INDEX } from './_source-slice.js';

// ── agent: the real _targetPlayerTimers + the new attach, with the rest stubbed ────────────────
const src = readSource(AGENT_INDEX);
const DISCS = sliceBlock(src, 'const _ME_DISCS = new Map([', ']);');
const REUSE = sliceBlock(src, 'function _meDiscReuseSecs(', '\n}');
const BLOCK = sliceBlock(src, "// ── A targeted player's known timers, on Target Info", '  return out.length ? out : null;\n}');
const ATTACH = sliceBlock(src, 'const EXT_TIMERS_FETCH_MAX = 8;', '  return any ? { ...payload, targets } : payload;\n}');

function load() {
  return evalBlock(`
    const whoData = new Map();
    const _raidClassByName = new Map();
    const _meDiscs = new Map();
    const _discReadyAt = new Map();
    const _meSkillCds = new Map();
    const _mtLiveStateByName = new Map();
    const _zeal = new Set();
    function _meZealFor(cl) { return _zeal.has(cl) ? {} : null; }
    function _meTimersLoad() {}
    function _meTimersSave() {}
    const _ME_SKILL_LINES = [];
    function _meStartSkill() {}
    function normalizeClass(c) { return c || null; }
    ${DISCS}
    ${REUSE}
    ${BLOCK}
    ${ATTACH}
  `, ['_mtLiveStateByName', '_zeal', '_meObsDiscs', '_attachExtRowTimers', '_targetPlayerTimers', 'EXT_TIMERS_FETCH_MAX']);
}

const T0 = Date.parse('2026-10-19T00:00:00Z');
const mimic = (...cds) => ({ at: T0, state: { cooldowns: cds } });
const cd = (key, label, secs, est) => ({ key, label, ready_at: new Date(T0 + secs * 1000).toISOString(), total_ms: secs * 1000, est: !!est });
const row = (name, kind, extra) => ({ name, kind, hp_pct: 80, raider_count: 1, ...extra });
const spy = () => { const calls = []; const f = (n) => { calls.push(n); }; f.calls = calls; return f; };

describe('agent: player rows on Raid / Group get the same timers Target Info shows', () => {
  it('a player row carries their Mimic\'s timers, in Target Info\'s shape', () => {
    const A = load();
    A._mtLiveStateByName.set('brackwyn', mimic(cd('aa:area_taunt', 'Area Taunt', 300), cd('disc', 'Furious', 0)));
    const out = A._attachExtRowTimers({ targets: [row('Brackwyn', 'player')] }, T0, spy());
    const want = A._targetPlayerTimers({ target_name: 'Brackwyn' }, null, T0);
    expect(want).toHaveLength(2);
    expect(out.targets[0].timers.map(c => [c.key, c.label, c.ms_left, c.source, c.est]))
      .toEqual(want.map(c => [c.key, c.label, c.ms_left, c.source, c.est]));
    expect(out.targets[0].timers[0]).toMatchObject({ label: 'Area Taunt', ms_left: 300_000, source: 'mimic', est: false });
    expect(out.targets[0].timers[1].ms_left).toBe(0);   // ready: the overlay draws a check
  });

  it('a disc you saw them start rides the row, estimated', () => {
    const A = load();
    A._meObsDiscs.set('corvale', { name: 'Aggressive', at: T0 - 60_000, total_ms: 900_000, level_known: false });
    const out = A._attachExtRowTimers({ targets: [row('Corvale', 'player')] }, T0, spy());
    expect(out.targets[0].timers).toEqual([
      { key: 'disc', label: 'Aggressive', ms_left: 840_000, est: true, source: 'seen', level_known: false },
    ]);
  });

  it('NPC and pet rows are untouched, and cost no lookup', () => {
    const A = load();
    A._mtLiveStateByName.set('rethlan', mimic(cd('disc', 'Furious', 100)));
    const f = spy();
    const p = { targets: [row('Rethlan', 'npc'), row('Rethlan', 'pet', { owner: 'Zarrin' }), row('a gnoll', 'npc')] };
    const out = A._attachExtRowTimers(p, T0, f);
    expect(out).toBe(p);          // nothing to add: the very same payload comes back
    expect(f.calls).toEqual([]);
  });

  it('a player nobody knows anything about is left as it was, but asked for', () => {
    const A = load();
    const f = spy();
    const p = { targets: [row('Nyssara', 'player')] };
    const out = A._attachExtRowTimers(p, T0, f);
    expect(out).toBe(p);
    expect(f.calls).toEqual(['Nyssara']);   // so the NEXT poll has their Mimic's answer
  });

  it('your own characters are read locally: no lookup', () => {
    const A = load();
    A._zeal.add('aldenmar');
    const f = spy();
    A._attachExtRowTimers({ targets: [row('Aldenmar', 'player')] }, T0, f);
    expect(f.calls).toEqual([]);
  });

  it('a name with a space is not a player: skipped without a lookup', () => {
    const A = load();
    const f = spy();
    const p = { targets: [row('Lord Nagafen', 'player')] };
    expect(A._attachExtRowTimers(p, T0, f)).toBe(p);
    expect(f.calls).toEqual([]);
  });

  it('asks for at most EXT_TIMERS_FETCH_MAX players per poll', () => {
    const A = load();
    const f = spy();
    const names = Array.from({ length: 20 }, (_, i) => 'Raider' + String.fromCharCode(97 + i));
    A._attachExtRowTimers({ targets: names.map(n => row(n, 'player')) }, T0, f);
    expect(A.EXT_TIMERS_FETCH_MAX).toBe(8);
    expect(f.calls).toHaveLength(8);
  });

  it('a throwing lookup never loses the row', () => {
    const A = load();
    A._mtLiveStateByName.set('zarrin', mimic(cd('disc', 'Furious', 50)));
    const out = A._attachExtRowTimers({ targets: [row('Zarrin', 'player')] }, T0, () => { throw new Error('offline'); });
    expect(out.targets[0].timers).toHaveLength(1);
  });

  it('copies: the cached payload is not mutated', () => {
    const A = load();
    A._mtLiveStateByName.set('brackwyn', mimic(cd('disc', 'Furious', 50)));
    const p = { scope: 'raid', targets: [row('Brackwyn', 'player'), row('a gnoll', 'npc')] };
    const out = A._attachExtRowTimers(p, T0, spy());
    expect(out).not.toBe(p);
    expect(p.targets[0].timers).toBeUndefined();
    expect(out.targets[1]).toBe(p.targets[1]);
    expect(out.scope).toBe('raid');
  });

  it('tolerates a payload with no targets', () => {
    const A = load();
    expect(A._attachExtRowTimers(null, T0, spy())).toBeNull();
    const p = { targets: [], loading: true };
    expect(A._attachExtRowTimers(p, T0, spy())).toBe(p);
    expect(A._attachExtRowTimers({ local_only: true }, T0, spy())).toEqual({ local_only: true });
  });
});

describe('agent: the Self tab', () => {
  it('rows are all kind npc, so a single-word name is tried and the timer sources decide', () => {
    const A = load();
    A._mtLiveStateByName.set('brackwyn', mimic(cd('aa:mend', 'Mend', 120)));
    const f = spy();
    const p = { scope: 'self', targets: [
      { name: 'a gnoll', kind: 'npc', spawn_id: 5, hp_pct: 90, seen_secs: 1 },
      { name: 'Brackwyn', kind: 'npc', spawn_id: 7, hp_pct: 100, seen_secs: 2 },
      { name: 'Gorenaire', kind: 'npc', spawn_id: 9, hp_pct: 100, seen_secs: 3 },
    ] };
    const out = A._attachExtRowTimers(p, T0, f);
    expect(out.targets[0].timers).toBeUndefined();
    expect(out.targets[1].timers[0]).toMatchObject({ label: 'Mend', ms_left: 120_000, source: 'mimic' });
    expect(out.targets[2].timers).toBeUndefined();
    expect(f.calls).toEqual(['Brackwyn', 'Gorenaire']);   // the multi-word mob costs nothing
    expect(out.scope).toBe('self');
  });

  it('outside Self, a kind-npc single-word row is NOT tried (NPC rows unchanged)', () => {
    const A = load();
    A._mtLiveStateByName.set('brackwyn', mimic(cd('aa:mend', 'Mend', 120)));
    const p = { scope: 'raid', targets: [row('Brackwyn', 'npc')] };
    expect(A._attachExtRowTimers(p, T0, spy())).toBe(p);
  });
});

describe('agent: the proxy asks for it, on both paths, only when the overlay says so', () => {
  const code = stripJs(src);
  const handler = sliceBlock(code, "if (req.url && req.url.indexOf('/api/extended-target') === 0) {", 'return res.end(JSON.stringify(outPayload));');
  it('Raid / Group: timers=1 gates the attach, after the scoping', () => {
    expect(handler).toMatch(/\[\?&\]timers=1\(\?:&\|\$\)\/\.test\(req\.url\)\) outPayload = _attachExtRowTimers\(outPayload, Date\.now\(\), fetchCharacterLiveState\)/);
    expect(handler.indexOf('_attachExtRowTimers(outPayload')).toBeGreaterThan(handler.indexOf('_scopeExtToGroup('));
  });
  it('Self: the same gate on the local list', () => {
    expect(handler).toMatch(/\[\?&\]timers=1\(\?:&\|\$\)\/\.test\(req\.url\)\) selfPayload = _attachExtRowTimers\(selfPayload, Date\.now\(\), fetchCharacterLiveState\)/);
    expect(handler).toContain('selfTargetPayload(selfCharacter, km ? km[1] : null, Date.now())');
  });
});

// ── overlay ─────────────────────────────────────────────────────────────────────────────────
const html = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'extarget.html'), 'utf8');
const TL = evalBlock(
  sliceBlock(html, 'function esc(s){', '\n') + '\n'
    + sliceBlock(html, 'function hpTier(h){', '\n') + '\n'
    + sliceBlock(html, 'var EXT_CD_SHOW = 3;', "\n    return '<div class=\"cds\" data-wp-sect=\"timers\">' + h + '</div>';\n  }") + '\n'
    + `function rowKey(t){ return 'row:' + t.name; }
       function ccBadges(){ return ''; } function ztagHtml(){ return ''; } function debuffBlock(){ return ''; }
       function mobxLine(){ return ''; } function _unused(){}\n`
    + sliceBlock(html, 'function rowHtml(t, suppressDeb){', "      +    deb\n      +  '</div>';\n  }"),
  ['timersLine', 'rowHtml', 'fmtCd'],
);
const chip = (label, ms, extra) => ({ key: 'k', label, ms_left: ms, source: 'mimic', est: false, ...extra });

describe('overlay: the chip line', () => {
  it('ready is a check, a running timer is M:SS, an estimate has ~, and the source is the tooltip', () => {
    const h = TL.timersLine([chip('Furious', 0), chip('Mend', 125_000), chip('Aggressive', 61_000, { est: true, source: 'seen', level_known: false })]);
    expect(h).toContain('Furious ✓');
    expect(h).toContain('class="cd ok"');
    expect(h).toContain('Mend 2:05');
    expect(h).toContain('Aggressive ~1:01');
    expect(h).toContain('from their Mimic');
    expect(h).toContain('their level is unknown, so this is the longest it can take');
    expect(h.match(/<div class="cds"/g)).toHaveLength(1);   // one line
  });
  it('hours read h:mm like Target Info', () => {
    expect(TL.fmtCd(3723)).toBe('1h02');
  });
  it('shows three chips and folds the rest into +N, listing them in its tooltip', () => {
    const h = TL.timersLine([chip('A1', 10_000), chip('B2', 20_000), chip('C3', 30_000), chip('D4', 40_000), chip('E5', 0)]);
    expect((h.match(/class="cd( ok)?"/g) || [])).toHaveLength(3);
    expect(h).toMatch(/class="cd more" title="D4 0:40, E5 ✓">\+2</);
    expect(h).not.toContain('>D4 0:40<');
  });
  it('no timers, nothing: the row is byte-identical to before', () => {
    expect(TL.timersLine(undefined)).toBe('');
    expect(TL.timersLine([])).toBe('');
    expect(TL.timersLine([{ ms_left: 5 }])).toBe('');   // no label
  });
  it('escapes a label', () => {
    expect(TL.timersLine([chip('<b>x</b>', 0)])).not.toContain('<b>');
  });
});

describe('overlay: the row', () => {
  it('a player row with timers carries the chip line; the same row without them does not', () => {
    const base = { name: 'Brackwyn', kind: 'player', hp_pct: 70, raider_count: 2, raiders: ['Aldenmar'] };
    const without = TL.rowHtml(base, false);
    const withT = TL.rowHtml({ ...base, timers: [chip('Furious', 0)] }, false);
    expect(without).not.toContain('class="cds"');
    expect(withT).toContain('Furious ✓');
    expect(withT.replace(/<div class="cds".*?<\/div>/, '')).toBe(without);   // nothing else on the row changed
  });
  it('the chip line sits after who-is-targeting and before the debuff block', () => {
    const i = html.indexOf('+    whoLine\n      +    timersLine(t.timers)\n      +    deb');
    expect(i).toBeGreaterThan(-1);
  });
  it('the Self row carries it too', () => {
    const c = stripJs(html);
    const self = sliceBlock(c, 'function selfRowHtml(t, keep){', 'function renderSelf(');
    expect(self).toContain('timersLine(t.timers)');
  });
  it('mini rows stay one line: no chip line', () => {
    const c = stripJs(html);
    const mini = sliceBlock(c, 'function miniRowHtml(t){', "+  '</div>';\n  }");
    expect(mini).not.toContain('timersLine');
  });
  it('the chips are one non-wrapping line', () => {
    expect(stripJs(html)).toMatch(/\.row \.cds\{[^}]*flex-wrap:nowrap[^}]*overflow:hidden/);
  });
});

describe('overlay: the poll asks only when it will show something', () => {
  const c = stripJs(html);
  const tick = sliceBlock(c, 'async function tick(){', 'render(p);');
  it('sends timers=1 on Self, and on Raid / Group only while the players toggle is on', () => {
    expect(tick).toContain("((asked === 'self' || _showPlayers) ? '&timers=1' : '')");
  });
});
