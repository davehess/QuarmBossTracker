// #110 OpenDKP mirror reconciliation — REAL-IMPORT fidelity tier.
//
// Under test: the reconcile decision logic in utils/openDkpSync.js. The pure
// helpers (classifyAuditAction, lootDiffRemovals) are exercised directly; the
// reconcileRecentLoot orchestrator is driven end-to-end through an in-memory
// fake `db` + `fetchRaid` (the same dependency-injection seam the function
// exposes), so the test tracks the shipped code path: watermark read/advance,
// the audit trigger, the scoped-diff removal set, the fail-safe cap, and
// idempotency.
//
// Fixtures use the REAL shapes sampled from prod (anonymized): the audit `raw`
// is { AuditId, CognitoUser, ClientId, Timestamp, Action } with Action a bare
// label, and getRaid detail carries Items[] rows the sync's _lootRow maps.

import { describe, it, expect } from 'vitest';
import {
  classifyAuditAction,
  lootDiffRemovals,
  reconcileRecentLoot,
} from '../utils/openDkpSync.js';

// ── in-memory fake db (matches the utils/supabase.js surface reconcile uses) ──
function keyOf(r) {
  const gid = (r.game_item_id === null || r.game_item_id === undefined) ? '' : r.game_item_id;
  return `${r.raid_id}|${gid}|${r.character_name}|${r.dkp}`;
}
function makeDb(init = {}) {
  let _id = 1000;
  const state = {
    kv:     { ...(init.kv || {}) },
    loot:   (init.loot || []).map(r => ({ ...r })),
    audits: init.audits || [],
    raids:  init.raids || [],
    deletes: [],
    upserts: [],
  };
  const db = {
    isEnabled: () => true,
    async select(table, q = '') {
      if (table === 'bot_kv') {
        const m = q.match(/key=eq\.([^&]+)/);
        const key = m ? decodeURIComponent(m[1]) : null;
        const v = key ? state.kv[key] : null;
        return v ? [{ value: v }] : [];
      }
      if (table === 'opendkp_audits') {
        const m = q.match(/audit_id=gt\.(\d+)/);
        const gt = m ? Number(m[1]) : 0;
        return state.audits.filter(a => a.audit_id > gt)
          .sort((a, b) => b.audit_id - a.audit_id).slice(0, 200);
      }
      if (table === 'opendkp_raids') {
        // honor the ts=gte window when present (else full scope)
        const m = q.match(/ts=gte\.([^&]+)/);
        if (!m) return state.raids;
        const since = new Date(decodeURIComponent(m[1])).getTime();
        return state.raids.filter(r => new Date(r.ts).getTime() >= since);
      }
      if (table === 'opendkp_loot') {
        const m = q.match(/raid_id=eq\.(\d+)/);
        const rid = m ? Number(m[1]) : null;
        return state.loot.filter(r => rid == null || r.raid_id === rid).map(r => ({ ...r }));
      }
      return [];
    },
    async upsert(table, rows) {
      state.upserts.push({ table, rows });
      if (table === 'bot_kv') for (const r of rows) state.kv[r.key] = r.value;
      if (table === 'opendkp_loot') {
        for (const r of rows) {
          const hit = state.loot.find(x => keyOf(x) === keyOf(r));
          if (hit) Object.assign(hit, r);
          else state.loot.push({ id: ++_id, ...r });
        }
      }
      return rows;
    },
    async del(table, q) {
      state.deletes.push({ table, q });
      if (table === 'opendkp_loot') {
        const m = q.match(/id=in\.\(([^)]*)\)/);
        if (m) {
          const ids = m[1].split(',').map(Number);
          state.loot = state.loot.filter(r => !ids.includes(r.id));
        }
      }
      return null;
    },
    state,
  };
  return db;
}

// getRaid fake — returns { RaidId, Items:[...] } in the real wire shape.
function raidDetail(raidId, items) {
  return {
    RaidId: raidId,
    Ticks:  [],
    Items:  items.map(i => ({
      ItemName: i.name, CharacterName: i.char, Dkp: i.dkp,
      ItemId: i.gid, GameItemId: i.gid, Notes: i.notes || null,
    })),
  };
}
const AUDIT = (id, action, who = 'Talames159') => ({
  audit_id: id,
  raw: { AuditId: id, CognitoUser: who, ClientId: '8fa8662b40c12', Timestamp: '2026-07-17T03:23:41Z', Action: action },
});

