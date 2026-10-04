// test/fun-ld-quit.test.js — the /fun linkdead card ("Raids since … crashed"):
// an LD marked "It was a /quit" does not count, and a "raid" is a raid night.
//
// The guild lead, 2026-10-04: a /quit drops the connection exactly like a crash,
// so no observer's log can tell them apart — the player (or an officer) marks it
// by hand. And "last night wasn't a real raid": a Saturday group night counted
// as a raid he survived because the card counted calendar days with an
// encounter.
//
// The pure rules are web/lib/funLd.ts; the gate is web/lib/funLdAuth.ts; the
// write is web/app/fun/actions.ts. All three are exercised here by running them,
// not by reading their text.
//
// Run: npx vitest run test/fun-ld-quit.test.js

import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ROOT, readSource, sliceBlock, stripJs } from './_source-slice.js';
import {
  QUIT_WINDOW_MS, parseLds, ldView, countEvents, siblingsOf, isQuit, withQuit, withoutQuit,
  viewerDiscordId, mayMarkQuit, raidNightOf, attendedNights, raidStreaks,
} from '../web/lib/funLd.ts';

const T = (iso) => Date.parse(iso);
const row = (id, iso, extra = {}) => ({ id, event_ts: iso, target: null, detail: null, ...extra });
const quitDetail = { quit: true, by: '1', at: '2026-10-04T00:00:00.000Z' };

describe('which LDs count', () => {
  // Oct 3 is the real case: the latest LD, and the member says it was a /quit.
  const rows = [
    row(1, '2026-09-14T20:18:43Z'),
    row(2, '2026-09-14T20:18:46Z'),
    row(3, '2026-10-03T19:02:25Z', { detail: quitDetail }),
  ];

  it('leaves a /quit out of the last LD, and says which LD to mark next', () => {
    const v = ldView(parseLds(rows));
    expect(v.counted.map(l => l.id)).toEqual([1, 2]);
    expect(new Date(v.counted[v.counted.length - 1].ts).toISOString()).toBe('2026-09-14T20:18:46.000Z');
    expect(v.mark.id).toBe(2);
  });

  it('shrinks the lifetime count by the forgiven rows only', () => {
    expect(ldView(parseLds(rows)).counted).toHaveLength(2);
    expect(ldView(parseLds(rows.map(r => ({ ...r, detail: null })))).counted).toHaveLength(3);
  });

  it('counts a forgiven crash once however many raiders uploaded it', () => {
    const two = [row(1, '2026-09-14T20:18:43Z', { detail: quitDetail }), row(2, '2026-09-14T20:18:46Z', { detail: quitDetail })];
    expect(ldView(parseLds(two)).forgivenEvents).toBe(1);
    expect(ldView(parseLds(rows)).forgivenEvents).toBe(1);
    expect(ldView(parseLds([...two, row(3, '2026-10-03T19:02:25Z', { detail: quitDetail })])).forgivenEvents).toBe(2);
    expect(countEvents([])).toBe(0);
  });

  it('forgives a copy of the same LD that was uploaded after the override', () => {
    const late = [row(1, '2026-10-03T19:02:25Z', { detail: quitDetail }), row(2, '2026-10-03T19:04:25Z')];
    expect(ldView(parseLds(late)).counted).toHaveLength(0);
    // ...but not a separate LD a few minutes on.
    const later = [row(1, '2026-10-03T19:02:25Z', { detail: quitDetail }), row(2, '2026-10-03T19:04:26Z')];
    expect(ldView(parseLds(later)).counted.map(l => l.id)).toEqual([2]);
  });

  it('only an exact quit:true forgives', () => {
    for (const detail of [null, {}, { quit: false }, { quit: 'true' }, { quit: 1 }, 'quit', []]) {
      expect(isQuit(detail)).toBe(false);
      expect(ldView(parseLds([row(1, '2026-10-03T19:02:25Z', { detail })])).counted).toHaveLength(1);
    }
    expect(isQuit({ quit: true })).toBe(true);
  });

  it('offers Undo only while the latest forgiven LD is newer than every counted one', () => {
    expect(ldView(parseLds(rows)).undo.id).toBe(3);
    // an LD after the /quit: the /quit is history, nothing to undo from the card
    expect(ldView(parseLds([...rows, row(4, '2026-10-10T19:00:00Z')])).undo).toBeNull();
    // nothing forgiven
    expect(ldView(parseLds([row(1, '2026-09-14T20:18:43Z')])).undo).toBeNull();
  });

  it('with every LD forgiven there is nothing to mark, and Undo is offered', () => {
    const v = ldView(parseLds([row(1, '2026-10-03T19:02:25Z', { detail: quitDetail })]));
    expect(v.counted).toHaveLength(0);
    expect(v.mark).toBeNull();
    expect(v.undo.id).toBe(1);
  });

  it('ignores rows with an unreadable timestamp', () => {
    expect(parseLds([row(1, 'not a date'), row(2, '2026-09-14T20:18:43Z')])).toHaveLength(1);
  });
});

