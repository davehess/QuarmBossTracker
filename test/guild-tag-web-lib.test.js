// test/guild-tag-web-lib.test.js — web/lib asks for the guild by GUILD_TAG (web/lib/guild.ts), not by a literal.
//
// The guild kit lets a second guild run this site against its own database, and every guild table is keyed
// on `guild_id`. Wolf Pack's tag used to be typed into twenty reads under web/lib. Each one now reads
// GUILD_TAG, which resolves environment variable -> the built-in 'wolfpack'. Proven for real, both halves:
//   - nothing set: every loader still asks for 'wolfpack', so production is unchanged;
//   - NEXT_PUBLIC_GUILD_TAG set: the loaders ask for that tag and no other (the fake holds rows of both).
// Files a plain test cannot import (they pull in the `@/` alias or react) are held by a source-text ratchet
// over comment-stripped source: no bare 'wolfpack' literal may come back.
//
// Run: npx vitest run test/guild-tag-web-lib.test.js

import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fakeSupabase } from './_fake-supabase-js.js';
import { fakeDb } from './_fake-supabase-me.js';
import { ROOT, stripJs } from './_source-slice.js';

const OTHER = 'zzguild';

// Re-evaluate the modules as a deployment whose NEXT_PUBLIC_GUILD_TAG is `tag` ('' = nothing set).
async function libs(tag) {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_GUILD_TAG', tag);
  vi.stubEnv('SUPABASE_GUILD_ID', '');
  const [guild, full, listable, caps, loot, queue] = await Promise.all([
    import('../web/lib/guild.ts'), import('../web/lib/fullReads.ts'), import('../web/lib/listableChars.ts'),
    import('../web/lib/capSafeReads.ts'), import('../web/lib/popLootRows.ts'), import('../web/lib/adminQueueData.ts'),
  ]);
  return { guild, full, listable, caps, loot, queue };
}
afterEach(() => { vi.unstubAllEnvs(); });

const win = { startIso: '2026-09-27T22:40:00.000Z', endIso: '2026-09-28T04:04:00.000Z' };

// A client that records the chain it was asked, for the two reads that end in .limit().
function chain(seen, rows) {
  const q = { select: () => q, ilike: () => q, eq: (k, v) => { seen.push([k, v]); return q; }, limit: async () => ({ data: rows }) };
  return { from: () => q };
}

