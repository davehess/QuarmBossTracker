// test/roll-card-ours.test.js — the 🎲 Rolled loot card of an off-night event: our raiders' rolls only, one card.
//
// Two bugs found 2026-10-27:
//   1. Agents capture any /random they can see, so a night spent in a hub zone put OTHER guilds' loot rolls on the
//      card (14 of 21 rollers last seen in one other guild, 1 of ours). roll_sets.zone is NULL, so the rollers are
//      the only handle: a set stays when at least half its distinct rollers are ours. Fail-open on a failed read.
//   2. The card posted twice (8:15 and 8:25 PM): its message id lives in state.json, which a Railway deploy wipes.
//      With no stored id the thread's recent messages are searched for the bot's own card.
//
// Names are invented. Run: npx vitest run test/roll-card-ours.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, stripJs, BOT_INDEX } from './_source-slice.js';

const requireBot = createRequire(BOT_INDEX);
const { rollerNames, keepOurRollSets, loadOurRollers, findRollCardMessage, buildRollSessions } = requireBot('./utils/rollLoot');

const T0 = Date.parse('2026-10-27T23:00:00Z');
const set = (to, names, item = 'Cloak of Flames') => ({
  roll_from: 0, roll_to: to, item, qty: 1, zone: null,
  started_at: new Date(T0 + to * 1000).toISOString(), last_at: new Date(T0 + to * 1000).toISOString(),
  rolls: names.map((name, i) => ({ name, value: 90 - i, at: new Date(T0 + to * 1000).toISOString(), reroll: false })),
});
const OURS = new Set(['aldenmar', 'brackwyn', 'corvale']);

describe('keepOurRollSets — the majority rule', () => {
  it('keeps an all-ours set and drops an all-foreign set', () => {
    const mine = set(100, ['Aldenmar', 'Brackwyn']);
    const theirs = set(200, ['Zarrin', 'Nyssara', 'Rethlan']);
    const { rows, hidden } = keepOurRollSets([mine, theirs], OURS);
    expect(rows).toEqual([mine]);
    expect(hidden).toBe(1);
  });

  it('keeps a mixed set when exactly half are ours, drops it when under half', () => {
    const half = set(100, ['Aldenmar', 'Zarrin']);
    const under = set(200, ['Aldenmar', 'Zarrin', 'Nyssara']);
    const { rows } = keepOurRollSets([half, under], OURS);
    expect(rows).toEqual([half]);
  });

  it('counts a roller once however many times they rolled, and ignores name case', () => {
    const s = set(100, ['ALDENMAR', 'aldenmar', 'Zarrin']);   // 1 distinct of ours, 1 foreign → half → kept
    expect(keepOurRollSets([s], OURS).rows).toEqual([s]);
  });

  it('accepts a predicate as well as a Set', () => {
    const { rows } = keepOurRollSets([set(100, ['Aldenmar']), set(200, ['Zarrin'])], n => n === 'aldenmar');
    expect(rows).toHaveLength(1);
  });

  it('fails open: no membership, or an empty one, shows every set', () => {
    const all = [set(100, ['Zarrin']), set(200, ['Aldenmar'])];
    for (const none of [null, undefined, new Set()]) {
      const { rows, hidden } = keepOurRollSets(all, none);
      expect(rows).toEqual(all);
      expect(hidden).toBe(0);
    }
  });

  it('a row with no rollers is kept (nothing in it is foreign)', () => {
    const empty = set(100, []);
    expect(keepOurRollSets([empty], OURS).rows).toEqual([empty]);
  });

  it('the surviving rows feed buildRollSessions unchanged', () => {
    const { rows } = keepOurRollSets([set(100, ['Aldenmar', 'Brackwyn']), set(200, ['Zarrin', 'Nyssara'])], OURS);
    expect(buildRollSessions(rows)).toHaveLength(1);
  });
});

describe('rollerNames', () => {
  it('collects distinct names across rows', () => {
    expect([...rollerNames([set(1, ['Aldenmar', 'Zarrin']), set(2, ['Zarrin'])])].sort()).toEqual(['Aldenmar', 'Zarrin']);
  });
});

