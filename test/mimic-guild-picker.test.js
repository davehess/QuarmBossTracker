// The Mimic guild picker, first slice (DECISIONS §475, §490): a raider points Mimic at a guild other than Wolf Pack
// without editing files. The Mimic half, shipping to beta: apps/mimic/hubs.js (the pure rules: what a hub is, the
// stored shape, the link address), main.js's glue, and the picker in welcome.html's account step and in Settings.
// Behaviour where it can be run (hubs.js, defaultConfig); source assertions on comment-stripped text where it cannot
// (main.js is an Electron entry). Imports nothing from web/ (the directory route is test/hub-directory.test.js, main).
//
// Run: npx vitest run test/mimic-guild-picker.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, stripJs, sliceBlock, evalBlock } from './_source-slice.js';

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const hubs = createRequire(import.meta.url)(path.join(ROOT, 'apps', 'mimic', 'hubs.js'));

const WOLF = { slug: 'wolfpack', display_name: 'Wolf Pack', url: 'https://wolfpackparse.up.railway.app', site: 'https://wolfpack.quest' };

// ── 2. hubs.js: the pure rules ─────────────────────────────────────────────────────────────────────────────────
describe('hubOf: the guild an install points at', () => {
  it('is Wolf Pack for an install that never picked (no hub, the default bot address)', () => {
    expect(hubs.hubOf({})).toEqual(WOLF);
    expect(hubs.hubOf({ botUrl: 'https://wolfpackparse.up.railway.app/api/agent/encounter' })).toEqual(WOLF);
  });

  it('is Wolf Pack in the real default config: defaultConfig() carries it as cfg.hub, equal to the built-in entry', () => {
    const main = read('apps/mimic/main.js');
    const cfg = evalBlock(sliceBlock(main, 'function defaultConfig() {', '\n}\n'), ['defaultConfig']).defaultConfig();
    expect(cfg.hub).toEqual(WOLF);
    expect(cfg.hub).toEqual(hubs.WOLFPACK_HUB);
    expect(cfg.botUrl).toBe(WOLF.url + '/api/agent/encounter');
    expect(hubs.hubOf(cfg)).toEqual(WOLF);          // a fresh or pre-picker install, loadConfig's Object.assign over this default
    expect(hubs.hubOf(Object.assign(cfg, { hub: undefined }))).toEqual(WOLF);
  });

  it('follows cfg.botUrl: a saved hub that no longer matches it is stale, and a custom bot address is its own guild', () => {
    const saved = { slug: 'alpha', display_name: 'Alpha', url: 'https://alpha.example', site: 'https://alpha.example' };
    expect(hubs.hubOf({ hub: saved, botUrl: 'https://alpha.example/api/agent/encounter' })).toEqual(saved);
    expect(hubs.hubOf({ hub: saved, botUrl: 'https://wolfpackparse.up.railway.app/api/agent/encounter' })).toEqual(WOLF);
    expect(hubs.hubOf({ hub: WOLF, botUrl: 'https://other.example/api/agent/encounter' })).toEqual({ slug: 'custom', display_name: 'other.example', url: 'https://other.example', site: '' });
  });
});

describe('parseGuildAddress: the "paste a guild address" box', () => {
  it('takes a bare host, an https address or the full upload address, and keeps only the origin', () => {
    for (const t of ['guild.example', 'https://guild.example', 'https://guild.example/', ' https://guild.example/api/agent/encounter ']) {
      expect(hubs.parseGuildAddress(t), t).toEqual({ slug: 'custom', display_name: 'guild.example', url: 'https://guild.example', site: '' });
    }
  });
  it('refuses anything Mimic should not talk to: other schemes, credentials, spaces, empty', () => {
    for (const t of ['', '   ', 'http://guild.example', 'ftp://guild.example', 'javascript:alert(1)', 'file:///etc/passwd', 'https://u:p@guild.example', 'two words', null, undefined]) {
      expect(hubs.parseGuildAddress(t), String(t)).toBe(null);
    }
  });
  it('allows plain http only for this machine, so a guild can try its server first', () => {
    expect(hubs.parseGuildAddress('http://localhost:3000').url).toBe('http://localhost:3000');
    expect(hubs.parseGuildAddress('http://localhost.evil.example')).toBe(null);
  });
});

