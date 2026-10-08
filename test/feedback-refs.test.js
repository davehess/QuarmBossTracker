// test/feedback-refs.test.js — FB-<n> handles for bug and idea reports, moved on by commits.
//
// The guild lead, 2026-09-29: "We need to start having referenceable IDs for each bug or enhancement
// request so the bot can update these when they get implemented". Runs utils/feedbackRefs.js and the
// bot's real card-status line rewrite.
//
// Run: npx vitest run test/feedback-refs.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, BOT_INDEX, sliceBlock } from './_source-slice.js';

const require = createRequire(import.meta.url);
const fr = require('../utils/feedbackRefs.js');

describe('the handle', () => {
  it('FB-<n>, or nothing for a row without one', () => {
    expect(fr.tag(29)).toBe('FB-29');
    expect(fr.tag(null)).toBe('');
    expect(fr.tag(0)).toBe('');
  });
});

describe('which reports a commit closes', () => {
  it('a line that says fixes / implements / closes / resolves, every FB on it, once', () => {
    expect(fr.refsIn('agent v3.7.40 — bard recharm\n\nFixes FB-29, FB-30 and FB-29')).toEqual([29, 30]);
    expect(fr.refsIn('Implements: FB-31')).toEqual([31]);
    expect(fr.refsIn('resolved fb-12')).toEqual([12]);
  });

  it('a mention alone moves nothing — a docs note quoting a report must not mark it done', () => {
    expect(fr.refsIn('docs — FB-29 answered by §75; see FB-30')).toEqual([]);
    expect(fr.refsIn('Fixes the drag stutter\nSee FB-40 for the report')).toEqual([]);   // Different lines.
  });
});

describe('a report only moves forward', () => {
  it('beta → on beta, main → implemented', () => {
    expect(fr.advance('new', 'beta')).toBe('on_beta');
    expect(fr.advance('acked', 'main')).toBe('addressed');
    expect(fr.advance('on_beta', 'main')).toBe('addressed');
  });

  it('the main → beta sync can never knock an implemented report back', () => {
    expect(fr.advance('addressed', 'beta')).toBe(null);
    expect(fr.advance('on_beta', 'beta')).toBe(null);
    expect(fr.advance('addressed', 'main')).toBe(null);
  });

  it('a report closed as won\'t fix or duplicate stays closed', () => {
    expect(fr.advance('wont_fix', 'main')).toBe(null);
    expect(fr.advance('duplicate', 'beta')).toBe(null);
  });

  it('another branch does nothing', () => {
    expect(fr.advance('new', 'claude/something')).toBe(null);
  });
});

describe('what the card and the submitter see', () => {
  it('status lines carry the commit', () => {
    expect(fr.statusLine('on_beta', '63a0817cdeadbeef')).toBe('🧪 On beta (63a0817)');
    expect(fr.statusLine('addressed', '45be8088')).toBe('✅ Implemented (45be808)');
  });

  it('the row\'s note is the status line plus a short what-changed, one line', () => {
    expect(fr.statusNote('on_beta', '63a0817cdeadbeef', 'HUD keeps its size')).toBe('🧪 On beta (63a0817) — HUD keeps its size');
    expect(fr.statusNote('addressed', '45be8088', '')).toBe('✅ Implemented (45be808)');
    expect(fr.statusNote('on_beta', '63a0817c', '• one\n• two')).toBe('🧪 On beta (63a0817) — one; two');
    const long = fr.statusNote('addressed', '45be8088', 'word '.repeat(100));
    expect(long.length).toBeLessThanOrEqual('✅ Implemented (45be808) — '.length + 200);
    expect(long.endsWith('…')).toBe(true);
  });

  it('the beta sha the notes already carry', () => {
    expect(fr.betaShaFromNotes('2026-10-06 🧪 On beta (fec987c) — x\n2026-10-06 ✅ Implemented (fec987c)')).toBe('fec987c');
    expect(fr.betaShaFromNotes('🧪 On beta (aaaaaaa)\n🧪 On beta (bbbbbbb) — y')).toBe('bbbbbbb');
    expect(fr.betaShaFromNotes('✅ Implemented (fec987c)')).toBe('');
    expect(fr.betaShaFromNotes(null)).toBe('');
  });

  it('a Mimic card\'s first line swaps its status, the new 🧪 one included', () => {
    const bot = readSource(BOT_INDEX);
    // eslint-disable-next-line no-new-func
    const _feedbackStatusContent = new Function(sliceBlock(bot, 'function _feedbackStatusContent(content, status) {', '\n}') + '\nreturn _feedbackStatusContent;')();
    const card = '🐞 Bug FB-29 from **Nyssara** via mimic 2.7.5-beta.1 · 📬 Acknowledged by an officer\n>>> Charm pet tracker not working?';
    const beta = _feedbackStatusContent(card, fr.statusLine('on_beta', '63a0817c'));
    expect(beta.split('\n')[0]).toBe('🐞 Bug FB-29 from **Nyssara** via mimic 2.7.5-beta.1 · 🧪 On beta (63a0817)');
    const live = _feedbackStatusContent(beta, fr.statusLine('addressed', '45be8088'));
    expect(live.split('\n')[0]).toBe('🐞 Bug FB-29 from **Nyssara** via mimic 2.7.5-beta.1 · ✅ Implemented (45be808)');
    expect(live.split('\n')[1]).toBe('>>> Charm pet tracker not working?');
  });
});

