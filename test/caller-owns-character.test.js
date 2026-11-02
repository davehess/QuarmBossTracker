// test/caller-owns-character.test.js — a request that writes for, or reads the private data of, a named character is for
// the caller's OWN characters.
//
// The rule (index.js _callerMayActAs): the caller may act as a character when its owner (characters.discord_id, else its
// main's) is in the caller's household, or when it has no owner linked and the caller's own Mimic has uploaded as it.
// Officers get no bypass. The helper is EVALUATED here against a fake database; each handler that applies it is then
// checked over comment-stripped source (a comment cannot satisfy these), and the session / member / relay / chat /
// mention / wishlist / link-page rules that ship with it are pinned the same way.
//
// Run: npx vitest run test/caller-owns-character.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { BOT_INDEX, ROOT, readSource, sliceBlock, stripJs } from './_source-slice.js';

const nodeRequire = createRequire(BOT_INDEX);
const RAW = readSource(BOT_INDEX);
const SRC = stripJs(RAW);

// Source of one top-level function (raw) — to the closing brace at column 0.
function fnSrc(src, header) {
  const at = src.indexOf(header);
  if (at < 0) throw new Error('function not found: ' + header);
  return src.slice(at, src.indexOf('\n}\n', at) + 3);
}
const stripped = (header) => stripJs(fnSrc(RAW, header));
const before = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b); return i >= 0 && j >= 0 && i < j; };

// ── the helper, evaluated ────────────────────────────────────────────────────────────────────────────────────
const HELPER_BLOCK = sliceBlock(RAW, '// ── Acting as a character', '// Assemble pending web-staged UI');

function rig({ characters = [], stats = [], household = ['111'], buffer = [], failCharacters = false } = {}) {
  const queries = [];
  const supabase = {
    guildId: () => 'wolfpack',
    select: async (table, q) => {
      queries.push({ table, q });
      if (table === 'characters') {
        if (failCharacters) return null;
        const nm = /name=ilike\.([A-Za-z]+)/.exec(q)[1].toLowerCase();
        return characters.filter(c => c.name.toLowerCase() === nm).map(c => ({ name: c.name, main_name: c.main_name || null, discord_id: c.discord_id || null, }));
      }
      if (table === 'agent_upload_stats') {
        const ch = /character=ilike\.([A-Za-z]+)/.exec(q)[1].toLowerCase();
        const ids = /uploaded_by_discord_id=in\.\(([^)]*)\)/.exec(q)[1].split(',');
        return stats.filter(s => s.character.toLowerCase() === ch && ids.includes(s.uploaded_by_discord_id));
      }
      return [];
    },
  };
  const uploadBuf = new Map(buffer.map((b, i) => ['k' + i, b]));
  // eslint-disable-next-line no-new-func
  const fns = new Function('require', '_uploadStatBuf', '_householdDiscordIds', 'process',
    `${HELPER_BLOCK}\nreturn { _callerMayActAs, _callerOwnNames, _loginIsCallers };`)(
    () => supabase, uploadBuf, async () => new Set(household), { env: {} });
  return { ...fns, queries };
}
const caller = { discord_id: '111', is_officer: false };

