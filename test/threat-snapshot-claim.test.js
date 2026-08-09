// The by-boss threat-snapshot claim (fight-timeline step 2, bot 3.1.34).
//
// The measurement that forced this: 96 of 3,651 boss fights in 14 days had ANY
// bound snapshot (2.6%). Two causes, both structural:
//   1. the per-uploader claim binds only the SUBMITTING uploader's rows —
//      ~1 of ~12 people snapshotting a raid fight;
//   2. its 20s margin is smaller than the 22–56s clock skew measured on real
//      machines, so even the submitter's own claim could miss.
// The by-boss claim binds every uploader by NORMALIZED catalog name + a ±2min
// window — the same skirt the read-side join (encounter_timeline()) validated
// to full coverage on the last raid's top fights.
//
// Run: npx vitest run test/threat-snapshot-claim.test.js

import { describe, it, expect } from 'vitest';
import { npcDisplayName, claimThreatSnapshotsByBoss } from '../utils/supabase.js';

describe('npcDisplayName — catalog name → agent display form', () => {
  // Must stay in lockstep with SQL npc_display_name() (migration 20260809030000).
  it('underscores become spaces', () => {
    expect(npcDisplayName('Kaas_Thox_Xi_Ans_Dyek')).toBe('Kaas Thox Xi Ans Dyek');
  });
  it('# prefix (instanced spawns) is stripped', () => {
    expect(npcDisplayName('#Shei_Vinitras')).toBe('Shei Vinitras');
    expect(npcDisplayName('#Tukaarak_the_Warder')).toBe('Tukaarak the Warder');
  });
  it('trailing underscore variants trim clean', () => {
    expect(npcDisplayName('Shei_Vinitras_')).toBe('Shei Vinitras');
  });
  it('single-word bosses pass through', () => {
    expect(npcDisplayName('Talendor')).toBe('Talendor');
  });
  it('null/empty → empty string, never throws', () => {
    expect(npcDisplayName(null)).toBe('');
    expect(npcDisplayName('')).toBe('');
  });
});

describe('claimThreatSnapshotsByBoss — guard rails', () => {
  it('no-ops (returns 0) without required args, never throws', async () => {
    // Supabase env is not configured in the test runner, so even a fully-formed
    // call must resolve 0 rather than attempting network I/O.
    expect(await claimThreatSnapshotsByBoss({})).toBe(0);
    expect(await claimThreatSnapshotsByBoss({ encounterId: 'e', npcId: null, startedAtMs: Date.now() })).toBe(0);
    expect(await claimThreatSnapshotsByBoss({ encounterId: 'e', npcId: 5, startedAtMs: NaN })).toBe(0);
  });
});
