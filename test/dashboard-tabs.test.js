// test/dashboard-tabs.test.js — the dashboard's tab wiring holds together.
//
// The Mimic dashboard's navigation is four separate lists that must agree, and
// nothing at runtime checks that they do:
//   1. the .nav <button data-tab="X"> rail,
//   2. the <div id="X" class="section"> panes,
//   3. the _sections render-loop entries,
//   4. which render fn emits which wp* placeholder.
//
// Every way they can disagree fails SILENTLY in a way that reads as working
// software:
//   • a button with no section → the switcher throws on
//     getElementById(tab).classList, and the whole dashboard blanks (this is
//     the exact shape of the '⚙ Panels' bug the switcher comment records);
//   • a section with no button → the pane is unreachable, its cards simply
//     gone with no error anywhere;
//   • two render fns emitting the same placeholder id → duplicate ids, and
//     morphInto fills whichever getElementById returns first, so one copy is
//     permanently empty;
//   • a placeholder's filler running BEFORE the fn that emits it → the card
//     is blank for one poll on a cold load, then fixes itself. Intermittent,
//     which is worse than broken.
//
// The 📊 Stats / 🩺 Diagnostics split (2026-08-13) added two of each, which is
// exactly when this class of mistake happens.
//
// Run: npx vitest run test/dashboard-tabs.test.js

import { describe, it, expect } from 'vitest';
import { readSource, AGENT_INDEX } from './_source-slice.js';

const src = readSource(AGENT_INDEX);

