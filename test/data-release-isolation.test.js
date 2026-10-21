// test/data-release-isolation.test.js — the rolling game-data release never poses as a Mimic release.
//
// The guild lead, 2026-10-21: the weekly game-data pack is published to ONE rolling GitHub release, tag
// `data-latest`, a prerelease (.github/workflows/build-data-pack.yml). Everything in this repo that reads the
// release list had to keep seeing only Mimic: the #mimic-releases announcer, the bot's download links, /mimic
// and /mimic/beta on the site, the officer agents page, /mimic/linux, the Linux pruner, the parser release
// trigger, and Mimic's own updater. Same shape as test/alpha-release-isolation.test.js, which did this for the
// `mimic-alpha` tag. One rolling release, never one per week: the releases.atom feed holds 10 entries and the
// Linux builds once pushed the Windows betas out of it (CLAUDE.md).
//
// Run: npx vitest run test/data-release-isolation.test.js

import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { load as yamlLoad } from 'js-yaml';
import { readSource, stripJs, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const read = (...p) => readSource(path.join(ROOT, ...p));
const bot = stripJs(read('index.js'));
const noYamlComments = (s) => s.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');

const WORKFLOW = 'build-data-pack.yml';
const wfRaw = read('.github', 'workflows', WORKFLOW);
const wf = yamlLoad(wfRaw);
const wfText = noYamlComments(wfRaw);
const steps = wf.jobs.build.steps;
const stepIndex = (re) => steps.findIndex(s => re.test(`${s.name || ''}\n${s.run || ''}`));

// ── the workflow ─────────────────────────────────────────────────────────────
describe('build-data-pack.yml', () => {
  it('runs after a SUCCESSFUL weekly sync, or by hand', () => {
    const syncName = yamlLoad(read('.github', 'workflows', 'sync-quarm.yml')).name;
    const on = wf.on !== undefined ? wf.on : wf[true];
    expect(on.workflow_run.workflows).toEqual([syncName]);
    expect(on.workflow_run.types).toEqual(['completed']);
    expect(on).toHaveProperty('workflow_dispatch');
    expect(wf.jobs.build.if).toMatch(/github\.event\.workflow_run\.conclusion == 'success'/);
    expect(wf.jobs.build.if).toMatch(/github\.event_name == 'workflow_dispatch'/);
  });

  it('is Node 20 with the Supabase secrets, and may write releases', () => {
    expect(wf.permissions).toEqual({ contents: 'write' });
    expect(wf.jobs.build.env.SUPABASE_URL).toBe('${{ secrets.SUPABASE_URL }}');
    expect(wf.jobs.build.env.SUPABASE_SERVICE_ROLE_KEY).toBe('${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}');
    expect(wf.jobs.build.env.GH_TOKEN).toBe('${{ secrets.GITHUB_TOKEN }}');
    const node = steps.find(s => /setup-node/.test(s.uses || ''));
    expect(String(node.with['node-version'])).toBe('20');
  });

  it('never runs two at once, and never cancels one mid-publish', () => {
    expect(wf.concurrency).toEqual({ group: 'build-data-pack', 'cancel-in-progress': false });
  });

  it('uses ONE release tag, data-latest, on every gh release command', () => {
    const cmds = wfText.split('\n').filter(l => /\bgh release (create|upload|edit|view|download|delete-asset|delete)\b/.test(l));
    expect(cmds.length).toBeGreaterThanOrEqual(6);
    const tags = new Set(cmds.map(l => (/\bgh release \w[\w-]* (\S+)/.exec(l) || [])[1]));
    expect([...tags]).toEqual(['data-latest']);
    // the tag has no version in it and is never built from a date or run number
    expect(wfText).not.toMatch(/data-latest[-.$]/);
    expect(wfText).not.toMatch(/\$\{\{\s*github\.run_number/);
    expect(wfText).not.toMatch(/tag_name:/);
  });

  it('is a prerelease that is never the "latest" release, and is created only if missing', () => {
    expect(wfText).toMatch(/gh release view data-latest >\/dev\/null 2>&1; then\s*\n\s*gh release create data-latest --prerelease --latest=false/);
    expect(wfText).toMatch(/gh release edit data-latest --prerelease --latest=false/);
    expect(wfText).toMatch(/\.isPrerelease\)" = "true"/);
  });

  it('only ever deletes ASSETS of that release, never a release or a tag', () => {
    expect(wfText).not.toMatch(/gh release delete data-latest/);
    expect(wfText).not.toMatch(/gh release delete /);
    expect(wfText).not.toMatch(/git (tag|push)|DELETE|git\/refs/);
    expect(wfText).toMatch(/gh release delete-asset data-latest "\$a" -y/);
  });

  it('builds and checks first; nothing is published unless that step succeeded', () => {
    const build = stepIndex(/scripts\/build-data-pack\.js/);
    const stage = stepIndex(/Stage the release files/);
    const publish = stepIndex(/gh release create data-latest/);
    expect(build).toBeGreaterThanOrEqual(0);
    expect(build).toBeLessThan(stage);
    expect(stage).toBeLessThan(publish);
    for (const s of steps) {
      expect(s['continue-on-error'], `${s.name} must not swallow a failure`).toBeUndefined();
      expect(s.if, `${s.name} must not be conditional`).toBeUndefined();
    }
    expect(steps[build].run).toMatch(/node scripts\/build-data-pack\.js --out data-pack-out/);
  });

  it('uploads every file before the manifest, and drops stale files only after the manifest is up', () => {
    const run = steps[stepIndex(/gh release create data-latest/)].run;
    const files = run.indexOf('xargs gh release upload data-latest --clobber');
    const manifest = run.indexOf('gh release upload data-latest release-assets/manifest.json --clobber');
    const drop = run.indexOf('gh release delete-asset');
    expect(files).toBeGreaterThan(0);
    expect(manifest).toBeGreaterThan(files);
    expect(drop).toBeGreaterThan(manifest);
    // the manifest is kept out of the first batch
    expect(run).toMatch(/grep -v '\^manifest\\\.json\$'/);
    // a failed upload retries, then fails the job
    expect(run).toMatch(/for wait in 5 15 45 0; do/);
    expect(run).toMatch(/\[ "\$ok" = 1 \] \|\| \{ echo "upload failed 4 times"; exit 1; \}/);
  });

  it('publishes each zone pack under its flat asset name from the manifest', () => {
    const stage = steps[stepIndex(/Stage the release files/)].run;
    expect(stage).toMatch(/jq -r '\.files\[\] \| \[\.path, \.asset\] \| @tsv'/);
    expect(stage).toMatch(/cp "data-pack-out\/\$p" "release-assets\/\$a"/);
    const { assetName } = require('../scripts/build-data-pack.js');
    expect(assetName('zones/215.json.gz')).toBe('zone-215.json.gz');
    expect(assetName('spell-catalog.json.gz')).toBe('spell-catalog.json.gz');
  });

  it('is the only workflow that names data-latest', () => {
    const dir = path.join(ROOT, '.github', 'workflows');
    const others = fs.readdirSync(dir).filter(f => f !== WORKFLOW && /data-latest/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
    expect(others).toEqual([]);
  });
});

// ── what reads the release list ──────────────────────────────────────────────
const ASSETS_DATA = ['manifest.json', 'spell-catalog.json.gz', 'zone-215.json.gz'].map(name => ({ name, browser_download_url: `https://dl/${name}` }));
const MIMIC = (tag, prerelease) => ({
  tag_name: tag, prerelease, draft: false, html_url: `https://rel/${tag}`,
  assets: [{ name: `Wolf-Pack-Mimic-Setup-${tag.replace(/^v/, '')}.exe`, browser_download_url: `https://dl/${tag}.exe` }],
});
// The data release is the NEWEST in the list (it was just rebuilt), as a prerelease; and, to prove the
// guard does not lean on that flag alone, once more as a (mistaken) non-prerelease.
const DATA = (prerelease) => ({ tag_name: 'data-latest', prerelease, draft: false, html_url: 'https://rel/data-latest', assets: ASSETS_DATA });
const FEED = (prerelease) => [DATA(prerelease), MIMIC('mimic-alpha', true), MIMIC('v2.7.5-beta.4', true), MIMIC('v2.7.4', false)];

describe('the bot ignores data-latest', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  for (const flag of [true, false]) {
    it(`download links (data-latest prerelease=${flag})`, async () => {
      vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => FEED(flag) }));
      const file = path.join(ROOT, 'utils', 'mimicReleases.js');
      delete require.cache[file];
      const urls = await require(file).getMimicDownloadUrls();
      expect(urls.beta).toBe('https://dl/v2.7.5-beta.4.exe');
      expect(urls.stable).toBe('https://dl/v2.7.4.exe');
    });

    it(`the #mimic-releases announcer picks a v<number> tag for stable, never data-latest (prerelease=${flag})`, () => {
      const stableLine = bot.split('\n').find(l => /const rel = rels\.find\(/.test(l));
      const betaLine = bot.split('\n').find(l => /const beta = rels\.find\(/.test(l));
      // eslint-disable-next-line no-new-func
      const pick = new Function('rels', `${stableLine}\n${betaLine}\nreturn { rel, beta };`);
      const { rel, beta } = pick(FEED(flag));
      expect(rel.tag_name).toBe('v2.7.4');
      expect(beta.tag_name).toBe('v2.7.5-beta.4');
      // and with nothing but the data release and the alpha in the list, nothing is announced
      const none = pick([DATA(flag), MIMIC('mimic-alpha', true)]);
      expect(none.rel).toBeNull();
      expect(none.beta).toBeNull();
    });
  }
});

describe('the site ignores data-latest', () => {
  // These filters are TypeScript in a Next route; the rules they share are asserted on the source, and each
  // is mutation-checked against the removal of its guard.
  // (the installer is Raid-Mimic-Setup-* since the 2026-10-21 rename; every earlier release is Wolf-Pack-Mimic-Setup-*, so both)
  const setupExe = /r\.assets\.some\(a => \/\^\(\?:raid\|wolf-pack\)-mimic-setup-\.\*\\\.exe\$\/i\.test\(a\.name\)\)/;

  it('/mimic needs a non-prerelease with the Mimic installer attached', () => {
    const route = stripJs(read('web', 'app', 'mimic', 'route.ts'));
    expect(route).toMatch(/&& !r\.prerelease\s*\n\s*&& r\.assets\.some\(a => \/\^\(\?:raid\|wolf-pack\)-mimic-setup-\.\*\\\.exe\$\/i\.test\(a\.name\)\)/);
  });
  it('/mimic/beta needs the installer asset, and a -beta.N tag for the beta', () => {
    const route = stripJs(read('web', 'app', 'mimic', 'beta', 'route.ts'));
    expect(route).toMatch(setupExe);
    expect(route).toMatch(/r\.prerelease && \/-beta\\\.\\d\+\$\/\.test\(r\.tag_name\)/);
  });
  it('the officer agents page lists only releases that carry the installer', () => {
    const page = stripJs(read('web', 'app', 'admin', 'agents', 'page.tsx'));
    expect(page).toMatch(setupExe);
    expect(page).toMatch(/r\.prerelease && \/-beta\\\.\\d\+\$\/\.test\(r\.tag_name\)/);
  });
  it('/mimic/linux takes only a release with an AppImage', () => {
    const lib = stripJs(read('web', 'lib', 'linuxRelease.ts'));
    expect(lib).toMatch(/r\.assets\.some\(a => APPIMAGE_RX\.test\(a\.name\)\)/);
    expect(lib).toMatch(/APPIMAGE_RX = \/\(\?:raid\|wolf-pack\)-mimic-\.\*\\\.appimage\$\/i/);
  });
});

describe('the other workflows and Mimic itself ignore data-latest', () => {
  it('the Linux pruner can only match a -linux.<n> tag', () => {
    const prune = noYamlComments(read('.github', 'workflows', 'prune-linux-releases.yml'));
    const rx = /\$2 ~ \/(.+)\/'/.exec(prune);
    expect(rx).not.toBeNull();
    expect(new RegExp(rx[1]).test('data-latest')).toBe(false);
    expect(new RegExp(rx[1]).test('v2.1.1-linux.14')).toBe(true);
    expect(prune).toMatch(/grep -Eq -- '-linux\\\.\[0-9\]\+\$'/);
  });

  it('the parser release fires on v* and number tags only, so creating data-latest builds nothing', () => {
    const wfp = yamlLoad(read('.github', 'workflows', 'release-parser.yml'));
    const on = wfp.on !== undefined ? wfp.on : wfp[true];
    const globs = on.push.tags;
    const matches = (tag) => globs.reduce((hit, g) => {
      if (g.startsWith('!')) return hit && !(new RegExp('^' + g.slice(1).replace(/\*/g, '.*') + '$').test(tag));
      return hit || new RegExp('^' + g.replace('[0-9]', '[0-9]').replace(/\*/g, '.*') + '$').test(tag);
    }, false);
    expect(matches('v2.7.4')).toBe(true);        // the helper really can say yes
    expect(matches('data-latest')).toBe(false);
  });

  it('the Mimic build workflows never publish to, or follow, a tag called data-latest', () => {
    for (const f of ['release-mimic.yml', 'build-mimic-linux.yml', 'linux-follow-windows.yml', 'sync-beta.yml', 'sync-alpha.yml']) {
      expect(read('.github', 'workflows', f), f).not.toMatch(/data-latest/);
    }
  });

  it('Mimic updates stable from /releases/latest (prereleases invisible), alpha from its own fixed address, beta from semver tags', () => {
    const main = stripJs(read('apps', 'mimic', 'main.js'));
    expect(main).toMatch(/releases\/download\/mimic-alpha\//);
    expect(main).toMatch(/autoUpdater\.allowPrerelease = wantBeta;/);
    expect(main).not.toMatch(/data-latest/);
    // the beta walk skips a tag that is not semver; data-latest is not (neither is mimic-alpha)
    expect('data-latest').not.toMatch(/^v?\d+\.\d+\.\d+/);
    expect(read('.github', 'workflows', WORKFLOW)).toMatch(/--prerelease/);
  });

  it('nothing else in the shipped code refers to the data release', () => {
    const hits = [];
    const skip = new Set(['node_modules', '.next', '.git', '.claude', 'docs', 'test']);
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (skip.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.(js|ts|tsx|yml|json)$/.test(e.name)) {
          // comments may explain the tag (index.js does); only code and config count
          const raw = fs.readFileSync(full, 'utf8');
          const code = /\.(js|ts|tsx)$/.test(e.name) ? stripJs(raw) : /\.yml$/.test(e.name) ? noYamlComments(raw) : raw;
          if (/data-latest/.test(code)) hits.push(path.relative(ROOT, full));
        }
      }
    };
    walk(ROOT);
    expect(hits.sort()).toEqual(['.github/workflows/build-data-pack.yml']);
  });
});
