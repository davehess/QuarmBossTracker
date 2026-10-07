// test/guild-tag-literal.test.js — the website never spells its database guild tag out.
//
// The site used to hard-code 'wolfpack' about 222 times in 81 files. The guild kit moves the tag to ONE
// place, web/lib/guild.ts (GUILD_TAG), so a second guild can run the same code on its own tag. This guard is
// what keeps the count at zero: a new `.eq('guild_id', 'wolfpack')` is a red test, not a quiet regression.
//
// The literal swap has landed, so every case here is green. (On a tree that has only the module, with no swaps,
// the "no literal" and "files import GUILD_TAG" cases would be RED, by design.)
//
// Run: npx vitest run test/guild-tag-literal.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import { webSources } from './_web-read-scan.js';

const norm = (p) => p.replace(/\\/g, '/');
const files = webSources().map(norm);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// The module itself defines the default. The ONE other place: obfuscate.ts uses the word as the default
// SALT for the demo-name scrambler (DEMO_OBFUSCATE_SALT), which is a secret-ish seed and not a guild tag;
// changing it would re-scramble every demo name.
const ALLOW = new Set(['web/lib/guild.ts', 'web/lib/obfuscate.ts']);

// The scanner under test: what, in a source's non-comment text, counts as a hard-coded guild tag.
const QUOTED = /['"`]wolfpack['"`]/;
const FILTER = /guild_id\s*(=|\.eq\.|=eq\.)\s*['"]?wolfpack/;
export function literalHits(src) {
  const body = stripJs(src);
  const hits = [];
  if (QUOTED.test(body)) hits.push('quoted');
  if (FILTER.test(body)) hits.push('filter');
  return hits;
}

// An import of GUILD_TAG from the guild module, by any relative or alias path (the named form).
const IMPORTS_TAG = /import\s*(?:type\s*)?\{[^}]*\bGUILD_TAG\b[^}]*\}\s*from\s*['"](?:@\/lib\/guild|(?:\.{1,2}\/)+(?:lib\/)?guild)['"]/;
// ANY import of the guild module, in any form: named, namespace (`* as g`), default + named, with or without
// a `.ts` suffix. The client-file guard uses this one, so `import * as g from '@/lib/guild'` plus a
// `g.GUILD_TAG` read cannot slip past a check that only knew the named form.
const IMPORTS_GUILD = /import\s+[^;]*?from\s*['"](?:@\/lib\/guild|(?:\.{1,2}\/)+(?:lib\/)?guild)(?:\.ts)?['"]/;
const isClient = (src) => /^\s*['"]use client['"]/m.test(stripJs(src));

// The 78 web sources that spelled the tag out before the literal swap (computed from the tree at the commit
// just before it, with the scanner above and the same allowlist). The importer floor below is a fraction of
// THIS list, so it moves only when someone edits the list on purpose.
const PRE_SWAP_OFFENDERS = [
  'web/app/admin/adoption/page.tsx',
  'web/app/admin/agents/page.tsx',
  'web/app/admin/anomalies/page.tsx',
  'web/app/admin/attendance/page.tsx',
  'web/app/admin/comp/actions.ts',
  'web/app/admin/comp/page.tsx',
  'web/app/admin/console/actions.ts',
  'web/app/admin/console/page.tsx',
  'web/app/admin/encounters/page.tsx',
  'web/app/admin/extra-spells/page.tsx',
  'web/app/admin/links/opendkp-actions.ts',
  'web/app/admin/links/page.tsx',
  'web/app/admin/links/site-access-actions.ts',
  'web/app/admin/lockouts/page.tsx',
  'web/app/admin/members/page.tsx',
  'web/app/admin/notices/page.tsx',
  'web/app/admin/overlays/page.tsx',
  'web/app/admin/quarmy/page.tsx',
  'web/app/admin/quests/actions.ts',
  'web/app/admin/quests/page.tsx',
  'web/app/admin/readiness/page.tsx',
  'web/app/admin/rules/page.tsx',
  'web/app/admin/signups/page.tsx',
  'web/app/admin/spells/page.tsx',
  'web/app/admin/voice/page.tsx',
  'web/app/api/search/route.ts',
  'web/app/api/spectator/positions/route.ts',
  'web/app/buffs/page.tsx',
  'web/app/character/[name]/gear/page.tsx',
  'web/app/character/[name]/inventory/page.tsx',
  'web/app/character/[name]/quests/actions.ts',
  'web/app/character/[name]/quests/page.tsx',
  'web/app/character/[name]/spells/page.tsx',
  'web/app/fun/page.tsx',
  'web/app/me/actions.ts',
  'web/app/me/claim-actions.ts',
  'web/app/me/inventory-actions.ts',
  'web/app/me/inventory/page.tsx',
  'web/app/me/keys-actions.ts',
  'web/app/me/page.tsx',
  'web/app/me/spellbook-actions.ts',
  'web/app/me/tells/page.tsx',
  'web/app/me/ui/actions.ts',
  'web/app/me/ui/page.tsx',
  'web/app/opendkp/page.tsx',
  'web/app/parses/[id]/page.tsx',
  'web/app/parses/actions.ts',
  'web/app/parses/page.tsx',
  'web/app/pop/essencesData.ts',
  'web/app/pop/guide/actions.ts',
  'web/app/pop/guide/page.tsx',
  'web/app/pop/guide/routeData.ts',
  'web/app/pop/page.tsx',
  'web/app/pvp/[name]/page.tsx',
  'web/app/pvp/page.tsx',
  'web/app/pvp/server/page.tsx',
  'web/app/quartermaster/page.tsx',
  'web/app/raid/page.tsx',
  'web/app/raid/plan/actions.ts',
  'web/app/raid/plan/page.tsx',
  'web/app/raid/review/[date]/page.tsx',
  'web/app/raid/review/page.tsx',
  'web/app/raidhistory/page.tsx',
  'web/app/rolls/actions.ts',
  'web/app/rolls/page.tsx',
  'web/app/search/page.tsx',
  'web/app/who/actions.ts',
  'web/app/who/page.tsx',
  'web/lib/admin-queue.ts',
  'web/lib/adminQueueData.ts',
  'web/lib/capSafeReads.ts',
  'web/lib/character-family.ts',
  'web/lib/fullReads.ts',
  'web/lib/funLdAuth.ts',
  'web/lib/listableChars.ts',
  'web/lib/popLootRows.ts',
  'web/lib/raidScreen.ts',
  'web/lib/roster.ts',
];

describe('scanner (inline unit, so the guard cannot go vacuous)', () => {
  it('the pre-swap offender list is the 78 distinct paths it claims to be', () => {
    expect(PRE_SWAP_OFFENDERS.length).toBe(78);
    expect(new Set(PRE_SWAP_OFFENDERS).size).toBe(78);
  });

  it('a quoted literal hits, in all three quote styles', () => {
    expect(literalHits(`.eq('guild_id', 'wolfpack')`)).toContain('quoted');
    expect(literalHits(`{ guild_id: "wolfpack" }`)).toContain('quoted');
    expect(literalHits('const t = `wolfpack`;')).toContain('quoted');
  });

  it('a PostgREST filter string hits even without a quote around the value', () => {
    expect(literalHits('fetch(`/rest/v1/t?guild_id=eq.wolfpack&limit=1`)')).toContain('filter');
    expect(literalHits('x = "guild_id=wolfpack"')).toContain('filter');
  });

  it('a whole-line comment does not hit; code beside it still does', () => {
    expect(literalHits(`// the guild_id is 'wolfpack' today\nconst a = 1;`)).toEqual([]);
    expect(literalHits(`/*\n * 'wolfpack'\n */\nconst a = 1;`)).toEqual([]);
    expect(literalHits(`// note\nconst a = 'wolfpack';`)).toContain('quoted');
  });

  it('other words and URLs do not hit', () => {
    expect(literalHits(`const u = 'https://wolfpack.quest';`)).toEqual([]);
    expect(literalHits(`const n = 'wolfpack_members';`)).toEqual([]);
    expect(literalHits(`.eq('guild_id', GUILD_TAG)`)).toEqual([]);
  });

  it('import and client detection', () => {
    expect(IMPORTS_TAG.test(`import { GUILD_TAG } from '@/lib/guild';`)).toBe(true);
    expect(IMPORTS_TAG.test(`import { memberRoles, GUILD_TAG, RANKS } from '../lib/guild';`)).toBe(true);
    expect(IMPORTS_TAG.test(`import {\n  GUILD_NAME,\n  GUILD_TAG,\n} from './guild';`)).toBe(true);
    expect(IMPORTS_TAG.test(`import { GUILD_NAME } from '@/lib/guild';`)).toBe(false);
    expect(IMPORTS_TAG.test(`import { GUILD_TAG } from '@/lib/other';`)).toBe(false);
    expect(isClient(`'use client';\nimport x from 'y';`)).toBe(true);
    expect(isClient(`// 'use client' is mentioned\nexport const a = 1;`)).toBe(false);
  });

  it('IMPORTS_GUILD sees every import form, with and without .ts', () => {
    expect(IMPORTS_GUILD.test(`import { GUILD_TAG } from '@/lib/guild';`)).toBe(true);
    expect(IMPORTS_GUILD.test(`import * as g from '@/lib/guild';`)).toBe(true);
    expect(IMPORTS_GUILD.test(`import g, { GUILD_TAG } from '../lib/guild';`)).toBe(true);
    expect(IMPORTS_GUILD.test(`import * as g from './guild.ts';`)).toBe(true);
    expect(IMPORTS_GUILD.test(`import {\n  GUILD_NAME,\n} from '../../lib/guild';`)).toBe(true);
    expect(IMPORTS_GUILD.test(`import { x } from '@/lib/guildish';`)).toBe(false);
    expect(IMPORTS_GUILD.test(`import * as g from '@/lib/other';`)).toBe(false);
  });

  it('a "use client" file that imports the module by any form and reads GUILD_TAG is a violation', () => {
    const bad = (src) => isClient(src) && IMPORTS_GUILD.test(stripJs(src)) && /\bGUILD_TAG\b/.test(stripJs(src));
    expect(bad(`'use client';\nimport * as g from '@/lib/guild';\nconst t = g.GUILD_TAG;`)).toBe(true);
    expect(bad(`'use client';\nimport g, { GUILD_TAG } from '@/lib/guild';`)).toBe(true);
    expect(bad(`'use client';\nimport { GUILD_INGAME_NAME } from '@/lib/guild';\nconst n = GUILD_INGAME_NAME;`)).toBe(false);
    expect(bad(`import * as g from '@/lib/guild';\nconst t = g.GUILD_TAG;`)).toBe(false);
  });
});

describe('the website source set is the one we think it is', () => {
  it('the scanner saw the whole site, not a corner of it', () => {
    expect(files.length).toBeGreaterThanOrEqual(150);
    expect(files).toContain('web/lib/guild.ts');
    expect(files.some(f => f.startsWith('web/app/'))).toBe(true);
    expect(files.some(f => f.startsWith('web/components/'))).toBe(true);
  });

  it('the allowlist is not stale: each entry exists and (except the module) still carries the literal', () => {
    for (const rel of ALLOW) expect(files, rel).toContain(rel);
    expect(literalHits(read('web/lib/obfuscate.ts')), 'obfuscate.ts SALT default').toContain('quoted');
  });
});

describe('no hard-coded guild tag in web/**', () => {
  it('no file but the module (and the documented allowlist) spells the tag out', () => {
    const offenders = files
      .filter(f => !ALLOW.has(f))
      .map(f => ({ f, hits: literalHits(read(f)) }))
      .filter(x => x.hits.length)
      .map(x => `${x.f} (${x.hits.join(', ')})`);
    expect(offenders).toEqual([]);
  });

  it('the files that need the tag import GUILD_TAG from the guild module (not a vacuous pass)', () => {
    const importers = files.filter(f => f !== 'web/lib/guild.ts' && IMPORTS_TAG.test(stripJs(read(f))));
    // The floor is anchored to the committed list of pre-swap offenders, not a hand-picked number: those
    // files each spelled the tag out, so most of them must import it now (a few were reworded away).
    expect(importers.length).toBeGreaterThanOrEqual(Math.floor(0.6 * PRE_SWAP_OFFENDERS.length));
  });

  it('GUILD_TAG is never read in a "use client" file (the module is client-safe, the tag is not a browser concern)', () => {
    // Any import form of the guild module counts, and so does any mention of GUILD_TAG in the same file.
    const bad = files.filter(f => {
      const src = read(f);
      const body = stripJs(src);
      return isClient(src) && IMPORTS_GUILD.test(body) && /\bGUILD_TAG\b/.test(body);
    });
    expect(bad).toEqual([]);
  });
});