describe('marking and undoing', () => {
  const rows = [
    row(10, '2026-09-14T20:18:43Z'),
    row(11, '2026-09-14T20:18:46Z'),
    row(12, '2026-09-14T20:20:46Z'),   // exactly 2:00 after row 11 — still the same crash
    row(13, '2026-09-14T20:20:47Z'),   // 2:01 — not
    row(14, '2026-09-14T20:16:46Z'),   // exactly 2:00 before row 11
    row(15, '2026-09-14T20:16:45Z'),   // 2:01 before — not
  ];

  it('marks every sibling upload within two minutes, and no more', () => {
    const lds = parseLds(rows);
    const at = T('2026-09-14T20:18:46Z');
    expect(siblingsOf(lds, at).map(l => l.id).sort()).toEqual([10, 11, 12, 14]);
    expect(QUIT_WINDOW_MS).toBe(120_000);
  });

  it('puts quit/by/at into detail and keeps what was already there', () => {
    expect(withQuit(null, '42', '2026-10-04T01:00:00.000Z')).toEqual({ quit: true, by: '42', at: '2026-10-04T01:00:00.000Z' });
    expect(withQuit({ zone: 'x' }, null, 'iso')).toEqual({ zone: 'x', quit: true, by: null, at: 'iso' });
  });

  it('undo takes exactly those three keys out, and a bare detail goes back to null', () => {
    expect(withoutQuit(withQuit(null, '42', 'iso'))).toBeNull();
    expect(withoutQuit(withQuit({ zone: 'x' }, '42', 'iso'))).toEqual({ zone: 'x' });
    expect(withoutQuit(null)).toBeNull();
    const original = { zone: 'x' };
    withoutQuit(withQuit(original, '42', 'iso'));
    expect(original).toEqual({ zone: 'x' });
  });

  it('marking, then undoing, brings the crash back', () => {
    const base = [row(1, '2026-09-14T20:18:43Z'), row(2, '2026-09-14T20:18:46Z')];
    const target = parseLds(base)[1];
    const marked = base.map(r => siblingsOf(parseLds(base), target.ts).some(s => s.id === r.id)
      ? { ...r, detail: withQuit(r.detail, '42', 'iso') } : r);
    expect(ldView(parseLds(marked)).counted).toHaveLength(0);
    const undone = marked.map(r => ({ ...r, detail: withoutQuit(r.detail) }));
    expect(ldView(parseLds(undone)).counted).toHaveLength(2);
  });
});

