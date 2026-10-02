// test/live-damage-one-fight.test.js — History asks for ONE fight, not the newest of that name.
//
// The guild lead, 2026-10-02, on a DPS/Tank Meter fight that was really two: "This fight was
// backtoback with the same name." The History's settle passes ask /live-damage for the guild's
// numbers by mob NAME, and the bot answered with the newest snapshots of that name — so the first
// of two back-to-back kills was given the second one's numbers. Agent 3.7.67 sends fight_start;
// the bot keeps only snapshots whose own fight began within 20 s of it.
//
// Runs the REAL handler with a recording Supabase stub.
//
// Run: npx vitest run test/live-damage-one-fight.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, BOT_INDEX } from './_source-slice.js';

const src = readSource(BOT_INDEX);
const handler = sliceBlock(src, 'async function _handleAgentLiveDamage', '\n}');

function run(url) {
  const queries = [];
  const supabase = { isEnabled: () => true, select: async (_t, q) => { queries.push(q); return []; } };
  // eslint-disable-next-line no-new-func
  const fn = new Function('mimicLink', 'require', 'process', '_corroboratedDamage',
    handler + '\nreturn _handleAgentLiveDamage;')(
    { requireAgentAuth: async () => ({ discord_id: '1' }) },
    (p) => (String(p).endsWith('supabase') ? supabase : {}),
    { env: {} },
    (v) => Math.max(0, ...(v || [])));
  const res = { writeHead() {}, end(b) { this.body = b; } };
  return fn({ url }, res).then(() => ({ queries, res }));
}

describe('/live-damage for one fight', () => {
  it('with fight_start, only snapshots of a fight that began within 20 s of it', async () => {
    globalThis._liveDmgCache = new Map();
    const start = '2026-10-02T06:00:00.000Z';
    const { queries } = await run('/api/agent/live-damage?boss=A%20brann%20geistlig&fight_start=' + encodeURIComponent(start));
    expect(queries).toHaveLength(1);
    const q = decodeURIComponent(queries[0]);
    expect(q).toContain('&started_at=gte.2026-10-02T05:59:40.000Z');
    expect(q).toContain('&started_at=lte.2026-10-02T06:00:20.000Z');
    expect(q).toContain('&snapshot_at=gte.2026-10-02T05:59:40.000Z');   // not "the last 3 minutes"
  });

  it('without it, the live view is unchanged: the last three minutes of that name', async () => {
    globalThis._liveDmgCache = new Map();
    const { queries } = await run('/api/agent/live-damage?boss=A%20brann%20geistlig');
    expect(decodeURIComponent(queries[0])).not.toContain('started_at=');
  });

  it('two fights of one name do not share a cached answer', async () => {
    globalThis._liveDmgCache = new Map();
    const a = await run('/api/agent/live-damage?boss=X&fight_start=2026-10-02T06:00:00Z');
    const b = await run('/api/agent/live-damage?boss=X&fight_start=2026-10-02T06:02:00Z');
    expect(a.queries).toHaveLength(1);
    expect(b.queries).toHaveLength(1);     // a fresh query, not the first fight's memo
  });
});
