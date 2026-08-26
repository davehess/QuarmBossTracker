// "you have to be in the raid for it to fire" — Hitya, 2026-08-26, answering
// whether autobid may fire while the member is away from the keyboard.
//
// This is the single most dangerous predicate in the bidding feature, because
// getting it wrong spends someone else's DKP while they are not looking. The
// tests are therefore almost entirely about the NEGATIVE cases.
//
// The polarity is an INVERSION of the same predicate in the agent's trigger
// path (`require_raid_member`), which deliberately falls OPEN on an empty
// roster so out-of-raid testing still fires. A missed callout is worse than a
// spurious one; a spurious BID is worse than a missed one. Same question,
// opposite correct answer — which is exactly the kind of thing that gets
// copied across by pattern and quietly inverted.
//
// Run: npx vitest run test/autobid-raid-gate.test.js
import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, BOT_INDEX } from './_source-slice.js';

const src = readSource(BOT_INDEX);
const block = sliceBlock(
  src,
  'const _AUTOBID_ROSTER_FRESH_MS',
  "return { inRaid: false, reason: 'roster lookup failed: ' + (err && err.message) };\n  }\n}",
);

function build({ rows = [], throws = false } = {}) {
  const calls = [];
  const harness = `
    const require = (m) => ({
      isEnabled: () => ${rows === null ? 'false' : 'true'},
      async select(table, q) {
        calls.push({ table, q });
        if (${throws}) throw new Error('boom');
        return ${JSON.stringify(rows === null ? [] : rows)};
      },
    });
    const process = { env: {} };
  ` + block + `
    return { _isCharacterInRaid, calls };
  `;
  // eslint-disable-next-line no-new-func
  return new Function('calls', harness)(calls);
}

const ROW = [{ name: 'Hitya', captured_at: '2026-08-26T20:00:00Z' }];

describe('the gate', () => {
  it('fires when the character is in a recent raid roster', async () => {
    const h = build({ rows: ROW });
    expect((await h._isCharacterInRaid('Hitya')).inRaid).toBe(true);
  });

  it('REFUSES when the roster is empty — no Zeal, or not in the raid', async () => {
    // The inversion: the agent's trigger gate falls OPEN here. Autobid must not.
    const h = build({ rows: [] });
    const r = await h._isCharacterInRaid('Hitya');
    expect(r.inRaid).toBe(false);
    expect(r.reason).toMatch(/not in a recent raid roster/);
  });

  it('REFUSES when the roster lookup throws — a failure is not permission', async () => {
    const h = build({ rows: ROW, throws: true });
    expect((await h._isCharacterInRaid('Hitya')).inRaid).toBe(false);
  });

  it('REFUSES when Supabase is disabled', async () => {
    const h = build({ rows: null });
    expect((await h._isCharacterInRaid('Hitya')).inRaid).toBe(false);
  });

  it('REFUSES an empty or missing character name', async () => {
    const h = build({ rows: ROW });
    for (const bad of ['', '   ', null, undefined]) {
      expect((await h._isCharacterInRaid(bad)).inRaid, String(bad)).toBe(false);
    }
  });

  it('only accepts a FRESH roster entry — last night does not count', async () => {
    // Without the freshness bound, "was in a raid once" would read as "is in
    // the raid", and autobid would fire on a Tuesday afternoon.
    const h = build({ rows: ROW });
    await h._isCharacterInRaid('Hitya');
    expect(h.calls[0].q).toContain('captured_at=gte.');
  });

  it('scopes the lookup to the character, not the whole roster', async () => {
    const h = build({ rows: ROW });
    await h._isCharacterInRaid('Hitya');
    expect(h.calls[0].q).toMatch(/name=ilike\./);
    expect(h.calls[0].table).toBe('raid_roster');
  });
});

describe('the record', () => {
  it('states the fail-closed inversion where someone will read it', () => {
    const note = src.slice(src.indexOf('// ── Autobid gate:'), src.indexOf('const _AUTOBID_ROSTER_FRESH_MS'));
    expect(note).toMatch(/FAILS CLOSED/);
    expect(note).toMatch(/INVERSION/);
    expect(note).toMatch(/No roster, no autobid/i);
  });

  it('says plainly that no Zeal means no autobid', () => {
    const note = src.slice(src.indexOf('// ── Autobid gate:'), src.indexOf('const _AUTOBID_ROSTER_FRESH_MS'));
    expect(note).toMatch(/without Zeal.*NO autobid|NO autobid/i);
  });
});
