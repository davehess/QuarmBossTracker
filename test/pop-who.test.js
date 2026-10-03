// test/pop-who.test.js — PoP flags from /who (the guild lead, 2026-10-01: "from /who in the zone for
// users that don't have mimic, and if they're in that zone that requires other zones we should note
// it"), and the checklist's progression levels, closed by default, with a map on hover ("make the
// items a checklist style instead of just a big block of text. group them by the progression level and
// give us a side bar in that page. collapse them as well by default. in live map images when you roll
// over the map icon on the guide page").
//
// The rules (web/lib/popWho.ts, web/lib/popGuideAuto.ts) and the levels run for real; the page wiring
// is read as stripped source.
//
// Run: npx vitest run test/pop-who.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, stripJs } from './_source-slice.js';
import { POP_ZONES, POP_FLAGS } from '../web/lib/popFlags.ts';
import { WHO_ZONE, WAY_IN, GATE_IMPLIES, whoProves, wayInChain, flagsFromSightings, seenText } from '../web/lib/popWho.ts';
import { guideEvidence } from '../web/lib/popGuideAuto.ts';
import { GUIDE_SECTIONS } from '../web/lib/popGuide.ts';
import { GUIDE_LEVELS } from '../web/lib/popGuideMore.ts';

const require = createRequire(import.meta.url);
const { STAGE_IMPLIES, ZONE_BY_ID } = require('../utils/popFlagStages.js');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const sight = (zone, first = '2026-10-01T20:13:44Z') => ({ zone, first_seen: first, last_seen: first });
const NO_DATA = { flags: [], loots: [], inventory: null, level: null, levelAt: null, spellbook: false, liveAt: null };