// ── The DM (the guild lead, 2026-10-07: "This message to the submitter needs more details than this.") ──
const LINK = 'https://discord.com/channels/1/2/3';   // A Discord card link: officers only, so the DM must never carry it.
const PAGE = 'https://wolfpack.quest/feedback/FB-16';   // The member's own page for report 16.
const WAY_BACK = 'If it is not fixed for you, reply on that page.';
const SHA = 'c0ffee0123456789';
const commitOn = (subject, branch, body = '', sha = SHA) => ({ subject, body, branch, sha });
const dm = (over = {}) => fr.buildStatusDm({
  ref: 16, category: 'bug', message: 'when resize HUD window, it reverts', link: LINK, status: 'on_beta',
  commit: commitOn('mimic beta — the HUD keeps its size after a resize', 'beta'), ...over,
});
const quoteIn = (text) => /— "(.*)" —/.exec(text)[1];

// A batch close as this repo writes one: a hard-wrapped paragraph of "FB-n what changed." sentences
// (one with "FB-11 and FB-18" sharing a sentence) and a closing "Implements …" list line. Real shape of
// the 2026-10-07 stable-cut docs commit.
const BATCH_SUBJECT = 'web v1.8.112 — roadmap + docs: Mimic 2.7.9 stable, and member reports closed';
const BATCH_BODY = [
  '- Roadmap: a Mimic 2.7.9 entry crediting the members whose suggestions shipped.',
  '- DECISIONS §176: the cut, how credit was checked.',
  '',
  'Closing member reports whose fixes already reached everyone in earlier releases but were',
  'never marked done (each one checked in the code at v2.7.8 or on main; DECISIONS §176):',
  'FB-4 Instanced Lord of Ire kills post to #pvp (bot 3.0.117). FB-5 loot records for non-DKP',
  'kills (bot 3.0.219, Loot tab). FB-6 pet damage credited to one current owner (bot 3.0.239).',
  'FB-9 /who window fixed size with scrolling. FB-10 paste and screenshot in feedback. FB-11 and',
  'FB-18 charm break spoken the moment the line is read. FB-13 Tick overlay.',
  '',
  'Implements FB-4, FB-5, FB-6, FB-9, FB-10, FB-11, FB-13, FB-18',
].join('\n');

describe('the status DM — their own words', () => {
  it('opens with the kind, the number and the report, quoted, then the status', () => {
    expect(dm().split('\n')[0]).toBe('🧪 Your bug report FB-16 — "when resize HUD window, it reverts" — is fixed on the beta.');
  });

  it('bug → bug report, idea → idea, general (or nothing) → report', () => {
    expect(dm({ category: 'bug' })).toMatch(/^🧪 Your bug report FB-16/);
    expect(dm({ category: 'idea' })).toMatch(/^🧪 Your idea FB-16/);
    expect(dm({ category: 'general' })).toMatch(/^🧪 Your report FB-16/);
    expect(dm({ category: null })).toMatch(/^🧪 Your report FB-16/);
    expect(dm({ category: undefined })).toMatch(/^🧪 Your report FB-16/);
  });

  it('a long report is cut to ~160 characters on a whole word, with an ellipsis', () => {
    const q = quoteIn(dm({ message: 'when I resize the HUD window it reverts '.repeat(20) }));
    expect(q.length).toBeLessThanOrEqual(161);
    expect(q.length).toBeGreaterThan(100);
    expect(q.endsWith('reverts…')).toBe(true);
    expect(quoteIn(dm({ message: 'x'.repeat(400) }))).toBe('x'.repeat(160) + '…');   // No space to cut on.
  });

  it('a short report is quoted whole, on one line, and its own double quotes cannot close ours', () => {
    expect(quoteIn(dm({ message: 'two\n\n lines   and "quotes"' }))).toBe("two lines and 'quotes'");
    expect(quoteIn(dm({ message: 'x'.repeat(160) }))).toBe('x'.repeat(160));   // At the limit: no ellipsis.
  });

  it('markdown in the report cannot format the rest of the DM', () => {
    expect(quoteIn(dm({ message: 'the buff_casts row and *stars* and `code`' }))).toBe('the buff\\_casts row and \\*stars\\* and \\`code\\`');
  });

  it('a report with no text is still named', () => {
    expect(dm({ message: '' }).split('\n')[0]).toBe('🧪 Your bug report FB-16 is fixed on the beta.');
  });

  it('only 🧪 and ✅ statuses are announced', () => {
    expect(dm({ status: 'acked' })).toBe(null);
    expect(dm({ status: 'wont_fix' })).toBe(null);
  });
});

