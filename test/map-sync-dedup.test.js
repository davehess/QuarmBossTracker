// POST /api/agent/map-sync stores a repeated event once (the guild lead, 2026-10-26: "if the bot restarted and during that
// timeframe i killed something it would need to collect any of those spawn id + name matches and sync them back in.
// Source is important.").
//
// The Mimic agent (4.0.24+, test/map-sync-outbox.test.js there) holds events the bot did not answer for and sends them
// again, so a repeat of an event the bot already took (it stored the batch, then restarted before it could answer) is
// normal. map_spawn_events had no unique key: the repeat was a second row, and a second "seen by" on the map.
//
// Behaviour, not text: the real POST handler is sliced out of index.js and run over a stand-in database that holds the same
// unique key the migration builds, and answers insertIgnoreDuplicates the way public.insert_ignore_duplicates does
// (`representation` = only the rows actually stored). The migration is checked as comment-stripped text, and its delete and
// its index must name the same key.
//
// Mutation-checked (2026-10-26): the plain insert restored, `representation` dropped (an all-repeat batch would be a 503),
// the 503 on a failed write removed, by_character taken out of the migration's index or its dedup delete, the dedup delete
// ordered by id desc (the NEWEST would stay) - each turns at least one test red.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { readSource, sliceBlock, stripSql, BOT_INDEX, ROOT } from './_source-slice.js';

const nodeRequire = createRequire(BOT_INDEX);
const SRC = readSource(BOT_INDEX);
const HANDLER = sliceBlock(SRC, 'async function _handleAgentMapSyncPost(req, res) {', '\n}\n');
const MIGRATION = stripSql(readSource(path.join(ROOT, 'supabase', 'migrations', '20261026160000_map_spawn_events_dedup.sql')));

// The stand-in database: the unique key the migration builds, insert_ignore_duplicates' answer, and a plain insert that must not be used.
function fakeSupabase({ fail = false, throws = false } = {}) {
  const rows = [], keys = new Set(), calls = [];
  return {
    rows, calls,
    isEnabled: () => true,
    guildId: () => 'guild-1',
    insert: async () => { throw new Error('a plain insert stores a repeat twice: use insertIgnoreDuplicates'); },
    del: async () => [],
    insertIgnoreDuplicates: async (table, batch, opts) => {
      calls.push({ table, n: batch.length, opts });
      if (throws) throw new Error('boom');
      if (fail) return null;
      const stored = [];
      for (const r of batch) {
        const k = [r.guild_id, r.zone, r.point_id, r.kind, r.spawn_id == null ? -1 : r.spawn_id, r.at, r.by_character == null ? '' : r.by_character].join('|');
        if (keys.has(k)) continue;
        keys.add(k); rows.push({ id: rows.length + 1, ...r }); stored.push(r);
      }
      return opts && opts.representation ? stored : null;   // (the real one: `null` on success without it - which the handler could not tell from a failure)
    },
  };
}

function post(db, body, who = { discord_id: '1001' }) {
  const cache = new Map([['lavastorm', { at: 0, events: [] }]]);
  const out = {};
  const req = {};
  const fakeRequire = (m) => (m === './utils/supabase' ? db : nodeRequire(m));
  // eslint-disable-next-line no-new-func
  const f = new Function('mimicLink', '_ptsReadBody', '_ptsJson', '_mapSyncGuildId', '_mapSyncCache', 'require', 'console',
    HANDLER + '\nreturn _handleAgentMapSyncPost;');
  const handler = f(
    { requireAgentAuth: async () => who },
    async () => ({ text: JSON.stringify(body) }),
    (res, status, obj) => { out.status = status; out.body = obj; },
    () => 'guild-1', cache, fakeRequire, { error() {}, warn() {} });
  return handler(req, {}).then(() => ({ ...out, cacheHasZone: cache.has('lavastorm') }));
}

const NOW = Date.now();
const ev = (over = {}) => ({ point_id: 17, kind: 'died', spawn_id: 4321, name: 'a gnoll pup', at: NOW - 60000, inst: 'pq.projectquarm.pq3.projectquarm.com:7312', ...over });
const batch = (events, over = {}) => ({ zone: 'lavastorm', character: 'Aldenmar', events, ...over });

