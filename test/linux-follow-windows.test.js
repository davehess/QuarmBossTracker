// The guild lead, 2026-10-08: "Linux client needs to be revisioned when we revision the Windows client" (option A:
// every Windows beta or stable cut is followed by a Linux build on the same base version).
//
// .github/workflows/linux-follow-windows.yml merges the Windows commit into the Deck branch and dispatches the Linux
// build. These checks pin the wiring that makes that true, because a workflow that parses but is mis-wired looks
// exactly like one that works (workflow-yaml.test.js only proves it parses):
//   - it listens for the Windows workflow by its real `name:` (a typo means it never fires, silently);
//   - it lives on main's copy of the file set, and build-mimic-linux.yml is on main too, because `gh workflow run`
//     only finds a workflow file that exists on the default branch;
//   - only the two version files may take the Windows side on a conflict;
//   - the Linux build reads its base version from package.json (so merging the Windows version in IS the revision).
//
// Run: npx vitest run test/linux-follow-windows.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as yamlLoad } from 'js-yaml';

const WF = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows');
const read = (f) => fs.readFileSync(path.join(WF, f), 'utf8');
const follow = yamlLoad(read('linux-follow-windows.yml'));
const release = yamlLoad(read('release-mimic.yml'));
const linux = yamlLoad(read('build-mimic-linux.yml'));
const noComments = (s) => s.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');

describe('Linux follows Windows', () => {
  it('listens for the Windows release workflow by its real name, on main and beta, once it has finished', () => {
    const wr = follow.on.workflow_run;
    expect(wr.workflows).toEqual([release.name]);
    expect(wr.types).toEqual(['completed']);
    expect(wr.branches).toEqual(['main', 'beta']);
  });

  it('only acts on a successful Windows run (or a manual dispatch)', () => {
    const cond = follow.jobs.follow.if;
    expect(cond).toMatch(/workflow_run\.conclusion == 'success'/);
    expect(cond).toMatch(/workflow_dispatch/);
  });

  it('merges into the Deck branch and dispatches the Linux build on that same branch', () => {
    const src = noComments(read('linux-follow-windows.yml'));
    expect(follow.env.DECK_BRANCH).toBe('claude/deck-156-refresh');
    expect(src).toMatch(/git merge --no-edit -m "mimic: merge the Windows cut into the Linux \/ Deck line \[sync\]" "\$WIN_REF"/);
    expect(src).toMatch(/git push origin "\$DECK_BRANCH"/);
    expect(src).toMatch(/gh workflow run build-mimic-linux\.yml --ref "\$DECK_BRANCH"/);
  });

  it('lets ONLY the two version files take the Windows side on a conflict; any other conflict aborts', () => {
    const src = noComments(read('linux-follow-windows.yml'));
    expect(src).toMatch(/VERSION_FILES="apps\/mimic\/package\.json packages\/wolfpack-logsync\/package\.json"/);
    expect(src).toMatch(/git checkout --theirs -- "\$f"/);
    expect(src).toMatch(/git merge --abort; exit 1/);
  });

  it('a stable cut on main follows THROUGH beta: waits for sync-beta to carry the commit, then merges beta', () => {
    const src = noComments(read('linux-follow-windows.yml'));
    expect(src).toMatch(/HEAD_BRANCH: \$\{\{ github\.event\.workflow_run\.head_branch \}\}/);
    expect(src).toMatch(/if \[ "\$HEAD_BRANCH" = "main" \]; then VIA_BETA=1; fi/);
    expect(src).toMatch(/git merge-base --is-ancestor "\$MAIN_REF" origin\/beta/);
    expect(src).toMatch(/WIN_REF="origin\/beta"/);
    expect(src).toMatch(/beta never received \$MAIN_REF/);
  });

  it('runs one at a time and may write the Deck branch and dispatch workflows', () => {
    expect(follow.concurrency.group).toBe('linux-follow-windows');
    expect(follow.concurrency['cancel-in-progress']).toBe(false);
    expect(follow.permissions).toMatchObject({ contents: 'write', actions: 'write' });
  });

  it('the Linux build can be dispatched, is not triggered by main or beta pushes, and reads its base from package.json', () => {
    expect(Object.keys(linux.on)).toContain('workflow_dispatch');
    expect(linux.on.push.branches).toEqual(['claude/**']);
    const src = noComments(read('build-mimic-linux.yml'));
    expect(src).toMatch(/require\('\.\/package\.json'\)\.version\.split\('-'\)\[0\]/);
    expect(src).toMatch(/-linux\.\$\{\{ github\.run_number \}\}/);
  });

  it('prunes old -linux.N releases after a build (the 10-entry releases.atom guard)', () => {
    expect(linux.jobs.prune.uses).toBe('./.github/workflows/prune-linux-releases.yml');
    expect(linux.jobs.prune.with.keep).toBe('2');
  });
});
