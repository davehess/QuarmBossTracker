// test/pop-short-timers.test.js — guild instance bosses on the Planes of Power board.
//
// The guild lead, 2026-10-05: "We need timers for the guild instances bosses in our
// zones. They're 3 hours but we should have the timers when they die tracked",
// then "put them on the pop board per zone". Quarm's Oct 4-5 patch notes made
// the Bastion of Thunder named 3 h (was 6) and a set of PoP named 24 h.
//
// Pinned here:
//   · bosses.json carries each boss at its patched timer, with its zone;
//   · the board shows the Eastern time a <=24 h boss is UP again ("up 9:42p")
//     and keeps the kill date for longer timers;
//   · the PoP board still fits Discord's 5-rows-of-5 limit with the new buttons;
//   · a 3 h boss stays OFF the "spawning in 24 h" card and OFF the spawn
//     alerts (BEHAVIOUR — the real checker loop is sliced out and run against
//     fakes), while still flipping back to "up" on the board;
//   · a confirmed kill records exactly timerHours, no variance.
//
// Run: npx vitest run test/pop-short-timers.test.js

import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';
import { readSource, BOT_INDEX, sliceBlock, stripJs, ROOT } from './_source-slice.js';
import path from 'node:path';

const require = createRequire(import.meta.url);
const bosses = require('../data/bosses.json');
const board = require('../utils/board');
const embeds = require('../utils/embeds');
const { isShortTimerBoss, calcNextSpawn } = require('../utils/timer');
const { shortClockInTz } = require('../utils/timezone');

const byId = (id) => bosses.find(b => b.id === id);
const H = 3_600_000;

beforeAll(() => { delete process.env.DEFAULT_TIMEZONE; });   // the guild clock is Eastern

// ── bosses.json ─────────────────────────────────────────────────────────────

const BOT_NAMED = [
  'Gaukr Sandstorm', 'Hreidar Lynhillig', 'Laef Windfall', 'Oreen Wavecrasher',
  'Auliffe Chaoswind', 'Brynju Thunderclap', 'Kuanbyr Hailstorm', 'Eindride Icestorm',
];
const DAY_BOSSES = {
  'Crypt of Decay':      ['Banord Paffa', 'Carprin Deatharn', 'Spectre of Corruption'],
  'Plane of Disease':    ['Grummus', 'Rallius Rattican', 'Aramin the Spider Guardian'],
  'Plane of Innovation': ['Manaetic Prototype IX', 'Manaetic Prototype X', 'Manaetic Prototype XI'],
  'Plane of Justice':    ['The Ancient Crawler'],
  'Plane of Nightmare':  ['Terror Matriarch', 'The Bullyrag Bat', 'Seilaen', 'Untel`Dak', 'Vhaksiz the Shade'],
  'Plane of Valor':      ['The Sleep Walker', 'Rahlgon'],
};

describe('bosses.json carries the patched timers', () => {
  it.each(BOT_NAMED)('%s is a 3 h Bastion of Thunder boss', (name) => {
    const b = bosses.find(x => x.name === name);
    expect(b, name).toBeTruthy();
    expect(b.zone).toBe('Bastion of Thunder');
    expect(b.expansion).toBe('PoP');
    expect(b.timerHours).toBe(3);
  });

  for (const [zone, names] of Object.entries(DAY_BOSSES)) {
    it.each(names)(`%s is a 24 h ${zone} boss`, (name) => {
      const b = bosses.find(x => x.name === name);
      expect(b, name).toBeTruthy();
      expect(b.zone).toBe(zone);
      expect(b.expansion).toBe('PoP');
      expect(b.timerHours).toBe(24);
    });
  }

  it('the 66 h bosses the notes left alone are still 66 h', () => {
    expect(byId('aerin_dar').timerHours).toBe(66);
    expect(byId('the_seventh_hammer').timerHours).toBe(66);
  });

  it('ids are unique and no name or nickname is shared between two bosses (new entries)', () => {
    expect(new Set(bosses.map(b => b.id)).size).toBe(bosses.length);
    const fresh = bosses.filter(b => b.timerHours === 3 || (b.expansion === 'PoP' && b.timerHours === 24));
    const owner = new Map();
    for (const b of bosses) for (const t of [b.name, ...(b.nicknames || [])].map(s => s.toLowerCase())) {
      if (!owner.has(t)) owner.set(t, new Set());
      owner.get(t).add(b.id);
    }
    for (const b of fresh) for (const t of [b.name, ...(b.nicknames || [])].map(s => s.toLowerCase())) {
      expect([...owner.get(t)], `"${t}" is claimed by more than one boss`).toEqual([b.id]);
    }
  });
});

// ── the label ───────────────────────────────────────────────────────────────

