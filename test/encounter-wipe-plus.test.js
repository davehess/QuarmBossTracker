// A wipe can be combined with another mark ("Wipe" + "Non-Guild") — encounters.is_wipe alongside
// encounters.classification. The rules are pure (web/lib/encounterMarks.ts), so these run the REAL functions
// and replay them against an in-memory row that enforces the same CHECK the migration adds.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isWipe, chipKeys, wipeTogglePatch, classifyPatch } from '../web/lib/encounterMarks.ts';
import { stripSql } from './_source-slice.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The migration's CHECK, as code: classification 'wipe' => is_wipe, and is_wipe => classification set.
const checkHolds = (r) => (r.classification !== 'wipe' || r.is_wipe) && (!r.is_wipe || r.classification != null);

// What the web actions write, minus the reason/at/by stamps (those are not part of the shape).
const toggle = (row) => {
  const { patch } = wipeTogglePatch(row);
  return { ...row, ...patch };
};
const pick = (row, v) => ({ ...row, ...classifyPatch(v) });
const clear = (row) => ({ ...row, classification: null, is_wipe: false });
const guildKill = () => ({ classification: null, is_wipe: false });

describe('wipe + another mark', () => {
  it('a non-guild wipe: wipe then Non-Guild, in either order, lands on the same row', () => {
    const a = pick(toggle(guildKill()), 'foreign');
    const b = toggle(pick(guildKill(), 'foreign'));
    expect(a).toEqual({ classification: 'foreign', is_wipe: true });
    expect(b).toEqual(a);
    expect(isWipe(a)).toBe(true);
    expect(chipKeys(a)).toEqual(['wipe', 'foreign']);
  });

  it('the other marks combine the same way, and the plain wipe stays one chip', () => {
    for (const v of ['live', 'pvp', 'test', 'foreign']) {
      expect(chipKeys(toggle(pick(guildKill(), v)))).toEqual(['wipe', v]);
    }
    expect(chipKeys({ classification: 'wipe', is_wipe: true })).toEqual(['wipe']);
    expect(chipKeys({ classification: 'foreign', is_wipe: false })).toEqual(['foreign']);
    expect(chipKeys(guildKill())).toEqual([]);
  });

  it('turning Wipe off keeps the other mark; turning it off on a plain wipe returns a guild kill', () => {
    expect(toggle({ classification: 'foreign', is_wipe: true })).toEqual({ classification: 'foreign', is_wipe: false });
    const off = wipeTogglePatch({ classification: 'wipe', is_wipe: true });
    expect(off.reset).toBe(true);
    expect(toggle({ classification: 'wipe', is_wipe: true })).toEqual(guildKill());
  });

  it('picking a one-of mark on a plain wipe keeps it a wipe (the old behaviour replaced the wipe)', () => {
    expect(pick({ classification: 'wipe', is_wipe: true }, 'foreign')).toEqual({ classification: 'foreign', is_wipe: true });
    expect(pick({ classification: 'live', is_wipe: false }, 'pvp')).toEqual({ classification: 'pvp', is_wipe: false });
  });

  it('only a row with no mark is stamped as a new mark; flag changes on a marked row leave who/why alone', () => {
    expect(wipeTogglePatch(guildKill()).stamp).toBe(true);
    expect(wipeTogglePatch({ classification: 'foreign', is_wipe: false }).stamp).toBe(false);
    expect(wipeTogglePatch({ classification: 'foreign', is_wipe: true }).stamp).toBe(false);
  });

  it('a row written before the column existed (is_wipe null/undefined) reads as the plain wipe it was', () => {
    expect(isWipe({ classification: 'wipe' })).toBe(true);
    expect(isWipe({ classification: 'wipe', is_wipe: null })).toBe(true);
    expect(isWipe({ classification: 'foreign', is_wipe: null })).toBe(false);
  });

  it('no sequence of toggles / picks / clears ever breaks the DB CHECK or yields a guild kill that is a wipe', () => {
    const steps = [(r) => toggle(r), (r) => pick(r, 'foreign'), (r) => pick(r, 'live'), (r) => pick(r, 'wipe'), clear];
    const seen = new Set();
    const walk = (row, depth) => {
      expect(checkHolds(row), JSON.stringify(row)).toBe(true);
      seen.add(JSON.stringify(row));
      if (depth === 0) return;
      for (const s of steps) walk(s(row), depth - 1);
    };
    walk(guildKill(), 5);
    expect(seen.size).toBeGreaterThanOrEqual(5);   // the walk actually reached the combined states
    expect(seen.has(JSON.stringify({ classification: 'foreign', is_wipe: true }))).toBe(true);
  });
});

describe('the migration', () => {
  const sql = stripSql(fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261023120000_encounters_is_wipe.sql'), 'utf8'));

  it('adds the column idempotently, backfills the old wipe rows and guards the constraint', () => {
    expect(sql).toMatch(/add column if not exists is_wipe boolean not null default false/i);
    expect(sql).toMatch(/update encounters set is_wipe = true where classification = 'wipe'/i);
    expect(sql).toMatch(/if not exists \(\s*select 1 from pg_constraint where conname = 'encounters_is_wipe_check'/i);
  });

  it('the CHECK has both directions, and the old classification set is left untouched', () => {
    expect(sql).toMatch(/classification is distinct from 'wipe' or is_wipe/i);
    expect(sql).toMatch(/not is_wipe or classification is not null/i);
    expect(sql).not.toMatch(/encounters_classification_check/);
  });
});
