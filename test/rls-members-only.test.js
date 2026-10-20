// test/rls-members-only.test.js — reads of guild data need a guild member (or the service role).
//
// supabase/migrations/20261020120000_rls_members_only.sql replaces the blanket `USING (true)` read policies on
// the guild tables: tables nobody reads with a user or anon key lose the policy and the SELECT grant; the one
// table read with a user session (hate_kills, /pvp/hate) gets a members-only policy built on
// public.is_guild_member(). This file holds three things:
//   1. the migration covers every table of the audited inventory, with no `USING (true)` left on a sensitive one;
//   2. the membership function is SECURITY DEFINER with a fixed search_path and is not callable by anon;
//   3. the web never reads a revoked table through a user-session client (that would break a page), and a later
//      migration does not re-open a sensitive table.
//
// Text assertions run on the migration with its comments stripped (a header that names a table must not satisfy
// them). Run: npx vitest run test/rls-members-only.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readSource, stripSql, stripJs } from './_source-slice.js';

const MIG_DIR = path.join(ROOT, 'supabase', 'migrations');
const MIG_NAME = '20261020120000_rls_members_only.sql';

// The audited inventory: every non-eqemu public table that carried a `USING (true)` read policy on 2026-10-20.
const MEMBERS_ONLY = ['hate_kills'];
const KEPT_PUBLIC = ['bosses_local', 'bot_boards', 'fun_events', 'patch_notes', 'pet_names', 'sync_meta'];
const REVOKED = [
  'agent_clock_offsets', 'bot_announcements', 'character_aas', 'character_gear', 'character_live_state',
  'character_lockouts', 'characters', 'charm_sessions', 'combat_events', 'common_macros', 'comp_templates',
  'contributions', 'crash_reports', 'encounter_combat_rollup', 'encounter_events', 'encounter_players',
  'encounter_threat_rank', 'encounters', 'faction_cons', 'faction_hits', 'faction_standing', 'fight_cards',
  'guild_rules', 'kite_loops', 'loot_drops', 'looted_items', 'mimic_notices', 'name_pronunciations',
  'opendkp_auction_bids', 'opendkp_auctions', 'opendkp_call_stats', 'opendkp_loot', 'opendkp_raids',
  'opendkp_ticks', 'overlay_design_feedback', 'overlay_design_votes', 'overlay_tuning', 'pop_flags', 'pvp_kills',
  'pvp_quake', 'quarm_patch_notes', 'raid_nights', 'roll_set_overrides', 'roll_sets', 'spell_level_seed',
  'target_observations', 'ui_window_usage', 'voice_settings', 'who_observations', 'who_overrides',
  'wolfpack_roles', 'xp_events',
];
const SENSITIVE = [...REVOKED, ...MEMBERS_ONLY];

const raw = readSource(path.join(MIG_DIR, MIG_NAME));
const sql = stripSql(raw);

// The function body holds semicolons of its own, so cut it out before splitting into statements.
const FN_RE = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.is_guild_member\(\)[\s\S]*?\$\$[\s\S]*?\$\$\s*;/i;
const fnMatch = sql.match(FN_RE);
const fnText = fnMatch ? fnMatch[0] : '';
const stmts = sql.replace(FN_RE, '').split(';').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);

