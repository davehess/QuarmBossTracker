// test/di-callout.test.js — Divine Intervention two-cleric callout (#204).
//
// What this guards, and why each one is a real trap rather than a hypothetical:
//
//   • THE LINE. `DESIGN-di-callout.md` §0 exists because the shipped DI trigger
//     matched text that appears NOWHERE in spell 1546 — three invented
//     alternates, enabled, matching nothing, reading as coverage for months.
//     The real fire line comes from the server source Quarm runs on (EQMacEmu
//     `Mob::TryDeathSave` → StringID 1029 "%1 has been rescued by divine
//     intervention!"). The sibling invention — "<Player> survived divine
//     intervention!", which circulates in GINA/AI trigger packs — must NOT
//     match, or we re-ship the same bug with better paperwork.
//
//   • WHO GETS NAMED. The chain is not a cleric roster. Druids gap-fill it via
//     CH-equivalent auto-slots and shamans turn up too — and a druid cannot
//     cast Divine Intervention at all. Naming one costs the tank the same way
//     naming a corpse does, or naming a cleric whose recast we WATCHED start.
//
//   • WHAT WE ADMIT TO GUESSING. Emeralds, the global cooldown and "I'm about
//     to med" are unknowable to us, so the callout nominates two names and lets
//     voice resolve it. A candidate whose DI state we never saw must be marked
//     unknown, never dressed up as ready.
//
// Run: npx vitest run test/di-callout.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const agent = require('../packages/wolfpack-logsync/index.js');

const {
  _DI_FIRED_RX, _diRankCandidates, _diSlotTurnInMs,
  trackDiFired, diCalloutSnapshot, _resetDiCalloutForTest,
  trackChChainLine, chChainSnapshot, _resetChChainForTest,
  _noteDeath, _clearDeath, _activeOverlays, shouldKeep,
  DI_CALLOUT_NAMES,
} = agent;

// A raw log line as the tail loop sees it — timestamp prefix and all. Every
// agent-side detector matches the RAW line, which is exactly why a bare `^`
// anchor can never fire (CLAUDE.md, trigger-pattern rule).
const stamp = (d) => '[' + d.toDateString().slice(0, 3) + ' ' +
  d.toDateString().slice(4, 7) + ' ' + String(d.getDate()).padStart(2, ' ') + ' ' +
  d.toTimeString().slice(0, 8) + ' ' + d.getFullYear() + ']';
const raw = (d, body) => stamp(d) + ' ' + body;

const BEAT = 3000;   // a 3s chain beat, mid-range for a real rotation

// A chain snapshot in the shape chChainSnapshot() emits. `slots[n].lastAtMs`
// is when that cleric last CALLED (their cast start), which is the only
// "recently healed on the chain" signal we have.
//
// Six slots on a 3s beat = an 18s rotation, against a 9s exclusion window
// (6s DI cast + one beat). Slots 1-4 are inside it, 5 and 6 are clear. That
// ratio is the point: on a SHORT chain almost nobody is free, which is what
// the fallback path below exists for.
function chain(now, over = {}) {
  const slots = over.slots || {
    1: { name: 'Mcdorf',        mana: 60, lastAtMs: now - 6 * BEAT, count: 3, kind: null },
    2: { name: 'Stupidrichard', mana: 40, lastAtMs: now - 5 * BEAT, count: 3, kind: null },
    3: { name: 'Fargan',        mana: 55, lastAtMs: now - 4 * BEAT, count: 3, kind: null },
    4: { name: 'Bwavair',       mana: 45, lastAtMs: now - 3 * BEAT, count: 3, kind: null },
    5: { name: 'Emma',          mana: 70, lastAtMs: now - 2 * BEAT, count: 3, kind: null },
    6: { name: 'Aimey',         mana: 65, lastAtMs: now - 1 * BEAT, count: 3, kind: null },
  };
  const nums = Object.keys(slots).map(Number).sort((a, b) => a - b);
  const lastNum = over.last_num != null ? over.last_num : nums[nums.length - 1];
  return Object.assign({
    slots,
    beat_ms: BEAT,
    last_ch: { num: lastNum, name: slots[lastNum] && slots[lastNum].name, atMs: now - 1 * BEAT },
    next_num: nums[0],
    next_expected_at: now,     // slot 1 is due right now
  }, over.top || {});
}

