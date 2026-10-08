// The guild tag in REST filters — no literal 'wolfpack' where the env should answer.
//
// WHY: eleven REST filter strings in index.js spelled `guild_id=eq.wolfpack` and so ignored
// SUPABASE_GUILD_ID. The worst was _characterPrefsFor, which feeds exclude_from_stats /
// exclude_inventory / tell_relay / hidden_from_lists to the agent poll: on a deployment with another
// tag the rows were never found and a member's privacy opt-outs were silently ignored. The same shape
// sat in the UI-backup owner lookups, the tell relay and the corpse DM.
//
// Resolution order is env -> built-in fallback, and the fallback is today's Wolf Pack value, so a
// deployment that sets SUPABASE_GUILD_ID=wolfpack (or sets nothing) produces the SAME strings as before.
//
// Three guards:
//   1. no literal tag left in a REST filter / object literal (text, comments stripped, small allowlist)
//   2. a ratchet on the inline `process.env.SUPABASE_GUILD_ID || 'wolfpack'` expression, so it never grows
//      (a sweep onto utils/supabase.guildId() is a separate decision; this only stops the spread)
//   3. behaviour: the real handlers, run against a fake supabase that records the filter string
//
// Run: npx vitest run test/guild-tag-rest.test.js
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { ROOT, BOT_INDEX, readSource, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

// ── corpus ───────────────────────────────────────────────────────────────────────────────────────
function jsFilesUnder(rel) {
  const out = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile() && ent.name.endsWith('.js')) out.push(full);
    }
  };
  const start = path.join(ROOT, rel);
  if (fs.existsSync(start)) walk(start);
  return out;
}
const relOf = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');
const strippedSources = (rels) => rels.flatMap(r => {
  const abs = path.join(ROOT, r);
  const files = fs.existsSync(abs) && fs.statSync(abs).isFile() ? [abs] : jsFilesUnder(r);
  return files.map(f => ({ file: relOf(f), text: stripJs(readSource(f)) }));
});