describe('_callerMayActAs — whose characters a caller may act as', () => {
  it('yes: the character is linked to someone in the caller\'s household', async () => {
    const r = rig({ characters: [{ name: 'Aldenmar', discord_id: '112' }], household: ['111', '112'] });
    expect(await r._callerMayActAs(caller, 'Aldenmar')).toBe(true);
  });

  it('yes: an alt with no owner of its own takes its main\'s owner', async () => {
    const r = rig({ characters: [{ name: 'Brackwyn', main_name: 'Aldenmar' }, { name: 'Aldenmar', discord_id: '111' }] });
    expect(await r._callerMayActAs(caller, 'brackwyn')).toBe(true);
  });

  it('no: the character belongs to another household, even if the caller uploaded as it', async () => {
    const r = rig({
      characters: [{ name: 'Aldenmar', discord_id: '999' }],
      stats: [{ character: 'Aldenmar', uploaded_by_discord_id: '111' }],
    });
    expect(await r._callerMayActAs(caller, 'Aldenmar')).toBe(false);
  });

  it('no: an officer gets no bypass for another household\'s character', async () => {
    const r = rig({ characters: [{ name: 'Aldenmar', discord_id: '999' }] });
    expect(await r._callerMayActAs({ discord_id: '111', is_officer: true }, 'Aldenmar')).toBe(false);
  });

  it('yes: no owner linked and the caller\'s own Mimic has uploaded as it', async () => {
    const r = rig({ characters: [{ name: 'Corvale' }], stats: [{ character: 'Corvale', uploaded_by_discord_id: '111' }] });
    expect(await r._callerMayActAs(caller, 'Corvale')).toBe(true);
  });

  it('yes: no owner linked and the upload is still waiting in the one-minute stat buffer', async () => {
    const r = rig({ characters: [{ name: 'Corvale' }], buffer: [{ character: 'Corvale', uploaded_by: '111' }] });
    expect(await r._callerMayActAs(caller, 'Corvale')).toBe(true);
    expect(r.queries.some(q => q.table === 'agent_upload_stats')).toBe(false);
  });

  it('no: no owner linked and the caller never uploaded as it (someone else did)', async () => {
    const r = rig({ characters: [{ name: 'Corvale' }], stats: [{ character: 'Corvale', uploaded_by_discord_id: '555' }] });
    expect(await r._callerMayActAs(caller, 'Corvale')).toBe(false);
  });

  it('no: a character the database has never heard of, with no upload by the caller', async () => {
    expect(await rig({})._callerMayActAs(caller, 'Nyssara')).toBe(false);
  });

  it('fails closed: a failed lookup, a missing identity, and names that are not plain letters', async () => {
    expect(await rig({ failCharacters: true })._callerMayActAs(caller, 'Aldenmar')).toBe(false);
    const r = rig({ characters: [{ name: 'Aldenmar', discord_id: '111' }] });
    expect(await r._callerMayActAs({}, 'Aldenmar')).toBe(false);
    expect(await r._callerMayActAs(caller, 'Alden%')).toBe(false);
    expect(await r._callerMayActAs(caller, 'a,b')).toBe(false);
    expect(await r._callerMayActAs(caller, '')).toBe(false);
    expect(r.queries).toHaveLength(0);
  });

  it('_callerOwnNames keeps only the caller\'s own, once each, in order', async () => {
    const r = rig({ characters: [
      { name: 'Aldenmar', discord_id: '111' }, { name: 'Brackwyn', discord_id: '999' }, { name: 'Zarrin', discord_id: '111' },
    ] });
    expect(await r._callerOwnNames(caller, ['Zarrin', 'Brackwyn', 'zarrin', 'Aldenmar', ''])).toEqual(['Zarrin', 'Aldenmar']);
  });

  it('_loginIsCallers: a login is the caller\'s only when a bid under it was placed as one of the caller\'s characters', async () => {
    const r = rig({});
    expect(await r._loginIsCallers('some login', ['Aldenmar'])).toBe(false);     // not a login shape
    expect(await r._loginIsCallers('raiderlogin', [])).toBe(false);              // no characters to tie it to
    expect(await r._loginIsCallers('raid%', ['Aldenmar'])).toBe(false);          // wildcard
    expect(r.queries).toHaveLength(0);
  });
});

