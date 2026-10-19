// test/voice-reports.test.js — "that was said wrong" reports (the guild lead, 2026-10-19: "B for voice").
//
// The route runs for real (utils/voiceReports.js) against an in-memory stand-in for utils/supabase and a stand-in
// fetch for the missing-table probe. Source-text assertions strip comments first (the header of every file here
// names the very things under test).
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import { BOT_INDEX, ROOT, readSource, stripJs, stripSql } from './_source-slice.js';
import { metaForPath } from '../web/lib/pageMeta.ts';

const require = createRequire(import.meta.url);
const { createVoiceReports, validateBody, PER_HOUR, MAX_BODY_BYTES } = require('../utils/voiceReports.js');

const REPORTER = '900000000000000001';
const OTHER = '900000000000000002';

function mkRes() {
  const out = { status: null, headers: {}, body: '' };
  return { out, writeHead(s, h) { out.status = s; out.headers = h || {}; }, end(b) { out.body = b || ''; } };
}
function mkReq(method, url, body) {
  const raw = body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))];
  const r = Readable.from(raw);
  r.method = method; r.url = url; r.headers = {}; r.socket = { remoteAddress: '1.1.1.1' };
  return r;
}

let clock;
// probe: the answer the stand-in PostgREST gives to the "does the table exist" read after a failed insert.
function build({ identity = { discord_id: REPORTER, is_officer: false }, insertFails = false, probe = { ok: true } } = {}) {
  const rows = [];
  const sb = {
    guildId: () => 'wolfpack',
    insert: async (table, batch) => {
      if (insertFails) return null;
      const saved = batch.map((b, i) => ({ ...b, id: `id-${rows.length + i + 1}` }));
      rows.push(...saved.map(s => ({ table, ...s })));
      return saved;
    },
  };
  const probes = [];
  const fetchImpl = async (url) => {
    probes.push(url);
    if (probe.ok) return { ok: true, status: 200, text: async () => '[]' };
    return { ok: false, status: probe.status || 404, text: async () => JSON.stringify(probe.body || {}) };
  };
  const ctx = { identity };
  const v = createVoiceReports({ supabase: sb, requireAuth: async () => ctx.identity, fetchImpl, now: () => clock });
  const call = async (body, { method = 'POST', url = '/api/agent/voice-report' } = {}) => {
    const res = mkRes();
    const handled = await v.handle(mkReq(method, url, body), res);
    return { handled, status: res.out.status, headers: res.out.headers, json: res.out.body ? JSON.parse(res.out.body) : null };
  };
  return { rows, probes, call, ctx };
}

beforeEach(() => { clock = 1e12; });

const OK = { spoken: 'a thought horror evoker' };