describe('the status DM — how to get it, per component and branch', () => {
  const MIMIC_BETA = 'It is in the Mimic beta now%s: on the Mimic dashboard click ⤴ beta (or tray → Check for beta) to switch channels. It reaches everyone on stable with the next stable release.';
  const cases = [
    ['mimic on beta, version in the prefix', 'mimic v2.7.10-beta.3 — HUD keeps its size', 'beta', MIMIC_BETA.replace('%s', ' (2.7.10-beta.3)')],
    ['mimic on beta, no version', 'mimic beta — HUD keeps its size', 'beta', MIMIC_BETA.replace('%s', '')],
    ['agent on beta (its version is not Mimic\'s)', 'agent v3.7.96 — HUD keeps its size', 'beta', MIMIC_BETA.replace('%s', '')],
    ['mimic on main', 'mimic v2.7.9 — stable: HUD keeps its size', 'main', 'It is in stable Mimic 2.7.9; Mimic updates itself on its next launch.'],
    ['mimic on main, no version', 'mimic — stable cut', 'main', 'It is in the stable Mimic release; Mimic updates itself on its next launch.'],
    ['mimic on main, a beta version is not printed as stable', 'mimic v2.7.10-beta.2 — x', 'main', 'It is in the stable Mimic release; Mimic updates itself on its next launch.'],
    ['agent on main (its version is not Mimic\'s)', 'agent v3.7.92 — HUD keeps its size', 'main', 'It is in the stable Mimic release; Mimic updates itself on its next launch.'],
    ['web on beta, page named in the subject', 'web v1.8.110 — /me/parses: search, zone picker', 'beta', 'See it at https://b.wolfpack.quest/me/parses — it reaches wolfpack.quest when it graduates.'],
    ['web on beta, no page named', 'web v1.8.110 — the roadmap reads better', 'beta', 'See it at https://b.wolfpack.quest/ — it reaches wolfpack.quest when it graduates.'],
    ['web on main, page named', 'web v1.8.109 — /db/npc: mob abilities flagged', 'main', 'It is live on https://wolfpack.quest/db/npc.'],
    ['web on main, no page named', 'web v1.8.109 — the roadmap reads better', 'main', 'It is live on https://wolfpack.quest/.'],
    ['web, an API route is not a page', 'web v1.0.1 — /api/agent/my-parses feeds /me/parses', 'main', 'It is live on https://wolfpack.quest/me/parses.'],
    ['bot on main', 'bot v3.1.214 — Mimic can set a character Main/alt', 'main', 'It is live in Discord now.'],
    ['bot on beta (it has none; main synced in)', 'bot v3.1.214 — Mimic can set a character Main/alt', 'beta', 'The bot has no beta, so this is already live in Discord.'],
    ['docs on beta', 'docs — §173 Reverse Slow', 'beta', 'It reaches everyone with the next stable release.'],
    ['docs on main', 'docs — §173 Reverse Slow', 'main', 'It is live now.'],
    ['no prefix on beta', 'Merge branch \'x\' into y', 'beta', 'It reaches everyone with the next stable release.'],
    ['no prefix on main', 'Merge branch \'x\' into y', 'main', 'It is live now.'],
    ['a web commit that says docs is bookkeeping, not the fix', 'web v1.8.111 — roadmap + docs: My parses explore', 'main', 'It is live now.'],
  ];
  it.each(cases)('%s', (_name, subject, branch, line) => {
    const out = dm({ status: branch === 'beta' ? 'on_beta' : 'addressed', commit: commitOn(subject, branch) });
    expect(out.split('\n\n')).toContain(line);
  });

  it('a line\'s own stamp beats the commit\'s prefix: a web/docs batch close names other components\' work', () => {
    const out = fr.buildStatusDm({
      ref: 4, category: 'general', message: 'Lord of Ire kills in #pvp', link: LINK, status: 'addressed',
      commit: commitOn(BATCH_SUBJECT, 'main', BATCH_BODY),
    });
    expect(out).toContain('It is live in Discord now.');
    expect(out).not.toContain('It is live on https://wolfpack.quest');   // The how-to names no page; the report link is separate.
    // …and a line with no stamp falls back to the prefix, which says docs: no page, no promise.
    const nine = fr.buildStatusDm({ ref: 9, category: 'bug', message: 'x', link: LINK, status: 'addressed', commit: commitOn(BATCH_SUBJECT, 'main', BATCH_BODY) });
    expect(nine).toContain('It is live now.');
  });

  it('the report page link and the way back close it, built from the number and never the Discord card', () => {
    const parts = dm().split('\n\n');
    expect(parts[parts.length - 2]).toBe(`Your report: ${PAGE}`);
    expect(parts[parts.length - 1]).toBe(WAY_BACK);
    expect(dm()).not.toContain(LINK);
    expect(dm()).not.toMatch(/Your card|discord\.com/);
    expect(dm({ link: null })).toContain(`Your report: ${PAGE}`);   // No card on record still gets the page.
    expect(dm({ ref: 4 })).toContain('Your report: https://wolfpack.quest/feedback/FB-4\n');
    expect(dm({ ref: null })).not.toMatch(/Your report/);   // No number, no page to point at.
  });

  it('the pieces come in order: their words, what changed, how to get it, the card, the way back', () => {
    const parts = dm().split('\n\n');
    expect(parts).toHaveLength(5);
    expect(parts[0]).toMatch(/^🧪 Your bug report FB-16/);
    expect(parts[1]).toBe('What changed: the HUD keeps its size after a resize');
    expect(parts[2]).toMatch(/^It is in the Mimic beta now/);
  });
});

