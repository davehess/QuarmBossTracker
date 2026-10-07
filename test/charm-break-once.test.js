// test/charm-break-once.test.js — a charm break is said ONCE, and an unticked 🔊 is silent (FB-21).
//
// FB-21, a beta tester on 2.7.3-beta.2, 2026-09-27: "Enabling either one of these 'charm break' lines
// makes both enable, and it says 'charm break' twice on breaks, even when tts is disabled."
//
// Three things were true at once (docs/DECISIONS-2026-09-21.md §59f, row 1):
//   1. There is ONE suggested trigger, `self_charm_broke`. Its personal-trigger copy is listed again
//      under Personal triggers, on the same object — which is why ticking either box moved both. The
//      list now says so on the row.
//   2. A Suggested alert's 🔊 box is its `tts` text. Unticked, the row has none, and the trigger overlay
//      reads the DISPLAY text aloud whenever a fire carries no tts of its own — so the box silenced
//      nothing. An unticked Suggested alert now flashes and is muted (overlay.mute, the same switch the
//      raid callout allow-list uses).
//   3. The break reaches the overlays twice: once as 3.7.34's instant charm fire (spoken by the Charm
//      overlay) and once as the trigger's own fire. The instant fire is marked charm_spoken only when
//      the trigger will really speak — on, on for the character whose charm it was (FB-34), and 🔊
//      ticked. With the box unticked that used to be false AND the trigger spoke anyway: two voices.
//
// The REAL agent is driven (require): a log line through the trigger evaluator, the instant break through
// _pushCharmBreakInstant, both read back through the same /api/fires/wait mapping the overlays poll. Who
// SPEAKS is then decided by the two overlays' rules, which the last describe pins in their source.
//
// Run: npx vitest run test/charm-break-once.test.js

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { readSource, stripJs, ROOT } from './_source-slice.js';