describe('POST /api/agent/voice-report: validation', () => {
  it('saves a minimal report and answers 201 { ok, id }', async () => {
    const { call, rows } = build();
    const r = await call(OK);
    expect(r.status).toBe(201);
    expect(r.json).toEqual({ ok: true, id: 'id-1' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ table: 'voice_reports', spoken: 'a thought horror evoker', guild_id: 'wolfpack', suggested_say: null });
  });

  it('saves every field, cleaned', async () => {
    const { call, rows } = build();
    const full = {
      spoken: '  Gravel   Rain  ', original: 'Gravel Rain!', engine: 'kokoro', voice: 'af_heart', rate: 1.25, pitch: 1,
      agent_version: '3.8.7', trigger_id: 't-1', trigger_name: 'Gravel Rain', suggested_say: 'gravel rayne',
      note: 'sounds like gravy', character: 'Aldenmar',
    };
    expect((await call(full)).status).toBe(201);
    expect(rows[0]).toMatchObject({ ...full, spoken: 'Gravel Rain' });
  });

  it('strips control characters (a NUL would make Postgres refuse the row)', async () => {
    const { call, rows } = build();
    expect((await call({ spoken: 'ab\u0000c\nd' })).status).toBe(201);
    expect(rows[0].spoken).toBe('ab c d');
  });

  it.each([
    ['missing', {}],
    ['null', { spoken: null }],
    ['empty', { spoken: '' }],
    ['blank', { spoken: '   \n ' }],
    ['not a string', { spoken: 42 }],
  ])('400 when spoken is %s, and nothing is written', async (_n, body) => {
    const { call, rows } = build();
    const r = await call(body);
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/spoken/);
    expect(rows).toHaveLength(0);
  });

  it.each([
    ['spoken', 300], ['original', 300], ['engine', 20], ['voice', 80], ['agent_version', 20],
    ['trigger_id', 80], ['trigger_name', 120], ['suggested_say', 300], ['note', 280], ['character', 40],
  ])('%s: exactly %i characters is accepted, one more is a 400', async (field, max) => {
    const { call, rows } = build();
    expect((await call({ ...OK, [field]: 'x'.repeat(max) })).status).toBe(201);
    const over = await call({ ...OK, [field]: 'x'.repeat(max + 1) });
    expect(over.status).toBe(400);
    expect(over.json.error).toContain(field);
    expect(rows).toHaveLength(1);
  });

  it.each([
    ['rate', 0.05], ['rate', 5.1], ['rate', '1'], ['rate', true],
    ['pitch', -0.1], ['pitch', 2.1], ['pitch', '1'],
  ])('%s = %s is a 400', async (field, value) => {
    const { call, rows } = build();
    const r = await call({ ...OK, [field]: value });
    expect(r.status).toBe(400);
    expect(rows).toHaveLength(0);
  });

  it('a number JSON.parse turns into Infinity is a 400', async () => {
    const { call, rows } = build();
    expect((await call('{"spoken":"x","rate":1e999}')).status).toBe(400);
    expect(rows).toHaveLength(0);
  });

  it('the range ends are accepted', async () => {
    const { call, rows } = build();
    for (const [rate, pitch] of [[0.1, 0], [5, 2]]) expect((await call({ ...OK, rate, pitch })).status).toBe(201);
    expect(rows.map(r => [r.rate, r.pitch])).toEqual([[0.1, 0], [5, 2]]);
  });

  it('400 for a body that is not a JSON object', async () => {
    const { call } = build();
    expect((await call('not json')).status).toBe(400);
    expect((await call('[1,2]')).status).toBe(400);
    expect((await call('null')).status).toBe(400);
    expect((await call(undefined)).status).toBe(400);
  });

  it('413 over the body cap', async () => {
    const { call, rows } = build();
    const r = await call({ ...OK, note: 'x'.repeat(MAX_BODY_BYTES) });
    expect(r.status).toBe(413);
    expect(rows).toHaveLength(0);
  });

  it('validateBody is pure and names the first bad field', () => {
    expect(validateBody({ spoken: 'hi', rate: 9 }).error).toMatch(/rate/);
    expect(validateBody({ spoken: 'hi' }).row.rate).toBeNull();
  });
});

describe('POST /api/agent/voice-report: who reported', () => {
  it('takes the reporter and the guild from the SESSION, never the body', async () => {
    const { call, rows } = build();
    const r = await call({ ...OK, reporter_discord_id: OTHER, guild_id: 'someone-else', reviewed_by: OTHER, status: 'fixed', id: 'mine' });
    expect(r.status).toBe(201);
    expect(rows[0].reporter_discord_id).toBe(REPORTER);
    expect(rows[0].guild_id).toBe('wolfpack');
    expect(rows[0]).not.toHaveProperty('reviewed_by');
    expect(rows[0]).not.toHaveProperty('status');
    expect(rows[0].id).toBe('id-1');
  });

  it('an unauthenticated call writes nothing', async () => {
    const { call, rows, ctx } = build();
    ctx.identity = null;
    const r = await call(OK);
    expect(rows).toHaveLength(0);
    expect(r.status).toBeNull();   // requireAuth answers the 401 itself; the route just stops
  });

  it('a session with no Discord id is refused', async () => {
    const { call, rows } = build({ identity: { discord_id: null } });
    expect((await call(OK)).status).toBe(403);
    expect(rows).toHaveLength(0);
  });

  it('is only the POST route', async () => {
    const { call } = build();
    expect((await call(undefined, { method: 'GET' })).status).toBe(405);
    expect((await call(OK, { url: '/api/agent/voice-reports' })).handled).toBe(false);
  });
});

