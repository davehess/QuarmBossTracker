// The crash card says which Zeal build a crash happened on (the guild lead, 2026-10-04: "i've had a
// number of zeal crashes lately that i can't tell if they're from my test versions or from the main
// version"). The crash dialog's "Zeal Version" line is "1.4.8 (<label>)": a bare short hash is an
// official release (create_release.yml), "testall-<hash>" our fork's test build (build-test-all.yml),
// anything else a hand build. Runs the real helper out of dashboard.html.
//
// Run: npx vitest run test/crash-build-tag.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock, evalBlock } from './_source-slice.js';

const html = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));
const { wpZealBuildTag } = evalBlock(sliceBlock(html, 'function wpZealBuildTag(ver) {', '\n}\n'), ['wpZealBuildTag']);

describe('wpZealBuildTag', () => {
  it('an official release (bare short hash) reads "Zeal official"', () => {
    expect(wpZealBuildTag('1.4.7 (e24a3ed)')).toEqual({ test: false, text: 'Zeal official' });
    expect(wpZealBuildTag('1.4.5 (a5f5cbf)').test).toBe(false);
  });
  it('the fork\'s test build and hand builds read as a test build', () => {
    for (const v of ['1.4.8 (testall-0a2e25d)', '1.4.7 (testall)', '1.4.5 (pr229)', '1.4.8 (UNOFFICIAL)']) {
      expect(wpZealBuildTag(v), v).toEqual({ test: true, text: '🧪 Zeal test build' });
    }
  });
  it('nothing to go on gives no tag', () => {
    for (const v of [null, undefined, '', '?', '1.4.8', '1.4.8 ()']) expect(wpZealBuildTag(v), String(v)).toBeNull();
  });
  it('the card\'s title line carries the tag', () => {
    const run = sliceBlock(html, 'async function wpRunCrashReview() {', '\n}\n');
    expect(run).toContain('wpZealBuildTag(c.reason && c.reason.zeal_version)');
  });
});
