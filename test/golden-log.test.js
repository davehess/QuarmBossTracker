// test/golden-log.test.js — #75, the golden-log regression net for the agent parser.
//
// WHAT THIS IS. `packages/wolfpack-logsync/index.js` turns EQ log lines into the
// combat events every downstream surface is built on — parse cards, DPS/tank
// meters, charm sessions, kill attribution, Supabase rollups. Until now a change
// to that parser was verified by an ad-hoc `node -e` harness and then, really,
// by a live raid. This replays a committed synthetic log through the SHIPPED
// pipeline and asserts a committed known-good result, so a regression is a red
// CI check instead of forty raiders with wrong numbers.
//
// FIDELITY. Nothing here re-implements the parser. `test/fixtures/golden/_replay.js`
// calls the real exported `shouldKeep` → `parseEvent` → `EncounterBuilder.add`
// → `flush` in the same order and with the same default pattern arrays as the
// shipped watch-tail. The agent module is require()-safe (it runs main() only
// when `require.main === module`) and exports these internals for tests.
//
// SYNTHETIC ONLY (docs/PRIVACY.md). Both fixture logs are hand-written. Every
// character name is invented, no real player log ever enters this repo, and the
// only tells/officer/group lines present are there to prove the privacy filter
// still drops them.
//
// WHEN THIS GOES RED. Either you broke the parser, or you changed it on purpose.
// If on purpose: `npm run golden:update`, then READ THE DIFF — each changed
// number is a change in what the raid's parses will say — and commit it with
// the code change so review sees both halves.
//
// See docs/DESIGN-75-golden-log.md for the design and the known gaps this
// fixture deliberately pins.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, AGENT_INDEX, ROOT } from './_source-slice.js';

const require_ = createRequire(import.meta.url);
const R = require_('./fixtures/golden/_replay.js');

const DIR = path.join(ROOT, 'test', 'fixtures', 'golden');
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));

const EXPECTED_PARSE     = readJson('expected-parse.json');
const EXPECTED_ENCOUNTER = readJson('expected-encounter.json');

// ── Tier A: per-line filter + parse ─────────────────────────────────────────
// One assertion per log line. `keep` (the privacy + combat filter verdict) is
// exact. The parsed event is compared with toMatchObject: a NEW field on an
// event passes (additive changes shouldn't force a golden churn), but a changed
// value, a removed field, or a changed type fails. Lines that parse to nothing
// must keep parsing to nothing.
describe('#75 golden log — per-line filter + parse', () => {
  for (const [logName, expectedRows] of Object.entries(EXPECTED_PARSE)) {
    describe(logName, () => {
      const actualRows = R.parseLines(logName);

      it('has the same line count as the golden', () => {
        expect(actualRows.length).toBe(expectedRows.length);
      });

      for (const exp of expectedRows) {
        const label = `L${exp.i + 1} ${exp.event ? exp.event.type : 'no-event'}: ${exp.line.slice(26, 96)}`;
        it(label, () => {
          const act = actualRows[exp.i];
          expect(act.line).toBe(exp.line);              // fixture drifted vs golden
          expect(act.keep).toBe(exp.keep);              // parse + upload gate (default DROP)
          expect(act.trigger_visible).toBe(exp.trigger_visible);  // trigger gate (default KEEP)
          if (exp.event === null) {
            expect(act.event).toBeNull();
          } else {
            expect(act.event).not.toBeNull();
            expect(act.event.type).toBe(exp.event.type);
            expect(act.event).toMatchObject(exp.event);
          }
        });
      }
    });
  }
});