describe('shortClockInTz', () => {
  it('formats the Eastern clock as 9:42p / 12:07a, EDT and EST alike', () => {
    expect(shortClockInTz(Date.parse('2026-10-06T01:42:00Z'))).toBe('9:42p');   // EDT
    expect(shortClockInTz(Date.parse('2026-10-06T04:07:00Z'))).toBe('12:07a');  // EDT, past midnight
    expect(shortClockInTz(Date.parse('2026-12-10T02:42:00Z'))).toBe('9:42p');   // EST
    expect(shortClockInTz(Date.parse('2026-10-05T16:05:00Z'))).toBe('12:05p');  // noon hour
  });
});

describe('board button label', () => {
  const killedAt = Date.parse('2026-10-05T22:42:00Z');
  const now = killedAt + 60_000;
  const stateFor = (id, hours) => ({ [id]: { killedAt, nextSpawn: killedAt + hours * H, killedBy: 'u' } });
  const label = (id, hours, st) => board.makeBossButton(byId(id), st || stateFor(id, hours), now).data.label;

  it('a 3 h boss shows the Eastern time it is up again', () => {
    expect(label('gaukr_sandstorm', 3)).toBe('💀 Gaukr Sandstorm (up 9:42p)');
  });

  it('a 24 h boss does too', () => {
    expect(label('grummus', 24)).toBe('💀 Grummus (up 6:42p)');
  });

  it('an 18 h Classic boss does too (the rule is every timer of a day or less)', () => {
    expect(label('magi_rokyl', 18)).toBe('💀 Magi Rokyl (up 12:42p)');
  });

  it('a timer over a day keeps the kill date', () => {
    const l = label('lord_nagafen', 162);
    expect(l).toMatch(/^💀 Lord Nagafen \(\d{1,2}\/\d{1,2}\)$/);
    expect(label('grahl_strongback', 30)).toMatch(/^💀 Grahl Strongback \(\d{1,2}\/\d{1,2}\)$/);
  });

  it('a short-timer boss an officer pushed more than a day out falls back to the date', () => {
    const st = { gaukr_sandstorm: { killedAt, nextSpawn: now + 48 * H, killedBy: 'u' } };
    expect(label('gaukr_sandstorm', 3, st)).toMatch(/^💀 Gaukr Sandstorm \(\d{1,2}\/\d{1,2}\)$/);
  });

  it('a boss that is up shows no tag and stays a danger button', () => {
    const b = board.makeBossButton(byId('gaukr_sandstorm'), {}, now);
    expect(b.data.label).toBe('⚡ Gaukr Sandstorm');
    const expired = board.makeBossButton(byId('gaukr_sandstorm'),
      { gaukr_sandstorm: { killedAt, nextSpawn: now - 1, killedBy: 'u' } }, now);
    expect(expired.data.label).toBe('⚡ Gaukr Sandstorm');
  });

  it('every label fits Discord\'s 80 characters, on cooldown or not', () => {
    const st = {};
    for (const b of bosses) st[b.id] = { killedAt, nextSpawn: killedAt + (b.timerHours || 24) * H, killedBy: 'u' };
    for (const b of bosses) {
      expect(board.makeBossButton(b, st, now).data.label.length).toBeLessThanOrEqual(80);
      expect(board.makeBossButton(b, {}, now).data.label.length).toBeLessThanOrEqual(80);
    }
  });

  it('the board embed line carries the same tag as the button', () => {
    const st = stateFor('gaukr_sandstorm', 3);
    // buildExpansionPanels reads Date.now() — pin it just after the kill.
    const real = Date.now;
    Date.now = () => now;
    try {
      const panels = board.buildExpansionPanels('PoP', bosses, st);
      const fields = panels.flatMap(p => p.payload.embeds[0].data.fields || []);
      const bot = fields.find(f => f.name === '📍 Bastion of Thunder');
      expect(bot.value).toContain('💀 ~~Gaukr Sandstorm~~ (up 9:42p)');
      expect(bot.value).toContain('⚡ Hreidar Lynhillig');
    } finally { Date.now = real; }
  });
});

// ── board capacity ──────────────────────────────────────────────────────────