describe('the status DM — what changed', () => {
  const NOTES = [
    'mimic v2.7.9 — stable: everything since 2.7.8',
    '',
    '<!--player-notes-->',
    'Thank you to everyone who sends a report.',
    '',
    '**New**',
    '- My parses: a new tab with your own DPS, fight by fight.',
    '- Reverse Slow: mobs that turn a slow into a haste get a red warning in Target Info. (suggested by a member, FB-54)',
    '- Lag meter on the Diagnostics tab.',
    '**Fixed**',
    '- The ✕ on timers should now take clicks while overlays are locked.',
    '<!--/player-notes-->',
    '',
    'Implements FB-54',
  ];
  const stable = { subject: NOTES[0], body: NOTES.slice(2).join('\n') };

  it('the player-notes block beats the body line and the subject', () => {
    const c = commitOn('mimic v2.7.9 — stable: subject words', 'main',
      '<!--player-notes-->\n- The HUD keeps its size after a resize.\n<!--/player-notes-->\n\nFixes FB-16: body line words');
    expect(fr.whatChanged(c, 16)).toBe('The HUD keeps its size after a resize.');
  });

  it('a long block is read for this report\'s own line, with the "(… FB-n)" label dropped', () => {
    expect(fr.whatChanged(stable, 54)).toBe('Reverse Slow: mobs that turn a slow into a haste get a red warning in Target Info.');
  });

  it('a long block that never names the report is the whole release, so it is skipped for the subject', () => {
    expect(fr.whatChanged(stable, 99)).toBe('stable: everything since 2.7.8');
  });

  it('a short block that names nothing is still the commit\'s own member-facing text', () => {
    const c = commitOn('agent v3.7.1 — x', 'beta', '<!--player-notes-->\n- The HUD keeps its size.\n- The ✕ works.\n<!--/player-notes-->');
    expect(fr.whatChanged(c, 16)).toBe('• The HUD keeps its size.\n• The ✕ works.');
  });

  it('several lines naming the report come through as bullets', () => {
    const c = commitOn('mimic v2.7.9 — stable', 'main', '<!--player-notes-->\n- First thing. (FB-7)\n- Other.\n- Other two.\n- Second thing. (FB-7, FB-8)\n<!--/player-notes-->');
    expect(fr.whatChanged(c, 7)).toBe('• First thing.\n• Second thing.');
  });

  it('without a block, the body line that names the report — minus the "Fixes FB-n" token', () => {
    expect(fr.whatChanged(commitOn('agent v3.7.1 — subject words', 'beta', 'Fixes FB-16: the HUD keeps its size after a resize'), 16))
      .toBe('the HUD keeps its size after a resize');
    expect(fr.whatChanged(commitOn('agent v3.7.1 — subject words', 'beta', 'Notes.\n\n- Implements FB-16 — the HUD keeps its size'), 16))
      .toBe('the HUD keeps its size');
  });

  it('a number at the end of the line takes the words before it', () => {
    expect(fr.whatChanged(commitOn('agent v3.7.1 — subject words', 'beta', '- The HUD keeps its size after a resize (FB-16)'), 16))
      .toBe('The HUD keeps its size after a resize');
    expect(fr.whatChanged(commitOn('agent v3.7.1 — subject words', 'beta', 'The HUD keeps its size. Fixes FB-16'), 16))
      .toBe('The HUD keeps its size.');
  });

  it('FB-1 is not FB-16', () => {
    const c = commitOn('agent v3.7.1 — subject words', 'beta', 'Fixes FB-16: sixteen words');
    expect(fr.whatChanged(c, 1)).toBe('subject words');
    expect(fr.whatChanged(c, 16)).toBe('sixteen words');
  });

  it('a body that only says "Fixes FB-n" leaves the subject, minus its prefix and its number', () => {
    expect(fr.whatChanged(commitOn('mimic v2.7.1 — HUD keeps its size (FB-16)', 'main', 'Fixes FB-16'), 16)).toBe('HUD keeps its size');
    expect(fr.whatChanged(commitOn('bot v3.1.209 · web v1.8.106 — /screen review fixes', 'main'), 16)).toBe('/screen review fixes');
    expect(fr.whatChanged(commitOn('agent v3.7.1 — Fixes FB-12, FB-13: the HUD keeps its size', 'beta'), 12)).toBe('the HUD keeps its size');
    expect(fr.whatChanged(commitOn('docs — §173 Reverse Slow', 'main'), 16)).toBe('§173 Reverse Slow');
    expect(fr.whatChanged(commitOn('mimic beta — HUD keeps its size', 'beta'), 16)).toBe('HUD keeps its size');
  });

  it('a merge commit\'s subject is git\'s, so the DM leaves "What changed" out rather than quote it', () => {
    expect(fr.whatChanged(commitOn('Merge branch \'x\' into y', 'main'), 16)).toBe('');
    expect(dm({ commit: commitOn('Merge branch \'x\' into y', 'beta') })).not.toMatch(/What changed/);
    expect(fr.whatChanged(commitOn('Merge branch \'x\' into y', 'main', 'Fixes FB-16: the HUD keeps its size'), 16)).toBe('the HUD keeps its size');
  });

  it('a batch close: each report gets its own sentence, not the subject and not its neighbours\'', () => {
    const c = commitOn(BATCH_SUBJECT, 'main', BATCH_BODY);
    expect(fr.whatChanged(c, 4)).toBe('Instanced Lord of Ire kills post to #pvp.');            // Version stamp dropped.
    expect(fr.whatChanged(c, 5)).toBe('loot records for non-DKP kills (Loot tab).');           // Stamp's extra words kept.
    expect(fr.whatChanged(c, 9)).toBe('/who window fixed size with scrolling.');
    expect(fr.whatChanged(c, 10)).toBe('paste and screenshot in feedback.');
    expect(fr.whatChanged(c, 13)).toBe('Tick overlay.');
    // "FB-11 and FB-18 charm break…" is one list sharing the sentence after it.
    expect(fr.whatChanged(c, 11)).toBe('charm break spoken the moment the line is read.');
    expect(fr.whatChanged(c, 18)).toBe('charm break spoken the moment the line is read.');
    // Named only in the closing list: nothing of its own, so the subject.
    expect(fr.whatChanged(c, 6)).toBe('pet damage credited to one current owner.');
    expect(fr.whatChanged(commitOn(BATCH_SUBJECT, 'main', 'Implements FB-6, FB-7'), 7)).toBe('roadmap + docs: Mimic 2.7.9 stable, and member reports closed');
  });

  it('the DM prints it as "What changed:"', () => {
    const out = fr.buildStatusDm({ ref: 54, category: 'bug', message: 'x', link: LINK, status: 'addressed', commit: { ...stable, branch: 'main', sha: SHA } });
    expect(out).toContain('What changed: Reverse Slow: mobs that turn a slow into a haste get a red warning in Target Info.');
    const multi = fr.buildStatusDm({ ref: 7, category: 'bug', message: 'x', link: LINK, status: 'addressed',
      commit: commitOn('mimic v2.7.9 — stable', 'main', '<!--player-notes-->\n- One. (FB-7)\n- Two. (FB-7)\n<!--/player-notes-->') });
    expect(multi).toContain('What changed:\n• One.\n• Two.\n\n');
  });
});