describe('loadOurRollers — the one batched membership read', () => {
  const fake = ({ chars = [], who = [], charsFail = false, whoFail = false } = {}) => {
    const calls = [];
    return {
      calls,
      select: async (table, qs) => { calls.push({ table, qs }); return charsFail ? null : chars; },
      rpc: async (fn, args) => { calls.push({ fn, args }); return whoFail ? null : who; },
    };
  };
  const opts = { guildId: 'wolfpack', ourGuild: 'Wolf Pack' };

  it('ours = a characters row with a discord_id OR best-known /who guild equal to ours (one read each)', async () => {
    const sb = fake({
      chars: [{ name: 'Aldenmar' }],
      who: [
        { character_key: 'brackwyn', guild_name: 'wolf pack ' },   // our guild, case/space tolerant
        { character_key: 'zarrin', guild_name: 'Other Guild' },
      ],
    });
    const ours = await loadOurRollers(['Aldenmar', 'Brackwyn', 'Zarrin'], sb, opts);
    expect([...ours].sort()).toEqual(['aldenmar', 'brackwyn']);
    expect(sb.calls).toHaveLength(2);
    expect(sb.calls[0].qs).toMatch(/discord_id=not\.is\.null/);
    expect(sb.calls[0].qs).toMatch(/name=in\.\(Aldenmar,Brackwyn,Zarrin\)/);
    expect(sb.calls[1].args.p_keys).toEqual(['aldenmar', 'brackwyn', 'zarrin']);
  });

  it('a failed read, an empty answer, or a throwing client all return null (fail-open)', async () => {
    expect(await loadOurRollers(['Aldenmar'], fake({ charsFail: true }), opts)).toBeNull();
    expect(await loadOurRollers(['Aldenmar'], fake({ whoFail: true }), opts)).toBeNull();
    expect(await loadOurRollers(['Aldenmar'], fake(), opts)).toBeNull();                       // read fine, nobody ours
    expect(await loadOurRollers(['Aldenmar'], { select: async () => { throw new Error('x'); }, rpc: async () => [] }, opts)).toBeNull();
    expect(await loadOurRollers([], fake(), opts)).toBeNull();
  });

  it('drops names that are not plain letters before building the query', async () => {
    const sb = fake({ chars: [{ name: 'Aldenmar' }] });
    await loadOurRollers(['Aldenmar', 'bad),name'], sb, opts);
    expect(sb.calls[0].qs).not.toMatch(/bad/);
  });
});

describe('findRollCardMessage — the thread is the memory of the card', () => {
  const BOT = 'bot1';
  const msg = (id, ts, title, author = BOT) => ({ id, createdTimestamp: ts, author: { id: author }, embeds: title ? [{ title }] : [] });

  it('returns the newest of the bot’s own rolled-loot cards', () => {
    const found = findRollCardMessage([
      msg('a', 100, '🎲 Rolled loot — Night'), msg('b', 300, '🎲 Rolled loot — Night'), msg('c', 200, '🎲 Rolled loot — Night'),
    ], BOT);
    expect(found.id).toBe('b');
  });

  it('ignores other authors, other embeds, plain messages, and an unknown bot id', () => {
    const list = [
      msg('x', 500, '🎲 Rolled loot — Night', 'someone-else'),
      msg('y', 400, '📊 Parse — Boss'),
      msg('z', 300, null),
    ];
    expect(findRollCardMessage(list, BOT)).toBeNull();
    expect(findRollCardMessage([msg('a', 1, '🎲 Rolled loot — Night')], undefined)).toBeNull();
    expect(findRollCardMessage(null, BOT)).toBeNull();
  });
});

// ── the real _refreshEventRollCardNow, sliced out of index.js and run ──────────────────────────────────
const SRC = readSource(BOT_INDEX);
function sliceFunction(name) {
  const m = new RegExp('^(?:async )?function ' + name + '\\(', 'm').exec(SRC);
  if (!m) throw new Error('slice: function not found: ' + name);
  return SRC.slice(m.index, SRC.indexOf('\n}\n', m.index) + 3);
}
function loadRefresh(injected) {
  const inj = Object.keys(injected);
  // eslint-disable-next-line no-new-func
  return new Function(...inj, sliceFunction('_refreshEventRollCardNow') + '\nreturn _refreshEventRollCardNow;')(...inj.map(k => injected[k]));
}