describe('the PoP board holds every boss', () => {
  const panels = board.buildExpansionPanels('PoP', bosses, {});
  const popBosses = bosses.filter(b => b.expansion === 'PoP');

  it('every PoP boss has a button, once', () => {
    const ids = panels.flatMap(p => p.payload.components.flatMap(r => r.components.map(c => c.data.custom_id)));
    expect(ids.length).toBe(popBosses.length);
    expect(new Set(ids).size).toBe(ids.length);
    for (const b of popBosses) expect(ids).toContain(`kill:${b.id}`);
  });

  it('no message exceeds 5 rows of 5 buttons', () => {
    for (const p of panels) {
      expect(p.payload.components.length).toBeLessThanOrEqual(5);
      for (const r of p.payload.components) expect(r.components.length).toBeLessThanOrEqual(5);
    }
  });

  it('a zone is never split across two messages', () => {
    const seen = new Map();
    panels.forEach((p, i) => {
      for (const r of p.payload.components) for (const c of r.components) {
        const b = byId(c.data.custom_id.replace('kill:', ''));
        if (seen.has(b.zone)) expect(seen.get(b.zone), b.zone).toBe(i);
        seen.set(b.zone, i);
      }
    });
  });

  it('Bastion of Thunder takes three rows (twelve bosses: the ten, plus Emmerik Skyfury and Evynd Firestorm)', () => {
    const bot = bosses.filter(b => b.zone === 'Bastion of Thunder');
    expect(bot.length).toBe(12);
    expect(Math.ceil(bot.length / 5)).toBe(3);
  });
});

// ── alerts ──────────────────────────────────────────────────────────────────

describe('isShortTimerBoss', () => {
  it('is true for 3 h and 6 h, false for everything longer or unknown', () => {
    expect(isShortTimerBoss({ timerHours: 3 })).toBe(true);
    expect(isShortTimerBoss({ timerHours: 6 })).toBe(true);
    expect(isShortTimerBoss({ timerHours: 18 })).toBe(false);
    expect(isShortTimerBoss({ timerHours: 24 })).toBe(false);
    expect(isShortTimerBoss({ timerHours: 66 })).toBe(false);
    expect(isShortTimerBoss({})).toBe(false);
    expect(isShortTimerBoss(null)).toBe(false);
  });

  it('the short ones in bosses.json are the eight Bastion of Thunder named plus the Glyphed Rune Word drops on a 6 h or shorter spawn', () => {
    // 2026-10-08, the guild lead: anyone on the Glyphed Rune Word drop list (pqdi item 29132) with a spawn cooldown
    // over 2 h goes on the board. Six of them respawn in 6 h or less (spawn2), so they are short-timer bosses too.
    const PLUS = ['Emmerik Skyfury', 'Evynd Firestorm', 'Lossenmachar', 'Calebgrothiel',
      'Neffiken, Lord of Kelek`Vor', 'Gurebk, Lord of Krendic'];
    const short = bosses.filter(isShortTimerBoss).map(b => b.name).sort();
    expect(short).toEqual([...BOT_NAMED, ...PLUS].sort());
  });
});

describe('"Spawning in the Next 24 Hours" card', () => {
  const now = Date.now();
  const st = {
    gaukr_sandstorm: { killedAt: now, nextSpawn: now + 3 * H, killedBy: 'u' },   // 3 h  — kept off
    rahlgon:         { killedAt: now, nextSpawn: now + 24 * H - 1000, killedBy: 'u' }, // 24 h — stays
    magi_rokyl:      { killedAt: now, nextSpawn: now + 18 * H, killedBy: 'u' },  // 18 h — stays
  };
  const text = (e) => JSON.stringify(e.toJSON().fields || []);

  it('lists 24 h and 18 h bosses but not a 3 h boss', () => {
    const t = text(embeds.buildSpawningTomorrowCard(bosses, st));
    expect(t).toContain('Rahlgon');
    expect(t).toContain('Magi Rokyl');
    expect(t).not.toContain('Gaukr Sandstorm');
  });

  it('Active Cooldowns still lists the 3 h boss', () => {
    expect(text(embeds.buildSummaryCard(bosses, st))).toContain('Gaukr Sandstorm');
    expect(text(embeds.buildExpansionCooldownCard('PoP', bosses, st))).toContain('Gaukr Sandstorm');
  });
});

