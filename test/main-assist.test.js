// test/main-assist.test.js — a main assist declared in raid chat pins their target on Extended Target.
//
// The guild lead, 2026-10-02: "when someone is declared as main assist in raid chat, their target
// should be at the top of the extended target list. And it is typically the person that has more
// targets than anyone's."
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, evalBlock, stripJs, BOT_INDEX } from './_source-slice.js';

const require = createRequire(import.meta.url);
const { parseDeclaration, createStore, CALLED_TARGET_TTL_MS } = require('../utils/mainAssist.js');
const known = new Set(['brackwyn', 'corvale', 'aldenmar']);
const isPlayer = (n) => known.has(n);

describe('reading a declaration', () => {
  it.each([
    ['MA is Brackwyn', 'Brackwyn'],
    ['MA: brackwyn', 'Brackwyn'],
    ['ma = Brackwyn', 'Brackwyn'],
    ['new MA Corvale', 'Corvale'],
    ['MA is now Corvale', 'Corvale'],
    ['main assist is Brackwyn', 'Brackwyn'],
    ['Brackwyn is MA', 'Brackwyn'],
    ['Brackwyn is the MA', 'Brackwyn'],
    ['Corvale is main assist', 'Corvale'],
    ['assist Brackwyn', 'Brackwyn'],
    ['/assist Corvale', 'Corvale'],
  ])('%s', (text, name) => {
    expect(parseDeclaration(text, 'Aldenmar', isPlayer)).toEqual({ name, target: null });
  });
  it('the speaker, from "assist me" and the guild macro, with the mob it names', () => {
    expect(parseDeclaration('ASSIST ME ON ~<={ a gnoll pup }=>~', 'Aldenmar', isPlayer)).toEqual({ name: 'Aldenmar', target: 'a gnoll pup' });
    expect(parseDeclaration('assist me', 'Aldenmar', isPlayer)).toEqual({ name: 'Aldenmar', target: null });
    expect(parseDeclaration("I'm MA", 'Aldenmar', isPlayer)).toEqual({ name: 'Aldenmar', target: null });
  });
  it('ignores names nobody knows and lines that only mention it', () => {
    expect(parseDeclaration('MA is up', 'Aldenmar', isPlayer)).toBeNull();
    expect(parseDeclaration('assist Ulmarr', 'Aldenmar', isPlayer)).toBeNull();
    expect(parseDeclaration('who is MA tonight?', 'Aldenmar', isPlayer)).toBeNull();
    expect(parseDeclaration('assist the tank', 'Aldenmar', isPlayer)).toBeNull();
    expect(parseDeclaration('please assist when the mob is at 95', 'Aldenmar', isPlayer)).toBeNull();
  });
});

describe('the store', () => {
  it('per raid, falling back to the one-raid entry; the macro mob for 90 s only', () => {
    const s = createStore();
    s.note('_', { name: 'Brackwyn', target: 'a gnoll pup' }, 'Brackwyn', 1000);
    expect(s.get(null, 2000)).toMatchObject({ name: 'Brackwyn', called_target: 'a gnoll pup' });
    expect(s.get('r1', 2000).name).toBe('Brackwyn');
    expect(s.get(null, 1000 + CALLED_TARGET_TTL_MS + 1).called_target).toBeNull();
    s.note('r1', { name: 'Corvale', target: null }, 'Aldenmar', 3000);
    expect(s.get('r1', 3000).name).toBe('Corvale');
    expect(s.get('r2', 3000).name).toBe('Brackwyn');
  });
});

describe('Extended Target pins the main assist\'s target', () => {
  const src = readSource(BOT_INDEX);
  const { _mainAssistPin } = evalBlock(sliceBlock(src, 'function _mainAssistPin(', '\n}\n'), ['_mainAssistPin']);
  const rows = () => [
    { name: 'a gnoll pup', kind: 'npc', raider_count: 5, spawn_id: 11 },
    { name: 'a gnoll scout', kind: 'npc', raider_count: 2, spawn_id: 12 },
    { name: 'a gnoll scout', kind: 'npc', raider_count: 1, spawn_id: 13 },
  ];
  const ma = { name: 'Brackwyn', declared_at: 1, by: 'Brackwyn', called_target: null };
  it('their own Mimic\'s target, by spawn id', () => {
    const t = rows();
    const out = _mainAssistPin(t, ma, [{ character: 'Brackwyn', target_name: 'a gnoll scout', target_id: 13 }]);
    expect(t.map(r => r.spawn_id)).toEqual([13, 11, 12]);
    expect(t[0].ma_target).toBe(true);
    expect(out).toMatchObject({ name: 'Brackwyn', target: 'a gnoll scout', target_source: 'mimic' });
  });
  it('the mob their macro named when they have no Mimic', () => {
    const t = rows();
    const out = _mainAssistPin(t, { ...ma, called_target: 'a gnoll scout' }, []);
    expect(t.map(r => r.spawn_id)).toEqual([12, 13, 11]);
    expect(out.target_source).toBe('called');
  });
  it('no declaration leaves the most-targeted first', () => {
    const t = rows();
    expect(_mainAssistPin(t, null, [])).toBeNull();
    expect(t.map(r => r.spawn_id)).toEqual([11, 12, 13]);
  });
  it('the chat handler notes raid-chat declarations; the response carries main_assist', () => {
    const code = stripJs(src);
    expect(code).toMatch(/if \(channel === 'raid' && \/\\b\(\?:ma\|main\\s\*assist\|assist\)\\b\/i\.test\(String\(text\)\)\) \{/);
    expect(code).toMatch(/_mainAssistStore\.note\(raid \? raid\.key : '_', decl, effectiveSpeaker, Date\.now\(\)\);/);
    expect(code).toMatch(/if \(mainAssist\) extOut\.main_assist = mainAssist;/);
  });
});
