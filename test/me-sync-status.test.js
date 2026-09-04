// test/me-sync-status.test.js — the /me "is Mimic connected" banner and the
// per-character sync grid (Hitya, 2026-09-04: "the parser was syncing message
// is wrong, mimic is on and i'm on Hitya now" · "anyone that has no uploads
// should be grouped into a collapsed section that you can open up. Sort by
// how recently it was seen or uploaded/updated").
//
// The wrong message came from keying "last seen" on the ENCOUNTER stream:
// Mimic streams faction, inventory, quarmy and chat between fights, so the
// character was minutes fresh on four streams and 29 minutes stale on the one
// the banner read. One paged read across every endpoint fixes it; the last
// fight stays available for the sub-line.
//
// Stripped-source assertions — the file's comments quote the very strings a
// naive toContain would match.
//
// Run: npx vitest run test/me-sync-status.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';

const raw = fs.readFileSync(path.join(ROOT, 'web', 'app', 'me', 'page.tsx'), 'utf8');
const me = stripJs(raw);
const loader = stripJs(raw.slice(raw.indexOf('async function loadSyncHeartbeats('), raw.indexOf('// ── "The Scrap"')));

describe('loadSyncHeartbeats', () => {
  it('reads every stream in one paged read, not the encounter endpoint per character', () => {
    expect(loader).not.toMatch(/\.eq\('endpoint', 'encounter'\)/);
    expect(loader).not.toMatch(/\.maybeSingle\(\)/);
    expect(loader).toMatch(/selectAll<StatRow>/);
    expect(loader).toMatch(/\.select\('character, endpoint, last_uploaded_at, agent_version'\)/);
    expect(loader).toMatch(/character\.ilike\./);
  });

  it('last seen is the freshest stream; last fight is the encounter stream', () => {
    expect(loader).toMatch(/if \(at >= cur\.lastSeen\) \{ cur\.lastSeen = at;/);
    expect(loader).toMatch(/r\.endpoint === 'encounter' && \(!cur\.lastFight \|\| at > cur\.lastFight\)/);
  });
});

describe('the banner', () => {
  it('speaks Mimic and carries the last fight on the sub-line', () => {
    expect(me).toMatch(/Mimic is connected on \$\{live\[0\]\.name\}\./);
    expect(me).toMatch(/last fight uploaded \$\{relTime\(lastFight\)\}/);
    expect(me).toMatch(/Mimic was connected earlier today but isn\\'t right now\./);
    expect(me).not.toMatch(/Re-launch Parser\.bat/);
    expect(me).not.toMatch(/Parser is syncing/);
  });

  it('status comes from lastSeen', () => {
    expect(me).toMatch(/const age = now - new Date\(hb\.lastSeen\)\.getTime\(\);/);
    expect(me).toMatch(/const everSynced {2}= syncRows\.filter\(r => r\.lastSeen\)\.length;/);
  });
});

describe('the character grid', () => {
  it('sorts seen characters newest first and collapses the never-uploaded', () => {
    expect(me).toMatch(/const seenRows {2}= syncRows\.filter\(r => r\.lastSeen\)\.sort\(\(a, b\) => b\.lastSeen!\.localeCompare\(a\.lastSeen!\)/);
    expect(me).toMatch(/const neverRows = syncRows\.filter\(r => !r\.lastSeen\)/);
    expect(me).toMatch(/\{neverRows\.length\} character\{neverRows\.length === 1 \? '' : 's'\} with no uploads/);
    expect(me).toMatch(/<details className="mt-2 text-xs">/);
    expect(me).toMatch(/\{seenRows\.map\(r => <SyncCard key=\{r\.name\} \{\.\.\.r\} \/>\)\}/);
  });
});