describe('the status DM — a ✅ after the 🧪', () => {
  const beta = commitOn('mimic v2.7.10-beta.2 — the HUD keeps its size after a resize', 'beta', '', 'aaaaaaa1111');
  const main = commitOn('mimic v2.7.10 — stable: the HUD keeps its size after a resize', 'main', 'Implements FB-16: the HUD keeps its size', 'bbbbbbb2222');

  it('the 🧪 DM says what changed and how to switch to the beta', () => {
    const out = dm({ commit: beta });
    expect(out).toContain('What changed: the HUD keeps its size after a resize');
    expect(out).toContain('click ⤴ beta');
  });

  it('keeps the quote and the how-to line, says it is now stable, and does not repeat the same commit', () => {
    const out = dm({ status: 'addressed', prevStatus: 'on_beta', betaSha: 'aaaaaaa', commit: { ...beta, branch: 'main' } });
    expect(out.split('\n')[0]).toBe('✅ Your bug report FB-16 — "when resize HUD window, it reverts" — is now in the stable release.');
    expect(out).not.toMatch(/What changed/);
    expect(out).toContain('It is in the stable Mimic release; Mimic updates itself on its next launch.');   // Its "-beta.2" is not stable's.
    expect(out).toContain(`Your report: ${PAGE}`);
  });

  it('…but says it when the main commit is a different one', () => {
    const out = dm({ status: 'addressed', prevStatus: 'on_beta', betaSha: 'aaaaaaa', commit: main });
    expect(out).toContain('What changed: the HUD keeps its size');
    expect(out.split('\n')[0]).toMatch(/is now in the stable release\.$/);
  });

  it('a report that skipped the beta DM is told it is fixed, not "now"', () => {
    expect(dm({ status: 'addressed', prevStatus: 'acked', commit: main }).split('\n')[0]).toMatch(/is fixed and in the stable release\.$/);
    expect(dm({ status: 'addressed', prevStatus: 'new', commit: commitOn('bot v3.1.1 — x', 'main') }).split('\n')[0]).toMatch(/is fixed and live\.$/);
    expect(dm({ status: 'addressed', prevStatus: 'on_beta', commit: commitOn('bot v3.1.1 — x', 'main') }).split('\n')[0]).toMatch(/is now live\.$/);
  });

  it('an unknown beta sha cannot suppress it', () => {
    expect(dm({ status: 'addressed', prevStatus: 'on_beta', betaSha: '', commit: main })).toContain('What changed');
  });
});

