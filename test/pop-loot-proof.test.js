// test/pop-loot-proof.test.js — loot is proof of presence on /pop (the guild lead, 2026-10-03: "if anyone
// has looted any distinct items from any of the planes we should go through and flag them up to that
// plane"). A character that looted inside a PoP plane (or holds a NO DROP item that drops only in one)
// stood in it, so it holds what a /who sighting there proves: the third proof kind beside Mimic's flag
// (green ✓) and /who (blue ✓), shown as a purple ✓.
//
// The rules (web/lib/popWho.ts, popGateCell.ts, popGuideAuto.ts, popLootRows.ts) run for real here; the
// migration and the page wiring are read as comment-stripped source, because the SQL needs a database and
// the page imports the framework.
//
// Run: npx vitest run test/pop-loot-proof.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, sliceBlock, stripJs, stripSql } from './_source-slice.js';
import { POP_ZONE_BY_KEY, zoneAccess } from '../web/lib/popFlags.ts';
import { isNoDrop } from '../web/lib/itemDecode.ts';
import { WHO_ZONE, flagsFromLoot, flagsFromSightings, lootText, seenText } from '../web/lib/popWho.ts';
import { gateState, proofFor } from '../web/lib/popGateCell.ts';
import { guideEvidence } from '../web/lib/popGuideAuto.ts';
import { loadLootSightings } from '../web/lib/popLootRows.ts';

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const none = new Set();
const T1 = '2026-10-01T20:00:00Z';
const T2 = '2026-10-02T01:00:00Z';
const loot = (zone, first = T1, source = 'looted') => ({ zone, first_at: first, last_at: first, items: 3, sample_item: 'A Test Item', source });
const sight = (zone, first = T1) => ({ zone, first_seen: first, last_seen: first });
const NO_DATA = { flags: [], loots: [], inventory: null, level: null, levelAt: null, spellbook: false, liveAt: null };

describe('the database side: pop_loot_sightings', () => {
  const sql = read('supabase/migrations/20261003190000_pop_loot_sightings.sql');
  const code = stripSql(sql);

  it('covers exactly the planes WHO_ZONE maps, so the two lists cannot drift', () => {
    const list = code.match(/with pop_zones\(short_name\) as \(values([\s\S]*?)\n  \),\n  looted as/);
    expect(list, 'the pop_zones list').not.toBeNull();
    const inSql = [...list[1].matchAll(/\('([a-z]+)'\)/g)].map(m => m[1]).sort();
    const shorts = Object.keys(WHO_ZONE).filter(k => !k.includes(' ')).sort();
    expect(shorts.length).toBeGreaterThan(10);
    expect(inSql).toEqual(shorts);
  });

  it('keeps a loot to those planes, by mapping the numeric zone id (as text) through eqemu_zone', () => {
    expect(code).toMatch(/join eqemu_zone z on z\.zone_id::text = l\.zone/);
    expect(code).toMatch(/where l\.guild_id = p_guild_id\s+and z\.short_name in \(select short_name from pop_zones\)/);
  });

  it('the inventory rule reads the INVERTED nodrop the right way: false is NO DROP', () => {
    // The mirror's column answers "can it be traded", so NO DROP is false (web/lib/itemDecode.ts).
    expect(isNoDrop({ nodrop: false })).toBe(true);
    expect(isNoDrop({ nodrop: true })).toBe(false);
    expect(code).toMatch(/where i\.nodrop = false/);
    expect(code).not.toMatch(/nodrop = true/);
    expect(code).not.toMatch(/not i\.nodrop/);
  });

  it('inventory proof needs a drop in exactly one zone, a plane, and no quest reward', () => {
    expect(code).toMatch(/where cardinality\(zs\.zones\) = 1\s+and zs\.zones\[1\] in \(select short_name from pop_zones\)/);
    expect(code).toMatch(/not exists \(select 1 from quest_rewards r where r\.item_id = zs\.item_id\)/);
    expect(code).toMatch(/from scripted_npc_turnins t/);
    // A drop's zone: placed spawns, plus the NPC id's zone prefix for NPCs with no placed spawn.
    expect(code).toMatch(/join eqemu_spawn2 s2\s+on s2\.spawngroup_id = se\.spawngroup_id/);
    expect(code).toMatch(/z\.zone_id = n\.id \/ 1000/);
  });

  it('skips a character that hides its inventory, for the inventory source only', () => {
    const inventory = code.slice(code.indexOf('inventory as ('), code.indexOf('proof as ('));
    expect(inventory).toMatch(/coalesce\(c\.exclude_inventory, false\)/);
    expect(code.slice(code.indexOf('looted as ('), code.indexOf('nodrop as ('))).not.toMatch(/exclude_inventory/);
  });

  it('is one row per character and plane, says looted when both exist, and is ordered for paging', () => {
    expect(code).toMatch(/group by p\.ck, p\.zone\s+order by p\.ck, p\.zone/);
    expect(code).toMatch(/case when bool_or\(p\.source = 'looted'\) then 'looted' else 'inventory' end/);
    expect(code).toMatch(/count\(distinct p\.item_name\)/);
    expect(code).toMatch(
      /returns table\(character_key text, zone text, first_at timestamptz, last_at timestamptz, items bigint, sample_item text, source text\)/);
  });

  it('is read-only, and only the service role may call it', () => {
    expect(code).toMatch(/revoke all on function public\.pop_loot_sightings\(text\) from public, anon, authenticated;/);
    expect(code).toMatch(/grant execute on function public\.pop_loot_sightings\(text\) to service_role;/);
    expect(code).not.toMatch(/^\s*(insert\s+into|update\s+\w|delete\s+from|alter\s+\w|drop\s+\w)/im);
    expect(code).toMatch(/\bstable\b/);
  });
});

