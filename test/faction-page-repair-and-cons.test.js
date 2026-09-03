// test/faction-page-repair-and-cons.test.js — every faction row can open into
// what is unconfirmed, what has been conned on it, and what repairs it.
//
// Hitya, 2026-09-03: "add the repair table to factions, but also we can have
// an 'unconfirmed hits' section on the table also. The Conning of npcs on
// those factions is important."
//
// The cons are the load-bearing part. A hit count says which way a faction
// moved; a /con is the only log-visible read of where it actually IS. The page
// already resolved each con'd mob to its primary faction — it just showed them
// in one flat table at the bottom, nowhere near the faction they pin.
//
// Repair sources come from eqemu_npc_faction_entries (value > 0), validated on
// live rows: Heart of Seru → Grieg Veneficus +1000 (Grieg's End), Lcea Katta
// +500, Praesertum ×4 +200. One character's 55 factions produce 5,434 source
// rows, 512 on the largest, so the read is PAGED and capped in JS.
//
// Stripped-source assertions (TSX). Comments stripped first — this file's own
// prose would satisfy a naive toContain.
//
// Run: npx vitest run test/faction-page-repair-and-cons.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';

const raw   = fs.readFileSync(path.join(ROOT, 'web', 'app', 'character', '[name]', 'factions', 'page.tsx'), 'utf8');
const clean = stripJs(raw);
const loadFn = clean.slice(clean.indexOf('async function load('), clean.indexOf('export default async function'));

describe('the three sub-blocks on a faction row', () => {
  it('unconfirmed hits = count minus priced, per direction', () => {
    expect(clean).toMatch(/const unB = Math\.max\(0, f\.better_count - \(f\.better_priced \?\? 0\)\)/);
    expect(clean).toMatch(/const unW = Math\.max\(0, f\.worse_count\s+- \(f\.worse_priced\s+\?\? 0\)\)/);
    expect(clean).toMatch(/Unconfirmed hits/);
  });

  it('cons are grouped by the faction they pin, best tier first', () => {
    expect(loadFn).toMatch(/const consByFaction = new Map<string, ConEnriched\[\]>\(\)/);
    expect(loadFn).toMatch(/if \(!c\.factionName\) continue;/);
    expect(loadFn).toMatch(/arr\.sort\(\(a, b\) => \(\(b\.rank \?\? -1\) - \(a\.rank \?\? -1\)\) \|\| b\.eventTs\.localeCompare\(a\.eventTs\)\)/);
    expect(clean).toMatch(/Cons on this faction/);
  });

  it('repair sources are only kills that RAISE the faction', () => {
    expect(loadFn).toMatch(/\.in\('faction_id', fids\)\.gt\('value', 0\)/);
    expect(clean).toMatch(/Repair — kills that raise it/);
  });
});

describe('the repair list is honest about its size', () => {
  it('sorts best value first', () => {
    expect(loadFn).toMatch(/dedup\.sort\(\(a, b\) => b\.value - a\.value \|\| a\.mob\.localeCompare\(b\.mob\)\)/);
  });

  it('caps per faction and REPORTS what it cut', () => {
    // "top 8" must never read as "all 8".
    expect(loadFn).toMatch(/const REPAIR_TOP = 8;/);
    expect(loadFn).toMatch(/top: dedup\.slice\(0, REPAIR_TOP\), more: Math\.max\(0, dedup\.length - REPAIR_TOP\)/);
    expect(clean).toMatch(/\{rep\.more > 0 && <li className="text-dim">\+\{rep\.more\} more at lower values<\/li>\}/);
  });

  it('collapses instanced # variants to one line per (mob, value)', () => {
    expect(loadFn).toMatch(/\.replace\(\/\^#\/, ''\)\.replace\(\/_\/g, ' '\)/);
    expect(loadFn).toMatch(/const k = `\$\{r\.mob\.toLowerCase\(\)\}\|\$\{r\.value\}`/);
  });
});

describe('the reads survive the 1000-row cap', () => {
  it('drains both catalog reads through the paginator with a stable order', () => {
    // Un-paged, 5,434 rows come back as 1,000 and the page looks thin, not broken.
    // Three reads: the faction-name → id table (2,123 rows — a bare limit
    // silently dropped some of a 55-faction character's factions), the
    // entries, and the mobs.
    const calls = loadFn.match(/selectAll<(?:FL|Entry|Npc)>\(\(from, to\) =>/g) || [];
    expect(calls).toHaveLength(3);
    expect(loadFn).toMatch(/sb\.from\('eqemu_faction_list_full'\)\.select\('id, name'\)\.order\('id', \{ ascending: true \}\)\.range\(from, to\)/);
    expect(loadFn).toMatch(/\.order\('npc_faction_id', \{ ascending: true \}\)\.order\('faction_id', \{ ascending: true \}\)\s*\.range\(from, to\)/);
    expect(loadFn).toMatch(/\.in\('npc_faction_id', nfids\)\s*\.order\('id', \{ ascending: true \}\)\s*\.range\(from, to\)/);
  });

  it('never pages a repair read with a bare over-cap limit', () => {
    const repairSlice = loadFn.slice(loadFn.indexOf('const REPAIR_TOP'), loadFn.indexOf('const consByFaction'));
    expect(repairSlice).not.toMatch(/eqemu_npc_faction_entries[\s\S]{0,200}\.limit\(/);
    expect(repairSlice).not.toMatch(/eqemu_npc_types[\s\S]{0,200}\.limit\(/);
  });
});