let agent;
beforeAll(() => { agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js'); });

const ME = 'Fenrisk';
const BROKE = '[Sun Aug 02 20:41:38 2026] Your charm spell has worn off.';

const tpl = (id) => agent.SUGGESTED_TRIGGERS.find(t => t.id === id);
// The row the Suggested panel saves when it is ticked, with its 🔊 box as given (what POST /api/triggers/suggested builds).
const sugRow = (id, tts, extra = {}) => agent._compilePersonalTrigger({ ...agent._templateToPersonalRow(tpl(id), { tts }), ...extra });

beforeEach(() => {
  agent._setWatchedLogsForTest([{ character: ME, logPath: 'eqlog_Fenrisk_pq.proj.txt' }]);
  agent._setPersonalTriggersForTest([]);
  agent._activeOverlays.length = 0;
  agent._triggerLastFire.clear();
});

// What the two overlays that read these fires would say aloud. Rules as in apps/mimic/triggers.html fire()
// and apps/mimic/charm.html waitCharmFires() — pinned in source at the bottom of this file.
function heard(fires) {
  const out = [];
  for (const f of fires) {
    if (f.charm) { if (!f.charm_spoken) out.push({ by: 'charm overlay', says: 'charm break' }); continue; }
    if (!f.mute) out.push({ by: 'trigger overlay', says: f.tts });
  }
  return out;
}
let petN = 0;
// One real break: the log line through the evaluator, and the instant fire the agent pushes for it.
async function breakOnce(rows, { charLc = ME.toLowerCase() } = {}) {
  agent._setPersonalTriggersForTest(rows);
  agent._activeOverlays.length = 0;
  agent._triggerLastFire.clear();
  const now = Date.now();
  agent.evaluateTriggersAgainstLine(BROKE, now, ME);
  agent._pushCharmBreakInstant('golem-' + (++petN), 'a golem', true, now, now, charLc);
  return agent._waitForFires(0, 0);
}

describe('one charm break is said once', () => {
  it('"Your charm broke" ticked with 🔊 ticked: the trigger overlay says it, the Charm overlay stays quiet', async () => {
    const fires = await breakOnce([sugRow('self_charm_broke', true)]);
    expect(heard(fires)).toEqual([{ by: 'trigger overlay', says: 'CHARM BREAK' }]);
  });

  it('ticked with 🔊 UNTICKED (the report): it still flashes, and exactly one voice speaks, not two', async () => {
    const fires = await breakOnce([sugRow('self_charm_broke', false)]);
    const trig = fires.find(f => !f.charm);
    expect(trig).toBeTruthy();                       // the alert is still shown
    expect(trig.text).toBe('CHARM BREAK');
    expect(trig.mute).toBe(true);                    // ... and the trigger overlay is told not to speak it
    expect(heard(fires)).toEqual([{ by: 'charm overlay', says: 'charm break' }]);
  });

  it('not ticked at all: the Charm overlay says it, once', async () => {
    expect(heard(await breakOnce([]))).toEqual([{ by: 'charm overlay', says: 'charm break' }]);
  });

  it('ticked only for ANOTHER character: this character\'s break is still said once (by the Charm overlay)', async () => {
    const rows = [sugRow('self_charm_broke', true, { characters: ['brackwyn'] })];
    expect(heard(await breakOnce(rows, { charLc: ME.toLowerCase() }))).toEqual([{ by: 'charm overlay', says: 'charm break' }]);
  });

  it('ticked for this character (among others): the trigger says it and the Charm overlay stays quiet', async () => {
    const rows = [sugRow('self_charm_broke', true, { characters: ['brackwyn', ME.toLowerCase()] })];
    expect(heard(await breakOnce(rows, { charLc: ME.toLowerCase() }))).toEqual([{ by: 'trigger overlay', says: 'CHARM BREAK' }]);
  });

  it('a row parked (enabled: false) does not claim the break either', async () => {
    const rows = [{ ...sugRow('self_charm_broke', true), enabled: false }];
    expect(heard(await breakOnce(rows))).toEqual([{ by: 'charm overlay', says: 'charm break' }]);
  });

  it('the instant fire says who already spoke only when the trigger will really speak', async () => {
    const spoken = async (rows, charLc) => {
      agent._setPersonalTriggersForTest(rows);
      agent._activeOverlays.length = 0;
      const now = Date.now();
      agent._pushCharmBreakInstant('golem-' + (++petN), 'a golem', true, now, now, charLc);
      return (await agent._waitForFires(0, 0)).find(f => f.charm).charm_spoken;
    };
    expect(await spoken([sugRow('self_charm_broke', true)], 'fenrisk')).toBe(true);
    expect(await spoken([sugRow('self_charm_broke', false)], 'fenrisk')).toBe(false);
    expect(await spoken([sugRow('self_charm_broke', true, { characters: ['brackwyn'] })], 'fenrisk')).toBe(false);
    expect(await spoken([sugRow('self_charm_broke', true, { characters: ['brackwyn'] })], 'brackwyn')).toBe(true);
    expect(await spoken([], 'fenrisk')).toBe(false);
  });
});

describe('an unticked 🔊 on a Suggested alert is silent; everything else is unchanged', () => {
  // A pattern-based Suggested alert that is not the charm break, fired directly through the real action path.
  const fire = (t) => {
    agent._activeOverlays.length = 0;
    agent._fireTriggerActions(t, {}, Date.now(), false, false);
    return agent._waitForFires(0, 0);
  };

  it('unticked: flashes its text, carries no speech, and is muted', async () => {
    const [f] = await fire(sugRow('self_stunned', false));
    expect(f.text).toBe('STUNNED');
    expect(f.mute).toBe(true);
  });

  it('ticked: speaks its text, not muted', async () => {
    const [f] = await fire(sugRow('self_stunned', true));
    expect(f.tts).toBe('STUNNED');
    expect(f.mute).toBe(false);
  });

  it('the same goes for a row that ships unticked (tts_default off)', async () => {
    expect(tpl('self_stunned').tts_default).toBe(false);
    const [f] = await fire(agent._compilePersonalTrigger(agent._templateToPersonalRow(tpl('self_stunned'))));
    expect(f.mute).toBe(true);
  });

  it('a personal trigger of your own with no speech text still reads its display text aloud', async () => {
    const own = agent._compilePersonalTrigger({ id: 'p_mine', name: 'mine', pattern: 'zzz', enabled: true,
      actions: [{ type: 'text_overlay', text: 'LOOK OUT', color: 'red', duration_ms: 2000 }] });
    const [f] = await fire(own);
    expect(f.tts).toBe('LOOK OUT');
    expect(f.mute).toBe(false);
  });

  it('a Suggested row that carries its own speech text is spoken as written', async () => {
    const [f] = await fire(sugRow('self_charm_broke', true));
    expect(f.tts).toBe('CHARM BREAK');
    expect(f.mute).toBe(false);
  });
});

describe('the overlays\' rules this relies on, and the dashboard\'s wording', () => {
  const read = (...p) => readSource(path.join(ROOT, ...p));
  const triggers = stripJs(read('apps', 'mimic', 'triggers.html'));
  const charm = stripJs(read('apps', 'mimic', 'charm.html'));
  const dash = stripJs(read('packages', 'wolfpack-logsync', 'dashboard.html'));

  it('the trigger overlay skips a charm fire and does not speak a muted one', async () => {
    expect(triggers).toMatch(/function fire\(t\)\{\s*if \(t && t\.charm\) return;/);
    expect(triggers).toContain('if (!t.mute) speak(spoken,');
  });

  it('the Charm overlay speaks a charm fire unless it is marked already spoken', async () => {
    expect(charm).toContain("if (!f.charm_spoken) speak('charm break');");
  });

  it('the Personal triggers list says a Suggested row is the Suggested panel\'s copy, not a second trigger', async () => {
    expect(dash).toMatch(/String\(t\.id \|\| ''\)\.indexOf\('suggested:'\) === 0 \? ' <span class="dim"[^>]*>\(from Suggested\)<\/span>' : ''/);
  });

  it('a Suggested row with its 🔊 unticked is shown as saying nothing, not "the same words it shows"', async () => {
    expect(dash).toMatch(/!guild && String\(t\.id \|\| ''\)\.indexOf\('suggested:'\) === 0 \? '<span class="dim">nothing, its 🔊 is unticked/);
  });
});