describe('what a loot proves', () => {
  it('the same flags a /who sighting in that plane proves, for every plane the chart gates', () => {
    for (const zone of Object.keys(WHO_ZONE).filter(k => !k.includes(' '))) {
      const viaWho = flagsFromSightings([sight(zone)]);
      const viaLoot = flagsFromLoot([loot(zone)]);
      expect([...viaLoot.keys()].sort(), zone).toEqual([...viaWho.keys()].sort());
      for (const [f, p] of viaWho) expect(viaLoot.get(f), `${zone} ${f}`).toMatchObject({ flag: f, zone: p.zone, at: p.at });
    }
  });

  it('a loot in the Bastion of Thunder proves Thunder’s way in AND Storms’', () => {
    const m = flagsFromLoot([loot('bothunder')]);
    expect([...m.keys()].sort()).toEqual(['askr_quest', 'trial_justice']);
    const flags = new Set(m.keys());
    expect(zoneAccess(POP_ZONE_BY_KEY.bot, flags)).toBe(true);
    expect(zoneAccess(POP_ZONE_BY_KEY.storms, flags)).toBe(true);
    expect(zoneAccess(POP_ZONE_BY_KEY.valor, flags)).toBe(true);
    // It proves the way in, not a plane the character was never near.
    expect(zoneAccess(POP_ZONE_BY_KEY.torment, flags)).toBe(false);
    expect(m.get('trial_justice')).toMatchObject({ zone: 'bot', source: 'looted' });
  });

  it('a loot in Storms or Valor proves the Justice flag and nothing more', () => {
    for (const z of ['postorms', 'povalor']) expect([...flagsFromLoot([loot(z)]).keys()]).toEqual(['trial_justice']);
  });

  it('open planes, planes the table does not know and instanced copies prove nothing', () => {
    for (const z of ['pojustice', 'ponightmare', 'podisease', 'poinnovation', 'Plane of Fear (Instanced)', 'nowhere']) {
      expect(flagsFromLoot([loot(z)]).size, z).toBe(0);
    }
    expect(flagsFromLoot([]).size).toBe(0);
  });

  it('keeps each flag’s earliest row and the kind of proof it came from', () => {
    const m = flagsFromLoot([
      loot('bothunder', T2, 'looted'),
      loot('postorms', T1, 'inventory'),
    ]);
    // Justice is proven earliest by the Storms row, an inventory one; the shrine only by Thunder's loot.
    expect(m.get('trial_justice')).toEqual({ flag: 'trial_justice', zone: 'storms', at: T1, source: 'inventory' });
    expect(m.get('askr_quest')).toEqual({ flag: 'askr_quest', zone: 'bot', at: T2, source: 'looted' });
  });

  it('says where, in the words /who uses, and what kind of proof', () => {
    expect(lootText('bot')).toBe('Looted in Bastion of Thunder, reached through Plane of Storms.');
    expect(lootText('storms')).toBe('Looted in Plane of Storms.');
    expect(lootText('bot', 'inventory')).toBe('Holds a NO DROP item that drops only in Bastion of Thunder, reached through Plane of Storms.');
    expect(lootText('bot')).toBe(seenText('bot').replace('Seen on /who in', 'Looted in'));
  });
});