// ── Tier A1: the privacy floor ──────────────────────────────────────────────
// Named separately from the per-line golden because this is the one class of
// regression that is worse than wrong numbers. The fixtures contain a /tell in
// both directions, officer chat, group chat, guild chat, a custom numbered
// channel, /say, /shout and /auction. Every one must be invisible to BOTH gates
// — the parse/upload gate and the trigger gate — with no golden update ever
// making that acceptable. docs/PRIVACY.md.
describe('#75 golden log — privacy floor', () => {
  const PRIVATE_SUBSTRINGS = [
    "tells you, 'i have the adds",      // incoming /tell
    "You told Torvahk,",                // outgoing /tell
    'tells the group,',                 // /g
    'tells Wolfpackofficer:1,',         // officer channel
    'tells General:2,',                 // custom numbered channel
    'You say to your group,',           // group /say
    'auctions,',                        // /auction
    'shouts,',                          // /shout
  ];

  // LIVE parse, deliberately NOT the committed golden. If this read
  // EXPECTED_PARSE, `npm run golden:update` could launder a privacy hole into
  // the repo and the suite would stay green. These assertions must be
  // unblessable — the only way to make them pass is for the agent to actually
  // drop the line.
  const allRows = Object.keys(EXPECTED_PARSE).flatMap((name) => R.parseLines(name));

  it.each(PRIVATE_SUBSTRINGS)('fixture actually contains a %j line', (needle) => {
    expect(allRows.some((r) => r.line.includes(needle))).toBe(true);
  });

  it('no private line survives either gate, and none of them parses', () => {
    const leaked = allRows
      .filter((r) => PRIVATE_SUBSTRINGS.some((s) => r.line.includes(s)))
      .filter((r) => r.keep || r.trigger_visible || r.event);
    expect(leaked.map((r) => r.line)).toEqual([]);
  });

  it('guild chat is deliberately NOT private — it is the /gu relay', () => {
    // CLAUDE.md § scope boundaries: /gu + /rs collection is in scope; the chat
    // path uploads it and triggers are allowed to watch it. It must still never
    // reach the PARSE path (keep=false) or become a combat event.
    const gu = allRows.filter((r) => r.line.includes('tells the guild,'));
    expect(gu.length).toBeGreaterThan(0);
    expect(gu.every((r) => r.trigger_visible === true)).toBe(true);
    expect(gu.every((r) => r.keep === false && r.event === null)).toBe(true);
  });
});

// ── Tier A2: family coverage ────────────────────────────────────────────────
// The per-line tier only proves the lines we wrote still parse the way they did.
// This proves we did not FORGET a family: every `type: '…'` literal parseEvent
// can emit must be exercised by one of the golden logs. Adding a new event
// family without a golden line for it fails here — deliberately, because an
// unexercised family is exactly the one that silently breaks.
describe('#75 golden log — parseEvent family coverage', () => {
  const parseEventSrc = sliceBlock(
    readSource(AGENT_INDEX),
    'function parseEvent(line, ts) {',
    '\n// ── Character name from filename',
  );
  const emittedTypes = [...new Set(
    [...parseEventSrc.matchAll(/\btype:\s*'([a-z_]+)'/g)].map((m) => m[1]),
  )].sort();

  const coveredTypes = [...new Set(
    Object.values(EXPECTED_PARSE).flat().filter((r) => r.event).map((r) => r.event.type),
  )].sort();

  it('found the real parseEvent block in the shipped agent', () => {
    expect(emittedTypes.length).toBeGreaterThan(15);
    expect(emittedTypes).toContain('damage');
    expect(emittedTypes).toContain('who');
  });

  it('every event family parseEvent can emit appears in a golden log', () => {
    const missing = emittedTypes.filter((t) => !coveredTypes.includes(t));
    expect(missing).toEqual([]);
  });
});

