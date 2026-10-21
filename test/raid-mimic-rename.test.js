// test/raid-mimic-rename.test.js — "Wolf Pack Mimic" became "Raid Mimic" (the guild lead, 2026-10-21):
// ONE installer, renamed, with the SAME appId so every existing install updates in place and keeps its settings.
//
// What this pins, and why each piece matters:
//   1. IDENTITY did not move. userData (%APPDATA%\wolfpack-mimic: the saved login, token, config, agent copy,
//      queue) comes from the package `name`, and the uninstall key / install folder / update feed come from
//      the appId. Renaming the product must touch neither. The folder is derived, not set, so the proof is
//      that none of its inputs changed (and that nothing in main.js overrides it).
//   2. FILE NAMES changed (Raid-Mimic-Setup-<ver>.exe) but every release already cut keeps its old name, so
//      everything that FINDS a release by its installer — the bot's download links, /mimic, /mimic/beta, the
//      officer agents page, /mimic/linux, patch-latest-yml — accepts BOTH.
//   3. The installer replaces the old install cleanly: old exe / shortcuts swept, the Startup entry
//      overwritten in place (same value name, new exe path), no second entry.
//   4. The app says "Raid Mimic" wherever it names the PRODUCT, and still says "Wolf Pack" wherever it names
//      the GUILD. Every remaining old-name mention is on a short list below, each one deliberate.
//
// Run: npx vitest run test/raid-mimic-rename.test.js

import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';
import { findLinuxRelease } from '../web/lib/linuxRelease.ts';

const require = createRequire(import.meta.url);
const read = (...p) => readSource(path.join(ROOT, ...p));
const pkg = JSON.parse(read('apps', 'mimic', 'package.json'));
const main = read('apps', 'mimic', 'main.js');
const mainCode = stripJs(main);
const nsh = read('apps', 'mimic', 'build', 'installer.nsh');
const nshCode = nsh.split('\n').filter((l) => !/^\s*;/.test(l)).join('\n');
const yamlCode = (s) => s.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