describe('POST /api/agent/voice-report: rate limit', () => {
  it(`${PER_HOUR} an hour per reporter; the next is a 429 with Retry-After`, async () => {
    expect(PER_HOUR).toBe(30);   // the contract's number, spelled out so a changed constant cannot pass by following itself
    const { call, rows } = build();
    for (let i = 0; i < PER_HOUR; i++) expect((await call(OK)).status).toBe(201);
    const r = await call(OK);
    expect(r.status).toBe(429);
    expect(Number(r.headers['Retry-After'])).toBeGreaterThan(0);
    expect(rows).toHaveLength(PER_HOUR);
  });

  it('is per reporter, and the window reopens after an hour', async () => {
    const { call, rows, ctx } = build();
    for (let i = 0; i < PER_HOUR + 1; i++) await call(OK);
    ctx.identity = { discord_id: OTHER };
    expect((await call(OK)).status).toBe(201);
    ctx.identity = { discord_id: REPORTER };
    expect((await call(OK)).status).toBe(429);
    clock += 60 * 60 * 1000 + 1;
    expect((await call(OK)).status).toBe(201);
    expect(rows).toHaveLength(PER_HOUR + 2);
  });

  it('a rejected body does not spend the reporter\'s budget', async () => {
    const { call } = build();
    for (let i = 0; i < PER_HOUR + 5; i++) expect((await call({})).status).toBe(400);
    expect((await call(OK)).status).toBe(201);
  });
});

describe('POST /api/agent/voice-report: before the SQL is pasted', () => {
  it('503 { error: voice reports not set up } when PostgREST says the table is not there', async () => {
    const { call, probes } = build({ insertFails: true, probe: { ok: false, status: 404, body: { code: 'PGRST205', message: "Could not find the table 'public.voice_reports' in the schema cache" } } });
    const r = await call(OK);
    expect(r.status).toBe(503);
    expect(r.json).toEqual({ error: 'voice reports not set up' });
    expect(probes[0]).toContain('/rest/v1/voice_reports');
  });

  it('also on a raw Postgres 42P01', async () => {
    const { call } = build({ insertFails: true, probe: { ok: false, status: 400, body: { code: '42P01', message: 'relation "public.voice_reports" does not exist' } } });
    expect((await call(OK)).status).toBe(503);
  });

  it('any other failed save is a plain 500, not "not set up"', async () => {
    const { call } = build({ insertFails: true, probe: { ok: true } });
    const r = await call(OK);
    expect(r.status).toBe(500);
    expect(r.json.error).not.toMatch(/not set up/);
    const b = build({ insertFails: true, probe: { ok: false, status: 500, body: { code: 'XX000', message: 'boom' } } });
    expect((await b.call(OK)).status).toBe(500);
  });
});

