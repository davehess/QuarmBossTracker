// test/enrage-callouts.test.js — "Enrage soon" for bosses, a short "<mob> enraging" at 9% for everything else,
// and three ways to mute it.
//
// The guild lead, 2026-10-19: "enrage soon callouts are too often, maybe just restrict them to bosses. enrage
// needs to pop off at 9% on other mobs. should be muteable per mob/this session/permanently."
//
// The REAL agent is driven (require): the tick reads a watched character's Zeal target, the catalog row decides
// boss / can-enrage, _pushOverlay + _fireForWeb carry the fire out. A permanent mute is a rule in
// trigger_rules.json ("What you hear"'s file), so "survives a restart" is proven by clearing the in-memory
// rules and loading the file back. The overlay (triggers.html) and the dashboard row (dashboard.html) are run
// by slicing their shipped functions with the DOM stubbed.
//
// Run: npx vitest run test/enrage-callouts.test.js

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';

let agent;
beforeAll(() => { agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js'); });

const ME = 'Fenrisk';
const ZONE = 12;
const GNOLL = 'a gnoll warlord';

function clearRules() { for (const k of Object.keys(agent._triggerRules)) delete agent._triggerRules[k]; }
function resetMutes() {
  agent._enrageMuteSession.all = false;
  agent._enrageMuteSession.mobs.clear();
}
// Put a mob in the catalog cache: can it enrage, is it a raid target.
function catalog(name, { enrage = true, boss = false } = {}) {
  agent._mobInfoByNameForTest().set(agent._mobInfoCacheKey(name, ZONE), {
    at: Date.now(), mob: { name, specials: enrage ? ['Enrage'] : [], raid_target: boss },
  });
}
// The character's target, as Zeal reports it.
function target(name, hp, id = 7) {
  agent._setZealStateForTest(ME, { target_name: name, target_hp_pct: hp, target_id: id, zone: ZONE, updatedAt: Date.now() });
}
const tick = (name, hp, id) => { target(name, hp, id); agent._tickEnrageWarn(Date.now()); };
const enrageFires = () => agent._activeOverlays.filter(o => o.scope === 'enrage');

beforeEach(() => {
  agent._setWatchedLogsForTest([{ character: ME, logPath: 'eqlog_Fenrisk_pq.proj.txt' }]);
  agent._mobInfoByNameForTest().clear();
  agent._enrageWarned.clear();
  agent._activeOverlays.length = 0;
  clearRules(); resetMutes();
});
afterEach(() => {
  agent._setZealStateForTest(ME, null);
  agent._mobInfoByNameForTest().clear();
  clearRules(); resetMutes();
  vi.restoreAllMocks();
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('who is warned, and where', () => {
  it('a boss: "Enrage soon" as it crosses 12%, once', () => {
    catalog(GNOLL, { boss: true });
    tick(GNOLL, 40); tick(GNOLL, 13);
    expect(enrageFires()).toHaveLength(0);
    tick(GNOLL, 12); tick(GNOLL, 9); tick(GNOLL, 4);
    const f = enrageFires();
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ tts: 'Enrage soon', trigger: 'Enrage soon', rule_key: 'builtin:enrage_soon', color: 'red' });
    expect(f[0].text).toContain('enrage soon');
  });
  it('a boss from the curated list counts, with no catalog flag', () => {
    catalog('Trakanon', { boss: false });
    tick('Trakanon', 12);
    expect(enrageFires()).toHaveLength(1);
    expect(enrageFires()[0].tts).toBe('Enrage soon');
  });
  it('any other mob: nothing at 12% or 10%, one short "<mob> enraging" at 9%, once', () => {
    catalog(GNOLL, { boss: false });
    tick(GNOLL, 12); tick(GNOLL, 10);
    expect(enrageFires()).toHaveLength(0);
    tick(GNOLL, 9); tick(GNOLL, 7); tick(GNOLL, 3);
    const f = enrageFires();
    expect(f).toHaveLength(1);
    expect(f[0].tts).toBe('a gnoll warlord enraging');
    expect(f[0].text).toContain('enraging');
    expect(f[0].tts).not.toMatch(/enrage soon/i);
  });
  it('a mob that cannot enrage says nothing, boss or not', () => {
    catalog(GNOLL, { enrage: false, boss: false });
    tick(GNOLL, 5);
    expect(enrageFires()).toHaveLength(0);
  });
  it('a fresh mob of the same name re-arms it', () => {
    catalog(GNOLL, { boss: false });
    tick(GNOLL, 9); tick(GNOLL, 100); tick(GNOLL, 9);
    expect(enrageFires()).toHaveLength(2);
  });
  it('the fire carries the mob it is about, for the 🔇 (_fireForWeb → enrage_mob)', () => {
    catalog(GNOLL, { boss: false });
    tick(GNOLL, 9);
    expect(agent._fireForWeb(enrageFires()[0]).enrage_mob).toBe(GNOLL);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('muting — this mob, all, and for good', () => {
  const mute = (scope, mob, action = 'mute') => agent._setEnrageMute({ action, scope, mob });

  it('this mob, this session: that mob stops (text and speech), another mob still warns', () => {
    catalog(GNOLL); catalog('a gnoll shaman');
    expect(mute('mob', 'A Gnoll Warlord  ')).toMatchObject({ ok: true, session: [GNOLL], all: false, always: [] });
    tick(GNOLL, 5);
    expect(agent._activeOverlays).toHaveLength(0);          // not pushed at all: no flash, no speech
    tick('a gnoll shaman', 5, 8);
    expect(enrageFires()).toHaveLength(1);
  });
  it('all enrage callouts, this session', () => {
    catalog(GNOLL, { boss: true }); catalog('a gnoll shaman');
    expect(mute('all')).toMatchObject({ ok: true, all: true });
    tick(GNOLL, 5); tick('a gnoll shaman', 5, 8);
    expect(agent._activeOverlays).toHaveLength(0);
  });
  it('a session mute is NOT written to disk', () => {
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    mute('mob', GNOLL); mute('all');
    expect(write).not.toHaveBeenCalled();
  });
  it('unmute (mob, all): the callout comes back', () => {
    catalog(GNOLL);
    mute('mob', GNOLL); mute('all');
    mute('mob', GNOLL, 'unmute'); mute('all', null, 'unmute');
    expect(agent._enrageMutesView()).toEqual({ all: false, session: [], always: [] });
    tick(GNOLL, 5);
    expect(enrageFires()).toHaveLength(1);
  });
  it('an unmuted mob that was skipped while muted warns when it is next seen under the line', () => {
    catalog(GNOLL);
    mute('mob', GNOLL);
    tick(GNOLL, 8);
    expect(enrageFires()).toHaveLength(0);
    mute('mob', GNOLL, 'unmute');
    tick(GNOLL, 8);
    expect(enrageFires()).toHaveLength(1);
  });

  describe('for good — a rule in trigger_rules.json', () => {
    let writes, renames;
    beforeEach(() => {
      writes = []; renames = [];
      vi.spyOn(fs, 'writeFileSync').mockImplementation((p, body) => { writes.push({ p: String(p), body: String(body) }); });
      vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => { renames.push(String(to)); });
    });
    const lastFile = () => JSON.parse(writes[writes.length - 1].body);

    it('writes builtin:enrage_soon:<mob> = off for everyone, atomically, into trigger_rules.json', () => {
      expect(mute('always', GNOLL)).toMatchObject({ ok: true, always: [GNOLL], session: [] });
      expect(path.basename(writes[0].p)).toBe('trigger_rules.json.tmp');
      expect(path.basename(renames[0])).toBe('trigger_rules.json');
      expect(lastFile()).toEqual({ version: 1, rules: { ['builtin:enrage_soon:' + GNOLL]: { '*': 'off' } } });
    });
    it('mutes that mob, and only that one', () => {
      catalog(GNOLL); catalog('a gnoll shaman');
      mute('always', GNOLL);
      tick(GNOLL, 5); tick('a gnoll shaman', 5, 8);
      expect(enrageFires().map(f => f.enrage_mob)).toEqual(['a gnoll shaman']);
    });
    it('survives a restart: the in-memory rules are gone, the file loads them back', () => {
      catalog(GNOLL);
      mute('always', GNOLL);
      const saved = writes[writes.length - 1].body;
      clearRules(); resetMutes();                                     // a fresh process
      expect(agent._enrageMutesView().always).toEqual([]);
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(saved);
      agent.loadTriggerRules();
      expect(agent._enrageMutesView().always).toEqual([GNOLL]);
      tick(GNOLL, 5);
      expect(agent._activeOverlays).toHaveLength(0);
    });
    it('unmute removes the rule from the file and the callout comes back', () => {
      catalog(GNOLL);
      mute('always', GNOLL);
      expect(mute('always', GNOLL, 'unmute')).toMatchObject({ ok: true, always: [] });
      expect(lastFile()).toEqual({ version: 1, rules: {} });
      tick(GNOLL, 5);
      expect(enrageFires()).toHaveLength(1);
    });
    it('a muted mob does not appear as a row in the "What you hear" built-in group', () => {
      mute('always', GNOLL);
      const builtin = agent._computeRuleGroups().find(g => g.id === 'builtin');
      expect(builtin.members.some(m => m.key.startsWith('builtin:enrage_soon:'))).toBe(false);
      expect(Object.keys(agent._builtinRuleModes()).filter(k => /enrage/.test(k))).toEqual([]);   // (Charm aging's muted default is not what this is about)
    });
  });

  it('refuses a bad scope or a missing mob and changes nothing', () => {
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    expect(mute('forever', GNOLL).ok).toBe(false);
    expect(mute('mob', '').ok).toBe(false);
    expect(mute('always', '   ').ok).toBe(false);
    expect(agent._enrageMutesView()).toEqual({ all: false, session: [], always: [] });
    expect(write).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('triggers.html: the 🔇 on an enrage callout opens three choices', () => {
  const html = readSource(path.join(ROOT, 'apps/mimic/triggers.html'));
  const block = sliceBlock(html, '  let _muteFire = null;', "pickEnrageMute(b.getAttribute('data-scope')); });\n  });");

  function harness() {
    const mk = (set) => ({ add: c => set.add(c), remove: c => set.delete(c), toggle: (c, on) => { const v = on === undefined ? !set.has(c) : on; if (v) set.add(c); else set.delete(c); }, contains: c => set.has(c) });
    const cls = new Set(), btnCls = new Set(), listeners = {}, hover = [], posts = [];
    const btn = { textContent: '🔇 Mute', classList: mk(btnCls), addEventListener: (ev, fn) => { listeners[ev] = fn; } };
    const opts = ['mob', 'all', 'always'].map(scope => {
      const l = {};
      return { scope, l, getAttribute: () => scope, addEventListener: (ev, fn) => { l[ev] = fn; } };
    });
    const ctx = { cls, btn, posts, hover, opts, fbCls: mk(cls) };
    const prelude = `
      const btn = ctx.btn; const posts = ctx.posts;
      const document = { getElementById: () => btn };
      const window = { mimic: { overlayHoverInteractive: (on) => ctx.hover.push(on) } };
      const fbWrap = { classList: ctx.fbCls, querySelectorAll: () => ctx.opts };
      function showFeedback() {}
      let _votesOn = true; const PORT = 7779;
      function fetch(url, opts){ posts.push({ url, body: JSON.parse(opts.body) }); return Promise.resolve({ ok: true }); }
    `;
    const api = new Function('ctx', [prelude, block, 'return { offerMute, muteClick };'].join('\n'))(ctx);
    return { ...api, cls, btn, btnCls, posts, listeners, hover, opts };
  }
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const fire = { text: '⚠ a gnoll warlord at 9% — enraging', tts: 'a gnoll warlord enraging', trigger: 'Enrage soon', rule_key: 'builtin:enrage_soon', enrage_mob: GNOLL, mute: false };
  const flush = () => vi.advanceTimersByTimeAsync(0);

  it('an enrage callout offers 🔇 Mute… ; the click opens the choices and posts nothing yet', () => {
    const h = harness(); h.offerMute(fire);
    expect(h.btn.textContent).toBe('🔇 Mute…');
    expect(h.cls.has('canmute')).toBe(true);
    h.listeners.click();
    expect(h.cls.has('enragemenu')).toBe(true);
    expect(h.posts).toEqual([]);
  });
  it('the three choices post this mob / all / this mob always to /api/enrage-mute', async () => {
    for (const scope of ['mob', 'all', 'always']) {
      const h = harness(); h.offerMute(fire); h.listeners.click();
      h.opts.find(o => o.scope === scope).l.click();
      await flush();
      expect(h.posts).toEqual([{ url: 'http://127.0.0.1:7779/api/enrage-mute', body: { action: 'mute', scope, mob: GNOLL } }]);
      expect(h.cls.has('enragemenu')).toBe(false);
      expect(h.btn.textContent).toBe('Muted — undo');
    }
  });
  it('undo: the next click posts an unmute with the same scope and mob', async () => {
    const h = harness(); h.offerMute(fire); h.listeners.click();
    h.opts[2].l.click(); await flush();
    h.listeners.click(); await flush();
    expect(h.posts[1]).toEqual({ url: 'http://127.0.0.1:7779/api/enrage-mute', body: { action: 'unmute', scope: 'always', mob: GNOLL } });
    expect(h.cls.has('canmute')).toBe(false);
  });
  it('the choices stay open past the 8 s the offer normally lasts', async () => {
    const h = harness(); h.offerMute(fire);
    await vi.advanceTimersByTimeAsync(7000);
    h.listeners.click();
    await vi.advanceTimersByTimeAsync(7000);
    expect(h.cls.has('show')).toBe(true);
    expect(h.cls.has('enragemenu')).toBe(true);
  });
  it('every choice asks for the hover handshake (a locked overlay is click-through)', () => {
    const h = harness();
    for (const o of h.opts) { o.l.mouseenter(); o.l.mouseleave(); }
    expect(h.hover).toEqual([true, false, true, false, true, false]);
  });
  it('a callout with no mob keeps the one-click overlay-only mute', async () => {
    const h = harness(); h.offerMute({ ...fire, enrage_mob: null });
    expect(h.btn.textContent).toBe('🔇 Mute');
    h.listeners.click(); await flush();
    expect(h.posts).toEqual([{ url: 'http://127.0.0.1:7779/api/trigger-rules', body: { key: 'builtin:enrage_soon', char: '*', mode: 'overlay' } }]);
  });
  it('markup: three real <button>s in the vote row, one per scope, none of them a .fb-btn', () => {
    const s = stripJs(html);
    for (const scope of ['mob', 'all', 'always']) expect(s).toMatch(new RegExp('<button class="enrage-opt" data-scope="' + scope + '"'));
    expect(s).not.toMatch(/class="fb-btn[^"]*enrage-opt/);
    expect(s).toMatch(/#feedback\.enragemenu \.enrage-opt\s*\{\s*display:inline-block/);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('dashboard.html: Recent fires row and the muted list', () => {
  const dash = readSource(path.join(ROOT, 'packages/wolfpack-logsync/dashboard.html'));
  const esc = (s) => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const fns = new Function('esc', [
    sliceBlock(dash, 'function enrageMuteCell(o) {', '\n}'),
    sliceBlock(dash, 'function enrageMutedList(em) {', '\n}'),
    'return { enrageMuteCell, enrageMutedList };',
  ].join('\n'))(esc);

  it('an enrage fire gets this mob / all / always; any other fire gets nothing', () => {
    const cell = fns.enrageMuteCell({ enrage_mob: GNOLL });
    for (const scope of ['mob', 'all', 'always']) expect(cell).toContain('data-enrage-mute="' + scope + '" data-mob="' + GNOLL + '"');
    expect(cell.match(/<button/g)).toHaveLength(3);
    expect(fns.enrageMuteCell({ trigger: 'Slow landed' })).toBe('');
  });
  it('nothing muted: no list (the card stays as it was)', () => {
    expect(fns.enrageMutedList(undefined)).toBe('');
    expect(fns.enrageMutedList({ all: false, session: [], always: [] })).toBe('');
  });
  it('the muted list has a ✕ for each entry, carrying the scope that removes it', () => {
    const out = fns.enrageMutedList({ all: true, session: [GNOLL], always: ['a bat "x"'] });
    expect(out).toContain('data-enrage-unmute="all" data-mob=""');
    expect(out).toContain('data-enrage-unmute="mob" data-mob="' + GNOLL + '"');
    expect(out).toContain('data-enrage-unmute="always" data-mob="a bat &quot;x&quot;"');
    expect(out.match(/✕/g)).toHaveLength(3);
  });
  it('the render is byte-stable for the same state', () => {
    const em = { all: false, session: [GNOLL], always: [] };
    expect(fns.enrageMutedList(em)).toBe(fns.enrageMutedList({ ...em }));
  });
  it('the section click delegation routes both attributes to /api/enrage-mute', () => {
    const s = stripJs(dash);
    expect(s).toMatch(/closest\('\[data-enrage-mute\]'\)[\s\S]{0,200}enrageMutePost\('mute'/);
    expect(s).toMatch(/closest\('\[data-enrage-unmute\]'\)[\s\S]{0,200}enrageMutePost\('unmute'/);
    expect(s).toMatch(/fetch\('\/api\/enrage-mute'/);
  });
  it('the shipped agent embeds the same dashboard (npm run sync:dashboard)', () => {
    const idx = readSource(path.join(ROOT, 'packages/wolfpack-logsync/index.js'));
    expect(idx).toContain('data-enrage-mute');
    expect(idx).toContain("fetch('/api/enrage-mute'");
  });
});
