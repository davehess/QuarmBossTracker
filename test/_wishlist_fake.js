// test/_wishlist_fake.js — shared by test/web-wishlist-bot.test.js and test/web-wishlist.test.js.
//
// A fake PostgREST holding just the tables utils/webWishlist.js touches, and a way to call the real handler the
// way Node would. Invented names only (Aldenmar's family, Corvale). NOT a spec file (vitest does not collect it).

import { Readable } from 'node:stream';

export function makeDb() {
  const db = {
    wolfpack_members: [
      { user_id: 'u-alice', discord_id: 'd1', merged_into_discord_id: null },
      { user_id: 'u-alt',   discord_id: 'd1b', merged_into_discord_id: 'd1' },     // a second Discord account merged into Alice's
      { user_id: 'u-bob',   discord_id: 'd2', merged_into_discord_id: null },
    ],
    characters: [
      { guild_id: 'wolfpack', name: 'Aldenmar', main_name: null, discord_id: 'd1' },
      { guild_id: 'wolfpack', name: 'Brackwyn', main_name: 'Aldenmar', discord_id: null },   // an alt with no Discord id of its own
      { guild_id: 'wolfpack', name: 'Zarrin',   main_name: null, discord_id: 'd1b' },
      { guild_id: 'wolfpack', name: 'Corvale',  main_name: null, discord_id: 'd2' },
    ],
    eqemu_items: [{ id: 1001 }, { id: 1002 }],
    wishlists: [],
  };
  const arg = (qs, k) => new URLSearchParams(qs).get(k);
  const eq = (qs, k) => { const v = arg(qs, k); return v && v.startsWith('eq.') ? v.slice(3) : null; };
  const sb = {
    writes: [],
    isEnabled: () => true,
    guildId: () => 'wolfpack',
    async select(table, qs) {
      let rows = db[table];
      if (table === 'wolfpack_members') {
        const uid = eq(qs, 'user_id');
        const or = arg(qs, 'or');
        if (uid) rows = rows.filter(r => r.user_id === uid);
        else if (or) { const root = /discord_id\.eq\.([^,)]+)/.exec(or)[1]; rows = rows.filter(r => r.discord_id === root || r.merged_into_discord_id === root); }
      } else if (table === 'characters') {
        const nm = arg(qs, 'name');
        const ids = /^in\.\((.*)\)$/.exec(arg(qs, 'discord_id') || '');
        if (nm) rows = rows.filter(r => r.name.toLowerCase() === nm.replace(/^ilike\./, '').toLowerCase());
        if (ids) rows = rows.filter(r => ids[1].split(',').includes(r.discord_id));
      } else if (table === 'eqemu_items') {
        rows = rows.filter(r => String(r.id) === eq(qs, 'id'));
      } else if (table === 'wishlists') {
        const c = eq(qs, 'character_name'); const i = eq(qs, 'item_id');
        rows = rows.filter(r => (!c || r.character_name === c) && (!i || String(r.item_id) === i));
      }
      return rows.map(r => ({ ...r }));
    },
    async insert(table, rows) { sb.writes.push({ op: 'insert', table, rows }); db[table].push(...rows.map(r => ({ ...r }))); return rows; },
    async update(table, qs, body) {
      sb.writes.push({ op: 'update', table, body });
      const c = eq(qs, 'character_name'); const i = eq(qs, 'item_id');
      const hit = db[table].filter(r => r.character_name === c && String(r.item_id) === i);
      hit.forEach(r => Object.assign(r, body));
      return hit;
    },
    async del(table, qs) {
      sb.writes.push({ op: 'del', table });
      const c = eq(qs, 'character_name'); const i = eq(qs, 'item_id');
      db[table] = db[table].filter(r => !(r.character_name === c && String(r.item_id) === i));
      return {};
    },
  };
  return { db, sb };
}

/** Call the real handler (`webWishlist.handle`) with a request built from `body` (or `raw` text). */
export async function callBotWith(webWishlist, body, { token, method = 'POST', raw } = {}) {
  const req = Readable.from([Buffer.from(raw ?? JSON.stringify(body))]);
  req.method = method;
  req.headers = token ? { authorization: `Bearer ${token}` } : {};
  const res = { status: null, body: null, writeHead(s) { this.status = s; }, end(b) { this.body = b ? JSON.parse(b) : null; } };
  await webWishlist.handle(req, res);
  return res;
}
