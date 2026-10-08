// test/vercel-deploy-branches.test.js — only main and beta build the website.
//
// Vercel's Hobby plan allows 100 deployments a day, and every push to every branch spends one. On
// 2026-09-29 the new `alpha` branch (a merge on every main and beta push) spent about 100 of them by
// itself, and b.wolfpack.quest went 90 minutes without a build ("Deployment rate limited — retry in 24
// hours"). The guild lead picked "main + beta only" the same day (DECISIONS 2026-09-21 §101).
//
// Run: npx vitest run test/vercel-deploy-branches.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_source-slice.js';

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'web/vercel.json'), 'utf8'));

describe('web/vercel.json deploys', () => {
  it('every branch is off, then main and beta are switched back on', () => {
    expect(cfg.git.deploymentEnabled).toEqual({ '**': false, main: true, beta: true });
  });
  // The same evening, Deployment Storage passed the Hobby 10 GB. Every finished build keeps its whole output
  // until retention removes it, and most main and beta pushes change the bot, the agent or the docs, not the
  // website. A push that leaves web/ alone now skips the build. A skipped build still counts toward the 100
  // a day, but it stores nothing.
  it('a push that changes nothing under web/ skips the build', () => {
    // Vercel builds on exit 1 and skips on 0; `git diff --quiet` exits 1 when something changed. The command
    // runs in the project root (web/), so "." is web/ — the site imports nothing from outside it.
    expect(cfg.ignoreCommand).toBe('git diff --quiet HEAD^ HEAD -- .');
  });
});