describe('sanitizeDirectory: what came off the network', () => {
  it('puts Wolf Pack first and fixed, drops bad rows and duplicates, and strips markup from names', () => {
    const out = hubs.sanitizeDirectory([
      { slug: 'wolfpack', display_name: 'Impostor', url: 'https://evil.example', site: 'https://evil.example' },
      { slug: 'Alpha', display_name: '<b>Alpha</b>', url: 'https://alpha.example', site: 'javascript:alert(1)' },
      { slug: 'alpha', display_name: 'Again', url: 'https://again.example' },
      { slug: 'bad slug', display_name: 'x', url: 'https://x.example' },
      { slug: 'nourl', display_name: 'x' },
      { slug: 'http', display_name: 'x', url: 'http://insecure.example' },
      'junk', null, 7,
    ]);
    expect(out).toEqual([WOLF, { slug: 'alpha', display_name: 'Alpha', url: 'https://alpha.example', site: '' }]);
  });
  it('also reads a { hubs: [...] } envelope, and returns just Wolf Pack for nothing usable', () => {
    expect(hubs.sanitizeDirectory({ hubs: [{ slug: 'beta', display_name: 'Beta', url: 'https://beta.example' }] }).map(h => h.slug)).toEqual(['wolfpack', 'beta']);
    for (const bad of [null, undefined, 'x', {}, []]) expect(hubs.sanitizeDirectory(bad)).toEqual([WOLF]);
  });
  it('is refreshed daily: a cache is fresh for under 24 hours, and never when dated in the future', () => {
    const now = 1_000_000_000_000, day = 24 * 3600 * 1000;
    expect(hubs.directoryFresh({ fetched_at: now - day + 1 }, now)).toBe(true);
    expect(hubs.directoryFresh({ fetched_at: now - day }, now)).toBe(false);
    expect(hubs.directoryFresh({ fetched_at: now + 5000 }, now)).toBe(false);
    expect(hubs.directoryFresh(null, now)).toBe(false);
  });
});

describe('applyHub: switching guilds', () => {
  const alpha = { slug: 'alpha', display_name: 'Alpha', url: 'https://alpha.example', site: 'https://alpha.example' };
  it('stores { slug, url, site }, points the agent\'s bot address at the new guild, and clears the session and token', () => {
    const cfg = { botUrl: WOLF.url + '/api/agent/encounter', session: { tokenBox: { enc: 'x' }, identity: { discord_id: '1' } }, token: 'legacy', localOnly: undefined, eqPaths: ['C:\\EQ'] };
    const out = hubs.applyHub(cfg, alpha);
    expect(out.hub).toEqual(alpha);
    expect(out.botUrl).toBe('https://alpha.example/api/agent/encounter');
    expect(out.session).toBeUndefined();
    expect(out.token).toBeUndefined();
    expect(out.eqPaths).toEqual(['C:\\EQ']);          // nothing else is touched
    expect(hubs.hubOf(out)).toEqual(alpha);
  });
  it('round-trips back to Wolf Pack', () => {
    const out = hubs.applyHub(hubs.applyHub({}, alpha), hubs.WOLFPACK_HUB);
    expect(out.botUrl).toBe(WOLF.url + '/api/agent/encounter');
    expect(hubs.hubOf(out)).toEqual(WOLF);
  });
  it('treats the same bot as the same guild', () => {
    expect(hubs.sameHub(alpha, { ...alpha, display_name: 'Renamed' })).toBe(true);
    expect(hubs.sameHub(alpha, WOLF)).toBe(false);
  });
});

describe('linkUrls: where the link code is entered', () => {
  const resp = { verification_url: 'https://wolfpack.quest/auth/mimic-link', verification_url_complete: 'https://wolfpack.quest/auth/mimic-link?code=ABC123' };
  const alpha = { slug: 'alpha', display_name: 'Alpha', url: 'https://hosted.example', site: 'https://alpha.example' };
  it('moves a listed guild onto its own site, keeping the bot\'s path and the code', () => {
    expect(hubs.linkUrls(alpha, resp)).toEqual({ verification_url: 'https://alpha.example/auth/mimic-link', verification_url_complete: 'https://alpha.example/auth/mimic-link?code=ABC123' });
  });
  it('leaves Wolf Pack\'s own bot the authority for Wolf Pack\'s site (a beta host override keeps working)', () => {
    const beta = { verification_url: 'https://b.wolfpack.quest/auth/mimic-link', verification_url_complete: 'https://b.wolfpack.quest/auth/mimic-link?code=Z' };
    expect(hubs.linkUrls(WOLF, beta)).toEqual(beta);
    expect(hubs.linkUrls(WOLF, resp)).toEqual(resp);
  });
  it('goes where the guild\'s bot says when the guild has no site (a pasted self-host)', () => {
    const own = { verification_url: 'https://their.example/link', verification_url_complete: 'https://their.example/link?code=Q' };
    expect(hubs.linkUrls({ slug: 'custom', display_name: 'x', url: 'https://their.example', site: '' }, own)).toEqual(own);
  });
  it('refuses an address Mimic would open in a browser that is not https (file:, a custom scheme, plain http)', () => {
    for (const bad of ['file:///C:/Windows/system32/calc.exe', 'ms-msdt:/id', 'http://their.example/link', 'javascript:1', '', null]) {
      expect(hubs.linkUrls(alpha, { verification_url: bad, verification_url_complete: bad }), String(bad)).toBe(null);
    }
    expect(hubs.linkUrls(alpha, null)).toBe(null);
  });
});

