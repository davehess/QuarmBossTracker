// test/guest-characters.test.js — "Guest characters: read here, nothing sent" (agent 4.0.81, beta).
//
// The guild lead, 2026-11-09: "make sure that when a friend is going to take his files and play as a guest on my machine,
// he's able to do so." His character files sit in the host's EQ folder and every upload is attributed to the signed-in
// account, so without this his combat, chat, roster, buffs and PoP flags would all post as the host. A guest character is
// still TAILED (overlays, triggers, timers, the map work) but nothing attributable to it leaves the PC. One predicate
// (_isGuestChar) feeds every outbound path; this file runs each gate for real:
//   1. the predicate, the env list, and shouldUploadForCharacter;
//   2. enqueueUpload, kind by kind, against the REAL function and queue (a guest's row is refused, a host's still queues);
//   3. the direct posts that do not use the queue (live-state, the raid roster, trigger fan-out);
//   4. "the log is still read": the agent's boot filter keeps a guest's log, unlike Hide completely;
//   5. the tail loop's wiring (stripped source), Mimic's list + launch env, and the dashboard switch.
// Comments are stripped before any text match. Names are invented (Aldenmar is the guest, Brackwyn and Corvale the host's).
//
// Run: npx vitest run test/guest-characters.test.js

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, ROOT, AGENT_INDEX } from './_source-slice.js';

const agentRaw = readSource(AGENT_INDEX);
const agentSrc = stripJs(agentRaw);
const agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js');
const main = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
const dash = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));
const MEMBER = { token: 'member-token', botUrl: 'https://bot.example/api/agent/encounter', dryRun: false };
const queue = () => agent._uploadQueueForTest();

beforeEach(() => {
  agent._setUploadOptsForTest(MEMBER);
  queue().length = 0;
  agent.setGuestCharacter('Aldenmar', true);
});
afterEach(() => {
  agent.setGuestCharacter('Aldenmar', false);
  agent._setUploadOptsForTest(null);
  queue().length = 0;
});