const VERSION = '3.1.0';
const expand = (pattern, ext) => pattern.replace('${version}', VERSION).replace('${ext}', ext);
const NEW_SETUP = expand(pkg.build.nsis.artifactName, 'exe');
const NEW_ZIP = expand(pkg.build.win.artifactName, 'zip');
const OLD_SETUP = `Wolf-Pack-Mimic-Setup-${VERSION}.exe`;
const globToRx = (g) => new RegExp('^' + g.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');

// The regex literal a source uses to recognise the Mimic installer asset.
function setupRegexIn(src) {
  const m = /\/(\^[^/\n]*mimic-setup-[^/\n]*\$)\/i\.test/i.exec(stripJs(src));
  if (!m) throw new Error('no installer-asset regex found');
  return new RegExp(m[1], 'i');
}

describe('1. the install keeps its identity (so settings survive the update)', () => {
  it('the package name is unchanged — it is what names the userData folder', () => {
    expect(pkg.name).toBe('wolfpack-mimic');
  });

  it('there is NO top-level productName: Electron prefers it over `name` for app.name, which would move userData', () => {
    // Electron: app.name = package.json productName || name, read from the PACKAGED package.json. electron-builder does
    // NOT copy build.productName into that file (measured: with build.productName "Wolf Pack Mimic" the boot log
    // read userData=...\Roaming\wolfpack-mimic). A top-level productName is the one way to move the folder.
    expect(pkg.productName).toBeUndefined();
    const userDataFolder = pkg.productName || pkg.name;
    expect(userDataFolder).toBe('wolfpack-mimic');
    // ... and it is the very folder the uninstaller sweeps
    expect(nshCode).toContain('RMDir /r "$APPDATA\\wolfpack-mimic"');
  });

  it('nothing in main.js overrides the name or the userData path (no guard is needed, and none is set)', () => {
    expect(mainCode).not.toMatch(/app\.setName\s*\(/);
    expect(mainCode).not.toMatch(/setPath\s*\(\s*['"`]userData['"`]/);
    expect(mainCode).not.toMatch(/setPath\s*\(\s*['"`]appData['"`]/);
    // every per-user file hangs off Electron's own userData, and the boot log prints it
    expect(mainCode).toContain("const CONFIG_FILE = () => path.join(app.getPath('userData'), 'mimic.config.json');");
    expect(mainCode).toContain("userData=${app.getPath('userData')}");
  });

  it('the appId (uninstall key, install folder, update feed) is unchanged, and nothing else rewrites those identities', () => {
    expect(pkg.build.appId).toBe('quest.wolfpack.mimic');
    // electron-builder takes the NSIS GUID from the appId unless `guid` is set; the exe name and shortcut name
    // from the productName unless these are set. None of them is, and a later one would fork the install.
    expect(pkg.build.nsis.guid).toBeUndefined();
    expect(pkg.build.executableName).toBeUndefined();
    expect(pkg.build.win.executableName).toBeUndefined();
    expect(pkg.build.nsis.shortcutName).toBeUndefined();
    expect(pkg.build.nsis.perMachine).toBe(false);
    expect(pkg.build.publish).toEqual([expect.objectContaining({ provider: 'github', owner: 'davehess', repo: 'QuarmBossTracker' })]);
  });

  it('the product name is Raid Mimic', () => {
    expect(pkg.build.productName).toBe('Raid Mimic');
    expect(pkg.description).toMatch(/^Raid Mimic — /);
  });
});

describe('2. file names: the new ones, and every finder accepts both', () => {
  it('the installer and the zip are named Raid-Mimic-…', () => {
    expect(NEW_SETUP).toBe('Raid-Mimic-Setup-3.1.0.exe');
    expect(NEW_ZIP).toBe('Raid-Mimic-3.1.0.zip');
  });

  it('release-mimic.yml publishes exactly those names, and cleans the alpha release by them', () => {
    const wf = yamlCode(read('.github', 'workflows', 'release-mimic.yml'));
    expect(wf).not.toMatch(/Wolf-Pack/i);
    const globs = [...wf.matchAll(/apps\/mimic\/dist\/(\S+)/g)].map((m) => m[1]);
    const setupGlobs = globs.filter((g) => /Setup/.test(g));
    expect(setupGlobs.length).toBe(2);                                         // stable/beta publish + alpha publish
    for (const g of setupGlobs) expect(globToRx(g).test(NEW_SETUP)).toBe(true);
    const zipGlob = globs.find((g) => /\.zip$/.test(g));
    expect(globToRx(zipGlob).test(NEW_ZIP)).toBe(true);
    expect(globToRx(zipGlob).test(NEW_SETUP)).toBe(false);                     // the zip glob does not also grab the installer
    expect(wf).toMatch(/ls -1 Raid-Mimic-Setup-\*\.exe alpha\.yml \*\.blockmap/);   // the alpha keep-list
  });

  it('the Linux build keeps its own channel and version scheme; only the CI artifact name moved', () => {
    const lin = yamlCode(read('.github', 'workflows', 'build-mimic-linux.yml'));
    expect(lin).not.toMatch(/wolf-pack-mimic/i);
    expect(lin).toContain('name: raid-mimic-linux-appimage');
    expect(lin).toContain('-linux.${{ github.run_number }}');
    expect(lin).toContain('electron-builder --linux AppImage --publish always');
  });

  it('the alpha feed is read by file name alpha.yml, never by an installer name', () => {
    expect(mainCode).toMatch(/_ALPHA_FEED/);
    expect(mainCode).not.toMatch(/(?:Raid|Wolf)-(?:Pack-)?Mimic-Setup/);
  });

  describe('the bot download links (utils/mimicReleases.js)', () => {
    afterEach(() => { vi.unstubAllGlobals(); });
    const REL = (tag, prerelease, file) => ({ tag_name: tag, prerelease, draft: false, assets: [{ name: file, browser_download_url: `https://dl/${file}` }] });
    const links = async (releases) => {
      vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => releases }));
      const file = path.join(ROOT, 'utils', 'mimicReleases.js');
      delete require.cache[require.resolve(file)];                 // it caches for 5 minutes; start clean
      return require(file).getMimicDownloadUrls();
    };
    it('finds a Raid-named stable and beta', async () => {
      const r = await links([REL('v3.1.1-beta.2', true, 'Raid-Mimic-Setup-3.1.1-beta.2.exe'), REL('v3.1.0', false, NEW_SETUP)]);
      expect(r.beta).toBe('https://dl/Raid-Mimic-Setup-3.1.1-beta.2.exe');
      expect(r.stable).toBe('https://dl/Raid-Mimic-Setup-3.1.0.exe');
    });
    it('still finds the releases cut before the rename', async () => {
      const r = await links([REL('v2.9.3-beta.1', true, 'Wolf-Pack-Mimic-Setup-2.9.3-beta.1.exe'), REL('v2.9.2', false, OLD_SETUP)]);
      expect(r.beta).toBe('https://dl/Wolf-Pack-Mimic-Setup-2.9.3-beta.1.exe');
      expect(r.stable).toBe(`https://dl/${OLD_SETUP}`);
    });
    it('takes the newest of a mixed list: a new-named beta over an old-named stable', async () => {
      const r = await links([REL('v3.1.1-beta.1', true, 'Raid-Mimic-Setup-3.1.1-beta.1.exe'), REL('v3.1.0', false, NEW_SETUP), REL('v2.9.2', false, OLD_SETUP)]);
      expect(r.stable).toBe('https://dl/Raid-Mimic-Setup-3.1.0.exe');
      expect(r.beta).toBe('https://dl/Raid-Mimic-Setup-3.1.1-beta.1.exe');
    });
  });

  it('the web download routes and the officer agents page recognise both installer names', () => {
    for (const rel of [['web', 'app', 'mimic', 'route.ts'], ['web', 'app', 'mimic', 'beta', 'route.ts'], ['web', 'app', 'admin', 'agents', 'page.tsx']]) {
      const rx = setupRegexIn(read(...rel));
      expect(rx.test(NEW_SETUP), rel.join('/')).toBe(true);
      expect(rx.test(OLD_SETUP), rel.join('/')).toBe(true);
      expect(rx.test('Raid-Mimic-Setup-3.1.0.exe.blockmap')).toBe(false);
      expect(rx.test('latest.yml')).toBe(false);
      expect(rx.test('WolfPackParser.zip')).toBe(false);
    }
  });

  it('the #mimic-releases announcer in the bot keys on the .exe extension, not on a product name', () => {
    const bot = stripJs(read('index.js'));
    expect(bot).not.toMatch(/wolf-pack-mimic|raid-mimic/i);
  });

  it('/mimic/linux finds a Raid-named AppImage and a Deck build cut before the rename', async () => {
    const rel = (tag, file, at) => ({ tag_name: tag, html_url: `https://x/${tag}`, draft: false, published_at: at, assets: [{ name: file, browser_download_url: `https://x/${file}` }] });
    const oldDeck = rel('v2.9.0-linux.40', 'Wolf-Pack-Mimic-2.9.0-linux.40-linux-x86_64.AppImage', '2026-10-01T00:00:00Z');
    const newDeck = rel('v3.1.0-linux.41', 'Raid-Mimic-3.1.0-linux.41-linux-x86_64.AppImage', '2026-10-22T00:00:00Z');
    expect((await findLinuxRelease(async (p) => (p === 1 ? [oldDeck] : null))).tag_name).toBe('v2.9.0-linux.40');
    expect((await findLinuxRelease(async (p) => (p === 1 ? [newDeck, oldDeck] : null))).tag_name).toBe('v3.1.0-linux.41');
    expect(await findLinuxRelease(async (p) => (p === 1 ? [rel('v3.1.0', NEW_SETUP, '2026-10-22T00:00:00Z')] : null))).toBeNull();
  });

  describe('apps/mimic/scripts/patch-latest-yml.js re-hashes whichever installer is in dist', () => {
    for (const exeName of [NEW_SETUP, OLD_SETUP]) {
      it(exeName, () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raid-mimic-yml-'));
        try {
          const scripts = path.join(tmp, 'apps', 'mimic', 'scripts');
          const dist = path.join(tmp, 'apps', 'mimic', 'dist');
          fs.mkdirSync(scripts, { recursive: true });
          fs.mkdirSync(dist, { recursive: true });
          fs.copyFileSync(path.join(ROOT, 'apps', 'mimic', 'scripts', 'patch-latest-yml.js'), path.join(scripts, 'patch-latest-yml.js'));
          const body = Buffer.from('signed installer bytes');
          fs.writeFileSync(path.join(dist, exeName), body);
          fs.writeFileSync(path.join(dist, 'latest.yml'),
            `version: ${VERSION}\nfiles:\n  - url: ${exeName}\n    sha512: STALE\n    size: 1\npath: ${exeName}\nsha512: STALE\nreleaseDate: '2026-10-21T00:00:00.000Z'\n`);
          execFileSync(process.execPath, [path.join(scripts, 'patch-latest-yml.js')], { stdio: 'pipe' });
          const sha = crypto.createHash('sha512').update(body).digest('base64');
          const out = fs.readFileSync(path.join(dist, 'latest.yml'), 'utf8');
          expect(out).toContain(`    sha512: ${sha}`);
          expect(out).toContain(`\nsha512: ${sha}`);
          expect(out).toContain(`    size: ${body.length}`);
          expect(out).not.toContain('STALE');
        } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
      });
    }
  });
});

describe('3. the installer replaces an old install cleanly', () => {
  it('sweeps the old exe, uninstaller and shortcuts, and creates the new uninstall shortcut', () => {
    const install = sliceBlock(nshCode, '!macro customInstall\n', '!macroend');
    for (const old of ['$DESKTOP\\Wolf Pack Mimic.lnk', '$SMPROGRAMS\\Wolf Pack Mimic.lnk', '$SMPROGRAMS\\Uninstall Wolf Pack Mimic.lnk',
      '$INSTDIR\\Wolf Pack Mimic.exe', '$INSTDIR\\Uninstall Wolf Pack Mimic.exe']) {
      expect(install).toContain(`Delete "${old}"`);
    }
    expect(install).toContain('CreateShortCut "$SMPROGRAMS\\Uninstall Raid Mimic.lnk" "$INSTDIR\\${UNINSTALL_FILENAME}"');
    // nothing in customInstall deletes the NEW names
    expect(install).not.toMatch(/Delete "[^"]*Raid Mimic\.(?:exe|lnk)"/);
  });

  it('the uninstaller removes both shortcut names, and sweeps every product-named data path', () => {
    const un = sliceBlock(nshCode, '!macro customUnInstall', '!macroend');
    expect(un).toContain('Delete "$SMPROGRAMS\\Uninstall Raid Mimic.lnk"');
    expect(un).toContain('Delete "$SMPROGRAMS\\Uninstall Wolf Pack Mimic.lnk"');
    for (const dir of ['wolfpack-mimic', 'Raid Mimic', 'Wolf Pack Mimic']) expect(un).toContain(`RMDir /r "$APPDATA\\${dir}"`);
    // ... but only on a real uninstall: an electron-updater update must keep the user's data and Startup entry
    expect(un).toMatch(/\$\{ifNot\} \$\{isUpdated\}[\s\S]*RMDir \/r "\$APPDATA\\wolfpack-mimic"[\s\S]*\$\{endIf\}/);
  });

  it('the Startup entry keeps its name, so the update overwrites it instead of adding a second one', () => {
    const NAME = 'WolfPackMimic';
    expect(mainCode).toContain(`const _AUTOSTART_REG_NAME = '${NAME}';`);
    expect(nshCode).toContain(`"${NAME}" '"$INSTDIR\\\${APP_EXECUTABLE_FILENAME}" --autostart'`);   // value points at the NEW exe, never a literal path
    expect(nshCode).toContain(`DeleteRegValue HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Run" "${NAME}"`);
  });

  it('the duplicate-Startup sweep recognises both exe names (and leaves other apps and the canonical entry alone)', () => {
    const block = sliceBlock(main, 'function cleanupDuplicateAutostartEntries() {', '\n}\n');
    const calls = [];
    const stdout = [
      '',
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
      '    WolfPackMimic    REG_SZ    "C:\\Users\\u\\AppData\\Local\\Programs\\Wolf Pack Mimic\\Raid Mimic.exe" --autostart',
      '    OldDuplicate    REG_SZ    "C:\\Users\\u\\AppData\\Local\\Programs\\Wolf Pack Mimic\\Wolf Pack Mimic.exe" --autostart',
      '    NewDuplicate    REG_SZ    "C:\\Users\\u\\AppData\\Local\\Programs\\Raid Mimic\\Raid Mimic.exe" --autostart',
      '    Spotify    REG_SZ    C:\\Users\\u\\AppData\\Roaming\\Spotify\\Spotify.exe --autostart',
      '',
    ].join('\r\n');
    const fakeRequire = () => ({
      execFile: (cmd, args, opts, cb) => { calls.push(args); if (args[0] === 'QUERY') cb(null, stdout); else cb(null, ''); },
    });
    // eslint-disable-next-line no-new-func
    new Function('process', 'require', 'app', '_AUTOSTART_REG_NAME', block + '\ncleanupDuplicateAutostartEntries();')(
      { platform: 'win32' }, fakeRequire,
      { getPath: () => 'C:\\Users\\u\\AppData\\Local\\Programs\\Wolf Pack Mimic\\Raid Mimic.exe' }, 'WolfPackMimic');
    const deleted = calls.filter((a) => a[0] === 'DELETE').map((a) => a[a.indexOf('/V') + 1]);
    expect(deleted.sort()).toEqual(['NewDuplicate', 'OldDuplicate']);
  });

  it('the in-app Uninstall finds the new uninstaller first, the old one second, and otherwise any Uninstall*.exe', () => {
    const block = sliceBlock(main, 'function _uninstallerPath() {', '\n}\n');
    const run = (existing, dirFiles = []) => {
      const fakeFs = { existsSync: (p) => existing.includes(p), readdirSync: () => dirFiles };
      // eslint-disable-next-line no-new-func
      return new Function('process', 'path', 'fs', block + '\nreturn _uninstallerPath();')(
        { platform: 'win32', execPath: 'C:\\I\\Raid Mimic.exe' }, path.win32, fakeFs);
    };
    expect(run(['C:\\I\\Uninstall Raid Mimic.exe', 'C:\\I\\Uninstall Wolf Pack Mimic.exe'])).toBe('C:\\I\\Uninstall Raid Mimic.exe');
    expect(run(['C:\\I\\Uninstall Wolf Pack Mimic.exe'])).toBe('C:\\I\\Uninstall Wolf Pack Mimic.exe');
    expect(run([], ['Raid Mimic.exe', 'Uninstall Whatever.exe'])).toBe('C:\\I\\Uninstall Whatever.exe');
    expect(run([], ['Raid Mimic.exe'])).toBeNull();
  });
});

describe('4. the app says Raid Mimic for the product and Wolf Pack for the guild', () => {
  const titles = [...mainCode.matchAll(/\btitle:\s*([`'])((?:(?!\1).)*)\1/g)].map((m) => m[2]);

  it('the window and dialog titles that carry the product name say Raid Mimic', () => {
    const named = titles.filter((t) => /^(?:Uninstall )?Raid Mimic/.test(t));
    expect(named.length).toBeGreaterThan(40);                         // every overlay, the dashboard, the dialogs
    // the few short ones that always said just "Mimic" (Mimic Settings, Restart Mimic, …) are untouched; none says Wolf Pack
    for (const t of titles) expect(t, t).not.toMatch(/wolf pack/i);
    expect(titles).toContain('Raid Mimic — Feedback');
    expect(titles).toContain('Raid Mimic — Main window (Dashboard)');
    expect(titles).toContain('Raid Mimic — update ready');
  });

  it('the tray tooltip, status line, Open item and Uninstall item say Raid Mimic', () => {
    const tip = sliceBlock(main, 'function tooltipFor(s) {', '\n}\n');
    expect(tip.match(/Raid Mimic \$\{v\}/g).length).toBeGreaterThanOrEqual(4);
    expect(tip).not.toMatch(/Wolf Pack/);
    expect(mainCode).toContain("{ label: 'Open Raid Mimic',");
    expect(mainCode).toContain("label: 'Uninstall Raid Mimic…'");
    expect(mainCode).toContain('`🐺 Raid Mimic ${v} — Connected · :${s.agentPort}`');
  });

  it('the dashboard header is Raid Mimic under Mimic and keeps its own name as the standalone parser', () => {
    const html = read('packages', 'wolfpack-logsync', 'dashboard.html');
    expect(html).toContain("{{WP:process.env.WOLFPACK_CLIENT === 'mimic' ? 'Raid Mimic' : 'Wolf Pack EQ — Parser'}}");
    expect(html).toContain('title="Quit Raid Mimic (');
    expect(html).toContain("confirm('Quit Raid Mimic?')");
    expect(html).toContain("document.title = 'Raid Mimic — Feedback';");
  });

  it('first run offers "Join a guild — sign in with Discord" and "Just me — stays on this PC"', () => {
    const welcome = read('apps', 'mimic', 'welcome.html');
    expect(welcome).toContain('<button class="discord" data-a="signin">Join a guild — sign in with Discord</button>');
    expect(welcome).toContain('<button class="link" data-a="local">Just me — stays on this PC</button>');
    expect(welcome).toContain('<title>Raid Mimic — set up</title>');
    expect(welcome).toContain('🐺 Raid Mimic<span>setup</span>');
    const loading = read('apps', 'mimic', 'loading.html');
    expect(loading).toContain('</svg>Join a guild — sign in with Discord</button>');
    expect(loading).toContain('>Just me — stays on this PC (no uploads)</a>');
    expect(loading).toContain('<h1>Raid Mimic</h1>');
  });

  it('"Wolf Pack" is kept where it names the guild', () => {
    const settings = read('apps', 'mimic', 'settings.html');
    expect(settings).toContain('<h2>Wolf Pack connection</h2>');
    expect(settings).toContain('Sign in to Wolf Pack');
    expect(mainCode).toContain("label: 'Connect to Wolf Pack…'");
    expect(read('apps', 'mimic', 'welcome.html')).toContain("title: 'Wolf Pack account'");
  });

  // Every remaining spelling of the OLD product name in code the user's PC runs. A line is skipped when it is a
  // comment; the rest must be on this list, each one deliberate.
  const OLD = /wolf[ -]pack[ -]mi\s?mic/i;
  const INTENTIONAL = [
    ['apps/mimic/main.js', "'wolf pack mimic.exe'"],                    // the Startup sweep still recognises the pre-rename exe
    ['apps/mimic/main.js', "'Uninstall Wolf Pack Mimic.exe'"],          // an install that predates the rename keeps this uninstaller until the update
    ['apps/mimic/build/installer.nsh', 'Wolf Pack Mimic.lnk'],          // the old shortcuts the installer sweeps
    ['apps/mimic/build/installer.nsh', 'Wolf Pack Mimic.exe'],          // ... and the old exe / uninstaller
    ['apps/mimic/build/installer.nsh', '$APPDATA\\Wolf Pack Mimic'],    // ... and the productName-cased data path
    ['apps/mimic/scripts/patch-latest-yml.js', 'Wolf-Pack-Mimic-Setup-*.exe'],   // the error text naming the old pattern it still accepts
  ];
  const scanFiles = () => {
    const out = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        if (['node_modules', 'dist', 'staged-agent', 'vendor', 'assets', 'sounds', 'pvp-sets'].includes(e.name)) continue;
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(rel);
        else if (/\.(?:js|html|json|nsh)$/.test(e.name)) out.push(rel);
      }
    };
    walk('apps/mimic');
    out.push('packages/wolfpack-logsync/dashboard.html');
    return out;
  };
  const isComment = (l) => /^\s*(?:\/\/|\/\*|\*|;|<!--|#)/.test(l);

  it('no other spelling of "Wolf Pack Mimic" / "Wolf Pack miMIC" survives in the app', () => {
    const stray = [];
    for (const file of scanFiles()) {
      read(...file.split('/')).split('\n').forEach((line, i) => {
        if (!OLD.test(line) || isComment(line)) return;
        if (INTENTIONAL.some(([f, has]) => f === file && line.includes(has))) return;
        stray.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
    expect(stray).toEqual([]);
  });

  it('the intentional list is not stale: each entry is still in its file', () => {
    for (const [file, has] of INTENTIONAL) expect(read(...file.split('/')), `${file} ${has}`).toContain(has);
  });

  it('the agent that ships inside Mimic carries the same header (the generated WEB_HTML is in sync)', () => {
    const agent = read('packages', 'wolfpack-logsync', 'index.js');
    expect(agent).toContain("process.env.WOLFPACK_CLIENT === 'mimic' ? 'Raid Mimic' : 'Wolf Pack EQ — Parser'");
    expect(agent).not.toMatch(/Wolf Pack Mimic|Wolf Pack miMIC/);
  });
});