// Default context: nothing known about anyone. Unknown class stays eligible —
// most of the raid's clerics will never run Mimic.
function ctx(now, over = {}) {
  return Object.assign({
    now,
    isDead:  () => false,
    classOf: () => null,
    diOf:    () => null,
    manaOf:  (lc, called) => (called == null ? null : called),
  }, over);
}

describe('the DI fire line — the one from the server source, not the invented ones', () => {
  it('matches the real StringID 1029 line, name-form, on a raw timestamped line', () => {
    const line = raw(new Date(), 'Fargan has been rescued by divine intervention!');
    const m = line.match(_DI_FIRED_RX);
    expect(m).toBeTruthy();
    expect(m[1]).toBe('Fargan');
  });

  it('captures the name CLEANLY — no leading space, no timestamp eaten', () => {
    // The `{s}`-eats-the-timestamp P1 (agent 3.5.44–3.5.53) is what this asserts
    // against: a name-keyed consumer is corrupted by either failure mode.
    const m = raw(new Date(), 'Uilnayar has been rescued by divine intervention!').match(_DI_FIRED_RX);
    expect(m[1]).toBe('Uilnayar');
    expect(m[1].startsWith(' ')).toBe(false);
    expect(m[1]).not.toMatch(/\d/);
  });

  it('does NOT match "survived divine intervention" — that line does not exist on Quarm', () => {
    // A failed death save emits NOTHING. This alternate circulates in trigger
    // packs and is invented, exactly like the three the design doc opens with.
    const line = raw(new Date(), 'Fargan survived divine intervention!');
    expect(_DI_FIRED_RX.test(line)).toBe(false);
  });

  it('is DROPPED by the byte filter — so the hook must run before shouldKeep', () => {
    // Not a nicety: the callout hook sits above the shouldKeep gate in the
    // watch loop precisely because this line never survives it. Move the hook
    // below the filter to "tidy up" and the whole feature goes silent with no
    // error anywhere — the same shape as the "you have taken" family, which
    // CLAUDE.md warns about for exactly this reason.
    const line = raw(new Date(), 'Fargan has been rescued by divine intervention!');
    expect(shouldKeep(line)).toBe(false);
    expect(_DI_FIRED_RX.test(line)).toBe(true);
  });

  it('does not fire on someone TALKING about it in chat', () => {
    const line = raw(new Date(), "Hitya tells the raid,  'who has been rescued by divine intervention lately'");
    // No trailing . or ! after "intervention" in the quoted chatter.
    expect(_DI_FIRED_RX.test(line)).toBe(false);
  });
});

describe('_diSlotTurnInMs — where each cleric sits in the rotation', () => {
  const now = 1_700_000_000_000;

  it('puts the on-deck slot at the chain\'s own expected-next time', () => {
    expect(_diSlotTurnInMs(chain(now), 1, now)).toBe(0);
  });

  it('walks one beat per slot down the rotation, wrapping at the top', () => {
    expect(_diSlotTurnInMs(chain(now), 2, now)).toBe(BEAT);
    expect(_diSlotTurnInMs(chain(now), 5, now)).toBe(4 * BEAT);
    expect(_diSlotTurnInMs(chain(now), 6, now)).toBe(5 * BEAT);
  });

  it('wraps correctly when the on-deck slot is mid-rotation', () => {
    // Slot 4 on deck: 4→0 beats, 5→1, 6→2, then round the top to 1→3.
    const c = chain(now, { top: { next_num: 4 } });
    expect(_diSlotTurnInMs(c, 4, now)).toBe(0);
    expect(_diSlotTurnInMs(c, 6, now)).toBe(2 * BEAT);
    expect(_diSlotTurnInMs(c, 1, now)).toBe(3 * BEAT);
  });

  it('returns null — not 0 — when the beat has not been measured', () => {
    // Null must stay distinguishable from "due now": one is ignorance, the
    // other is an exclusion. Collapsing them would silence the whole roster on
    // an unwarmed chain.
    const c = chain(now); c.beat_ms = null;
    expect(_diSlotTurnInMs(c, 2, now)).toBe(null);
  });
});

