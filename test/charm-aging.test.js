// test/charm-aging.test.js — the non-bard "charm aging" cue in the Charm tracker (charm.html).
//
// The guild lead, 2026-10-08, "A plus B's instrumentation, 25 seconds": an enchanter's charm
// lasts minutes on paper but breaks at random on the mob's tick, so the max-duration warning
// almost never fires first. A non-bard charm now speaks "charm aging" ONCE, 25 s after it
// lands, and its "up" timer is red from then on. Bards keep their own cues and the 54 s red.
//
// BEHAVIOUR, not text: the pure helpers are evaluated from the real source, and the page's
// real inline script runs against a small fake DOM (the same approach as
// mini-popraid-charm.test.js). Names are invented.
//
// Run: npx vitest run test/charm-aging.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, ROOT } from './_source-slice.js';

const charmHtml = readSource(path.join(ROOT, 'apps', 'mimic', 'charm.html'));
const NOW = Date.UTC(2026, 9, 8, 1, 0, 0);
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0)); };

// ── pure helpers, from the shipped source ───────────────────────────────────
const { CHARM_AGING_MS, RECHARM_RED_AT_MS, agingDueMs, redAtMs, agingFired } = evalBlock(
  sliceBlock(charmHtml, 'var RECHARM_RED_AT_MS', '// END charm aging'),
  ['CHARM_AGING_MS', 'RECHARM_RED_AT_MS', 'agingDueMs', 'redAtMs', 'agingFired']);

describe('charm aging — pure rules', () => {
  it('the guild lead\'s 25 seconds; bard red stays 54 seconds', () => {
    expect(CHARM_AGING_MS).toBe(25000);
    expect(RECHARM_RED_AT_MS).toBe(54000);
  });
  it('a bard has no aging time; a non-bard has 25 s unless the manual box says otherwise', () => {
    expect(agingDueMs(true, 0)).toBeNull();
    expect(agingDueMs(true, 40)).toBeNull();
    expect(agingDueMs(false, 0)).toBe(25000);
    expect(agingDueMs(false, 40)).toBe(40000);
  });
  it('red threshold per class: bard 54 s always, non-bard its aging time', () => {
    expect(redAtMs(true, 0)).toBe(54000);
    expect(redAtMs(true, 40)).toBe(54000);
    expect(redAtMs(false, 0)).toBe(25000);
    expect(redAtMs(false, 40)).toBe(40000);
  });
  it('fires once per landing record, only at or after the aging time', () => {
    const mem = {};
    expect(agingFired(mem, 24999, 25000)).toBe(false);
    expect(agingFired(mem, 25000, 25000)).toBe(true);
    expect(agingFired(mem, 25500, 25000)).toBe(false);
    expect(agingFired(mem, 60000, 25000)).toBe(false);
    expect(agingFired({}, 60000, null)).toBe(false);          // bard: never
  });
  it('a re-charm is a new record and fires again', () => {
    const a = {}; agingFired(a, 26000, 25000);
    expect(agingFired({}, 26000, 25000)).toBe(true);
  });
  it('a session already long past the mark is stale: marked done, never spoken', () => {
    const mem = {};
    expect(agingFired(mem, 40000, 25000)).toBe(false);
    expect(mem.aged).toBe(true);
  });
});

// ── harness: the page's own script against a fake DOM ───────────────────────
function fakeEl(id) {
  const cls = new Set();
  const e = {
    id, style: {}, value: '', textContent: '', className: '', scrollHeight: 120, innerHTML: '',
    classList: {
      add: (c) => { cls.add(c); }, remove: (c) => { cls.delete(c); }, contains: (c) => cls.has(c),
      toggle: (c, force) => { const want = force === undefined ? !cls.has(c) : !!force; if (want) cls.add(c); else cls.delete(c); return want; },
    },
    addEventListener() {}, getAttribute: () => null, setAttribute() {}, removeAttribute() {}, hasAttribute: () => false, focus() {},
    closest: () => null,
  };
  return e;
}