describe('the status DM — length', () => {
  const hugeLine = 'Fixes FB-16: ' + 'the HUD keeps its size after a resize and then some more words '.repeat(80);

  it('a huge what-changed is cut, and the report link and the way back survive', () => {
    const out = dm({ commit: commitOn('mimic v2.7.1 — x', 'beta', hugeLine) });
    expect(out.length).toBeLessThanOrEqual(1900);
    const changed = out.split('\n\n')[1];
    expect(changed.startsWith('What changed: the HUD keeps its size')).toBe(true);
    expect(changed.endsWith('…')).toBe(true);
    expect(changed.length).toBeLessThanOrEqual(720);
    expect(out).toContain(`Your report: ${PAGE}`);
    expect(out.endsWith(WAY_BACK)).toBe(true);
  });

  it('a long player-notes block drops whole bullets and ends on an ellipsis line', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `- Bullet number ${i} about the HUD that keeps its size after a resize. (FB-16)`);
    const out = dm({ commit: commitOn('mimic v2.7.1 — x', 'beta', `<!--player-notes-->\n${lines.join('\n')}\n<!--/player-notes-->`) });
    const changed = out.split('\n\n')[1];
    expect(changed.split('\n')[0]).toBe('What changed:');
    expect(changed.endsWith('\n…')).toBe(true);
    expect(changed.split('\n').every((l) => l === '…' || l === 'What changed:' || /^• Bullet number \d+ about the HUD that keeps its size after a resize\.$/.test(l))).toBe(true);
    expect(out.length).toBeLessThanOrEqual(1900);
  });

  it('a very long message is quoted short; the rest of the DM is never the part that is cut', () => {
    const out = dm({ message: 'word '.repeat(2000), commit: commitOn('mimic v2.7.1 — x', 'beta', hugeLine) });
    expect(out.length).toBeLessThanOrEqual(1900);
    expect(out).toContain('What changed: the HUD keeps its size');
    expect(out.endsWith(WAY_BACK)).toBe(true);
    expect(quoteIn(out).length).toBeLessThanOrEqual(161);
  });

  it('a card link passed in, however long, neither appears nor eats the room', () => {
    const long = 'https://discord.com/channels/1/2/' + '3'.repeat(3000);
    const out = dm({ link: long, commit: commitOn('mimic v2.7.1 — x', 'beta', hugeLine) });
    expect(out).toBe(dm({ link: null, commit: commitOn('mimic v2.7.1 — x', 'beta', hugeLine) }));
    expect(out).not.toContain('discord.com');
    expect(out.length).toBeLessThanOrEqual(1900);
  });
});