describe('how a gate cell shows it, and what outranks it', () => {
  it('a gate only loot proves is held, shows the loot mark and is read-only', () => {
    const g = gateState(['trial_justice'], { trial_justice: 'loot' }, none);
    expect(g).toMatchObject({ access: true, mark: 'loot', selfFlags: [], open: [] });
    expect(g.toggle).toBeNull();
  });

  it('a proof outranks the owner’s tick: loot AND a tick shows the loot and stays read-only', () => {
    const g = gateState(['trial_justice'], { trial_justice: 'loot' }, new Set(['trial_justice']));
    expect(g.mark).toBe('loot');
    expect(g.selfFlags).toEqual([]);
    expect(g.toggle).toBeNull();
  });

  it('a tick on the other flag of a gate still makes it ☑, and loot with Mimic shows the weaker loot', () => {
    const req = ['fuirstel_5', 'thelin_4'];
    expect(gateState(req, { fuirstel_5: 'loot' }, new Set(['thelin_4'])).mark).toBe('self');
    expect(gateState(req, { fuirstel_5: 'mimic', thelin_4: 'loot' }, none).mark).toBe('loot');
    expect(gateState(req, { fuirstel_5: 'loot' }, none)).toMatchObject({ access: false, mark: 'none', open: ['thelin_4'] });
  });

  it('/who and loot are level: where both prove one flag, and in a mixed gate, /who’s blue is the one shown', () => {
    const req = ['fuirstel_5', 'thelin_4'];
    expect(gateState(req, { fuirstel_5: 'who', thelin_4: 'loot' }, none).mark).toBe('who');
    expect(gateState(req, { fuirstel_5: 'loot', thelin_4: 'who' }, none).mark).toBe('who');
    const c = {
      flags: new Set(['both', 'lootOnly', 'whoOnly', 'recorded', 'ticked']),
      seen: new Map([['both', {}], ['whoOnly', {}]]),
      looted: new Map([['both', {}], ['lootOnly', {}]]),
      self: new Set(['ticked']),
    };
    expect(proofFor(['both', 'lootOnly', 'whoOnly', 'recorded', 'ticked', 'open'], c))
      .toEqual({ both: 'who', lootOnly: 'loot', whoOnly: 'who', recorded: 'mimic' });
  });

  it('a caller that passes no loot map still gets Mimic and /who as before', () => {
    const c = { flags: new Set(['a', 'b']), seen: new Map([['b', {}]]), self: new Set() };
    expect(proofFor(['a', 'b'], c)).toEqual({ a: 'mimic', b: 'who' });
  });

  it('the mark is a purple ✓, and the other three are unchanged', () => {
    const mark = stripJs(read('web/app/pop/GateMark.tsx'));
    expect(mark).toMatch(/loot: \{ glyph: '✓', cls: 'text-purple' \}/);
    expect(mark).toMatch(/who: \{ glyph: '✓', cls: 'text-blue' \}/);
    expect(mark).toMatch(/mimic: \{ glyph: '✓', cls: 'text-green' \}/);
    expect(mark).toMatch(/self: \{ glyph: '☑', cls: 'text-gold' \}/);
  });
});

