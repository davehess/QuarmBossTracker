// test/source-slice-strippers.test.js — the comment strippers themselves.
//
// CLAUDE.md's rule is "strip comments before any text assertion", and roughly
// forty test files now do. That makes stripJs shared infrastructure: if it is
// wrong, it is wrong everywhere at once, and in the SILENT direction — a
// `not.toMatch` over code the stripper deleted passes for free.
//
// It was wrong (found 2026-08-30). Block comments were stripped BEFORE line
// comments, so a `/*` living inside a line comment opened a real block comment
// that ran to the next `*/` anywhere in the file. index.js has two:
//
//   // See supabase/migrations/*_target_observations.sql for the why.
//   // ... raid detail, and auctions all live under /clients/{name}/*
//
// Between them they swallowed 1,652 lines — 66,804 characters of real code,
// 6.7% of the bot — including the whole button-routing table. Nothing failed,
// because the assertions over that range were all positive ones nobody had
// written yet; the next `not.toMatch` there would have passed vacuously.
//
// Run: npx vitest run test/source-slice-strippers.test.js

import { describe, it, expect } from 'vitest';
import { readSource, BOT_INDEX, AGENT_INDEX, stripJs, stripSql, stripCss } from './_source-slice.js';

describe('stripJs removes comments', () => {
  it('drops whole-line // comments', () => {
    expect(stripJs('// gone\nconst a = 1;\n')).not.toContain('gone');
    expect(stripJs('// gone\nconst a = 1;\n')).toContain('const a = 1;');
  });

  it('drops an inline /* … */', () => {
    expect(stripJs('try { x(); } catch { /* fail open */ }')).not.toContain('fail open');
  });

  it('drops a block comment that owns its lines', () => {
    const src = 'const a = 1;\n/*\n * a note\n */\nconst b = 2;\n';
    const out = stripJs(src);
    expect(out).not.toContain('a note');
    expect(out).toContain('const a = 1;');
    expect(out).toContain('const b = 2;');
  });

  it('leaves a trailing // comment alone — whole-line only, by design', () => {
    // A //-anywhere strip eats the // in an https:// URL inside a string.
    expect(stripJs("const u = 'https://wolfpack.quest';")).toContain('https://wolfpack.quest');
  });
});

describe('stripJs cannot run away', () => {
  // ⚠ The exact two shapes that were live in index.js.
  it('a glob inside a line comment does not open a block comment', () => {
    const src = '// See supabase/migrations/*_target_observations.sql for the why.\n'
              + 'const KEEP_ME = 1;\n'
              + 'const other = 2; /* real inline */\n'
              + 'const ALSO_KEEP = 3;\n';
    const out = stripJs(src);
    expect(out).toContain('KEEP_ME');
    expect(out).toContain('ALSO_KEEP');
    expect(out).not.toContain('real inline');
  });

  it('a path ending in /* inside a line comment does not either', () => {
    const src = '  // auctions all live under /clients/{name}/*\n'
              + '  const ROUTES = 1;\n'
              + '  catch { /* stale-expiry covered */ }\n'
              + '  const AFTER = 2;\n';
    const out = stripJs(src);
    expect(out).toContain('ROUTES');
    expect(out).toContain('AFTER');
  });

  it('a /* inside a string literal does not swallow the rest of the file', () => {
    const src = "const glob = 'src/**/*.js';\nconst KEEP = 1;\nx(); /* note */\nconst KEEP2 = 2;\n";
    const out = stripJs(src);
    expect(out).toContain('KEEP');
    expect(out).toContain('KEEP2');
  });

  it('never deletes more than the comments in the real bot source', () => {
    // The runaway removed 6.7% of index.js as CODE. A stripper that is only
    // removing comments leaves every top-level function declaration behind.
    const src = readSource(BOT_INDEX);
    const clean = stripJs(src);
    const decls = (src.match(/^(?:async )?function [A-Za-z_$][\w$]*\(/gm) || []);
    const kept  = (clean.match(/^(?:async )?function [A-Za-z_$][\w$]*\(/gm) || []);
    expect(decls.length).toBeGreaterThan(200);      // corpus is real, not tiny
    expect(kept.length).toBe(decls.length);
  });

  it('...and the same for the agent', () => {
    const src = readSource(AGENT_INDEX);
    const decls = (src.match(/^(?:async )?function [A-Za-z_$][\w$]*\(/gm) || []);
    const kept  = (stripJs(src).match(/^(?:async )?function [A-Za-z_$][\w$]*\(/gm) || []);
    expect(decls.length).toBeGreaterThan(200);
    expect(kept.length).toBe(decls.length);
  });

  it('keeps the button-routing table, which the runaway ate whole', () => {
    const clean = stripJs(readSource(BOT_INDEX));
    expect(clean).toContain("customId.startsWith('kill:')");
    expect(clean).toContain("customId.startsWith('raid_end:')");
  });
});

describe('the other two strippers', () => {
  it('stripSql drops -- lines and keeps the statement', () => {
    expect(stripSql('-- why\nCREATE TABLE t (id int);\n')).not.toContain('why');
    expect(stripSql('-- why\nCREATE TABLE t (id int);\n')).toContain('CREATE TABLE');
  });

  it('stripCss drops /* … */ and keeps the rule', () => {
    expect(stripCss('/* note */\n.a { color: red }')).not.toContain('note');
    expect(stripCss('/* note */\n.a { color: red }')).toContain('color: red');
  });
});
