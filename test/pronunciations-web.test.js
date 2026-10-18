// test/pronunciations-web.test.js: the website's "say your name" rules (the guild lead, 2026-10-17).
//
// web/lib/pronunciations.ts is run for real against a small in-memory stand-in for the Supabase client:
//   - the OWNER rule: you may set/clear only a character in your owned list; anyone else's is refused, writes nothing
//   - the OFFICER rule: an officer may set/clear any character that exists in the roster; an unknown name is refused
//   - the same validation as the bot (letters-only name, 1-60 character spelling), whitespace collapsed
//   - set_by_discord_id is the actor, clear deletes the row, alternates are the other suggestions
// plus stripped-source checks (comments removed, so a comment cannot answer for the code) that both pages carry
// the [beta] marker, the admin page is officer-gated BEFORE it loads, and the two action files ask the right question.
// Invented names only (Aldenmar, Corvale, Brackwyn); none is anybody.
//
// Run: npx vitest run test/pronunciations-web.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import {
  savePronunciation, clearPronunciation, myPronunciations, allPronunciations, cleanSay, memberDiscordId, NAME_RE,
} from '../web/lib/pronunciations.ts';

function makeDb(seed = {}) {
  const t = {
    name_pronunciations: [], wolfpack_members: [],
    characters: [{ name: 'Aldenmar' }, { name: 'Corvale' }, { name: 'Brackwyn' }].map(c => ({ guild_id: 'wolfpack', ...c })),
    ...seed,
  };
  const log = [];
  const from = (table) => {
    const q = { filters: [], op: 'select', payload: null, ord: null, single: false };
    const rows = () => t[table].filter(r => q.filters.every(f => f(r)));
    const b = {
      select() { return b; },
      eq(k, v) { q.filters.push(r => r[k] === v); return b; },
      in(k, vs) { q.filters.push(r => vs.includes(r[k])); return b; },
      ilike(k, v) { q.filters.push(r => String(r[k]).toLowerCase() === String(v).toLowerCase()); return b; },
      order(k) { q.ord = k; return b; },
      maybeSingle() { q.single = true; return b; },
      upsert(p, o) { q.op = 'upsert'; q.payload = p; q.opts = o; return b; },
      delete() { q.op = 'delete'; return b; },
      then(res) {
        if (q.op === 'select') {
          const out = rows().map(r => ({ ...r }));
          if (q.ord) out.sort((a, c) => (a[q.ord] < c[q.ord] ? 1 : -1));
          return res({ data: q.single ? (out[0] ?? null) : out, error: null });
        }
        log.push({ table, op: q.op, payload: q.payload, opts: q.opts });
        if (q.op === 'delete') {
          const drop = new Set(rows());
          t[table] = t[table].filter(r => !drop.has(r));
        } else {
          const i = t[table].findIndex(r => r.guild_id === q.payload.guild_id && r.character_lc === q.payload.character_lc);
          if (i >= 0) t[table][i] = { ...t[table][i], ...q.payload }; else t[table].push({ ...q.payload });
        }
        return res({ data: null, error: null });
      },
    };
    return b;
  };
  return { db: { from }, t, log };
}

const owned = [{ name: 'Aldenmar' }, { name: 'Brackwyn' }];
const member = { discordId: '111', officer: false };
const officer = { discordId: '999', officer: true };

describe('validation (the bot\'s rule)', () => {
  it('cleanSay trims and collapses spaces, and refuses empty, long, digits and symbols', () => {
    expect(cleanSay('  AL-den   mar ')).toEqual({ ok: true, say: 'AL-den mar' });
    expect(cleanSay("AL-den-mar's").ok).toBe(true);
    for (const bad of ['', '   ', 'x'.repeat(61), 'AL-3', 'AL<den>', '-lead']) expect(cleanSay(bad).ok).toBe(false);
    expect(cleanSay('x'.repeat(60)).ok).toBe(true);
  });

  it('the character name is letters only, 2 to 32', () => {
    expect(NAME_RE.test('Aldenmar')).toBe(true);
    for (const bad of ['A', 'Al den', 'Al3', 'x'.repeat(33), '']) expect(NAME_RE.test(bad)).toBe(false);
  });

  it('a bad spelling or bad name writes nothing', async () => {
    const { db, log } = makeDb();
    expect((await savePronunciation(db, member, owned, 'Aldenmar', 'AL-3')).ok).toBe(false);
    expect((await savePronunciation(db, member, owned, 'Al3', 'AL-den')).ok).toBe(false);
    expect(log).toHaveLength(0);
  });
});

