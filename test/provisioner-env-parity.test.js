// test/provisioner-env-parity.test.js — the provisioner, the env and the loader agree.
//
// Four files describe the same set of Discord anchors from four sides: the layout
// manifest (data/discord-layout.json), the example a guild copies
// (guild/discord.example.json), the documented env (.env.example), and the boot
// loader in index.js that turns a committed discord.json into env. If they drift
// apart a guild gets a file the loader half-ignores, or an export that refuses to
// load. These tests keep them one thing, and keep the provisioner from reaching
// for state.json (which does not persist on Railway) or for a hostname or an id.
//
// Run: npx vitest run test/provisioner-env-parity.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, BOT_INDEX, readSource, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const require = createRequire(import.meta.url);
const prov = require(path.join(ROOT, 'utils', 'discordProvisioner.js'));

const layout = prov.loadLayout();
const expanded = prov.expandLayout(layout);
const KEYS = prov.allKeys(expanded);
const example = JSON.parse(fs.readFileSync(path.join(ROOT, 'guild', 'discord.example.json'), 'utf8'));
const envExample = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
const indexSrc = readSource(BOT_INDEX);

// The real boot loader, from the source (same shim as test/guild-discord-json.test.js).
globalThis.__wpTestFs = fs; globalThis.__wpTestPath = path;
const { _loadGuildDiscordJson } = evalBlock(
  "const require = (m) => m === 'fs' ? globalThis.__wpTestFs : globalThis.__wpTestPath;\n"
    + sliceBlock(indexSrc, 'function _loadGuildDiscordJson(dir, env) {', '\n}'),
  ['_loadGuildDiscordJson'],
);
const loaderSrc = sliceBlock(indexSrc, 'function _loadGuildDiscordJson(dir, env) {', '\n}');

function loadThrough(json) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-parity-'));
  fs.writeFileSync(path.join(dir, 'discord.json'), typeof json === 'string' ? json : JSON.stringify(json));
  const env = {};
  const r = _loadGuildDiscordJson(dir, env);
  return { env, r };
}

describe('the example file', () => {
  it('holds every anchor the layout knows, and nothing else', () => {
    const keys = Object.keys(example).filter(k => !k.startsWith('_')).sort();
    expect(keys).toEqual([...KEYS].sort());
    expect(KEYS.length).toBeGreaterThan(60);
  });

  it('is exactly what the exporter generates for an empty guild, so regenerating it changes nothing', () => {
    expect(prov.buildExport(expanded, {}).json).toEqual(example);
  });

  it('is all nulls, so copying it unchanged configures nothing', () => {
    expect(Object.entries(example).filter(([k]) => !k.startsWith('_')).every(([, v]) => v === null)).toBe(true);
    const { env, r } = loadThrough(example);
    expect(env).toEqual({});
    expect(r.filled).toEqual([]);
  });

  it('drops the flags and the dead announce channel, and keeps the dynamic keys', () => {
    for (const k of ['RAID_NIGHT_THREADS', 'RAID_NIGHT_THREAD_BOSS_ONLY', 'RELEASE_ANNOUNCE_CHANNEL_ID']) expect(k in example).toBe(false);
    for (const k of ['CLASSIC_THREAD_ID', 'POP_THREAD_ID', 'LUCLIN_COOLDOWN_ID', 'KUNARK_BOARD_IDS', 'LIVE_HATE_BOARD_ID',
      'PVP_HATE_BOARD_ID', 'DEATHROLL_CHANNEL_ID', 'QUARM_PATCH_NOTES_CHANNEL_ID', 'RAIDHELPER_CHANNEL_ID',
      'RULES_CHANNEL_ID', 'RAID_RULES_CHANNEL_ID', 'LOOT_RULES_CHANNEL_ID']) expect(k in example, k).toBe(true);
  });
});

