// utils/gallery.js — the Masterpiece Gallery's HTTP routes (Keepers of the Arts; the guild lead, 2026-10-19).
//
//   PUBLIC (no sign-in; cached; rate-limited)           MEMBER (Mimic session, requireAgentAuth)
//   GET  /api/public/gallery                            GET    /api/agent/gallery            guild + public (+ ?mine=1)
//   GET  /api/public/gallery/<id>                       GET    /api/agent/gallery/<id>       latest version's spec
//   POST /api/public/gallery/<id>/adopt                 POST   /api/agent/gallery            publish a new masterpiece
//   POST /api/public/gallery/<id>/report                POST   /api/agent/gallery/<id>/versions     a new version
//                                                       POST   /api/agent/gallery/<id>/visibility   guild | public
//   OFFICER (is_officer on the same session)            POST   /api/agent/gallery/<id>/status       draft | published
//   GET  /api/agent/gallery/review                      DELETE /api/agent/gallery/<id>       delete your own
//   POST /api/agent/gallery/<id>/feature                POST   /api/agent/gallery/<id>/adopt | /report
//   POST /api/agent/gallery/<id>/hide
//
// What is private: author_discord_id, edit_key_hash, hidden_by, reviewed_at, every adoption and report row. Responses are
// built by the whitelist mappers below, never by passing a row through, so a column added later cannot leak by default.
//
// Anonymous adoption is deduped on a RANDOM per-install id the client keeps locally and sends as `install_id`; the bot
// stores only a salted hash of it, so there is nothing to join back to a person. Reports from the public are keyed by a
// salted IP hash and use a closed list of reasons (no free text from strangers). Three distinct reporters hide a layout
// pending an officer's review.
//
// createGallery() takes its collaborators so the routes are testable without a database; index.js wires the real ones.

const crypto = require('crypto');
const { createIpLimiter } = require('./ipLimiter');
const { clientIp } = require('./clientIp');
const spec = require('./gallerySpec');

const BADGE = 'Wolf Pack member';
const REPORT_HIDE_THRESHOLD = 3;
const LIST_TTL_MS = 60 * 1000;
const DETAIL_TTL_MS = 60 * 1000;
const LIST_BASE_MAX = 500;            // rows held for the public list; filters/paging run over this in memory
const DETAIL_CACHE_MAX = 200;
const PAGE_DEFAULT = 50;
const PAGE_MAX = 100;
const MAX_BODY_BYTES = 80 * 1024;
const IP_HASH_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_PER_AUTHOR = 25;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INSTALL_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

// Columns a public response may be built from. author_discord_id is NOT here and never will be.
// visibility + status are selected only so the bot can re-check them itself (publicShape does not echo them).
const PUBLIC_COLS = 'id,title,blurb,classes,min_level,modes,byline,submitter_kind,featured,adoptions_count,latest_version,thumb,created_at,updated_at,visibility,status';
// Member routes also need ownership + state to decide what the caller may do; still never echoed back.
const MEMBER_COLS = PUBLIC_COLS + ',author_discord_id,guild_id';

// The listing (title, description, classes, modes, byline) is READ FROM the portable document's meta, so a new version
// carries its own. Only what the document cannot say is a separate field.
const PUBLISH_KEYS = new Set(['spec', 'visibility', 'status', 'min_level']);
const VERSION_KEYS = new Set(['spec']);

function _json(res, status, obj, headers) {
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json' }, headers || {}));
  return res.end(JSON.stringify(obj));
}

function _etag(body) { return '"' + crypto.createHash('sha1').update(body).digest('hex') + '"'; }

async function _readBody(req, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) return { tooBig: true };
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return { body: {} };
  try {
    const body = JSON.parse(text);
    return (body && typeof body === 'object' && !Array.isArray(body)) ? { body } : { bad: true };
  } catch { return { bad: true }; }
}

const _isPublic = (r) => !!r && r.visibility === 'public' && r.status === 'published';