describe('the owner rule', () => {
  it('saves for an owned character (any case), recording the actor and the other suggestions', async () => {
    const { db, t } = makeDb();
    const r = await savePronunciation(db, member, owned, 'aldenmar', ' AL-den-mar ');
    expect(r.ok).toBe(true);
    expect(r.say).toBe('AL-den-mar');
    expect(t.name_pronunciations).toHaveLength(1);
    expect(t.name_pronunciations[0]).toMatchObject({
      guild_id: 'wolfpack', character_lc: 'aldenmar', display_name: 'Aldenmar', say: 'AL-den-mar', set_by_discord_id: '111',
    });
    // Same filter as the bot: the other suggestions, minus any that read the same ignoring case.
    expect(t.name_pronunciations[0].alternates).not.toContain('AL-den-mar');
    const z = makeDb();
    await savePronunciation(z.db, member, [{ name: 'Zarrin' }], 'Zarrin', 'ZARR-in');
    expect(z.t.name_pronunciations[0].alternates).toEqual(['ZAR-rin', 'zar-RIN']);
  });

  it('refuses a character you do not own, even one that exists, and writes nothing', async () => {
    const { db, log, t } = makeDb();
    const r = await savePronunciation(db, member, owned, 'Corvale', 'KOR-vayl');
    expect(r).toEqual({ ok: false, error: 'not your character' });
    expect((await clearPronunciation(db, member, owned, 'Corvale')).ok).toBe(false);
    expect(log).toHaveLength(0);
    expect(t.name_pronunciations).toHaveLength(0);
  });

  it('saving again replaces the one row; clearing deletes it', async () => {
    const { db, t } = makeDb();
    await savePronunciation(db, member, owned, 'Aldenmar', 'AL-den-mar');
    await savePronunciation(db, member, owned, 'Aldenmar', 'al-DEN-mar');
    expect(t.name_pronunciations).toHaveLength(1);
    expect(t.name_pronunciations[0].say).toBe('al-DEN-mar');
    const r = await clearPronunciation(db, member, owned, 'ALDENMAR');
    expect(r).toMatchObject({ ok: true, say: null });
    expect(t.name_pronunciations).toHaveLength(0);
  });

  it('only deletes the named character\'s row', async () => {
    const { db, t } = makeDb();
    await savePronunciation(db, member, owned, 'Aldenmar', 'AL-den-mar');
    await savePronunciation(db, member, owned, 'Brackwyn', 'BRACK-win');
    await clearPronunciation(db, member, owned, 'Brackwyn');
    expect(t.name_pronunciations.map(r => r.display_name)).toEqual(['Aldenmar']);
  });
});

describe('the officer rule', () => {
  it('an officer may set and clear anyone\'s, recorded as the officer\'s doing', async () => {
    const { db, t } = makeDb();
    const r = await savePronunciation(db, officer, [], 'corvale', 'KOR-vayl');
    expect(r.ok).toBe(true);
    expect(t.name_pronunciations[0]).toMatchObject({ display_name: 'Corvale', character_lc: 'corvale', set_by_discord_id: '999' });
    expect((await clearPronunciation(db, officer, [], 'Corvale')).ok).toBe(true);
    expect(t.name_pronunciations).toHaveLength(0);
  });

  it('an officer still cannot create a row for a name that is not in the roster', async () => {
    const { db, log } = makeDb();
    const r = await savePronunciation(db, officer, [], 'Nobodyhere', 'no-BOD-ee');
    expect(r.ok).toBe(false);
    expect(log).toHaveLength(0);
  });

  it('a non-officer with an empty owned list can do nothing', async () => {
    const { db, log } = makeDb();
    expect((await savePronunciation(db, member, [], 'Corvale', 'KOR-vayl')).ok).toBe(false);
    expect(log).toHaveLength(0);
  });
});