describe('every manifest env name is documented', () => {
  it('appears in .env.example, so a person reading it can find what it is for', () => {
    for (const k of KEYS) expect(new RegExp(`\\b${k}\\b`).test(envExample), `${k} is not in .env.example`).toBe(true);
  });

  it('every GUILD_PROVISION switch the code reads is documented, and the other way round', () => {
    const src = stripJs(fs.readFileSync(path.join(ROOT, 'utils', 'discordProvisioner.js'), 'utf8'));
    const read = new Set([...src.matchAll(/env\.(GUILD_PROVISION[A-Z_]*)/g)].map(m => m[1]));
    expect([...read].sort()).toEqual(['GUILD_PROVISION', 'GUILD_PROVISION_CREATE_CHANNELS', 'GUILD_PROVISION_LOCK',
      'GUILD_PROVISION_OPTIONAL', 'GUILD_PROVISION_PIN', 'GUILD_PROVISION_SKIP']);
    for (const k of read) expect(new RegExp(`^${k}=`, 'm').test(envExample), `${k}= is not in .env.example`).toBe(true);
    for (const m of envExample.matchAll(/^(GUILD_PROVISION[A-Z_]*)=/gm)) expect(read.has(m[1]), `${m[1]} documented but not read`).toBe(true);
  });

  it('ships safe defaults: auto, no channels, no lock, no pin, nothing optional', () => {
    expect(envExample).toMatch(/^GUILD_PROVISION=auto$/m);
    expect(envExample).toMatch(/^GUILD_PROVISION_CREATE_CHANNELS=$/m);
    expect(envExample).toMatch(/^GUILD_PROVISION_OPTIONAL=$/m);
    expect(envExample).toMatch(/^GUILD_PROVISION_SKIP=$/m);
    expect(envExample).toMatch(/^GUILD_PROVISION_LOCK=none$/m);
    expect(envExample).toMatch(/^GUILD_PROVISION_PIN=0$/m);
    // and the documented defaults are what the code resolves them to
    const o = prov.optionsFromEnv({});
    expect([o.mode, o.createChannels, o.lock, o.pin, o.optional.size, o.skip.size]).toEqual(['auto', false, 'none', false, 0, 0]);
  });
});

describe('the secret refusal is the loader\'s refusal', () => {
  it('uses the very same pattern as _loadGuildDiscordJson', () => {
    const m = /if \((\/[^/\n]+\/)\.test\(k\)\)/.exec(loaderSrc);
    expect(m, 'could not find the refusal in the loader').toBeTruthy();
    // eslint-disable-next-line no-new-func
    const loaderRe = new Function(`return ${m[1]}`)();
    expect(prov.SECRET_KEY_RE.source).toBe(loaderRe.source);
    expect(prov.SECRET_KEY_RE.flags).toBe(loaderRe.flags);
  });

  it('refuses the same names the loader refuses', () => {
    for (const k of ['TAG_CHANNEL_SPEC', 'DISCORD_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY', 'WISHLIST_BID_KEY', 'SOME_PASSWORD', 'A_SECRET']) {
      expect(prov.SECRET_KEY_RE.test(k)).toBe(true);
    }
    for (const k of KEYS) expect(prov.SECRET_KEY_RE.test(k), `${k} looks secret to the loader`).toBe(false);
  });
});