// ── the handlers that apply it ───────────────────────────────────────────────────────────────────────────────
describe('bids are for the caller\'s own characters', () => {
  const bid = stripped('async function _handleAgentPlaceBid(req, res) {');
  const prefs = stripped('async function _handleAgentBidPrefs(req, res) {');

  it('place-bid refuses (403) before it reaches OpenDKP', () => {
    expect(bid).toMatch(/if \(!\(await _callerMayActAs\(identity, character\)\)\) \{\s*res\.writeHead\(403/);
    expect(before(bid, '_callerMayActAs(identity, character)', 'opendkp.submitBid')).toBe(true);
    expect(before(bid, '_callerMayActAs(identity, character)', 'opendkp.getCharacters')).toBe(true);
  });

  it('bid-prefs writes only the rows for the caller\'s own characters', () => {
    expect(prefs).toMatch(/_callerOwnNames\(identity, clean\.map\(r => r\.character\)\)/);
    expect(before(prefs, '_callerOwnNames(identity', "supabase.upsert('character_bid_prefs'")).toBe(true);
    expect(prefs).toMatch(/supabase\.upsert\('character_bid_prefs', allowed,/);
    expect(prefs).not.toMatch(/supabase\.upsert\('character_bid_prefs', clean/);
  });
});

describe('server-panel answers are scoped to the caller\'s own characters', () => {
  const panel = stripped('async function _handleAgentServerPanel(req, res) {');
  const part = (a, b) => panel.slice(panel.indexOf(a), panel.indexOf(b));

  it('account-dkp intersects main and characters with the caller\'s own', () => {
    const p = part("if (key === 'account-dkp')", "if (key === 'my-bids')");
    expect(p).toMatch(/_callerOwnNames\(identity, \[\(url\.searchParams\.get\('main'\)/);
    expect(p).toMatch(/_callerOwnNames\(identity,\s*\(url\.searchParams\.get\('characters'\)/);
  });

  it('my-bids answers an empty list for a character that is not the caller\'s', () => {
    const p = part("if (key === 'my-bids')", "if (key === 'opendkp-auth-config')");
    expect(p).toMatch(/if \(!\(await _callerMayActAs\(identity, character\)\)\) \{[\s\S]*?bids: \[\]/);
    expect(before(p, '_callerMayActAs(identity, character)', '_panelCharacters()')).toBe(true);
  });

  it('bid-prefs reads only the caller\'s own characters', () => {
    const p = part("if (key === 'bid-prefs')", "if (key === 'bid-history')");
    expect(p).toMatch(/const fam = await _callerOwnNames\(identity, famAsked\)/);
    expect(before(p, '_callerOwnNames(identity, famAsked)', "supabase.select('character_bid_prefs'")).toBe(true);
  });

  it('bid-history takes the caller\'s own characters, honours a login only when it is theirs, and caches per caller', () => {
    const p = part("if (key === 'bid-history')", "if (key === 'night-loot')");
    expect(p).toMatch(/const family = await _callerOwnNames\(identity, familyAsked\)/);
    expect(p).toMatch(/_loginIsCallers\(loginAsked, family\) \? loginAsked : ''/);
    expect(p).toMatch(/const ck = 'bid-history:' \+ String\(identity\.discord_id\)/);
    expect(before(p, '_callerOwnNames(identity, familyAsked)', "'opendkp_loot'")).toBe(true);
  });
});

describe('character-keyed uploads are for the caller\'s own characters', () => {
  it.each([
    ['async function _handleAgentQuarmy(req, res) {', "supabase\n    .select('characters'"],
    ['async function _handleAgentInventory(req, res) {', "supabase\n    .select('characters'"],
    ['async function _handleAgentSpellbook(req, res) {', "supabase\n    .select('characters'"],
  ])('%s refuses (403) before it reads or writes the character', (header) => {
    const h = stripped(header);
    expect(h).toMatch(/if \(!\(await _callerMayActAs\(identity, character\)\)\) \{\s*res\.writeHead\(403\)/);
    expect(before(h, '_callerMayActAs(identity, character)', "select('characters'")).toBe(true);
    expect(before(h, '_callerMayActAs(identity, character)', 'supabase.del(')).toBe(true);
  });

  it('pop_flags skips a flag event for someone else\'s character, but never a witnessed hail', () => {
    const h = stripped('async function _handleAgentPopFlags(req, res) {');
    expect(h).toMatch(/e\.source !== 'hail_witnessed'/);
    expect(h).toMatch(/if \(e\.source !== 'hail_witnessed' && !ownFlagNames\.has\(/);
    expect(before(h, 'ownFlagNames.has(', "supabase.upsert('pop_flags'")).toBe(true);
  });

  it('the UI Studio snapshot upload refuses a linked character outside the caller\'s household, and still keeps unlinked ones', () => {
    const h = stripped('async function _handleAgentUiLayoutUpload(req, res) {');
    expect(h).toMatch(/if \(ownerDiscord && !\(await _householdDiscordIds\(identity\.discord_id\)\)\.has\(String\(ownerDiscord\)\)\) \{\s*res\.writeHead\(403/);
    expect(before(h, 'writeHead(403', "supabase.insert('ui_snapshots'")).toBe(true);
    expect(h).toMatch(/pendingLink\s*=\s*true/);   // an unlinked character is still held for an officer
  });
});

describe('officer-only and removed admin routes', () => {
  it('the OpenDKP character-register route is gone from the bot', () => {
    expect(SRC).not.toMatch(/\/api\/admin\/opendkp-register/);
    expect(SRC).not.toMatch(/\[opendkp-register\]/);
  });

  it('nothing in the repo calls it', () => {
    for (const dir of ['web', 'apps', 'packages', 'scripts']) {
      const hits = [];
      const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          if (e.name === 'node_modules' || e.name === '.next' || e.name === '.git') continue;
          const p = path.join(d, e.name);
          if (e.isDirectory()) walk(p);
          else if (/\.(ts|tsx|js|mjs|html)$/.test(e.name) && /\/api\/admin\/opendkp-register/.test(fs.readFileSync(p, 'utf8'))) hits.push(p);
        }
      };
      walk(path.join(ROOT, dir));
      expect(hits).toEqual([]);
    }
  });

  it('voice-settings/refresh is officers only', () => {
    const at = SRC.indexOf("req.url === '/api/admin/voice-settings/refresh'");
    const route = SRC.slice(at, SRC.indexOf('vs.invalidate()', at));
    expect(route).toMatch(/if \(!identity\.is_officer\) \{\s*res\.writeHead\(403/);
  });
});

// ── departed members ─────────────────────────────────────────────────────────────────────────────────────────
describe('a member who left the Discord has no Mimic session', () => {
  const mimicLink = nodeRequire('./utils/mimicLink');
  const supabase = nodeRequire('./utils/supabase');
  const saved = {};
  let member;
  beforeEach(() => {
    for (const k of ['isEnabled', 'select', 'update']) saved[k] = supabase[k];
    supabase.isEnabled = () => true;
    supabase.update = async () => [];
    supabase.select = async (table) => {
      if (table === 'mimic_sessions') return [{ user_id: null, discord_id: '111111111111111111', revoked_at: null, guild_id: supabase.guildId() }];
      if (table === 'wolfpack_members') return member;
      return [];
    };
  });
  afterEach(() => { for (const k of Object.keys(saved)) supabase[k] = saved[k]; });
  const token = () => 'wpms_' + nodeRequire('node:crypto').randomBytes(32).toString('hex');
  const resolve = (t) => mimicLink.resolveMimicSession({ headers: { 'x-wolfpack-mimic-session': t } });

  it('is_member false resolves to no session', async () => {
    member = [{ nickname: 'Aldenmar', global_name: null, role_names: [], is_member: false }];
    expect(await resolve(token())).toBeNull();
  });

  it('is_member true, or a row without the flag, still resolves', async () => {
    member = [{ nickname: 'Aldenmar', global_name: null, role_names: ['Officer'], is_member: true }];
    expect((await resolve(token())).is_officer).toBe(true);
    member = [{ nickname: 'Brackwyn', global_name: null, role_names: [] }];
    expect((await resolve(token())).display_name).toBe('Brackwyn');
  });

  it('the member read asks for is_member (source)', () => {
    const body = stripJs(fnSrc(readSource(path.join(ROOT, 'utils', 'mimicLink.js')), 'async function _lookupSessionToken('));
    expect(body).toMatch(/select=nickname,global_name,role_names,is_member/);
    expect(body).toMatch(/member\.is_member === false/);
  });
});

describe('leaving the guild revokes the member\'s Mimic sessions', () => {
  const members = nodeRequire('./utils/wolfpackMembers');
  const supabase = nodeRequire('./utils/supabase');
  const saved = {};
  let calls;
  beforeEach(() => {
    for (const k of ['isEnabled', 'update', 'selectAllPaged']) saved[k] = supabase[k];
    calls = [];
    supabase.isEnabled = () => true;
    supabase.selectAllPaged = async () => [{ discord_id: '100000000000000001' }, { discord_id: '100000000000000002' }, { discord_id: '100000000000000003' }];
    supabase.update = async (t, q, body) => { calls.push({ t, q, body }); return [{}]; };
  });
  afterEach(() => { for (const k of Object.keys(saved)) supabase[k] = saved[k]; });

  it('markMemberLeft revokes that member\'s unrevoked sessions in this guild', async () => {
    expect(await members.markMemberLeft('100000000000000009')).toBe(true);
    const rev = calls.find(c => c.t === 'mimic_sessions');
    expect(rev.q).toContain('discord_id=in.(100000000000000009)');
    expect(rev.q).toContain('revoked_at=is.null');
    expect(rev.q).toContain('guild_id=eq.');
    expect(Date.parse(rev.body.revoked_at)).toBeGreaterThan(0);
  });

  it('reconcileDepartedMembers revokes the sessions of everyone it flips', async () => {
    const res = await members.reconcileDepartedMembers(['100000000000000001', '100000000000000002']);
    expect(res.flipped).toBe(1);
    const rev = calls.find(c => c.t === 'mimic_sessions');
    expect(rev.q).toContain('discord_id=in.(100000000000000003)');
  });

  it('a failed revoke never breaks the member flip or the sync', async () => {
    supabase.update = async (t, q, body) => {
      if (t === 'mimic_sessions') throw new Error('down');
      calls.push({ t, q, body });
      return [{}];
    };
    expect(await members.markMemberLeft('100000000000000009')).toBe(true);
    expect((await members.reconcileDepartedMembers(['100000000000000001', '100000000000000002'])).flipped).toBe(1);
  });
});

// ── chat, trigger relays, mentions ───────────────────────────────────────────────────────────────────────────
describe('guild chat is not roster-gated', () => {
  it('a /gu line from a speaker the roster does not list is still relayed (7% of real lines were, 2026-11-01)', () => {
    const h = stripped('async function _handleAgentChat(req, res) {');
    expect(h).not.toMatch(/channel === 'guild' && !_raidChatLineAllowed/);
  });
});

describe('/api/agent/trigger voice and post are for officers and the guild\'s own triggers', () => {
  const h = stripped('async function _handleAgentTrigger(req, res) {');

  it('the gate runs before dedup, rate charge and delivery', () => {
    expect(h).toMatch(/if \(identity\.is_officer\) return true;/);
    expect(h).toMatch(/_guildTriggersFor\(\)/);
    expect(h).toMatch(/if \(!\(await mayRelay\(ev\)\)\) continue;/);
    expect(before(h, 'await mayRelay(ev)', '_triggerDedup.set(')).toBe(true);
    expect(before(h, 'await mayRelay(ev)', '_playVoiceTrigger(')).toBe(true);
    expect(before(h, 'await mayRelay(ev)', 'ch.send(')).toBe(true);
  });

  it('a fire is let through by trigger id or by the name of an enabled guild trigger, and the built-in rampage', () => {
    expect(h).toMatch(/relayable\.ids\.has\(String\(ev\.trigger_id\)\)/);
    expect(h).toMatch(/relayable\.names\.has\(nm\)/);
    expect(h).toMatch(/nm === 'rampage'/);
  });
});

describe('a relayed callout carries only plain sound names', () => {
  const block = [
    "const _RELAY_SOUND_NAME_RX", "const _RELAY_ACTION_TYPES", 'async function _guildSoundAddresses(', 'async function _relayCleanActions(',
  ].map(m => m.startsWith('async function') ? fnSrc(RAW, m) : RAW.slice(RAW.indexOf(m), RAW.indexOf('\n', RAW.indexOf(m)) + 1)).join('\n');
  const clean = (guildUrls = []) => new Function('_guildTriggersFor',
    `${block}\nreturn _relayCleanActions;`)(async () => ({ triggers: guildUrls.map(u => ({ id: 1, name: 'x', actions: [{ type: 'sound', sound: u }] })) }));

  it('keeps a sound name and its volume and mode', async () => {
    const out = await clean()([{ type: 'sound', sound: 'slap', sound_volume: 0.5, sound_mode: 'replace' }]);
    expect(out).toEqual([{ type: 'sound', sound: 'slap', sound_volume: 0.5, sound_mode: 'replace' }]);
  });

  it('removes a web address, a path and a custom file from every action', async () => {
    const out = await clean()([
      { type: 'text_overlay', text: 'x', sound: 'https://evil.example/slow.wav', sound_volume: 1, sound_mode: 'replace' },
      { type: 'sound', sound: '../../etc/passwd' },
      { type: 'sound', sound: 'C:\\Windows\\a.wav' },
      { type: 'sound', sound: 'custom:mine.wav' },
    ]);
    for (const a of out) expect(a).not.toHaveProperty('sound');
    expect(out[0]).toEqual({ type: 'text_overlay', text: 'x' });
  });

  it('keeps an address only when one of the guild\'s own enabled triggers stores exactly that address', async () => {
    const url = 'https://sounds.example/vex.mp3';
    const out = await clean([url])([{ type: 'sound', sound: url }, { type: 'sound', sound: url + '?x=1' }]);
    expect(out[0].sound).toBe(url);
    expect(out[1]).not.toHaveProperty('sound');
  });

  it('relays only the effects a receiving Mimic runs locally', async () => {
    const out = await clean()([{ type: 'discord', message: 'hi' }, { type: 'voice', message: 'go' }, 'junk', null]);
    expect(out).toEqual([{ type: 'voice', message: 'go' }]);
  });

  it('the relay post cleans the actions it stores', () => {
    const h = stripped('async function _handleTriggerRelayPost(req, res) {');
    expect(h).toMatch(/actions:\s*Array\.isArray\(f\?\.actions\) \? await _relayCleanActions\(f\.actions\.slice\(0, 5\)\) : \[\]/);
  });
});

describe('agent text posted to Discord never pings', () => {
  const noPing = 'allowedMentions: { parse: [] }';
  it('every content post in the pvp and bosskill handlers says so', () => {
    for (const header of ['async function _handleAgentPvp(req, res) {', 'async function _handleAgentBossKill(req, res) {']) {
      const h = stripped(header);
      const sends = h.match(/\.(send|edit)\(\{\s*content/g) || [];
      expect(sends.length).toBeGreaterThan(0);
      for (const m of h.matchAll(/\.(send|edit)\(\{\s*content[\s\S]*?\}\)/g)) expect(m[0]).toContain(noPing);
    }
  });

  it('the pvp kill line, its Howl edit, and both bosskill announcements pass it', () => {
    const pvp = stripped('async function _handleAgentPvp(req, res) {');
    expect(pvp).toMatch(/_ch\.send\(\{ content: _content, allowedMentions: \{ parse: \[\] \} \}\)/);
    expect(pvp).toMatch(/sent\.edit\(\{ content: _content, components: \[buildHowlRow\(sent\.id\)\], allowedMentions: \{ parse: \[\] \} \}\)/);
    const bk = stripped('async function _handleAgentBossKill(req, res) {');
    expect((bk.match(/allowedMentions: \{ parse: \[\] \}/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('so do the loot announcement and the in-game feedback post', () => {
    expect(stripped('async function _handleAgentFeedback(req, res) {')).toContain(noPing);
    expect(SRC).toMatch(/Bid on OpenDKP → \$\{opendkpAuctionsUrl\(\)\}\$\{foot\}`, allowedMentions: \{ parse: \[\] \} \}\)/);
  });
});

// ── sealed wishlist bids ─────────────────────────────────────────────────────────────────────────────────────
describe('sealed wishlist bids are the owner\'s', () => {
  const { discordOwnership } = nodeRequire('./utils/characterOwner');
  const supabase = nodeRequire('./utils/supabase');
  const saved = {};
  let tables;
  beforeEach(() => {
    for (const k of ['isEnabled', 'select']) saved[k] = supabase[k];
    supabase.isEnabled = () => true;
    supabase.select = async (table, q) => {
      if (table === 'characters') {
        const nm = decodeURIComponent(/name=ilike\.([^&]+)/.exec(q)[1]).toLowerCase();
        return tables.characters.filter(c => c.name.toLowerCase() === nm);
      }
      if (table === 'wolfpack_members') return tables.members;
      return [];
    };
  });
  afterEach(() => { for (const k of Object.keys(saved)) supabase[k] = saved[k]; });

  it('owner: the character is linked to someone in the caller\'s household', async () => {
    tables = { characters: [{ name: 'Aldenmar', discord_id: '111' }], members: [{ discord_id: '111', merged_into_discord_id: null }] };
    expect(await discordOwnership('111', 'Aldenmar')).toBe('owner');
  });

  it('other: linked to someone else — a nickname that spells the name does not change that', async () => {
    tables = { characters: [{ name: 'Aldenmar', discord_id: '999' }], members: [{ discord_id: '111', merged_into_discord_id: null }] };
    expect(await discordOwnership('111', 'Aldenmar')).toBe('other');
  });

  it('unlinked: nobody is linked to it or its main; unknown: not a character name', async () => {
    tables = { characters: [{ name: 'Corvale' }], members: [] };
    expect(await discordOwnership('111', 'Corvale')).toBe('unlinked');
    expect(await discordOwnership('111', 'Alden%')).toBe('unknown');
  });

  it('/wishlist show and /mywishlist show bids only to the owner (or an officer), never by display name for a linked character', () => {
    for (const f of ['wishlist.js', 'mywishlist.js']) {
      const src = stripJs(readSource(path.join(ROOT, 'commands', f)));
      expect(src).toMatch(/discordOwnership\(interaction\.user\.id, rosterChar\.name\)/);
      expect(src).toMatch(/const isSelf\s*=\s*own === 'owner'\s*\|\|\s*\(own === 'unlinked' &&/);
      expect(src).toMatch(/const showBids\s*=\s*isSelf \|\| isOfficer/);
    }
  });
});

// ── the website link page ────────────────────────────────────────────────────────────────────────────────────
describe('the Mimic link page never fills the code in for you', () => {
  const page = stripJs(readSource(path.join(ROOT, 'web', 'app', 'auth', 'mimic-link', 'page.tsx')));

  it('no input is pre-filled from the address, on Wolf Pack or raidmimic hosts', () => {
    expect(page).not.toMatch(/defaultValue=\{prefilled\}/);
    expect(page).not.toMatch(/defaultValue=/);
    expect((page.match(/name="user_code"/g) || []).length).toBe(2);
  });

  it('shows when the request started and which Mimic made it, next to the button, from columns that exist', () => {
    expect(page).toMatch(/\.select\('expires_at,agent_version'\)/);
    expect(page).toMatch(/This link request started \{ctx\.started\}/);
    expect((page.match(/<RequestContext ctx=\{ctx\} \/>/g) || []).length).toBe(2);
    expect(page.indexOf('<RequestContext ctx={ctx} />')).toBeLessThan(page.indexOf('Confirm — link this Mimic install'));
  });

  it('a typed code that differs from the one the page was opened for is refused, in both actions', () => {
    expect((page.match(/if \(expect && expect !== userCode\) redirect\('\/auth\/mimic-link\?error=code_mismatch'\);/g) || []).length).toBe(2);
    expect((page.match(/<input type="hidden" name="expect_code" value=\{prefilled\} \/>/g) || []).length).toBe(2);
  });
});
