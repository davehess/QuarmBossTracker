// 2026-10-30: a member in another group's raid relayed that raid's /rs into the guild's raid-chat channel. Raid chat is
// relayed only when the uploader's own latest raid roster is at least half guild characters.
import { describe, it, expect } from 'vitest';
import { readSource, BOT_INDEX, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const src = readSource(BOT_INDEX);
const block = sliceBlock(src, 'const RAID_CHAT_OURS_MIN_SHARE', 'let _foreignRaidChatLoggedAt');
const { _raidRosterIsOurs, _raidChatLineAllowed } = evalBlock(block, ['_raidRosterIsOurs', '_raidChatLineAllowed']);

const guild = new Set(['aldenmar', 'brackwyn', 'corvale', 'rethlan', 'nyssara']);
const at = (s) => new Date(Date.UTC(2026, 9, 30, 12, 0, s)).toISOString();
const rows = (names, s = 0) => names.map(name => ({ name, captured_at: at(s) }));

describe('whose raid is the uploader in', () => {
  it('ours when at least half of the newest capture is guild characters', () => {
    expect(_raidRosterIsOurs(rows(['Aldenmar', 'Brackwyn', 'Corvale', 'Stranger']), guild)).toBe(true);
    expect(_raidRosterIsOurs(rows(['Aldenmar', 'Stranger']), guild)).toBe(true);
  });

  it('not ours when most of it is outside the guild (the 2026-10-30 leak: 1 of 7)', () => {
    expect(_raidRosterIsOurs(rows(['Aldenmar', 'Sa', 'Sb', 'Sc', 'Sd', 'Se', 'Sf']), guild)).toBe(false);
  });

  it('only the newest capture counts: guild rows left over from last night do not vouch for this raid', () => {
    const old = rows(['Brackwyn', 'Corvale', 'Rethlan', 'Nyssara'], 0).map(r => ({ ...r, captured_at: new Date(Date.parse(r.captured_at) - 3600_000).toISOString() }));
    expect(_raidRosterIsOurs([...old, ...rows(['Aldenmar', 'Sa', 'Sb'], 30)], guild)).toBe(false);
  });

  it('unknown with no roster, a one-name roster, or no guild list', () => {
    expect(_raidRosterIsOurs([], guild)).toBe(null);
    expect(_raidRosterIsOurs(null, guild)).toBe(null);
    expect(_raidRosterIsOurs(rows(['Aldenmar']), guild)).toBe(null);
    expect(_raidRosterIsOurs(rows(['Aldenmar', 'Brackwyn']), new Set())).toBe(null);
  });
});

describe('one raid line', () => {
  const mine = new Set(['zarrin']);
  it('relays everything in our raid, nothing in another', () => {
    expect(_raidChatLineAllowed(true, 'Stranger', guild, mine)).toBe(true);
    expect(_raidChatLineAllowed(false, 'Aldenmar', guild, mine)).toBe(false);
  });
  it('unknown raid: only a guild character or the uploader’s own words', () => {
    expect(_raidChatLineAllowed(null, 'Aldenmar', guild, mine)).toBe(true);
    expect(_raidChatLineAllowed(null, 'Zarrin', guild, mine)).toBe(true);
    expect(_raidChatLineAllowed(null, 'Stranger', guild, mine)).toBe(false);
  });
  it('guild list not loaded: today’s behaviour, never silent', () => {
    expect(_raidChatLineAllowed(null, 'Stranger', new Set(), mine)).toBe(true);
  });
});

describe('the relay uses it', () => {
  it('asks once per batch and drops a refused raid line before it is relayed or stored', () => {
    const code = stripJs(src);
    expect(code).toMatch(/const raidIsOurs = messages\.some\(m => m && m\.channel === 'raid'\) \? await _uploaderRaidIsOurs\(identity\.discord_id, rosterSet\) : null;/);
    const loop = code.slice(code.indexOf('if (!channelId) continue;'), code.indexOf('const normText = String(text)'));
    expect(loop).toMatch(/if \(channel === 'raid' && !_raidChatLineAllowed\(raidIsOurs, speaker, rosterSet, uploaderCharacters\)\) \{[\s\S]*?continue;\s*\}/);
  });
});
