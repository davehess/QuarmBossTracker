// FB-114: GET /api/agent/slow-mode gives Mimic's Map the slow-mode window (the agent lengthens Planes of Power timers
// to 18 hours inside it). It answers only the window: never who switched it on or the line they saw.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { sliceBlock, stripJs } from './_source-slice.js';

const main = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const route = stripJs(sliceBlock(main, "if (req.method === 'GET' && req.url === '/api/agent/slow-mode') {", '\n  }\n'));

describe('GET /api/agent/slow-mode', () => {
  it('needs an agent token', () => {
    expect(route.indexOf('requireAgentAuth(req, res)')).toBeGreaterThan(-1);
    expect(route.indexOf('requireAgentAuth(req, res)')).toBeLessThan(route.indexOf('getSlowMode()'));
  });
  it('answers the window only', () => {
    expect(route).toMatch(/on: !!f\.on, set_at: f\.set_at \|\| null, auto_off_at: f\.auto_off_at \|\| null, off_at: f\.off_at \|\| null/);
    expect(route).not.toMatch(/set_by|set_line/);
  });
});
