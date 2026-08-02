// test/runbooks-catalog.test.js — #87 anti-rot.
//
// Runbooks rot the same way docs do, and worse: a runbook that names a tuning
// flag which no longer exists is ACTIVELY HARMFUL at 21:40 on a Thursday. So
// every structured reference in web/lib/runbooks.ts is asserted against the
// real repo — rename a flag and CI tells you which runbook now lies.
//
// Same "enforced, not advisory" posture as scripts/check-agent-dashboard.js.
// Real-imports the catalog (the web/lib/*.ts import tier, cf. raid-kit.test.js).

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUNBOOKS, allLevers, runbookById } from '../web/lib/runbooks.ts';
import { buildSignals, driftFromTuning, driftAges, isControlKey, inRaidWindow, verNum, sortSignals } from '../web/lib/consoleHealth.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

// The two authorities for "is this a real control-plane key":
//   • the bot's own whitelist (_FLAG_OVERRIDE_KEYS + the _SHED_KINDS it expands)
//   • the web tuning editor's FLAGS catalog
const BOT_SRC      = read('index.js');
const OVERLAYS_SRC = read('web/app/admin/overlays/page.tsx');

function botControlKeys() {
  const keys = new Set();
  // Literal keys inside the _FLAG_OVERRIDE_KEYS declaration.
  const block = BOT_SRC.slice(BOT_SRC.indexOf('const _FLAG_OVERRIDE_KEYS'));
  const decl  = block.slice(0, block.indexOf(']);') + 3);
  for (const m of decl.matchAll(/'([a-z0-9_]+)'/g)) keys.add(m[1]);
  // The shed flags are generated from _SHED_KINDS — expand them.
  const shedBlock = BOT_SRC.slice(BOT_SRC.indexOf('const _SHED_KINDS'));
  const shedDecl  = shedBlock.slice(0, shedBlock.indexOf(']);') + 3);
  for (const m of shedDecl.matchAll(/'([a-z0-9_]+)'/g)) keys.add(`flag_shed_${m[1]}`);
  return keys;
}