const revoked = new Set();
const dropped = new Map();      // table -> [policy]
const created = [];             // { name, table, using }
for (const s of stmts) {
  let m;
  if ((m = s.match(/^REVOKE SELECT ON public\.(\w+) FROM anon, authenticated$/i))) revoked.add(m[1]);
  else if ((m = s.match(/^DROP POLICY IF EXISTS ("[^"]+"|\w+) ON public\.(\w+)$/i))) {
    dropped.set(m[2], [...(dropped.get(m[2]) || []), m[1]]);
  } else if ((m = s.match(/^CREATE POLICY (\w+) ON public\.(\w+) FOR SELECT TO authenticated USING \((.*)\)$/i))) {
    created.push({ name: m[1], table: m[2], using: m[3] });
  }
}

describe('inventory partition', () => {
  it('lists each table once', () => {
    const all = [...REVOKED, ...MEMBERS_ONLY, ...KEPT_PUBLIC];
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBe(59);
  });
});

describe('migration coverage', () => {
  it('is transactional', () => {
    expect(sql).toMatch(/^\s*BEGIN;/i);
    expect(sql).toMatch(/COMMIT;\s*$/i);
  });

  it.each(REVOKED)('%s: policy dropped and SELECT revoked from anon + authenticated', (t) => {
    expect(dropped.get(t)?.length, `${t} has no DROP POLICY`).toBeGreaterThan(0);
    expect(revoked.has(t), `${t} is not revoked`).toBe(true);
    expect(created.filter((c) => c.table === t), `${t} must not get a new policy`).toHaveLength(0);
  });

  it.each(MEMBERS_ONLY)('%s: blanket policy dropped, members-only policy created', (t) => {
    expect(dropped.get(t)?.length).toBeGreaterThan(0);
    const mine = created.filter((c) => c.table === t);
    expect(mine).toHaveLength(1);
    expect(mine[0].using).toMatch(/public\.is_guild_member\(\)/);
    expect(mine[0].using).not.toMatch(/\btrue\b/i);
    expect(revoked.has(t), `${t} is read with a user session, so it keeps its grant`).toBe(false);
  });

  it('every policy created is members-only; none is USING (true)', () => {
    for (const c of created) expect(c.using).toMatch(/is_guild_member\(\)/);
    expect(sql).not.toMatch(/USING\s*\(\s*(\(\s*)?true/i);
  });

  it('grants SELECT to no one', () => {
    expect(sql).not.toMatch(/GRANT\s+(SELECT|ALL)\b[^;]*\bON\b[^;]*\bTO\b[^;]*\b(anon|authenticated|public)\b/i);
  });

  it.each(KEPT_PUBLIC)('%s: left alone', (t) => {
    expect(revoked.has(t)).toBe(false);
    expect(dropped.has(t)).toBe(false);
    expect(created.some((c) => c.table === t)).toBe(false);
  });

  it('touches no eqemu_* catalog and nothing outside the inventory', () => {
    const touched = new Set([...revoked, ...dropped.keys(), ...created.map((c) => c.table)]);
    for (const t of touched) {
      expect(t).not.toMatch(/^eqemu_/);
      expect(SENSITIVE).toContain(t);
    }
  });

  it('a DROP POLICY always names the table it belongs to (no policy dropped from the wrong table)', () => {
    const dropStmts = stmts.filter((s) => /^DROP POLICY/i.test(s));
    expect(dropStmts.length).toBeGreaterThanOrEqual(REVOKED.length + 1);
    for (const s of dropStmts) expect(s).toMatch(/ ON public\.\w+$/i);
  });

  it('revokes the definer summary of opendkp_call_stats from the public keys', () => {
    expect(stmts).toContain('REVOKE ALL ON FUNCTION public.opendkp_traffic_summary() FROM PUBLIC, anon, authenticated');
  });
});

describe('public.is_guild_member()', () => {
  it('exists in the migration', () => {
    expect(fnText).not.toBe('');
  });
  it('is SECURITY DEFINER with a fixed search_path', () => {
    expect(fnText).toMatch(/\bSECURITY\s+DEFINER\b/i);
    expect(fnText).toMatch(/\bSET\s+search_path\s*=\s*public\b/i);
    expect(fnText).toMatch(/\bSTABLE\b/i);
  });
  it('tests the row the sign-in callback writes', () => {
    expect(fnText).toMatch(/public\.wolfpack_members/);
    expect(fnText).toMatch(/m\.user_id\s*=\s*\(\s*SELECT\s+auth\.uid\(\)\s*\)/i);
    expect(fnText).toMatch(/m\.is_member\s+IS\s+TRUE/i);
  });
  it('cannot be called by anon', () => {
    expect(stmts).toContain('REVOKE ALL ON FUNCTION public.is_guild_member() FROM PUBLIC, anon');
    expect(stmts).toContain('GRANT EXECUTE ON FUNCTION public.is_guild_member() TO authenticated, service_role');
  });
});

// ── the web must not read a revoked table with a user session ────────────────────────────────────────────────
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.next') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

// Tables each user-session (supabaseServer / supabaseBrowser / createServerClient) client reads today. A new entry
// needs a policy that lets a member through, not a revoke.
function userSessionReads() {
  const found = [];
  for (const f of walk(path.join(ROOT, 'web'))) {
    const src = stripJs(readSource(f));
    const vars = new Set();
    for (const m of src.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*(?:supabaseServer|supabaseBrowser|createServerClient|createBrowserClient)\s*\(/g)) vars.add(m[1]);
    for (const v of vars) {
      for (const m of src.matchAll(new RegExp('\\b' + v + '\\s*\\.from\\(\\s*[\'"`](\\w+)[\'"`]', 'g'))) found.push({ file: path.relative(ROOT, f), table: m[1] });
    }
    for (const m of src.matchAll(/(?:supabaseServer|supabaseBrowser)\(\)\s*\.from\(\s*['"`](\w+)['"`]/g)) found.push({ file: path.relative(ROOT, f), table: m[1] });
  }
  return found;
}

describe('web user-session reads', () => {
  const reads = userSessionReads();

  it('finds the known user-session readers (the scan is not vacuous)', () => {
    const tables = new Set(reads.map((r) => r.table));
    expect(tables.has('hate_kills')).toBe(true);
    expect(tables.has('item_with_proc')).toBe(true);
    expect(tables.has('page_views')).toBe(true);
  });

  it('none of them reads a revoked table', () => {
    const bad = reads.filter((r) => REVOKED.includes(r.table));
    expect(bad, JSON.stringify(bad)).toHaveLength(0);
  });

  it('every sensitive table a user session reads has a members-only policy', () => {
    const need = reads.filter((r) => SENSITIVE.includes(r.table));
    for (const r of need) expect(MEMBERS_ONLY, `${r.file} reads ${r.table}`).toContain(r.table);
  });
});

describe('later migrations', () => {
  it('none re-opens a sensitive table with USING (true)', () => {
    const later = fs.readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql') && f > MIG_NAME);
    for (const f of later) {
      const s = stripSql(readSource(path.join(MIG_DIR, f)));
      for (const m of s.matchAll(/CREATE\s+POLICY\s+[^;]*?\bON\s+(?:public\.)?"?(\w+)"?[^;]*?USING\s*\(\s*(?:\(\s*)?true\b[^;]*/gi)) {
        expect(SENSITIVE, `${f} opens ${m[1]}`).not.toContain(m[1]);
      }
    }
  });
});
