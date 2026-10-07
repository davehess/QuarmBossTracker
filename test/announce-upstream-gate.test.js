// The eight one-shot "upstream" announcers (Harmonic Howl, Mimic 2.7.1 / 2.7.8, the opt-in-logs #pvp note,
// the film making-of, the Vex Thal celebration and its film, the inventory split) post Wolf Pack's own history
// and are latched only by a bot_kv row, finding their channel by NAME. A new guild with an empty bot_kv and a
// channel called #raid-chat would have got "Congrats Wolf Pack on the last Aten Ha Ra of Luclin" on its first
// boot (guild kit, the guild lead, 2026-10-07). So each one is only SCHEDULED when
// ANNOUNCE_UPSTREAM_ONESHOTS says so — or, when that is unset, when the deployment has no guild/config.json
// (Wolf Pack's production sets everything in env and has none, so nothing changes there).
//
// Three layers, each run against the real source:
//   1. the helper, evaluated, over its whole truth table (env wins → config file → on);
//   2. every _announce*Once function is declared exactly as many times as we pin, and every call site of
//      each sits under a `_oneshotGate('<tag>')` guard (text, comments stripped);
//   3. each guarded scheduling statement, evaluated with fake timers: gate off schedules nothing, gate on
//      schedules something.
//
// Run: npx vitest run test/announce-upstream-gate.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock, stripJs } from './_source-slice.js';

const bot = readSource(path.join(ROOT, 'index.js'));
const src = stripJs(bot);

// ── 1. the helper ────────────────────────────────────────────────────────────
const helperBlock = sliceBlock(bot, 'function _upstreamOneshotsEnabledWith(', '  return false;\n}');

function load({ env = {}, config = false } = {}) {
  const logs = [];
  const checked = [];
  const fakes = {
    fs: { existsSync: (p) => { checked.push(p); return config; } },
    path: path.posix,
  };
  // eslint-disable-next-line no-new-func
  const api = new Function('process', 'require', '__dirname', 'console',
    helperBlock + '\nreturn { _upstreamOneshotsEnabledWith, _upstreamOneshotsEnabled, _oneshotGate };')(
    { env }, (m) => fakes[m], '/srv/bot', { log: (...a) => logs.push(a.join(' ')) });
  return { ...api, logs, checked };
}

describe('_upstreamOneshotsEnabledWith: the decision', () => {
  const { _upstreamOneshotsEnabledWith: decide } = load();

  it('an explicit setting wins over the config file, either way', () => {
    for (const on of ['1', 'true', 'yes', 'TRUE', ' Yes ', 'True']) {
      expect(decide(on, true)).toBe(true);
      expect(decide(on, false)).toBe(true);
    }
    for (const off of ['0', 'false', 'no', 'off', 'FALSE', ' 0 ', 'garbage', '2']) {
      expect(decide(off, true)).toBe(false);
      expect(decide(off, false)).toBe(false);
    }
  });

  it('unset (or blank) follows the config file: none → on, present → off', () => {
    for (const unset of [undefined, null, '', '   ']) {
      expect(decide(unset, false)).toBe(true);
      expect(decide(unset, true)).toBe(false);
    }
  });
});

describe('_upstreamOneshotsEnabled: reads the real inputs', () => {
  it('Wolf Pack production (nothing in env, no guild/config.json) stays on', () => {
    const { _upstreamOneshotsEnabled, checked } = load();
    expect(_upstreamOneshotsEnabled()).toBe(true);
    expect(checked).toEqual(['/srv/bot/guild/config.json']);
  });

  it('a deployment that committed guild/config.json is a tenant: off', () => {
    expect(load({ config: true })._upstreamOneshotsEnabled()).toBe(false);
  });

  it('ANNOUNCE_UPSTREAM_ONESHOTS overrides the file in both directions', () => {
    expect(load({ env: { ANNOUNCE_UPSTREAM_ONESHOTS: '1' }, config: true })._upstreamOneshotsEnabled()).toBe(true);
    expect(load({ env: { ANNOUNCE_UPSTREAM_ONESHOTS: 'true' }, config: true })._upstreamOneshotsEnabled()).toBe(true);
    expect(load({ env: { ANNOUNCE_UPSTREAM_ONESHOTS: '0' }, config: false })._upstreamOneshotsEnabled()).toBe(false);
    expect(load({ env: { ANNOUNCE_UPSTREAM_ONESHOTS: 'false' }, config: false })._upstreamOneshotsEnabled()).toBe(false);
  });
});

