// test/raid-swap-return.test.js — a character swap ENDS when they log back in.
//
// The swap marker exists because the EQ raid window keeps listing people who
// camped: when one client logs Bwavair out and Bardtholemu in, /raid must park
// Bwavair as "(swapped to Bardtholemu)" rather than counting a body that isn't
// there. That part works.
//
// What it never did was notice the return. The marker was honoured for a flat
// six hours, so a character who logged back in on their OWN machine stayed
// filed under "Not seen / offline" with their raid group stripped.
//
// Live case (Hitya, 2026-08-14): Bwavair is Bardtholemu's wife and plays her own
// cleric; he had played her toon on his client earlier, stamping a legitimate
// swap at 00:12. At 02:59 she was in Group 2 with her position updating every
// second, while Bardtholemu was simultaneously in Group 8 at a different loc —
// which one client cannot do — and /raid still showed her offline. A cleric
// disappearing from the raid view is the expensive version of this bug.
//
// The discriminator is POSITION, not presence. Zeal's raid stream reads loc off
// a live `Entity*`, so only someone actually in the zone has one; the raid
// window lists campers, but campers have no position. See swapFor in
// web/app/raid/page.tsx.
//
// Run: npx vitest run test/raid-swap-return.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_source-slice.js';

const page = fs.readFileSync(path.join(ROOT, 'web', 'app', 'raid', 'page.tsx'), 'utf8');

// Mirror of the shipped swapFor. The source assertions below keep it honest.
const SWAP_FRESH_MS = 6 * 60 * 60 * 1000;
const SWAP_BACK_GRACE_MS = 30 * 1000;

function buildBackOnline(rosterRows) {
  const m = new Map();
  for (const r of rosterRows) {
    const stamp = r.loc_at || (r.hp_pct != null ? r.captured_at : null);
    if (!stamp) continue;
    const t = new Date(stamp).getTime();
    if (!Number.isFinite(t)) continue;
    const k = r.name.toLowerCase();
    if (t > (m.get(k) ?? 0)) m.set(k, t);
  }
  return m;
}

function swapFor(live, lower, backOnlineAt, now = Date.now()) {
  if (!live?.swapped_to || !live.swapped_at) return null;
  const swappedMs = new Date(live.swapped_at).getTime();
  if (now - swappedMs >= SWAP_FRESH_MS) return null;
  const backMs = backOnlineAt.get(lower) ?? 0;
  if (backMs > swappedMs + SWAP_BACK_GRACE_MS) return null;
  return live.swapped_to;
}

const NOW = Date.parse('2026-08-14T02:59:00Z');
const at = msAgo => new Date(NOW - msAgo).toISOString();
const bwavairLive = { swapped_to: 'Bardtholemu', swapped_at: at(2 * 3600_000 + 46 * 60_000) };

describe('the swap still parks someone who really did camp', () => {
  it('holds while the swapped-away character has no position', () => {
    // Seconds after the swap: their entity is gone, so no roster row carries a
    // loc for them. Only the person who took the client over has one.
    const back = buildBackOnline([
      { name: 'Bardtholemu', loc_at: at(1000), hp_pct: 77, captured_at: at(1000) },
    ]);
    expect(swapFor({ swapped_to: 'Bardtholemu', swapped_at: at(5000) }, 'bwavair', back, NOW))
      .toBe('Bardtholemu');
  });

  it('ignores a position stamped BEFORE the swap', () => {
    // The last in-flight sample from just before they camped must not cancel
    // the swap it precedes.
    const back = buildBackOnline([
      { name: 'Bwavair', loc_at: at(70_000), hp_pct: null, captured_at: at(70_000) },
    ]);
    expect(swapFor({ swapped_to: 'Bardtholemu', swapped_at: at(60_000) }, 'bwavair', back, NOW))
      .toBe('Bardtholemu');
  });

  it('rides out a sample inside the grace window', () => {
    // Snapshots arrive ~1/sec per uploader, so one can land just after the
    // swap is stamped while EQ has not caught up.
    const back = buildBackOnline([
      { name: 'Bwavair', loc_at: at(60_000 - 5_000), hp_pct: null, captured_at: at(55_000) },
    ]);
    expect(swapFor({ swapped_to: 'Bardtholemu', swapped_at: at(60_000) }, 'bwavair', back, NOW))
      .toBe('Bardtholemu');
  });

  it('expires on its own after six hours', () => {
    expect(swapFor({ swapped_to: 'Bardtholemu', swapped_at: at(7 * 3600_000) }, 'bwavair', new Map(), NOW))
      .toBeNull();
  });

  it('is null when there was never a swap', () => {
    expect(swapFor({ swapped_to: null, swapped_at: null }, 'bwavair', new Map(), NOW)).toBeNull();
    expect(swapFor(undefined, 'bwavair', new Map(), NOW)).toBeNull();
    // A swapped_to with no timestamp cannot be aged, so it is not trusted.
    expect(swapFor({ swapped_to: 'Bardtholemu', swapped_at: null }, 'bwavair', new Map(), NOW)).toBeNull();
  });
});

