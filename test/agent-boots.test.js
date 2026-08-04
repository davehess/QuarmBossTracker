// The agent must actually START.
//
// This exists because it didn't. Agent v3.5.5 renamed the threat-snapshot
// interval constant (`_threatSnapMs` → `_threatSnapEnvMs` + a per-tick
// `_threatSnapCadenceMs()`) and left one reference behind, in the `setInterval`
// argument at the bottom of `startChatRelay`. That is not a degraded feature —
// `startChatRelay()` runs unguarded on the watch-mode path, so evaluating the
// argument threw a ReferenceError and the process died:
//
//   [boot] wolfpack-logsync v3.5.13 ready — watching 0 log file(s).
//   FATAL: ReferenceError: _threatSnapMs is not defined
//       at startChatRelay (packages/wolfpack-logsync/index.js:24196:6)
//       at main (packages/wolfpack-logsync/index.js:30577:5)
//
// Watch mode is the DEFAULT and the only mode raiders use, so every beta build
// from 3.5.5 to 3.5.14 was dead on arrival. It survived four releases because
// nothing we run — not the unit suite, not the golden log, not
// check:dashboard — ever executes the startup path. Everything imports the
// module and calls exported functions; `main()` was never invoked by a test.
//
// Two nets landed together, and they catch different things:
//   • `npm run lint` (no-undef) catches the undeclared identifier statically.
//     It flagged this the first time it was ever run against beta, because
//     until 2026-08-04 `beta` had NO CI at all.
//   • THIS test catches boot failure of any kind — a bad require, a throw in
//     module init, a port bind that rejects, a config parse that explodes.
//     Lint cannot see any of those.
//
// Deliberately asserts on the PROCESS, not on internals. "Does it start" has
// exactly one honest test.
//
// Run: npx vitest run test/agent-boots.test.js

import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AGENT = path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js');
const UP_MS = 6_000;   // long enough to clear module init + main(); short enough to run in CI

// Boot the agent in a throwaway cwd so its runtime files (queue, pet state)
// never touch the repo, and on a high port so a developer's own agent on 7777
// can't fail this for the wrong reason.
function bootAgent({ agentPath = AGENT, ms = UP_MS } = {}) {
  return new Promise((resolve) => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'wp-boot-'));
    writeFileSync(path.join(cwd, 'eqlog_Bootcheck_pq.proj.txt'),
      '[Sun Aug 02 21:10:01 2026] Welcome to EverQuest!\n');

    const child = spawn(process.execPath, [agentPath, '--watch', '--web-port', '17877'], {
      cwd, env: { ...process.env, WOLFPACK_TOKEN: '' }, stdio: ['ignore', 'pipe', 'pipe'],
    });

    let out = '';
    let settled = false;
    const done = (verdict) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      resolve({ ...verdict, out });
    };
    const onData = (buf) => {
      out += String(buf);
      // Any FATAL is a boot failure regardless of what preceded it — the
      // original bug printed the ready banner and THEN died.
      if (/\bFATAL\b/.test(out)) done({ ok: false, why: 'FATAL during boot' });
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (e) => done({ ok: false, why: 'spawn failed: ' + e.message }));
    child.on('exit', (code, signal) => {
      if (signal === 'SIGKILL') return;                 // we killed it: success
      done({ ok: false, why: `exited early (code=${code}, signal=${signal})` });
    });

    // Survived the window without dying → it booted.
    const timer = setTimeout(() => done({ ok: true, why: 'still running' }), ms);
  });
}

describe('agent boot smoke', () => {
  it('starts in watch mode and stays up', async () => {
    const r = await bootAgent();
    expect(r.ok, `agent did not stay up — ${r.why}\n--- output ---\n${r.out}`).toBe(true);
    // Prove we reached startup rather than passing on a silent process.
    expect(r.out, 'never printed the ready banner').toMatch(/wolfpack-logsync v[\d.]+ ready/);
    // startChatRelay() runs immediately AFTER that banner — the original crash
    // landed in the gap between these two assertions, which is exactly why the
    // banner alone is not sufficient evidence.
    expect(r.out).not.toMatch(/ReferenceError|TypeError|is not defined/);
  }, 30_000);

  // Self-check: reintroduce the exact 3.5.5 defect in a scratch copy and prove
  // the harness above reports it. Without this, a harness that silently always
  // returned ok:true would look identical to a passing suite.
  it('WOULD have caught the 3.5.5 crash (harness is not vacuous)', async () => {
    const src = readFileSync(AGENT, 'utf8');
    const broken = src.replace('  }, THREAT_SNAP_TICK_MS);', '  }, _threatSnapMs);');
    expect(broken, 'the interval call site moved — update this mutation').not.toBe(src);

    const dir = mkdtempSync(path.join(tmpdir(), 'wp-broken-'));
    const brokenPath = path.join(dir, 'index.js');
    writeFileSync(brokenPath, broken);

    const r = await bootAgent({ agentPath: brokenPath });
    expect(r.ok, 'the broken build must NOT pass the boot check').toBe(false);
    expect(r.out).toMatch(/_threatSnapMs is not defined/);
  }, 30_000);
});
