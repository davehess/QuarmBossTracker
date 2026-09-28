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