// The scanner end to end, on the real functions: a beta commit then a main commit that close one report.
describe('the scanner passes the commit through to the DM', () => {
  function rig() {
    const bot = readSource(BOT_INDEX);
    const block = sliceBlock(bot, 'async function _feedbackAdvance(', '\nasync function _feedbackCommitWatch(').slice(0, -'\nasync function _feedbackCommitWatch('.length)
      + '\n' + sliceBlock(bot, 'async function _feedbackCommitWatch(', '\n}\n');
    const row = { id: 'row-1', ref: 16, status: 'acked', category: 'bug', message: 'when resize HUD window, it reverts', discord_msg_link: LINK,
      submitter_discord_id: 'u1', discord_msg_id: null, notes: null };
    const log = { dms: [], updates: [] };
    const supabase = {
      isEnabled: () => true,
      select: async (table) => (table === 'feedback' ? [{ ...row }] : []),   // A fresh read, as the database gives.
      update: async (table, filter, patch) => { log.updates.push(patch); Object.assign(row, patch); },
      upsert: async () => {},
    };
    const commits = {
      beta: [{ sha: 'aaaaaaa1111', commit: { message: 'mimic beta — the HUD keeps its size after a resize\n\nFixes FB-16' } }],
      main: [{ sha: 'bbbbbbb2222', commit: { message: 'mimic v2.7.10 — stable: the HUD keeps its size\n\nImplements FB-16: the HUD keeps its size after a resize' } }],
    };
    const fakes = { './utils/supabase': supabase, './utils/feedbackRefs': fr };
    const client = { users: { fetch: async () => ({ send: async (o) => { log.dms.push(o); } }) } };
    // eslint-disable-next-line no-new-func
    const run = new Function('require', 'MessageFlags', 'process', '_githubJson', '_EB2', '_feedbackStatusContent',
      block + '\nreturn _feedbackCommitWatch;')(
      (m) => fakes[m], { SuppressEmbeds: 4 }, { env: {} },
      async (p) => commits[/sha=(\w+)/.exec(p)[1]], class {}, (c) => c);
    return { run, client, log, row };
  }

  it('🧪 for the beta commit, then ✅ for the main one, each saying what changed and how to get it', async () => {
    const { run, client, log, row } = rig();
    await run(client);
    expect(log.dms).toHaveLength(2);
    const [first, second] = log.dms;
    expect(first.flags).toBe(4);   // Links in the DM do not unfurl.
    expect(first.content.split('\n')[0]).toBe('🧪 Your bug report FB-16 — "when resize HUD window, it reverts" — is fixed on the beta.');
    expect(first.content).toContain('What changed: the HUD keeps its size after a resize');
    expect(first.content).toContain('click ⤴ beta');
    expect(second.content.split('\n')[0]).toBe('✅ Your bug report FB-16 — "when resize HUD window, it reverts" — is now in the stable release.');
    expect(second.content).toContain('It is in stable Mimic 2.7.10; Mimic updates itself on its next launch.');
    expect(second.content).toContain(`Your report: ${PAGE}`);
    expect(second.content).not.toContain(LINK);
    // The row's notes keep one line per move, with the same what-changed text.
    const notes = row.notes.split('\n');
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatch(/^\d{4}-\d\d-\d\d 🧪 On beta \(aaaaaaa\) — the HUD keeps its size after a resize$/);
    expect(notes[1]).toMatch(/^\d{4}-\d\d-\d\d ✅ Implemented \(bbbbbbb\) — the HUD keeps its size after a resize$/);
  });
});