describe('who may press the button', () => {
  const owner = '111';
  const check = (discordId, officer = false, owners = [owner]) => mayMarkQuit({ discordId, ownerDiscordIds: owners, officer });

  it('the character\'s own player: yes', () => expect(check('111')).toBe(true));
  it('an officer: yes', () => expect(check('999', true)).toBe(true));
  it('another member: no', () => expect(check('999')).toBe(false));
  it('signed out: no', () => expect(check(null)).toBe(false));
  it('a missing id never matches a missing owner id', () => {
    expect(check(null, false, [null, undefined])).toBe(false);
    expect(check('', false, [''])).toBe(false);
  });
  it('an officer with no Discord id is still an officer', () => expect(check(null, true)).toBe(true));

  it('reads the Discord id the way /pvp does', () => {
    expect(viewerDiscordId({ app_metadata: { provider_id: 'a' }, user_metadata: { provider_id: 'b', sub: 'c' } })).toBe('a');
    expect(viewerDiscordId({ app_metadata: {}, user_metadata: { provider_id: 'b', sub: 'c' } })).toBe('b');
    expect(viewerDiscordId({ user_metadata: { sub: 'c' } })).toBe('c');
    expect(viewerDiscordId({ user_metadata: {} })).toBeNull();
    expect(viewerDiscordId({ user_metadata: { provider_id: '' } })).toBeNull();
    expect(viewerDiscordId(null)).toBeNull();
  });
});

describe('raid nights', () => {
  // Real shape of the data: raid_nights holds only the guild's Sun/Wed/Thu nights.
  const NIGHTS = ['2026-09-24', '2026-09-27', '2026-09-30', '2026-10-01', '2026-10-04'];

  it('puts a raid on its Eastern date, not its UTC date', () => {
    expect(raidNightOf(T('2026-10-03T19:02:25Z'))).toBe('2026-10-03');   // Sat afternoon ET
    expect(raidNightOf(T('2026-10-05T01:30:00Z'))).toBe('2026-10-04');   // Sun 9:30pm ET, Monday in UTC
    expect(raidNightOf(T('2026-10-04T23:59:00Z'))).toBe('2026-10-04');
  });

  it('keeps a raid that runs past midnight on the night it started, until 05:00 Eastern', () => {
    expect(raidNightOf(T('2026-10-05T04:30:00Z'))).toBe('2026-10-04');   // 00:30 ET Monday
    expect(raidNightOf(T('2026-10-05T08:59:00Z'))).toBe('2026-10-04');   // 04:59 EDT
    expect(raidNightOf(T('2026-10-05T09:00:00Z'))).toBe('2026-10-05');   // 05:00 EDT
    expect(raidNightOf(T('2026-12-07T09:59:00Z'))).toBe('2026-12-06');   // 04:59 EST
    expect(raidNightOf(T('2026-12-07T10:00:00Z'))).toBe('2026-12-07');   // 05:00 EST
  });

  it('a Saturday group night is not a raid', () => {
    expect(attendedNights([T('2026-10-03T19:09:39Z'), T('2026-10-03T21:10:35Z')], NIGHTS).size).toBe(0);
  });

  it('a Sunday-night fight at 01:30 UTC Monday is the Sunday raid', () => {
    expect([...attendedNights([T('2026-10-05T01:30:00Z')], NIGHTS)]).toEqual(['2026-10-04']);
  });

  it('a Monday-afternoon fight is not the Sunday raid', () => {
    expect(attendedNights([T('2026-10-05T19:00:00Z')], NIGHTS).size).toBe(0);
  });

  it('counts a night once however many fights he was in', () => {
    const fights = ['2026-09-28T00:10:00Z', '2026-09-28T01:10:00Z', '2026-09-28T02:10:00Z', '2026-09-28T03:50:00Z'].map(T);
    expect([...attendedNights(fights, NIGHTS)]).toEqual(['2026-09-27']);
  });

  it('survives junk timestamps', () => {
    expect(attendedNights([NaN], NIGHTS).size).toBe(0);
  });

  describe('raids since the last LD, and the record', () => {
    const ATT = new Set(['2026-09-24', '2026-09-27', '2026-10-01']);

    it('counts attended nights after the LD night — the live data with the Oct 3 LD forgiven', () => {
      const counted = [T('2026-09-14T20:18:46Z')];
      expect(raidStreaks(counted, ATT).since).toBe(3);
    });

    it('is zero on a Saturday crash with no raid since', () => {
      expect(raidStreaks([T('2026-10-03T19:02:25Z')], ATT).since).toBe(0);
    });

    it('does not count the night the LD happened on, even if he kept fighting after it', () => {
      // LD at 21:00 ET on a raid night (01:00 UTC next day); he fought on after it.
      expect(raidStreaks([T('2026-09-28T01:00:00Z')], new Set(['2026-09-27', '2026-10-01'])).since).toBe(1);
    });

    it('the record is the most attended raid nights between two consecutive LDs', () => {
      const counted = [T('2026-09-10T20:00:00Z'), T('2026-09-26T20:00:00Z'), T('2026-10-03T19:00:00Z')];
      const att = new Set(['2026-09-13', '2026-09-16', '2026-09-17', '2026-09-20', '2026-09-24', '2026-10-01']);
      // gap 1 (Sep 10 -> Sep 26): 13, 16, 17, 20, 24 = 5; gap 2 (Sep 26 -> Oct 3): 1
      expect(raidStreaks(counted, att).best).toBe(5);
    });

    it('a forgiven LD in the middle joins the two streaks around it', () => {
      const att = new Set(['2026-09-13', '2026-09-16', '2026-09-20', '2026-09-24']);
      const rows = [
        row(1, '2026-09-10T20:00:00Z'),
        row(2, '2026-09-18T20:00:00Z'),   // between 16 and 20
        row(3, '2026-09-30T20:00:00Z'),
      ];
      const all = (rs) => raidStreaks(ldView(parseLds(rs)).counted.map(l => l.ts), att).best;
      expect(all(rows)).toBe(2);   // 13, 16 | 20, 24
      expect(all([rows[0], { ...rows[1], detail: quitDetail }, rows[2]])).toBe(4);
    });

    it('the record is the biggest gap wherever it sits, and a night an LD happened on is in neither gap', () => {
      const counted = [T('2026-09-10T20:00:00Z'), T('2026-09-14T20:00:00Z'), T('2026-09-28T01:00:00Z')];
      // gap 1 (Sep 10 -> Sep 14): 13 = 1. gap 2 (Sep 14 -> the Sep 27 raid, LD at 21:00 ET): 16, 17, 20 = 3,
      // and the 27th, which he attended but was LD on, is not among them.
      const att = new Set(['2026-09-13', '2026-09-16', '2026-09-17', '2026-09-20', '2026-09-27']);
      expect(raidStreaks(counted, att).best).toBe(3);
    });

    it('the record ignores Saturdays', () => {
      const counted = [T('2026-09-12T20:00:00Z'), T('2026-09-26T20:00:00Z')];
      const nights = ['2026-09-13', '2026-09-16'];
      const saturdayFights = [T('2026-09-19T19:00:00Z'), T('2026-09-19T21:00:00Z')];
      const att = attendedNights([...saturdayFights, T('2026-09-14T00:30:00Z')], nights);
      expect(raidStreaks(counted, att).best).toBe(1);
    });

    it('no counted LD: nothing since, no record', () => {
      expect(raidStreaks([], ATT)).toEqual({ since: 0, best: 0 });
    });
  });
});