function overlayFlagKeys() {
  const keys = new Set();
  for (const m of OVERLAYS_SRC.matchAll(/\{\s*key:\s*'([a-z0-9_]+)'/g)) keys.add(m[1]);
  keys.add('min_agent_ver_num');
  return keys;
}

const KNOWN_FLAGS = new Set([...botControlKeys(), ...overlayFlagKeys()]);

describe('runbook catalog integrity', () => {
  it('has a non-empty, uniquely-identified, uniquely-ranked set', () => {
    expect(RUNBOOKS.length).toBeGreaterThan(0);
    const ids   = RUNBOOKS.map(r => r.id);
    const ranks = RUNBOOKS.map(r => r.rank);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ranks).size).toBe(ranks.length);
    for (const id of ids) expect(id).toMatch(/^rb-\d\d$/);
  });

  it('every runbook is grounded in a dated incident (or declares itself speculative)', () => {
    for (const rb of RUNBOOKS) {
      if (rb.speculative) continue;
      expect(rb.groundedIn.length, `${rb.id} has no incident behind it`).toBeGreaterThan(0);
      for (const g of rb.groundedIn) {
        expect(g.date, `${rb.id} incident date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(g.what.length).toBeGreaterThan(20);
      }
    }
  });

  it('every runbook carries steps and at least one "don\'t"', () => {
    for (const rb of RUNBOOKS) {
      expect(rb.howYouTell.length, `${rb.id} howYouTell`).toBeGreaterThan(0);
      expect(rb.doThis.length, `${rb.id} doThis`).toBeGreaterThan(0);
      // The don'ts are the part that gets lost when knowledge moves by word of
      // mouth. They are mandatory.
      expect(rb.donts.length, `${rb.id} has no donts`).toBeGreaterThan(0);
      expect(rb.lastReviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe('runbook lever references still resolve', () => {
  const levers = allLevers();

  it('references at least one lever of each checkable kind', () => {
    for (const kind of ['flag', 'route', 'command', 'doc']) {
      expect(levers.some(l => l.kind === kind), `no ${kind} levers referenced`).toBe(true);
    }
  });

  // Guard the guard: if the source scrape ever stops finding keys, the
  // whitelist check below would pass vacuously (empty set) or trivially
  // (everything). Pin both ends.
  it('scraped the real control-key whitelist out of the sources', () => {
    for (const k of ['flag_agent_kill', 'min_agent_ver_num', 'flag_disable_budgets',
                     'dedup_chat', 'flag_shed_live_state', 'flag_shed_trigger_relay']) {
      expect(KNOWN_FLAGS.has(k), `expected ${k} in the scraped whitelist`).toBe(true);
    }
    expect(KNOWN_FLAGS.has('flag_shed_encounter'), 'encounter must never be sheddable').toBe(false);
    expect(KNOWN_FLAGS.has('flag_totally_made_up')).toBe(false);
    expect(KNOWN_FLAGS.size).toBeLessThan(60);
  });

  it('every flag key exists in the bot whitelist or the overlays catalog', () => {
    const bad = levers.filter(l => l.kind === 'flag' && !KNOWN_FLAGS.has(l.key));
    expect(bad.map(l => l.key)).toEqual([]);
  });

  it('every route has a real page.tsx', () => {
    const missing = [];
    for (const l of levers) {
      if (l.kind !== 'route') continue;
      const rel = l.href.replace(/^\//, '');
      if (!fs.existsSync(path.join(ROOT, 'web/app', rel, 'page.tsx'))) missing.push(l.href);
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it('every slash command has a real commands/<name>.js', () => {
    const missing = [];
    for (const l of levers) {
      if (l.kind !== 'command') continue;
      if (!fs.existsSync(path.join(ROOT, 'commands', `${l.name}.js`))) missing.push(l.name);
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it('every doc path exists on disk', () => {
    const missing = [];
    for (const l of levers) {
      if (l.kind !== 'doc') continue;
      if (!fs.existsSync(path.join(ROOT, l.path))) missing.push(l.path);
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it('the design doc it all comes from exists', () => {
    expect(fs.existsSync(path.join(ROOT, 'docs/DESIGN-87-officer-console.md'))).toBe(true);
  });
});

describe('signals and runbooks reference each other consistently', () => {
  // A synthetic all-healthy input: enough to enumerate every signal id.
  const now = new Date('2026-08-02T12:00:00Z');
  const healthy = {
    now,
    lastUploadIso: now.toISOString(),
    activeChars15m: 30,
    lastChatIso: now.toISOString(),
    lastEncounterIso: now.toISOString(),
    encountersToday: 4,
    lastLiveStateIso: now.toISOString(),
    errorUploaders: 0,
    topErrorCode: null,
    agentVersions: [{ version: '3.4.43', chars: 30 }],
    versionFloor: null,
    backfillPending: 0,
    maxQueuePending: 0,
    enabledTriggers: 101,
    deadAnchoredTriggers: 0,
    driftCount: 0,
    oldestDriftDays: null,
    site: { ok: true, degraded: false, auth: 'ok', db: 'ok' },
  };

  it('every signal escalates to a runbook that exists', () => {
    for (const s of buildSignals(healthy)) {
      if (!s.runbook) continue;
      expect(runbookById(s.runbook), `signal ${s.id} → unknown runbook ${s.runbook}`).toBeTruthy();
    }
  });

  it('every runbook signal id is a real signal', () => {
    const ids = new Set(buildSignals(healthy).map(s => s.id));
    const orphans = [];
    for (const rb of RUNBOOKS) for (const sig of rb.signals) if (!ids.has(sig)) orphans.push(`${rb.id}:${sig}`);
    expect(orphans).toEqual([]);
  });

  it('a fully healthy platform produces no bad signal', () => {
    expect(buildSignals(healthy).filter(s => s.state === 'bad')).toEqual([]);
  });
});

describe('health thresholds', () => {
  // Raid window = Sun/Wed/Thu 19:30 ET → 00:30 ET. 2026-08-02 is a Sunday.
  const inWin  = new Date('2026-08-03T01:00:00Z');   // Sun 21:00 ET
  const outWin = new Date('2026-08-02T14:00:00Z');   // Sun 10:00 ET

  it('knows the raid window', () => {
    expect(inRaidWindow(inWin)).toBe(true);
    expect(inRaidWindow(outWin)).toBe(false);
    // Post-midnight tail of Sunday's raid = Monday 00:15 ET.
    expect(inRaidWindow(new Date('2026-08-03T04:15:00Z'))).toBe(true);
    // Monday 01:00 ET is past the tail.
    expect(inRaidWindow(new Date('2026-08-03T05:00:00Z'))).toBe(false);
  });

  function facts(over) {
    return {
      lastUploadIso: null, activeChars15m: 0, lastChatIso: null,
      lastEncounterIso: null, encountersToday: 0, lastLiveStateIso: null,
      errorUploaders: 0, topErrorCode: null, agentVersions: [], versionFloor: null,
      backfillPending: 0, maxQueuePending: 0, enabledTriggers: 0,
      deadAnchoredTriggers: 0, driftCount: 0, oldestDriftDays: null, site: null,
      ...over,
    };
  }
  const find = (sigs, id) => sigs.find(s => s.id === id);

  it('downgrades stale freshness to "quiet" outside the raid window', () => {
    const old = new Date(outWin.getTime() - 3 * 3600_000).toISOString();
    const sigs = buildSignals(facts({ now: outWin, lastChatIso: old, lastUploadIso: old }));
    expect(find(sigs, 'chatRelay').state).toBe('quiet');
  });

  it('flags stale chat as bad INSIDE the window, and names the 2026-07-19 shape when ingest is fresh', () => {
    const sigs = buildSignals(facts({
      now: inWin,
      lastChatIso: new Date(inWin.getTime() - 3 * 3600_000).toISOString(),
      lastUploadIso: new Date(inWin.getTime() - 60_000).toISOString(),
      activeChars15m: 30,
    }));
    const chat = find(sigs, 'chatRelay');
    expect(chat.state).toBe('bad');
    expect(chat.detail).toMatch(/2026-07-19/);
    expect(chat.runbook).toBe('rb-05');
  });

  it('treats any ^-anchored enabled trigger as bad, pointing at RB-01', () => {
    const sigs = buildSignals(facts({ now: outWin, enabledTriggers: 101, deadAnchoredTriggers: 29 }));
    const t = find(sigs, 'triggerHealth');
    expect(t.state).toBe('bad');
    expect(t.value).toBe('29 of 101 dead');
    expect(t.runbook).toBe('rb-01');
  });

  it('escalates an override that has been set for a week', () => {
    expect(find(buildSignals(facts({ now: outWin, driftCount: 1, oldestDriftDays: 2 })), 'drift').state).toBe('warn');
    expect(find(buildSignals(facts({ now: outWin, driftCount: 1, oldestDriftDays: 14 })), 'drift').state).toBe('bad');
  });

  it('calls out 401/403 as the auth-blip signature', () => {
    const sigs = buildSignals(facts({ now: outWin, errorUploaders: 5, topErrorCode: 401 }));
    expect(find(sigs, 'uploadErrors').state).toBe('bad');
    expect(find(sigs, 'uploadErrors').detail).toMatch(/auth-blip/);
  });

  it('reports agents below the version floor as bad', () => {
    const sigs = buildSignals(facts({
      now: outWin, versionFloor: 30440,
      agentVersions: [{ version: '3.4.43', chars: 2 }, { version: '3.4.22', chars: 5 }],
    }));
    expect(find(sigs, 'fleetVersions').state).toBe('bad');
    expect(find(sigs, 'fleetVersions').detail).toMatch(/5 character/);
  });

  it('sorts the worst signal first', () => {
    const sigs = sortSignals(buildSignals(facts({ now: outWin, deadAnchoredTriggers: 1, enabledTriggers: 2 })));
    expect(sigs[0].state).toBe('bad');
  });

  it('verNum matches the bot version-floor formula', () => {
    expect(verNum('3.3.85')).toBe(30385);
    expect(verNum('3.4.43')).toBe(30443);
    expect(verNum('(unknown)')).toBe(null);
    expect(verNum(null)).toBe(null);
  });
});

describe('control-plane drift classification', () => {
  it('separates control keys from intentional config', () => {
    for (const k of ['flag_agent_kill', 'flag_shed_live_state', 'dedup_chat', 'min_agent_ver_num',
                     'budget_encounter_per_min', 'reporter_pin_chat']) {
      expect(isControlKey(k), k).toBe(true);
    }
    for (const k of ['ext_hurt_pct', 'offheal_hurt_pct', 'ch_go_display_sec',
                     'hide_main_names', 'agent_release_ref_beta', 'flag_set_at_dedup_chat']) {
      expect(isControlKey(k), k).toBe(false);
    }
  });

  it('reads the real production tuning shape as exactly one override', () => {
    // Live value on 2026-08-02: the 2026-07-19 chat-blackout mitigation, still on.
    const drift = driftFromTuning({ dedup_chat: 0, hide_main_names: 'Tildias,Serreth' });
    expect(drift.map(d => d.key)).toEqual(['dedup_chat']);
    expect(drift[0].meaning).toMatch(/2026-07-19/);
    expect(drift[0].runbook).toBe('rb-05');
    expect(drift[0].clearable).toBe(true);
  });

  it('puts high-blast-radius overrides first so a fleet pause is never below the fold', () => {
    const drift = driftFromTuning({ dedup_roster: 1, flag_agent_kill: 1, flag_shed_casting: 1 });
    expect(drift[0].key).toBe('flag_agent_kill');
    expect(drift[0].danger).toBe(true);
  });

  it('describes an unknown shed flag generically rather than dropping it', () => {
    const drift = driftFromTuning({ flag_shed_something_new: 1 });
    expect(drift).toHaveLength(1);
    expect(drift[0].meaning).toMatch(/being DROPPED/);
    expect(drift[0].runbook).toBe('rb-03');
  });

  it('ages an override from its flag_set_at stamp, and says "unknown" without one', () => {
    const now = new Date('2026-08-02T00:00:00Z');
    const tuning = {
      dedup_chat: 0,
      flag_set_at_dedup_chat: '2026-07-19T00:00:00Z',
      flag_shed_casting: 1,
    };
    const drift = driftFromTuning(tuning);
    const ages = driftAges(tuning, drift, now);
    expect(ages.dedup_chat).toBe(14);
    expect(ages.flag_shed_casting).toBe(null);
  });
});
