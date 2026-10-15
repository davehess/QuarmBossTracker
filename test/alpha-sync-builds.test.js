// test/alpha-sync-builds.test.js — beta's Mimic/agent changes must reach alpha INSTALLS, not just the alpha branch.
//
// 2026-10-15: sync-alpha.yml merged four beta fixes into alpha, but its GITHUB_TOKEN push never starts
// `on: push` workflows, so the rolling alpha release stayed a day behind. sync-alpha now dispatches
// release-mimic.yml on alpha when alpha's Mimic or agent differs from the `mimic-alpha` build, and a
// dispatch on alpha takes the alpha path in release-mimic. YAML comments are stripped before matching.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT } from './_source-slice.js';

const strip = (s) => s.replace(/^[ \t]*#.*$/gm, '');
const sync = strip(readSource(path.join(ROOT, '.github', 'workflows', 'sync-alpha.yml')));
const release = strip(readSource(path.join(ROOT, '.github', 'workflows', 'release-mimic.yml')));

describe('sync-alpha starts the alpha build', () => {
  it('may start workflows (actions: write) and dispatches release-mimic on alpha', () => {
    expect(sync).toMatch(/actions:\s*write/);
    expect(sync).toMatch(/gh workflow run release-mimic\.yml[^\n]*--ref alpha/);
  });
  it('only when alpha\'s Mimic or agent differs from the mimic-alpha build', () => {
    expect(sync).toMatch(/git diff --quiet refs\/tags\/mimic-alpha origin\/alpha -- apps\/mimic packages\/wolfpack-logsync/);
  });
});

describe('release-mimic: a dispatch on alpha builds the alpha', () => {
  it('the manual-tag path is skipped on the alpha branch', () => {
    expect(release).toMatch(/"workflow_dispatch" \] && \[ "\$\{\{ github\.ref_name \}\}" != "alpha" \]/);
  });
});