describe.each([
  ['nothing set', '', 'wolfpack'],
  ['NEXT_PUBLIC_GUILD_TAG set', OTHER, OTHER],
])('%s', (_label, env, want) => {
  it('GUILD_TAG resolves to the environment, else the built-in tag', async () => {
    expect((await libs(env)).guild.GUILD_TAG).toBe(want);
  });

  it('fullReads: the three RPCs send p_guild_id', async () => {
    const { full } = await libs(env);
    const sb = fakeSupabase({ rpcs: { raid_night_slows: () => [], raid_night_fires: () => [], raid_active_buff_casts: () => [] } });
    await full.loadNightSlows(sb, win, ['drowsy']);
    await full.loadNightFires(sb, win, ['invis']);
    await full.loadActiveBuffCasts(sb, win.startIso);
    expect(sb.requests.map(r => r.args.p_guild_id)).toEqual([want, want, want]);
  });

  it('fullReads: loadPvpBossKills returns only this guild\'s rows', async () => {
    const { full } = await libs(env);
    const row = (id, guild_id) => ({ id, guild_id, boss_id: 'b' + id, killed_at: '2026-09-28T00:00:00.000Z' });
    const sb = fakeSupabase({ tables: { pvp_boss_kills: [row(1, 'wolfpack'), row(2, OTHER), row(3, 'elsewhere')] } });
    const out = await full.loadPvpBossKills(sb, '2026-09-01T00:00:00.000Z');
    expect(out.map(r => r.guild_id)).toEqual([want]);
  });

  it('listableChars: the Trader and hidden reads filter on the tag', async () => {
    const { listable } = await libs(env);
    const seen = [];
    await listable.loadTraderNames(chain(seen, []));
    await listable.loadHiddenNames(chain(seen, []));
    expect(seen.filter(([k]) => k === 'guild_id')).toEqual([['guild_id', want], ['guild_id', want]]);
  });

  it('capSafeReads: live state and family inventory are this guild\'s rows only', async () => {
    const { caps } = await libs(env);
    const live = [['wolfpack', 'Aldenmar'], [OTHER, 'Aldenmar']].map(([guild_id, character]) => ({ guild_id, character, zone_name: guild_id }));
    const rows = await caps.fetchLiveStateRows(fakeDb({ tables: { character_live_state: live } }), ['Aldenmar']);
    expect(rows.map(r => r.zone_name)).toEqual([want]);   // zone_name carries the row's guild: which one came back
    const inv = [['wolfpack', 1], [OTHER, 2]].map(([guild_id, item_id]) => ({ guild_id, character_name: 'Zarrin', slot_label: 'S' + item_id, item_id, item_name: 'i', quantity: 1 }));
    const got = await caps.fetchFamilyInventory(fakeDb({ tables: { character_inventory: inv } }), ['Zarrin']);
    expect(got.map(r => r.item_id)).toEqual([want === 'wolfpack' ? 1 : 2]);
  });

  it('popLootRows: the default guildId is the tag, and an explicit one still wins', async () => {
    const { loot } = await libs(env);
    const sb = fakeSupabase({ rpcs: { pop_loot_sightings: () => [] } });
    await loot.loadLootSightings(sb);
    await loot.loadLootSightings(sb, 'explicit');
    expect(sb.requests.map(r => r.args.p_guild_id)).toEqual([want, 'explicit']);
  });

  it('adminQueueData: QUEUE_GUILD is the tag', async () => {
    expect((await libs(env)).queue.QUEUE_GUILD).toBe(want);
  });
});

// ── the ratchet: no bare tag literal under lib / components / middleware ─────

function sources() {
  const out = [];
  const walk = (rel) => {
    const full = path.join(ROOT, rel);
    if (fs.statSync(full).isDirectory()) { for (const e of fs.readdirSync(full).sort()) walk(path.join(rel, e)); }
    else if (/\.(ts|tsx)$/.test(rel) && !/\.d\.ts$/.test(rel)) out.push(rel);
  };
  for (const r of ['web/lib', 'web/components', 'web/middleware.ts']) walk(r);
  return out;
}
// The two places a bare 'wolfpack' is allowed: guild.ts is where the built-in default lives, and
// obfuscate.ts's demo salt is not a guild tag (a different slice owns it).
const ALLOWED = new Set(['web/lib/guild.ts', 'web/lib/obfuscate.ts']);

describe('no database guild-tag literal is left in web/lib, web/components or web/middleware.ts', () => {
  const files = sources();
  it('scans the whole tree (not an empty list)', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain('web/lib/fullReads.ts');
    expect(files).toContain('web/middleware.ts');
  });
  it('no quoted \'wolfpack\' outside the allow-list', () => {
    const hits = files.filter(f => !ALLOWED.has(f.split(path.sep).join('/')))
      .filter(f => /['"`]wolfpack['"`]|eq\.wolfpack\b/.test(stripJs(fs.readFileSync(path.join(ROOT, f), 'utf8'))));
    expect(hits).toEqual([]);
  });
  it('every file that reads the tag imports it from the guild module', () => {
    for (const f of ['admin-queue', 'adminQueueData', 'capSafeReads', 'character-family', 'fullReads', 'funLdAuth',
      'listableChars', 'popLootRows', 'raidScreen', 'roster']) {
      const src = stripJs(fs.readFileSync(path.join(ROOT, 'web', 'lib', f + '.ts'), 'utf8'));
      expect(src, f).toMatch(/import \{ GUILD_TAG \} from '\.\/guild';/);
      expect(src.match(/\bGUILD_TAG\b/g).length, `${f} imports GUILD_TAG but never uses it`).toBeGreaterThan(1);
    }
  });
});