// ── the four lists, read out of the shipped source ─────────────────────────
const navTabs = [...src.matchAll(/<button[^>]*data-tab="([a-z]+)"/g)].map(m => m[1]);
// NB: the default pane ships as class="section active", so this must not
// anchor on a closing quote right after "section" — an over-strict regex here
// silently drops #dash and the test then "proves" a bug that isn't there.
const sectionIds = [...src.matchAll(/<div id="([a-z]+)" class="section[^"]*"/g)].map(m => m[1]);

// _sections is the render loop's [id, fn] table.
const sectionsBlock = (() => {
  const i = src.indexOf('var _sections = [');
  const j = src.indexOf(']];', i);
  if (i < 0 || j < 0) throw new Error('_sections table not found — did the render loop move?');
  return src.slice(i, j + 3);   // +3 keeps the LAST entry's own ']'
})();
const renderEntries = [...sectionsBlock.matchAll(/\['([a-z]+)', (render[A-Za-z]+)\]/g)]
  .map(m => ({ id: m[1], fn: m[2] }));

// Which render fn emits a given placeholder id? Walk each `function renderX(s) {`
// body and look for `id="wpFoo"` in the HTML it builds.
function bodyOf(fnName) {
  const start = src.indexOf(`function ${fnName}(`);
  if (start < 0) return '';
  const end = src.indexOf('\n}\n', start);
  return src.slice(start, end < 0 ? src.length : end);
}
const SECTION_RENDERERS = ['renderDash', 'renderStats', 'renderInfo', 'renderTriggers',
                           'renderDiag', 'renderOverlays', 'renderAdmin'];
function emittersOf(placeholderId) {
  return SECTION_RENDERERS.filter(fn => bodyOf(fn).includes(`id="${placeholderId}"`));
}

describe('the nav rail and the panes agree', () => {
  it('every tab button has a section to show', () => {
    // A miss here blanks the dashboard: the switcher does
    // getElementById(b.dataset.tab).classList.add('active') with no guard.
    const orphanButtons = navTabs.filter(t => !sectionIds.includes(t));
    expect(orphanButtons, 'tab buttons with no matching .section div').toEqual([]);
  });

  it('every section has a button that reaches it', () => {
    // A miss here is invisible: the pane and its cards exist in the DOM and
    // render every poll, but nothing can ever make them active.
    const unreachable = sectionIds.filter(id => !navTabs.includes(id));
    expect(unreachable, '.section divs with no nav button').toEqual([]);
  });

  it('still carries the tabs the split produced', () => {
    for (const t of ['dash', 'overlays', 'raid', 'fights', 'stats', 'triggers', 'diag', 'info', 'optin', 'admin']) {
      expect(navTabs, `missing tab: ${t}`).toContain(t);
    }
  });

  it('declares each tab exactly once', () => {
    const dupes = navTabs.filter((t, i) => navTabs.indexOf(t) !== i);
    expect(dupes, 'duplicate data-tab buttons').toEqual([]);
    const dupeSections = sectionIds.filter((t, i) => sectionIds.indexOf(t) !== i);
    expect(dupeSections, 'duplicate .section ids').toEqual([]);
  });
});

describe('the render loop covers the new sections', () => {
  it('runs a render fn for stats and diag', () => {
    const ids = renderEntries.map(e => e.id);
    expect(ids).toContain('stats');
    expect(ids).toContain('diag');
    expect(renderEntries.find(e => e.id === 'stats').fn).toBe('renderStats');
    expect(renderEntries.find(e => e.id === 'diag').fn).toBe('renderDiag');
  });

  it('names its entries after the real section ids, so a throw lands in the right pane', () => {
    // The loop's catch does getElementById(_sid) to paint the "panel failed to
    // render" card. An entry keyed on something that isn't a section id (the
    // volatile-card fillers legitimately are) still has to not COLLIDE with a
    // section that a different fn owns.
    const owners = {};
    for (const e of renderEntries) {
      if (!sectionIds.includes(e.id)) continue;
      expect(owners[e.id], `two fns claim section #${e.id}`).toBeUndefined();
      owners[e.id] = e.fn;
    }
  });
});

describe('placeholders have exactly one owner, filled after it', () => {
  // id → the render fn expected to emit it, after the split.
  const OWNERSHIP = {
    wpZealCard:       'renderDiag',
    wpCharmDiag:      'renderDiag',
    wpPetBuffDiag:    'renderDiag',
    wpTriggerJournal: 'renderDiag',
    wpMechanics:      'renderDiag',
    wpZealExplorer:   'renderDiag',
    wpRecentFires:    'renderTriggers',
    wpCrashReview:    'renderInfo',     // Hitya put the crash card on Info on purpose
    wpBackupsCard:    'renderInfo',
    wpMeCard:         'renderDash',
    wpEngine:         'renderDash',
  };

  for (const [id, owner] of Object.entries(OWNERSHIP)) {
    it(`#${id} is emitted only by ${owner}`, () => {
      expect(emittersOf(id)).toEqual([owner]);
    });
  }

  it('fills each placeholder AFTER the fn that emits it', () => {
    // Cold-load ordering: renderZealCard() is a no-op if #wpZealCard does not
    // exist yet, so the card would be blank for one poll.
    const order = renderEntries.map(e => e.fn);
    const fillers = {
      wpZealCard:       'renderZealCard',
      wpCharmDiag:      'renderCharmDiag',
      wpPetBuffDiag:    'renderPetBuffDiag',
      wpTriggerJournal: 'renderTriggerJournal',
      wpMechanics:      'renderMechanics',
      wpZealExplorer:   'renderZealExplorer',
      wpRecentFires:    'renderRecentFires',
      wpCrashReview:    'renderCrashReview',
      wpBackupsCard:    'renderBackupsCard',
      wpMeCard:         'renderMeCard',
      wpEngine:         'renderEngine',
    };
    for (const [id, filler] of Object.entries(fillers)) {
      const emitAt = order.indexOf(OWNERSHIP[id]);
      const fillAt = order.indexOf(filler);
      expect(emitAt, `${OWNERSHIP[id]} missing from _sections`).toBeGreaterThanOrEqual(0);
      expect(fillAt, `${filler} missing from _sections`).toBeGreaterThanOrEqual(0);
      expect(fillAt, `${filler} runs before ${OWNERSHIP[id]} emits #${id}`).toBeGreaterThan(emitAt);
    }
  });
});

describe('the split actually moved the cards', () => {
  it('Stats owns the session-observation cards, Info no longer does', () => {
    const stats = bodyOf('renderStats');
    const info  = bodyOf('renderInfo');
    for (const h of ['Monk Mending', 'Top Abilities', 'Spells Resisted', 'Rolls (this session)',
                     'Spell Damage Inbound', 'Spell Casts This Session']) {
      expect(stats, `Stats should carry "${h}"`).toContain(h);
      expect(info, `Info should no longer carry "${h}"`).not.toContain(h);
    }
  });

  it('Diagnostics owns the raw Zeal capture, Info no longer does', () => {
    // Match the emitted MARKUP, not the phrase — renderInfo keeps a comment
    // saying where the card went, and that comment is not a card.
    expect(bodyOf('renderDiag')).toContain('<h2>🩺 Raw Zeal Capture');
    expect(bodyOf('renderInfo')).not.toContain('<h2>🩺 Raw Zeal Capture');
  });

  it('Info keeps the parser facts and the crash card', () => {
    const info = bodyOf('renderInfo');
    for (const h of ['Parser Info', 'Client versions', 'Log archiving', 'Zeal tag capture', 'Crash review']) {
      expect(info, `Info should still carry "${h}"`).toContain(h);
    }
  });

  it('Triggers keeps the trigger config and loses the diagnostics', () => {
    const trig = bodyOf('renderTriggers');
    for (const h of ['Suggested triggers', 'Personal triggers', 'Guild triggers',
                     'Loot auction announce', 'Raid callout allow-list', 'Replay']) {
      expect(trig, `Triggers should still carry "${h}"`).toContain(h);
    }
  });

  it('moves the post-render wiring with the card it wires', () => {
    // wireLoadoutControls binds the loadouts card (now on Stats) and
    // wpWireZealCapture binds the raw-capture buttons (now on Diagnostics).
    // Left behind on Info they would silently bind nothing.
    expect(bodyOf('renderStats')).toContain('wireLoadoutControls()');
    expect(bodyOf('renderDiag')).toContain('wpWireZealCapture()');
    expect(bodyOf('renderInfo')).toContain('wpScanLocalTriggers()');   // this one stays
  });
});