async function bootCharm(getState, { mini = false, store = {} } = {}) {
  const html = charmHtml;
  const o = html.indexOf('<script>');
  const script = html.slice(o + 8, html.indexOf('</script>', o));
  const markup = html.slice(html.indexOf('<body>'), html.indexOf('<script'));
  const byId = {};
  for (const m of markup.matchAll(/\bid="([^"]+)"/g)) byId[m[1]] = fakeEl(m[1]);
  const body = fakeEl('body');
  if (mini) body.classList.add('wp-mini');
  const document = {
    body, documentElement: { style: { setProperty() {} } },
    addEventListener() {}, getElementById: (id) => byId[id] || null,
  };
  const spoken = [];
  const window = {
    mimic: { autoFitOverlay() {}, overlayAutoHeight() {}, overlayHoverInteractive() {}, openExternal() {} },
    addEventListener() {},
    speechSynthesis: { cancel() {}, speak: (u) => spoken.push(u.text) },
  };
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  const run = new Function('window', 'document', 'fetch', 'localStorage', 'setInterval', 'setTimeout',
    'var SpeechSynthesisUtterance = function (t) { this.text = t; };\n' + script + '\nreturn { tick };');
  const api = run(window, document, async () => ({ json: async () => getState() }), localStorage, () => 0, () => 0);
  await flush();
  return { spoken, list: () => byId.list.innerHTML, poll: async () => { await api.tick(); await flush(); } };
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

const pet = (o) => Object.assign({
  key: 'rethlan:servant', pet: 'a bound servant', owner: 'Rethlan', is_active: true,
  started_at: NOW - 10000, last_tick_at: NOW - 3000, duration_sec: 360, charm_class: 'enchanter',
  is_dire_charm: false, pet_hp_pct: 80,
}, o);
const stateOf = (p) => ({ activeCharacter: 'Rethlan', charmPets: [p] });
const upSpan = (out) => (out.match(/<span class="up[^"]*">/) || [''])[0];
const aging = (spoken) => spoken.filter(t => t === 'charm aging').length;

describe('charm aging — full card', () => {
  it('non-bard: silent and not red before 25 s; speaks once and goes red from 25 s', async () => {
    // One landing at NOW - 24 s; the clock moves, the landing does not.
    const h = await bootCharm(() => stateOf(pet({ started_at: NOW - 24000 })));
    expect(aging(h.spoken)).toBe(0);
    expect(upSpan(h.list())).toBe('<span class="up">');
    vi.setSystemTime(NOW + 2000); await h.poll();
    expect(aging(h.spoken)).toBe(1);
    expect(upSpan(h.list())).toBe('<span class="up danger">');
    expect(h.list()).toContain('class="charm warn"');          // the card flashes on that poll
    vi.setSystemTime(NOW + 3000); await h.poll();
    vi.setSystemTime(NOW + 7000); await h.poll();
    expect(aging(h.spoken)).toBe(1);                            // once, not every poll
    expect(upSpan(h.list())).toBe('<span class="up danger">'); // and it stays red
    expect(h.list()).not.toContain('class="charm warn"');
  });

  it('a re-charm (new landing, same key) re-arms the cue', async () => {
    let startedAt = NOW - 26000;
    const h = await bootCharm(() => stateOf(pet({ started_at: startedAt })));
    expect(aging(h.spoken)).toBe(1);
    startedAt = NOW - 1000; await h.poll();                     // charmed again
    expect(upSpan(h.list())).toBe('<span class="up">');
    vi.setSystemTime(NOW + 25000); await h.poll();              // 26 s into the second landing
    expect(aging(h.spoken)).toBe(2);
  });

  it('the manual box overrides the aging time for a non-bard and does not double-speak', async () => {
    const h = await bootCharm(() => stateOf(pet({ started_at: NOW - 30000 })), { store: { wpCharmWarnAt: '40' } });
    expect(h.spoken).toEqual([]);                               // 30 s: neither the 25 s default nor 40 s
    expect(upSpan(h.list())).toBe('<span class="up">');
    vi.setSystemTime(NOW + 11000); await h.poll();              // 41 s
    expect(h.spoken).toEqual(['recharm pet']);                  // the manual warn speaks; aging stays quiet
    expect(upSpan(h.list())).toBe('<span class="up danger">');
  });

  it('a stale session far past 25 s is red but silent', async () => {
    const h = await bootCharm(() => stateOf(pet({ started_at: NOW - 200000 })));
    expect(aging(h.spoken)).toBe(0);
    expect(upSpan(h.list())).toBe('<span class="up danger">');
  });

  it('a bard is untouched: no aging cue, not red at 30 s, red from 54 s, manual box irrelevant to red', async () => {
    const h = await bootCharm(() => stateOf(pet({ started_at: NOW - 30000, charm_class: 'bard', duration_sec: 60 })));
    vi.setSystemTime(NOW + 10000); await h.poll();              // 40 s
    expect(h.spoken).toEqual([]);
    expect(upSpan(h.list())).toBe('<span class="up">');
    vi.setSystemTime(NOW + 24000); await h.poll();              // 54 s
    expect(upSpan(h.list())).toBe('<span class="up danger">');
    expect(aging(h.spoken)).toBe(0);
    expect(h.spoken).toContain('charm breaking');               // its own max-duration cue, as before

    vi.setSystemTime(NOW);
    const m = await bootCharm(() => stateOf(pet({ started_at: NOW - 45000, charm_class: 'bard', duration_sec: 60 })), { store: { wpCharmWarnAt: '40' } });
    expect(upSpan(m.list())).toBe('<span class="up">');          // red is still 54 s, not the manual 40
    vi.setSystemTime(NOW + 10000); await m.poll();              // 55 s
    expect(upSpan(m.list())).toBe('<span class="up danger">');
    expect(aging(m.spoken)).toBe(0);
  });

  it('an estimated-duration charm keeps bard tempo (unknown class is not aged)', async () => {
    const h = await bootCharm(() => stateOf(pet({ started_at: NOW - 30000, duration_sec: null, charm_class: null })));
    expect(aging(h.spoken)).toBe(0);
    expect(upSpan(h.list())).toBe('<span class="up">');
  });

  it('a broken charm and a dire charm never speak the cue', async () => {
    const h = await bootCharm(() => ({ activeCharacter: 'Rethlan', charmPets: [
      pet({ key: 'a', is_active: false, broke_at: NOW - 2000, started_at: NOW - 90000 }),
      pet({ key: 'b', is_dire_charm: true, started_at: NOW - 26000 }),
    ] }));
    expect(aging(h.spoken)).toBe(0);
  });
});

describe('charm aging — mini', () => {
  const PURPLE = 'style="color:#a371f7">⏳ ';
  const RED = 'style="color:#f85149">⏳ ';

  it('non-bard timer turns red at 25 s, without the word recharm; purple before', async () => {
    const h = await bootCharm(() => stateOf(pet({ started_at: NOW - 24000 })), { mini: true });
    expect(h.list()).toContain(PURPLE + '5:36</span>');
    vi.setSystemTime(NOW + 2000); await h.poll();
    expect(h.list()).toContain(RED + '5:34</span>');
    expect(aging(h.spoken)).toBe(1);                            // the mini speaks the same cue
  });

  it('the manual box moves the mini red too', async () => {
    const h = await bootCharm(() => stateOf(pet({ started_at: NOW - 30000 })), { mini: true, store: { wpCharmWarnAt: '40' } });
    expect(h.list()).toContain(PURPLE);
    expect(h.list()).not.toContain(RED);
  });

  it('bard mini is unchanged: purple at 30 s, red only when the break is imminent', async () => {
    const h = await bootCharm(() => stateOf(pet({ started_at: NOW - 30000, charm_class: 'bard', duration_sec: 60 })), { mini: true });
    expect(h.list()).toContain(PURPLE + '0:30</span>');
    expect(h.spoken).toEqual([]);
    const late = await bootCharm(() => stateOf(pet({ started_at: NOW - 52000, charm_class: 'bard', duration_sec: 60 })), { mini: true });
    expect(late.list()).toContain(RED + '0:08 recharm</span>');
    // Past the full card's 54 s red mark but nowhere near the end of a long song: the mini bar stays purple.
    const long = await bootCharm(() => stateOf(pet({ started_at: NOW - 60000, charm_class: 'bard', duration_sec: 120 })), { mini: true });
    expect(long.list()).toContain(PURPLE + '1:00</span>');
  });
});
