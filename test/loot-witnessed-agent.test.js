// 2026-11-10, the guild lead: an Essence of Fire handed out from the queue (no bid, so never in OpenDKP) was looted by a
// raider who runs no Mimic, and the site never knew: "it should also capture X has looted lines". The agent now stores
// "--<Name> has looted a <item>--" under that looter, marked witnessed. Real source, sliced and run; invented names.
import { describe, it, expect } from 'vitest';
import { readSource, AGENT_INDEX, sliceBlock, evalBlock } from './_source-slice.js';

const agentSrc = readSource(AGENT_INDEX);

function build() {
  const pets = sliceBlock(agentSrc, 'function _petNameForOwner(ownerLower) {', 'return Number.isInteger(id) && id > 0 ? id : null;\n}');
  const looted = sliceBlock(agentSrc, 'const _LOOTED_RX', '// ── Loot-link roll-call parsing');
  const body = sliceBlock(agentSrc, 'function _chatLogBody(line) {', "  return body || null;\n}");
  const otherRx = agentSrc.match(/^const _OTHER_LOOTED_RX = .+;$/m)[0];
  return evalBlock(`
    const _zealState = { Aldenmar: { zone: 'pofire' } };
    const _normMobName = (s) => String(s || '').toLowerCase().trim();
    const parseEqTimestamp = (line) => { const m = line.match(/^\\[T(\\d+)\\]/); return m ? new Date(Number(m[1])) : null; };
    const uploads = [];
    const enqueueUpload = (kind, body) => uploads.push({ kind, body });
    const _uploadOpts = { dryRun: false };
    const _isUploaderInstance = true;
    const AGENT_VERSION = 'test';
    const raidCodeCalls = [];
    const _raidCodeNoteLoot = (e) => raidCodeCalls.push(e);
    ${body}
    ${otherRx}
    ${pets}
    ${looted}
    `, ['uploads', 'raidCodeCalls', 'trackLootedLine', 'uploadLooted']);
}

const t = () => Date.now() - 1000;

describe('witnessed loot lines', () => {
  it('"--Brackwyn has looted an Essence of Fire--" is stored under Brackwyn, witnessed, in the observer\'s zone', () => {
    const h = build();
    h.trackLootedLine(`[T${t()}] --Brackwyn has looted an Essence of Fire.--`, 'Aldenmar');
    h.uploadLooted();
    expect(h.uploads).toHaveLength(1);
    expect(h.uploads[0].body.events).toEqual([
      expect.objectContaining({ item: 'Essence of Fire', looter: 'Brackwyn', zone: 'pofire', witnessed: true }),
    ]);
    expect(h.raidCodeCalls).toHaveLength(0);   // the raid-code ledger keeps this PC's own loot only
  });
  it('the server form without the period is read too', () => {
    const h = build();
    h.trackLootedLine(`[T${t()}] --Brackwyn has looted a Bone Chips--`, 'Aldenmar');
    h.uploadLooted();
    expect(h.uploads[0].body.events[0]).toMatchObject({ item: 'Bone Chips', looter: 'Brackwyn', witnessed: true });
  });
  it('your own line stays an ordinary loot (no witnessed flag)', () => {
    const h = build();
    h.trackLootedLine(`[T${t()}] --You have looted a Cloak of Flames.--`, 'Aldenmar');
    h.uploadLooted();
    expect(h.uploads[0].body.events[0]).toMatchObject({ item: 'Cloak of Flames', looter: 'Aldenmar' });
    expect(h.uploads[0].body.events[0].witnessed).toBeUndefined();
  });
  it('chat that only mentions looting is ignored', () => {
    const h = build();
    h.trackLootedLine(`[T${t()}] Brackwyn tells the guild, 'Brackwyn has looted a lot today'`, 'Aldenmar');
    h.uploadLooted();
    expect(h.uploads).toHaveLength(0);
  });
});
