// test/hub-characters-import.test.js — raidmimic.com "My characters", step 1 (DECISIONS §545).
//
// The web copies two pieces of the agent / bot (the web imports nothing from outside web/): the export-file reader
// (agent `parsePopFlagsFile`) and the claim rule (utils/hubSync.js `decideClaim`). This test runs BOTH sides on the same
// input and fails if they disagree, then tests the import itself with a fake store: the 8-character cap, the claim
// outcomes, and that a file that is not a PoPFlags export is rejected. Names are invented.
//
// Run: npx vitest run test/hub-characters-import.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { AGENT_INDEX, ROOT, readSource, sliceBlock } from './_source-slice.js';
import { parseExportFile, flagRowsFromExport, importExports, MAX_CHARACTERS_PER_PLAYER, MAX_FILE_BYTES } from '../web/lib/hubImport.ts';
import { decideClaim as webClaim } from '../web/lib/hubClaim.ts';
import { characterView } from '../web/lib/hubCharactersView.ts';
import { parsePopFlags } from '../web/lib/popFlagsPaste.ts';

const require = createRequire(import.meta.url);
const { decideClaim: botClaim } = require('../utils/hubSync.js');

const src = readSource(AGENT_INDEX);
const tsBlock = sliceBlock(src, 'const TS_RX = ', '  return isNaN(d.getTime()) ? null : d;\n}');
const pfBlock = sliceBlock(src, 'const _PF_STAGES = [', '  return { events, found };\n}');
// eslint-disable-next-line no-new-func
const A = new Function(tsBlock + '\n' + pfBlock + '\nreturn { parsePopFlagsFile, popFlagsFileEvents };')();

const reply = fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'popflags-real-a.txt'), 'utf8').split('\n').filter(Boolean);
const fileText = (name, ts = '2026-11-08_21-30-00', lines = reply) =>
  `Character\t${name}\nTimestamp\t${ts}\nCommand\t#popflags, #popflags 1-5\n---\n${lines.join('\n')}\n`;
const NOW = Date.parse('2026-11-09T12:00:00Z');

describe('the export-file reader matches the agent', () => {
  it('reads the same character and the same reply lines', () => {
    const text = fileText('Aldenmar');
    const web = parseExportFile(text);
    const agent = A.parsePopFlagsFile(text);
    expect(web.character).toBe(agent.character);
    expect(web.lines).toEqual(agent.lines);
  });
  it('proves the same steps as the agent reads from the same file', () => {
    const text = fileText('Brackwyn');
    const agentSteps = [...new Set(A.popFlagsFileEvents(A.parsePopFlagsFile(text), 'Brackwyn').events.flatMap(e => e.stages))].sort();
    const web = parsePopFlags(parseExportFile(text).lines.join('\n')).flags.slice().sort();
    expect(agentSteps.length).toBeGreaterThan(5);
    expect(web).toEqual(agentSteps);
  });
  it('rejects the same malformed files', () => {
    const bad = [
      'just some chat\nwith no header\n',
      'Character\tAldenmar\nTimestamp\t2026-11-08_21-30-00\nno separator\n',
      'Character\tAld3nmar\nTimestamp\t2026-11-08_21-30-00\n---\nx\n',
      'Character\tAldenmar\nTimestamp\t2026-13-45_21-30-00\n---\nx\n',
      'Character\tAldenmar\n---\nx\n',
    ];
    for (const t of bad) { expect(A.parsePopFlagsFile(t)).toBeNull(); expect(parseExportFile(t)).toBeNull(); }
  });
});

describe('the claim rule matches utils/hubSync.js', () => {
  const me = 'p-me', other = 'p-other';
  const cases = [
    {},
    { wolfpackDiscordId: '111' },
    { wolfpackDiscordId: '999' },
    { holders: [{ player_id: other, proof: 'proven' }] },
    { holders: [{ player_id: other, proof: 'claimed' }] },
    { holders: [{ player_id: other, proof: 'contested' }] },
    { holders: [{ player_id: me, proof: 'claimed' }] },
    { holders: [{ player_id: me, proof: 'contested' }] },
    { holders: [{ player_id: me, proof: 'proven' }, { player_id: other, proof: 'claimed' }] },
    { holders: [{ player_id: me, proof: 'claimed' }, { player_id: other, proof: 'proven' }] },
    { wolfpackDiscordId: '999', holders: [{ player_id: other, proof: 'claimed' }] },
  ];
  it.each(cases.map((c, i) => [i, c]))('case %i', (_i, c) => {
    const a = { playerId: me, discordId: '111', ...c };
    expect(webClaim(a)).toEqual(botClaim(a));
  });
});

// ── the import, against a fake store ─────────────────────────────────────────
function fakeStore({ held = [], owners = {}, holders = {} } = {}) {
  const s = { chars: [], flags: [], flipped: [], touched: [] };
  const deps = {
    playerId: 'p-me', discordId: '111', now: () => NOW,
    heldNames: async () => held,
    wolfpackOwners: async () => new Map(Object.entries(owners)),
    holders: async () => new Map(Object.entries(holders)),
    insertCharacters: async (rows) => { s.chars.push(...rows); return null; },
    touchCharacters: async (_p, lcs) => { s.touched.push(...lcs); return null; },
    flipContested: async (lcs) => { s.flipped.push(...lcs); return null; },
    insertFlags: async (rows) => { s.flags.push(...rows); return null; },
  };
  return { s, deps };
}
const up = (name, text) => ({ name: `${name}-PoPFlags.txt`, text, size: text.length });
const names = (n) => Array.from({ length: n }, (_, i) => 'Zarrin' + String.fromCharCode(97 + i));   // letters only

