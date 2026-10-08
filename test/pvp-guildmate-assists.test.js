// PvP assists for guildmates our agents see (the guild lead, 2026-09-27):
//   "credit assists to guildmates our agents see. we should also attribute when a guild member
//    has cast non-damage on those characters and expand the timeframe to 4 minutes..
//    make sure all of this can be parsed through vis opt-in-logs"
// Before this, an assist came only from the assister's OWN log, so two raiders without Mimic
// had kills but no assists on a night full of them.
//
// Run: npx vitest run test/pvp-guildmate-assists.test.js

import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, stripJs, AGENT_INDEX } from './_source-slice.js';

let agent;
beforeAll(() => { agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js'); });

// Invented names (none of them is anybody). The log is Aldenmar's.
const T0 = Date.parse('2026-09-26T05:20:00Z');
const stamp = (sec) => {
  const d = new Date(T0 + sec * 1000);
  const p = (n) => String(n).padStart(2, '0');
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const mons = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `[${days[d.getDay()]} ${mons[d.getMonth()]} ${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ${d.getFullYear()}]`;
};
function builder() {
  return new agent.EncounterBuilder({ character: 'Aldenmar', silent: true, onFlush: () => {} });
}
// Feed a combat line the way both loops do: parseEvent, then add().
function hit(b, sec, text) {
  const line = `${stamp(sec)} ${text}`;
  const ev = agent.parseEvent(line, new Date(T0 + sec * 1000));
  expect(ev, text).toBeTruthy();
  ev.ts = new Date(T0 + sec * 1000).toISOString();
  b.add(ev);
}
const death = (sec, victim, killer, over) => Object.assign({
  killType: 'pvp', victim, victimGuild: 'Zek', killer, killerGuild: 'Wolf Pack', zone: 'Vex Thal',
  ts: new Date(T0 + sec * 1000).toISOString(), text: `${victim} of <Zek> has been killed in combat by ${killer}`,
}, over);
const who = (rows) => rows.map(r => `${r.assister}:${r.evidence}`).sort();

describe('damage we SEE counts, not only our own', () => {
  it('every player on the victim is credited; the killer and the victim are not', () => {
    const b = builder();
    hit(b, 0, 'Brackwyn slashes Velisblacksword for 45 points of damage.');
    hit(b, 2, 'You slash Velisblacksword for 12 points of damage.');
    hit(b, 3, 'Corvale crushes Velisblacksword for 60 points of damage.');
    hit(b, 4, 'Velisblacksword slashes Brackwyn for 30 points of damage.');   // the victim swinging back
    const rows = b._checkPvpAssists(death(10, 'Velisblacksword', 'Corvale'), { source: 'live_agent' });
    expect(who(rows)).toEqual(['Aldenmar:damage', 'Brackwyn:damage']);
    expect(rows[0]).toMatchObject({ victim: 'Velisblacksword', killer: 'Corvale', source: 'live_agent', zone: 'Vex Thal' });
  });

  it('a pet\'s hit is its owner\'s: a warder by name, any pet by its "My leader is" line', () => {
    const b = builder();
    hit(b, 0, 'Brackwyn`s warder bites Velisblacksword for 30 points of damage.');
    b.petLeaders['gabartik'] = 'Rethlan';
    hit(b, 1, 'Gabartik hits Velisblacksword for 25 points of damage.');
    expect(who(b._checkPvpAssists(death(5, 'Velisblacksword', 'Corvale')))).toEqual(['Brackwyn:damage', 'Rethlan:damage']);
  });

  it('the window is 4 minutes: 3m50s before the death counts, 4m10s does not', () => {
    const b = builder();
    hit(b, 0, 'Brackwyn slashes Velisblacksword for 45 points of damage.');
    hit(b, 20, 'Rethlan slashes Velisblacksword for 45 points of damage.');
    const rows = b._checkPvpAssists(death(250, 'Velisblacksword', 'Corvale'));
    expect(who(rows)).toEqual(['Rethlan:damage']);
    expect(rows[0].gap_seconds).toBe(230);
  });

  it('hits on names that never die in a broadcast age out instead of piling up', () => {
    // Every raider's hits on every single-word mob land in the window now.
    const b = builder();
    const alpha = (i) => 'Mob' + [...String(i)].map(d => 'abcdefghij'[+d]).join('');
    for (let i = 0; i < 600; i++) hit(b, i, `Brackwyn slashes ${alpha(i)} for 10 points of damage.`);
    expect(b._pvpAssistWindow.size).toBeLessThan(400);   // ~240 s worth, not all 600
    expect(b._pvpAssistWindow.has(alpha(599).toLowerCase())).toBe(true);
  });

  it('our own kill is a kill, and one death uses the evidence up', () => {
    const b = builder();
    hit(b, 0, 'You slash Velisblacksword for 12 points of damage.');
    hit(b, 1, 'Brackwyn slashes Velisblacksword for 45 points of damage.');
    expect(who(b._checkPvpAssists(death(5, 'Velisblacksword', 'Aldenmar')))).toEqual(['Brackwyn:damage']);
    expect(b._checkPvpAssists(death(6, 'Velisblacksword', 'Corvale'))).toEqual([]);
  });
});

describe('non-damage spells on the victim count too', () => {
  // The landing index and cast times come from the spell catalog, which a test
  // does not have — the builder takes them through two seams.
  const SLOW = { target: 'Velisblacksword', spell_name: "Turgur's Insects", family: ["Turgur's Insects", 'Drowsy'] };
  function caster(castMs) {
    const b = builder();
    b._pvpParseLanding = (line) => (/Velisblacksword yawns\.$/.test(line) ? SLOW
      : /Aldenmar yawns\.$/.test(line) ? { ...SLOW, target: 'Aldenmar' }
      : /a grimling yawns\.$/.test(line) ? { ...SLOW, target: 'a grimling' } : null);
    b._pvpCastMs = (n) => (castMs && castMs[n] != null ? castMs[n] : NaN);
    return b;
  }
  const line = (b, sec, text) => b._pvpAssistLine(`${stamp(sec)} ${text}`);

  it('our own cast of the spell that landed is ours', () => {
    const b = caster({});
    line(b, 0, "You begin casting Turgur's Insects.");
    line(b, 5, 'Velisblacksword yawns.');
    expect(who(b._checkPvpAssists(death(20, 'Velisblacksword', 'Corvale')))).toEqual(['Aldenmar:spell']);
  });

  it('someone else\'s: the cast start whose timing matches the spell\'s cast time', () => {
    const b = caster({ "turgur's insects": 5000, drowsy: 2000 });
    // Both starts fit a family member. Brackwyn's 5 s lead sits deeper inside
    // Turgur's tolerance (±1.75 s, 35% of 5 s) than Rethlan's 2 s does inside
    // Drowsy's (±1.5 s), so the landing is Brackwyn's.
    line(b, 0, 'Brackwyn begins to cast a spell.');
    line(b, 3, 'Rethlan begins to cast a spell.');
    line(b, 5, 'Velisblacksword yawns.');
    // Each start is used once: at 12 s Rethlan's start is 9 s old, which fits
    // neither spell, and Brackwyn's is spent — so nobody is credited again.
    line(b, 12, 'Velisblacksword yawns.');
    expect(who(b._checkPvpAssists(death(30, 'Velisblacksword', 'Corvale')))).toEqual(['Brackwyn:spell']);
  });

  it('the start that fits the spell wins over a more recent one that does not', () => {
    const b = caster({ "turgur's insects": 5000 });
    line(b, 0, 'Brackwyn begins to cast a spell.');   // 5 s before: a 5 s cast
    line(b, 4, 'Rethlan begins to cast a spell.');    // 1 s before: too quick for it
    line(b, 5, 'Velisblacksword yawns.');
    expect(who(b._checkPvpAssists(death(30, 'Velisblacksword', 'Corvale')))).toEqual(['Brackwyn:spell']);
  });

  it('a long cast gets 35% slack (spell haste): 2 s off a 6 s cast still fits', () => {
    const b = caster({ "turgur's insects": 6000 });
    line(b, 0, 'Brackwyn begins to cast a spell.');
    line(b, 8, 'Velisblacksword yawns.');
    expect(who(b._checkPvpAssists(death(30, 'Velisblacksword', 'Corvale')))).toEqual(['Brackwyn:spell']);
  });

  it('one cast lands once: a second landing cannot reuse the same start', () => {
    const b = caster({ "turgur's insects": 5000 });
    b._pvpParseLanding = (l) => { const m = /\] (\w+) yawns\.$/.exec(l); return m ? { ...SLOW, target: m[1] } : null; };
    line(b, 0, 'Brackwyn begins to cast a spell.');
    line(b, 5, 'Velisblacksword yawns.');
    line(b, 6, 'Jahpotheosis yawns.');
    expect(who(b._checkPvpAssists(death(30, 'Velisblacksword', 'Corvale')))).toEqual(['Brackwyn:spell']);
    expect(b._checkPvpAssists(death(31, 'Jahpotheosis', 'Corvale'))).toEqual([]);
  });

  it('our cast of a different spell does not claim the landing', () => {
    const b = caster({ "turgur's insects": 5000 });
    line(b, 0, 'Brackwyn begins to cast a spell.');
    line(b, 2, 'You begin casting Complete Heal.');
    line(b, 5, 'Velisblacksword yawns.');
    expect(who(b._checkPvpAssists(death(30, 'Velisblacksword', 'Corvale')))).toEqual(['Brackwyn:spell']);
  });

  it('a start whose timing fits no family member is not credited', () => {
    const b = caster({ "turgur's insects": 5000, drowsy: 2000 });
    line(b, 0, 'Brackwyn begins to cast a spell.');   // 11 s before the landing
    line(b, 11, 'Velisblacksword yawns.');
    expect(b._checkPvpAssists(death(30, 'Velisblacksword', 'Corvale'))).toEqual([]);
  });

  it('with no cast time known, the most recent start inside 7 s', () => {
    const b = caster({});
    line(b, 0, 'Brackwyn begins to cast a spell.');
    line(b, 4, 'Rethlan begins to cast a spell.');
    line(b, 6, 'Velisblacksword yawns.');
    expect(who(b._checkPvpAssists(death(30, 'Velisblacksword', 'Corvale')))).toEqual(['Rethlan:spell']);
  });

  it('a landing on us, or on a mob, is not PvP evidence', () => {
    const b = caster({});
    line(b, 0, 'Brackwyn begins to cast a spell.');
    line(b, 2, 'Aldenmar yawns.');
    line(b, 3, 'a grimling yawns.');
    expect(b._checkPvpAssists(death(30, 'Aldenmar', 'Corvale'))).toEqual([]);
    expect(b._pvpAssistWindow.size).toBe(0);
  });

  it('hits and a spell from the same player make one assist with both kinds', () => {
    const b = caster({ "turgur's insects": 5000 });
    hit(b, 0, 'Brackwyn slashes Velisblacksword for 45 points of damage.');
    line(b, 1, 'Brackwyn begins to cast a spell.');
    line(b, 6, 'Velisblacksword yawns.');
    expect(who(b._checkPvpAssists(death(30, 'Velisblacksword', 'Corvale')))).toEqual(['Brackwyn:damage+spell']);
  });
});

describe('the live tail and the opt-in-log backfill run the same evidence', () => {
  const src = readSource(AGENT_INDEX);
  it('a replayed log\'s assists go up 200 at a time (the bot refuses a body over 256 KB)', () => {
    const posts = [];
    const upload = new Function('enqueueUpload', 'AGENT_VERSION',
      sliceBlock(src, 'function uploadPvpAssists(assists, { botUrl, token, dryRun }) {', '\n}\n') + '\nreturn uploadPvpAssists;')(
      (kind, body) => posts.push([kind, body.assists.length]), '3.7.29');
    upload(Array.from({ length: 450 }, (_, i) => ({ assister: 'Brackwyn', victim: 'V' + i })), {});
    expect(posts).toEqual([['pvp_assists', 200], ['pvp_assists', 200], ['pvp_assists', 50]]);
  });
  it('backfill: the spell hook runs before shouldKeep drops landings, and every assist is kept', () => {
    const cb = stripJs(sliceBlock(src, 'const hailEvt = parseWitnessedHail(line, f.character);', 'if (!shouldKeep(line)) return;'));
    expect(cb).toMatch(/builder\._pvpAssistLine\(line\)/);
    expect(cb).toMatch(/builder\._checkPvpAssists\(pvpBcast, \{ source: 'log_backfill' \}\)[\s\S]*for \(const a of assists\) pvpAssistBuffer\.push\(a\)/);
  });
  it('live: the same hook on every line, and every assist is kept', () => {
    const live = stripJs(sliceBlock(src, 'if (!_sourceExcluded) noteHealLandLine(line);', 'noteCasterStart(line);'));
    expect(live).toMatch(/b\.builder\._pvpAssistLine\(line\)/);
    const bc = stripJs(sliceBlock(src, "b.builder._checkPvpAssists(pvpBcast, { source: 'live_agent' })", 'catch (e)'));
    expect(bc).toMatch(/for \(const assist of assists\)[\s\S]*pvpAssistBuffer\.push\(assist\)/);
  });
});
