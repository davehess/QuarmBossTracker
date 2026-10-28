// Unit tests for scripts/guild-scope-audit.js on small fixtures (the ratchet's eyes must be right).
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { scanSource, stripComments, fingerprint } = require('../scripts/guild-scope-audit.js');

const T = new Set(['encounters', 'characters', 'bot_kv']);
const scan = (src) => scanSource(src, T).map((c) => ({ table: c.table, scoped: c.scoped, line: c.line }));

describe('guild-scope scanner', () => {
  it('helper: unscoped vs scoped query strings', () => {
    expect(scan("await supabase.select('encounters', 'select=id&limit=5');")).toEqual([{ table: 'encounters', scoped: false, line: 1 }]);
    expect(scan("await supabase.select('encounters', `guild_id=eq.${encodeURIComponent(guildId)}&limit=5`);")[0].scoped).toBe(true);
    expect(scan("await supabase.update('characters', `guild_id=eq.${x}&name=eq.a`, { a: 1 });")[0].scoped).toBe(true);
  });

  it('helper: a guild_id in a row object scopes an insert/upsert', () => {
    expect(scan("await supabase.insert('encounters', [{ guild_id: gid(), a: 1 }]);")[0].scoped).toBe(true);
    expect(scan("await supabase.upsert('characters', rows, 'name');")[0].scoped).toBe(false);
    expect(scan("await supabase.insertIgnoreDuplicates('encounters', [{ a: 1 }]);")[0]).toMatchObject({ table: 'encounters', scoped: false });
  });

  it('multi-line calls are judged on their own expression, not nearby lines', () => {
    const src = [
      "const a = await supabase.select(",
      "  'encounters',",
      "  `select=id` +",
      "  `&limit=1`",
      ");",
      "const g = `guild_id=eq.nearby`;",
      "const b = await supabase.select('bot_kv', `guild_id=eq.${supabase.guildId()}&key=eq.k`);",
    ].join('\n');
    expect(scan(src)).toEqual([
      { table: 'encounters', scoped: false, line: 1 },
      { table: 'bot_kv', scoped: true, line: 7 },
    ]);
  });

  it('template strings with nested ${} and parens do not break extraction', () => {
    const src = "await supabase.select('encounters', `id=in.(${ids.map((i) => `${i}`).join(',')})&guild_id=eq.${g()}`);\nawait supabase.select('characters', `x=${f(')')}`);";
    expect(scan(src).map((c) => c.scoped)).toEqual([true, false]);
  });

  it('one-level identifier lookup: a query built in a const is read', () => {
    expect(scan("const q = `guild_id=eq.${g}&a=1`;\nawait supabase.select('encounters', q);")[0].scoped).toBe(true);
    expect(scan("const q = `a=1`;\nawait supabase.select('encounters', q);")[0].scoped).toBe(false);
  });

  it('one-level lookup of a same-file helper function', () => {
    const src = "function kvq(s) { return `guild_id=eq.${s.guildId()}`; }\nawait supabase.select('bot_kv', `${kvq(supabase)}&limit=1`);";
    expect(scan(src)[0].scoped).toBe(true);
  });

  it('supabase-js chains: the whole chain, across lines', () => {
    const un = "const { data } = await sb\n  .from('encounters')\n  .select('id')\n  .eq('id', 4)\n  .limit(1);";
    expect(scan(un)).toEqual([{ table: 'encounters', scoped: false, line: 2 }]);
    const ok = "await sb.from('encounters')\n  .select('id')\n  .eq('guild_id', GUILD_TAG)\n  .limit(1);";
    expect(scan(ok)[0].scoped).toBe(true);
    expect(scan("await admin.from('characters').insert({ guild_id: GUILD_TAG, name: 'a' });")[0].scoped).toBe(true);
    expect(scan("await admin.from('characters').insert(rows);")[0].scoped).toBe(false);
    expect(scan("const rows = [{ guild_id: GUILD_TAG }];\nawait admin.from('characters').insert(rows);")[0].scoped).toBe(true);
  });

  it('a chain stops at the end of the statement (a later .eq(guild_id) does not leak backward)', () => {
    const src = "await sb.from('encounters').select('id');\nawait sb.from('characters').select('n').eq('guild_id', GUILD_TAG);";
    expect(scan(src).map((c) => c.scoped)).toEqual([false, true]);
  });

  it('ignores non-guild tables, rpc, dynamic tables and non-call lookalikes', () => {
    expect(scan("await supabase.select('eqemu_items', 'a=1');")).toEqual([]);
    expect(scan("await supabase.rpc('find_or_create_encounter', { p: 1 });")).toEqual([]);
    expect(scan("await supabase.select(table, 'a=1');")).toEqual([]);
    expect(scan("await sb.from('eqemu_zone').select('*');")).toEqual([]);
    expect(scan("const s = 'encounters'; foo.bar('encounters');")).toEqual([]);
  });

  it('comments never satisfy the scope check, and https:// in a string survives', () => {
    const src = "await supabase.select('encounters', 'a=1'); // guild_id=eq.x\n/* guild_id */ await sb.from('characters').select('n'); // .eq('guild_id', G)";
    expect(scan(src).map((c) => c.scoped)).toEqual([false, false]);
    expect(stripComments("const u = 'https://x.y/z'; // gone\nlet r = /'/; const t = `a//b${1}`; // end")).toBe("const u = 'https://x.y/z';        \nlet r = /'/; const t = `a//b${1}`;       ");
    // a comment between the args does not scope the call
    expect(scan("await supabase.select('encounters', /* guild_id=eq.1 */ 'a=1');")[0].scoped).toBe(false);
  });

  it('fingerprint ignores whitespace but not content', () => {
    expect(fingerprint("a(  'x',\n 'y' )")).toBe(fingerprint("a( 'x', 'y' )"));
    expect(fingerprint("a('x','y')")).not.toBe(fingerprint("a('x','z')"));
  });
});
