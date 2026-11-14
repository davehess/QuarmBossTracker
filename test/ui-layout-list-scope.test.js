// UI backups list: "Backups" under one character lists THAT character's backups only.
// It used to filter by owner alone, so every character in a family showed every other
// character's backups, unnamed, each with a Restore button (the guild lead, 2026-10-04:
// "What 19 files were backed up for <main>?" — the list under the main was the whole family).
//
// Runs the bot's REAL handler against a fake Supabase that applies the query's filters.
// Run: npx vitest run test/ui-layout-list-scope.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock, stripJs } from './_source-slice.js';

const bot = readSource(path.join(ROOT, 'index.js'));
const block = sliceBlock(bot, 'async function _handleAgentUiLayoutList(req, res) {', '\n}\n');

const CHARS = [
  { name: 'Aldenmar', main_name: null, discord_id: 'D1', guild_id: 'wolfpack' },
  { name: 'Brackwyn', main_name: 'Aldenmar', discord_id: null, guild_id: 'wolfpack' },
];
const SNAPS = [
  { id: 's1', owner_discord_id: 'D1', character_name: 'Aldenmar', file_count: 18 },
  { id: 's2', owner_discord_id: 'D1', character_name: 'Brackwyn', file_count: 8 },
  { id: 's3', owner_discord_id: 'D1', character_name: 'aldenmar', file_count: 13 },
  { id: 's4', owner_discord_id: 'D2', character_name: 'Aldenmar', file_count: 5 },
];

// Applies `col=eq.x` / `col=ilike.x` (no wildcards) the way PostgREST would.
function applyFilters(rows, query) {
  const params = new URLSearchParams(query);
  return rows.filter(r => [...params].every(([k, v]) => {
    const m = v.match(/^(eq|ilike)\.(.*)$/);
    if (!m) return true;
    const want = m[2];
    if (m[1] === 'eq') return String(r[k]) === want;
    return String(r[k] ?? '').toLowerCase() === want.toLowerCase();
  }));
}

async function list(character, caller = 'D1') {
  const supabase = {
    isEnabled: () => true,
    select: async (table, query) => applyFilters(table === 'characters' ? CHARS : SNAPS, query),
  };
  const mimicLink = { requireAgentAuth: async () => ({ discord_id: caller }) };
  const household = async (id) => new Set([String(id)]);   // each caller is only themselves here
  // eslint-disable-next-line no-new-func
  const handler = new Function('require', 'mimicLink', '_householdDiscordIds', block + '\nreturn _handleAgentUiLayoutList;')(
    (m) => (m === './utils/supabase' ? supabase : null), mimicLink, household);
  let body = '';
  const res = { writeHead() { return res; }, end(b) { body = b || ''; return res; } };
  await handler({ url: '/api/agent/ui_layout?character=' + encodeURIComponent(character) }, res);
  return JSON.parse(body).snapshots.map(s => s.id).sort();
}

describe('UI backups list is scoped to the character asked for', () => {
  it("a main's list holds only the main's backups (any case), not the alt's or another owner's", async () => {
    expect(await list('Aldenmar')).toEqual(['s1', 's3']);
  });

  it("an alt's list holds only the alt's, resolved through the main's owner", async () => {
    expect(await list('brackwyn')).toEqual(['s2']);
  });

  it("someone else's Mimic gets no list for a character that isn't theirs", async () => {
    expect(await list('Aldenmar', 'D2')).toEqual([]);
  });
});

// A character name is letters only. It goes on to an ilike match (where * and % are wildcards) and to a file-name
// test, so anything else in it is refused first, on all three backup routes.
describe('a backup route takes a plain character name and nothing else', () => {
  const stripped = stripJs(bot);
  const routeBlock = (start) => sliceBlock(stripped, start, '\n}\n');

  it('the list refuses a wildcard, a pattern or a look-alike before it reads anything', async () => {
    for (const bad of ['Al*', 'A%', '(a+)+b', 'Alden mar', 'Аldenmar', 'A', 'x'.repeat(25), 'a,b']) {
      const reads = [];
      const supabase = { isEnabled: () => true, select: async (t) => { reads.push(t); return []; } };
      // eslint-disable-next-line no-new-func
      const handler = new Function('require', 'mimicLink', '_householdDiscordIds', block + '\nreturn _handleAgentUiLayoutList;')(
        (m) => (m === './utils/supabase' ? supabase : null), { requireAgentAuth: async () => ({ discord_id: 'D1' }) }, async (id) => new Set([String(id)]));
      let code = 0, body = '';
      const res = { writeHead(c) { code = c; return res; }, end(b) { body = b || ''; return res; } };
      await handler({ url: '/api/agent/ui_layout?character=' + encodeURIComponent(bad) }, res);
      expect([bad, code]).toEqual([bad, 400]);
      expect(JSON.parse(body).snapshots).toBeUndefined();
      expect(reads).toEqual([]);
    }
  });

  it('upload and download carry the same check', () => {
    const NAME = "/^[A-Za-z]{2,24}$/.test(character)";
    expect(routeBlock('async function _handleAgentUiLayoutUpload(req, res) {')).toContain(`!character || !files || !${NAME}`);
    expect(routeBlock('async function _handleAgentUiLayoutDownload(req, res, snapshotId) {')).toContain(`!character || !${NAME} ||`);
  });

  it('the socials index never builds a pattern from the uploaded name', () => {
    const fn = sliceBlock(stripped, 'async function _indexSnapshotSocials(', '\n}\n');
    expect(fn).not.toMatch(/new RegExp\(/);
    expect(fn).toMatch(/l\.startsWith\(lc \+ '_'\) && l\.endsWith\('\.ini'\)/);
  });
});