describe('the spawn checker (real loop body, fake Discord)', () => {
  const src = readSource(BOT_INDEX);
  const fn = sliceBlock(src, 'function startSpawnChecker(', '\nasync function archiveZoneCardEntry(');
  // The per-boss loop, from its `for` to the line before the quake check.
  const body = fn.slice(fn.indexOf('for (const boss of bosses) {'), fn.indexOf('      await checkQuakeAlert(readyClient)'));

  async function run(boss, entryOffsetMs) {
    const now = Date.now();
    const calls = { sent: [], archived: [], cleared: [], boardUpdates: [] };
    const target = {
      send: async (p) => { calls.sent.push(p); return { id: 'm' + calls.sent.length }; },
      messages: { fetch: async () => ({ edit: async () => {} }) },
    };
    const env = {
      bosses: [boss], state: { [boss.id]: { killedAt: now, nextSpawn: now + entryOffsetMs, killedBy: 'u' } }, now,
      readyClient: { channels: { fetch: async () => target } }, historyThread: 'HISTORY', channelId: 'chan',
      getBossExpansion: () => 'PoP', getThreadId: () => 'thread',
      alertedSpawned: new Set(), alertedSoon: new Set(),
      archiveZoneCardEntry: async (c, b, bs, st, hist) => { calls.archived.push({ id: b.id, hist }); },
      getSpawnAlertMessageId: () => null, setSpawnAlertMessageId: () => {}, clearSpawnAlertMessageId: () => {},
      buildSpawnedEmbed: (b) => ({ kind: 'spawned', id: b.id }),
      buildSpawnAlertEmbed: (b) => ({ kind: 'soon', id: b.id }),
      clearKill: (id) => { calls.cleared.push(id); },
      postKillUpdate: async (c, ch, id) => { calls.boardUpdates.push(id); },
      isShortTimerBoss, console: { log() {}, warn() {} },
    };
    const names = Object.keys(env);
    // eslint-disable-next-line no-new-func
    const go = new Function(...names, `return (async () => { ${body} })();`);
    await go(...names.map(n => env[n]));
    return calls;
  }

  it('a 3 h boss that respawned posts nothing, but is cleared and the board refreshed', async () => {
    const c = await run(byId('gaukr_sandstorm'), -1000);
    expect(c.sent).toEqual([]);
    expect(c.cleared).toEqual(['gaukr_sandstorm']);
    expect(c.boardUpdates).toEqual(['gaukr_sandstorm']);
    expect(c.archived).toEqual([{ id: 'gaukr_sandstorm', hist: null }]);   // card edited, no Historic Kills line
  });

  it('a 3 h boss 20 minutes from respawn posts no warning', async () => {
    const c = await run(byId('gaukr_sandstorm'), 20 * 60_000);
    expect(c.sent).toEqual([]);
    expect(c.cleared).toEqual([]);
  });

  it('a 24 h boss that respawned still posts "spawned" and archives to Historic Kills', async () => {
    const c = await run(byId('rahlgon'), -1000);
    expect(c.sent.map(p => p.embeds[0].kind)).toEqual(['spawned']);
    expect(c.cleared).toEqual(['rahlgon']);
    expect(c.boardUpdates).toEqual(['rahlgon']);
    expect(c.archived).toEqual([{ id: 'rahlgon', hist: 'HISTORY' }]);
  });

  it('a 24 h boss 20 minutes from respawn still gets the 30-minute warning', async () => {
    const c = await run(byId('rahlgon'), 20 * 60_000);
    expect(c.sent.map(p => p.embeds[0].kind)).toEqual(['soon']);
  });

  it('an 18 h Classic boss keeps its warning too', async () => {
    const c = await run(byId('magi_rokyl'), 20 * 60_000);
    expect(c.sent.map(p => p.embeds[0].kind)).toEqual(['soon']);
  });
});

// ── kill recording ──────────────────────────────────────────────────────────

describe('a confirmed kill records the boss\'s own timer, exactly', () => {
  const stateSrc = readSource(path.join(ROOT, 'utils', 'state.js'));
  const recordKillSrc = sliceBlock(stateSrc, 'function recordKill(', '\n}\n');

  it('recordKill stores killedAt + timerHours with no variance', () => {
    const S = { bosses: {}, dailyKills: [] };
    // The real recordKill, with state held in memory instead of data/state.json.
    // eslint-disable-next-line no-new-func
    const rk = new Function('S', `const loadState = () => S; const saveState = () => {};\n${recordKillSrc}\nreturn recordKill;`)(S);
    const killedAt = Date.parse('2026-10-05T22:42:00Z');
    const e = rk('gaukr_sandstorm', byId('gaukr_sandstorm').timerHours, null, killedAt);
    expect(e.nextSpawn - e.killedAt).toBe(3 * H);
    expect(S.bosses.gaukr_sandstorm.nextSpawn).toBe(Date.parse('2026-10-06T01:42:00Z'));
    expect(calcNextSpawn(killedAt, 3)).toBe(Date.parse('2026-10-06T01:42:00Z'));
    const g = rk('grummus', byId('grummus').timerHours, null, killedAt);
    expect(g.nextSpawn - g.killedAt).toBe(24 * H);
  });

  it('the encounter path records matchedBoss.timerHours, and only on a confirmed kill', () => {
    const src = readSource(BOT_INDEX);
    // The timer decision moved into _decideKillDeferred (post-ack, after the kill-context verdict); the
    // confirmed-kill gate is at its call site — test/kill-context.test.js pins that half.
    const block = stripJs(sliceBlock(src, 'const _decideKillDeferred = async () => {', 'already on cooldown — parse recorded, no timer change'));
    expect(block).toMatch(/recordKill\(matchedBoss\.id, matchedBoss\.timerHours, null\)/);
    expect(block).toMatch(/!bossState \|\| !bossState\.killedAt \|\| bossState\.nextSpawn <= now/);
  });
});
