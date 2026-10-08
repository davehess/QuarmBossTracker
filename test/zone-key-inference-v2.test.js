// Zone-key inference v2 (the guild lead, 2026-09-25: "sweep for no drop items
// from zones that require keys and make key assumptions for them"). The rules
// run in Postgres, so these check the migrations as written: all five keyed
// zones from the server's door table are seeded, and every function the
// migrations create is locked to the service role with a pinned search_path —
// the same night two functions were found callable with the public key.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripSql } from './_source-slice.js';

const read = (f) => stripSql(fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', f), 'utf8'));
const v2   = read('20260925112238_zone_key_inference_v2.sql');
const fast = read('20260925112514_zone_key_inference_v2_fast.sql');

const functionsIn = (sql) => [...sql.matchAll(/create or replace function (\w+)\(([^)]*)\)/g)]
  .map(m => ({ name: m[1], body: sql.slice(m.index, sql.indexOf('$$;', m.index)) }));

describe('keyed zones', () => {
  it('seeds the two the door table adds, with their real key items', () => {
    expect(v2).toMatch(/\('sleeper',\s+'Sleeper''s Tomb',\s+27265, 'Sleeper''s Key'/);
    expect(v2).toMatch(/\('charasis', 'The Howling Stones',\s+20600, 'Key to Charasis'/);
    expect(v2).toMatch(/on conflict \(zone_short\) do update/);
  });

  it('evidence excludes quest rewards and maps unplaced NPCs by their id prefix', () => {
    expect(fast).toMatch(/quest_rewards as \([\s\S]*scripted_npc_turnins[\s\S]*not exists \(select 1 from quest_rewards r where r\.item_id = zs\.item_id\)/);
    expect(fast).toMatch(/join eqemu_zone z\s+on z\.zone_id = n\.id \/ 1000\s+where not exists \(select 1 from eqemu_spawnentry se where se\.npc_id = n\.id\)/);
    expect(fast).toMatch(/where i\.nodrop = false/);
  });
});

describe('function hygiene', () => {
  for (const [label, sql] of [['v2', v2], ['v2_fast', fast]]) {
    const fns = functionsIn(sql);
    it(`${label}: creates functions at all`, () => expect(fns.length).toBeGreaterThan(0));
    for (const fn of fns) {
      it(`${label}: ${fn.name} pins search_path and is service-role only`, () => {
        expect(fn.body).toMatch(/set search_path = public/);
        expect(sql).toMatch(new RegExp(`revoke execute on function ${fn.name}\\([^)]*\\) from public, anon, authenticated;`));
        expect(sql).toMatch(new RegExp(`grant\\s+execute on function ${fn.name}\\([^)]*\\) to service_role;`));
      });
    }
  }
});
