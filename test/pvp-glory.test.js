// test/pvp-glory.test.js — the Rallosian Glory kill broadcast from Quarm's PoP patch (the guild lead,
// 2026-09-28, with a screenshot: "Some new messages"). The line names no guilds, so the agent reads the
// killer, victim and zone, and leaves the guilds for the bot to fill in. Runs the agent's real parser.
//
// Run: npx vitest run test/pvp-glory.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock, stripJs } from './_source-slice.js';

const agent = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js'));
const block = [
  sliceBlock(agent, 'const TS_RX = ', ';'),
  sliceBlock(agent, 'function parseEqTimestamp(line) {', '\n}'),
  sliceBlock(agent, 'const PVP_GLORY_RX = ', ';'),
  sliceBlock(agent, 'const PVP_GLORY_CLAUSE_RX = ', ';'),
  sliceBlock(agent, 'const PVP_GLORY_WORTHY_RX = ', ';'),
  sliceBlock(agent, 'const PVP_GLORY_EXULTS_RX', ';'),
  sliceBlock(agent, 'const PVP_GLORY_FALLS_TO_RX', ';'),
  sliceBlock(agent, 'const PVP_GLORY_NO_FOE_RX', ';'),
  sliceBlock(agent, 'const PVP_GLORY_FORFEIT_RX', ';'),
  // The 2026-10-02 wordings. Some of these carry a ';' inside the pattern, so end on the closing "$/;".
  sliceBlock(agent, 'const PVP_GLORY_FAVORS_RX', '$/;'),
  sliceBlock(agent, 'const PVP_GLORY_CUTS_DOWN_RX', '$/;'),
  sliceBlock(agent, 'const PVP_GLORY_KILLS_RX', '$/;'),
  sliceBlock(agent, 'const PVP_GLORY_FALLS_TO_PLAYER_RX', '$/;'),
  sliceBlock(agent, 'const PVP_GLORY_FALLS_IN_RX', '$/;'),
  sliceBlock(agent, 'const PVP_GLORY_FORFEIT2_RX', '$/;'),
  sliceBlock(agent, 'function _gloryNpcZone(s) {', '\n}'),
  sliceBlock(agent, 'const _gloryGuild =', ';'),
  sliceBlock(agent, 'function parseGloryKill(line) {', '\n}'),
].join('\n');
// eslint-disable-next-line no-new-func
const { parseGloryKill } = new Function(block + '\nreturn { parseGloryKill };')();