describe('the swap ENDS when they are demonstrably back', () => {
  it('Bwavair, live in Group 2 two hours after the swap', () => {
    const back = buildBackOnline([
      { name: 'Bwavair', loc_at: at(1000), hp_pct: 100, captured_at: at(1000) },
    ]);
    expect(swapFor(bwavairLive, 'bwavair', back, NOW)).toBeNull();
  });

  it('accepts HP as proof when a row has HP but no position', () => {
    // hp_pct is entity-derived too (the group window), so it counts.
    const back = buildBackOnline([
      { name: 'Bwavair', loc_at: null, hp_pct: 100, captured_at: at(1000) },
    ]);
    expect(swapFor(bwavairLive, 'bwavair', back, NOW)).toBeNull();
  });

  it('does NOT accept mere presence in the raid window', () => {
    // The whole reason the marker exists: EQ keeps listing campers, so a row
    // with neither a position nor HP proves nothing.
    const back = buildBackOnline([
      { name: 'Bwavair', loc_at: null, hp_pct: null, captured_at: at(1000) },
    ]);
    expect(swapFor(bwavairLive, 'bwavair', back, NOW)).toBe('Bardtholemu');
  });

  it('takes the FRESHEST sighting across uploaders, not the first', () => {
    // Twenty Mimic clients each upload their own snapshot; an old one from a
    // client that has since gone quiet must not decide this.
    const back = buildBackOnline([
      { name: 'Bwavair', loc_at: at(3 * 3600_000), hp_pct: null, captured_at: at(3 * 3600_000) },
      { name: 'Bwavair', loc_at: at(2000), hp_pct: null, captured_at: at(2000) },
    ]);
    expect(swapFor(bwavairLive, 'bwavair', back, NOW)).toBeNull();
  });

  it('two bodies in two groups at once is not one client', () => {
    // The observation that made the call obvious: both were moving, in
    // different groups, at different locs, at the same instant.
    const back = buildBackOnline([
      { name: 'Bwavair',     loc_at: at(500), hp_pct: 100, captured_at: at(500) },
      { name: 'Bardtholemu', loc_at: at(500), hp_pct: 77,  captured_at: at(500) },
    ]);
    expect(swapFor(bwavairLive, 'bwavair', back, NOW)).toBeNull();
    expect(back.get('bwavair')).toBe(back.get('bardtholemu'));
  });

  it('only clears the person who returned', () => {
    const back = buildBackOnline([
      { name: 'Someoneelse', loc_at: at(1000), hp_pct: 100, captured_at: at(1000) },
    ]);
    expect(swapFor(bwavairLive, 'bwavair', back, NOW)).toBe('Bardtholemu');
  });
});

describe('the shipped page does what this models', () => {
  it('selects loc_at from raid_roster', () => {
    expect(page).toMatch(/\.select\('name, class, group_num, level, rank, hp_pct, captured_at, loc_at/);
  });

  it('builds proof-of-life from loc_at, falling back to HP', () => {
    expect(page).toMatch(/const stamp = r\.loc_at \|\| \(r\.hp_pct != null \? r\.captured_at : null\)/);
  });

  it('clears the swap on a return newer than swapped_at plus the grace', () => {
    expect(page).toMatch(/backMs > swappedMs \+ SWAP_BACK_GRACE_MS/);
  });

  it('a parked row still loses its group — the fix must not have removed that', () => {
    expect(page).toMatch(/raidGroup: swappedTo \? null :/);
    expect(page).toMatch(/inRaid: !swappedTo/);
  });
});