describe('wiring', () => {
  const index = stripJs(readSource(BOT_INDEX));
  it('index.js routes POST /api/agent/voice-report to utils/voiceReports.js', () => {
    expect(index).toMatch(/req\.method === 'POST' && req\.url\.split\('\?'\)\[0\] === '\/api\/agent\/voice-report'/);
    expect(index).toMatch(/require\('\.\/utils\/voiceReports'\)\.createVoiceReports\(/);
  });
  it('the route authenticates with the same agent session as the other /api/agent routes', () => {
    const wiring = index.slice(index.indexOf('function _voiceReportRoutes'));
    expect(wiring.slice(0, 400)).toMatch(/requireAuth: \(rq, rs\) => mimicLink\.requireAgentAuth\(rq, rs\)/);
  });
});

describe('migration 20261019150000_voice_reports.sql', () => {
  const sql = stripSql(fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20261019150000_voice_reports.sql'), 'utf8'));
  it('creates the table with every column, idempotently', () => {
    expect(sql).toMatch(/create table if not exists public\.voice_reports/);
    for (const col of ['id', 'guild_id', 'reporter_discord_id', 'character', 'spoken', 'original', 'engine', 'voice', 'rate', 'pitch',
      'agent_version', 'trigger_id', 'trigger_name', 'suggested_say', 'note', 'status', 'created_at', 'reviewed_by', 'reviewed_at']) {
      expect(sql).toMatch(new RegExp(`^\\s+${col}\\s`, 'm'));
    }
    expect(sql).toMatch(/id\s+uuid primary key default gen_random_uuid\(\)/);
    expect(sql).toMatch(/reporter_discord_id text not null/);
  });
  it('status is open | fixed | dismissed and defaults to open', () => {
    expect(sql).toMatch(/status\s+text not null default 'open' check \(status in \('open', 'fixed', 'dismissed'\)\)/);
  });
  it('mirrors the route\'s limits', () => {
    expect(sql).toMatch(/char_length\(spoken\) between 1 and 300/);
    expect(sql).toMatch(/rate >= 0\.1 and rate <= 5/);
    expect(sql).toMatch(/pitch >= 0 and pitch <= 2/);
    expect(sql).toMatch(/char_length\(note\) <= 280/);
  });
  it('indexes (guild_id, status, created_at desc)', () => {
    expect(sql).toMatch(/create index if not exists voice_reports_guild_status_idx\s+on public\.voice_reports \(guild_id, status, created_at desc\)/);
  });
  it('is service-role only: RLS on, no policy, grants taken from anon and authenticated', () => {
    expect(sql).toMatch(/alter table public\.voice_reports enable row level security/);
    expect(sql).toMatch(/revoke all on public\.voice_reports from anon, authenticated/);
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).not.toMatch(/grant /i);
  });
  it('nothing in it is unguarded by if-not-exists, and it never drops anything', () => {
    expect(sql).not.toMatch(/drop (table|column)/i);
    for (const m of sql.match(/create (table|index)[^\n]*/gi)) expect(m).toMatch(/if not exists/);
  });
});

describe('the officer page', () => {
  const page = stripJs(fs.readFileSync(path.join(ROOT, 'web/app/admin/voice-reports/page.tsx'), 'utf8'));
  const actions = stripJs(fs.readFileSync(path.join(ROOT, 'web/app/admin/voice-reports/actions.ts'), 'utf8'));
  const list = stripJs(fs.readFileSync(path.join(ROOT, 'web/app/admin/voice-reports/VoiceReportList.tsx'), 'utf8'));

  it('gates on requireOfficer before it reads, and carries the [beta] tag', () => {
    expect(page.indexOf('await requireOfficer()')).toBeGreaterThan(-1);
    expect(page.indexOf('await requireOfficer()')).toBeLessThan(page.indexOf('supabaseAdmin()'));
    expect(page).toMatch(/<NewPageTag /);
    expect(page).toMatch(/title: '\[beta\] Voice reports · Admin'/);
  });
  it('lists only open reports, newest first, and never selects the reporter\'s Discord id', () => {
    expect(page).toMatch(/\.eq\('status', 'open'\)/);
    expect(page).toMatch(/\.order\('created_at', \{ ascending: false \}\)/);
    expect(page).not.toMatch(/reporter_discord_id/);
  });
  it('shows a clear "not set up yet" state when the table is missing', () => {
    expect(page).toMatch(/PGRST205/);
    expect(page).toMatch(/42P01/);
    expect(page).toMatch(/Not set up yet/);
    expect(page).toMatch(/20261019150000_voice_reports\.sql/);
  });
  it('the server action asks isOfficer again and only writes fixed or dismissed', () => {
    expect(actions).toMatch(/await isOfficer\(user\.id\)/);
    expect(actions.indexOf('isOfficer(user.id)')).toBeLessThan(actions.indexOf(".from('voice_reports')"));
    expect(actions).toMatch(/status !== 'fixed' && status !== 'dismissed'/);
  });
  it('the table speaks suggested_say || spoken at the stored rate and pitch, and has Fixed and Dismiss', () => {
    expect(list).toMatch(/new SpeechSynthesisUtterance\(r\.suggested_say \|\| r\.spoken\)/);
    expect(list).toMatch(/u\.rate = r\.rate/);
    expect(list).toMatch(/u\.pitch = r\.pitch/);
    expect(list).toMatch(/close\(r\.id, 'fixed'\)/);
    expect(list).toMatch(/close\(r\.id, 'dismissed'\)/);
    expect(page).toMatch(/browser&apos;s<\/b> voice/);
  });
  it('unfurls with its own name and is linked from the officer index', () => {
    expect(metaForPath('/admin/voice-reports').title).toBe('[beta] Voice reports · Admin');
    expect(stripJs(fs.readFileSync(path.join(ROOT, 'web/app/admin/page.tsx'), 'utf8'))).toMatch(/href="\/admin\/voice-reports"/);
  });
});
