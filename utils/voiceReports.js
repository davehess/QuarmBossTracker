// utils/voiceReports.js — "that was said wrong" reports from Mimic (the guild lead, 2026-10-19: "B for voice").
//
//   POST /api/agent/voice-report   Mimic session bearer (requireAgentAuth). Body JSON, only `spoken` is required:
//     spoken <=300, original <=300, engine <=20, voice <=80, rate 0.1-5, pitch 0-2, agent_version <=20,
//     trigger_id <=80, trigger_name <=120, suggested_say <=300, note <=280, character <=40
//   201 { ok, id } · 400 bad body · 413 too big · 429 over 30 an hour · 503 { error: 'voice reports not set up' }
//
// The reporter is the SESSION's discord_id and nothing in the body can say otherwise. Officers review the rows on
// /admin/voice-reports (the web page reads and updates them with the service role; there is no bot route for that).
// The table arrives with supabase/migrations/20261019150000_voice_reports.sql, which is pasted by hand, so a missing
// table is a normal state here: the insert fails, a probe confirms the table is gone, and the answer is the 503.
//
// createVoiceReports() takes its collaborators so the route is testable without a database.

const { createIpLimiter } = require('./ipLimiter');

const MAX_BODY_BYTES = 8 * 1024;
const PER_HOUR = 30;

// field → max length. Every string is optional except `spoken`.
const TEXT_FIELDS = {
  spoken: 300, original: 300, engine: 20, voice: 80, agent_version: 20,
  trigger_id: 80, trigger_name: 120, suggested_say: 300, note: 280, character: 40,
};
const NUMBER_FIELDS = { rate: [0.1, 5], pitch: [0, 2] };

// Control characters out (a NUL also makes Postgres refuse the row), runs of space folded.
const _clean = (s) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();

/** → { row } with the cleaned fields, or { error } naming the first bad one. Pure. */
function validateBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'body must be a JSON object' };
  const row = {};
  for (const [k, max] of Object.entries(TEXT_FIELDS)) {
    const v = body[k];
    if (v === undefined || v === null) { row[k] = null; continue; }
    if (typeof v !== 'string') return { error: `${k} must be a string` };
    const c = _clean(v);
    if (c.length > max) return { error: `${k} is longer than ${max} characters` };
    row[k] = c || null;
  }
  if (!row.spoken) return { error: 'spoken is required' };
  for (const [k, [lo, hi]] of Object.entries(NUMBER_FIELDS)) {
    const v = body[k];
    if (v === undefined || v === null) { row[k] = null; continue; }
    if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) return { error: `${k} must be a number from ${lo} to ${hi}` };
    row[k] = v;
  }
  return { row };
}

function _json(res, status, obj, headers) {
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json' }, headers || {}));
  return res.end(JSON.stringify(obj));
}

async function _readBody(req) {
  const chunks = []; let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) return { tooBig: true };
    chunks.push(chunk);
  }
  try { return { body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }; }
  catch { return { bad: true }; }
}

function createVoiceReports({ supabase, requireAuth, fetchImpl, now = Date.now } = {}) {
  const limit = createIpLimiter({ max: PER_HOUR, windowMs: 60 * 60 * 1000, now, cleanupMs: 0 });

  // utils/supabase.js turns every failure into null, so it cannot say WHY the insert failed. Asked only after a
  // failure: does PostgREST know the table? A missing one answers PGRST205 (or 42P01 straight from Postgres).
  async function tableMissing() {
    try {
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const res = await (fetchImpl || fetch)(`${process.env.SUPABASE_URL}/rest/v1/voice_reports?select=id&limit=1`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) return false;
      let j = null; try { j = JSON.parse(await res.text()); } catch { /* not JSON: not the missing-table answer */ }
      return /^(PGRST205|42P01)$/.test(String(j && j.code)) || /does not exist|schema cache/i.test(String(j && j.message));
    } catch { return false; }
  }

  async function handle(req, res) {
    const path = String(req.url || '').split('?')[0];
    if (path !== '/api/agent/voice-report') return false;
    if (req.method !== 'POST') { await _json(res, 405, { error: 'POST only' }, { Allow: 'POST' }); return true; }

    const identity = await requireAuth(req, res);
    if (!identity) return true;
    const reporter = identity.discord_id ? String(identity.discord_id) : '';
    if (!reporter) { await _json(res, 403, { error: 'no Discord identity on this session' }); return true; }

    const read = await _readBody(req);
    if (read.tooBig) { await _json(res, 413, { error: 'body too large' }); return true; }
    if (read.bad) { await _json(res, 400, { error: 'invalid JSON' }); return true; }
    const v = validateBody(read.body);
    if (v.error) { await _json(res, 400, { error: v.error }); return true; }

    const hit = limit.hit(reporter);
    if (hit.limited) {
      await _json(res, 429, { error: 'rate_limited', retry_after: hit.retryAfterSec }, { 'Retry-After': String(hit.retryAfterSec) });
      return true;
    }

    // Written last, so a field named reporter_discord_id or guild_id in the body can never win.
    const saved = await supabase.insert('voice_reports', [Object.assign({}, v.row, {
      guild_id: supabase.guildId(),
      reporter_discord_id: reporter,
    })]);
    if (!Array.isArray(saved) || !saved[0]) {
      if (await tableMissing()) await _json(res, 503, { error: 'voice reports not set up' }, { 'Retry-After': '300' });
      else await _json(res, 500, { error: 'save failed' });
      return true;
    }
    await _json(res, 201, { ok: true, id: saved[0].id });
    return true;
  }

  return { handle };
}

module.exports = { createVoiceReports, validateBody, PER_HOUR, MAX_BODY_BYTES };