// What the scanner reads as new (the guild lead, 2026-10-07: reports with "Fixes FB-n" on beta stayed acked).
// A feature is built on a side branch and merged later, so its commit is OLDER by date than a beta tip the
// scanner already recorded. The date-ordered list stops at that tip and never reaches it; the compare API
// is reachability, so it does. Runs the real _feedbackFreshCommits + _feedbackCommitWatch + _feedbackAdvance
// against a stub GitHub that answers by path and records every path asked.
describe('the scanner reads what is new since its last look, not the newest 40 by date', () => {
  const msg = (ref) => `bot v3.1.1 — fix\n\nFixes FB-${ref}`;
  const commit = (sha, ref) => ({ sha, commit: { message: ref ? msg(ref) : `docs — ${sha}` } });

  // `github(path)` answers the stub; `seen` is the bot_kv value per branch; refs are the open reports.
  function rig({ seen = {}, github, refs = [58, 59, 60, 61] }) {
    const bot = readSource(BOT_INDEX);
    const block = sliceBlock(bot, 'async function _feedbackAdvance(', '\nasync function _feedbackCommitWatch(').slice(0, -'\nasync function _feedbackCommitWatch('.length)
      + '\n' + sliceBlock(bot, 'async function _feedbackCommitWatch(', '\n}\n');
    const rows = {};
    for (const r of refs) rows[r] = { id: `row-${r}`, ref: r, status: 'acked', category: 'bug', message: 'x', discord_msg_link: LINK,
      submitter_discord_id: null, discord_msg_id: null, notes: null };
    const paths = [];
    const stored = {};   // branch -> sha written back to bot_kv
    const supabase = {
      isEnabled: () => true,
      select: async (table, filter) => {
        if (table === 'feedback') { const r = rows[/ref=eq\.(\d+)/.exec(filter)[1]]; return r ? [{ ...r }] : []; }
        const branch = /key=eq\.fb_commit_seen_(\w+)/.exec(filter)[1];
        return seen[branch] ? [{ value: { sha: seen[branch] } }] : [];
      },
      update: async (table, filter, patch) => { Object.assign(rows[/id=eq\.row-(\d+)/.exec(filter)[1]], patch); },
      upsert: async (table, list) => { stored[/fb_commit_seen_(\w+)/.exec(list[0].key)[1]] = list[0].value.sha; },
    };
    const fakes = { './utils/supabase': supabase, './utils/feedbackRefs': fr };
    // eslint-disable-next-line no-new-func
    const run = new Function('require', 'MessageFlags', 'process', '_githubJson', '_EB2', '_feedbackStatusContent',
      block + '\nreturn _feedbackCommitWatch;')(
      (m) => fakes[m], { SuppressEmbeds: 4 }, { env: {} },
      async (p) => { paths.push(p); return github(p); }, class {}, (c) => c);
    const status = () => Object.fromEntries(Object.entries(rows).map(([r, row]) => [r, row.status]));
    return { run: () => run({}), paths, stored, status };
  }
  const isCompare = (p) => p.includes('/compare/');
  const isList = (p) => p.includes('/commits?sha=');

  it('a side-branch commit older than the recorded tip still moves its report', async () => {
    // By date the list is tip, the sha already seen, THEN the side commit (authored before it was recorded).
    const dateOrdered = [commit('merge1', null), commit('seenB', null), commit('side1', 58)];
    const { run, paths, stored, status } = rig({
      seen: { beta: 'seenB', main: 'seenM' },
      github: (p) => {
        if (p === '/repos/davehess/QuarmBossTracker/compare/seenB...beta?per_page=100&page=1') return { commits: [commit('side1', 58), commit('merge1', null)] };
        if (p.includes('/compare/seenM...main')) return { commits: [] };
        if (isList(p)) return dateOrdered;   // What the old walk would have read.
        return null;
      },
    });
    await run();
    expect(status()[58]).toBe('on_beta');
    expect(paths.some(isList)).toBe(false);
    expect(stored.beta).toBe('merge1');   // The branch head, i.e. the last commit compare listed.
  });

  it('a report closed on beta and then on main in one pass ends implemented', async () => {
    const { run, status } = rig({
      seen: { beta: 'seenB', main: 'seenM' },
      github: (p) => {
        if (p.includes('/compare/seenB...beta')) return { commits: [commit('b1', 59)] };
        if (p.includes('/compare/seenM...main')) return { commits: [commit('m1', 59)] };
        return null;
      },
    });
    await run();
    expect(status()[59]).toBe('addressed');   // Beta first, then main, same pass.
  });

  it('nothing new: no report moves and the recorded sha is left alone', async () => {
    const { run, stored, status } = rig({
      seen: { beta: 'seenB', main: 'seenM' },
      github: (p) => (isCompare(p) ? { commits: [] } : null),
    });
    await run();
    expect(Object.values(status()).every((s) => s === 'acked')).toBe(true);
    expect(stored).toEqual({});
  });

  it('a long stretch is read in pages of 100, three at most, and the last commit read is remembered', async () => {
    const page = (n) => Array.from({ length: 100 }, (_, i) => commit(`p${n}-${i}`, null));
    const { run, paths, stored } = rig({
      seen: { beta: 'seenB' },
      github: (p) => {
        const m = /compare\/seenB\.\.\.beta\?per_page=100&page=(\d)/.exec(p);
        return m ? { commits: page(Number(m[1])) } : { commits: [] };
      },
    });
    await run();
    const betaPaths = paths.filter((p) => p.includes('...beta'));
    expect(betaPaths).toHaveLength(3);   // A third full page does not ask for a fourth.
    expect(betaPaths[2]).toContain('page=3');
    expect(stored.beta).toBe('p3-99');
  });

  it('a short page ends the read', async () => {
    const full = Array.from({ length: 100 }, (_, i) => commit(`a${i}`, null));
    const { run, paths, stored, status } = rig({
      seen: { beta: 'seenB' },
      github: (p) => {
        if (p.includes('/compare/seenB...beta') && p.endsWith('page=1')) return { commits: full };
        if (p.includes('/compare/seenB...beta') && p.endsWith('page=2')) return { commits: [commit('z0', 60)] };
        return { commits: [] };
      },
    });
    await run();
    expect(paths.filter((p) => p.includes('...beta'))).toHaveLength(2);
    expect(stored.beta).toBe('z0');
    expect(status()[60]).toBe('on_beta');
  });

  it('a compare that cannot be answered (the sha is gone after a reset) falls back to the date walk', async () => {
    const { run, paths, stored, status } = rig({
      seen: { beta: 'goneB' },
      github: (p) => {
        if (isCompare(p)) return null;   // 404 / 422
        if (p.includes('sha=beta')) return [commit('tip1', 60), commit('goneB', null), commit('older1', 61)];
        return [];
      },
    });
    await run();
    expect(paths.some(isCompare)).toBe(true);
    expect(status()[60]).toBe('on_beta');    // Newer than the recorded sha.
    expect(status()[61]).toBe('acked');      // Past it: the walk stops there, as before.
    expect(stored.beta).toBe('tip1');
  });

  it('a first look (nothing recorded) walks the newest 40 and never asks compare', async () => {
    const { run, paths, stored, status } = rig({
      seen: {},
      github: (p) => (isList(p) && p.includes('per_page=40') && p.includes('sha=beta') ? [commit('tip1', 60), commit('older1', 61)] : []),
    });
    await run();
    expect(paths.some(isCompare)).toBe(false);
    expect(status()[60]).toBe('on_beta');
    expect(status()[61]).toBe('on_beta');
    expect(stored.beta).toBe('tip1');
  });
});
