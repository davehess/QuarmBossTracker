// test/pop-guide.test.js — the PoP checklist (the guild lead, 2026-09-28: "where to start, what quests
// are must haves, what can be done with a group or a raid or solo. Make this a checkbox type of thing").
// web/lib/popGuide.ts is pure; the tick action must refuse unknown items and other people's characters
// before it writes anything; the table is service-role only.
//
// Run: npx vitest run test/pop-guide.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs, stripSql } from './_source-slice.js';
import {
  GUIDE_ITEMS, GUIDE_SECTIONS, GUIDE_KEYS, tickedKeys, recordedKeys, unknownFlags,
} from '../web/lib/popGuide.ts';

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('the checklist catalog', () => {
  it('has unique storage keys, and every item sits in a real section', () => {
    expect(GUIDE_KEYS.size).toBe(GUIDE_ITEMS.length);
    const sections = new Set(GUIDE_SECTIONS.map(s => s.key));
    for (const i of GUIDE_ITEMS) expect(sections.has(i.section), i.key).toBe(true);
    for (const s of GUIDE_SECTIONS) expect(GUIDE_ITEMS.some(i => i.section === s.key), s.key).toBe(true);
  });

  it('names only flags the PoP catalog knows, so a recorded flag can always tick its box', () => {
    expect(unknownFlags()).toEqual([]);
  });

  it('answers the ask: a start, must-haves, and solo, group and raid work', () => {
    expect(GUIDE_SECTIONS[0].key).toBe('start');
    expect(GUIDE_ITEMS.filter(i => i.must).length).toBeGreaterThan(10);
    for (const who of ['solo', 'group', 'raid']) expect(GUIDE_ITEMS.some(i => i.who === who), who).toBe(true);
  });

  it('links PQDI on www only (the bare domain resets the connection)', () => {
    for (const i of GUIDE_ITEMS) if (i.link?.href.includes('pqdi.cc')) expect(i.link.href).toMatch(/^https:\/\/www\.pqdi\.cc\//);
  });
});

describe('ticks', () => {
  it('merges hand ticks with recorded flags, and drops keys the guide does not define', () => {
    const t = tickedKeys(['start_level46', 'not_a_key'], ['grummus_dead']);
    expect(t.has('start_level46')).toBe(true);
    expect(t.has('flag_grummus')).toBe(true);
    expect(t.has('not_a_key')).toBe(false);
    expect([...recordedKeys(['grummus_dead'])]).toEqual(['flag_grummus']);
    expect(recordedKeys([]).size).toBe(0);
  });
});

describe('the tick action', () => {
  const src = stripJs(read('web/app/pop/guide/actions.ts'));
  it('checks the item, the sign-in and the ownership before any write', () => {
    const write = src.indexOf("from('pop_guide_ticks')");
    expect(write).toBeGreaterThan(0);
    for (const gate of ['GUIDE_KEYS.has(itemKey)', 'auth.getUser()', 'ownedCharacters(user.id)']) {
      const at = src.indexOf(gate);
      expect(at, gate).toBeGreaterThan(0);
      expect(at, gate).toBeLessThan(write);
    }
  });
  it('writes under the owned character’s real name, never the name it was handed', () => {
    expect(src).toMatch(/character_name: owned\.name/);
    expect(src).toMatch(/\.eq\('character_name', owned\.name\)/);
    expect(src).not.toMatch(/character_name: character\b/);
  });
});

describe('the page and the table', () => {
  it('is members-only and reads only the viewer’s own characters', () => {
    const page = stripJs(read('web/app/pop/guide/page.tsx'));
    expect(page).toMatch(/if \(!user\) redirect\('\/auth\/signin\?next=\/pop\/guide'\)/);
    expect(page).toMatch(/ownedCharacters\(user\.id\)/);
    expect(page).toMatch(/\.in\('character_name', names\)/);
  });
  it('keeps the table service-role only', () => {
    const sql = stripSql(read('supabase/migrations/20260928192730_pop_guide_ticks.sql'));
    expect(sql).toMatch(/enable row level security/);
    expect(sql).toMatch(/revoke all on pop_guide_ticks from anon, authenticated/);
    expect(sql).not.toMatch(/create policy/i);
  });
});
