// An opt-in log parse posts ONE note in the PvP channel, never one per old kill or assist
// (the guild lead, 2026-09-27: "when parsing through old logs make sure we're not posting in the
// channels for it each time. we can put in a note in pvp that the @user's opt-in log parse found
// N new pvp kills and assists and total them out per guildie").
//
// Run: npx vitest run test/optin-pvp-summary.test.js

import { describe, it, expect } from 'vitest';
import { readSource, BOT_INDEX, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const bot = readSource(BOT_INDEX);
const { _optinPvpSummaryText } = evalBlock(
  sliceBlock(bot, 'const _OPTIN_SUMMARY_SETTLE_MS = 90_000;', "\n    + lines.join('\\n');\n}"),
  ['_optinPvpSummaryText']);
const { _recentPvpAssistPost } = evalBlock(
  'const PVP_SAME_MS = 30_000;\n'
  + sliceBlock(bot, 'const _recentPvpAssistPosts = new Map();', '\n  return false;\n}'),
  ['_recentPvpAssistPost']);

// Invented names (none of them is anybody).
const k = (killer, iso) => ({ killer, killed_at: iso });
const a = (assister, iso) => ({ assister, killed_at: iso });

describe('the summary note', () => {
  it('names the uploader, counts both, spans the dates, and totals per guildie, busiest first', () => {
    const text = _optinPvpSummaryText('123456789012345678',
      [k('Brackwyn', '2025-03-20T23:00:00Z'), k('Brackwyn', '2026-09-26T05:20:00Z'), k('Rethlan', '2026-09-26T06:00:00Z')],
      [a('Rethlan', '2026-09-26T06:00:00Z'), a('Corvale', '2026-09-26T06:01:00Z'), a('Brackwyn', '2026-09-26T06:02:00Z')]);
    expect(text).toBe(
      "📜 <@123456789012345678>'s opt-in log parse found **3 new PvP kills** and **3 new assists** (Mar 20, 2025 – Sep 26, 2026).\n"
      + '• **Brackwyn** — 2 kills · 1 assist\n'
      + '• **Rethlan** — 1 kill · 1 assist\n'
      + '• **Corvale** — 1 assist');
  });
  it('busiest first whatever order the rows arrive in; a tie goes alphabetical', () => {
    const text = _optinPvpSummaryText('1', [k('Rethlan', '2026-09-26T05:20:00Z')],
      [a('Corvale', '2026-09-26T05:20:00Z'), a('Brackwyn', '2026-09-26T05:21:00Z'), a('Brackwyn', '2026-09-26T05:22:00Z')]);
    expect(text.split('\n').slice(1).map(l => l.match(/\*\*(\w+)\*\*/)[1])).toEqual(['Brackwyn', 'Corvale', 'Rethlan']);
  });
  it('one day is one date; one of each is singular', () => {
    const text = _optinPvpSummaryText('123456789012345678', [k('Brackwyn', '2026-09-26T05:20:00Z')], []);
    expect(text).toBe("📜 <@123456789012345678>'s opt-in log parse found **1 new PvP kill** and **0 new assists** (Sep 26, 2026).\n• **Brackwyn** — 1 kill");
  });
  it('the same guildie in two cases is one line', () => {
    const text = _optinPvpSummaryText('1', [k('Brackwyn', '2026-09-26T05:20:00Z')], [a('brackwyn', '2026-09-26T05:21:00Z')]);
    expect(text.split('\n')).toHaveLength(2);
    expect(text).toContain('• **Brackwyn** — 1 kill · 1 assist');
  });
  it('nothing new is no note at all', () => {
    expect(_optinPvpSummaryText('1', [], [])).toBe(null);
  });
  it('a long list stops at 30 lines and says how many more', () => {
    const many = Array.from({ length: 35 }, (_, i) => a('Guildie' + String.fromCharCode(97 + (i % 26)) + i, '2026-09-26T05:20:00Z'));
    const lines = _optinPvpSummaryText('1', [], many).split('\n');
    expect(lines).toHaveLength(1 + 30 + 1);
    expect(lines[lines.length - 1]).toBe('…and 5 more');
    expect(lines.join('\n').length).toBeLessThan(2000);   // one Discord message
  });
});

describe('the poster', () => {
  const p = stripJs(sliceBlock(bot, 'async function _postOptinPvpSummary(discordId, startedMs) {', '\n}\n'));
  it('counts only what this uploader\'s replay inserted since the run began', () => {
    expect(p).toMatch(/source=eq\.log_backfill/);
    expect(p).toMatch(/uploaded_by_discord_id=eq\.\$\{encodeURIComponent\(discordId\)\}/);
    expect(p).toMatch(/created_at=gte\.\$\{encodeURIComponent\(since\)\}/);
    expect(p).toMatch(/killer_guild=eq\.\$\{encodeURIComponent\(WP_GUILD_NAME\)\}/);
  });
  it('a failed read posts nothing, and the mention reaches only the uploader', () => {
    expect(p).toMatch(/if \(!Array\.isArray\(kills\) \|\| !Array\.isArray\(assists\)\) return;/);
    expect(p).toMatch(/allowedMentions: \{ users: \[discordId\] \}/);
  });
  it('the endpoint is routed and waits for the run\'s last uploads before counting', () => {
    expect(stripJs(bot)).toMatch(/req\.url === '\/api\/agent\/optin_summary'\) \{\s*try \{ return await _handleAgentOptinSummary\(req, res\); \}/);
    const h = stripJs(sliceBlock(bot, 'async function _handleAgentOptinSummary(req, res) {', '\n}\n'));
    expect(h).toMatch(/setTimeout\(\(\) => \{\s*_postOptinPvpSummary\(String\(identity\.discord_id\), startedMs\)/);
    expect(h).toMatch(/_OPTIN_SUMMARY_SETTLE_MS\);/);
  });
});

describe('replayed assists never post one by one', () => {
  const h = stripJs(sliceBlock(bot, 'async function _handleAgentPvpAssists(req, res) {', '\n}\n'));
  it('the 🪶 note is built from rows stored just now, minus a replayed log\'s', () => {
    expect(h).toMatch(/const postRows = \(Array\.isArray\(written\) \? written : \[\]\)\.filter\(r => r && r\.source !== 'log_backfill'\)/);
    expect(h).toMatch(/for \(const r of postRows\)/);
    expect(h).not.toMatch(/for \(const r of rows\) \{\s*const k = /);
  });
  it('one kill is one note even when several witnesses\' clocks differ by seconds', () => {
    expect(_recentPvpAssistPost('velisblacksword', Date.parse('2026-09-26T05:20:47Z'))).toBe(false);
    expect(_recentPvpAssistPost('velisblacksword', Date.parse('2026-09-26T05:20:49Z'))).toBe(true);
    expect(_recentPvpAssistPost('velisblacksword', Date.parse('2026-09-26T05:21:30Z'))).toBe(false);   // 43 s later: another death
    expect(_recentPvpAssistPost('jahpotheosis', Date.parse('2026-09-26T05:20:47Z'))).toBe(false);
  });
});
