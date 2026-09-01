// test/zeal-version-capability.test.js — the BOT + BOARD half of "whose client
// can actually hand us a spawn id".
//
// Hitya, 2026-09-01: "let me start tracking zeal versions so we can work
// towards knowing when someone has that Target and spawn ID. fall back is if
// they tag."
//
// ⚠ THE CENTRAL POINT, and the reason these are two fields rather than one:
// THE VERSION CANNOT ANSWER THE CAPABILITY QUESTION. Zeal PR #229 is not
// released, and a build carrying it reports the SAME version string as a stock
// build of the same release. A version test would call a capable client
// incapable — so the board branches on the OBSERVED fact, and the version is
// only ever used to chase adoption.
//
// ⚠ The agent half (the latch that produces these facts) is on `beta`, in
// test/zeal-capability-agent.test.js — the agent ships from there, so its test
// has to as well.
//
// Run: npx vitest run test/zeal-version-capability.test.js

import { describe, it, expect } from 'vitest';
import { readSource, ROOT, BOT_INDEX, sliceBlock, stripJs } from './_source-slice.js';
import path from 'node:path';

// ── The bot's ingest side ───────────────────────────────────────────────────
describe('the bot records both facts off agent_state', () => {
  const bot = stripJs(readSource(BOT_INDEX));

  // No call site changed: agent_state already decorates every tracked upload,
  // so reading the two fields off it costs nothing at the ~15 places that call
  // _trackUpload. (live-state is deliberately NOT tracked, which is exactly why
  // the agent latches on its pipe intake rather than on that upload.)
  it('reads them off agent_state rather than a new parameter', () => {
    const fn = sliceBlock(bot, 'function _trackUpload(', '\n}\n');
    expect(fn).toContain('agentState.zeal_version');
    expect(fn).toContain('agentState.spawn_id_capable');
    // ...and neither the signature nor any call site mentions Zeal.
    const sigAt = bot.indexOf('function _trackUpload(');
    expect(bot.slice(sigAt, bot.indexOf(')', sigAt))).not.toMatch(/zeal/i);
    expect(bot).not.toMatch(/_trackUpload\(\s*\{[^}]*zeal/i);
  });

  it('passes them to the stat bump under the names the RPC declares', () => {
    const fn = sliceBlock(bot, 'function _trackUpload(', '\n}\n');
    expect(fn).toContain('p_zeal_version:');
    expect(fn).toContain('p_spawn_id_seen:');
  });

  // A version string is client-supplied text on an authenticated but
  // member-operated endpoint; it lands in a text column officers read.
  it('bounds the version string rather than trusting its length', () => {
    const fn = sliceBlock(bot, 'function _trackUpload(', '\n}\n');
    expect(fn).toMatch(/String\(agentState\.zeal_version\)\.slice\(0, \d+\)/);
  });

  // ⚠ THE bug this design exists to avoid: a patched Zeal reports the same
  // version string as a stock one, so any version test would call a capable
  // client incapable.
  it('capability is a SEPARATE field from the version, never derived from it', () => {
    const fn = sliceBlock(bot, 'function _trackUpload(', '\n}\n');
    // Asserted on the LINE, not the function: a `>=` check anywhere in the
    // function is only one of many ways to spell "infer it from the version",
    // and the ones that don't use `>=` (a regex on the string, a lookup table)
    // are exactly as wrong. The line may not mention a version at all.
    const line = fn.split('\n').find(l => l.includes('p_spawn_id_seen'));
    expect(line).toBeTruthy();
    expect(line).toContain('spawn_id_capable');
    expect(line).not.toMatch(/version/i);
  });
});

// ── The officer-facing board ────────────────────────────────────────────────
describe('/admin/agents shows it honestly', () => {
  const page = stripJs(readSource(path.join(ROOT, 'web', 'app', 'admin', 'agents', 'page.tsx')));

  it('reads both columns off agent_upload_stats', () => {
    const sel = sliceBlock(page, "      .from('agent_upload_stats')", '\n      .order(');
    expect(sel).toContain('zeal_version');
    expect(sel).toContain('spawn_id_seen_at');
  });

  // ⚠ Hitya, 2026-08-16: "character counts mean almost nothing." One person
  // runs 3-12 boxes off ONE Zeal install, so a character count overstates
  // adoption ~10x — the exact mistake that made "178 characters on 3.5.80"
  // read as fleet-wide when it was 16 people. A family here IS a player.
  it('counts adoption in PLAYERS, not characters', () => {
    const block = sliceBlock(page, '  const zealPlayers', '\n  const zealVersions');
    expect(block).toContain('activeFamilies');
    // `active` / `summaries` are the per-CHARACTER lists. Neither may appear.
    expect(block).not.toMatch(/\bactive\.filter|\bsummaries\.filter|\bactive\.length\b/);
  });

  // ⚠ THE bug this design exists to avoid: a patched Zeal reports the same
  // version string as a stock one, so any version test would call a capable
  // client incapable.
  it('never derives capability from the version', () => {
    const block = sliceBlock(page, '  const zealPlayers', '\n  const zealVersions');
    // Same reasoning as the bot's: assert the capability LINE, since a version
    // comparison is only one spelling of the mistake.
    const line = block.split('\n').find(l => l.includes('capablePlayers'));
    expect(line).toBeTruthy();
    expect(line).toContain('f.spawnIdSeenAt');
    expect(line).not.toMatch(/version/i);
  });

  // A character's newest endpoint row may predate these columns while an older
  // row on the same character holds the proof — so the fold has to sweep every
  // row, not ride the newest-endpoint branch that agent_version uses.
  it('folds the Zeal facts across every row, not just the newest endpoint', () => {
    // Asserted by INDENT, which is what actually distinguishes the two: the
    // newest-endpoint branch bodies sit at six spaces, the per-row loop at
    // four. A containment check can't tell them apart, because the fold sits
    // between the branch and the totals either way.
    expect(page).toContain('\n    if (r.zeal_version) s.zealVersion = r.zeal_version;');
    expect(page).toContain('\n    if (r.spawn_id_seen_at && ');
    expect(page).not.toContain('\n      if (r.zeal_version)');
    expect(page).not.toContain('\n      if (r.spawn_id_seen_at');
    // ...and still inside the loop, before the counters it sits beside.
    const foldAt   = page.indexOf('if (r.zeal_version) s.zealVersion');
    const branchAt = page.indexOf('if (ts >= s.lastUploadMs) {');
    const totalsAt = page.indexOf('s.totalUploads += Number(r.upload_count)');
    expect(branchAt).toBeGreaterThan(-1);
    expect(foldAt).toBeGreaterThan(branchAt);
    expect(foldAt).toBeLessThan(totalsAt);
  });

  // One proven character proves the install; a sibling that has not been in a
  // fight must not drag the family back to "never seen".
  it('a family is capable when ANY of its characters is', () => {
    expect(page).toContain('if (s.spawnIdSeenAt && (!f.spawnIdSeenAt || s.spawnIdSeenAt > f.spawnIdSeenAt)) f.spawnIdSeenAt = s.spawnIdSeenAt;');
  });

  // Absence of proof is not proof of absence: an unproven client may be stock
  // Zeal OR a patched one that has not fought yet. Rendering that as a red
  // failure would send officers chasing people with nothing to fix.
  it('does not render "not yet proven" as a failure', () => {
    const chip = sliceBlock(page, 'function ZealChip(', '\nfunction Stat(');
    expect(chip).not.toMatch(/text-red|incapable|✗|❌/);
    expect(chip).toContain("hasn't been in a fight");
  });
});
