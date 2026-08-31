// test/upstream-zeal-pr.test.js — the Zeal spawn-id PR material stays coherent.
//
// `docs/upstream/zeal-spawn-id/` holds two git-am-able patches plus pr-body.md,
// the text a human pastes into GitHub. Those two can drift, and the failure is
// externally visible in a way our own bugs are not: the guild lead files a PR
// whose description contradicts its own diff, on someone else's repo, once.
//
// This repo already knows that shape — "a ledger that lags its code" is a
// documented failure mode in CLAUDE.md. So the invariant is checked rather than
// remembered: the keys the patch emits and the keys the PR body advertises are
// the same set.
//
// Run: npx vitest run test/upstream-zeal-pr.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_source-slice.js';

const DIR = path.join(ROOT, 'docs', 'upstream', 'zeal-spawn-id');
const patches = fs.readdirSync(DIR).filter(f => f.endsWith('.patch')).sort();
const codePatch = fs.readFileSync(path.join(DIR, patches[0]), 'utf8');
// The single copy of the text that gets pasted into GitHub.
const prBody = fs.readFileSync(path.join(DIR, 'pr-body.md'), 'utf8');

// ⚠ A .patch file is PROSE + DIFF: the commit message sits above the first
// `diff --git`, and format-patch appends a `-- ` signature below. Asserting
// over the whole file matches the commit message — which is how the first cut
// of this test "found" a get_entity_by_id call that exists only in a sentence
// explaining why there isn't one. Same shape as CLAUDE.md's comments-satisfy-
// text-assertions rule. Slice the diff out first.
const diffBody = codePatch.slice(
  codePatch.indexOf('diff --git'),
  codePatch.lastIndexOf('\n-- \n'),
);
const added = diffBody.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'));

// A key is emitted as e.g. `raid_data["spawn_id"] = ...`.
const emitted = new Set(
  added.flatMap(l => [...l.matchAll(/\w+_data\["(\w+)"\]\s*=/g)].map(m => m[1])),
);

const EXPECTED = ['spawn_id', 'target_id', 'pet_id'];

describe('the Zeal PR patches', () => {
  it('ships exactly the two commits the PR body describes', () => {
    expect(patches).toHaveLength(2);
    expect(codePatch).toContain('named_pipe: emit spawn ids');
  });

  it('emits the three key names and nothing else', () => {
    expect([...emitted].sort()).toEqual([...EXPECTED].sort());
  });

  it('touches only named_pipe.cpp in the code commit', () => {
    const files = [...diffBody.matchAll(/^diff --git a\/(\S+)/gm)].map(m => m[1]);
    expect(files).toEqual(['Zeal/named_pipe.cpp']);
  });

  // The whole "additive only, nothing breaks" argument rests on this.
  it('is purely additive — no existing line is removed', () => {
    const removed = diffBody.split('\n')
      .filter(l => l.startsWith('-') && !l.startsWith('---'));
    expect(removed).toEqual([]);
  });

  it('sources every key from an Entity the loop already holds', () => {
    // No new spawn-list walk is the cost argument; a get_entity_by_id call
    // would still be O(1) but would contradict the body as written.
    //
    // ⚠ Assert on added CODE, not added lines. The patch's own comments explain
    // why zone_map.cpp can get away with a truthiness test on PetID — which
    // names get_entity_by_id — and a bare substring check cannot tell that
    // mention from a call. Same trap as CLAUDE.md's comments-satisfy-text-
    // assertions rule, one level in: here the prose lives inside the diff.
    const addedCode = added
      .map(l => l.slice(1))
      .filter(l => !l.trim().startsWith('//'))
      .join('\n');
    expect(addedCode).not.toContain('get_entity_by_id');
    expect(addedCode).not.toContain('get_entity_list');
    // ...and the stripping must not have eaten the code itself.
    expect(addedCode).toContain('player_data["spawn_id"]');
  });
});

// ⚠ This material is published under a PERSON'S name on someone else's repo,
// permanently. A stray address or tool marker in a patch's From: line is not a
// bug we can quietly fix later — it is in the upstream commit history forever.
// The first cut of these patches carried a private `+claude` address into a
// public repo, which is why this is checked mechanically now.
describe('the PR material leaks no identity', () => {
  const files = fs.readdirSync(DIR).map(f => [f, fs.readFileSync(path.join(DIR, f), 'utf8')]);

  it('reads the whole directory, not an empty list', () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  it('names no tool or vendor anywhere', () => {
    for (const [name, body] of files) {
      expect(`${name}: ${body}`.toLowerCase()).not.toContain('claude');
      expect(`${name}: ${body}`.toLowerCase()).not.toContain('anthropic');
    }
  });

  it('carries no real email address — noreply only', () => {
    for (const [name, body] of files) {
      const emails = [...body.matchAll(/[\w.+-]+@[\w.-]+\.\w+/g)].map(m => m[0]);
      const real = emails.filter(e => !e.endsWith('users.noreply.github.com')
                                   && !e.includes('example.com'));
      expect({ file: name, leaked: real }).toEqual({ file: name, leaked: [] });
    }
  });

  it('stamps both patches with the same non-bot author', () => {
    const froms = files.filter(([n]) => n.endsWith('.patch'))
      .map(([, b]) => /^From: (.+)$/m.exec(b)[1]);
    expect(froms).toHaveLength(2);
    expect(new Set(froms).size).toBe(1);
    expect(froms[0]).toMatch(/@users\.noreply\.github\.com>$/);
  });
});

describe('the PR body matches the patch', () => {
  it('advertises every key the patch emits', () => {
    for (const key of emitted) expect(prBody).toContain(`\`${key}\``);
  });

  it('advertises no key the patch does not emit', () => {
    // The body's Message/Key/Source table is the authoritative list. Scanning
    // the whole body instead would pick up prose: `zone_id` appears as an
    // example of an EXISTING verbose-gated field, not as something we add.
    const table = prBody.slice(prBody.indexOf('| Message | Key | Source |'));
    const rows = table.slice(0, table.indexOf('\n\n'));
    const claimed = new Set(
      [...rows.matchAll(/^\|[^|]+\|\s*`(\w+)`\s*\|/gm)].map(m => m[1]),
    );
    expect(claimed.size).toBeGreaterThan(0);          // not vacuous
    expect([...claimed].sort()).toEqual([...emitted].sort());
  });

  it('states the line count the diff actually has', () => {
    const n = added.filter(l => !l.startsWith('+++')).length;
    expect(prBody).toContain(`${n} added lines`);
  });

  it('names the base commit the patches are cut against', () => {
    const base = /From ([0-9a-f]{7})/.exec(codePatch);
    expect(base).toBeTruthy();
    // The patch's own parent, as recorded by format-patch's index line.
    expect(prBody).toContain('a5f5cbf');
  });

  // ⚠ Load-bearing honesty. We could not compile it, and the body must say so
  // — a maintainer discovering that themselves is how you lose the review.
  it('still says plainly that we have not compiled it', () => {
    expect(prBody).toMatch(/have not been able to compile it/i);
  });
});