// Whitelist mappers. The ONLY way a row reaches a response.
function publicShape(r) {
  return {
    id: r.id,
    title: r.title,
    blurb: r.blurb || '',
    classes: Array.isArray(r.classes) ? r.classes : [],
    min_level: r.min_level,
    modes: Array.isArray(r.modes) ? r.modes : [],
    byline: r.byline || null,
    badge: r.submitter_kind === 'member' ? BADGE : null,   // server-set; a byline cannot produce it
    hall: !!r.featured,
    adoptions: r.adoptions_count | 0,
    version: r.latest_version | 0,
    thumb: r.thumb || null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}
function memberShape(r, identity) {
  const mine = !!identity && String(r.author_discord_id || '') === String(identity.discord_id);
  const out = publicShape(r);
  out.visibility = r.visibility;
  out.status = r.status;
  out.mine = mine;
  return out;
}

function createGallery({ supabase, requireAuth, salt, now = Date.now } = {}) {
  const adoptLimit = createIpLimiter({ max: 30, windowMs: 60 * 60 * 1000, now, cleanupMs: 0 });
  const reportLimit = createIpLimiter({ max: 6, windowMs: 60 * 60 * 1000, now, cleanupMs: 0 });
  const publishLimit = createIpLimiter({ max: 20, windowMs: 60 * 60 * 1000, now, cleanupMs: 0 });

  let _listBase = null;                   // { at, rows: [publicShape], bodies: Map<key, {body, etag}> }
  const _detail = new Map();              // id -> { at, body, etag }
  const flush = () => { _listBase = null; _detail.clear(); };

  // GALLERY_SALT only. Unset means the PUBLIC adopt and report routes answer 503 (fail closed): without a secret salt a
  // stored hash of an address or install id could be brute-forced back. Member routes key on a Discord id and need none.
  function _salt() {
    const s = typeof salt === 'function' ? salt() : salt;
    return s || process.env.GALLERY_SALT || null;
  }
  const _ipHash = (req) => crypto.createHash('sha256').update(`${clientIp(req)}|${_salt()}`).digest('hex');
  const _installKey = (id) => 'i:' + crypto.createHash('sha256').update(`install|${_salt()}|${id}`).digest('hex');
  const _notSetUp = (res) => _json(res, 503, { error: 'not set up on this server yet' }, { 'Retry-After': '300' });

  // ── public list ────────────────────────────────────────────────────────────
  async function _loadListBase() {
    if (_listBase && now() - _listBase.at < LIST_TTL_MS) return _listBase;
    const rows = await supabase.select('gallery_masterpieces',
      `select=${PUBLIC_COLS}&guild_id=eq.${encodeURIComponent(supabase.guildId())}&status=eq.published&visibility=eq.public` +
      `&order=featured.desc,adoptions_count.desc,created_at.desc,id.asc&limit=${LIST_BASE_MAX}`);
    if (!Array.isArray(rows)) {
      if (_listBase) { _listBase.at = now() - LIST_TTL_MS + 15 * 1000; return _listBase; }   // keep serving, retry soon
      return null;
    }
    // The query already filters; this re-check and sort are the guard if it ever stops doing so (a guild-only layout
    // on the public list is the one mistake that cannot be taken back).
    const shown = rows.filter(_isPublic).sort((a, b) =>
      (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || (b.adoptions_count | 0) - (a.adoptions_count | 0)
      || String(b.created_at).localeCompare(String(a.created_at)) || String(a.id).localeCompare(String(b.id)));
    _listBase = { at: now(), rows: shown.map(publicShape), bodies: new Map() };
    return _listBase;
  }

  function _listParams(url) {
    const q = new URL(url, 'http://x').searchParams;
    const cls = spec.CLASSES.find(c => c.toLowerCase() === String(q.get('class') || '').toLowerCase()) || null;
    const mode = spec.MODES.includes(q.get('mode')) ? q.get('mode') : null;
    const limit = Math.min(PAGE_MAX, Math.max(1, parseInt(q.get('limit'), 10) || PAGE_DEFAULT));
    const offset = Math.min(LIST_BASE_MAX, Math.max(0, parseInt(q.get('offset'), 10) || 0));
    return { cls, mode, limit, offset };
  }

  async function publicList(req, res) {
    const base = await _loadListBase();
    if (!base) return _json(res, 503, { error: 'gallery unavailable' }, { 'Retry-After': '60' });
    const p = _listParams(req.url);
    const key = `${p.cls || ''}|${p.mode || ''}|${p.limit}|${p.offset}`;   // only validated values: bounded cardinality
    let hit = base.bodies.get(key);
    if (!hit) {
      // A layout with no class tags suits every class, so a class filter keeps it.
      const rows = base.rows.filter(r => (!p.cls || !r.classes.length || r.classes.includes(p.cls)) && (!p.mode || r.modes.includes(p.mode)));
      const body = JSON.stringify({ total: rows.length, offset: p.offset, items: rows.slice(p.offset, p.offset + p.limit) });
      hit = { body, etag: _etag(body) };
      base.bodies.set(key, hit);
    }
    const headers = { ETag: hit.etag, 'Cache-Control': 'public, max-age=60' };
    if (req.headers['if-none-match'] === hit.etag) { res.writeHead(304, headers); return res.end(); }
    res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, headers));
    return res.end(hit.body);
  }

  // ── one masterpiece with its latest spec ───────────────────────────────────
  async function _latestVersion(m) {
    const v = await supabase.select('gallery_versions',
      `select=version,spec,needs&masterpiece_id=eq.${encodeURIComponent(m.id)}&version=eq.${m.latest_version | 0}&limit=1`);
    if (!Array.isArray(v)) return undefined;     // read failed
    return v[0] || null;
  }

  async function publicDetail(req, res, id) {
    const c = _detail.get(id);
    let hit = c && now() - c.at < DETAIL_TTL_MS ? c : null;
    if (!hit) {
      const rows = await supabase.select('gallery_masterpieces',
        `select=${PUBLIC_COLS}&id=eq.${id}&guild_id=eq.${encodeURIComponent(supabase.guildId())}&status=eq.published&visibility=eq.public&limit=1`);
      if (!Array.isArray(rows)) return _json(res, 503, { error: 'gallery unavailable' }, { 'Retry-After': '60' });
      if (!_isPublic(rows[0])) return _json(res, 404, { error: 'not found' });
      const v = await _latestVersion(rows[0]);
      if (v === undefined) return _json(res, 503, { error: 'gallery unavailable' }, { 'Retry-After': '60' });
      if (!v) return _json(res, 404, { error: 'not found' });
      const body = JSON.stringify({ item: publicShape(rows[0]), spec: v.spec, needs: v.needs || [] });
      hit = { at: now(), body, etag: _etag(body) };
      if (_detail.size >= DETAIL_CACHE_MAX) _detail.delete(_detail.keys().next().value);
      _detail.set(id, hit);
    }
    const headers = { ETag: hit.etag, 'Cache-Control': 'public, max-age=60' };
    if (req.headers['if-none-match'] === hit.etag) { res.writeHead(304, headers); return res.end(); }
    res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, headers));
    return res.end(hit.body);
  }

  // ── adopt (public + member share one body) ─────────────────────────────────
  async function _adopt(res, m, adopterKey) {
    // insert-or-ignore: the table's primary key is the dedupe, and only a NEW row comes back (the trigger counts it).
    const r = await supabase.insertIgnoreDuplicates('gallery_adoptions',
      [{ masterpiece_id: m.id, adopter_key: adopterKey, version: m.latest_version | 0 }], { representation: true });
    if (!Array.isArray(r)) return _json(res, 503, { error: 'could not record that, try again' }, { 'Retry-After': '30' });
    return _json(res, 200, { ok: true, counted: r.length > 0, version: m.latest_version | 0 });
  }

  async function publicAdopt(req, res, id) {
    if (!_salt()) return _notSetUp(res);
    if (adoptLimit.hit(clientIp(req)).limited) return _json(res, 429, { error: 'rate_limited' }, { 'Retry-After': '600' });
    const got = await _readBody(req, 2048);
    if (got.tooBig) return _json(res, 413, { error: 'too large' });
    if (got.bad) return _json(res, 400, { error: 'invalid JSON' });
    const installId = got.body.install_id;
    if (typeof installId !== 'string' || !INSTALL_ID_RE.test(installId)) {
      return _json(res, 400, { error: 'install_id must be a random 16-64 character id' });
    }
    const rows = await supabase.select('gallery_masterpieces',
      `select=id,latest_version,visibility,status&id=eq.${id}&guild_id=eq.${encodeURIComponent(supabase.guildId())}&status=eq.published&visibility=eq.public&limit=1`);
    if (!Array.isArray(rows)) return _json(res, 503, { error: 'gallery unavailable' }, { 'Retry-After': '60' });
    if (!_isPublic(rows[0])) return _json(res, 404, { error: 'not found' });
    return _adopt(res, rows[0], _installKey(installId));
  }

  // ── report (public + member share one path) ────────────────────────────────
  async function _report(res, m, reason, who) {
    if (!spec.REPORT_REASONS.includes(reason)) {
      return _json(res, 400, { error: `reason must be one of ${spec.REPORT_REASONS.join(', ')}` });
    }
    // An address hash only has to outlive the dedupe for a while: older ones are nulled (the row still counts).
    await supabase.update('gallery_reports',
      `ip_hash=not.is.null&created_at=lt.${encodeURIComponent(new Date(now() - IP_HASH_KEEP_MS).toISOString())}`, { ip_hash: null });
    const row = { masterpiece_id: m.id, reason };
    if (who.discordId) row.reporter_discord_id = String(who.discordId); else row.ip_hash = who.ipHash;
    const ins = await supabase.insertIgnoreDuplicates('gallery_reports', [row], { representation: true });
    if (!Array.isArray(ins)) return _json(res, 503, { error: 'could not record that, try again' }, { 'Retry-After': '30' });
    // Distinct reporters since the last officer review. The unique index keeps one reporter to one row.
    const since = m.reviewed_at ? `&created_at=gt.${encodeURIComponent(m.reviewed_at)}` : '';
    const reports = await supabase.select('gallery_reports',
      `select=id&masterpiece_id=eq.${encodeURIComponent(m.id)}${since}&limit=${REPORT_HIDE_THRESHOLD + 5}`);
    let hidden = false;
    if (Array.isArray(reports) && reports.length >= REPORT_HIDE_THRESHOLD && m.status === 'published') {
      const done = await supabase.update('gallery_masterpieces', `id=eq.${encodeURIComponent(m.id)}&status=eq.published`,
        { status: 'hidden', hidden_by: 'reports', updated_at: new Date(now()).toISOString() });
      hidden = Array.isArray(done) && done.length > 0;
      if (hidden) flush();
    }
    return _json(res, 200, { ok: true });   // the same answer whether it counted or hid anything: nothing to probe
  }

  async function publicReport(req, res, id) {
    if (!_salt()) return _notSetUp(res);
    if (reportLimit.hit(clientIp(req)).limited) return _json(res, 429, { error: 'rate_limited' }, { 'Retry-After': '600' });
    const got = await _readBody(req, 1024);
    if (got.tooBig) return _json(res, 413, { error: 'too large' });
    if (got.bad) return _json(res, 400, { error: 'invalid JSON' });
    const rows = await supabase.select('gallery_masterpieces',
      `select=id,status,visibility,reviewed_at&id=eq.${id}&guild_id=eq.${encodeURIComponent(supabase.guildId())}&status=eq.published&visibility=eq.public&limit=1`);
    if (!Array.isArray(rows)) return _json(res, 503, { error: 'gallery unavailable' }, { 'Retry-After': '60' });
    if (!_isPublic(rows[0])) return _json(res, 404, { error: 'not found' });
    return _report(res, rows[0], got.body.reason, { ipHash: _ipHash(req) });
  }

  // ── member routes ──────────────────────────────────────────────────────────
  async function _load(res, id, identity) {
    const rows = await supabase.select('gallery_masterpieces',
      `select=${MEMBER_COLS},hidden_by,reviewed_at&id=eq.${id}&guild_id=eq.${encodeURIComponent(supabase.guildId())}&limit=1`);
    if (!Array.isArray(rows)) { _json(res, 503, { error: 'gallery unavailable' }, { 'Retry-After': '60' }); return null; }
    const m = rows[0];
    if (!m) { _json(res, 404, { error: 'not found' }); return null; }
    if (identity && String(m.author_discord_id) !== String(identity.discord_id)) {
      _json(res, 403, { error: 'not yours' });
      return null;
    }
    return m;
  }

  // A member may see what is published to the guild, or their own at any status; an officer sees everything.
  function _visibleTo(m, identity) {
    if (String(m.author_discord_id) === String(identity.discord_id)) return m.status !== 'removed';
    if (identity.is_officer) return m.status !== 'removed';
    return m.status === 'published';
  }

  async function memberList(req, res, identity) {
    const q = new URL(req.url, 'http://x').searchParams;
    const mine = q.get('mine') === '1';
    const filter = mine
      ? `author_discord_id=eq.${encodeURIComponent(identity.discord_id)}&status=neq.removed`
      : 'status=eq.published';
    const rows = await supabase.select('gallery_masterpieces',
      `select=${MEMBER_COLS}&guild_id=eq.${encodeURIComponent(supabase.guildId())}&${filter}` +
      `&order=featured.desc,adoptions_count.desc,created_at.desc,id.asc&limit=${LIST_BASE_MAX}`);
    if (!Array.isArray(rows)) return _json(res, 503, { error: 'gallery unavailable' }, { 'Retry-After': '30' });
    // Same belt as the public list: the query filters, and the bot re-checks what the caller may see.
    const shown = rows.filter(r => (mine ? String(r.author_discord_id) === String(identity.discord_id) && r.status !== 'removed' : r.status === 'published'));
    return _json(res, 200, { total: shown.length, items: shown.map(r => memberShape(r, identity)) });
  }

  async function memberDetail(req, res, identity, id) {
    const m = await _load(res, id, null);
    if (!m) return;
    if (!_visibleTo(m, identity)) return _json(res, 404, { error: 'not found' });
    const v = await _latestVersion(m);
    if (v === undefined) return _json(res, 503, { error: 'gallery unavailable' }, { 'Retry-After': '30' });
    if (!v) return _json(res, 404, { error: 'not found' });
    return _json(res, 200, { item: memberShape(m, identity), spec: v.spec, needs: v.needs || [] });
  }

  async function _bodyOr400(req, res, max = MAX_BODY_BYTES) {
    const got = await _readBody(req, max);
    if (got.tooBig) { _json(res, 413, { error: 'too large' }); return null; }
    if (got.bad) { _json(res, 400, { error: 'invalid JSON' }); return null; }
    return got.body;
  }

  async function memberPublish(req, res, identity) {
    if (publishLimit.hit(String(identity.discord_id)).limited) return _json(res, 429, { error: 'rate_limited' }, { 'Retry-After': '600' });
    const body = await _bodyOr400(req, res);
    if (!body) return;
    const bad = Object.keys(body).find(k => !PUBLISH_KEYS.has(k));
    if (bad) return _json(res, 400, { error: `unknown field "${String(bad).slice(0, 24)}"` });
    const vspec = spec.validateSpec(body.spec);
    if (!vspec.ok) return _json(res, 400, { error: vspec.error });
    const level = spec.cleanMinLevel(body.min_level);
    if (!level.ok) return _json(res, 400, { error: level.error });
    const listing = vspec.listing;
    const visibility = body.visibility === undefined ? 'guild' : body.visibility;
    if (visibility !== 'guild' && visibility !== 'public') return _json(res, 400, { error: 'visibility must be guild or public' });
    const status = body.status === undefined ? 'published' : body.status;
    if (status !== 'draft' && status !== 'published') return _json(res, 400, { error: 'status must be draft or published' });

    const owned = await supabase.select('gallery_masterpieces',
      `select=id&author_discord_id=eq.${encodeURIComponent(identity.discord_id)}&status=neq.removed&limit=${MAX_PER_AUTHOR + 1}`);
    if (!Array.isArray(owned)) return _json(res, 503, { error: 'gallery unavailable' }, { 'Retry-After': '30' });
    if (owned.length >= MAX_PER_AUTHOR) return _json(res, 409, { error: `you can keep ${MAX_PER_AUTHOR} layouts; delete one first` });

    const created = await supabase.insert('gallery_masterpieces', [{
      guild_id: supabase.guildId(),
      title: listing.title, blurb: listing.blurb, classes: listing.classes, modes: listing.modes, min_level: level.value,
      byline: listing.byline, submitter_kind: 'member', author_discord_id: String(identity.discord_id),
      visibility, status, latest_version: 1, thumb: vspec.thumb,
    }]);
    const m = Array.isArray(created) ? created[0] : null;
    if (!m) return _json(res, 500, { error: 'save failed' });
    const v = await supabase.insert('gallery_versions', [{ masterpiece_id: m.id, version: 1, spec: vspec.spec, needs: vspec.needs }]);
    if (!Array.isArray(v) || !v[0]) {
      await supabase.del('gallery_masterpieces', `id=eq.${encodeURIComponent(m.id)}`);   // no half-published layout
      return _json(res, 500, { error: 'save failed' });
    }
    flush();
    return _json(res, 200, { ok: true, id: m.id, version: 1, visibility, status });
  }

  async function memberNewVersion(req, res, identity, id) {
    if (publishLimit.hit(String(identity.discord_id)).limited) return _json(res, 429, { error: 'rate_limited' }, { 'Retry-After': '600' });
    const body = await _bodyOr400(req, res);
    if (!body) return;
    const bad = Object.keys(body).find(k => !VERSION_KEYS.has(k));
    if (bad) return _json(res, 400, { error: `unknown field "${String(bad).slice(0, 24)}"` });
    const vspec = spec.validateSpec(body.spec);
    if (!vspec.ok) return _json(res, 400, { error: vspec.error });
    const m = await _load(res, id, identity);
    if (!m) return;
    if (m.status === 'removed' || m.status === 'hidden') return _json(res, 409, { error: 'this layout is hidden; ask an officer' });
    const next = (m.latest_version | 0) + 1;
    const v = await supabase.insert('gallery_versions', [{ masterpiece_id: m.id, version: next, spec: vspec.spec, needs: vspec.needs }]);
    if (!Array.isArray(v) || !v[0]) return _json(res, 409, { error: 'could not add that version, try again' });
    // The listing text lives in the document's meta, so the new version carries the new title, description, classes,
    // modes and byline with it (there is no separate edit of the text in v1).
    const L = vspec.listing;
    const up = await supabase.update('gallery_masterpieces', `id=eq.${encodeURIComponent(m.id)}`, {
      latest_version: next, thumb: vspec.thumb, title: L.title, blurb: L.blurb, classes: L.classes, modes: L.modes,
      byline: L.byline, updated_at: new Date(now()).toISOString(),
    });
    if (!Array.isArray(up)) return _json(res, 500, { error: 'save failed' });
    flush();
    return _json(res, 200, { ok: true, version: next });
  }

  async function memberSetVisibility(req, res, identity, id) {
    const body = await _bodyOr400(req, res, 1024);
    if (!body) return;
    if (body.visibility !== 'guild' && body.visibility !== 'public') return _json(res, 400, { error: 'visibility must be guild or public' });
    const m = await _load(res, id, identity);
    if (!m) return;
    const up = await supabase.update('gallery_masterpieces', `id=eq.${encodeURIComponent(m.id)}`,
      { visibility: body.visibility, updated_at: new Date(now()).toISOString() });
    if (!Array.isArray(up)) return _json(res, 500, { error: 'save failed' });
    flush();
    return _json(res, 200, { ok: true, visibility: body.visibility });
  }

  // Publish / unpublish your own. A hidden or removed layout stays out of the author's hands: only an officer lifts it.
  async function memberSetStatus(req, res, identity, id) {
    const body = await _bodyOr400(req, res, 1024);
    if (!body) return;
    if (body.status !== 'draft' && body.status !== 'published') return _json(res, 400, { error: 'status must be draft or published' });
    const m = await _load(res, id, identity);
    if (!m) return;
    if (m.status !== 'draft' && m.status !== 'published') return _json(res, 409, { error: 'this layout is hidden; ask an officer' });
    const up = await supabase.update('gallery_masterpieces', `id=eq.${encodeURIComponent(m.id)}`,
      { status: body.status, updated_at: new Date(now()).toISOString() });
    if (!Array.isArray(up)) return _json(res, 500, { error: 'save failed' });
    flush();
    return _json(res, 200, { ok: true, status: body.status });
  }

  async function memberDelete(req, res, identity, id) {
    const m = await _load(res, id, identity);
    if (!m) return;
    const r = await supabase.del('gallery_masterpieces', `id=eq.${encodeURIComponent(m.id)}&author_discord_id=eq.${encodeURIComponent(identity.discord_id)}`);
    if (r === null) return _json(res, 500, { error: 'delete failed' });
    flush();
    return _json(res, 200, { ok: true });
  }

  async function memberAdopt(req, res, identity, id) {
    const m = await _load(res, id, null);
    if (!m) return;
    if (m.status !== 'published') return _json(res, 404, { error: 'not found' });
    return _adopt(res, m, 'd:' + String(identity.discord_id));
  }

  async function memberReport(req, res, identity, id) {
    const body = await _bodyOr400(req, res, 1024);
    if (!body) return;
    const m = await _load(res, id, null);
    if (!m) return;
    if (m.status !== 'published') return _json(res, 404, { error: 'not found' });
    return _report(res, m, body.reason, { discordId: identity.discord_id });
  }

  // ── officer routes ─────────────────────────────────────────────────────────
  async function officerFeature(req, res, identity, id) {
    const body = await _bodyOr400(req, res, 1024);
    if (!body) return;
    if (typeof body.featured !== 'boolean') return _json(res, 400, { error: 'featured must be true or false' });
    const m = await _load(res, id, null);
    if (!m) return;
    if (body.featured && m.status !== 'published') return _json(res, 409, { error: 'only a published layout can join the Hall' });
    const up = await supabase.update('gallery_masterpieces', `id=eq.${encodeURIComponent(m.id)}`, {
      featured: body.featured, featured_at: body.featured ? new Date(now()).toISOString() : null,
      updated_at: new Date(now()).toISOString(),
    });
    if (!Array.isArray(up)) return _json(res, 500, { error: 'save failed' });
    flush();
    return _json(res, 200, { ok: true, featured: body.featured });
  }

  async function officerHide(req, res, identity, id) {
    const body = await _bodyOr400(req, res, 1024);
    if (!body) return;
    if (typeof body.hidden !== 'boolean') return _json(res, 400, { error: 'hidden must be true or false' });
    const m = await _load(res, id, null);
    if (!m) return;
    const stamp = new Date(now()).toISOString();
    let patch;
    if (body.hidden) {
      if (m.status !== 'published') return _json(res, 409, { error: 'only a published layout can be hidden' });
      patch = { status: 'hidden', hidden_by: 'officer', featured: false, featured_at: null, updated_at: stamp };
    } else {
      if (m.status !== 'hidden') return _json(res, 409, { error: 'not hidden' });
      // Unhide = reviewed: reports before now no longer count toward a new auto-hide.
      patch = { status: 'published', hidden_by: null, reviewed_at: stamp, updated_at: stamp };
    }
    const up = await supabase.update('gallery_masterpieces', `id=eq.${encodeURIComponent(m.id)}`, patch);
    if (!Array.isArray(up)) return _json(res, 500, { error: 'save failed' });
    flush();
    return _json(res, 200, { ok: true, status: patch.status });
  }

  // Hidden layouts and how many distinct reporters each has, for the officer's review queue.
  async function officerReview(req, res) {
    const rows = await supabase.select('gallery_masterpieces',
      `select=${MEMBER_COLS},hidden_by&guild_id=eq.${encodeURIComponent(supabase.guildId())}&status=eq.hidden&order=updated_at.desc&limit=100`);
    if (!Array.isArray(rows)) return _json(res, 503, { error: 'gallery unavailable' }, { 'Retry-After': '30' });
    const items = [];
    for (const r of rows) {
      const reps = await supabase.select('gallery_reports', `select=reason&masterpiece_id=eq.${encodeURIComponent(r.id)}&limit=50`);
      const reasons = {};
      for (const x of Array.isArray(reps) ? reps : []) reasons[x.reason] = (reasons[x.reason] || 0) + 1;
      items.push(Object.assign(publicShape(r), { visibility: r.visibility, status: r.status, hidden_by: r.hidden_by, reports: reasons }));
    }
    return _json(res, 200, { items });
  }

  // ── dispatch ───────────────────────────────────────────────────────────────
  const ROUTE_RE = /^\/api\/(public|agent)\/gallery(?:\/([0-9a-fA-F-]{36}|review))?(?:\/(adopt|report|versions|visibility|status|feature|hide))?\/?$/;

  // Returns true when the request was a gallery route (and has been answered), false to let routing continue.
  async function handle(req, res) {
    const path = String(req.url || '').split(/[?#]/)[0];
    const m = ROUTE_RE.exec(path);
    if (!m) return false;
    const scope = m[1];
    const seg = m[2] || null;
    const action = m[3] || null;
    const id = seg && seg !== 'review' ? seg.toLowerCase() : null;
    if (seg && seg !== 'review' && !UUID_RE.test(seg)) { _json(res, 404, { error: 'not found' }); return true; }
    const method = req.method;

    if (scope === 'public') {
      if (method === 'GET' && !seg && !action) { await publicList(req, res); return true; }
      if (method === 'GET' && id && !action) { await publicDetail(req, res, id); return true; }
      if (method === 'POST' && id && action === 'adopt') { await publicAdopt(req, res, id); return true; }
      if (method === 'POST' && id && action === 'report') { await publicReport(req, res, id); return true; }
      _json(res, 404, { error: 'not found' });
      return true;
    }

    const identity = await requireAuth(req, res);
    if (!identity) return true;     // requireAuth already answered 401/429/503
    const officerOnly = () => {
      if (identity.is_officer) return false;
      _json(res, 403, { error: 'officers only' });
      return true;
    };

    if (method === 'GET' && !seg && !action) { await memberList(req, res, identity); return true; }
    if (method === 'GET' && seg === 'review' && !action) { if (!officerOnly()) await officerReview(req, res); return true; }
    if (method === 'GET' && id && !action) { await memberDetail(req, res, identity, id); return true; }
    if (method === 'POST' && !seg && !action) { await memberPublish(req, res, identity); return true; }
    if (id) {
      if (method === 'DELETE' && !action) { await memberDelete(req, res, identity, id); return true; }
      if (method === 'POST') {
        if (action === 'versions') { await memberNewVersion(req, res, identity, id); return true; }
        if (action === 'visibility') { await memberSetVisibility(req, res, identity, id); return true; }
        if (action === 'status') { await memberSetStatus(req, res, identity, id); return true; }
        if (action === 'adopt') { await memberAdopt(req, res, identity, id); return true; }
        if (action === 'report') { await memberReport(req, res, identity, id); return true; }
        if (action === 'feature') { if (!officerOnly()) await officerFeature(req, res, identity, id); return true; }
        if (action === 'hide') { if (!officerOnly()) await officerHide(req, res, identity, id); return true; }
      }
    }
    _json(res, 404, { error: 'not found' });
    return true;
  }

  return { handle, flush, REPORT_HIDE_THRESHOLD };
}

module.exports = { createGallery, publicShape, PUBLIC_COLS, MEMBER_COLS, BADGE, REPORT_HIDE_THRESHOLD };