describe('export', () => {
  const values = {
    TIMER_CHANNEL_ID: '111', CLASSIC_THREAD_ID: '222', CLASSIC_BOARD_IDS: ['331', '332', '333'],
    SUMMARY_MESSAGE_ID: '444', FORUM_CHANNEL_ID: '555',
  };

  it('keeps every key, null where unprovisioned', () => {
    const out = prov.buildExport(expanded, values);
    expect(Object.keys(out.json).filter(k => !k.startsWith('_')).sort()).toEqual([...KEYS].sort());
    expect(out.json.TIMER_CHANNEL_ID).toBe('111');
    expect(out.json.KUNARK_THREAD_ID).toBe(null);
    expect(out.json.CLASSIC_BOARD_IDS).toEqual(['331', '332', '333']);
  });

  it('drops secret-shaped keys even when the layout or the values carry them', () => {
    const dirty = JSON.parse(JSON.stringify(layout));
    dirty.selfHealing.push({ env: 'OPENDKP_API_KEY', why: 'x' }, { env: 'TAG_CHANNEL_SPEC', why: 'x' });
    dirty.external.push({ env: 'SOME_PASSWORD_CHANNEL_ID', step: 'x' });
    const dirtyExpanded = prov.expandLayout(dirty);
    expect(prov.allKeys(dirtyExpanded)).toContain('OPENDKP_API_KEY');   // the layout does carry it
    const out = prov.buildExport(dirtyExpanded, { ...values, OPENDKP_API_KEY: 'k-123', TAG_CHANNEL_SPEC: 'a:b', SOME_PASSWORD_CHANNEL_ID: '9' });
    for (const k of ['OPENDKP_API_KEY', 'TAG_CHANNEL_SPEC', 'SOME_PASSWORD_CHANNEL_ID']) {
      expect(k in out.json).toBe(false);
    }
    expect(out.jsonText + out.envText).not.toMatch(/k-123|a:b|PASSWORD|SPEC|API_KEY/);
  });

  it('round-trips through the real boot loader with nothing refused', () => {
    const out = prov.buildExport(expanded, values);
    const { env, r } = loadThrough(out.jsonText);
    expect(r.refused).toEqual([]);
    expect(env).toEqual({
      TIMER_CHANNEL_ID: '111', CLASSIC_THREAD_ID: '222', CLASSIC_BOARD_IDS: '331,332,333', SUMMARY_MESSAGE_ID: '444', FORUM_CHANNEL_ID: '555',
    });
    // nulls were ignored, not turned into the string "null"
    expect(Object.values(env).includes('null')).toBe(false);
  });

  it('the env block carries the same values the JSON does, board sets comma-joined, and names what is unprovisioned', () => {
    const out = prov.buildExport(expanded, values);
    const lines = out.envText.split('\n').filter(l => /^[A-Z0-9_]+=/.test(l));
    expect(Object.fromEntries(lines.map(l => l.split(/=(.*)/s).slice(0, 2)))).toEqual({
      TIMER_CHANNEL_ID: '111', CLASSIC_THREAD_ID: '222', CLASSIC_BOARD_IDS: '331,332,333', SUMMARY_MESSAGE_ID: '444', FORUM_CHANNEL_ID: '555',
    });
    expect(out.envText).toMatch(/# not provisioned: .*KUNARK_THREAD_ID/);
  });

  it('exports what a run recorded: every key of a full virgin build survives the loader', async () => {
    const { makeWorld, quiet } = await import('./_fake-discord-world.js');
    const world = makeWorld();
    const env = { DISCORD_GUILD_ID: world.guildId };
    const report = await prov.provisionLayout({ client: world.client, supabase: null, env, mode: 'create', log: quiet });
    const out = prov.buildExport(expanded, prov.exportValues(expanded, report, env));
    const { env: loaded, r } = loadThrough(out.jsonText);
    expect(r.refused).toEqual([]);
    for (const k of expanded.items.filter(i => report.created.includes(i.key)).map(i => i.key)) {
      expect(loaded[k], k).toBe(env[k]);
    }
    expect(Object.keys(loaded).length).toBeGreaterThanOrEqual(22);   // 21 anchors + DISCORD_GUILD_ID
  });

  it('exportValues prefers the report, falls back to env, and skips unset keys', () => {
    const v = prov.exportValues(expanded, { anchors: { TIMER_CHANNEL_ID: { id: 'r1' }, CLASSIC_BOARD_IDS: { ids: ['a', 'b'] } } },
      { TIMER_CHANNEL_ID: 'env1', KUNARK_THREAD_ID: 'k1', POP_THREAD_ID: '  ' });
    expect(v.TIMER_CHANNEL_ID).toBe('r1');
    expect(v.CLASSIC_BOARD_IDS).toEqual(['a', 'b']);
    expect(v.KUNARK_THREAD_ID).toBe('k1');
    expect('POP_THREAD_ID' in v).toBe(false);
  });
});

describe('the layout manifest', () => {
  it('has unique env keys, every thread\'s parent exists, and every slot builder is one the provisioner knows', () => {
    const keys = expanded.items.map(i => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    const parentIds = new Set(layout.parents.map(p => p.id));
    for (const t of layout.threads) expect(parentIds.has(t.parent), `${t.id} -> ${t.parent}`).toBe(true);
    for (const i of expanded.items.filter(x => x.phase === 'thread')) expect(i.parentKey).toBeTruthy();
    for (const s of [...layout.slots.main, ...layout.slots.perEra].filter(x => x.builder)) {
      expect(() => prov.slotInfo(s.builder, 'Classic', prov.loadBosses()), s.builder).not.toThrow();
    }
  });

  it('aliases never collide between two channels (an alias that matched both would adopt one for the other)', () => {
    const seen = new Map();
    for (const p of layout.parents) {
      for (const n of p.names) {
        const k = `${p.type || 'text'}:${prov.norm(n)}`;
        expect(seen.has(k), `${n} is an alias of both ${seen.get(k)} and ${p.id}`).toBe(false);
        seen.set(k, p.id);
      }
    }
  });

  it('puts required only where the bot cannot work without it, and names a known group on every optional', () => {
    const required = expanded.items.filter(i => i.tier === 'required').map(i => i.key);
    expect(required).toContain('TIMER_CHANNEL_ID');
    expect(required).toContain('HISTORIC_KILLS_THREAD_ID');
    expect(required).not.toContain('RAID_CHAT_CHANNEL_ID');
    for (const i of expanded.items.filter(x => x.tier === 'optional')) expect(layout.groups).toContain(i.group);
  });

  it('every thread-like env key is one index.js and the bot actually read as a thread or channel id', () => {
    const src = stripJs(['index.js', ...fs.readdirSync(path.join(ROOT, 'utils')).map(f => `utils/${f}`), ...fs.readdirSync(path.join(ROOT, 'commands')).map(f => `commands/${f}`)]
      .filter(f => f.endsWith('.js') && !/discordProvisioner|commands[\\/]setup/.test(f)).map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n'));
    const dynamic = /toUpperCase\(\)/.test(src);
    expect(dynamic).toBe(true);
    for (const i of expanded.items.filter(x => !x.era)) {
      expect(src.includes('process.env.' + i.key) || src.includes(`'${i.key}'`) || /RULES_CHANNEL_ID/.test(i.key), `${i.key} is read nowhere in the bot`).toBe(true);
    }
  });
});

describe('the provisioner keeps its distance', () => {
  const files = ['utils/discordProvisioner.js', 'commands/setup.js', 'scripts/provision-discord.js', 'data/discord-layout.json'];

  it('never requires utils/state.js and never touches channelSlots or state.json', () => {
    for (const f of files.slice(0, 3)) {
      const code = stripJs(fs.readFileSync(path.join(ROOT, f), 'utf8'));
      expect(code, f).not.toMatch(/require\(['"][^'"]*state['"]\)/);
      expect(code, f).not.toMatch(/channelSlots|state\.json|getAllState|saveState/);
    }
  });

  it('does not load utils/state.js even transitively, checked in a clean process', () => {
    const probe = "require('./utils/discordProvisioner'); require('./commands/setup');"
      + "console.log(Object.keys(require.cache).some(k => /utils[\\\\/]state\\.js$/.test(k)))";
    const out = execFileSync(process.execPath, ['-e', probe], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').pop();
    expect(out).toBe('false');
  });

  it('puts no member, hostname or Discord id in the code or the manifest (this repo is public)', () => {
    for (const f of files) {
      const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
      expect(text, f).not.toMatch(/\b\d{17,20}\b/);
      expect(text, f).not.toMatch(/https?:\/\/(?!discord\.com\/oauth2|discord\.com\/developers)[a-z0-9.-]*\.(?:com|quest|app|net)\b/i);
      expect(text, f).not.toMatch(/\b(?:192\.168|10\.\d+)\.\d+\.\d+/);
    }
  });

  it('assigns env only strings, only to unset keys, and never undefined', () => {
    const src = stripJs(fs.readFileSync(path.join(ROOT, 'utils', 'discordProvisioner.js'), 'utf8'));
    // every write to env goes through setEnv or deriveIdentity, which stringify and check
    const writes = [...src.matchAll(/\b(?:ctx\.)?env\[[^\]]+\]\s*=(?!=)/g)].map(m => m[0]);
    expect(writes.length).toBeGreaterThan(0);
    expect(src).toMatch(/if \(typeof v !== 'string' \|\| v === '' \|\| v === 'undefined'\) return false;/);
    expect(src).toMatch(/if \(!force && isSet\(ctx\.env\[key\]\)\) return false;/);
  });
});

describe('the CLI waits for the client the supported way', () => {
  const cli = stripJs(fs.readFileSync(path.join(ROOT, 'scripts', 'provision-discord.js'), 'utf8'));
  it('uses Events.ClientReady, not the deprecated \'ready\' alias', () => {
    expect(cli).toMatch(/client\.once\(Events\.ClientReady,/);
    expect(cli).not.toMatch(/once\(\s*['"]ready['"]/);
    expect(cli).toMatch(/\{[^}]*\bEvents\b[^}]*\}\s*=\s*require\('discord\.js'\)/);
  });
});

describe('wired into the bot', () => {
  const code = stripJs(indexSrc);
  const ready = sliceBlock(code, 'client.once(Events.ClientReady', '\n});');

  it('bootProvision( is inside ClientReady, before everything that reads an anchor', () => {
    const at = ready.indexOf('bootProvision(');
    expect(at).toBeGreaterThan(-1);
    for (const later of ['registerCommands()', 'startSpawnChecker(', 'scheduleMidnightSummary(', 'startWolfpackMembersSync(']) {
      const l = ready.indexOf(later);
      expect(l, later).toBeGreaterThan(-1);
      expect(at, `bootProvision must come before ${later}`).toBeLessThan(l);
    }
  });

  it('is the first statement of the handler, awaited, and wrapped in a catch', () => {
    const body = ready.slice(ready.indexOf('{') + 1).trimStart();
    expect(body.startsWith("await require('./utils/discordProvisioner').bootProvision(readyClient).catch(")).toBe(true);
    const line = ready.split('\n').find(l => l.includes('bootProvision('));
    expect(line).toMatch(/\.catch\(\(\) => \{\}\);$/);
  });

  it('is the only mention of the provisioner in index.js, and sits inside the ClientReady block', () => {
    const all = [...code.matchAll(/discordProvisioner/g)];
    expect(all).toHaveLength(1);
    expect(ready.includes('discordProvisioner')).toBe(true);
  });

  it('leaves the quarm-patch-notes slice intact: the ClientReady block still ends at its own closing brace', () => {
    expect(ready.endsWith('\n});')).toBe(true);
    expect(ready).toMatch(/_refreshAgentManifestBeta/);
    expect(ready).toMatch(/startOpenDkpSync\(\)/);
  });

  it('runs before guild/discord.json would be needed: the file loader still runs first, at the top', () => {
    expect(indexSrc.indexOf('_loadGuildDiscordJson(require')).toBeLessThan(indexSrc.indexOf('bootProvision('));
  });
});