describe('reading', () => {
  it('myPronunciations joins owned characters with what is saved (null = said as spelled)', async () => {
    const { db } = makeDb();
    await savePronunciation(db, member, owned, 'Aldenmar', 'AL-den-mar');
    const rows = await myPronunciations(db, owned);
    expect(rows.map(r => [r.name, r.say])).toEqual([['Aldenmar', 'AL-den-mar'], ['Brackwyn', null]]);
    expect(await myPronunciations(db, [])).toEqual([]);
  });

  it('allPronunciations lists every row with the setter\'s display name when known', async () => {
    const { db } = makeDb({ wolfpack_members: [{ discord_id: '999', nickname: 'Officer Nick', global_name: null }] });
    await savePronunciation(db, officer, [], 'Corvale', 'KOR-vayl');
    await savePronunciation(db, member, owned, 'Aldenmar', 'AL-den-mar');
    const rows = await allPronunciations(db);
    expect(rows).toHaveLength(2);
    expect(rows.find(r => r.name === 'Corvale').setBy).toBe('Officer Nick');
    expect(rows.find(r => r.name === 'Aldenmar').setBy).toBeNull();   // no member row found
  });

  it('memberDiscordId is the member\'s own id', async () => {
    const { db } = makeDb({ wolfpack_members: [{ user_id: 'u1', discord_id: '111' }] });
    expect(await memberDiscordId(db, 'u1')).toBe('111');
    expect(await memberDiscordId(db, 'nope')).toBeNull();
  });
});

describe('the pages and actions (comments stripped)', () => {
  const read = (rel) => stripJs(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  const raw = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

  it('both new pages carry the [beta] marker and title', () => {
    for (const rel of ['web/app/me/voice/page.tsx', 'web/app/admin/pronunciations/page.tsx']) {
      expect(read(rel)).toMatch(/<NewPageTag\b/);
      expect(read(rel)).toMatch(/title: '\[beta\] /);
    }
    const meta = read('web/lib/pageMeta.ts');
    expect(meta).toMatch(/'\/me\/voice':\s*\{ title: '\[beta\] /);
    expect(meta).toMatch(/'\/admin\/pronunciations':\s*'\[beta\] /);
  });

  it('the admin page asks requireOfficer() before it loads anything', () => {
    const src = read('web/app/admin/pronunciations/page.tsx');
    const gate = src.indexOf('await requireOfficer()');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(src.indexOf('allPronunciations('));
    expect(gate).toBeLessThan(src.indexOf('loadRoster()'));
  });

  it('the admin actions re-check isOfficer and run as an officer; the member actions never do', () => {
    const admin = read('web/app/admin/pronunciations/actions.ts');
    expect(admin).toMatch(/await isOfficer\(user\.id\)/);
    expect(admin).toMatch(/officer: true/);
    expect(admin.match(/const me = await officer\(\);\n\s+if \(!me\) return/g)).toHaveLength(2);
    const mine = read('web/app/me/voice/actions.ts');
    expect(mine).toMatch(/officer: false/);
    expect(mine).not.toMatch(/isOfficer/);
    expect(mine).toMatch(/await ownedCharacters\(user\.id\)/);
  });

  it('every write action revalidates its page', () => {
    for (const rel of ['web/app/admin/pronunciations/actions.ts', 'web/app/me/voice/actions.ts']) {
      const src = read(rel);
      expect(src.match(/revalidatePath\(/g).length).toBeGreaterThanOrEqual(2);
      expect(src).toMatch(/^'use server';/m);
    }
  });

  it('the pages are linked from /me and the admin index', () => {
    expect(read('web/app/me/page.tsx')).toMatch(/href="\/me\/voice"/);
    expect(read('web/app/admin/page.tsx')).toMatch(/href="\/admin\/pronunciations"/);
  });

  it('the shared lib imports nothing from outside web/ (the site ships from web/ alone)', () => {
    const imports = raw('web/lib/pronunciations.ts').match(/^import .* from '(.+)';$/gm) ?? [];
    expect(imports.length).toBeGreaterThan(0);
    for (const i of imports) expect(i).toMatch(/from '\.\/(pronounce|guild)'/);
  });

  it('the bot lets an officer set anyone\'s through the agent route', () => {
    const src = read('index.js');
    const at = src.indexOf('async function _handleAgentPronunciationSet');
    const body = src.slice(at, src.indexOf('\n}\n', at));
    expect(body).toMatch(/!mine && !\(row && identity\.is_officer\)/);
  });
});