describe('which flags a sighting proves', () => {
  it('Storms and Valor: the Justice flag, and nothing more', () => {
    expect(whoProves('storms')).toEqual(['trial_justice']);
    expect(whoProves('valor')).toEqual(['trial_justice']);
  });
  it('the Bastion of Thunder: the shrine, and the Justice flag of the Storms you came through', () => {
    expect(new Set(whoProves('bot'))).toEqual(new Set(['askr_quest', 'trial_justice']));
    expect(wayInChain('bot')).toEqual(['storms']);
  });
  it('Torment: both thank-yous, and every kill they follow, down to Grummus and the hedge', () => {
    expect(new Set(whoProves('torment'))).toEqual(new Set([
      'fuirstel_5', 'thelin_4', 'grummus_dead', 'bert_dead', 'carprin_cycle', 'hedge_event', 'tthule_dead',
    ]));
  });
  it('the Temple of Marr: the trials, Aerin`Dar and the Justice flag, through Honor and Valor', () => {
    expect(new Set(whoProves('hohb'))).toEqual(new Set(['hoh_trials', 'aerindar_dead', 'trial_justice']));
    expect(wayInChain('hohb')).toEqual(['hoh', 'valor']);
  });
  it('a plane behind another proves that plane’s gate too (Doomfire is reached from the Sol Ro tower)', () => {
    const fire = new Set(whoProves('fire'));
    for (const f of ['solro_dead', 'cipher_1', 'zeks_6', 'saryrn_dead', 'marr_dead', 'tallon_dead']) expect(fire.has(f), f).toBe(true);
    for (const z of Object.keys(WAY_IN)) {
      const before = new Set(whoProves(WAY_IN[z]));
      const here = new Set(whoProves(z));
      for (const f of before) expect(here.has(f), `${z} via ${WAY_IN[z]}: ${f}`).toBe(true);
    }
  });
  it('every flag it names is in the catalog, and the open tier proves nothing', () => {
    for (const z of POP_ZONES) for (const f of whoProves(z.key)) expect(POP_FLAGS[f], `${z.key}: ${f}`).toBeTruthy();
    for (const z of ['justice', 'innovation', 'disease', 'nightmare']) expect(whoProves(z)).toEqual([]);
  });
  it('every gated plane has a /who name, and every /who name is a real PoP zone of the server', () => {
    // Short names (/who all) are the bot's zone ids' names; long names (a plain /who's footer, which
    // the agent lower-cases) are the agent's own eqemu_zone names table.
    const shorts = new Set(Object.values(ZONE_BY_ID));
    const agentSrc = fs.readFileSync(path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js'), 'utf8');
    const table = agentSrc.match(/const ZONE_NAMES = \{\n([^\n]+)\n\};/)[1];
    const longs = new Set([...table.matchAll(/\d+:(['"])(.*?)\1/g)].map(m => m[2].toLowerCase()));
    for (const s of Object.keys(WHO_ZONE)) expect(s.includes(' ') ? longs.has(s) : shorts.has(s), s).toBe(true);
    expect(whoProves(WHO_ZONE['plane of storms'])).toEqual(['trial_justice']);
    const mapped = new Set(Object.values(WHO_ZONE));
    // The lower crypt is the same zone as the upper, so it has no name of its own.
    for (const z of POP_ZONES.filter(z => z.requires.length && z.key !== 'codb')) expect(mapped.has(z.key), z.key).toBe(true);
    for (const z of Object.keys(WAY_IN)) expect(POP_ZONES.some(p => p.key === z), z).toBe(true);
  });
  it('a gate step proves what the bot says it proves (STAGE_IMPLIES), so the two cannot drift', () => {
    for (const [stage, flags] of Object.entries(GATE_IMPLIES)) expect(flags, stage).toEqual(STAGE_IMPLIES[stage]);
    // Every server step used as a gate is covered.
    const gateSteps = new Set(POP_ZONES.flatMap(z => z.requires).filter(f => STAGE_IMPLIES[f]));
    for (const f of gateSteps) expect(GATE_IMPLIES[f], f).toBeTruthy();
  });
});

describe('a character’s sightings', () => {
  it('each flag keeps its earliest sighting; instanced copies and the open planes add nothing', () => {
    const m = flagsFromSightings([
      sight('bothunder', '2026-10-02T01:00:00Z'),
      sight('postorms', '2026-10-01T20:00:00Z'),
      sight('Plane of Fear (Instanced)'),
      sight('pojustice'),
    ]);
    expect([...m.keys()].sort()).toEqual(['askr_quest', 'trial_justice']);
    expect(m.get('trial_justice')).toEqual({ flag: 'trial_justice', zone: 'storms', at: '2026-10-01T20:00:00Z' });
    expect(m.get('askr_quest').zone).toBe('bot');
  });
  it('says where, and the plane they came through', () => {
    expect(seenText('bot')).toBe('Seen on /who in Bastion of Thunder, reached through Plane of Storms.');
    expect(seenText('storms')).toBe('Seen on /who in Plane of Storms.');
  });
});

describe('the checklist fills in from /who', () => {
  it('a character seen in Storms has the Justice steps done, labelled as seen on /who', () => {
    const ev = guideEvidence({ ...NO_DATA, seen: [sight('postorms')] });
    for (const k of ['flag_trial_justice', 'justice_mavuin_info', 'justice_tribunal', 'justice_mavuin_hail']) {
      expect(ev[k]?.source, k).toBe('who');
      expect(ev[k].what).toMatch(/Seen on \/who in Plane of Storms/);
    }
    expect(ev.flag_askr).toBeUndefined();
  });
  it('Mimic’s own record still wins where it has one', () => {
    const ev = guideEvidence({ ...NO_DATA, flags: [{ flag_key: 'trial_justice', earned_at: '2026-10-01T19:00:00Z' }], seen: [sight('postorms')] });
    // The recorded Justice flag is the Mavuin hail's now (2026-10-03); the trial step, which no longer owns
    // the flag, still ticks from /who along with the Tribunal.
    expect(ev.justice_mavuin_hail.source).toBe('mimic');
    expect(ev.flag_trial_justice.source).toBe('who');
    expect(ev.justice_tribunal.source).toBe('who');
  });
  it('a recorded flag alone does not tick the Tribunal steps (it can come from the trial kill)', () => {
    const ev = guideEvidence({ ...NO_DATA, flags: [{ flag_key: 'trial_justice', earned_at: null }] });
    expect(ev.justice_tribunal).toBeUndefined();
  });
});

describe('the checklist by progression level', () => {
  it('every section sits in exactly one level, in the page’s order', () => {
    const order = GUIDE_LEVELS.flatMap(l => l.sections);
    expect(order).toEqual(GUIDE_SECTIONS.map(s => s.key));
    expect(GUIDE_LEVELS.map(l => l.key)).toEqual(['before', 't1', 't2', 't3', 't4', 'time']);
  });
  it('the tiers are the /pop chart’s, naming their planes', () => {
    const t2 = GUIDE_LEVELS.find(l => l.key === 't2');
    expect(t2.title).toBe('Tier Two');
    expect(t2.sub).toMatch(/Storms · Valor/);
  });

  const route = stripJs(read('web/app/pop/guide/GuideRoute.tsx'));
  it('every level starts closed, and the sidebar opens the one you pick', () => {
    expect(route).toMatch(/const \[open, setOpen\] = useState<Set<string>>\(\(\) => new Set\(\)\);/);
    expect(route).toMatch(/onClick=\{e => goTo\(l\.key, `lvl-\$\{l\.key\}`, e\)\}/);
    expect(route).toMatch(/setOpen\(prev => new Set\(prev\)\.add\(levelKey\)\);/);
    expect(route).toMatch(/aria-expanded=\{isOpen\}/);
    expect(route).toMatch(/\{isOpen && \(\s*<div id=\{`lvl-body-\$\{l\.key\}`\}/);
  });
  it('a closed level still says how far along you are and what is next', () => {
    expect(route).toMatch(/\{n\}\/\{items\.length\} done/);
    expect(route).toMatch(/\{!isOpen && next && \(/);
  });
  it('🗺 on a row and 📍 in a step’s detail show the zone map on hover', () => {
    expect(route).toMatch(/<MapPeek places=\{places\} outlines=\{outlines\}/);
    expect(route).toMatch(/<MapPeek places=\{\[l\]\} outlines=\{outlines\}/);
    expect(route).toMatch(/onPointerEnter=\{e => \{ if \(isMouse\(e\)\) show\(\); \}\}/);
    // A click with a mouse must not undo the hover; touch toggles.
    expect(route).toMatch(/onClick=\{\(\) => \{ if \(pointer\.current !== 'mouse'\)/);
  });
  it('the sidebar names the planes /who has placed you in', () => {
    expect(route).toMatch(/Seen on \/who in \{char\.seenIn\.map/);
    expect(read('web/app/pop/guide/routeData.ts')).toMatch(/admin\.rpc\('pop_who_sightings'/);
  });
});

describe('the database side', () => {
  const sql = read('supabase/migrations/20261002010000_pop_who_sightings.sql');
  it('groups per character and zone, skips GMs, and only the service role may call it', () => {
    expect(sql).toMatch(/group by lower\(w\.character\), w\.zone/);
    expect(sql).toMatch(/coalesce\(w\.gm, false\) = false/);
    expect(sql).toMatch(/revoke all on function public\.pop_who_sightings\(text, text\[\], text\[\]\) from public, anon, authenticated;/);
    expect(sql).toMatch(/grant execute on function public\.pop_who_sightings\(text, text\[\], text\[\]\) to service_role;/);
  });
});
