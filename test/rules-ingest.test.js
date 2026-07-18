// test/rules-ingest.test.js — the #94 message→rules parser + upsert-row mapping.
//
// These are the pure functions the /ingestrules command relies on (they live in
// utils/rulesParser.js precisely so they test without booting discord.js). We
// cover: numbered-item detection across the shapes a human rulebook uses,
// heading/bold title detection, the raw-body fallback that guarantees nothing is
// dropped, and the upsert-row mapping that makes re-ingest idempotent
// (edit-in-place keyed by source_message_id).

import { describe, it, expect } from 'vitest';
import {
  parseRuleMessage,
  buildRuleRow,
  detectRuleNumber,
  TITLE_MAX,
} from '../utils/rulesParser.js';

describe('detectRuleNumber — leading rule numbers', () => {
  it('accepts the common numbered shapes', () => {
    expect(detectRuleNumber('12. Raid Kit')).toBe(12);
    expect(detectRuleNumber('3) Be respectful')).toBe(3);
    expect(detectRuleNumber('7 - No ninja looting')).toBe(7);
    expect(detectRuleNumber('5: Show up on time')).toBe(5);
    expect(detectRuleNumber('Rule 9 — attendance')).toBe(9);
    expect(detectRuleNumber('#4 loot council')).toBe(4);
  });

  it('does not invent a number from prose or bare digits', () => {
    expect(detectRuleNumber('Be respectful to everyone')).toBeNull();
    expect(detectRuleNumber('You need 100 MR to raid')).toBeNull(); // no separator after 100
    expect(detectRuleNumber('')).toBeNull();
  });

  it('caps at three digits so long numbers in prose are not rule numbers', () => {
    expect(detectRuleNumber('1234. not a rule')).toBeNull();
  });
});

describe('parseRuleMessage — numbered rules', () => {
  it('splits number, title, and keeps the full body', () => {
    const r = parseRuleMessage('12. Raid Kit — every raider brings 100 MR and EB.');
    expect(r.rule_number).toBe(12);
    expect(r.title).toBe('Raid Kit');
    expect(r.body).toBe('12. Raid Kit — every raider brings 100 MR and EB.');
  });

  it('handles a multi-line numbered rule (title from first line, body = all)', () => {
    const raw = '4) Loot Council\nOfficers decide contested drops.\nBids over 100 mark your main.';
    const r = parseRuleMessage(raw);
    expect(r.rule_number).toBe(4);
    expect(r.title).toBe('Loot Council');
    expect(r.body).toBe(raw.trim());
  });

  it('reads a title after "Rule N:" prefixes', () => {
    const r = parseRuleMessage('Rule 8: No AFK during progression pulls');
    expect(r.rule_number).toBe(8);
    expect(r.title).toBe('No AFK during progression pulls');
  });
});

describe('parseRuleMessage — heading / bold titles', () => {
  it('pulls a bold markdown title', () => {
    const r = parseRuleMessage('**Attendance Policy**\nBe above 50% RA over 30 days.');
    expect(r.rule_number).toBeNull();
    expect(r.title).toBe('Attendance Policy');
  });

  it('pulls a markdown "# heading" title', () => {
    const r = parseRuleMessage('## Loot Rules');
    expect(r.rule_number).toBeNull();
    expect(r.title).toBe('Loot Rules');
  });

  it('combines a number and a bold heading', () => {
    const r = parseRuleMessage('1. **Be Respectful** — no harassment, ever.');
    expect(r.rule_number).toBe(1);
    expect(r.title).toBe('Be Respectful');
  });
});

describe('parseRuleMessage — raw fallback (nothing dropped)', () => {
  it('an unstructured message still lands as a raw-body row', () => {
    const raw = 'Hey everyone, remember we raid Sunday, Wednesday and Thursday at 8pm eastern.';
    const r = parseRuleMessage(raw);
    expect(r.rule_number).toBeNull();
    expect(r.body).toBe(raw);
    // a short leading clause is still offered as a convenience title, but the
    // whole message is preserved in body regardless
    expect(r.body.length).toBe(raw.length);
  });

  it('a long paragraph with no heading gets no invented title but keeps its body', () => {
    const raw = 'x'.repeat(TITLE_MAX + 50);
    const r = parseRuleMessage(raw);
    expect(r.rule_number).toBeNull();
    expect(r.title).toBeNull();
    expect(r.body).toBe(raw);
  });

  it('empty content yields an empty-body row, not a crash', () => {
    const r = parseRuleMessage('   ');
    expect(r).toEqual({ rule_number: null, title: null, body: '' });
  });

  it('clips an over-long markdown title to TITLE_MAX', () => {
    const long = 'A'.repeat(TITLE_MAX + 40);
    const r = parseRuleMessage(`1. **${long}**`);
    expect(r.rule_number).toBe(1);
    expect(r.title.length).toBeLessThanOrEqual(TITLE_MAX);
  });

  it('does not invent a title from a long prose first line', () => {
    const r = parseRuleMessage('1. ' + 'A'.repeat(120)); // 120-char clause > heading max
    expect(r.rule_number).toBe(1);
    expect(r.title).toBeNull();
  });
});

describe('buildRuleRow — upsert mapping + idempotency', () => {
  const base = { guildId: 'wolfpack', channelKey: 'loot_rules', messageId: '999', ingestedAtIso: '2026-07-19T00:00:00.000Z' };

  it('maps a parsed message onto the guild_rules shape', () => {
    const row = buildRuleRow({ ...base, text: '2. No Drama — keep it in DMs.' });
    expect(row).toMatchObject({
      guild_id: 'wolfpack',
      channel_key: 'loot_rules',
      rule_number: 2,
      title: 'No Drama',
      source_message_id: '999',
      category: null,
      active: true,
      ingested_at: '2026-07-19T00:00:00.000Z',
    });
    expect(row.body).toContain('No Drama');
  });

  it('is deterministic for identical inputs', () => {
    const a = buildRuleRow({ ...base, text: '3. Same input' });
    const b = buildRuleRow({ ...base, text: '3. Same input' });
    expect(a).toEqual(b);
  });

  it('an edit keeps the upsert key but refreshes content (in-place update)', () => {
    const before = buildRuleRow({ ...base, text: '5. Old wording of the rule' });
    const after  = buildRuleRow({ ...base, editedAtIso: '2026-07-19T01:00:00.000Z', text: '5. New wording, tightened up' });
    // Same key → upsert(...on_conflict=guild_id,channel_key,source_message_id)
    // targets the SAME row instead of inserting a duplicate.
    expect(after.guild_id).toBe(before.guild_id);
    expect(after.channel_key).toBe(before.channel_key);
    expect(after.source_message_id).toBe(before.source_message_id);
    // Content fields reflect the edit.
    expect(after.body).not.toBe(before.body);
    expect(after.source_edited_at).toBe('2026-07-19T01:00:00.000Z');
    expect(after.active).toBe(true);
  });

  it('coerces a non-string message id to a string', () => {
    const row = buildRuleRow({ ...base, messageId: 123456789, text: 'raw' });
    expect(row.source_message_id).toBe('123456789');
    expect(typeof row.source_message_id).toBe('string');
  });
});
