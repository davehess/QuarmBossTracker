// PoP flags as the server keeps them (DECISIONS §119, 2026-10-01, the day PoP opened).
//
// Every grant had been stored as 'unmapped'. These pin the three ways a grant is now named (the NPC's
// line before it, the Seer's recital, the zone alone) and run the real upload handler against a fake
// database, so a hail is stored as a hail and a step credits the catalog flag it proves.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { BOT_INDEX, ROOT, readSource, sliceBlock, evalBlock } from './_source-slice.js';

const require = createRequire(import.meta.url);
const S = require('../utils/popFlagStages.js');

const grant = (zone, prev, extra = {}) => ({ character: 'Aldenmar', ts: '2026-10-01T20:00:00Z', kind: 'grant', zone, prev, ...extra });

describe('the line the flag NPC prints before the grant names the step', () => {
  it('tells the two Mavuin steps and the two Tribunal steps apart', () => {
    expect(S.resolveStage(grant('201', "Mavuin tells you, 'I know it has been said for years before me")).stage).toBe('mavuin_1');
    expect(S.resolveStage(grant('201', "The Tribunal tells you, 'You have completed a trial - impressive for mortals")).stage).toBe('mavuin_2');
    expect(S.resolveStage(grant('201', "Mavuin tells you, 'So you have pleaded my case to the Tribunal, I am most thankful.")).stage).toBe('mavuin_3');
    expect(S.resolveStage(grant('201', "The Tribunal tells you, 'Most impressive.  It has been long")).stage).toBe('seventh_1');
  });

  it('reads Elder Poxbourne, whose grant line is spelled differently', () => {
    expect(S.resolveStage(grant('203', "Thelin tells you, 'I apologize but I cannot stand to greet you. I am still quite weak")).stage).toBe('thelin_4');
  });

  it('tells Tallon and Vallon apart by the end of a line they share the start of', () => {
    const base = "You realize that the image is a projection of Maelin Starpyre's thoughts.  His thoughts enter into your own.  'The pack of notes you now possess from ";
    expect(S.resolveStage(grant('214', base + 'Tallon, bring them to me.')).stage).toBe('zeks_4');
    expect(S.resolveStage(grant('214', base + 'Vallon, bring them to me.')).stage).toBe('zeks_3');
  });

  it('uses the zone to tell apart two projections that say the same thing', () => {
    const line = "The Planar Projection's thoughts enter your own.  'You have done well, mortal.'";
    expect(S.resolveStage(grant('207', line)).stage).toBe('saryrn_1');
    expect(S.resolveStage(grant('220', line)).stage).toBe('mmarr_1');
  });

  it('a line from someone who is not a flag NPC names nothing', () => {
    expect(S.resolveStage(grant('201', "Brackwyn tells you, 'grats on the flag'"))).toBe(null);
  });
});

describe("the Seer's recital names every step a character holds", () => {
  const recital = (text) => S.resolveStage({ character: 'Aldenmar', ts: '2026-10-01T20:00:00Z', kind: 'recital', text });
  it('reads each kind of sentence', () => {
    expect(recital('Mavuin is grateful to you for taking his case before the Tribunal.  The information').stage).toBe('mavuin_3');
    expect(recital("You have completed all of Honor's Trials.").stage).toBe('hohtrials_111');
    expect(recital("Jiva's strength fills your body.").stage).toBe('sol_room_5');
    expect(recital('Saved from a world of eternal nightmares, Thelin is forever in your debt.').stage).toBe('thelin_4');
  });
  it('a sentence it does not know names nothing', () => {
    expect(recital('You manage to recover some images from your childhood, but no recent events spark a memory.')).toBe(null);
  });
});

describe('the zone alone, for agents that send nothing else', () => {
  it('names the single-grant zones', () => {
    expect(S.resolveStage({ zone: '221', kind: undefined }).stage).toBe('thelin_3');   // Lair of Terris Thule
    expect(S.resolveStage({ zone: '208' }).stage).toBe('aerindar_2');                 // Plane of Valor
    expect(S.resolveStage({ zone: '205' }).stage).toBe('fuirstel_2');                 // Plane of Disease
  });
  it('does not guess in a zone with several grants', () => {
    expect(S.resolveStage({ zone: '201' })).toBe(null);   // Justice: Mavuin and the Tribunal
    expect(S.resolveStage({ zone: '203' })).toBe(null);   // Tranquility: six NPCs
  });
  it('names a Tactics checklist flag by the Zek just killed', () => {
    expect(S.resolveStage({ zone: '214', kind: 'checklist' }, 'tallon zek').stage).toBe('cl_tallon');
  });
});