// ── The gate, run for real with its two lookups faked ───────────────────────
const gate = vi.hoisted(() => ({ officer: false, characters: [], throws: false }));
vi.mock('../web/lib/officer.ts', () => ({ isOfficer: async () => gate.officer }));
vi.mock('../web/lib/supabase.ts', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ ilike: async (col, pattern) => {
        if (gate.throws) throw new Error('db down');
        // ilike: case-insensitive, % is a wildcard
        const re = new RegExp('^' + String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i');
        return { data: gate.characters.filter(c => re.test(c[col] ?? '')) };
      } }) }),
    }),
  }),
}));
const { viewerMayMarkQuit } = await import('../web/lib/funLdAuth.ts');

describe('viewerMayMarkQuit (the server-side gate)', () => {
  const user = (id, discord) => ({ id, app_metadata: { provider_id: discord }, user_metadata: {} });
  beforeEach(() => {
    gate.officer = false;
    // The character's own player owns it; another member owns a different character.
    gate.characters = [{ name: 'Peopleslayer', discord_id: '111' }, { name: 'Otherchar', discord_id: '222' }];
    gate.throws = false;
  });

  it('signed out: no', async () => expect(await viewerMayMarkQuit(null)).toBe(false));
  it('the character\'s player: yes', async () => expect(await viewerMayMarkQuit(user('u1', '111'))).toBe(true));
  it('another member, even one who owns some other character: no', async () => {
    expect(await viewerMayMarkQuit(user('u2', '222'))).toBe(false);
    expect(await viewerMayMarkQuit(user('u5', '555'))).toBe(false);
  });
  it('an officer: yes', async () => {
    gate.officer = true;
    expect(await viewerMayMarkQuit(user('u3', '333'))).toBe(true);
  });
  it('a member with no Discord id: no, even if the character has no owner on file', async () => {
    gate.characters = [{ name: 'Peopleslayer', discord_id: null }];
    expect(await viewerMayMarkQuit({ id: 'u4', app_metadata: {}, user_metadata: {} })).toBe(false);
  });
  it('a failed lookup never grants it', async () => {
    gate.throws = true;
    expect(await viewerMayMarkQuit(user('u1', '111'))).toBe(false);
  });
});

