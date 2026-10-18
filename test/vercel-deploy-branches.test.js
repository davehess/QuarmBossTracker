// test/vercel-deploy-branches.test.js — only a push that changes web/ builds the website.
//
// Vercel's Hobby plan allows 100 deployments a day, and every push Vercel sees spends one, even one its
// Ignored Build Step skips. 2026-09-29: the alpha branch's sync merges spent ~100 (§101, main + beta only).
// 2026-10-14: the cap was hit again with only 15 real website builds among the 100 — beta sync merges, docs,
// Mimic/agent and bot pushes spent the rest. The guild lead picked B: Vercel's own Git deployments OFF for
// every branch, and a GitHub workflow calls the branch's Deploy Hook only when web/ changed (§333).
//
// Run: npx vitest run test/vercel-deploy-branches.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_source-slice.js';

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'web/vercel.json'), 'utf8'));
const read = (f) => fs.readFileSync(path.join(ROOT, '.github/workflows', f), 'utf8');
// Comments explain the hooks at length, so assert on the YAML with them stripped.
const strip = (s) => s.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
const deploy = strip(read('deploy-web.yml'));
const sync = strip(read('sync-beta.yml'));

describe('web/vercel.json', () => {
  it('Vercel builds nothing on its own from a Git push', () => {
    expect(cfg.git.deploymentEnabled).toBe(false);
  });
  it('has no Ignored Build Step: the workflow decides, and a hook build must not be skipped by a later non-web commit', () => {
    expect(cfg.ignoreCommand).toBeUndefined();
  });
});

describe('deploy-web.yml', () => {
  it('runs on pushes to main and beta that touch web/', () => {
    expect(deploy).toMatch(/branches:\s*\[main,\s*beta\]/);
    expect(deploy).toMatch(/paths:\s*\['web\/\*\*'\]/);
  });
  it('calls the branch\'s own hook and fails loudly when its secret is missing', () => {
    expect(deploy).toMatch(/main\) HOOK="\$HOOK_MAIN"/);
    expect(deploy).toMatch(/beta\) HOOK="\$HOOK_BETA"/);
    expect(deploy).toMatch(/secrets\.VERCEL_DEPLOY_HOOK_MAIN/);
    expect(deploy).toMatch(/secrets\.VERCEL_DEPLOY_HOOK_BETA/);
    expect(deploy).toMatch(/::error::[\s\S]*exit 1/);
  });
});

describe('sync-beta.yml', () => {
  it('rebuilds b.wolfpack.quest itself when its merge brought web/ changes (a GITHUB_TOKEN push triggers no workflow)', () => {
    expect(sync).toMatch(/BETA_BEFORE="\$\(git rev-parse HEAD\)"/);
    expect(sync).toMatch(/git diff --quiet "\$BETA_BEFORE" HEAD -- web\//);
    expect(sync).toMatch(/curl -fsS -X POST "\$HOOK_BETA"/);
    expect(sync).toMatch(/HOOK_BETA:\s*\$\{\{\s*secrets\.VERCEL_DEPLOY_HOOK_BETA\s*\}\}/);
  });
});