// ── 1. the predicate ────────────────────────────────────────────────────────
describe('_isGuestChar and shouldUploadForCharacter', () => {
  it('a guest is matched in any case; a host character and no name are not', () => {
    expect(agent._isGuestChar('Aldenmar')).toBe(true);
    expect(agent._isGuestChar('ALDENMAR')).toBe(true);
    expect(agent._isGuestChar(' aldenmar ')).toBe(true);
    expect(agent._isGuestChar('Brackwyn')).toBe(false);
    expect(agent._isGuestChar('')).toBe(false);
    expect(agent._isGuestChar(null)).toBe(false);
    expect(agent._guestCharList()).toEqual(['aldenmar']);
  });
  it('the upload gate refuses a guest and still passes a host; taking the guest off puts it back', () => {
    expect(agent.shouldUploadForCharacter('Aldenmar')).toBe(false);
    expect(agent.shouldUploadForCharacter('Brackwyn')).toBe(true);
    expect(agent.shouldUploadForCharacter(undefined)).toBe(true);
    agent.setGuestCharacter('Aldenmar', false);
    expect(agent.shouldUploadForCharacter('Aldenmar')).toBe(true);
  });
  it('WOLFPACK_GUEST_CHARS is parsed like WOLFPACK_EXCLUDED_CHARS: comma separated, trimmed, lower-cased', () => {
    const block = sliceBlock(agentRaw, 'const _guestChars = new Set(', '\nfunction _guestCharList() {');
    // eslint-disable-next-line no-new-func
    const api = new Function('process', block.replace(/\nfunction _guestCharList\(\) \{$/, '') + '\nreturn { _isGuestChar };')(
      { env: { WOLFPACK_GUEST_CHARS: ' Aldenmar, BRACKWYN ,, ' } });
    expect(api._isGuestChar('aldenmar')).toBe(true);
    expect(api._isGuestChar('Brackwyn')).toBe(true);
    expect(api._isGuestChar('Corvale')).toBe(false);
  });
  it('setGuestCharacter takes plain names only', () => {
    expect(agent.setGuestCharacter('Bad Name', true)).toMatchObject({ ok: false });
    expect(agent.setGuestCharacter('', true)).toMatchObject({ ok: false });
    expect(agent.setGuestCharacter('Corvale', true)).toMatchObject({ ok: true, guest: true, guest_characters: ['aldenmar', 'corvale'] });
    agent.setGuestCharacter('Corvale', false);
  });
});

// ── 2. enqueueUpload, every kind that names a character ─────────────────────
describe('enqueueUpload refuses a guest and still queues the host', () => {
  const V = { agent_version: 'test' };
  // [kind, payload naming the guest, payload naming the host]
  const CASES = [
    ['ari_lead',        { ...V, character: 'Aldenmar', active: true },                        { ...V, character: 'Brackwyn', active: true }],
    ['corpse',          { ...V, character: 'Aldenmar', zone: 'x' },                            { ...V, character: 'Brackwyn', zone: 'x' }],
    ['quarmy',          { ...V, character: 'Aldenmar', equipped: [] },                         { ...V, character: 'Brackwyn', equipped: [] }],
    ['spellbook',       { ...V, character: 'Aldenmar', spells: [] },                           { ...V, character: 'Brackwyn', spells: [] }],
    ['inventory',       { ...V, character: 'Aldenmar', rows: [] },                             { ...V, character: 'Brackwyn', rows: [] }],
    ['tells',           { ...V, character: 'Aldenmar', tells: [{ text: 'hi' }] },              { ...V, character: 'Brackwyn', tells: [{ text: 'hi' }] }],
    ['encounter',       { ...V, character: 'Aldenmar', boss: 'x' },                            { ...V, character: 'Brackwyn', boss: 'x' }],
    ['casting',         { ...V, casts: [{ caster: 'Aldenmar', spell: 's' }] },                 { ...V, casts: [{ caster: 'Brackwyn', spell: 's' }] }],
    ['looted',          { ...V, events: [{ looter: 'Aldenmar', item: 'i' }] },                 { ...V, events: [{ looter: 'Brackwyn', item: 'i' }] }],
    ['chat',            { ...V, messages: [{ speaker: 'Aldenmar', text: 'hi' }] },             { ...V, messages: [{ speaker: 'Brackwyn', text: 'hi' }] }],
    ['historical_chat', { ...V, messages: [{ speaker: 'Aldenmar', uploadedBy: 'Aldenmar' }] }, { ...V, messages: [{ speaker: 'Brackwyn', uploadedBy: 'Brackwyn' }] }],
    ['pop_flag',        { ...V, events: [{ character: 'Aldenmar', stages: ['a'] }] },          { ...V, events: [{ character: 'Brackwyn', stages: ['a'] }] }],
    ['faction',         { ...V, events: [{ character: 'Aldenmar', kind: 'hit' }] },            { ...V, events: [{ character: 'Brackwyn', kind: 'hit' }] }],
    ['fun_event',       { ...V, events: [{ caster: 'Aldenmar', type: 'x' }] },                 { ...V, events: [{ caster: 'Brackwyn', type: 'x' }] }],
    ['xp_events',       { events: [{ character: 'Aldenmar' }] },                                { events: [{ character: 'Brackwyn' }] }],
    ['lockout',         { ...V, entries: [{ character: 'Aldenmar', bossName: 'x' }] },         { ...V, entries: [{ character: 'Brackwyn', bossName: 'x' }] }],
    ['bosskill',        { ...V, kills: [{ character: 'Aldenmar', boss: 'x' }] },               { ...V, kills: [{ character: 'Brackwyn', boss: 'x' }] }],
    ['buff_cast',       { ...V, casts: [{ caster: 'Aldenmar', spell_name: 's' }] },            { ...V, casts: [{ caster: 'Brackwyn', spell_name: 's' }] }],
    ['trigger_feedback', { ...V, votes: [{ voter_character: 'Aldenmar' }] },                   { ...V, votes: [{ voter_character: 'Brackwyn' }] }],
    ['crash_report',    { ...V, reports: [{ character: 'Aldenmar', sig: 'x' }] },              { ...V, reports: [{ character: 'Brackwyn', sig: 'x' }] }],
    ['threat_snapshot', { ...V, uploader: 'Aldenmar', per_player: {} },                        { ...V, uploader: 'Brackwyn', per_player: {} }],
  ];
  for (const [kind, guestPayload, hostPayload] of CASES) {
    it(`${kind}: a guest's row never queues, a host's does`, () => {
      expect(agent.enqueueUpload(kind, JSON.parse(JSON.stringify(guestPayload))), kind).toBeNull();
      expect(queue(), kind).toHaveLength(0);
      expect(agent.enqueueUpload(kind, JSON.parse(JSON.stringify(hostPayload))), kind).toBeTruthy();
      expect(queue(), kind).toHaveLength(1);
    });
  }

  it('a batch with both keeps only the host\'s rows', () => {
    agent.enqueueUpload('casting', { ...V, casts: [{ caster: 'Aldenmar', spell: 'a' }, { caster: 'Brackwyn', spell: 'b' }] });
    expect(queue()).toHaveLength(1);
    expect(queue()[0].payload.casts).toEqual([{ caster: 'Brackwyn', spell: 'b' }]);
  });
  it('rolls: the guest\'s own rolls are taken out of a set, and a set left empty is dropped', () => {
    const set = (names) => ({ roll_from: 1, roll_to: 100, rolls: names.map(name => ({ name, value: 5 })) });
    agent.enqueueUpload('rolls', { ...V, sets: [set(['Aldenmar', 'Brackwyn']), set(['Aldenmar'])] });
    expect(queue()).toHaveLength(1);
    expect(queue()[0].payload.sets).toHaveLength(1);
    expect(queue()[0].payload.sets[0].rolls.map(r => r.name)).toEqual(['Brackwyn']);
  });
  it('the raid roster loses the guest\'s row; a roster of only the guest is not sent', () => {
    agent.enqueueUpload('raid_roster', { members: [{ name: 'Aldenmar' }, { name: 'Brackwyn' }] });
    expect(queue()[0].payload.members).toEqual([{ name: 'Brackwyn' }]);
    queue().length = 0;
    expect(agent.enqueueUpload('raid_roster', { members: [{ name: 'Aldenmar' }] })).toBeNull();
    expect(queue()).toHaveLength(0);
  });
  it('rez_dismiss names the host, never the guest, as the one who clicked', () => {
    agent.enqueueUpload('rez_dismiss', { ...V, name: 'Corvale', by: 'Aldenmar' });
    expect(queue()[0].payload.by).toBeNull();
  });
  it('an operator-level stream with no character is attributed to the host, not to a guest\'s log', () => {
    const block = sliceBlock(agentRaw, 'function _primaryCharacter() {', '\n}\n');
    const make = (watched, override) => new Function('stats', '_primaryCharacterOverride', '_isGuestChar',
      block + '\nreturn _primaryCharacter();')({ watchedLogs: watched.map(character => ({ character })) }, override, (n) => String(n).toLowerCase() === 'aldenmar');
    expect(make(['Aldenmar', 'Brackwyn'], null)).toBe('Brackwyn');
    expect(make(['Aldenmar'], null)).toBeNull();
    expect(make(['Brackwyn'], 'Aldenmar')).toBe('Brackwyn');   // even an explicit --character cannot name a guest
  });
  it('marking a name a guest empties what is already queued for it', () => {
    agent.setGuestCharacter('Aldenmar', false);
    agent.enqueueUpload('corpse', { ...V, character: 'Aldenmar' });
    agent.enqueueUpload('corpse', { ...V, character: 'Brackwyn' });
    expect(queue()).toHaveLength(2);
    agent.setGuestCharacter('Aldenmar', true);
    expect(queue().map(e => e.payload.character)).toEqual(['Brackwyn']);
  });
});

// ── 3. the posts that do not use the queue ──────────────────────────────────
describe('direct posts', () => {
  function liveStatePost(states) {
    const block = sliceBlock(agentRaw, 'function _postLiveState(targetUrl, token, payload) {', '\n}\n');
    const sent = [];
    const https = { request: (_o, _cb) => ({ on() {}, write: (b) => sent.push(JSON.parse(b)), end() {} }) };
    // eslint-disable-next-line no-new-func
    new Function('_playerScope', '_isGuestChar', 'https', 'http', 'AGENT_VERSION', 'URL', block + '\nreturn _postLiveState;')(
      () => false, (n) => String(n).toLowerCase() === 'aldenmar', https, https, 't', URL)('https://bot.example/api/agent/live-state', 'tok', { states });
    return sent;
  }
  it('live-state: a guest\'s state row is stripped, a host\'s still posts, a guest-only post is not made', () => {
    expect(liveStatePost([{ character: 'Aldenmar' }, { character: 'Brackwyn' }])[0].states).toEqual([{ character: 'Brackwyn' }]);
    expect(liveStatePost([{ character: 'Aldenmar', swapped_to: 'Corvale' }])).toEqual([]);
  });
  it('flushLiveStateToBot skips a guest\'s Zeal state before it builds the row', () => {
    const fn = sliceBlock(agentSrc, 'function flushLiveStateToBot(opts) {', '  for (const ch of Object.keys(_zealState)) {\n    const st = _zealState[ch];\n    if (!st || (now - (st.updatedAt || 0)) > ZEAL_STALE_MS) continue;  // live chars only\n    if (_isGuestChar(ch)) continue;');
    expect(fn).toContain('if (_isGuestChar(ch)) continue;');
  });
  it('the raid roster: while a guest\'s client is live nothing is posted (the sample names no character); otherwise it is', () => {
    const zs = agent._zealStateForTest();
    const sample = { data: JSON.stringify([{ name: 'Brackwyn', class: 'Cleric', group: 1, level: 60 }, { name: 'Corvale', class: 'Druid', group: 1, level: 60 }]) };
    zs.Aldenmar = { updatedAt: Date.now() };
    agent._maybeUploadRaidRoster(sample);
    expect(queue().filter(e => e.kind === 'raid_roster')).toHaveLength(0);
    delete zs.Aldenmar;
    agent._maybeUploadRaidRoster(sample);
    expect(queue().filter(e => e.kind === 'raid_roster')).toHaveLength(1);
  });
  it('a trigger fired from a guest\'s line is not posted to Discord or fanned out to other Mimics', () => {
    const post = sliceBlock(agentRaw, 'function _broadcastTriggerToDiscord({ name, message, key, tsMs, mode, voiceId }) {', '\n}\n');
    const run = (evalChar) => {
      const sent = [];
      // eslint-disable-next-line no-new-func
      new Function('_isGuestChar', '_triggerEvalChar', 'enqueueUpload', 'AGENT_VERSION', post + '\nreturn _broadcastTriggerToDiscord;')(
        (n) => String(n).toLowerCase() === 'aldenmar', evalChar, (k, p) => sent.push([k, p]), 't')({ name: 'x', message: 'hello', mode: 'post' });
      return sent;
    };
    expect(run('Aldenmar')).toEqual([]);
    expect(run('Brackwyn')).toHaveLength(1);
    expect(run(null)).toHaveLength(1);
    const relay = sliceBlock(agentSrc, 'function _relayLocalFire(t, actions, captures, tsMs, key) {', '\n}\n');
    expect(relay.indexOf('_isGuestChar(_triggerEvalChar)')).toBeGreaterThan(-1);
    expect(relay.indexOf('_isGuestChar(_triggerEvalChar)')).toBeLessThan(relay.indexOf("enqueueUpload('trigger_relay'"));
    // the evaluator sets the name for the length of the line, and puts it back
    const evaluator = sliceBlock(agentSrc, 'function evaluateTriggersAgainstLine(line, tsMs, fileChar) {', '\n}\n');
    expect(evaluator).toMatch(/_triggerEvalChar = fileChar \|\| null;/);
    expect(evaluator).toMatch(/finally \{ _triggerEvalChar = prev; \}/);
  });
  it('requests to the bot never carry a guest\'s name (prefs, backfill, ui edits, the multiplexed poll, mob-info, buffs, casts)', () => {
    const chars = agentSrc.match(/\.filter\(c => c && !_isGuestChar\(c\)\)/g) || [];
    expect(chars.length).toBeGreaterThanOrEqual(3);
    expect(agentSrc).toMatch(/w\.logPath && !_isGuestChar\(w\.character\)/);
    expect((agentSrc.match(/selfChar && !_isGuestChar\(selfChar\)/g) || []).length).toBe(3);
    expect(agentSrc).toMatch(/bufferCharacter && !_isGuestChar\(bufferCharacter\)/);
    expect(agentSrc).toMatch(/character && !_isGuestChar\(character\)\) params\.push/);
  });
  it('the map: a guest\'s sightings and watch marks stay on the local map', () => {
    expect(agentSrc).toMatch(/if \(_isGuestChar\(ch\)\) return;[^\n]*\n\s*if \(_mapSync\.q\.length >= MAP_SYNC_QUEUE_MAX\)/);
    expect(agentSrc).toMatch(/_mapFetchAllowed\(\) && character && !_isGuestChar\(character\) && now >= _mapSync\.watchBackoffUntil/);
  });
  it('the Quarmy, spellbook and inventory scans and the rebuild treat a guest like a kept-out character', () => {
    const quarmy = sliceBlock(agentSrc, 'function _quarmyPrefsBlock(lowerName) {', '\n}\n');
    expect(quarmy).toContain('_isGuestChar(lowerName)');
    const rebuild = sliceBlock(agentSrc, 'function _rebuildExcluded(character) {', '  return !!(m && modeStopsLog(m.mode));\n}');
    expect(rebuild).toContain('_isGuestChar(lc)');
    // all three scans ask _quarmyPrefsBlock under the file name; the PoP scan asks _pfFileBlocked -> _rebuildExcluded + shouldUpload
    expect((agentSrc.match(/_quarmyPrefsBlock\(/g) || []).length).toBeGreaterThanOrEqual(5);
    expect(sliceBlock(agentSrc, 'function _pfFileBlocked(lowerName) {', '\n}\n')).toContain('_rebuildExcluded(lowerName)');
  });
});

// ── 4. the log is still read ────────────────────────────────────────────────
describe('a guest\'s log is still tailed (unlike Hide completely)', () => {
  const bootBlock = sliceBlock(agentRaw, "const excludedCsv = process.env.WOLFPACK_EXCLUDED_CHARS || '';", '  args.logs = filtered;');
  function boot(env, logs) {
    const args = { logs: logs.slice() };
    const stats = { watchedLogs: [] };
    // eslint-disable-next-line no-new-func
    new Function('process', 'args', 'stats', 'characterFromFilename', 'isBackupLogFile', 'console', bootBlock + '\nreturn 0;')(
      { env }, args, stats, agent.characterFromFilename, agent.isBackupLogFile, { log() {}, warn() {} });
    return { read: args.logs, stats };
  }
  const LOGS = ['/EQ/eqlog_Aldenmar_pq.proj.txt', '/EQ/eqlog_Brackwyn_pq.proj.txt'];
  it('a name only on the guest list is read; the same name on the don\'t-transmit list is not', () => {
    expect(boot({ WOLFPACK_GUEST_CHARS: 'Aldenmar' }, LOGS).read).toEqual(LOGS);
    expect(boot({ WOLFPACK_EXCLUDED_CHARS: 'Aldenmar' }, LOGS).read).toEqual([LOGS[1]]);
  });
  it('the guest list is not read anywhere in the boot filter', () => {
    expect(stripJs(bootBlock)).not.toMatch(/GUEST/);
  });
});

// ── 5. the tail loop, Mimic, the dashboard ──────────────────────────────────
describe('the tail loop: local trackers keep running, every stream that leaves asks _noSend', () => {
  const tail = agentSrc.slice(agentSrc.indexOf('const _sourceGuest = _isGuestChar(b.character);'));
  it('the guest is not "excluded" (that gate also stops the overlays\' trackers); _noSend is excluded or guest', () => {
    expect(agentSrc).toContain('const _sourceExcluded = !_sourceGuest && !shouldUploadForCharacter(b.character);');
    expect(agentSrc).toContain('const _noSend = _sourceExcluded || _sourceGuest;');
  });
  it('chat, pvp, slow mode, lockout, boss kills, faction, PoP flags, hails, fun events and quakes ask _noSend', () => {
    for (const re of [
      /if \(!_noSend && !_chatCrossLogArbitrate\(_chatFp, chatMsg\)\) chatBuffer\.push\(chatMsg\);/,
      /if \(!_noSend && !_crossLogDupe\(_pvpFp\)\) \{/,
      /if \(!_noSend && !_crossLogDupe\(_smFp\)\) uploadSlowMode/,
      /if \(!_noSend && !_crossLogDupe\(_dkFp\)\) druzzilKillBuffer\.push/,
      /if \(!_noSend\) _lockoutBuffer\.push/,
      /if \(facEvt && !_noSend\) factionBuffer\.push\(facEvt\);/,
      /if \(conFacEvt && !_noSend\) factionBuffer\.push\(conFacEvt\);/,
      /if \(pfEvt && !_noSend\) popFlagBuffer\.push\(pfEvt\);/,
      /if \(!_noSend\) \{ for \(const pfOut of popFlagsOutputEvents/,
      /if \(!_noSend\) \{\s*const hailEvt = parseWitnessedHail/,
      /if \(!_noSend\) \{\s*for \(const evt of _collectFunEvents/,
      /if \(!_noSend\) \{\s*const quakeEvt = parseEarthquake\(line\);/,
      /if \(!_noSend\) captureUnmatchedPvpKill\(line\);/,
    ]) expect(tail, String(re)).toMatch(re);
  });
  it('buff landings: the local record always runs, the upload push is skipped for a guest', () => {
    expect(tail).toMatch(/if \(!_sourceGuest && !_shouldSuppressBuffLanding\(bcEvt\) && !_crossLogDupe\(_bcFp\)\) buffCastBuffer\.push\(bcEvt\);/);
    expect(tail).toMatch(/if \(!_sourceGuest && !_crossLogDupe\(_dbFp\)\) buffCastBuffer\.push\(dbEvt\);/);
    // recordTargetBuffLanding (Target Info) is not behind the guest test
    expect(tail).toMatch(/recordTargetBuffLanding\(bcEvt\);/);
    expect(tail).toMatch(/if \(selfCast && !_sourceGuest\) relaySelfCastForCasting\(/);
  });
  it('a guest\'s tells stay in the local ring and the Chat overlay, never the upload buffer', () => {
    expect(tail).toMatch(/if \(_tellPrefs\?\.tell_relay && !_sourceGuest\) \{[^\n]*\n\s*tellBuffer\.push/);
    expect(tail).toMatch(/_pushRecentTell\(tellEvt, b\.character\);/);
  });
  it('a --since replay skips a guest\'s log', () => {
    expect(agentSrc).toMatch(/if \(_isGuestChar\(b\.character\)\) \{ console\.log\(`\[\$\{b\.character\}\] skipped \(guest character: nothing is sent\)`\); continue; \}/);
  });
  it('the threat snapshot never names a guest as its uploader', () => {
    expect(agentSrc).toMatch(/if \(w && w\.character && !_isGuestChar\(w\.character\)\) \{ uploader = w\.character; break; \}/);
  });
  it('/api/state carries guest_characters for the dashboard', () => {
    expect(agentSrc).toMatch(/guest_characters:\s+_guestCharList\(\),/);
    expect(agentSrc).toMatch(/req\.url === '\/api\/guest-character' && req\.method === 'POST'/);
  });
});

describe('Mimic: the saved list, the launch env, the live push', () => {
  it('cfg.guestCharacters defaults to an empty list and is handed to the agent next to the don\'t-transmit list', () => {
    const code = stripJs(main);
    expect(code).toMatch(/guestCharacters: \[\],/);
    expect(code).toMatch(/delete env\.WOLFPACK_GUEST_CHARS;/);
    expect(code).toMatch(/if \(guests\.length > 0\) env\.WOLFPACK_GUEST_CHARS = guests\.join\(','\);/);
    // the guest's log is still one of the --log arguments: nothing in the launch path filters by guestCharacters
    expect(code.match(/guestCharacters/g).length).toBeLessThan(12);
    expect(code.slice(code.indexOf("args.push('--log', c.path)") - 200, code.indexOf("args.push('--log', c.path)") + 200)).not.toMatch(/guest/i);
  });
  it('a saved change is told to the running engine: names added go on, names removed come off', async () => {
    const block = sliceBlock(main, 'function _guestListOf(list) {', "  appendAgentLog(`[mimic] guest characters: ${[...a].join(', ') || '(none)'}\\n`);\n}");
    const calls = [], logs = [];
    // eslint-disable-next-line no-new-func
    const api = new Function('_agentCall', 'appendAgentLog', block + '\nreturn { _guestListOf, _pushGuestCharacters };')(
      async (m, p, b) => { calls.push([m, p, b]); return { ok: true }; }, (s) => logs.push(s));
    expect(api._guestListOf(['Aldenmar', 'aldenmar', 'Bad Name', '', 'Brackwyn'])).toEqual(['Aldenmar', 'Brackwyn']);
    await api._pushGuestCharacters(['Brackwyn'], ['Brackwyn', 'Aldenmar']);
    expect(calls).toEqual([['POST', '/api/guest-character', { character: 'Aldenmar', on: true }]]);
    calls.length = 0;
    await api._pushGuestCharacters(['Aldenmar', 'Brackwyn'], ['Brackwyn']);
    expect(calls).toEqual([['POST', '/api/guest-character', { character: 'Aldenmar', on: false }]]);
    expect(logs.join('')).toMatch(/guest characters: brackwyn/);
  });
  it('save-config is the one path: it keeps only plain names and pushes the difference', () => {
    const handler = stripJs(sliceBlock(main, "ipcMain.handle('save-config', async (_e, incoming) => {", "  // Manual /token paste"));
    expect(handler).toMatch(/Object\.prototype\.hasOwnProperty\.call\(incoming, 'guestCharacters'\)/);
    expect(handler).toMatch(/merged\.guestCharacters = _guestListOf\(merged\.guestCharacters\);/);
    expect(handler).toMatch(/_pushGuestCharacters\(_guestBefore, merged\.guestCharacters\)/);
  });
  it('the tray has no per-character modes to mirror (Hide completely is dashboard and setup only)', () => {
    expect(stripJs(main)).not.toMatch(/label: [^\n]*Hide completely/);
  });
});

describe('the dashboard switch (tray ↔ dashboard parity: same saveConfig the rest of Settings uses)', () => {
  const ctl = sliceBlock(dash, 'var _wpGuestNow = [];', 'function wpModesHtml(modes, guests) {');
  function run({ viaMimic = true } = {}) {
    const saved = [], says = [], fetched = [];
    const env = {
      window: viaMimic ? { mimic: { saveConfig: (c) => { saved.push(c); return Promise.resolve({}); } } } : {},
      fetch: (u, init) => { fetched.push([u, JSON.parse(init.body)]); return Promise.resolve({ json: async () => ({ ok: true }) }); },
      wpModeSay: (t) => says.push(t), refresh: () => {},
    };
    // eslint-disable-next-line no-new-func
    const api = new Function(...Object.keys(env), ctl.replace(/function wpModesHtml\(modes, guests\) \{$/, '')
      + '\nreturn { wpSetGuest, wpGuestOn, set: (list, rows) => { _wpGuestNow = list; rows.forEach(n => { _wpGuestCase[n.toLowerCase()] = n; }); } };')(...Object.values(env));
    return { api, saved, says, fetched };
  }
  it('under Mimic it saves cfg.guestCharacters with the character list\'s own spelling', async () => {
    const { api, saved, says } = run();
    api.set(['brackwyn'], ['Brackwyn', 'Aldenmar']);
    api.wpSetGuest('Aldenmar', true);
    await new Promise(r => setTimeout(r, 0));
    expect(saved).toEqual([{ guestCharacters: ['Brackwyn', 'Aldenmar'] }]);
    expect(api.wpGuestOn('Aldenmar')).toBe(true);
    expect(says[0]).toMatch(/nothing from this character is uploaded/);
    api.wpSetGuest('Brackwyn', false);
    await new Promise(r => setTimeout(r, 0));
    expect(saved[1]).toEqual({ guestCharacters: ['Aldenmar'] });
  });
  it('in a plain browser it posts /api/guest-character and says it holds until the engine restarts', async () => {
    const { api, fetched, says } = run({ viaMimic: false });
    api.set([], ['Aldenmar']);
    api.wpSetGuest('Aldenmar', true);
    await new Promise(r => setTimeout(r, 0));
    expect(fetched).toEqual([['/api/guest-character', { character: 'Aldenmar', on: true }]]);
    expect(says[0]).toMatch(/Until the engine restarts/);
  });
  it('the row has a Guest switch, inside the wpKeep\'d details, driven by data-guest', () => {
    const html = sliceBlock(dash, 'function wpModesHtml(modes, guests) {', '\n}\n');
    expect(html).toContain("wpKeep('me-char-modes')");
    expect(html).toMatch(/class="wp-guestbtn/);
    expect(html).toMatch(/role="switch"/);
    expect(dash).toMatch(/closest\('\.wp-guestbtn'\)/);
    expect(dash).toMatch(/wpModesHtml\(charModes, Array\.isArray\(s\.guest_characters\) \? s\.guest_characters : \[\]\)/);
  });
});
