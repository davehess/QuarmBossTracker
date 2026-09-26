// test/corpse-dm.test.js — POST /api/agent/corpse: DM a character's owner where their corpse lies.
//
// The guild lead, 2026-09-26: "when a character dies we should discord message them to send them their
// corpse coordinates and what zone they were in. we have all of that detail".
//
// Runs the bot's REAL _handleAgentCorpse and _corpseDmText against stand-ins for the Mimic session,
// Supabase and Discord. Names are invented.
//
// Run: npx vitest run test/corpse-dm.test.js

import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { readSource, BOT_INDEX, sliceBlock } from './_source-slice.js';

const bot = readSource(BOT_INDEX);
const block = sliceBlock(bot, 'const _corpseDmSeen = new Map();', '\n// Assemble pending backfill requests')
  .replace(/\n\/\/ Assemble pending backfill requests$/, '');

// The handler reads mimicLink, client and require('./utils/supabase'): bind stand-ins for all three.
function loadWith(opts) {
  const sent = [];
  const env = {
    mimicLink: { requireAgentAuth: async () => (opts.uploader === null ? null : { discord_id: opts.uploader ?? '111' }) },
    supabase: {
      isEnabled: () => true,
      select: async (_table, q) => {
        const name = decodeURIComponent(/name=ilike\.([^&]+)/.exec(q)[1]).toLowerCase();
        const row = (opts.chars || {})[name];
        return row ? [row] : [];
      },
    },
    client: { users: { fetch: async (id) => ({ id, send: async (msg) => { sent.push({ id, ...msg }); } }) } },
  };
  // eslint-disable-next-line no-new-func
  const make = new Function('env', `
    const { mimicLink, client } = env;
    const require = (m) => (m === './utils/supabase' ? env.supabase : null);
    ${block}
    return { _handleAgentCorpse, _corpseDmText };`);
  return { ...make(env), sent };
}

function post(handler, body) {
  const req = new EventEmitter();
  const res = { code: 0, body: null, headersSent: false,
    writeHead(c) { this.code = c; this.headersSent = true; }, end(b) { this.body = b ? JSON.parse(b) : null; } };
  const p = handler(req, res);
  setImmediate(() => { req.emit('data', typeof body === 'string' ? body : JSON.stringify(body)); req.emit('end'); });
  return p.then(() => new Promise(r => setImmediate(() => r(res))));
}

const ALDENMAR = { name: 'Aldenmar', discord_id: '111', main_name: 'Aldenmar' };
const death = (extra = {}) => ({
  character: 'Aldenmar', died_at: '2026-09-26T01:42:10.000Z', zone_id: 71, zone: 'Plane of Sky',
  loc: { x: 1234.4, y: -567.6, z: 89.1 }, ...extra,
});

describe('the DM', () => {
  it('names the character, the zone, the time, and the corpse at the numbers /loc shows (x, y, z)', async () => {
    const { _handleAgentCorpse, sent } = loadWith({ chars: { aldenmar: ALDENMAR } });
    const res = await post(_handleAgentCorpse, death());
    expect(res.code).toBe(200);
    expect(res.body).toMatchObject({ ok: true, dm: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].id).toBe('111');
    expect(sent[0].content).toContain('**Aldenmar** died in **Plane of Sky**');
    expect(sent[0].content).toContain('`/loc` **1234, -568, 89**');
    expect(sent[0].content).toContain(`<t:${Date.parse('2026-09-26T01:42:10.000Z') / 1000}:t>`);
    expect(sent[0].allowedMentions).toEqual({ parse: [] });
  });

  it('says so when Zeal gave no position, rather than inventing one', async () => {
    const { _handleAgentCorpse, sent } = loadWith({ chars: { aldenmar: ALDENMAR } });
    await post(_handleAgentCorpse, death({ loc: null, zone: null }));
    expect(sent[0].content).toContain('**Aldenmar** died <t:');
    expect(sent[0].content).toContain('position unknown');
  });
});

describe('who gets it', () => {
  it('an alt with no link of its own DMs the owner of its main', async () => {
    const { _handleAgentCorpse, sent } = loadWith({
      chars: { brackwyn: { name: 'Brackwyn', discord_id: null, main_name: 'Aldenmar' }, aldenmar: ALDENMAR },
    });
    const res = await post(_handleAgentCorpse, death({ character: 'Brackwyn' }));
    expect(res.body.dm).toBe(true);
    expect(sent[0].id).toBe('111');
    expect(sent[0].content).toContain('**Brackwyn** died');
  });

  it('refuses when the uploading Mimic does not own the character: nobody else gets aimed at', async () => {
    const { _handleAgentCorpse, sent } = loadWith({ uploader: '999', chars: { aldenmar: ALDENMAR } });
    const res = await post(_handleAgentCorpse, death());
    expect(res.code).toBe(403);
    expect(res.body.code).toBe('owner_mismatch');
    expect(sent).toHaveLength(0);
  });

  it('a character with no linked account is acknowledged and nothing is sent', async () => {
    const { _handleAgentCorpse, sent } = loadWith({ chars: {} });
    const res = await post(_handleAgentCorpse, death());
    expect(res.code).toBe(200);
    expect(res.body.dm).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('rejects a name that is not a character name', async () => {
    const { _handleAgentCorpse } = loadWith({ chars: { aldenmar: ALDENMAR } });
    expect((await post(_handleAgentCorpse, death({ character: 'a%' }))).code).toBe(400);
    expect((await post(_handleAgentCorpse, '{nope')).code).toBe(400);
  });
});

describe('never twice, never a flood', () => {
  it('the same death sent again (a queue retry) is not DMed again', async () => {
    const { _handleAgentCorpse, sent } = loadWith({ chars: { aldenmar: ALDENMAR } });
    await post(_handleAgentCorpse, death());
    const again = await post(_handleAgentCorpse, death());
    expect(again.body).toMatchObject({ dm: false, duplicate: true });
    expect(sent).toHaveLength(1);
  });

  it('at most 6 an hour per owner', async () => {
    const { _handleAgentCorpse, sent } = loadWith({ chars: { aldenmar: ALDENMAR } });
    for (let i = 0; i < 8; i++) {
      await post(_handleAgentCorpse, death({ died_at: new Date(Date.parse('2026-09-26T01:00:00Z') + i * 60000).toISOString() }));
    }
    expect(sent).toHaveLength(6);
  });
});
