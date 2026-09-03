// /tag channel autojoin — merging the guild's tag channel into a character's
// existing autojoin list without disturbing anything else in it.
//
// Why the channel matters: /tag is the ONLY surface that carries a spawn id
// (CLAUDE.md scope note) — the Zeal pipe's gauges do not, so same-name mobs
// are otherwise indistinguishable. A raider who never joined contributes
// nothing and receives nothing, and the failure is INVISIBLE to them: Zeal
// still draws their arrow locally.
//
// ⚠ NO REAL PASSWORD IN THIS FILE. The channel spec is name:password and the
// password is a shared guild secret; committing it would put it in git history
// permanently and in every clone. The name lives in source, the password comes
// from config at runtime, and these tests use an obvious placeholder.
import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, evalBlock, AGENT_INDEX } from './_source-slice.js';

const block = sliceBlock(
  readSource(AGENT_INDEX),
  'const TAG_CHANNEL_NAME',
  "return { changed, value: out.join(' '), reason: found ? 'already present' : 'added' };\n}",
);
const { _mergeAutojoin, _parseChannelSpec, TAG_CHANNEL_NAME } =
  evalBlock(block, ['_mergeAutojoin', '_parseChannelSpec', 'TAG_CHANNEL_NAME']);

const SPEC = TAG_CHANNEL_NAME + ':pw';   // placeholder password, never the real one

describe('parsing a channel spec', () => {
  it('splits name from password on the first colon', () => {
    expect(_parseChannelSpec('Ztwolfpacktag:secret')).toEqual({ name: 'Ztwolfpacktag', password: 'secret' });
  });
  it('handles a channel with no password', () => {
    expect(_parseChannelSpec('general')).toEqual({ name: 'general', password: null });
  });
  it('rejects empty and nameless specs rather than writing junk into an ini', () => {
    for (const bad of ['', '   ', ':orphan', null, undefined]) {
      expect(_parseChannelSpec(bad), String(bad)).toBeNull();
    }
  });
});

describe('merging into an autojoin list', () => {
  it('adds the channel when the list is empty', () => {
    expect(_mergeAutojoin('', SPEC)).toMatchObject({ changed: true, value: SPEC });
  });

  it('appends without disturbing the channels already there', () => {
    // Someone else's channels are none of our business.
    const r = _mergeAutojoin('general auction Zguildchat:x', SPEC);
    expect(r.value).toBe('general auction Zguildchat:x ' + SPEC);
  });

  it('is idempotent — running it twice changes nothing the second time', () => {
    const once = _mergeAutojoin('general', SPEC).value;
    expect(_mergeAutojoin(once, SPEC).changed).toBe(false);
  });

  it('CORRECTS a join that has the right name but no password', () => {
    // This is the nastiest real case: the channel looks joined, so nobody
    // investigates, but without the password the join fails and they silently
    // send and receive nothing.
    const r = _mergeAutojoin('general ' + TAG_CHANNEL_NAME, SPEC);
    expect(r.changed).toBe(true);
    expect(r.value).toBe('general ' + SPEC);
  });

  it('corrects a WRONG password rather than adding a second entry', () => {
    const r = _mergeAutojoin(TAG_CHANNEL_NAME + ':wrong', SPEC);
    expect(r.value).toBe(SPEC);
  });

  it('collapses duplicates of the same channel', () => {
    const r = _mergeAutojoin(TAG_CHANNEL_NAME + ':a general ' + TAG_CHANNEL_NAME + ':b', SPEC);
    expect(r.value).toBe(SPEC + ' general');
    expect(r.value.split(' ').filter(p => p.toLowerCase().startsWith(TAG_CHANNEL_NAME.toLowerCase()))).toHaveLength(1);
  });

  it('matches the channel name case-insensitively', () => {
    // EQ channel names are not case-sensitive; a case difference must not
    // produce a second join.
    const r = _mergeAutojoin(TAG_CHANNEL_NAME.toLowerCase() + ':pw', SPEC);
    expect(r.changed).toBe(false);
  });

  it('tolerates whitespace and stray commas in a hand-edited ini', () => {
    const r = _mergeAutojoin('  general , auction  ', SPEC);
    expect(r.value).toBe('general auction ' + SPEC);   // commas tolerated on read, spaces written
  });

  it('refuses a bad spec instead of corrupting the list', () => {
    const r = _mergeAutojoin('general auction', '');
    expect(r.changed).toBe(false);
    expect(r.value).toBe('general auction');
  });
});

describe('the password stays out of source', () => {
  it('source carries the channel NAME only', () => {
    const src = readSource(AGENT_INDEX);
    expect(src).toContain("TAG_CHANNEL_NAME = 'Ztwolfpacktag'");
    // A literal `Ztwolfpacktag:<something>` in source would be the password
    // committed to git history forever.
    expect(src).not.toMatch(/Ztwolfpacktag:[A-Za-z0-9]/);
  });
});
