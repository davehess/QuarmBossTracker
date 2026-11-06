// The planned raid route on the Mimic Map (raid plan from apps/mimic/raidRoutes.json: dashed gold line + numbered stops).
// The JSON is in the Zeal map frame (the negation of the server frame); prepPlan negates back so points draw through wpt().
// Mutation-check: drop the negation in prepPlan and the Magmaton test fails.
// Run: npx vitest run test/map-planned-route.test.js
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';

const MAP_HTML = readSource(path.join(ROOT, 'apps', 'mimic', 'map.html'));
const MAIN = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'main.js')));
const PRELOAD = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'preload.js')));
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'raidRoutes.json'), 'utf8'));
const BLOCK = sliceBlock(MAP_HTML, 'var PLAN_DATA = null;', 'function drawPlannedRoute(').replace(/function drawPlannedRoute\($/, '');

function load(cfg, zone) {
  const S = { cfg: cfg || {}, zone };
  const api = new Function('S', BLOCK + '\nreturn { setData: function (d) { PLAN_DATA = d; }, planModeOf, prepPlan, planFor };')(S);
  api.setData(DATA);
  return { S, api };
}

describe('planned route', () => {
  it('negates the Zeal-frame JSON back to the server frame (Magmaton in pofire: server 781,-32)', () => {
    const { api } = load({}, 'pofire');
    const p = api.prepPlan(DATA, 'pofire', 'full');
    const m = p.stops.find(s => /magmaton/i.test(s.name));
    expect(m).toBeTruthy();
    expect([m.x, m.y]).toEqual([781, -32]);
  });
  it('returns the zone route and null for another zone', () => {
    const { api } = load({}, 'pofire');
    expect(api.planFor().points.length).toBeGreaterThan(1);
    expect(load({}, 'nowhere').api.planFor()).toBeNull();
  });
  it('switches full and min, and caches the built plan', () => {
    const { S, api } = load({}, 'powater');
    const a = api.planFor();
    expect(api.planFor()).toBe(a);
    S.cfg.planMode = 'min';
    const b = api.planFor();
    expect(b).not.toBe(a);
    expect(b.key).toBe('powater|min');
  });
  it('follows the JSON default when planMode is unset', () => {
    const { api } = load({}, 'powater');
    expect(api.planModeOf(DATA, {})).toBe(DATA.default);
    expect(api.planModeOf(DATA, { planMode: 'min' })).toBe('min');
  });
  it('wires the setting row, cfg merge and the IPC bridge', () => {
    const src = stripJs(MAP_HTML);
    expect(src).toMatch(/\['plannedRoute',/);
    expect(src).toMatch(/saved\.planMode === 'full'/);
    expect(MAIN).toMatch(/get-raid-routes/);
    expect(PRELOAD).toMatch(/getRaidRoutes/);
  });
});