describe('Rallosian Glory kill broadcast', () => {
  it('reads the lines from the screenshot', () => {
    const a = parseGloryKill("[Mon Sep 28 16:18:40 2026] [PVP] Rallos Zek watches as Myto spills Songfin's blood in The Fungus Grove, but finds no worthy conquest.");
    expect(a).toMatchObject({
      killType: 'pvp', source: 'rallos_glory',
      killer: 'Myto', killerGuild: null, victim: 'Songfin', victimGuild: null,
      zone: 'The Fungus Grove', glory: false, gloryText: 'but finds no worthy conquest',
      text: "Rallos Zek watches as Myto spills Songfin's blood in The Fungus Grove, but finds no worthy conquest.",
    });
    expect(a.ts.startsWith('2026-09-28')).toBe(true);
    const b = parseGloryKill("[Mon Sep 28 16:22:06 2026] [PVP] Rallos Zek watches as Kyinen spills Sweetums's blood in Kael Drakkel, but finds no worthy conquest.");
    expect(b).toMatchObject({ killer: 'Kyinen', victim: 'Sweetums', zone: 'Kael Drakkel', glory: false });
  });

  it('keeps a zone whose own name has a comma in it', () => {
    const r = parseGloryKill("[Mon Sep 28 16:22:06 2026] [PVP] Rallos Zek watches as Kyinen spills Sweetums's blood in Doomfire, the Burning Lands, but finds no worthy conquest.");
    expect(r.zone).toBe('Doomfire, the Burning Lands');
    expect(r.glory).toBe(false);
  });

  it('does not guess glory from an ending it has never seen', () => {
    const r = parseGloryKill("[Mon Sep 28 16:22:06 2026] [PVP] Rallos Zek watches as Kyinen spills Sweetums's blood in Kael Drakkel, and is pleased.");
    expect(r).toMatchObject({ zone: 'Kael Drakkel', glory: null, gloryText: 'and is pleased' });
    const bare = parseGloryKill("[Mon Sep 28 16:22:06 2026] [PVP] Rallos Zek watches as Kyinen spills Sweetums's blood in Kael Drakkel.");
    expect(bare).toMatchObject({ zone: 'Kael Drakkel', glory: null, gloryText: null });
  });

  // The guild lead, 2026-09-30, with a screenshot of a kill that never reached the bot. Names invented;
  // the wording is the server's.
  it('reads a Glory-worthy kill, which Rallos Zek words differently', () => {
    const r = parseGloryKill("[Tue Sep 29 22:55:44 2026] [PVP] Rallos Zek marks Aldenmar with his favor for spilling Brackwyn's blood in Ruins of Sebilis. Aldenmar now bears 1 of 10 measures of Rallosian Glory.");
    expect(r).toMatchObject({
      killType: 'pvp', source: 'rallos_glory',
      killer: 'Aldenmar', killerGuild: null, victim: 'Brackwyn', victimGuild: null,
      zone: 'Ruins of Sebilis', glory: true,
      gloryText: 'Aldenmar now bears 1 of 10 measures of Rallosian Glory.',
    });
    expect(r.ts.startsWith('2026-09-')).toBe(true);
    // A name that already ends in s keeps the server's "s's", and a zone with a comma stays whole.
    const s = parseGloryKill("[Tue Sep 29 22:55:44 2026] [PVP] Rallos Zek marks Aldenmar with his favor for spilling Corvales's blood in Doomfire, the Burning Lands. Aldenmar now bears 2 of 10 measures of Rallosian Glory.");
    expect(s).toMatchObject({ victim: 'Corvales', zone: 'Doomfire, the Burning Lands', glory: true });
  });

  // The 168 lines the agent could not read, sent by the guild lead on 2026-10-02 (DECISIONS §132). The
  // wording is the server's; the names are invented.
  it('reads the newer worthy-kill wording', () => {
    const r = parseGloryKill('[Wed Sep 30 00:35:58 2026] [PVP] Rallos Zek exults as Aldenmar cuts down Brackwyn in Ruins of Sebilis and claims 1 measure of hard-won Glory. Aldenmar now bears 1 of 10.');
    expect(r).toMatchObject({
      killType: 'pvp', source: 'rallos_glory',
      killer: 'Aldenmar', killerGuild: null, victim: 'Brackwyn', victimGuild: null,
      zone: 'Ruins of Sebilis', glory: true,
      gloryText: 'claims 1 measure of hard-won Glory. Aldenmar now bears 1 of 10.',
    });
    const g = parseGloryKill('[Wed Sep 30 00:35:58 2026] [PVP] Rallos Zek exults as Aldenmar <Wolf Pack> cuts down Brackwyn <Zek> in Doomfire, the Burning Lands and claims 1 measure of hard-won Glory. Aldenmar now bears 2 of 10.');
    expect(g).toMatchObject({ killerGuild: 'Wolf Pack', victimGuild: 'Zek', zone: 'Doomfire, the Burning Lands' });
  });

  it('reads a death to an NPC, both wordings, with the guild when the line names one', () => {
    const old = parseGloryKill('[Mon Sep 28 18:41:46 2026] [PVP] Rallos Zek looks on as Brackwyn falls to froglok bok knight in Ruins of Sebilis, but grants no Glory.');
    expect(old).toMatchObject({
      killType: 'npc', source: 'rallos_glory', killer: 'froglok bok knight', killerGuild: null,
      victim: 'Brackwyn', victimGuild: null, zone: 'Ruins of Sebilis', glory: false, gloryText: 'but grants no Glory',
    });
    const g = parseGloryKill('[Thu Oct 01 06:37:23 2026] [PVP] Rallos Zek looks down in disgust as Brackwyn <Hardened Casuals> falls to a trap in Chardok.');
    expect(g).toMatchObject({ killType: 'npc', killer: 'a trap', victim: 'Brackwyn', victimGuild: 'Hardened Casuals', zone: 'Chardok', gloryText: null });
    // The server pads some NPC names with a space; the NPC and the zone come out trimmed.
    const pad = parseGloryKill('[Thu Oct 01 02:43:40 2026] [PVP] Rallos Zek looks down in disgust as Brackwyn falls to Emperor Ssraeshza  in Ssraeshza Temple.');
    expect(pad).toMatchObject({ killer: 'Emperor Ssraeshza', zone: 'Ssraeshza Temple', victimGuild: null });
    // One NPC has " in " in its name; no zone does, so the zone starts after the last one.
    const lady = parseGloryKill('[Thu Oct 01 02:43:40 2026] [PVP] Rallos Zek looks down in disgust as Brackwyn falls to a lady in waiting in Ruins of Sebilis.');
    expect(lady).toMatchObject({ killer: 'a lady in waiting', zone: 'Ruins of Sebilis' });
    const tick = parseGloryKill("[Tue Sep 29 22:50:12 2026] [PVP] Rallos Zek looks on as Brackwyn falls to Trakanon`s corpse in Ruins of Sebilis, but grants no Glory.");
    expect(tick).toMatchObject({ killer: 'Trakanon`s corpse', zone: 'Ruins of Sebilis' });
  });

  it('reads a death with no killer named', () => {
    const r = parseGloryKill('[Thu Oct 01 02:25:21 2026] [PVP] Rallos Zek looks down in disgust as Brackwyn falls in Kedge Keep without a worthy foe.');
    expect(r).toMatchObject({
      killType: 'pvp', source: 'rallos_glory', killer: null, killerGuild: null,
      victim: 'Brackwyn', victimGuild: null, zone: 'Kedge Keep', glory: false, gloryText: 'without a worthy foe',
    });
  });

  it('reads a forfeit as a forfeit, not a death', () => {
    for (const verb of ['flees', 'abandons']) {
      const r = parseGloryKill(`[Wed Sep 30 19:57:03 2026] [PVP] Rallos Zek looks down in disgust as Brackwyn ${verb} the battlefield like a cowardly dog, surrendering 1 measure of Rallosian Glory.`);
      expect(r).toMatchObject({
        killType: 'forfeit', source: 'rallos_glory', killer: null, victim: 'Brackwyn',
        zone: null, glory: false, gloryText: 'surrendering 1 measure of Rallosian Glory',
      });
    }
  });

  // The server reworded every Glory line on 2026-10-02 (Quarm commit da650526) and put the guilds on them.
  // From then until this parser knew them no kill or assist was stored, while "falls to <mob>" deaths kept
  // arriving. The guild lead, 2026-10-28, with a screenshot of "Rallos Zek favors …". Names invented.
  describe('the 2026-10-02 wordings', () => {
    it('reads "favors … for killing" with both guilds', () => {
      const r = parseGloryKill('[Tue Oct 27 21:03:11 2026] [PVP] Rallos Zek favors Aldenmar <Wolf Pack> for killing Brackwyn <Breakfast Club> in Ruins of Sebilis. Aldenmar <Wolf Pack> now has 1/10 Glory.');
      expect(r).toMatchObject({
        killType: 'pvp', source: 'rallos_glory',
        killer: 'Aldenmar', killerGuild: 'Wolf Pack', victim: 'Brackwyn', victimGuild: 'Breakfast Club',
        zone: 'Ruins of Sebilis', glory: true, gloryText: 'Aldenmar <Wolf Pack> now has 1/10 Glory',
        text: 'Rallos Zek favors Aldenmar <Wolf Pack> for killing Brackwyn <Breakfast Club> in Ruins of Sebilis. Aldenmar <Wolf Pack> now has 1/10 Glory.',
      });
      expect(r.ts.startsWith('2026-10-2')).toBe(true);
    });

    it('leaves the guild null for a name with none, and keeps multi-word guilds and zones whole', () => {
      const r = parseGloryKill('[Tue Oct 27 21:03:11 2026] [PVP] Rallos Zek favors Nyssara <Dungeons and Dragons> for killing Zarrin in The Plane of Fear. Nyssara <Dungeons and Dragons> now has 4/10 Glory.');
      expect(r).toMatchObject({ killer: 'Nyssara', killerGuild: 'Dungeons and Dragons', victim: 'Zarrin', victimGuild: null, zone: 'The Plane of Fear' });
    });

    it('reads "exults … cuts down" when the victim loses Glory', () => {
      const r = parseGloryKill('[Tue Oct 27 21:03:11 2026] [PVP] Rallos Zek exults as Aldenmar <Wolf Pack> cuts down Brackwyn <Zek> in Ruins of Sebilis. Brackwyn <Zek> loses 2 Glory; Aldenmar <Wolf Pack> now has 3/10.');
      expect(r).toMatchObject({
        killType: 'pvp', killer: 'Aldenmar', killerGuild: 'Wolf Pack', victim: 'Brackwyn', victimGuild: 'Zek',
        zone: 'Ruins of Sebilis', glory: true, gloryText: 'Brackwyn <Zek> loses 2 Glory; Aldenmar <Wolf Pack> now has 3/10',
      });
    });

    it('reads "exults … kills" at the Glory cap', () => {
      const reaches = parseGloryKill('[Tue Oct 27 21:03:11 2026] [PVP] Rallos Zek exults as Aldenmar <Wolf Pack> kills Brackwyn <Zek> in Ruins of Sebilis and reaches 10/10 Glory!');
      expect(reaches).toMatchObject({ killType: 'pvp', killer: 'Aldenmar', victim: 'Brackwyn', zone: 'Ruins of Sebilis', glory: true, gloryText: 'reaches 10/10 Glory' });
      const stays = parseGloryKill('[Tue Oct 27 21:03:11 2026] [PVP] Rallos Zek exults as Aldenmar <Wolf Pack> kills Brackwyn <Zek> in Ruins of Sebilis and remains at 10/10 Glory.');
      expect(stays).toMatchObject({ killType: 'pvp', killer: 'Aldenmar', killerGuild: 'Wolf Pack', victim: 'Brackwyn', victimGuild: 'Zek', glory: true, gloryText: 'remains at 10/10 Glory' });
    });

    it('reads a death to a PLAYER with no Glory as a player kill, not an NPC one', () => {
      const a = parseGloryKill('[Tue Oct 27 21:03:11 2026] [PVP] Rallos Zek looks down in disgust as Brackwyn <Zek> falls to Aldenmar <Wolf Pack> in Bastion of Thunder. No Glory awarded.');
      expect(a).toMatchObject({
        killType: 'pvp', source: 'rallos_glory', killer: 'Aldenmar', killerGuild: 'Wolf Pack',
        victim: 'Brackwyn', victimGuild: 'Zek', zone: 'Bastion of Thunder', glory: false, gloryText: 'No Glory awarded',
      });
      const b = parseGloryKill('[Tue Oct 27 21:03:11 2026] [PVP] Rallos Zek looks down in disgust as Brackwyn <Zek> falls to Aldenmar <Wolf Pack> in Bastion of Thunder. Brackwyn <Zek> loses 2 Glory; no Glory awarded.');
      expect(b).toMatchObject({ killType: 'pvp', killer: 'Aldenmar', victim: 'Brackwyn', zone: 'Bastion of Thunder', glory: false });
    });

    it('still reads a death to a mob as an NPC kill, with or without lost Glory', () => {
      const a = parseGloryKill('[Tue Oct 27 21:03:11 2026] [PVP] Rallos Zek looks down in disgust as Corvale <Continuum> falls to froglok krup knight in Ruins of Sebilis.');
      expect(a).toMatchObject({ killType: 'npc', killer: 'froglok krup knight', victim: 'Corvale', victimGuild: 'Continuum', zone: 'Ruins of Sebilis' });
      const b = parseGloryKill('[Tue Oct 27 21:03:11 2026] [PVP] Rallos Zek looks down in disgust as Corvale <Continuum> falls to a small mushroom in The Fungus Grove. 3 Glory lost.');
      expect(b).toMatchObject({ killType: 'npc', killer: 'a small mushroom', zone: 'The Fungus Grove' });
    });

    it('reads a fall with no killer, and does not mistake the older "without a worthy foe" form for a zone', () => {
      const a = parseGloryKill('[Tue Oct 27 21:03:11 2026] [PVP] Rallos Zek looks down in disgust as Brackwyn <Zek> falls in Kedge Keep.');
      expect(a).toMatchObject({ killType: 'pvp', killer: null, victim: 'Brackwyn', victimGuild: 'Zek', zone: 'Kedge Keep', glory: false, gloryText: null });
      const b = parseGloryKill('[Tue Oct 27 21:03:11 2026] [PVP] Rallos Zek looks down in disgust as Brackwyn falls in Kedge Keep. 4 Glory lost.');
      expect(b).toMatchObject({ killer: null, victim: 'Brackwyn', zone: 'Kedge Keep', gloryText: '4 Glory lost' });
      const old = parseGloryKill('[Thu Oct 01 02:25:21 2026] [PVP] Rallos Zek looks down in disgust as Brackwyn falls in Kedge Keep without a worthy foe.');
      expect(old).toMatchObject({ zone: 'Kedge Keep', gloryText: 'without a worthy foe' });
    });

    it('reads the new forfeit wording', () => {
      for (const verb of ['flees', 'abandons']) {
        const r = parseGloryKill(`[Tue Oct 27 21:03:11 2026] [PVP] Rallos Zek looks down in disgust as Brackwyn <Zek> ${verb} the battlefield in Kedge Keep like a cowardly dog, forfeiting 2 Glory.`);
        expect(r).toMatchObject({
          killType: 'forfeit', killer: null, victim: 'Brackwyn', victimGuild: 'Zek',
          zone: 'Kedge Keep', glory: false, gloryText: 'forfeiting 2 Glory',
        });
      }
    });

    it("does not read the killer's own \"You killed\" line as a second kill", () => {
      expect(parseGloryKill('[Tue Oct 27 21:03:10 2026] You killed Brackwyn. This was a Glory-worthy kill: you gained 1 Rallosian Glory and now bear 1 of 10.')).toBeNull();
    });
  });

  it('ignores lines that only look similar', () => {
    for (const l of [
      "[Mon Sep 28 16:22:06 2026] Kyinen tells the guild, 'Rallos Zek watches as Kyinen spills Sweetums's blood in Kael Drakkel'",
      '[Mon Sep 28 16:22:06 2026] [PVP] Rallos Zek is watching.',
      '[Mon Sep 28 16:22:08 2026] You are thirsty.',
    ]) expect(parseGloryKill(l)).toBeNull();
  });

  it('is wired into the PvP parser and the unmatched capture', () => {
    const code = stripJs(agent);   // comments must not satisfy these
    expect(code).toContain('const glory = parseGloryKill(line);\n  if (glory) return glory;');
    expect(code).toMatch(/\\bhas killed\\b\|Rallos Zek\|\\bGlory\\b/);
  });
});