// ── classifyAuditAction ──────────────────────────────────────────────────────
describe('classifyAuditAction — audit-entry → reconcile signal', () => {
  it('maps raid mutations (the only Actions that can orphan loot) to "loot"', () => {
    expect(classifyAuditAction('Raid Updated')).toBe('loot');
    expect(classifyAuditAction('Raid Deleted')).toBe('loot');
  });
  it('maps adjustment mutations to "adjustment"', () => {
    expect(classifyAuditAction('Adjustment Deleted')).toBe('adjustment');
    expect(classifyAuditAction('Adjustment Updated')).toBe('adjustment');
  });
  it('ignores auction lifecycle, bids, character + free-form officer actions', () => {
    for (const a of ['Auction Closed', 'Auction Created', 'Bid Delete', 'Auction Deleted',
      'Character Updated', 'Raid Created', 'vaporjesus approved character association', '', null, undefined]) {
      expect(classifyAuditAction(a)).toBe('ignore');
    }
  });
});

// ── lootDiffRemovals ─────────────────────────────────────────────────────────
describe('lootDiffRemovals — scoped diff removal set', () => {
  const A = { id: 1, raid_id: 100, game_item_id: 17005, item_name: 'Cloak', character_name: 'Hitya', dkp: 5 };
  const B = { id: 2, raid_id: 100, game_item_id: 4200, item_name: 'Ring', character_name: 'Bippo', dkp: 3 };
  const GHOST = { id: 3, raid_id: 100, game_item_id: 99999, item_name: 'Backpack', character_name: 'Hitya', dkp: 1 };

  it('returns local rows absent upstream (the ghosts)', () => {
    const out = lootDiffRemovals([A, B, GHOST], [A, B]);
    expect(out.map(r => r.id)).toEqual([3]);
  });
  it('empty removal set when local == upstream (idempotent no-op)', () => {
    expect(lootDiffRemovals([A, B], [A, B])).toEqual([]);
  });
  it('an EDIT (dkp changed) makes the stale key a ghost; the new key is kept', () => {
    const edited = { ...A, dkp: 9 };              // upstream now has dkp 9
    const out = lootDiffRemovals([A], [edited]);  // local still dkp 5
    expect(out.map(r => r.id)).toEqual([1]);      // stale dkp-5 row removed
  });
  it('NULL game_item_id collapses to a stable token (matches the unique index)', () => {
    const n1 = { id: 7, raid_id: 5, game_item_id: null, item_name: 'X', character_name: 'Q', dkp: 0 };
    expect(lootDiffRemovals([n1], [{ ...n1 }])).toEqual([]); // null == null → not a ghost
  });
  it('additions upstream never appear in the removal set', () => {
    expect(lootDiffRemovals([A], [A, B])).toEqual([]);
  });
});

// ── reconcileRecentLoot orchestrator ─────────────────────────────────────────
const NOW = Date.parse('2026-07-18T20:00:00Z');
const recentRaid = { raid_id: 100, name: '07/16 VT', ts: '2026-07-16T12:00:00Z' };

function seedGhostScenario() {
  return makeDb({
    kv: {},
    raids: [recentRaid],
    audits: [AUDIT(4522945, 'Raid Updated'), AUDIT(4522900, 'Auction Closed')],
    loot: [
      { id: 1, raid_id: 100, game_item_id: 17005, item_id: 17005, item_name: 'Cloak', character_name: 'Hitya', dkp: 5 },
      { id: 2, raid_id: 100, game_item_id: 4200,  item_id: 4200,  item_name: 'Ring',  character_name: 'Bippo', dkp: 3 },
      { id: 3, raid_id: 100, game_item_id: 99999, item_id: 99999, item_name: 'Backpack', character_name: 'Hitya', dkp: 1 },
    ],
  });
}
// upstream = Cloak + Ring (Backpack deleted in OpenDKP)
const upstreamAfterDelete = raidDetail(100, [
  { name: 'Cloak', char: 'Hitya', dkp: 5, gid: 17005 },
  { name: 'Ring',  char: 'Bippo', dkp: 3, gid: 4200 },
]);

