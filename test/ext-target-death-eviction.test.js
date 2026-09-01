// test/ext-target-death-eviction.test.js — a killed mob leaves the Extended
// Target board when it DIES, not when a timer says it probably has.
//
// Hitya, 2026-09-01: "Adiwen and I just killed Lord of Ire and his pet got the
// kill. it was announced but stayed on the extended target even after getting
// that message." Screenshot: Lord of Ire at 5%, "last seen 56s ago", still
// carrying its full debuff list, while #general already had the kill.
//
// ⚠ THE POINT: the 90s grace window is a TIMEOUT, NOT A DEATH SIGNAL, and
// shortening it was never a fix. It was cut 5min → 90s for this exact symptom
// on 2026-07-06 and the symptom came back, because the cache still had no way
// to learn a mob had died — while the bot had already announced the kill.
//
// ⚠ AND THE PET IS INCIDENTAL. The killing blow came from "a kiraikuei",
// Adiwen's pet, so the death line named an article-prefixed NPC rather than a
// player. That is a red herring for this bug: the row would have lingered
// identically had a player landed the blow. Anyone tempted to "fix" this by
// filtering death lines to known players would rebuild the bug — hence the
// slayer-agnostic test below.
//
// Run: npx vitest run test/ext-target-death-eviction.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import { readSource, BOT_INDEX, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const src = readSource(BOT_INDEX);

// The real function. End-anchored on the COMMENT after it, never on a line of
// its own body — a mutation to the body must change behaviour, not break the
// slice and read as a false kill.
const BLOCK = sliceBlock(
  src,
  'function _extEvictDeadMob(mobName) {',
  '\n// Off-tank freshness',
);

function build() {
  return evalBlock(
    'const _extMobLastSeen = new Map();\n' + BLOCK
    + '\nfunction seed(k){ _extMobLastSeen.set(k, { lastSeenMs: Date.now() }); }'
    + '\nfunction keys(){ return [..._extMobLastSeen.keys()]; }',
    ['_extEvictDeadMob', 'seed', 'keys'],
  );
}

let h;
beforeEach(() => { h = build(); });

const HATE = 'wolfpack|Plane of Hate|lord of ire';

describe('a confirmed death takes the mob off the board', () => {
  it('evicts the killed mob', () => {
    h.seed(HATE);
    expect(h._extEvictDeadMob('Lord of Ire')).toBe(1);
    expect(h.keys()).toEqual([]);
  });

  it('leaves every other mob alone', () => {
    h.seed(HATE);
    h.seed('wolfpack|Plane of Hate|an ashenbone drake');
    h._extEvictDeadMob('Lord of Ire');
    expect(h.keys()).toEqual(['wolfpack|Plane of Hate|an ashenbone drake']);
  });

  // ⚠ The zone strings genuinely disagree between sources: live-state carries a
  // Zeal zone name, the kill relay carries the server broadcast's — the report
  // that prompted this said "Plane of Hate (Instanced)". Keying the eviction on
  // zone would silently never match, which looks exactly like no fix at all.
  it('ignores the zone, because the two sources spell it differently', () => {
    h.seed('wolfpack|Plane of Hate|lord of ire');
    h.seed('wolfpack|Plane of Hate (Instanced)|lord of ire');
    h.seed('wolfpack|*|lord of ire');
    expect(h._extEvictDeadMob('Lord of Ire')).toBe(3);
    expect(h.keys()).toEqual([]);
  });

  it('matches the name case-insensitively and trims it', () => {
    h.seed(HATE);
    expect(h._extEvictDeadMob('  LORD OF IRE  ')).toBe(1);
  });

  // A partial match would evict a live mob on a kill it had nothing to do with.
  it('matches the WHOLE name, not a prefix or a substring', () => {
    h.seed(HATE);
    h.seed('wolfpack|Plane of Hate|lord of ire the second');
    expect(h._extEvictDeadMob('Lord')).toBe(0);
    expect(h._extEvictDeadMob('of Ire')).toBe(0);
    expect(h._extEvictDeadMob('Lord of Ire')).toBe(1);
    expect(h.keys()).toEqual(['wolfpack|Plane of Hate|lord of ire the second']);
  });

  // ⚠ Seeded with a BLANK name segment on purpose. Without that row the empty
  // guard is untestable — exact-equality matching already declines to match ''
  // against any real key, so a "returns 0 for junk" assertion passes whether
  // the guard exists or not. A key whose name is blank is the one input that
  // tells the two apart, and it is reachable from a bad target_name.
  it('an empty name is never a wildcard, even against a blank cache key', () => {
    h.seed(HATE);
    h.seed('wolfpack|Plane of Hate|');
    for (const junk of [null, undefined, '', '   ']) expect(h._extEvictDeadMob(junk)).toBe(0);
    expect(h.keys().length).toBe(2);
  });

  it('is safe to call for a mob that was never on the board', () => {
    expect(h._extEvictDeadMob('Lord of Ire')).toBe(0);
  });
});

describe('wiring — both death signals reach it', () => {
  const bot = stripJs(src);

  // The relay covers server-broadcast kills (instanced / lockout content).
  it('the kill relay evicts', () => {
    const fn = sliceBlock(bot, 'async function _handleAgentBossKill(', '\n  const discordJobs = []');
    expect(bot).toContain('_extEvictDeadMob(bossName)');
    // ...and it must sit ABOVE the PoP lock `continue`, which would otherwise
    // skip it entirely for locked bosses. A locked boss is just as dead.
    const handler = bot.slice(bot.indexOf('async function _handleAgentBossKill('));
    const evictAt = handler.indexOf('_extEvictDeadMob(bossName)');
    const popAt   = handler.indexOf('isPopLocked');
    expect(evictAt).toBeGreaterThan(-1);
    expect(popAt).toBeGreaterThan(-1);
    expect(evictAt).toBeLessThan(popAt);
    void fn;
  });

  // The broader signal: any raider's agent seeing the death line, broadcast or
  // not. Without this, only lockout-bearing bosses leave the board on death.
  it('an agent-confirmed death evicts, gated on confirmed_kill', () => {
    expect(bot).toContain('if (encounter.confirmed_kill === true) _extEvictDeadMob(encounter.boss_name);');
  });

  // ⚠ Slayer-agnostic ON PURPOSE — see the header. The reported kill was landed
  // by a pet, and nothing in this path may start caring who swung.
  it('never filters on who landed the killing blow', () => {
    const startAt = bot.indexOf('function _extEvictDeadMob(mobName) {');
    const body = bot.slice(startAt, startAt + 600);
    expect(body).not.toMatch(/slayer|killer|slain|pet|player|raider/i);
  });
});