// ── 1. no literal tag where the env should answer ────────────────────────────────────────────────
const RULES = [
  { id: 'rest-filter',    test: (line) => /guild_id=eq\.wolfpack\b/.test(line) },
  { id: 'object-literal', test: (line) => /\b(?:p_guild_id|p_guild|guild_id|guildId)\s*:\s*['"`]wolfpack['"`]/.test(line) },
  { id: 'const-GUILD',    test: (line) => /\bconst\s+[A-Z_]*GUILD[A-Z_]*\s*=\s*['"`]wolfpack['"`]/.test(line) },
  // `guildId || 'wolfpack'` and friends — the fallback spelled again, without the env in front of it.
  { id: 'bare-fallback',  test: (line) => /\|\|\s*['"`]wolfpack['"`]/.test(line) && /guild/i.test(line) && !/SUPABASE_GUILD_ID/.test(line) },
];

// Each entry is an EXEMPTION, not a requirement: a file that stops matching needs no edit here. Every one
// carries the reason it is allowed to stay.
const ALLOW = [
  { rule: 'bare-fallback', file: 'utils/killContext.js',
    why: 'default for an INJECTED argument; its one caller (index.js) always passes the env-aware tag' },
  { rule: 'bare-fallback', file: 'utils/hailBoard.js',
    why: 'default for an INJECTED argument; index.js always passes () => the env-aware tag' },
];
const allowed = (rule, file) => ALLOW.some(a => a.rule === rule && a.file === file);

describe('no literal guild tag outside the env fallback', () => {
  const corpus = strippedSources(['index.js', 'utils', 'commands']);

  it('the corpus is the whole bot, not a handful of files', () => {
    const files = corpus.map(c => c.file);
    expect(files).toContain('index.js');
    expect(files).toContain('utils/supabase.js');
    expect(files.filter(f => f.startsWith('utils/')).length).toBeGreaterThan(50);
    expect(files.filter(f => f.startsWith('commands/')).length).toBeGreaterThan(50);
  });

  it('each rule really detects the shape it is named for (so a green result is not a typo)', () => {
    const byId = Object.fromEntries(RULES.map(r => [r.id, r.test]));
    expect(byId['rest-filter']('`name=eq.x&guild_id=eq.wolfpack&limit=1`')).toBe(true);
    expect(byId['rest-filter']('`guild_id=eq.${guildId}`')).toBe(false);
    expect(byId['object-literal']("  guild_id: 'wolfpack',")).toBe(true);
    expect(byId['object-literal']("  p_guild_id: 'wolfpack',")).toBe(true);
    expect(byId['object-literal']('  guild_id: "wolfpack",')).toBe(true);
    expect(byId['object-literal']("  guild_id: process.env.SUPABASE_GUILD_ID || 'wolfpack',")).toBe(false);
    expect(byId['const-GUILD']("const GUILD = 'wolfpack';")).toBe(true);
    expect(byId['const-GUILD']('const GUILD_ID = "wolfpack";')).toBe(true);
    expect(byId['const-GUILD']('const DEFAULT_GUILD = `wolfpack`;')).toBe(true);
    expect(byId['const-GUILD']('const GUILD = require("./supabase").guildId();')).toBe(false);
    // the inline-fallback ratchet matches double quotes and `??` too, and still skips other env vars
    expect('process.env.SUPABASE_GUILD_ID || "wolfpack"'.match(INLINE_GUILD_FALLBACK)).toHaveLength(1);
    expect("process.env.SUPABASE_GUILD_ID ?? 'wolfpack'".match(INLINE_GUILD_FALLBACK)).toHaveLength(1);
    expect("process.env.SUPABASE_GUILD_ID||'wolfpack'".match(INLINE_GUILD_FALLBACK)).toHaveLength(1);
    expect("process.env.OPENDKP_CLIENT_NAME || 'wolfpack'".match(INLINE_GUILD_FALLBACK)).toBeNull();
    expect(byId['bare-fallback']("const gid = guildId || 'wolfpack';")).toBe(true);
    expect(byId['bare-fallback']("const guildId = process.env.SUPABASE_GUILD_ID || 'wolfpack';")).toBe(false);
    expect(byId['bare-fallback']("client_name: process.env.OPENDKP_CLIENT_NAME || 'wolfpack',")).toBe(false);
  });

  it('every allowlist entry says why', () => {
    for (const a of ALLOW) expect(a.why.length, `${a.rule} ${a.file}`).toBeGreaterThan(40);
  });

  for (const rule of RULES) {
    it(`rule "${rule.id}" finds nothing outside the allowlist`, () => {
      const hits = [];
      for (const { file, text } of corpus) {
        if (allowed(rule.id, file)) continue;
        text.split('\n').forEach((line, i) => { if (rule.test(line)) hits.push(`${file}:${i + 1}  ${line.trim().slice(0, 120)}`); });
      }
      expect(hits).toEqual([]);
    });
  }
});

// ── 2. the inline expression never grows ─────────────────────────────────────────────────────────
// `process.env.SUPABASE_GUILD_ID || 'wolfpack'` is correct where it stands, and it is spelled out at
// every call site rather than shared. Sweeping them onto utils/supabase.guildId() is its own decision
// (an 18k-line file makes "small line count" a poor proxy for "small blast radius"). Until then the
// count may only go DOWN. Lower the ceiling when you sweep; never raise it.
//   2026-10-07: 160 = index.js 123 + utils 25 + commands 10 + scripts 2. Before the guild-tag fix it was
//   150: index.js grew from 112 by the eleven literal-tag sites, and utils/officerChannel.js shed its own
//   copy for the shared getter. The eleven were the last bypasses; the rest already honoured the env.
const INLINE_GUILD_FALLBACK = /process\.env\.SUPABASE_GUILD_ID\s*(?:\|\||\?\?)\s*['"]wolfpack['"]/g;
const INLINE_CEILING = 160;

describe('the inline SUPABASE_GUILD_ID fallback does not spread', () => {
  const corpus = strippedSources(['index.js', 'utils', 'commands', 'scripts']);
  const count = corpus.reduce((n, c) => n + (c.text.match(INLINE_GUILD_FALLBACK) || []).length, 0);

  it('the corpus holds a real number of them, so the ceiling is a cap and not a vacuous bound', () => {
    expect(count).toBeGreaterThan(100);
    expect(INLINE_CEILING).toBeGreaterThan(100);
  });

  it(`is at most ${INLINE_CEILING} (measured 2026-10-07)`, () => {
    expect(count, 'a new inline fallback was added: use require("./utils/supabase").guildId() instead').toBeLessThanOrEqual(INLINE_CEILING);
  });
});

// ── 3. behaviour: the real handlers, against a fake supabase that records the filter ─────────────
const bot = readSource(BOT_INDEX);

let savedEnv;
function setGuildEnv(value) {
  if (savedEnv === undefined) savedEnv = { had: 'SUPABASE_GUILD_ID' in process.env, value: process.env.SUPABASE_GUILD_ID };
  if (value === undefined) delete process.env.SUPABASE_GUILD_ID;
  else process.env.SUPABASE_GUILD_ID = value;
}
afterEach(() => {
  if (savedEnv === undefined) return;
  if (savedEnv.had) process.env.SUPABASE_GUILD_ID = savedEnv.value;
  else delete process.env.SUPABASE_GUILD_ID;
  savedEnv = undefined;
});

const guildOf = (query) => new URLSearchParams(query).get('guild_id');

describe('_characterPrefsFor reads the prefs rows in the deployment\'s own guild', () => {
  const fn = sliceBlock(bot, 'async function _characterPrefsFor(characters) {', '\n  return { prefs };\n}');

  async function run(rows) {
    const selects = [];
    globalThis.__guildTagTest = { selects, rows };
    const prefix = `
      const __t = globalThis.__guildTagTest;
      const require = (m) => {
        if (m === './utils/supabase') {
          return { isEnabled: () => true, select: async (table, query) => { __t.selects.push({ table, query }); return __t.rows; } };
        }
        throw new Error('unexpected require: ' + m);
      };
    `;
    const { _characterPrefsFor } = evalBlock(prefix + fn, ['_characterPrefsFor']);
    const out = await _characterPrefsFor(['Aldenmar']);
    return { selects, out };
  }

  it('SUPABASE_GUILD_ID=acme asks for guild_id=eq.acme', async () => {
    setGuildEnv('acme');
    const { selects } = await run([]);
    expect(selects).toHaveLength(1);
    expect(selects[0].table).toBe('characters');
    expect(guildOf(selects[0].query)).toBe('eq.acme');
    expect(selects[0].query).not.toContain('wolfpack');
  });

  it('a tag with URL-significant characters is encoded, not spliced into the filter', async () => {
    setGuildEnv('a&b=c');
    const { selects } = await run([]);
    expect(guildOf(selects[0].query)).toBe('eq.a&b=c');
    expect(selects[0].query).toContain('guild_id=eq.a%26b%3Dc');
  });

  it('unset asks for wolfpack, and the whole string is byte-identical to what shipped', async () => {
    setGuildEnv(undefined);
    const { selects } = await run([]);
    expect(selects[0].query).toBe(
      'name=in.' + encodeURIComponent('("Aldenmar")')
      + '&select=name,exclude_from_stats,exclude_inventory,tell_relay,hidden_from_lists&guild_id=eq.wolfpack');
  });

  it('SUPABASE_GUILD_ID=wolfpack is the same string as unset', async () => {
    setGuildEnv(undefined);
    const unset = (await run([])).selects[0].query;
    setGuildEnv('wolfpack');
    expect((await run([])).selects[0].query).toBe(unset);
  });

  it('hands the opt-outs of a found row to the poll (the point of finding the row)', async () => {
    setGuildEnv('acme');
    const { out } = await run([{ name: 'Aldenmar', exclude_from_stats: true, exclude_inventory: true, tell_relay: false, hidden_from_lists: true }]);
    expect(out.prefs.Aldenmar).toEqual({ exclude_from_stats: true, exclude_inventory: true, tell_relay: false, hidden_from_lists: true });
  });
});

describe('the UI-backup owner lookups follow the tag, both the character row and its family root', () => {
  const block = sliceBlock(bot, 'async function _handleAgentUiLayoutList(req, res) {', '\n}\n');

  async function list() {
    const queries = [];
    const supabase = {
      isEnabled: () => true,
      select: async (table, query) => {
        queries.push({ table, query });
        if (table !== 'characters') return [];
        return /name=ilike\.Brackwyn/i.test(query)
          ? [{ name: 'Brackwyn', main_name: 'Aldenmar', discord_id: null }]
          : [{ name: 'Aldenmar', main_name: null, discord_id: 'D1' }];
      },
    };
    const mimicLink = { requireAgentAuth: async () => ({ discord_id: 'D1' }) };
    // eslint-disable-next-line no-new-func
    const handler = new Function('require', 'mimicLink', block + '\nreturn _handleAgentUiLayoutList;')(
      (m) => (m === './utils/supabase' ? supabase : null), mimicLink);
    const res = { writeHead() { return res; }, end() { return res; } };
    await handler({ url: '/api/agent/ui_layout?character=Brackwyn' }, res);
    return queries.filter(q => q.table === 'characters');
  }

  it('asks both lookups for guild_id=eq.acme', async () => {
    setGuildEnv('acme');
    const q = await list();
    expect(q).toHaveLength(2);                       // the character, then the family root
    for (const { query } of q) expect(guildOf(query)).toBe('eq.acme');
  });

  it('unset keeps both on wolfpack', async () => {
    setGuildEnv(undefined);
    const q = await list();
    expect(q).toHaveLength(2);
    for (const { query } of q) expect(guildOf(query)).toBe('eq.wolfpack');
  });
});

describe('the corpse DM owner lookup follows the tag', () => {
  const block = sliceBlock(bot, 'const _corpseDmSeen = new Map();', '\n// Assemble pending backfill requests')
    .replace(/\n\/\/ Assemble pending backfill requests$/, '');

  async function die() {
    const queries = [];
    const env = {
      mimicLink: { requireAgentAuth: async () => ({ discord_id: '111' }) },
      supabase: {
        isEnabled: () => true,
        select: async (_table, query) => {
          queries.push(query);
          return /name=ilike\.Brackwyn/i.test(query)
            ? [{ name: 'Brackwyn', discord_id: null, main_name: 'Aldenmar' }]
            : [{ name: 'Aldenmar', discord_id: '111', main_name: 'Aldenmar' }];
        },
      },
      client: { users: { fetch: async (id) => ({ id, send: async () => {} }) } },
    };
    // eslint-disable-next-line no-new-func
    const { _handleAgentCorpse } = new Function('env', `
      const { mimicLink, client } = env;
      const require = (m) => (m === './utils/supabase' ? env.supabase : null);
      ${block}
      return { _handleAgentCorpse };`)(env);
    const req = new EventEmitter();
    const res = { writeHead() {}, end() {} };
    const p = _handleAgentCorpse(req, res);
    setImmediate(() => {
      req.emit('data', JSON.stringify({ character: 'Brackwyn', died_at: '2026-09-26T01:42:10.000Z', zone_id: 71, zone: 'Plane of Sky', loc: { x: 1, y: 2, z: 3 } }));
      req.emit('end');
    });
    await p;
    return queries;
  }

  it('asks the character row and its family root for guild_id=eq.acme', async () => {
    setGuildEnv('acme');
    const q = await die();
    expect(q).toHaveLength(2);
    for (const query of q) expect(guildOf(query)).toBe('eq.acme');
  });

  it('unset keeps both on wolfpack', async () => {
    setGuildEnv(undefined);
    const q = await die();
    expect(q).toHaveLength(2);
    for (const query of q) expect(guildOf(query)).toBe('eq.wolfpack');
  });
});

// ── the Mimic character-prefs routes follow the tag, and the tag is encoded wherever it is spliced ──
describe('utils/characterPrefs filters follow SUPABASE_GUILD_ID (read at load, like the env is set at boot)', () => {
  const nodeRequire = createRequire(import.meta.url);
  const load = () => {
    for (const k of Object.keys(nodeRequire.cache)) if (/[\\/]utils[\\/](characterPrefs|supabase)\.js$/.test(k)) delete nodeRequire.cache[k];
    return nodeRequire('../utils/characterPrefs.js');
  };
  async function queries(cp) {
    const seen = [];
    const supabase = {
      async rpc() { return ['Aldenmar']; },
      async select(_t, q) { seen.push(q); return []; },
      async update(_t, q) { seen.push(q); return []; },
    };
    await cp.minePrefs(supabase, cp.createOwnedCache(), 'D1');
    await cp.setPrefs(supabase, cp.createOwnedCache(), 'D1', { character: 'Aldenmar', mode: 'show' });
    return seen;
  }

  it('SUPABASE_GUILD_ID=acme asks both the list and the write for guild_id=eq.acme', async () => {
    setGuildEnv('acme');
    const q = await queries(load());
    expect(q).toHaveLength(2);
    for (const query of q) expect(guildOf(query)).toBe('eq.acme');
  });

  it('a tag like a&b=c is encoded in both', async () => {
    setGuildEnv('a&b=c');
    const q = await queries(load());
    expect(q).toHaveLength(2);
    for (const query of q) { expect(guildOf(query)).toBe('eq.a&b=c'); expect(query).toContain('guild_id=eq.a%26b%3Dc'); }
  });

  it('unset is wolfpack, and GUILD is still exported', async () => {
    setGuildEnv(undefined);
    const cp = load();
    expect(cp.GUILD).toBe('wolfpack');
    for (const query of await queries(cp)) expect(guildOf(query)).toBe('eq.wolfpack');
  });
});

describe('every `guild_id=eq.${…}` spliced into a REST filter is percent-encoded', () => {
  // The tag is operator-supplied, so `a&b=c` must not be able to add a filter. A bare identifier is fine
  // only when the same file assigns it from an encoder (`const g = encodeURIComponent(…)`).
  const ENCODERS = /^(?:encodeURIComponent|_?enc)\(/;
  const SPLICE = /guild_id=eq\.\$\{([^}]*)\}/g;
  const unencoded = (text) => {
    const bad = [];
    for (const m of text.matchAll(SPLICE)) {
      const expr = m[1].trim();
      if (ENCODERS.test(expr)) continue;
      if (/^\w+$/.test(expr) && new RegExp(`\\b(?:const|let)\\s+${expr}\\s*=\\s*(?:encodeURIComponent|_?enc)\\(`).test(text)) continue;
      bad.push(m[0]);
    }
    return bad;
  };

  it('the detector flags a bare tag and passes an encoded one (so a green result is not a typo)', () => {
    expect(unencoded('`guild_id=eq.${guildId}&x=1`')).toEqual(['guild_id=eq.${guildId}']);
    expect(unencoded('`guild_id=eq.${encodeURIComponent(guildId)}`')).toEqual([]);
    expect(unencoded('`guild_id=eq.${enc(gid())}`')).toEqual([]);
    expect(unencoded('const g = encodeURIComponent(guildId); `guild_id=eq.${g}`')).toEqual([]);
    expect(unencoded('const g = guildId; `guild_id=eq.${g}`')).toEqual(['guild_id=eq.${g}']);
  });

  it('nothing in the bot splices a raw tag', () => {
    const hits = [];
    for (const { file, text } of strippedSources(['index.js', 'utils', 'commands'])) {
      for (const h of unencoded(text)) hits.push(`${file}  ${h}`);
    }
    expect(hits).toEqual([]);
  });
});

// ── the shared getter and the util fallbacks that now use it ─────────────────────────────────────
describe('utils/supabase.guildId() is the one shared fallback', () => {
  const require_ = (rel) => import(rel).then(m => m.default || m);

  it('returns the env tag, else wolfpack, read at call time', async () => {
    const supabase = await require_('../utils/supabase.js');
    setGuildEnv(undefined);
    expect(supabase.guildId()).toBe('wolfpack');
    setGuildEnv('acme');
    expect(supabase.guildId()).toBe('acme');
    setGuildEnv('');
    expect(supabase.guildId()).toBe('wolfpack');     // an empty var is "unset", as it is everywhere inline
  });

  it('officerChannel keys its bot_kv row by the tag, whatever supabase stand-in it is handed', async () => {
    const { getOfficerChannelId } = await require_('../utils/officerChannel.js');
    const seen = [];
    const standIn = { isEnabled: () => true, select: async (_t, q) => { seen.push(q); return []; } };   // no guildId() on it
    setGuildEnv('acme');
    await getOfficerChannelId(standIn);
    setGuildEnv(undefined);
    await getOfficerChannelId(standIn);
    expect(seen.map(guildOf)).toEqual(['eq.acme', 'eq.wolfpack']);
  });

  it('kill lockout rows carry the tag when the caller passes none, and the caller\'s tag when it does', async () => {
    const kl = await require_('../utils/killLockouts.js');
    const build = (guildId) => kl.buildKillLockouts({
      boss: { id: 'b1', name: 'A Boss', timerHours: 66 }, participants: ['Aldenmar', 'Brackwyn'],
      killedAtMs: Date.now() - 60_000, inRaidNight: true, inRaidWindow: true, roster: null, guildId,
    });
    setGuildEnv('acme');
    const rows = build(undefined);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(r => r.guild_id === 'acme')).toBe(true);
    expect(build('other').every(r => r.guild_id === 'other')).toBe(true);
    setGuildEnv(undefined);
    expect(build(undefined).every(r => r.guild_id === 'wolfpack')).toBe(true);
  });

  it('backfill requests carry the tag when the caller passes none', async () => {
    const bf = await require_('../utils/backfillScan.js');
    const finding = {
      kind: 'inflated', npcName: 'A Boss', startedAt: '2026-07-31T02:35:10+00:00', durationSec: 120, severity: 2,
      candidates: [{ name: 'Aldenmar', reasons: [] }],
    };
    setGuildEnv('acme');
    const rows = bf.buildRequestRows([finding], {});
    expect(rows).toHaveLength(1);
    expect(rows[0].guild_id).toBe('acme');
    expect(bf.buildRequestRows([finding], { guildId: 'other' })[0].guild_id).toBe('other');
    setGuildEnv(undefined);
    expect(bf.buildRequestRows([finding], {})[0].guild_id).toBe('wolfpack');
  });
});