describe('reconcileRecentLoot — audit-triggered scoped reconcile', () => {
  it('removes the ghost, advances the watermark, is warranted by the loot-signal audit', async () => {
    const db = seedGhostScenario();
    const res = await reconcileRecentLoot({ db, fetchRaid: async () => upstreamAfterDelete, now: NOW });

    expect(res.audit_signals).toBe(1);                 // the "Raid Updated" audit
    expect(res.loot_removed).toBe(1);                  // the Backpack ghost
    expect(res.aborted).toBe(false);
    expect(db.state.loot.map(r => r.id).sort()).toEqual([1, 2]); // Backpack gone
    // watermark advanced to the newest audit id + timestamp stamped
    expect(db.state.kv.opendkp_reconcile.lastAuditId).toBe(4522945);
    expect(db.state.kv.opendkp_reconcile.lastReconcileAt).toBe(NOW);
    // exactly one delete issued, for the ghost id
    expect(db.state.deletes).toHaveLength(1);
    expect(db.state.deletes[0].q).toContain('id=in.(3)');
  });

  it('is idempotent — a second pass with the same upstream removes nothing', async () => {
    const db = seedGhostScenario();
    await reconcileRecentLoot({ db, fetchRaid: async () => upstreamAfterDelete, now: NOW });
    db.state.deletes.length = 0;
    const res2 = await reconcileRecentLoot({ db, fetchRaid: async () => upstreamAfterDelete, now: NOW + 7 * 3600_000 });
    expect(res2.loot_removed).toBe(0);
    expect(db.state.deletes).toHaveLength(0);
    expect(db.state.loot.map(r => r.id).sort()).toEqual([1, 2]);
  });

  it('dry run reports would_remove but changes nothing + never advances the watermark', async () => {
    const db = seedGhostScenario();
    const res = await reconcileRecentLoot({ db, fetchRaid: async () => upstreamAfterDelete, now: NOW, dryRun: true });
    expect(res.would_remove).toBe(1);
    expect(res.loot_removed).toBe(0);
    expect(db.state.deletes).toHaveLength(0);
    expect(db.state.loot).toHaveLength(3);             // Backpack still present
    expect(db.state.kv.opendkp_reconcile).toBeUndefined(); // watermark untouched
  });

  it('fails SAFE — an implausibly large removal set aborts the deletes and keeps data', async () => {
    const db = seedGhostScenario();
    // upstream glitches to empty Items[] for the raid → every local row looks like a ghost
    const res = await reconcileRecentLoot({
      db, now: NOW,
      fetchRaid: async () => raidDetail(100, []),
      maxRemovalFloor: 1, maxRemovalPct: 0.25,   // cap = max(1, ceil(0.25*3)) = 1; 3 > 1 → abort
    });
    expect(res.aborted).toBe(true);
    expect(res.loot_removed).toBe(0);
    expect(db.state.deletes).toHaveLength(0);
    expect(db.state.loot).toHaveLength(3);             // nothing deleted
  });

  it('skips work when no loot-signal audit and the periodic floor has not elapsed, but still advances the audit watermark', async () => {
    const db = makeDb({
      kv: { opendkp_reconcile: { lastAuditId: 4000000, lastReconcileAt: NOW } }, // just reconciled
      raids: [recentRaid],
      audits: [AUDIT(4000050, 'Auction Closed'), AUDIT(4000040, 'Bid Delete')], // nothing loot-relevant
      loot: [{ id: 1, raid_id: 100, game_item_id: 1, item_name: 'X', character_name: 'Q', dkp: 0 }],
    });
    let fetched = 0;
    const res = await reconcileRecentLoot({ db, now: NOW + 60_000, fetchRaid: async () => { fetched++; return raidDetail(100, []); } });
    expect(res.skipped).toBe('not warranted');
    expect(fetched).toBe(0);                            // never hit OpenDKP
    expect(db.state.deletes).toHaveLength(0);
    expect(db.state.kv.opendkp_reconcile.lastAuditId).toBe(4000050); // ignorable audits still consumed
    expect(db.state.kv.opendkp_reconcile.lastReconcileAt).toBe(NOW); // floor timer NOT reset
  });

  it('a skipped upstream fetch never deletes that raid (bad-fetch guard)', async () => {
    const db = seedGhostScenario();
    const res = await reconcileRecentLoot({
      db, now: NOW,
      fetchRaid: async () => { throw new Error('HTTP 502'); },   // OpenDKP blip
    });
    expect(res.raids_skipped).toBe(1);
    expect(res.loot_removed).toBe(0);
    expect(db.state.loot).toHaveLength(3);             // untouched on a failed fetch
  });
});
