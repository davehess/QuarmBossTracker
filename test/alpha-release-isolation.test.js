// test/alpha-release-isolation.test.js — the Mimic 3.0 alpha never poses as the beta.
//
// The guild lead, 2026-09-29: "can we make an alpha channel for 3.0 testing as well?"
// Alpha builds are published to ONE rolling GitHub release, tag `mimic-alpha`, flagged prerelease.
// Everything that used to take "the newest prerelease" as the beta — the #mimic-releases beta card,
// the bot's beta download link, /mimic/beta on the site, the officer agents page — would have
// served the alpha to beta testers. Each now takes only a -beta.N tag. The workflows build the
// alpha from the `alpha` branch, and keep that branch following beta.
//
// Run: npx vitest run test/alpha-release-isolation.test.js

import { describe, it, expect, vi, afterEach } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const bot = stripJs(readSource(path.join(ROOT, 'index.js')));
const read = (...p) => readSource(path.join(ROOT, ...p));
const noYamlComments = (s) => s.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');

const REL = (tag, prerelease) => ({
  tag_name: tag, prerelease, draft: false,
  assets: [{ name: `Wolf-Pack-Mimic-Setup-${tag.replace(/^v/, '')}.exe`, browser_download_url: `https://dl/${tag}.exe` }],
});
// Newest first, the way the releases API lists them: the alpha was just rebuilt.
const RELEASES = [REL('mimic-alpha', true), REL('v2.7.5-beta.4', true), REL('v2.7.4', false)];

describe('the beta is only ever a -beta.N tag', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('the bot\'s download links skip the alpha', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => RELEASES }));
    const mod = require(path.join(ROOT, 'utils', 'mimicReleases.js'));
    const urls = await mod.getMimicDownloadUrls();
    expect(urls.beta).toBe('https://dl/v2.7.5-beta.4.exe');
    expect(urls.stable).toBe('https://dl/v2.7.4.exe');
  });

  it('the #mimic-releases beta card skips the alpha', () => {
    const line = bot.split('\n').find(l => /const beta = rels\.find\(/.test(l));
    // eslint-disable-next-line no-new-func
    const pick = new Function('rels', line + '\nreturn beta;');
    expect(pick(RELEASES).tag_name).toBe('v2.7.5-beta.4');
  });

  it('/mimic/beta and the officer agents page skip the alpha', () => {
    const route = stripJs(read('web', 'app', 'mimic', 'beta', 'route.ts'));
    expect(route).toMatch(/allMimicReleases\.find\(r => r\.prerelease && \/-beta\\\.\\d\+\$\/\.test\(r\.tag_name\)\)/);
    const agents = stripJs(read('web', 'app', 'admin', 'agents', 'page.tsx'));
    expect(agents).toMatch(/const betas\s+= mimicReleases\.filter\(r =>\s+r\.prerelease && \/-beta\\\.\\d\+\$\/\.test\(r\.tag_name\)\)/);
  });
});

describe('the alpha build and its branch', () => {
  const release = noYamlComments(read('.github', 'workflows', 'release-mimic.yml'));
  it('builds on alpha pushes as <park>-alpha.<run number>', () => {
    expect(release).toMatch(/branches: \[main, beta, alpha\]/);
    expect(release).toMatch(/v="\$\{new_version%%-\*\}-alpha\.\$\{\{ github\.run_number \}\}"/);
    expect(release).toMatch(/echo "alpha=true" >> "\$GITHUB_OUTPUT"/);
  });
  it('publishes an alpha only to the rolling mimic-alpha release, uploading before it removes old files', () => {
    const normal = sliceBlock(release, '- name: Publish release with installer', 'apps/mimic/dist/*.blockmap');
    expect(normal).toMatch(/steps\.tag\.outputs\.alpha != 'true'/);
    const alpha = sliceBlock(release, '- name: Alpha — move the tag', 'apps/mimic/dist/*.blockmap');
    // 2026-10-08: the old files were deleted first, the tag push then died on a network reset, and the
    // release sat empty ("Cannot find channel alpha.yml"). Nothing may be deleted before the upload.
    expect(alpha).not.toMatch(/delete-asset/);
    expect(alpha).toMatch(/for wait in 2 4 8 16 0; do\s*\n\s*if git push -f origin refs\/tags\/mimic-alpha/);
    const at = release.indexOf('- name: Alpha — drop the previous build');
    expect(at).toBeGreaterThan(release.indexOf('- name: Alpha — publish to the rolling release'));
    const drop = release.slice(at);
    expect(drop).toMatch(/gh release delete-asset mimic-alpha "\$a"/);
    // it never empties the release: no local alpha.yml, no deletes
    expect(drop).toMatch(/case "\$keep" in \*" alpha\.yml "\*\) ;; \*\) [^\n]*exit 0;; esac/);
    // electron-builder writes only latest.yml under the github provider; the alpha feed reads
    // alpha.yml with no fallback (the first alpha, v3.0.0-alpha.832, shipped without one).
    expect(alpha).toMatch(/cp apps\/mimic\/dist\/latest\.yml apps\/mimic\/dist\/alpha\.yml/);
    expect(alpha).toMatch(/apps\/mimic\/dist\/alpha\.yml\n/);
    expect(alpha).toMatch(/tag_name:\s+mimic-alpha/);
    expect(alpha).toMatch(/prerelease: true/);
  });
  it('alpha follows beta and main, keeps its own park, and runs CI', () => {
    const sync = noYamlComments(read('.github', 'workflows', 'sync-alpha.yml'));
    expect(sync).toMatch(/branches: \[main, beta\]/);
    expect(sync).toMatch(/for src in beta main; do/);
    expect(sync).toMatch(/PARK_FILES="apps\/mimic\/package\.json packages\/wolfpack-logsync\/package\.json"/);
    expect(sync).toMatch(/git merge --abort\s*\n\s*exit 1/);
    for (const f of ['test.yml', 'golden-log.yml']) {
      expect(noYamlComments(read('.github', 'workflows', f)), f).toMatch(/- beta\n\s+- alpha\n/);
    }
  });
});