describe('_refreshEventRollCardNow (the shipped function)', () => {
  const BOT = 'bot1';
  const NOW = Date.now();
  const rows = [
    { ...set(100, ['Aldenmar', 'Brackwyn', 'Corvale']), started_at: new Date(NOW - 3600_000).toISOString(), last_at: new Date(NOW - 3600_000).toISOString() },
    { ...set(200, ['Zarrin', 'Nyssara', 'Rethlan', 'Aldenmar'], 'Silken Mantle'), started_at: new Date(NOW - 3000_000).toISOString(), last_at: new Date(NOW - 3000_000).toISOString() },
    { ...set(300, ['Zarrin', 'Nyssara'], 'Gem of Ire'), started_at: new Date(NOW - 2400_000).toISOString(), last_at: new Date(NOW - 2400_000).toISOString() },
  ];
  const supabase = ({ whoFail = false } = {}) => ({
    isEnabled: () => true,
    selectAllPaged: async (table) => (table === 'roll_sets' ? rows : []),
    select: async (table) => (table === 'characters' ? [{ name: 'Aldenmar' }, { name: 'Brackwyn' }, { name: 'Corvale' }] : []),
    rpc: async () => (whoFail ? null : []),
  });
  const run = async ({ thread, sb = supabase(), storedId = null }) => {
    const stored = [];
    const refresh = loadRefresh({
      client: { user: { id: BOT } },
      require: (p) => {
        if (p === './utils/supabase') return sb;
        if (p === './utils/raidNight') return { getRaidNightTarget: async () => ({ thread, kind: 'event', event: { title: 'Test Event', startMs: NOW - 5 * 3600_000, window: { fromMs: NOW - 5 * 3600_000 } } }) };
        if (p === './utils/state') return { getEventRollCardId: () => storedId, setEventRollCardId: (t, id) => stored.push(id) };
        if (p === './utils/softReserve') return { loadSoftReserve: async () => null, makeReserversFor: () => null, rankWithReservers: requireBot('./utils/softReserve').rankWithReservers };
        return requireBot(p);
      },
    });
    await refresh();
    return stored;
  };

  it('hides the other guild’s sets and says so in the footer', async () => {
    const posted = [];
    const thread = { id: 't1', messages: { fetch: async () => { throw new Error('none'); } }, send: async (m) => { posted.push(m); return { id: 'new' }; } };
    await run({ thread });
    const card = posted[0].embeds[0].data;
    expect(card.description).toMatch(/Cloak of Flames/);
    expect(card.description).not.toMatch(/Gem of Ire/);
    expect(card.description).not.toMatch(/Silken Mantle/);      // 1 of 4 rollers is ours — under half
    expect(card.footer.text).toMatch(/^1 roll captured · 2 other-guild rolls hidden/);
  });

  it('a failed membership read shows every set and no “hidden” note', async () => {
    const posted = [];
    const sb = supabase();
    sb.select = async () => null;
    const thread = { id: 't1', messages: { fetch: async () => { throw new Error('none'); } }, send: async (m) => { posted.push(m); return { id: 'new' }; } };
    await run({ thread, sb });
    expect(posted[0].embeds[0].data.footer.text).toMatch(/^3 rolls captured/);
    expect(posted[0].embeds[0].data.footer.text).not.toMatch(/hidden/);
  });

  it('no stored id (deploy wiped state.json): edits the newest card already in the thread, posts nothing', async () => {
    const edits = [], posted = [];
    const card = (id, ts) => ({ id, createdTimestamp: ts, author: { id: BOT }, embeds: [{ title: '🎲 Rolled loot — Test Event' }], edit: async (b) => { edits.push({ id, b }); } });
    const recent = [card('old', 100), card('newest', 200), { id: 'chat', createdTimestamp: 300, author: { id: 'u' }, embeds: [] }];
    const asked = [];
    const thread = {
      id: 't1',
      messages: { fetch: async (arg) => { asked.push(arg); return { values: () => recent.values() }; } },
      send: async (m) => { posted.push(m); return { id: 'new' }; },
    };
    const stored = await run({ thread });
    expect(posted).toHaveLength(0);
    expect(edits.map(e => e.id)).toEqual(['newest']);
    expect(stored).toEqual(['newest']);              // remembered for the next refresh
    expect(asked[0]).toEqual({ limit: 50 });
  });

  it('no stored id and no card in the thread: posts one', async () => {
    const posted = [];
    const thread = { id: 't1', messages: { fetch: async () => ({ values: () => [].values() }) }, send: async (m) => { posted.push(m); return { id: 'new' }; } };
    const stored = await run({ thread });
    expect(posted).toHaveLength(1);
    expect(stored).toEqual(['new']);
  });
});

describe('source guards (comments stripped)', () => {
  const body = stripJs(sliceFunction('_refreshEventRollCardNow'));
  it('the refresh filters through keepOurRollSets and looks in the thread before posting', () => {
    expect(body).toMatch(/keepOurRollSets\(/);
    expect(body).toMatch(/messages\.fetch\(\{ limit: 50 \}\)/);
    expect(body.indexOf('findRollCardMessage(')).toBeLessThan(body.indexOf('thread.send('));
  });
  it('an expected condition logs nothing to stderr', () => {
    expect(body).not.toMatch(/console\.(warn|error)/);
  });
});