// ── The action, run for real against an in-memory fun_events ────────────────
const act = vi.hoisted(() => ({ user: null, allowed: false, rows: [], updates: [], revalidated: [], failUpdate: false }));
vi.mock('@/lib/supabase-server', () => ({
  supabaseServer: () => ({ auth: { getUser: async () => ({ data: { user: act.user } }) } }),
}));
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ order: async () => ({ data: structuredClone(act.rows), error: null }) }) }),
      update: (patch) => ({ eq: async (_col, id) => {
        act.updates.push({ id, patch });
        const r = act.rows.find(x => x.id === id);
        if (r) Object.assign(r, patch);
        return { error: act.failUpdate ? { message: 'boom' } : null };
      } }),
    }),
  }),
}));
vi.mock('@/lib/funLdAuth', () => ({ viewerMayMarkQuit: async () => act.allowed }));
vi.mock('@/lib/funLd', async () => await import('../web/lib/funLd.ts'));
// `next/cache` resolves differently by machine: CI installs only the root
// dependencies, so the bare id is all there is; a checkout with web/ installed
// resolves it to a file, and a mock registered under the bare id would miss.
// Register both.
const nextCache = { revalidatePath: (p) => act.revalidated.push(p) };
vi.doMock('next/cache', () => nextCache);
try {
  vi.doMock(createRequire(new URL('../web/package.json', import.meta.url)).resolve('next/cache'), () => nextCache);
} catch { /* web/ not installed here */ }
const { setLdQuit } = await import('../web/app/fun/actions.ts');

