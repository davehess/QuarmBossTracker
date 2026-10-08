// Two small web rules from the guild lead, 2026-10-08.
//
//  1. /admin/feedback "Addressed by" shows the officer's Discord name, never their sign-in email
//     ("Don't use email in here for 'Addressed by'"). The server action reads the name from
//     wolfpack_members (nickname, then global_name) and does not touch `.email`.
//  2. /parses opens on the last week (FB-59: "defaults to 60 days instead of 7 days, and lags out").
//     `?w=60d` still gives the old window.
//
// Text assertions over source, comments stripped (a comment quoting "email" or "60d" must not decide it).
//
// Run: npx vitest run test/admin-feedback-actor-and-parses-default.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { ROOT, readSource, stripJs } from './_source-slice.js';

const feedbackPage = stripJs(readSource(path.join(ROOT, 'web', 'app', 'admin', 'feedback', 'page.tsx')));
const parsesPage   = stripJs(readSource(path.join(ROOT, 'web', 'app', 'parses', 'page.tsx')));

describe('/admin/feedback names the officer by Discord name, not email', () => {
  it('reads the name from wolfpack_members', () => {
    expect(feedbackPage).toMatch(/\.from\('wolfpack_members'\)\s*\.select\('nickname, global_name'\)/);
    expect(feedbackPage).toMatch(/member\?\.nickname \|\| member\?\.global_name/);
  });
  it('never writes the sign-in email into acked_by / addressed_by', () => {
    expect(feedbackPage).not.toMatch(/\.email/);
  });
});

describe('a Mimic report is stamped with the sender\'s Discord name, not the character they had up', () => {
  const bot = stripJs(readSource(path.join(ROOT, 'index.js')));
  const handler = bot.slice(bot.indexOf('async function _handleAgentFeedback'), bot.indexOf('async function _handleAgentFeedback') + 3500);
  it('looks the name up from wolfpack_members by Discord id, character as the fallback', () => {
    expect(handler).toMatch(/let submitterName = p\?\.character/);
    expect(handler).toMatch(/supabase\.select\('wolfpack_members'/);
    expect(handler).toMatch(/submitter_name:\s+submitterName/);
  });
});

describe('/parses defaults to a week', () => {
  it('resolves the window with 7d as the fallback', () => {
    // Either spelled inline (main) or through the named constant (beta, whose page carries the parallel-reads rewrite).
    const inline = /resolveWindow\(wParam, '7d'\)/.test(parsesPage);
    const named = /const DEFAULT_WINDOW = '7d'/.test(parsesPage) && /resolveWindow\(wParam, DEFAULT_WINDOW\)/.test(parsesPage);
    expect(inline || named).toBe(true);
    expect(parsesPage).not.toMatch(/resolveWindow\(wParam, '60d'\)/);
  });
  it('still offers 60d in the picker', () => {
    expect(parsesPage).toMatch(/options=\{\['7d', '30d', '60d'/);
  });
});
