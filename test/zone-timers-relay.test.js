// test/zone-timers-relay.test.js — the bot half of "the timer follows you in", end to end through the
// REAL relay POST and recent-fires builder (index.js), with the ledger from utils/zoneTimers.js.
//
// The guild lead, 2026-10-08: "if one person had the stampede window it should go to anyone currently in
// the zone when it opens." A relayed fire of a trigger tagged zone-timer opens a window; a listener who
// stands in that zone later gets it on the recent-fires payload, after the ring's own fires.
//
// Run: npx vitest run test/zone-timers-relay.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, BOT_INDEX } from './_source-slice.js';

const requireBot = createRequire(BOT_INDEX);
const SRC = readSource(BOT_INDEX);
const zoneTimersMod = requireBot('./utils/zoneTimers.js');
const groupScope = requireBot('./utils/groupScope.js');

function sliceFunction(src, name) {
  const m = new RegExp('^(?:async )?function ' + name + '\\(', 'm').exec(src);
  if (!m) throw new Error('slice: function not found: ' + name);
  const end = src.indexOf('\n}\n', m.index);
  return src.slice(m.index, end + 3);
}
function loadBot(names, injected) {
  const inj = Object.keys(injected);
  const body = names.map(n => sliceFunction(SRC, n)).join('\n') + `\nreturn { ${names.join(', ')} };`;
  // eslint-disable-next-line no-new-func
  return new Function(...inj, body)(...inj.map(n => injected[n]));
}
const mkRes = () => { const r = { status: null, body: null, writeHead(s) { r.status = s; }, end(b) { r.body = b; } }; return r; };

const TACTICS = 'Drunder, the Fortress of Zek';
const TAGGED = new Map([
  ['opens', { id: 'opens', name: 'Tactics: stampede window opens', timer_duration_sec: 2400, cooldown_seconds: 120, end_text: 'Stampede possible now', source_pack: 'potactics-stampede' }],
  ['by',    { id: 'by',    name: 'Tactics: stampede by',           timer_duration_sec: 7200, cooldown_seconds: 120, end_text: 'Stampede is overdue',   source_pack: 'potactics-stampede' }],
]);

function rig({ zonesOf = {}, tagged = TAGGED } = {}) {
  let current = null;
  const ledger = zoneTimersMod.create({ supabase: null, log: { warn() {} } });
  const triggerRelay = { entries: [], nextId: 1 };
  const zoneSet = (acct) => new Set(zonesOf[acct] || []);
  const fns = loadBot(['_handleTriggerRelayPost', '_recentFiresFor', '_relayScopeKeep'], {
    mimicLink: { requireAgentAuth: async () => current },
    _triggerRelay: triggerRelay, _triggerRate: new Map(), TRIGGER_RATE_WINDOW_MS: 1000, TRIGGER_RATE_MAX: 100,
    TRIGGER_RELAY_DEDUP_WINDOW_MS: 8000, TRIGGER_RELAY_MAX_ENTRIES: 500,
    _senderClockOffsetMs: () => 0,
    _requesterZones: async (acct) => zoneSet(acct),
    _senderStamp: async () => ({ origin_raid: null, origin_group: null }),
    _groupScope: groupScope,
    _lootPostedSince: () => ({ loot_posted: [], loot_next_id: 0 }),
    _zoneTimersMod: zoneTimersMod,
    _zoneTimers: () => ledger,
    _zoneTimerTriggerMap: async () => tagged,
    _requesterZonesCached: (acct) => zoneSet(acct),
    _liveZoneMap: async () => new Map(), _charDiscordMap: async () => new Map(),
  });
  return {
    entries: triggerRelay.entries, ledger,
    async post(acct, fires) {
      current = { discord_id: acct };
      const req = { async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ fires })); } };
      const res = mkRes();
      await fns._handleTriggerRelayPost(req, res);
      expect(res.status).toBe(200);
    },
    // scope: null → no scope (raid-wide); 'zone' → the zone rule with the listener's resolved zones;
    // 'raid' → raid mode, where the scope carries no zones and the cached read places the listener.
    poll(acct, mode = 'zone', sinceId = 0) {
      current = { discord_id: acct };
      const scope = mode === 'raid' ? { inRaidWindow: false, inRaid: true, requesterZones: null }
        : { inRaidWindow: false, inRaid: false, requesterZones: zoneSet(acct) };
      return fns._recentFiresFor(current, sinceId, 0, scope).fires;
    },
  };
}
const emote = (name, id, dur, at = Date.now()) => ({ name, key: name + ':{}', actions: [], timer_duration_sec: dur, trigger_id: id, cooldown_seconds: 120, fired_at_ms: at });
const STAMPEDE = (at) => [emote('Tactics: stampede window opens', 'opens', 2400, at), emote('Tactics: stampede by', 'by', 7200, at)];