describe('_oneshotGate: the call every scheduling site makes', () => {
  it('on: true, and silent', () => {
    const { _oneshotGate, logs } = load();
    expect(_oneshotGate('howl-announce')).toBe(true);
    expect(logs).toEqual([]);
  });

  it('off: false, with ONE log line per tag however often it is asked (the Vex Thal site asks on every kill)', () => {
    const { _oneshotGate, logs } = load({ env: { ANNOUNCE_UPSTREAM_ONESHOTS: '0' } });
    for (let i = 0; i < 5; i++) expect(_oneshotGate('vt-cleared')).toBe(false);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('[vt-cleared]');
    expect(logs[0]).toContain('ANNOUNCE_UPSTREAM_ONESHOTS');
    expect(_oneshotGate('howl-announce')).toBe(false);
    expect(logs).toHaveLength(2);
    expect(logs[1]).toContain('[howl-announce]');
  });
});

// ── 2. every announcer is gated at its call sites ────────────────────────────
const NAMES = [
  '_announceHarmonicHowlOnce', '_announceMimic271Once', '_announceMimic278Once', '_announceOptinPvpOnce',
  '_announceFilmMakingOnce', '_announceVexThalClearedOnce', '_announceVexThalFilmOnce', '_announceInventorySplitOnce',
];

// The nearest line at or above the call that is either at column 0 (the statement's own first line) or
// already carries the gate — i.e. the line that opens the construct the call lives in.
function openingLine(idx) {
  const lines = src.slice(0, idx).split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes('_oneshotGate(') || /^\S/.test(lines[i])) return lines[i];
  }
  return null;
}

describe('every one-shot announcer is gated', () => {
  const declared = [...src.matchAll(/^(?:async )?function (_announce\w*Once)\(/gm)].map(m => m[1]);

  it('there are exactly eight _announce*Once functions (a ninth must come with a gate, then bump this)', () => {
    expect(declared).toHaveLength(8);
    expect([...declared].sort()).toEqual([...NAMES].sort());
  });

  it('every call site opens under `if (_oneshotGate(...))`', () => {
    for (const name of NAMES) {
      const re = new RegExp('(?<!function )' + name + '\\(', 'g');
      const sites = [...src.matchAll(re)];
      expect(sites.length, `${name} is never called`).toBeGreaterThan(0);
      sites.forEach((m, n) => {
        expect(openingLine(m.index), `${name} call #${n + 1} is not under a gate`)
          .toMatch(/^\s*if \(_oneshotGate\('[a-z0-9-]+'\)\)/);
      });
    }
  });

  it('eight gates, one distinct tag each', () => {
    const tags = [...src.matchAll(/_oneshotGate\('([^']+)'\)/g)].map(m => m[1]);
    expect(tags).toHaveLength(8);
    expect(new Set(tags).size).toBe(8);
  });
});

// ── 3. the guarded statements, run against fake timers ───────────────────────
const TAGS = [...src.matchAll(/_oneshotGate\('([^']+)'\)/g)].map(m => m[1]);

// The statement a gate guards: the rest of its line, or — when the line ends in `{` — its whole block (the
// block's closing brace is the first column-0 `}` after it).
function guarded(tag) {
  const start = src.indexOf(`if (_oneshotGate('${tag}'))`);
  if (start < 0) throw new Error('no gate for ' + tag);
  const eol = src.indexOf('\n', start);
  if (!src.slice(start, eol).endsWith('{')) return src.slice(start, eol);
  return src.slice(start, src.indexOf('\n}\n', start) + 2);
}

function run(tag, gateAnswer) {
  const asked = [], timers = [], jobs = [];
  // eslint-disable-next-line no-new-func
  new Function('_oneshotGate', 'setTimeout', 'setInterval', 'clearInterval', 'console', 'discordJobs', 'kill', ...NAMES,
    guarded(tag))(
    (t) => { asked.push(t); return gateAnswer; },
    (fn, ms) => { timers.push(['timeout', ms]); return {}; },
    (fn, ms) => { timers.push(['interval', ms]); return {}; },
    () => {}, { log() {}, warn() {} }, jobs, { boss: 'Aten Ha Ra' }, ...NAMES.map(() => async () => 'x'));
  return { asked, scheduled: timers.length + jobs.length };
}

describe('the gated scheduling statements', () => {
  it('cover all eight tags', () => {
    expect(TAGS).toHaveLength(8);
  });

  for (const tag of TAGS) {
    it(`${tag}: gate off schedules nothing, gate on schedules it`, () => {
      const off = run(tag, false);
      expect(off.asked).toEqual([tag]);
      expect(off.scheduled).toBe(0);
      const on = run(tag, true);
      expect(on.asked).toEqual([tag]);
      expect(on.scheduled).toBeGreaterThan(0);
    });
  }
});