describe('every catalog flag a step proves exists in the web catalog', () => {
  const web = fs.readFileSync(path.join(ROOT, 'web', 'lib', 'popFlags.ts'), 'utf8');
  const keys = new Set([...web.matchAll(/\{ key: '([a-z0-9_]+)'/g)].map(m => m[1]));
  it('finds the catalog', () => { expect(keys.size).toBeGreaterThan(25); });
  for (const [stage, cat] of Object.entries(S.STAGE_IMPLIES)) {
    it(stage, () => { for (const k of cat) expect(keys.has(k), k).toBe(true); });
  }
});

describe("the chart's gates are the server portal script's (potranquility/player.lua)", () => {
  const web = fs.readFileSync(path.join(ROOT, 'web', 'lib', 'popFlags.ts'), 'utf8');
  const gate = (key) => {
    const m = web.match(new RegExp(`\\{ key: '${key}',[^\\n]*requires: \\[([^\\]]*)\\]`));
    expect(m, key).toBeTruthy();
    return m[1].split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean).sort();
  };
  it('Storms needs the Justice flag, like Valor (it showed everyone in)', () => {
    expect(gate('storms')).toEqual(['trial_justice']);
    expect(gate('valor')).toEqual(['trial_justice']);
  });
  it('the other portals', () => {
    expect(gate('torment')).toEqual(['fuirstel_5', 'thelin_4']);
    expect(gate('bot')).toEqual(['askr_quest']);
    expect(gate('tactics')).toEqual(['behemoth_dead']);
    expect(gate('solro')).toEqual(['cipher_1', 'zeks_6']);
    for (const z of ['air', 'water', 'earth']) expect(gate(z)).toEqual(['zebuxoruk_2']);
    expect(gate('time')).toEqual(['time_1']);
  });
  it('no zone claims a level bypass (Quarm turned them off)', () => {
    expect(web).not.toMatch(/levelBypass: \d/);
  });
  it("Askr's medallion alone does not count as the Thunder flag", () => {
    expect(S.STAGE_IMPLIES.karana_2).toBeUndefined();
    expect(S.STAGE_IMPLIES.karana_3).toEqual(['askr_quest']);
  });
});

describe('the upload handler', () => {
  const bot = readSource(BOT_INDEX);
  const { POP_FLAG_BY_BOSS, _popBossKey } = evalBlock(
    sliceBlock(bot, 'const POP_FLAG_BY_BOSS = {', ".replace(/_/g, ' ').toLowerCase() : '');"),
    ['POP_FLAG_BY_BOSS', '_popBossKey'],
  );
  const handler = sliceBlock(bot, 'async function _handleAgentPopFlags(req, res) {', '\n}');

  async function run(events) {
    let written = null;
    const supabase = {
      isEnabled: () => true,
      upsert: async (_t, rows) => { written = rows; return rows; },
    };
    // eslint-disable-next-line no-new-func
    const fn = new Function('mimicLink', 'require', 'popFlagStages', 'POP_FLAG_BY_BOSS', '_popBossKey', '_trackUpload',
      `${handler}\nreturn _handleAgentPopFlags;`)(
      { requireAgentAuth: async () => ({ discord_id: '1' }) }, () => supabase, S, POP_FLAG_BY_BOSS, _popBossKey, () => {});
    const body = Buffer.from(JSON.stringify({ events }));
    const req = { [Symbol.asyncIterator]: async function* () { yield body; } };
    await fn(req, { writeHead: () => {}, end: () => {} });
    return written || [];
  }
  const keysOf = (rows) => rows.map(r => r.flag_key).sort();

  it('stores a witnessed hail as a hail, with the NPC', async () => {
    const rows = await run([{ character: 'Brackwyn', ts: '2026-10-01T20:00:00Z', source: 'hail_witnessed', npc: 'Mavuin', zone: '201' }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ flag_key: 'hail', npc: 'Mavuin', source: 'hail_witnessed' });
  });

  it('stores the step and credits the catalog flag it proves', async () => {
    const rows = await run([grant('201', "Mavuin tells you, 'So you have pleaded my case to the Tribunal")]);
    expect(keysOf(rows)).toEqual(['mavuin_3', 'trial_justice']);
    expect(rows.every(r => r.stage === 'mavuin_3')).toBe(true);
  });

  it('names an old agent grant by its zone and does not add a second row from the boss map', async () => {
    const rows = await run([{ character: 'Aldenmar', ts: '2026-10-01T20:00:00Z', zone: '205', boss: 'Grummus' }]);
    expect(keysOf(rows)).toEqual(['fuirstel_2', 'grummus_dead']);
  });

  it('still falls back to the boss map, and to unmapped', async () => {
    const boss = await run([{ character: 'Aldenmar', ts: '2026-10-01T20:00:00Z', zone: '209x', boss: 'Agnarr the Storm Lord' }]);
    expect(keysOf(boss)).toEqual(['agnarr_dead']);
    const none = await run([{ character: 'Aldenmar', ts: '2026-10-01T20:00:00Z', zone: '201' }]);
    expect(keysOf(none)).toEqual(['unmapped']);
  });

  it('drops a recital sentence it cannot name instead of storing it as unmapped', async () => {
    const rows = await run([{ character: 'Aldenmar', ts: '2026-10-01T20:00:00Z', kind: 'recital', text: 'Some other line.' }]);
    expect(rows).toEqual([]);
  });
});