describe('the checklist fills in from loot', () => {
  it('a character that looted in Storms has the Justice steps done, labelled as looted there', () => {
    const ev = guideEvidence({ ...NO_DATA, looted: [loot('postorms')] });
    for (const k of ['flag_trial_justice', 'justice_mavuin_info', 'justice_tribunal', 'justice_mavuin_hail']) {
      expect(ev[k]?.source, k).toBe('loot');
      expect(ev[k].what).toBe('Looted in Plane of Storms.');
      expect(ev[k].at).toBe(T1);
    }
    expect(ev.flag_askr).toBeUndefined();
  });

  it('a NO DROP item held from only that plane says so', () => {
    const ev = guideEvidence({ ...NO_DATA, looted: [loot('bothunder', T1, 'inventory')] });
    expect(ev.flag_askr.source).toBe('loot');
    expect(ev.flag_askr.what).toBe('Holds a NO DROP item that drops only in Bastion of Thunder, reached through Plane of Storms.');
  });

  it('Mimic’s record wins, then /who, then loot', () => {
    const mimic = guideEvidence({ ...NO_DATA, flags: [{ flag_key: 'trial_justice', earned_at: T1 }], looted: [loot('postorms')] });
    // The recorded Justice flag is the Mavuin hail's (2026-10-03) and is mavuin 3, so Mimic's record covers
    // the trial and the Tribunal before it too; the loot fills nothing Mimic already has.
    expect(mimic.justice_mavuin_hail.source).toBe('mimic');
    expect(mimic.flag_trial_justice.source).toBe('mimic');
    expect(mimic.justice_tribunal.source).toBe('mimic');
    const both = guideEvidence({ ...NO_DATA, seen: [sight('postorms')], looted: [loot('postorms')] });
    for (const k of ['flag_trial_justice', 'justice_tribunal']) expect(both[k].source, k).toBe('who');
    // /who covers the Justice steps, loot in Thunder still adds the shrine /who never saw.
    const split = guideEvidence({ ...NO_DATA, seen: [sight('postorms')], looted: [loot('bothunder')] });
    expect(split.flag_trial_justice.source).toBe('who');
    expect(split.flag_askr.source).toBe('loot');
  });

  it('no rows, an open plane or an unknown zone fill nothing in', () => {
    expect(guideEvidence({ ...NO_DATA, looted: [loot('pojustice'), loot('nowhere')] }).flag_trial_justice).toBeUndefined();
    expect(guideEvidence({ ...NO_DATA }).flag_trial_justice).toBeUndefined();
  });

  it('the checklist badge and its data wiring name loot', () => {
    expect(stripJs(read('web/app/pop/guide/GuideRoute.tsx'))).toMatch(/ev\.source === 'loot' \? '✓ looted there'/);
    const data = stripJs(read('web/app/pop/guide/routeData.ts'));
    expect(data).toMatch(/names\.length \? loadLootSightings\(admin\) : Promise\.resolve\(\[\] as LootRow\[\]\)/);
    expect(data).toMatch(/const looted = \(lootSights as LootRow\[\]\)\.filter\(r => r\.character_key === lc\);/);
    expect(data).toMatch(/seen,\s*looted,\s*\}\);/);
  });
});

describe('reading the rows: a page of 1,000 at a time', () => {
  // A fake of the client's rpc(...).range(): serves `total` ordered rows, a page per request.
  const fake = (total) => {
    const calls = [];
    return {
      calls,
      rpc(fn, args) {
        return {
          range(from, to) {
            calls.push({ fn, args, from, to });
            const n = Math.max(0, Math.min(to + 1, total) - from);
            return Promise.resolve({ data: Array.from({ length: n }, (_, i) => ({ character_key: `c${from + i}`, zone: 'postorms' })) });
          },
        };
      },
    };
  };

  it('reads past the API’s 1,000-row cap, in order, and stops at the first short page', async () => {
    const sb = fake(2005);
    const rows = await loadLootSightings(sb);
    expect(rows).toHaveLength(2005);
    expect(rows[0].character_key).toBe('c0');
    expect(rows[2004].character_key).toBe('c2004');
    expect(sb.calls.map(c => [c.from, c.to])).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    expect(sb.calls.every(c => c.fn === 'pop_loot_sightings' && c.args.p_guild_id === 'wolfpack')).toBe(true);
  });

  it('one short page is one request; an exactly full page asks for the next', async () => {
    const small = fake(70);
    expect(await loadLootSightings(small)).toHaveLength(70);
    expect(small.calls).toHaveLength(1);
    const full = fake(1000);
    expect(await loadLootSightings(full)).toHaveLength(1000);
    expect(full.calls).toHaveLength(2);
  });

  it('a null page (an error) ends the read with what it has', async () => {
    const sb = { rpc: () => ({ range: () => Promise.resolve({ data: null }) }) };
    expect(await loadLootSightings(sb)).toEqual([]);
  });
});