// ── Tier B: whole-encounter replay ──────────────────────────────────────────
// The aggregate half. Per-line parsing can be perfect while aggregation is
// wrong — DS attribution, charm sessions, pet-owner resolution, the killing-blow
// credit, and the per-skill rollup all live in EncounterBuilder, not parseEvent.
// The digest is a projection this suite owns (see _replay.js), which is what
// makes an exact toEqual safe: additive payload fields can't reach it, so it
// only moves when a real number moves.
describe('#75 golden log — encounter replay', () => {
  const payloads = R.replayEncounter('raid-pull.log');

  it('flushes exactly one encounter', () => {
    expect(payloads).toHaveLength(1);
  });

  it('matches the golden encounter digest', () => {
    expect(R.digestEncounter(payloads[0])).toEqual(EXPECTED_ENCOUNTER);
  });

  // Spelled-out invariants. The digest above would catch all of these, but a
  // failing `toEqual` on a 300-line object does not tell you WHICH behavior
  // broke. These name the load-bearing ones so the failure reads as a sentence.
  const d = () => R.digestEncounter(payloads[0]);

  it('identifies the boss from the death line, not the top-damage guess', () => {
    expect(d().boss_name).toBe('Lord of Ire');
    expect(d().confirmed_kill).toBe(true);
  });

  it('credits a charmed-pet killing blow to the charmer, not the top parser', () => {
    // "Lord of Ire has been slain by a fear touched drolvarg!" — the slayer is
    // our charm pet, so kill_credit must resolve through petLeaders to Sylvarra.
    expect(d().kill_slayer).toBe('a fear touched drolvarg');
    expect(d().kill_credit).toBe('Sylvarra');
  });

  it('attributes charm-pet damage to the owner in pet_leaders', () => {
    expect(d().pet_leaders['a fear touched drolvarg']).toBe('Sylvarra');
    expect(d().pet_leaders.gobn).toBe('Orvo');   // "Gobn says, 'My leader is Orvo.'"
  });

  it('opens a second charm session after the charm breaks', () => {
    const sessions = d().charm_sessions;
    expect(sessions).toHaveLength(2);
    expect(sessions.map((s) => s.end_reason).sort()).toEqual(['charm_break', 'encounter_flush']);
    expect(sessions.every((s) => s.owner === 'Sylvarra')).toBe(true);
  });

  it('tracks the tank’s avoidance breakdown separately per verb', () => {
    const tank = d().defenders.find((x) => x.name === 'Torvahk');
    expect(tank).toMatchObject({ parries: 1, ripostes: 1, dodges: 1, blocks: 1, damageTaken: 1187 });
  });

  it('records the damage-shield reflect against the DS wearer', () => {
    expect(d().ds_reflects['legacy of spike']).toMatchObject({ count: 1, total: 24 });
  });

  it('rolls damage up per character and per skill', () => {
    expect(d().rollup.Draggomir.by_skill['Ice Comet']).toEqual({ hits: 1, dmg: 1104 });
    expect(d().rollup.Brambleth.by_skill['ds:legacy of spike']).toEqual({ hits: 1, dmg: 24 });
  });

  it('trims the fight to active combat seconds and flags the raid window', () => {
    expect(d().active_duration_s).toBe(47);
    expect(d().is_raid_window).toBe(true);   // Sun 20:41 ET is inside Sun/Wed/Thu 20:30–23:30
  });

  it('never leaks a private line into the encounter', () => {
    // Tells, officer channel, group chat and guild chat are all present in the
    // fixture. None of their text may appear anywhere in the uploaded payload.
    const blob = JSON.stringify(payloads[0]);
    for (const secret of ['dont break my mez', 'selos up', 'ch chain starting',
                          'watch the drolvarg adds', 'res inc on Fenrisk']) {
      expect(blob).not.toContain(secret);
    }
  });
});