describe('a repeated map event is stored once', () => {
  it('a first send is stored and counted', async () => {
    const db = fakeSupabase();
    const r = await post(db, batch([ev(), ev({ point_id: 18, kind: 'seen', spawn_id: null, name: null })]));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, stored: 2, duplicates: 0 });
    expect(db.rows).toHaveLength(2);
    expect(r.cacheHasZone).toBe(false);                                   // the zone's 3 s read cache is dropped, as before
    expect(db.calls).toEqual([{ table: 'map_spawn_events', n: 2, opts: { representation: true } }]);
  });

  it('the same batch sent again (the first answer was lost) adds no rows and still answers 200', async () => {
    const db = fakeSupabase();
    const b = batch([ev(), ev({ point_id: 18, at: NOW - 30000 })]);
    await post(db, b);
    const again = await post(db, b);
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ ok: true, stored: 0, duplicates: 2 });
    expect(db.rows).toHaveLength(2);
  });

  it('a batch that is part repeat, part new stores only the new', async () => {
    const db = fakeSupabase();
    await post(db, batch([ev({ at: NOW - 90000 }), ev({ at: NOW - 80000 })]));
    const r = await post(db, batch([ev({ at: NOW - 90000 }), ev({ at: NOW - 80000 }), ev({ at: NOW - 70000 })]));
    expect(r.body).toEqual({ ok: true, stored: 1, duplicates: 2 });
    expect(db.rows.map(x => x.at)).toEqual([NOW - 90000, NOW - 80000, NOW - 70000].map(t => new Date(t).toISOString()));
  });

  it('a late send keeps the source: the character, the Discord id, the spawn id, the name, the copy and the ORIGINAL time', async () => {
    const db = fakeSupabase();
    const old = NOW - 3 * 3600 * 1000;                                    // three hours ago: the bot was away
    await post(db, batch([ev({ at: old, spawn_id: 4242, name: 'a gnoll pup' })], { character: 'Brackwyn' }), { discord_id: '2002' });
    expect(db.rows).toEqual([expect.objectContaining({
      guild_id: 'guild-1', zone: 'lavastorm', point_id: 17, kind: 'died', spawn_id: 4242, npc_name: 'a gnoll pup',
      at: new Date(old).toISOString(), by_character: 'Brackwyn', by_discord_id: '2002', inst: 'pq.projectquarm.pq3.projectquarm.com:7312',
    })]);
  });

  it('two raiders who both saw the same death are two rows: the source is part of the key', async () => {
    const db = fakeSupabase();
    await post(db, batch([ev()], { character: 'Aldenmar' }), { discord_id: '1' });
    const r = await post(db, batch([ev()], { character: 'Brackwyn' }), { discord_id: '2' });
    expect(r.body.stored).toBe(1);
    expect(db.rows.map(x => x.by_character)).toEqual(['Aldenmar', 'Brackwyn']);
  });

  it('a different time, kind, point or spawn id is a different event', async () => {
    const db = fakeSupabase();
    await post(db, batch([ev(), ev({ at: NOW - 59999 }), ev({ kind: 'empty' }), ev({ point_id: 18 }), ev({ spawn_id: 4322 }), ev({ spawn_id: null })]));
    expect(db.rows).toHaveLength(6);
  });

  it('a failed write is a 503 the agent will retry, whether the store answers null or throws', async () => {
    for (const mode of [{ fail: true }, { throws: true }]) {
      const db = fakeSupabase(mode);
      const r = await post(db, batch([ev()]));
      expect(r.status).toBe(503);
      expect(r.body).toEqual({ error: 'try again shortly' });
      expect(r.cacheHasZone).toBe(true);                                  // nothing stored: the read cache stays
    }
  });

  it('a batch with nothing storable never touches the database', async () => {
    const db = fakeSupabase();
    const r = await post(db, batch([ev({ kind: 'exploded' })]));
    expect(r.body).toEqual({ ok: true, stored: 0 });
    expect(db.calls).toEqual([]);
  });
});

describe('the migration', () => {
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const sql = norm(MIGRATION);
  const KEY = "guild_id, zone, point_id, kind, coalesce(spawn_id, -1), at, coalesce(by_character, '')";

  it('builds the unique index on the event\'s identity, idempotently', () => {
    const m = /create unique index if not exists map_spawn_events_dedup_idx on public\.map_spawn_events \((.+?)\);/.exec(sql);
    expect(m).not.toBeNull();
    // (the index wraps the two expressions in their own parentheses; the key is otherwise the delete's partition list)
    expect(m[1].replace(/\(coalesce\(([^()]*(?:\([^()]*\))?[^()]*)\)\)/g, 'coalesce($1)')).toBe(KEY);
  });

  it('first removes existing repeats, keeping the lowest id, on the same key', () => {
    const m = /delete from public\.map_spawn_events where id in \( select id from \( select id, row_number\(\) over \( partition by (.+?) order by id \) as rn from public\.map_spawn_events \) t where t\.rn > 1 \);/.exec(sql);
    expect(m).not.toBeNull();
    expect(m[1]).toBe(KEY);
    expect(sql.indexOf('delete from')).toBeLessThan(sql.indexOf('create unique index'));   // or the index could not be built
  });

  it('is the only thing it does: no table is dropped or altered', () => {
    expect(sql).not.toMatch(/drop |alter table|truncate/i);
  });
});