describe('the page: loot is merged after /who and before the owner’s tick', () => {
  const raw = read('web/app/pop/page.tsx');
  const page = stripJs(raw);

  it('reads the loot rows beside the /who sightings, for the roster and the viewer’s characters', () => {
    expect(page).toMatch(/nameOf\.size \? loadLootSightings\(sb\) : Promise\.resolve\(\[\] as LootRow\[\]\)/);
    expect(page.indexOf("sb.rpc('pop_who_sightings'")).toBeGreaterThan(0);
    expect(page.indexOf('loadLootSightings(sb)')).toBeGreaterThan(page.indexOf("sb.rpc('pop_who_sightings'"));
    expect(page).toMatch(/for \(const r of lootRows\) \{\s*if \(!nameOf\.has\(r\.character_key\)\) continue;/);
  });

  it('applies precedence by order: Mimic’s rows, then /who, then loot, then ticks; never over a flag already held', () => {
    const who = page.indexOf('flagsFromSightings(rows)');
    const lootAt = page.indexOf('flagsFromLoot(rows)');
    const tick = page.indexOf('selfFlagsFromTicks(tickRows)');
    expect(who).toBeGreaterThan(0);
    expect(lootAt).toBeGreaterThan(who);
    expect(tick).toBeGreaterThan(lootAt);
    expect(page.slice(lootAt, tick)).toMatch(/if \(c\.flags\.has\(f\)\) continue;\s*c\.flags\.add\(f\);\s*c\.looted\.set\(f, proof\);/);
  });

  it('carries the loot map on every character record, the roster’s included', () => {
    expect(page).toMatch(/looted: Map<string, LootProof>; self: Set<string>/);
    expect(page).toMatch(/looted: c\?\.looted \?\? new Map<string, LootProof>\(\)/);
    expect(page.match(/looted: new Map\(\)/g).length).toBeGreaterThanOrEqual(4);
  });

  it('so it counts wherever /who proof counts: those surfaces all read c.flags', () => {
    // The chart, planner, matrix, zone page and My Characters read `flags`, which the merge fills.
    expect(page).toMatch(/for \(const c of scopedChars\) for \(const f of c\.flags\) flagCount\.set/);
    expect(page).toMatch(/scopedChars\.filter\(c => zoneAccess\(z, c\.flags\)\)/);
    expect(page).toMatch(/const provenOf = \(c: MarkSource\) => \[\.\.\.c\.flags\]\.filter\(f => !c\.self\.has\(f\)\);/);
  });

  it('titles the mark “looted in <zone>”, in the matrix, My Characters and the zone page alike', () => {
    expect(page).toMatch(/lootText\(p\.zone, p\.source\)/);
    expect(page).toMatch(/const title = \[g\.mark === 'self' \? selfTitle\(z, c\) : '', proofTitle\(z, c\)\]/);
    expect(page).toMatch(/proofTitle=\{proofTitle\(z, c\)\}/);
    expect(page).toMatch(/\{seenTag\(c\)\}\{lootTag\(c\)\}\{selfTag\(c\)\}/);
    expect(page).toMatch(/text-purple" title=\{lootTitle\(looted\)\}> · looted in/);
    // The owner's button hands the combined title on, so a loot-proven cell says where too.
    expect(stripJs(read('web/app/pop/SelfFlagCells.tsx'))).toMatch(/<GateMark kind=\{mark\} title=\{proofTitle \|\| undefined\} \/>/);
  });

  it('has a legend line for the purple ✓, next to the tables', () => {
    const legend = sliceBlock(page, 'const gateLegend = (', '\n  );');
    expect(legend).toMatch(/<span className="text-purple">✓<\/span> looted in the plane/);
    expect(legend).toMatch(/<span className="text-blue">✓<\/span> seen on \/who/);
  });

  it('counts the characters placed by loot on the header, like the /who count', () => {
    expect(page).toMatch(/const lootCount = \[\.\.\.byChar\.values\(\)\]\.filter\(c => c\.looted\.size > 0\)\.length;/);
    expect(page).toMatch(/placed by loot/);
  });
});