// ── FIXED GAPS (were pinned broken by #75, fixed by #75-followup) ───────────
// These four were shipped as `KNOWN GAP:` pins by #75: parseEvent handled each
// line, but the shipped pipeline never delivered it, so the handler was dead
// code in the live tail. The agent fix (three KEEP_PATTERNS entries + one
// timestamp coercion) turned them on; the pins are flipped to assert the
// CORRECT behavior so a regression re-breaks a named test.
//
// The digest assertions deliberately read the LIVE replay, not
// EXPECTED_ENCOUNTER — same reasoning as the privacy floor above: reading the
// blessed file would let `npm run golden:update` quietly re-bless the defect.
// Full write-up: docs/DESIGN-75-golden-log.md § "Known gaps this pins".
describe('#75 golden log — FIXED GAPS (assert the fix, not the defect)', () => {
  const keep = (line) => R.agent.shouldKeep(line);
  const T = '[Sun Aug 02 20:41:03 2026] ';
  const live = () => R.digestEncounter(R.replayEncounter('raid-pull.log')[0]);

  it('FIXED: the Quarm two-line DS flavor line reaches the parser and retags the hit', () => {
    // parseEvent emits ds_flavor, which retags the buffered DS hit with the
    // real spell name. KEEP_PATTERNS now matches the flavor line, so the retag
    // actually happens in the live tail: the DS bucket is named for the spell
    // and the 'non-melee' catch-all is gone.
    const line = T + 'Lord of Ire was pierced by thorns.';
    expect(R.agent.parseEvent(line, new Date()).type).toBe('ds_flavor');
    expect(keep(line)).toBe(true);
    const ds = live().ds_reflects;
    expect(Object.keys(ds)).toContain('thorns');
    expect(Object.keys(ds)).not.toContain('non-melee');
    expect(ds.thorns).toMatchObject({ count: 1, total: 14 });
  });

  it('FIXED: bystander exceptional heals reach the parser (the crit-heal leaderboard input)', () => {
    const line = T + 'Kaelthorne performs an exceptional heal! (2455)';
    expect(R.agent.parseEvent(line, new Date()).type).toBe('crit_heal');
    expect(keep(line)).toBe(true);
    expect(live().events_by_type.crit_heal).toBe(1);
  });

  it('FIXED: spell crits are kept alongside melee crits', () => {
    const spell = T + 'Draggomir delivers a critical blast!(1840)';
    const melee = T + 'Torvahk scores a critical hit!(412)';
    const self  = T + 'You deliver a critical blast!(1840)';
    expect(R.agent.parseEvent(spell, new Date()).kind).toBe('spell');
    expect(keep(spell)).toBe(true);
    expect(keep(melee)).toBe(true);
    expect(keep(self)).toBe(true);
    expect(live().events_by_type.critical).toBe(2);   // one melee + one spell
  });

  it('FIXED: charm-session duration_sec is a real number of seconds', () => {
    // Was NaN — EncounterBuilder subtracted two ISO STRINGS, and
    // JSON.stringify turns NaN into `null`, so the bot recorded "no duration"
    // for every charm session. Both golden sessions now carry a duration.
    const sessions = live().charm_sessions;
    expect(sessions).toHaveLength(2);
    expect(sessions.every((s) => typeof s.duration_sec === 'number')).toBe(true);
    expect(sessions.every((s) => Number.isFinite(s.duration_sec) && s.duration_sec > 0)).toBe(true);
  });
});

// ── KNOWN GAPS ──────────────────────────────────────────────────────────────
// Still pinned as broken, deliberately: a behavior the golden records so that
// fixing it shows up as a named red test rather than a mystery diff in a
// 1300-line JSON. Full write-up: docs/DESIGN-75-golden-log.md § "Known gaps".
describe('#75 golden log — KNOWN GAPS (pinned, not endorsed)', () => {
  const T = '[Sun Aug 02 20:41:03 2026] ';

  it('KNOWN GAP: two of three Dire Charm cast forms are shadowed by the cast matcher', () => {
    const ts = new Date();
    // Only "<Name> begins casting Dire Charm." reaches dire_charm_cast; the
    // self form and the "begins to cast" form are claimed by the earlier
    // generic cast matchers, so the AA is mislabelled as a regular charm.
    expect(R.agent.parseEvent(T + 'Nyxaria begins casting Dire Charm.', ts).type).toBe('dire_charm_cast');
    expect(R.agent.parseEvent(T + 'You begin casting Dire Charm.', ts).type).toBe('cast');
    expect(R.agent.parseEvent(T + 'Nyxaria begins to cast Dire Charm.', ts).type).toBe('cast');
  });
});