describe('_diRankCandidates — who we are willing to name', () => {
  const now = 1_700_000_000_000;

  it('names exactly two, which is the ask', () => {
    const out = _diRankCandidates(chain(now), ctx(now));
    expect(out.names.length).toBe(DI_CALLOUT_NAMES);
    expect(DI_CALLOUT_NAMES).toBe(2);
  });

  it('THE TRAP: excludes the cleric who is due to cast inside DI cast + a beat', () => {
    // Slot 1 is on deck. A 6s DI means they miss their CH, and a missed CH is
    // how tanks die — this is the ask's "not coming up on the CH chain within
    // the cast time plus global cooldown time".
    const out = _diRankCandidates(chain(now), ctx(now));
    expect(out.names).not.toContain('Mcdorf');          // due now
    expect(out.names).not.toContain('Stupidrichard');   // 3s out
    expect(out.names).not.toContain('Fargan');          // 6s out
    expect(out.names).not.toContain('Bwavair');         // 9s out — the boundary
    expect(out.fallback).toBe(false);
    expect(out.names).toEqual(['Emma', 'Aimey']);       // 12s and 15s out
  });

  it('THE TRAP: never names a druid gap-filling the chain — DI is cleric-only', () => {
    const c = chain(now);
    // A CH-equivalent auto-slot carries the `kind` label the chain tracker
    // stamps on it ("Druid CH"). That is local proof, not an inference — and
    // it has to be checked, because a druid on a free slot outranks everyone.
    c.slots[5] = { name: 'Pyxil', mana: 99, lastAtMs: now - 2 * BEAT, count: 2, kind: 'Druid CH' };
    const out = _diRankCandidates(c, ctx(now));
    expect(out.names).not.toContain('Pyxil');
    expect(out.names).toEqual(['Aimey']);
  });

  it('THE TRAP: never names a known non-Cleric, even without the kind label', () => {
    const out = _diRankCandidates(chain(now), ctx(now, {
      classOf: (lc) => (lc === 'emma' ? 'Shaman' : null),
    }));
    expect(out.names).not.toContain('Emma');
  });

  it('an UNKNOWN class is still eligible — most clerics will never run Mimic', () => {
    const out = _diRankCandidates(chain(now), ctx(now, { classOf: () => null }));
    expect(out.names.length).toBe(2);
  });

  it('THE TRAP: never names a corpse', () => {
    // The design doc lists "is this cleric actually alive" under what we cannot
    // know; the 3.5.58 death registry means we now can.
    const out = _diRankCandidates(chain(now), ctx(now, {
      isDead: (lc) => lc === 'emma',
    }));
    expect(out.names).not.toContain('Emma');
    expect(out.names).toEqual(['Aimey']);
  });

  it('THE TRAP: never names a cleric whose recast we WATCHED start', () => {
    // "Rank, don't filter" is about clerics we know nothing about. A measured
    // cooldown is a hard fact — naming them burns one of only two slots.
    const out = _diRankCandidates(chain(now), ctx(now, {
      diOf: (lc) => (lc === 'emma' ? { up: false, unknown: false, seconds: 42 } : null),
    }));
    expect(out.names).not.toContain('Emma');
  });

  it('ranks a CONFIRMED-ready DI above one we simply never saw', () => {
    const out = _diRankCandidates(chain(now), ctx(now, {
      // Emma has more mana, but Aimey's DI is confirmed up.
      diOf: (lc) => (lc === 'aimey' ? { up: true, unknown: false } : null),
    }));
    expect(out.names[0]).toBe('Aimey');
    expect(out.candidates[0].di).toBe('ready');
    // ...and the one we know nothing about says so, rather than claiming ready.
    expect(out.candidates[1].di).toBe('unknown');
  });

  it('breaks ties on mana, highest first — 500 mana is not nothing', () => {
    const c = chain(now);
    c.slots[5].mana = 20;    // Emma
    c.slots[6].mana = 95;    // Aimey
    const out = _diRankCandidates(c, ctx(now));
    expect(out.names[0]).toBe('Aimey');
  });

  it('prefers EXACT (Mimic) mana over the percentage shouted in the chain call', () => {
    const c = chain(now);
    c.slots[5].mana = 95;    // Emma shouted 95% two beats ago
    c.slots[6].mana = 50;
    const out = _diRankCandidates(c, ctx(now, {
      // ...but her Mimic reports 12% right now.
      manaOf: (lc, called) => (lc === 'emma' ? 12 : called),
    }));
    expect(out.names[0]).toBe('Aimey');
    expect(out.candidates.find(x => x.name === 'Emma').mana_pct).toBe(12);
  });

  it('falls back to the two most recent healers rather than going silent', () => {
    // A two-slot chain: both are inside the "about to cast" window, so the
    // clean pool is empty. Doc §3: ties and empty results resolve to the
    // chain roster's two most recent healers — never to silence.
    const slots = {
      1: { name: 'Emma',  mana: 70, lastAtMs: now - 2 * BEAT, count: 2, kind: null },
      2: { name: 'Aimey', mana: 65, lastAtMs: now - 1 * BEAT, count: 2, kind: null },
    };
    const out = _diRankCandidates(chain(now, { slots }), ctx(now));
    expect(out.fallback).toBe(true);
    expect(out.names.length).toBe(2);
    // Most recent first — Aimey called one beat ago, Emma two.
    expect(out.names[0]).toBe('Aimey');
  });

  it('the fallback still honors the hard exclusions', () => {
    const slots = {
      1: { name: 'Emma',  mana: 70, lastAtMs: now - 2 * BEAT, count: 2, kind: null },
      2: { name: 'Aimey', mana: 65, lastAtMs: now - 1 * BEAT, count: 2, kind: null },
    };
    const out = _diRankCandidates(chain(now, { slots }), ctx(now, {
      diOf: (lc) => (lc === 'aimey' ? { up: false, unknown: false, seconds: 30 } : null),
    }));
    expect(out.fallback).toBe(true);
    expect(out.names).toEqual(['Emma']);   // one honest name beats two, one of them wrong
  });

  it('skips a roster-seeded slot nobody has actually called yet', () => {
    const slots = {
      1: { name: 'Emma',   mana: null, lastAtMs: 0, count: 0, kind: null },   // announced, never called
      2: { name: 'Aimey',  mana: 65, lastAtMs: now - 6 * BEAT, count: 2, kind: null },
      3: { name: 'Rapha',  mana: 55, lastAtMs: now - 5 * BEAT, count: 2, kind: null },
    };
    const out = _diRankCandidates(chain(now, { slots }), ctx(now));
    expect(out.names).not.toContain('Emma');
  });

  it('drops NPC-shaped names — a backtick is not a character name', () => {
    const slots = {
      1: { name: 'Xin`Xakra', mana: 50, lastAtMs: now - 6 * BEAT, count: 2, kind: null },
      2: { name: 'Aimey',     mana: 65, lastAtMs: now - 5 * BEAT, count: 2, kind: null },
    };
    const out = _diRankCandidates(chain(now, { slots }), ctx(now));
    expect(out.names).toEqual(['Aimey']);
  });

  it('returns null when there is nobody to name at all', () => {
    expect(_diRankCandidates(null, ctx(now))).toBe(null);
    expect(_diRankCandidates({ slots: {} }, ctx(now))).toBe(null);
  });
});

