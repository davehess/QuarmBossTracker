// test/zeal-pipe-peek.test.js — the verdict logic of the Zeal pipe checker.
//
// scripts/zeal-pipe-peek.js tells a Zeal build that carries PR #229 from one
// that doesn't. Getting the verdict wrong is expensive in a specific way: a
// false "does NOT carry the patch" sends someone chasing a bug that isn't
// there, and a false "carries" would have us tell an upstream maintainer the
// change is verified when it isn't.
//
// The rule under test: player.spawn_id is emitted UNCONDITIONALLY by the patch,
// so it alone decides. target_id and pet_id are omitted BY DESIGN when there is
// no target or no pet, so their absence must never count as evidence.
//
// Run: npx vitest run test/zeal-pipe-peek.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const { summarize } = require(path.join(ROOT, 'scripts', 'zeal-pipe-peek.js'));

const text = r => r.lines.join('\n');

describe('verdict', () => {
  it('patched build → pass', () => {
    const r = summarize({ player_spawn_id: 42 }, true, [1234]);
    expect(r.exitCode).toBe(0);
    expect(text(r)).toContain('CARRIES the patch');
  });

  it('stock build → fail, and says why', () => {
    const r = summarize({}, true, [1234]);
    expect(r.exitCode).toBe(1);
    expect(text(r)).toContain('does NOT carry the patch');
  });

  it('no player message → inconclusive, never a failure', () => {
    // Zeal not loaded or the pipe disabled is not evidence about the patch.
    const r = summarize({}, false, []);
    expect(r.exitCode).toBe(2);
    expect(text(r)).toContain('could not tell');
    expect(text(r)).toContain('/pipedelay 100');
  });

  // ⚠ The trap this guards. Both are omitted by design when you have no target
  // and no pet, so a patched build with neither must still report a pass.
  it('passes with NO target and NO pet — absence of those is by design', () => {
    const r = summarize({ player_spawn_id: 7 }, true, [1234]);
    expect(r.exitCode).toBe(0);
    expect(text(r)).toContain('target something and re-run');
    expect(text(r)).toContain('charm or summon a pet and re-run');
  });

  it('does NOT pass on target_id alone — spawn_id is the deciding key', () => {
    const r = summarize({ player_target_id: 156 }, true, [1234]);
    expect(r.exitCode).toBe(1);
  });

  it('reports raid ids with a member count, and group ids', () => {
    const r = summarize(
      { player_spawn_id: 42, raid_spawn_id: '42, 118', raid_count: 12, group_spawn_id: '42, 55' },
      true, [1234]);
    expect(text(r)).toContain('42, 118 (12 members)');
    expect(text(r)).toContain('group[].spawn_id');
    expect(r.exitCode).toBe(0);
  });

  it('names the pids it heard from, or says none', () => {
    expect(text(summarize({ player_spawn_id: 1 }, true, [111, 222]))).toContain('111, 222');
    expect(text(summarize({}, false, []))).toContain('none');
  });

  it('keeps the columns aligned so a glance is enough', () => {
    const r = summarize({ player_spawn_id: 42, player_target_id: 156 }, true, [1]);
    const marks = r.lines.filter(l => /^(player|raid|group)/.test(l))
      .map(l => l.search(/[✓✗—]/));
    expect(new Set(marks).size).toBe(1);
  });
});

describe('it reuses the real pipe reader', () => {
  it('does not reimplement the framing', () => {
    const src = require('node:fs').readFileSync(
      path.join(ROOT, 'scripts', 'zeal-pipe-peek.js'), 'utf8');
    // The pipe is concatenated JSON objects whose payload is double-encoded.
    // A hand-rolled reader gets both wrong; this must delegate.
    expect(src).toContain("require('../apps/mimic/zealPipe.js')");
    expect(src).not.toContain('function _extractJsonObjects');
  });

  it('unwraps the double-encoded payload', () => {
    const src = require('node:fs').readFileSync(
      path.join(ROOT, 'scripts', 'zeal-pipe-peek.js'), 'utf8');
    expect(src).toContain('JSON.parse(obj.data)');
  });
});