describe('setLdQuit (the server action)', () => {
  const seed = () => [
    row(1, '2026-09-14T20:18:43Z', { detail: { zone: 'kept' } }),
    row(2, '2026-09-14T20:18:46Z'),
    row(3, '2026-10-03T19:02:25Z'),
    row(4, '2026-10-03T19:02:27Z'),   // a second raider's copy of the same LD
  ];
  const LATEST = '2026-10-03T19:02:27.000Z';
  beforeEach(() => {
    act.user = { id: 'u1', app_metadata: { provider_id: '111' }, user_metadata: {} };
    act.allowed = true;
    act.rows = seed();
    act.updates = [];
    act.revalidated = [];
    act.failUpdate = false;
  });

  it('reports a failed write instead of saying it worked', async () => {
    act.failUpdate = true;
    const r = await setLdQuit(true, LATEST);
    expect(r).toEqual({ ok: false, error: 'boom' });
    expect(act.revalidated).toEqual([]);
  });

  it('refuses without writing when the gate says no', async () => {
    act.allowed = false;
    const r = await setLdQuit(true, LATEST);
    expect(r.ok).toBe(false);
    expect(act.updates).toEqual([]);
  });

  it('refuses a signed-out caller', async () => {
    act.user = null;
    expect((await setLdQuit(true, LATEST)).ok).toBe(false);
    expect(act.updates).toEqual([]);
  });

  it('marks the latest LD and its sibling upload together, and revalidates /fun', async () => {
    const r = await setLdQuit(true, LATEST);
    expect(r.ok).toBe(true);
    expect(act.updates.map(u => u.id).sort()).toEqual([3, 4]);
    for (const u of act.updates) {
      expect(u.patch.detail.quit).toBe(true);
      expect(u.patch.detail.by).toBe('111');
      expect(Number.isNaN(Date.parse(u.patch.detail.at))).toBe(false);
    }
    expect(act.rows[0].detail).toEqual({ zone: 'kept' });   // the September LD is untouched
    expect(ldView(parseLds(act.rows)).counted.map(l => l.id)).toEqual([1, 2]);
    expect(act.revalidated).toEqual(['/fun']);
  });

  it('undo puts both rows back', async () => {
    await setLdQuit(true, LATEST);
    act.updates = [];
    const r = await setLdQuit(false, LATEST);
    expect(r.ok).toBe(true);
    expect(act.updates.map(u => u.id).sort()).toEqual([3, 4]);
    expect(act.rows[2].detail).toBeNull();
    expect(act.rows[3].detail).toBeNull();
    expect(ldView(parseLds(act.rows)).counted).toHaveLength(4);
  });

  it('refuses when the page was looking at a different LD than the one the server would mark', async () => {
    const r = await setLdQuit(true, '2026-09-14T20:18:46.000Z');
    expect(r.ok).toBe(false);
    expect(act.updates).toEqual([]);
  });

  it('refuses an undo when nothing newer was forgiven', async () => {
    const r = await setLdQuit(false, LATEST);
    expect(r.ok).toBe(false);
    expect(act.updates).toEqual([]);
  });

  it('refuses a timestamp that is not one', async () => {
    expect((await setLdQuit(true, 'soon')).ok).toBe(false);
    expect(act.updates).toEqual([]);
  });
});

// ── The page, which is a server component and cannot be run here ────────────
describe('the card is wired to the helpers', () => {
  const src = readSource(path.join(ROOT, 'web', 'app', 'fun', 'page.tsx'));
  const section = stripJs(sliceBlock(
    src,
    'SECTIONS.push(async (sb, counters, ctx) => {\n  // A member LD card',
    'SECTIONS.push(async (sb, counters) => {\n  // Tunare mentions',
  ));

  it('draws the /quit links only for a viewer the gate allowed', () => {
    expect(stripJs(src)).toMatch(/canMarkQuit:\s*viewerMayMarkQuit\(user\)/);
    expect(section).toMatch(/\{canMark && mark && \(/);
    expect(section).toMatch(/const undoLink = canMark && undo && \(/);
  });

  it('takes the LDs through the /quit filter and counts raids by raid night', () => {
    expect(section).toMatch(/ldView\(parseLds\(/);
    expect(section).toMatch(/raidStreaks\(/);
    expect(section).toMatch(/attendedNights\(/);
    expect(section).toMatch(/from\('raid_nights'\)/);
    // the old per-UTC-date counting and the unfiltered row count are gone
    expect(section).not.toMatch(/sinceDays|fmtDay|ldTotal/);
  });

  it('pulls his encounters with selectAll, not a plain select that stops at 1000 rows', () => {
    expect(section).toMatch(/selectAll<EpRow>/);
  });

  it('a 0 here is the joke, so the card stays up top instead of dimming into "Quiet for now"', () => {
    // The counted card carries alwaysLive, and the page's live/dormant split honours it.
    expect(section).toMatch(/value:\s*raidsSince,\s*alwaysLive:\s*true/);
    const body = /const isLive = \([^)]*\) =>\s*([\s\S]*?);/.exec(stripJs(src))[1];
    const isLive = new Function('c', 'return ' + body);
    expect(isLive({ value: 0, alwaysLive: true })).toBe(true);
    expect(isLive({ value: 0 })).toBe(false);
    expect(isLive({ value: '—' })).toBe(false);
    expect(isLive({ value: 3 })).toBe(true);
  });
});
