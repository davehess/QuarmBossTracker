// test/map-travel-points.test.js — the map file's points win the label fight (the guild lead, 2026-11-09: "we're missing POK books
// and other points on our map"; the Mimic map's names were thirty "lizard man broodling" while the in-game map showed
// "to The Plane of Knowledge", "to_Oggok" and "Fake_Wall"). The agent already hands the P lines over (_mapParseLocalFiles,
// underscores read as spaces); map.html drew them last and dropped them on every collision.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, evalBlock, ROOT } from './_source-slice.js';

const map = readSource(path.join(ROOT, 'apps', 'mimic', 'map.html'));
const code = stripJs(map);

describe('travel points rank first; one name names at most two mobs; every point gets a marker', () => {
  const { isTravelPoint, LABEL_SAME_MAX } = evalBlock(sliceBlock(map, '  var LABEL_SAME_MAX = 2;', 'function isTravelPoint(text) { return TRAVEL_RE.test(String(text || \'\')); }'),
    ['isTravelPoint', 'LABEL_SAME_MAX']);
  it('ways out of the zone are travel points; merchants, walls and mobs are not', () => {
    for (const t of ['to Oggok', 'to The Plane of Knowledge', 'PoK Book', 'Book to Plane of Knowledge', 'Translocator Fithop', 'Druid Ring', 'Wizard Spires'])
      expect(isTravelPoint(t), t).toBe(true);
    for (const t of ['Gub (Merchant)', 'Fake Wall', 'Agent of Change', 'lizard man broodling', 'Tae Ew Templar', 'Totem'])
      expect(isTravelPoint(t), t).toBe(false);
    expect(LABEL_SAME_MAX).toBe(2);
  });
  it('a travel point ranks above every mob name and keeps the file\'s colour; the rest stay last', () => {
    expect(code).toContain("tier: travel ? -2 : 2, align: 'center', font: roomFont,");
    expect(code).toContain('pri: (travel ? -2e7 : 2e7) + dist(ll[i][0], ll[i][1]) });');
    expect(code).toContain('col: travel && ll[i][4] ? ll[i][4] : roomCol,');
  });
  it('the same name labels at most two mobs, the nearest; your target is always named', () => {
    expect(code).toContain('if (c.tgt) return true;');
    expect(code).toContain('return seenName[k] <= LABEL_SAME_MAX;');
  });
  it('each point on screen draws a + marker whether or not its name fits', () => {
    expect(code).toMatch(/ctx\.moveTo\(q\[0\] - 3, q\[1\]\); ctx\.lineTo\(q\[0\] \+ 3, q\[1\]\); ctx\.moveTo\(q\[0\], q\[1\] - 3\); ctx\.lineTo\(q\[0\], q\[1\] \+ 3\);/);
  });
});