// ── 3. main.js: the glue ────────────────────────────────────────────────────────────────────────────────────────
describe('main.js wires the guild into the link flow, the agent and the session', () => {
  const raw = read('apps/mimic/main.js');
  const src = stripJs(raw);
  const block = (start, end) => {
    const a = src.indexOf(start);
    expect(a, 'missing ' + start).toBeGreaterThan(-1);
    const b = src.indexOf(end, a);
    expect(b, 'missing ' + end).toBeGreaterThan(a);
    return src.slice(a, b);
  };

  it('starts the agent with the hub\'s bot address: --bot-url is cfg.botUrl, which the picker writes', () => {
    const launch = block('const args = [agentPath', 'env.WOLFPACK_TOKEN = uploadToken');
    expect(launch).toMatch(/args\.push\('--bot-url', cfg\.botUrl\)/);
    expect(block('async function setHub', 'const CHAT_CACHE_GRACE_MS')).toMatch(/hubs\.applyHub\(after, next\)/);
  });

  it('link start uses the hub: its bot, its slug, and the vetted addresses (never the raw ones)', () => {
    const start = block('async function startMimicLink', 'const expiresAt');
    expect(start).toMatch(/hubs\.hubOf\(cfg\)/);
    expect(start).toMatch(/hubs\.linkStartBody\(hub, /);
    expect(start).not.toMatch(/hub: hub\.slug/);   // not sent unconditionally: Wolf Pack's body stays byte-identical
    expect(start).toMatch(/hubs\.linkUrls\(hub, resp\.body\)/);
    expect(start).not.toMatch(/verification_url(_complete)?, expires_in/);   // not destructured raw off the reply
    expect(start).not.toMatch(/Could not reach the Wolf Pack server/);
  });

  it('switching guilds clears the session, tells the old bot, starts the Chat cache grace window and restarts the agent', () => {
    const set = block('async function setHub', 'const CHAT_CACHE_GRACE_MS');
    expect(set).toMatch(/hubs\.applyHub\(after, next\)/);
    expect(set).toMatch(/_chatCacheOnLogout\(\)/);
    expect(set.indexOf('_chatCacheOnLogout()')).toBeLessThan(set.indexOf('hubs.applyHub(after, next)'));   // while the session still exists
    expect(set).toMatch(/cancelMimicLink\(\)/);
    expect(set).toMatch(/\/api\/mimic-link\/revoke[\s\S]*oldToken/);
    expect(set).toMatch(/agentProc\.kill\(\)/);
    expect(set).toMatch(/signedOut: !!oldToken/);
    // the same bot is not a switch: no sign-out
    expect(set).toMatch(/if \(hubs\.sameHub\(prev, next\)\)[\s\S]*?signedOut: false/);
  });

  it('looks a listed guild up in the directory instead of trusting the page for its address', () => {
    const set = block('async function setHub', 'const CHAT_CACHE_GRACE_MS');
    expect(set).toMatch(/c\.slug[\s\S]*getHubDirectory\(false\)/);
    expect(set).toMatch(/hubs\.parseGuildAddress\(c\.address\)/);
  });

  it('caches the directory in userData and refreshes it at most daily, offline falling back to the last copy', () => {
    const dir = block('const HUB_CACHE_FILE', 'async function setHub');
    expect(dir).toMatch(/userData'\), 'hubs\.json'/);
    expect(dir).toMatch(/hubs\.directoryFresh\(cached, now\)/);
    expect(dir).toMatch(/hubs\.HUB_DIRECTORY_URL/);
    expect(dir).toMatch(/catch \(e\)[\s\S]*sanitizeDirectory\(cached \? cached\.hubs : \[\]\)/);
    expect(hubs.HUB_DIRECTORY_URL).toBe('https://raidmimic.com/api/hubs');
  });

  it('exposes the picker over IPC and the hub in the status, and lets the own guild\'s site and live link address open', () => {
    expect(src).toMatch(/ipcMain\.handle\('hub-list'/);
    expect(src).toMatch(/ipcMain\.handle\('hub-set'/);
    expect(src).toMatch(/hub: hubs\.hubOf\(cfg\)/);
    const ext = block("ipcMain.handle('open-external'", 'shell.openExternal(url)');
    expect(ext).toMatch(/_linkInFlight\._pub\.verification_url_complete/);
    expect(ext).toMatch(/hubs\.hubOf\(loadConfig\(\)\)\.site/);
    expect(ext).toMatch(/!ALLOW\.test\(url\) && !ownGuild/);
  });

  it('preload carries hubList and hubSet', () => {
    const pre = stripJs(read('apps/mimic/preload.js'));
    expect(pre).toMatch(/hubList:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('hub-list'\)/);
    expect(pre).toMatch(/hubSet:\s*\(choice\)\s*=>\s*ipcRenderer\.invoke\('hub-set', choice\)/);
  });

  it('leaves the informational wolfpack.quest links alone in this slice (the tray item still opens it)', () => {
    expect(src).toMatch(/const WOLFPACK_URL\s*=\s*'https:\/\/wolfpack\.quest'/);
    expect(src).toMatch(/shell\.openExternal\(WOLFPACK_URL\)/);
  });
});

// ── 4. The picker on screen ─────────────────────────────────────────────────────────────────────────────────────
describe('welcome.html\'s account step has the Guild choice', () => {
  const src = stripJs(read('apps/mimic/welcome.html'));
  it('lists the directory with the current guild selected and offers "Paste a guild address"', () => {
    expect(src).toMatch(/id="wHub"/);
    expect(src).toMatch(/x\.slug === cur\.slug \? ' selected'/);
    expect(src).toMatch(/Paste a guild address/);
    expect(src).toMatch(/id="wHubAddr"/);
    expect(src).toMatch(/M\.hubList\(\)/);
    expect(src).toMatch(/M\.hubSet\(choice\)/);
  });
  it('the picker is in the signed-out and signed-in views alike, ahead of the sign-in buttons', () => {
    const acct = src.slice(src.indexOf('function bAccount'), src.indexOf('function bFolder'));
    expect(acct.indexOf('hubPicker(linking)')).toBeGreaterThan(-1);
    expect(acct.indexOf('hubPicker(linking)')).toBeLessThan(acct.indexOf('if (linking)'));
  });
  it('asks before a signed-in PC switches (it signs out), and says what to do next', () => {
    expect(src).toMatch(/S\.signedIn && !window\.confirm\('Switching guilds signs you out/);
    expect(src).toMatch(/Link Mimic again with this guild/);
  });
  it('holds a background redraw while the list or the paste box has the focus', () => {
    expect(src).toMatch(/<select id="wHub" data-keep-typing/);
    expect(src).toMatch(/id="wHubAddr" type="text" data-keep-typing/);
  });
  it('names the chosen guild\'s site in the code line instead of a fixed wolfpack.quest', () => {
    expect(src).toMatch(/\(hub\.site \|\| 'https:\/\/wolfpack\.quest'\) \+ '\/auth\/mimic-link'/);
    expect(src).not.toMatch(/verification_url \|\| 'wolfpack\.quest\/auth\/mimic-link'/);
  });
});

describe('Settings has the Guild choice too', () => {
  const src = stripJs(read('apps/mimic/settings.html'));
  it('has the select, the paste row and drives the same IPC', () => {
    expect(src).toMatch(/id="hubSel"/);
    expect(src).toMatch(/id="hubAddr"/);
    expect(src).toMatch(/window\.mimic\.hubList\(\)/);
    expect(src).toMatch(/window\.mimic\.hubSet\(choice\)/);
    expect(src).toMatch(/Paste a guild address/);
  });
  it('confirms a switch while signed in, and keeps the Bot URL field in step without making the form dirty', () => {
    expect(src).toMatch(/_signedInNow && !confirm\('Switching guilds signs you out/);
    expect(src).toMatch(/_loaded\.botUrl = c\.botUrl/);
    expect(src).toMatch(/if \(wasClean\) _markClean\(\)/);
  });
  it('uses the chosen guild\'s site in the code line', () => {
    expect(src).toMatch(/\(_hub\.site \|\| 'https:\/\/wolfpack\.quest'\) \+ '\/auth\/mimic-link'/);
  });
});

// ── 5. The link flow carries the chosen guild (DECISIONS §500) ───────────────────────────────────────────────────
describe('linkStartBody: the start request names the guild only when it is not Wolf Pack', () => {
  const alpha = { slug: 'alpha', display_name: 'Alpha', url: 'https://hosted.example', site: 'https://alpha.example' };
  it('is byte-identical to the old request for Wolf Pack and for a pasted self-host', () => {
    expect(JSON.stringify(hubs.linkStartBody(WOLF, 'mimic 1.0.0'))).toBe('{"agent_version":"mimic 1.0.0"}');
    expect(hubs.linkStartBody({ slug: 'custom', display_name: 'x', url: 'https://their.example', site: '' }, 'v')).toEqual({ agent_version: 'v' });
    expect(hubs.linkStartBody({}, 'v')).toEqual({ agent_version: 'v' });
  });
  it('carries the slug for a listed guild', () => {
    expect(hubs.linkStartBody(alpha, 'mimic 1.0.0')).toEqual({ agent_version: 'mimic 1.0.0', hub: 'alpha' });
  });
});

describe('startMimicLink sends that body and opens the address the bot chose', () => {
  const main = read('apps/mimic/main.js');
  const alpha = { slug: 'alpha', display_name: 'Alpha', url: 'https://hosted.example', site: 'https://alpha.example' };
  // The real function up to the point it has its addresses, run against stubs.
  const fnText = sliceBlock(main, 'async function startMimicLink() {', 'const { verification_url, verification_url_complete } = links;') + '\n  return { verification_url, verification_url_complete };\n}';
  const run = async (hub, reply) => {
    const sent = [];
    // hubOf reads the stub config; hand it the hub under test, every other rule is the real module's
    const real = { ...hubs, hubOf: () => hub };
    const make = new Function('hubs', 'loadConfig', '_botBaseUrl', '_httpsJsonPost', 'app', 'let _linkInFlight = null;\n' + fnText + '\nreturn startMimicLink;');
    const out = await make(real, () => ({}), () => 'https://bot.example', async (base, p, body) => { sent.push({ base, p, body }); return reply; }, { getVersion: () => '9.9.9' })();
    return { sent, out };
  };
  const ok = (extra) => ({ status: 200, body: { device_code: 'd', user_code: 'ABC123', expires_in: 600, poll_interval: 2, verification_url: 'https://wolfpack.quest/auth/mimic-link', verification_url_complete: 'https://wolfpack.quest/auth/mimic-link?code=ABC123', ...extra } });

  it('Wolf Pack: the body has no hub key and the bot\'s address is used as sent', async () => {
    const { sent, out } = await run(WOLF, ok());
    expect(sent[0].p).toBe('/api/mimic-link/start');
    expect(JSON.stringify(sent[0].body)).toBe('{"agent_version":"mimic 9.9.9"}');
    expect(out.verification_url_complete).toBe('https://wolfpack.quest/auth/mimic-link?code=ABC123');
  });
  it('a listed guild: the body carries its slug', async () => {
    const { sent } = await run(alpha, ok());
    expect(sent[0].body).toEqual({ agent_version: 'mimic 9.9.9', hub: 'alpha' });
  });
  it('prefers the bot\'s own address when the reply carries a hub key (no re-homing onto the directory\'s site)', async () => {
    const reply = ok({ hub: 'alpha', verification_url: 'https://raidmimic.com/auth/mimic-link', verification_url_complete: 'https://raidmimic.com/auth/mimic-link?code=ABC123' });
    const { out } = await run(alpha, reply);
    expect(out.verification_url).toBe('https://raidmimic.com/auth/mimic-link');
    expect(out.verification_url_complete).toBe('https://raidmimic.com/auth/mimic-link?code=ABC123');
  });
  it('still re-homes onto the guild\'s site when the bot has not learned the slug (no hub key in the reply)', async () => {
    const { out } = await run(alpha, ok());
    expect(out.verification_url_complete).toBe('https://alpha.example/auth/mimic-link?code=ABC123');
  });
  it('stays https-only even when the reply carries a hub key', async () => {
    for (const bad of ['http://raidmimic.com/auth/mimic-link', 'file:///C:/x', 'javascript:1']) {
      const { out } = await run(alpha, ok({ hub: 'alpha', verification_url: bad, verification_url_complete: bad }));
      expect(out, bad).toEqual({ ok: false, error: 'The Alpha server gave a sign-in address Mimic will not open.' });
    }
  });
});

describe('a hub session is stored with its guild and named in Settings and the welcome page', () => {
  const hubReply = { status: 'linked', session_token: 'wpms_x', user_id: 'u', discord_id: '111', display_name: 'Aldenmar', is_officer: false, role_names: [], scope: 'member', guild_id: 'alpha', hub_role: 'member' };
  const alpha = { slug: 'alpha', display_name: 'Alpha Guild', url: 'https://hosted.example', site: 'https://alpha.example' };

  it('keeps the guild slug and role from a member poll, and Wolf Pack\'s identity exactly as before', () => {
    expect(hubs.identityFromPoll(hubReply)).toEqual({ user_id: 'u', discord_id: '111', display_name: 'Aldenmar', is_officer: false, role_names: [], guild_id: 'alpha', hub_role: 'member' });
    const wp = { status: 'linked', session_token: 't', user_id: 'u', discord_id: '1', display_name: 'N', is_officer: true, role_names: ['Officer'] };
    expect(hubs.identityFromPoll(wp)).toEqual({ user_id: 'u', discord_id: '1', display_name: 'N', is_officer: true, role_names: ['Officer'] });
    expect(Object.keys(hubs.identityFromPoll(wp))).not.toContain('guild_id');
  });
  it('does not keep a guild from a guest poll or from text that is not a slug or role', () => {
    expect(hubs.identityFromPoll({ ...hubReply, scope: 'guest' }).guild_id).toBeUndefined();
    expect(hubs.identityFromPoll({ ...hubReply, guild_id: '<b>x</b>' }).guild_id).toBeUndefined();
    expect(hubs.identityFromPoll({ ...hubReply, guild_id: 'wolfpack' }).guild_id).toBeUndefined();
    expect(hubs.identityFromPoll({ ...hubReply, hub_role: '<script>' }).hub_role).toBeUndefined();
  });
  it('sessionGuild: null for Wolf Pack, the guild\'s name and member/officer for a hub session', () => {
    expect(hubs.sessionGuild({ discord_id: '1', is_officer: true }, WOLF)).toBe(null);
    expect(hubs.sessionGuild(null, WOLF)).toBe(null);
    expect(hubs.sessionGuild(hubs.identityFromPoll(hubReply), alpha)).toEqual({ slug: 'alpha', display_name: 'Alpha Guild', role: 'member' });
    expect(hubs.sessionGuild(hubs.identityFromPoll({ ...hubReply, hub_role: 'officer', is_officer: true }), alpha).role).toBe('officer');
    expect(hubs.sessionGuild(hubs.identityFromPoll({ ...hubReply, hub_role: 'owner' }), alpha).role).toBe('officer');
    expect(hubs.sessionGuild(hubs.identityFromPoll(hubReply), WOLF).display_name).toBe('alpha');   // hub not in the config: the slug
  });

  it('main.js stores the poll through identityFromPoll and puts the guild in the status', () => {
    const src = stripJs(read('apps/mimic/main.js'));
    expect(src).toMatch(/storeUploadToken\(c, p\.body\.session_token, hubs\.identityFromPoll\(p\.body\)\)/);
    expect(src).toMatch(/guild:\s+hubs\.sessionGuild\(cfg\.session\.identity, hubs\.hubOf\(cfg\)\)/);
  });
  it('Settings reads the line from the session\'s guild and falls back to nothing (the old wording) without one', () => {
    const html = read('apps/mimic/settings.html');
    const { _guildLine } = evalBlock(sliceBlock(html, 'function _guildLine(g){', '\n  }'), ['_guildLine']);
    expect(_guildLine({ slug: 'alpha', display_name: 'Alpha Guild', role: 'member' })).toBe('Linked to Alpha Guild (member)');
    expect(_guildLine({ slug: 'alpha', display_name: 'Alpha Guild', role: 'officer' })).toBe('Linked to Alpha Guild (officer)');
    expect(_guildLine(null)).toBe('');
    expect(stripJs(html)).toMatch(/_guildLine\(session\.guild\)/);
  });
  it('the welcome page names the guild after "Signed in as" only when the session has one', () => {
    const src = stripJs(read('apps/mimic/welcome.html'));
    expect(src).toMatch(/session && session\.guild \? ' — linked to <b>' \+ esc\(session\.guild\.display_name\)/);
  });
});
