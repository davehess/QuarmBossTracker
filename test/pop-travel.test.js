// test/pop-travel.test.js — the Planes of Power travel routes (web/lib/popTravel.ts) and the travel_paths seed that
// carries the same rows (supabase/migrations/20261029120000_travel_paths_pop_seed.sql). A DRAFT: nothing imports the
// module yet, so these tests guard the data itself: real zone names, a citation on every hop, routes that are chains,
// and a graph from the Plane of Knowledge that reaches every zone.
//
// Run: npx vitest run test/pop-travel.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripSql } from './_source-slice.js';
import {
  POP_ZONES, POP_ZONE_LONG, HOPS, POK_ENTRIES, FORWARD_ROUTES, BACK_ROUTES, SIDE_HOPS,
  travelPathRows, seedSql, routeFromPok, reachableFromPok,
} from '../web/lib/popTravel.ts';

// Typed out here on purpose, NOT read back from the module: the short names the plan covers, checked against
// eqemu_zone on 2026-10-29 (every one exists; `nightmareb` is the Lair of Terris Thule, `hohonorb` the Temple of
// Marr, `potactics` Drunder, `solrotower` the Tower of Solusek Ro; there is no "solteris").
const KNOWN = [
  'poknowledge', 'potranquility', 'podisease', 'ponightmare', 'nightmareb', 'pojustice', 'poinnovation', 'povalor',
  'postorms', 'codecay', 'potorment', 'hohonora', 'hohonorb', 'bothunder', 'potactics', 'solrotower', 'pofire',
  'poair', 'powater', 'poeartha', 'poearthb', 'potimea', 'potimeb',
];
const known = new Set(KNOWN);

const MIGRATION = 'supabase/migrations/20261029120000_travel_paths_pop_seed.sql';
const MARKER = '-- ------------------------------------------------------------------------------------------------------------------\n';

const rows = travelPathRows();
const allHops = [
  ...Object.values(HOPS),
  ...POK_ENTRIES.map(e => e.hop),
];

describe('the zone list', () => {
  it('is exactly the zones the plan covers, each with a long name', () => {
    expect([...POP_ZONES]).toEqual(KNOWN);
    for (const z of KNOWN) expect(POP_ZONE_LONG[z], z).toBeTruthy();
    expect(Object.keys(POP_ZONE_LONG).sort()).toEqual([...KNOWN].sort());
  });
});

describe('every row and hop names real zones', () => {
  it('has known zone_from / zone_to on every row (a null origin is allowed only for the into-Knowledge entries)', () => {
    for (const r of rows) {
      expect(known.has(r.zone_to_short), `${r.key} to`).toBe(true);
      if (r.zone_from_short === null) {
        expect(r.key.startsWith('into-pok:'), r.key).toBe(true);
        expect(r.zone_to_short).toBe('poknowledge');
      } else {
        expect(known.has(r.zone_from_short), `${r.key} from`).toBe(true);
      }
    }
  });

  it('has known from / to on every hop ("anywhere" only on an into-Knowledge entry)', () => {
    for (const r of rows) {
      for (const h of r.hops) {
        expect(known.has(h.to), `${r.key} hop to ${h.to}`).toBe(true);
        if (h.from === 'anywhere') expect(r.key.startsWith('into-pok:'), r.key).toBe(true);
        else expect(known.has(h.from), `${r.key} hop from ${h.from}`).toBe(true);
      }
    }
  });
});