describe('trackDiFired — end to end through the real chain tracker', () => {
  beforeEach(() => {
    _resetChChainForTest();
    _resetDiCalloutForTest();
    _activeOverlays.length = 0;
    ['emma', 'aimey', 'rapha', 'fargan'].forEach(_clearDeath);
  });

  // Build a live chain out of REAL shout lines, so the test rides the shipped
  // parser rather than a hand-made snapshot.
  function runChain(baseMs, callers) {
    callers.forEach((who, i) => {
      const d = new Date(baseMs + i * BEAT);
      trackChChainLine(raw(d, who.name + " shouts, '" + String(who.num).padStart(3, '0') +
        ' - CH - Naggato - Mana: ' + who.mana + "%'"), 'Watcher');
    });
  }

  it('a real fire line nominates two clerics and speaks ONE callout', () => {
    const base = Date.now() - 12 * BEAT;
    runChain(base, [
      { name: 'Emma',  num: 1, mana: 70 },
      { name: 'Aimey', num: 2, mana: 65 },
      { name: 'Rapha', num: 3, mana: 60 },
      { name: 'Emma',  num: 1, mana: 68 },
      { name: 'Aimey', num: 2, mana: 62 },
      { name: 'Rapha', num: 3, mana: 58 },
    ]);
    expect(chChainSnapshot()).toBeTruthy();

    const fired = trackDiFired(raw(new Date(), 'Fargan has been rescued by divine intervention!'));
    expect(fired).toBeTruthy();
    expect(fired.tank).toBe('Fargan');
    expect(fired.names.length).toBeGreaterThanOrEqual(1);
    expect(fired.names.length).toBeLessThanOrEqual(2);

    // Two names + the resolution protocol (Hitya 2026-08-11): the cleric who
    // takes it calls it on voice — the cue rides the callout itself.
    expect(fired.tts).toBe('D I down. ' + fired.names.join(' or ') + ' — caster call it.');
    // Exactly one fire pushed, on the existing trigger-overlay surface (no new
    // SpeechSynthesis path — the master TTS toggle still gates it downstream).
    expect(_activeOverlays.length).toBe(1);
    expect(_activeOverlays[0].trigger).toBe('DI DOWN');
    expect(_activeOverlays[0].tts).toBe(fired.tts);
    expect(_activeOverlays[0].text).toContain('Fargan');

    const snap = diCalloutSnapshot();
    expect(snap.names).toEqual(fired.names);
    expect(snap.seconds_left).toBeGreaterThan(0);
  });

  it('the same zone-visible line in a second boxed log does not double-fire', () => {
    const base = Date.now() - 12 * BEAT;
    runChain(base, [
      { name: 'Emma',  num: 1, mana: 70 },
      { name: 'Aimey', num: 2, mana: 65 },
      { name: 'Rapha', num: 3, mana: 60 },
      { name: 'Emma',  num: 1, mana: 68 },
    ]);
    const line = raw(new Date(), 'Fargan has been rescued by divine intervention!');
    expect(trackDiFired(line)).toBeTruthy();
    expect(trackDiFired(line)).toBe(null);     // main + alt log carry the identical line
    expect(_activeOverlays.length).toBe(1);
  });

  it('declines to invent a name when no chain is running', () => {
    // Silence HERE is not silence in the raid — the guild trigger still calls
    // "D I fired on {tank}". This is only the selector refusing to guess.
    expect(chChainSnapshot()).toBe(null);
    expect(trackDiFired(raw(new Date(), 'Fargan has been rescued by divine intervention!'))).toBe(null);
    expect(diCalloutSnapshot()).toBe(null);
    expect(_activeOverlays.length).toBe(0);
  });

  it('a dead cleric drops out of the nomination', () => {
    const base = Date.now() - 12 * BEAT;
    runChain(base, [
      { name: 'Emma',  num: 1, mana: 70 },
      { name: 'Aimey', num: 2, mana: 65 },
      { name: 'Rapha', num: 3, mana: 60 },
      { name: 'Emma',  num: 1, mana: 68 },
      { name: 'Aimey', num: 2, mana: 62 },
    ]);
    _noteDeath('Rapha', Date.now() - 5000);
    const fired = trackDiFired(raw(new Date(), 'Fargan has been rescued by divine intervention!'));
    expect(fired).toBeTruthy();
    expect(fired.names).not.toContain('Rapha');
  });
});