describe('the relay POST', () => {
  it('a tagged trigger keeps its 2-hour countdown; an untagged one is still clamped to an hour', async () => {
    const r = rig({ zonesOf: { obs: [TACTICS] } });
    await r.post('obs', [...STAMPEDE(), emote('Some other long timer', 'other', 7200)]);
    const dur = Object.fromEntries(r.entries.map(e => [e.trigger_id, e.timer_duration_sec]));
    expect(dur).toEqual({ opens: 2400, by: 7200, other: 3600 });
  });

  it('opens ONE window for the pack, in the sender\'s zone, from both rows', async () => {
    const r = rig({ zonesOf: { obs: [TACTICS] } });
    await r.post('obs', STAMPEDE());
    const snap = r.ledger.snapshot();
    expect(snap.windows).toHaveLength(1);
    expect(snap.windows[0].zone).toBe(TACTICS);
    expect(snap.windows[0].timers.map(t => t.trigger_id).sort()).toEqual(['by', 'opens']);
  });

  it('an untagged trigger opens nothing, and a dropped duplicate still marks its observer', async () => {
    const r = rig({ zonesOf: { obs: [TACTICS], obs2: [TACTICS] } });
    await r.post('obs', [emote('Tactics: boar stampede incoming', 'boar', 15)]);
    expect(r.ledger.hasActive()).toBe(false);
    const at = Date.now();
    await r.post('obs', STAMPEDE(at));
    await r.post('obs2', STAMPEDE(at + 2000));            // the ring drops these as duplicates
    expect(r.entries.filter(e => e.trigger_id === 'by')).toHaveLength(1);
    expect(r.poll('obs2').filter(f => f.late_join)).toEqual([]);
  });
});

describe('recent-fires', () => {
  it('a raider who zones in later is handed both countdowns, once, after the ring fires', async () => {
    const zonesOf = { obs: [TACTICS], joiner: ['Plane of Knowledge'] };
    const r = rig({ zonesOf });
    await r.post('obs', STAMPEDE(Date.now() - 5 * 60_000));
    expect(r.poll('joiner').filter(f => f.late_join)).toEqual([]);   // not in the zone yet
    zonesOf.joiner = [TACTICS];
    const fires = r.poll('joiner');
    const late = fires.filter(f => f.late_join);
    expect(late.map(f => f.trigger_id).sort()).toEqual(['by', 'opens']);
    expect(late.every(f => f.actions.length === 0)).toBe(true);
    expect(fires.slice(-late.length)).toEqual(late);                 // appended after the ring's fires
    expect(r.poll('joiner').filter(f => f.late_join)).toEqual([]);  // once
  });

  it('raid mode carries no zones in the scope — the cached zone read still places the listener', async () => {
    const r = rig({ zonesOf: { obs: [TACTICS], joiner: [TACTICS] } });
    await r.post('obs', STAMPEDE(Date.now() - 60_000));
    expect(r.poll('joiner', 'raid').filter(f => f.late_join)).toHaveLength(2);
  });

  it('the original observer is never handed their own window', async () => {
    const r = rig({ zonesOf: { obs: [TACTICS] } });
    await r.post('obs', STAMPEDE());
    expect(r.poll('obs').filter(f => f.late_join)).toEqual([]);
  });

  it('a ledger failure leaves the payload exactly as it was', async () => {
    const r = rig({ zonesOf: { obs: [TACTICS], joiner: [TACTICS] } });
    await r.post('obs', STAMPEDE());
    r.ledger.lateJoinFires = () => { throw new Error('boom'); };
    const fires = r.poll('joiner');
    expect(fires.filter(f => f.late_join)).toEqual([]);
    expect(fires.length).toBe(2);   // the ring's two relayed rows, untouched
  });
});