describe('every hop carries its evidence', () => {
  it('has a non-empty src, and each citation is a table row or a pinned script / server line', () => {
    expect(allHops.length).toBeGreaterThan(60);
    for (const h of allHops) {
      expect(Array.isArray(h.src) && h.src.length > 0, `${h.from}>${h.to} src`).toBe(true);
      for (const s of h.src) {
        expect(typeof s === 'string' && s.length > 0).toBe(true);
        const isRow = /^(eqemu_doors zone=\w+ doorid=\d+|eqemu_zone_points zone=\w+ number=\d+|eqemu_spells id=\d+|spell_class_levels spell_id=\d+|eqemu_items clickeffect=\d+)$/.test(s);
        const isScript = /^[a-z0-9_]+\/[A-Za-z0-9_`.#-]+\.lua:\d+(-\d+)? @ ea0c766( \(.*\))?$/.test(s);
        const isServer = /^eqmacemu [\w/.]+:\d+(-\d+)? @ 12068490( \(.*\))?$/.test(s);
        expect(isRow || isScript || isServer, `${h.from}>${h.to}: "${s}"`).toBe(true);
      }
    }
  });

  it('cites a source on every gate, and words every gate', () => {
    for (const h of allHops) {
      for (const g of h.gate ?? []) {
        expect(g.text.length, `${h.from}>${h.to} gate`).toBeGreaterThan(10);
        expect(g.src.length, `${h.from}>${h.to} gate src`).toBeGreaterThan(0);
        expect(['level', 'flag', 'item', 'raid', 'event']).toContain(g.kind);
      }
    }
  });

  it('says what it could not prove when a place is missing', () => {
    for (const h of allHops) {
      if (!h.loc && h.from !== 'anywhere') expect(h.unverified, `${h.from}>${h.to} has no loc`).toBeTruthy();
      if (!h.arrive) expect(h.unverified, `${h.from}>${h.to} has no arrive`).toBeTruthy();
    }
  });

  it('puts coordinates in /loc order as finite whole numbers', () => {
    for (const h of allHops) {
      for (const p of [h.loc, h.arrive]) {
        if (!p) continue;
        expect(Object.keys(p)).toEqual(['y', 'x', 'z']);
        for (const v of Object.values(p)) expect(Number.isInteger(v), `${h.from}>${h.to}`).toBe(true);
      }
    }
  });

  it('names a class only on a spell, and a spell always names its class', () => {
    for (const h of allHops) {
      if (h.via === 'spell') expect(h.class?.length, `${h.to} spell`).toBeGreaterThan(0);
      else expect(h.class, `${h.from}>${h.to}`).toBeUndefined();
    }
  });

  it('keeps names of members out of the data (NPCs and items are fine, but no one is credited)', () => {
    const blob = JSON.stringify(rows);
    expect(blob).not.toMatch(/the guild lead|a member|a raider|beta tester/i);
  });
});

describe('the routes are chains', () => {
  const chain = (r) => r.hops.every((h, i) => i === 0 || r.hops[i - 1].to === h.from);

  it('has a main forward route and a way back for every zone except the Plane of Knowledge', () => {
    for (const z of KNOWN.filter(z => z !== 'poknowledge')) {
      expect(FORWARD_ROUTES.filter(r => r.to === z && !r.alt).length, `${z} forward`).toBe(1);
      expect(BACK_ROUTES.filter(r => r.to === z).length, `${z} back`).toBe(1);
      expect(routeFromPok(z), z).not.toBeNull();
    }
    expect(routeFromPok('poknowledge')).toBeNull();
  });

  it('starts every forward route at the Plane of Knowledge, ends at its zone, and never skips a hop', () => {
    for (const r of rows.filter(r => r.key.startsWith('fwd:'))) {
      expect(r.zone_from_short).toBe('poknowledge');
      expect(r.hops[0].from, r.key).toBe('poknowledge');
      expect(r.hops.at(-1).to, r.key).toBe(r.zone_to_short);
      expect(chain(r), r.key).toBe(true);
    }
  });

  it('starts every back route at its zone and ends at the Plane of Knowledge, never skipping a hop', () => {
    for (const r of rows.filter(r => r.key.startsWith('back:'))) {
      expect(r.zone_to_short).toBe('poknowledge');
      expect(r.hops[0].from, r.key).toBe(r.zone_from_short);
      expect(r.hops.at(-1).to, r.key).toBe('poknowledge');
      expect(chain(r), r.key).toBe(true);
    }
  });

  it('reaches every listed zone from the Plane of Knowledge', () => {
    const reach = reachableFromPok();
    for (const z of KNOWN) expect(reach.has(z), z).toBe(true);
    expect(reach.size).toBe(KNOWN.length);
  });

  it('makes the graph walk meaningful: drop the Tranquility book and nothing but the start is left', () => {
    // Mutation check, run on the real hops: with the one hop out of the Plane of Knowledge removed, a walk reaches nothing.
    const edges = new Map();
    for (const r of FORWARD_ROUTES) for (const id of r.hops) {
      if (id === 'pok_tranq') continue;
      const h = HOPS[id];
      if (!edges.has(h.from)) edges.set(h.from, new Set());
      edges.get(h.from).add(h.to);
    }
    const seen = new Set(['poknowledge']);
    const queue = ['poknowledge'];
    while (queue.length) for (const n of edges.get(queue.shift()) ?? []) if (!seen.has(n)) { seen.add(n); queue.push(n); }
    expect([...seen]).toEqual(['poknowledge']);
  });

  it('keeps row keys unique, and only an alternate shares a from / to pair with another forward row', () => {
    expect(new Set(rows.map(r => r.key)).size).toBe(rows.length);
    const pairs = rows.filter(r => r.key.startsWith('fwd:') && !r.key.includes('#')).map(r => r.zone_to_short);
    expect(new Set(pairs).size).toBe(pairs.length);
    expect(SIDE_HOPS.length).toBeGreaterThan(0);
  });
});

describe('the seed migration', () => {
  const file = fs.readFileSync(path.join(ROOT, MIGRATION), 'utf8');
  const [header, body] = [file.slice(0, file.indexOf(MARKER) + MARKER.length), file.slice(file.indexOf(MARKER) + MARKER.length)];

  it('is the module\'s own output, byte for byte, under the header', () => {
    expect(file.includes(MARKER)).toBe(true);
    expect(body).toBe(seedSql());
  });

  it('says in its header whether it was applied', () => {
    expect(header).toMatch(/NOT applied yet|Applied \d{4}-\d{2}-\d{2}/);
  });

  it('inserts every row once, with the same hops the module holds', () => {
    const sql = stripSql(file);
    const blocks = [...sql.matchAll(/\$j\$([\s\S]*?)\$j\$::jsonb/g)].map(m => JSON.parse(m[1]));
    expect(blocks.length).toBe(rows.length);
    blocks.forEach((hops, i) => expect(hops, rows[i].key).toEqual(JSON.parse(JSON.stringify(rows[i].hops))));
    const keys = [...sql.matchAll(/uuid_ns_url\(\), '([^']+)'\)/g)].map(m => m[1]);
    expect(keys).toEqual(rows.map(r => 'wolfpack:travel_paths:pop:' + r.key));
  });

  it('is idempotent and touches only seed rows: conflict on id, update guarded by posted_by_discord_id is null', () => {
    const sql = stripSql(file);
    expect(sql).toMatch(/on conflict \(id\) do update/);
    expect(sql).toMatch(/where travel_paths\.posted_by_discord_id is null;\s*$/);
    // Only the statement text: the hop JSON and the quoted notes are prose ("the drop near Grummus").
    const statement = sql.replace(/\$j\$[\s\S]*?\$j\$/g, '').replace(/'(?:[^']|'')*'/g, "''");
    expect(statement).not.toMatch(/\b(drop|delete|truncate|alter|create)\b/i);
    expect(statement.match(/\binsert into\b/gi)).toHaveLength(1);
  });

  it('writes a null author on every row', () => {
    const sql = stripSql(file);
    const tails = [...sql.matchAll(/\$j\$::jsonb,\s*\n\s*'(?:[^']|'')*', (null|'[^']*')\)/g)].map(m => m[1]);
    expect(tails.length).toBe(rows.length);
    for (const t of tails) expect(t).toBe('null');
  });
});