describe('importing', () => {
  it('saves a character and its flags, steps plus what they imply, stamped with the file time', async () => {
    const { s, deps } = fakeStore();
    const r = await importExports([up('Aldenmar', fileText('Aldenmar'))], deps);
    expect(r.ok).toBe(true);
    expect(r.characters).toMatchObject([{ character: 'Aldenmar', status: 'saved' }]);
    expect(s.chars).toEqual([{ player_id: 'p-me', name: 'Aldenmar', name_lc: 'aldenmar', proof: 'claimed' }]);
    expect(s.flags.length).toBeGreaterThan(5);
    expect(new Set(s.flags.map(f => f.earned_at))).toEqual(new Set(['2026-11-08T21:30:00.000Z']));
    expect(s.flags.every(f => f.player_id === 'p-me' && f.source === 'popflags_file')).toBe(true);
    // the same flags the Wolf Pack paste save would write
    const { rows } = flagRowsFromExport(parseExportFile(fileText('Aldenmar')), NOW);
    expect(s.flags.map(f => f.flag_key)).toEqual(rows.map(f => f.flag_key));
  });

  it('the cap is one exported constant, 8', () => { expect(MAX_CHARACTERS_PER_PLAYER).toBe(8); });

  it('refuses characters past the cap with a clear message, and keeps the first ones', async () => {
    const { s, deps } = fakeStore();
    const files = names(MAX_CHARACTERS_PER_PLAYER + 2).map(n => up(n, fileText(n)));
    const r = await importExports(files, deps);
    const saved = r.characters.filter(c => c.status === 'saved');
    const refused = r.characters.filter(c => c.status === 'refused');
    expect(saved).toHaveLength(MAX_CHARACTERS_PER_PLAYER);
    expect(refused).toHaveLength(2);
    expect(refused[0].reason).toMatch(/already have 8 characters/);
    expect(s.chars).toHaveLength(MAX_CHARACTERS_PER_PLAYER);
  });

  it('counts the characters a player already holds; a held name can be re-uploaded at the cap', async () => {
    const held = names(MAX_CHARACTERS_PER_PLAYER).map(n => n.toLowerCase());
    const { s, deps } = fakeStore({ held, holders: Object.fromEntries(held.map(h => [h, [{ player_id: 'p-me', proof: 'claimed' }]])) });
    const r = await importExports([up('x', fileText('Newcomer')), up('y', fileText(names(1)[0]))], deps);
    expect(r.characters.find(c => c.character === 'Newcomer').status).toBe('refused');
    expect(r.characters.find(c => c.character === names(1)[0]).status).toBe('saved');
    expect(s.chars).toHaveLength(0);
    expect(s.touched).toEqual([names(1)[0].toLowerCase()]);
  });

  it('refuses a name Wolf Pack links to another Discord account, and one another player has proven', async () => {
    const { s, deps } = fakeStore({ owners: { aldenmar: '999' }, holders: { brackwyn: [{ player_id: 'p-x', proof: 'proven' }] } });
    const r = await importExports([up('a', fileText('Aldenmar')), up('b', fileText('Brackwyn'))], deps);
    expect(r.characters.map(c => c.status)).toEqual(['refused', 'refused']);
    expect(r.characters[0].reason).toMatch(/Wolf Pack/);
    expect(s.chars).toHaveLength(0);
    expect(s.flags).toHaveLength(0);
  });

  it('stores a contested claim and flips the other holder', async () => {
    const { s, deps } = fakeStore({ holders: { rethlan: [{ player_id: 'p-x', proof: 'claimed' }] } });
    const r = await importExports([up('r', fileText('Rethlan'))], deps);
    expect(r.characters[0].status).toBe('contested');
    expect(s.chars[0].proof).toBe('contested');
    expect(s.flipped).toEqual(['rethlan']);
  });

  it('rejects a file that is not a PoPFlags export, and one that is too large', async () => {
    const { s, deps } = fakeStore();
    const r = await importExports([
      up('chat', 'hello\nthis is an eqlog line\n'),
      up('empty', fileText('Corvale', undefined, ['nothing to see here'])),
      { name: 'big.txt', text: '', size: MAX_FILE_BYTES + 1 },
    ], deps);
    expect(r.ok).toBe(true);
    expect(r.characters).toEqual([]);
    expect(r.problems.map(p => p.file)).toEqual(['chat-PoPFlags.txt', 'empty-PoPFlags.txt', 'big.txt']);
    expect(s.chars).toHaveLength(0);
  });

  it('the later export of the same character wins within one upload; nothing selected is an error', async () => {
    const { s, deps } = fakeStore();
    await importExports([up('a', fileText('Nyssara', '2026-11-01_10-00-00')), up('b', fileText('Nyssara', '2026-11-08_10-00-00'))], deps);
    expect(s.chars).toHaveLength(1);
    expect(new Set(s.flags.map(f => f.earned_at))).toEqual(new Set(['2026-11-08T10:00:00.000Z']));
    expect((await importExports([], deps)).ok).toBe(false);
  });
});

describe('what a character shows', () => {
  it('feeds the plain flag keys to the PoP next-steps logic, once per key', () => {
    const { rows } = flagRowsFromExport(parseExportFile(fileText('Aldenmar')), NOW);
    const v = characterView('Aldenmar', 'claimed', [...rows, ...rows]);
    expect(v.flagCount).toBe(rows.length);
    expect(v.next.lines).toBeGreaterThan(0);
    expect(v.groups.length).toBeGreaterThan(0);
    expect(characterView('Aldenmar', 'claimed', []).flagCount).toBe(0);
  });
});
