import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const gin = require('../utils/guildInterestNotice');

const full = {
  created_at: '2026-11-09T12:00:00.123456+00:00',
  guild_name: 'Aldenmar Vanguard', game: 'other', server: 'Test Server', raiders: 24,
  nights: ['wed', 'sun'], tz: 'et', raid_start: '20:00', raid_end: '23:30',
  bid_mode: 'dkp-sealed', dkp: 'opendkp', heard: 'a friend', discord_contact: 'brackwyn',
};
const val = (fields, name) => (fields.find(f => f.name === name) || {}).value;

describe('clean (stranger-typed text)', () => {
  it('defuses mentions', () => {
    const out = gin.clean('hi @everyone and @here <@123> <@!4> <@&5> <#6> @someone');
    expect(out).not.toMatch(/@/);
    expect(out).not.toMatch(/<[@#]/);
  });
  it('keeps only the text of a masked link, and removes the URL', () => {
    const out = gin.clean('[click](https://x.y)');
    expect(out).toContain('click');
    expect(out).not.toMatch(/x\.y|https|\]\(/);
  });
  it('removes bare URLs', () => {
    const out = gin.clean('see https://evil.example/x now');
    expect(out).not.toMatch(/evil|https|:\/\//);
    expect(out).toContain('now');
  });
  it('caps length and escapes markdown', () => {
    expect(gin.clean('a'.repeat(5000)).length).toBeLessThanOrEqual(gin.FIELD_MAX);
    expect(gin.clean('**bold** `code` ||spoil||')).not.toMatch(/(^|[^\\])[*`|]/);
  });
  it('collapses whitespace and tolerates non-strings', () => {
    expect(gin.clean('a \n\n  b')).toBe('a b');
    expect(gin.clean(null)).toBe('');
    expect(gin.clean(42)).toBe('');
  });
});

describe('cardFields', () => {
  it('maps a full row', () => {
    const f = gin.cardFields(full);
    expect(val(f, 'Guild')).toBe('Aldenmar Vanguard');
    expect(val(f, 'Game')).toBe('Other (Test Server)');
    expect(val(f, 'Raiders')).toBe('24');
    expect(val(f, 'Nights')).toBe('Sun, Wed · 20:00–23:30 ET');
    expect(val(f, 'Loot')).toBe('Sealed bid DKP · DKP tool: OpenDKP');
    expect(val(f, 'How they heard')).toBe('a friend');
    expect(val(f, 'Reply to')).toBe('brackwyn');
    expect(f[f.length - 1].value).toContain(gin.ADMIN_URL);
  });
  it('omits empty optional fields', () => {
    const f = gin.cardFields({ guild_name: 'Solo', nights: [] });
    expect(f.map(x => x.name)).toEqual(['Guild', '​']);
  });
  it('maps coded values to labels and drops unknown codes instead of printing them', () => {
    const f = gin.cardFields({ guild_name: 'G', game: 'nope', tz: 'zz', bid_mode: '@everyone', dkp: 'x', nights: ['xyz', 'mon'] });
    const text = JSON.stringify(f);
    expect(text).not.toMatch(/nope|zz|everyone|"x"|xyz/);
    expect(val(f, 'Nights')).toBe('Mon');
    expect(val(f, 'Game')).toBeUndefined();
    expect(val(f, 'Loot')).toBeUndefined();
  });
  it('sanitizes stranger text on the card and stays under the Discord field limit', () => {
    const f = gin.cardFields({ ...full, guild_name: '@everyone', heard: 'x'.repeat(3000), discord_contact: '<@&9>[a](http://b.c)' });
    expect(JSON.stringify(f)).not.toMatch(/everyone|<@|http:/);
    for (const x of f) expect(x.value.length).toBeLessThanOrEqual(1024);
  });
});

describe('plan (watermark)', () => {
  const now = new Date('2026-11-09T13:00:00Z');
  const row = (i) => ({ created_at: `2026-11-09T12:0${i}:00.000000+00:00`, guild_name: `G${i}` });
  it('first run posts nothing and starts from now', () => {
    const p = gin.plan({ rows: [row(1)], watermark: null, now });
    expect(p.toPost).toEqual([]);
    expect(p.nextWatermark).toBe(now.toISOString());
  });
  it('posts only newer rows, oldest first, and advances the watermark', () => {
    const p = gin.plan({ rows: [row(3), row(1), row(2)], watermark: row(1).created_at, now });
    expect(p.toPost.map(r => r.guild_name)).toEqual(['G2', 'G3']);
    expect(p.more).toBe(0);
    expect(p.nextWatermark).toBe(row(3).created_at);
  });
  it('caps at 5 per tick and counts the rest, moving the watermark past all', () => {
    const rows = [1, 2, 3, 4, 5, 6, 7].map(row);
    const p = gin.plan({ rows, watermark: '2026-11-09T11:00:00+00:00', now });
    expect(p.toPost).toHaveLength(5);
    expect(p.toPost[0].guild_name).toBe('G1');
    expect(p.more).toBe(2);
    expect(p.nextWatermark).toBe(row(7).created_at);
    expect(gin.moreLine(2)).toContain('2 more');
  });
  it('keeps the watermark when nothing is new', () => {
    const p = gin.plan({ rows: [row(1)], watermark: row(1).created_at, now });
    expect(p.toPost).toEqual([]);
    expect(p.nextWatermark).toBe(row(1).created_at);
  });
  it('orders rows inside the same millisecond by their microseconds', () => {
    const a = '2026-11-09T12:00:00.123456+00:00', b = '2026-11-09T12:00:00.123789+00:00';
    const p = gin.plan({ rows: [{ created_at: b }], watermark: a, now });
    expect(p.toPost).toHaveLength(1);
  });
});
