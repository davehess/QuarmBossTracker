// utils/opendkp.js — OpenDKP API client.
// Reads use a static clientid header. Writes authenticate via AWS Cognito USER_PASSWORD_AUTH
// and cache the ID token (1-hour expiry, refreshed automatically).
//
// Required env vars:
//   OPENDKP_CLIENT_ID        — base64 clientid for read requests (from OpenDKP site JS)
//   OPENDKP_RAIDS_URL        — API Gateway base URL for the raids resource
//                              e.g. https://XXXXXXXX.execute-api.us-east-2.amazonaws.com
//   OPENDKP_COGNITO_CLIENT_ID — Cognito App Client ID (from OpenDKP site JS, looks like: abc123xyz)
//   OPENDKP_USERNAME         — officer/admin OpenDKP login username (e.g. 'RaidBosses')
//                              (legacy: OPENDKP_EMAIL still accepted but value must be a username)
//   OPENDKP_PASSWORD         — officer/admin account password
//   OPENDKP_POOL_ID          — DKP pool ID (default 5 = SoL)
//   OPENDKP_API_URL          — base URL for the OpenDKP REST API (default: https://api.opendkp.com)
//   OPENDKP_CLIENT_NAME      — client/guild slug in OpenDKP (default: wolfpack)

const https = require('https');

function _post(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${JSON.stringify(parsed)}`));
        else resolve(parsed);
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function _get(options) {
  return new Promise((resolve, reject) => {
    https.get(options, (res) => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${JSON.stringify(parsed)}`));
        else resolve(parsed);
      });
    }).on('error', reject);
  });
}

// ── Cognito auth (cached) ─────────────────────────────────────────────────────
let _token = null, _tokenExpiry = 0;

async function getAuthToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;

  // OpenDKP's Cognito user pool authenticates against the USERNAME field, not
  // the email address.  OPENDKP_USERNAME is the preferred env var; we still
  // accept the older OPENDKP_EMAIL name as a fallback so existing deployments
  // don't break, but emails won't authenticate — the value must be the actual
  // OpenDKP login username (e.g. 'RaidBosses') regardless of which var name.
  const cognitoClientId = process.env.OPENDKP_COGNITO_CLIENT_ID;
  const username        = process.env.OPENDKP_USERNAME || process.env.OPENDKP_EMAIL;
  const password        = process.env.OPENDKP_PASSWORD;

  if (!cognitoClientId || !username || !password) {
    throw new Error('OPENDKP_COGNITO_CLIENT_ID, OPENDKP_USERNAME, OPENDKP_PASSWORD must be set');
  }

  const body = JSON.stringify({
    AuthFlow: 'USER_PASSWORD_AUTH',
    AuthParameters: { USERNAME: username, PASSWORD: password },
    ClientId: cognitoClientId,
  });

  const res = await _post({
    hostname: 'cognito-idp.us-east-2.amazonaws.com',
    path: '/',
    method: 'POST',
    headers: {
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
      'Content-Type': 'application/x-amz-json-1.1',
      'Content-Length': Buffer.byteLength(body),
    },
  }, body);

  _token       = res.AuthenticationResult.IdToken;
  _tokenExpiry = Date.now() + (res.AuthenticationResult.ExpiresIn - 120) * 1000;
  return _token;
}

// ── Read helpers ──────────────────────────────────────────────────────────────
function _raidsUrl(path = '') {
  const base = process.env.OPENDKP_RAIDS_URL;
  if (!base) throw new Error('OPENDKP_RAIDS_URL not set');
  const u = new URL(`${base}/beta/raids${path}`);
  return { hostname: u.hostname, path: u.pathname + u.search };
}

function _readHeaders() {
  const clientId = process.env.OPENDKP_CLIENT_ID;
  if (!clientId) throw new Error('OPENDKP_CLIENT_ID not set');
  return { clientid: clientId };
}

async function _writeHeaders() {
  const clientId = process.env.OPENDKP_CLIENT_ID;
  if (!clientId) throw new Error('OPENDKP_CLIENT_ID not set');
  const token = await getAuthToken();
  return { clientid: clientId, CognitoInfo: token, 'Content-Type': 'application/json' };
}

// ── Client REST API helpers ───────────────────────────────────────────────────
// New endpoints at api.opendkp.com/clients/{name}/ use Authorization: Bearer token.
// Character endpoints currently work with the legacy CognitoInfo header (_writeHeaders).
// Auction/bidding endpoints require proper Bearer auth (_bearerHeaders).

function _clientUrl(path = '') {
  const base = process.env.OPENDKP_API_URL || 'https://api.opendkp.com';
  const name = process.env.OPENDKP_CLIENT_NAME || 'wolfpack';
  const u = new URL(`${base}/clients/${name}${path}`);
  return { hostname: u.hostname, path: u.pathname + u.search };
}

// Bearer-auth headers for auction and bidding endpoints.
// Same Cognito ID token as CognitoInfo, different header name.
async function _bearerHeaders(contentType = false) {
  const token = await getAuthToken();
  const h = { 'Authorization': `Bearer ${token}` };
  if (contentType) h['Content-Type'] = 'application/json';
  return h;
}

// GET /clients/{name}/characters[?IncludeInactives=true] — full roster.
// Defaults to including inactives so callers see the complete picture (alts
// retired off the raid team, ex-members who left, etc). Pass { activeOnly:
// true } to restrict to current actives.
//
// Uses Bearer auth (same as auction endpoints) — OPENDKP_CLIENT_ID not needed.
async function getCharacters(opts = {}) {
  const headers = await _bearerHeaders();
  const path    = opts.activeOnly ? '/characters' : '/characters?IncludeInactives=true';
  return _get({ ..._clientUrl(path), headers });
}

// PUT /clients/{name}/characters — create a new character
// payload: { Name, Class, Race, Level, Active, Rank, ParentId }
// Returns object with CharacterId on success.
// Uses Bearer auth (same as auction endpoints) — OPENDKP_CLIENT_ID not needed.
async function createCharacter(payload) {
  const headers = await _bearerHeaders(true);
  const body    = JSON.stringify(payload);
  return _post({
    ..._clientUrl('/characters'),
    method: 'PUT',
    headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
  }, body);
}

// ── Auction API ───────────────────────────────────────────────────────────────
// PUT /clients/{name}/auctions — start one or more auctions.
//
// Captured 2026-05-26 from TWO UI paths (auth token redacted):
//   1. "Start Queued Auctions" button (Bidding Tool queue → start all)
//   2. "Manual Start" button (direct start-auction-now action)
// Both produce IDENTICAL network calls — there's just one create endpoint:
//   PUT /clients/wolfpack/auctions
//   Authorization: Bearer <Cognito ID token>
//   Body (ARRAY — multiple auctions can be started in one call):
//     [{
//       "BidType":       "Open",
//       "ItemQuantity":  1,
//       "Duration":      3,
//       "Bids":          [],
//       "Item":          {"Name": "Backpack", "GameItemId": 17005},
//       "AllowDeletes":  true,
//       "Auctioneer":    "",
//       "AutoAdjustBids": 0,
//       "MaximumBid":    100000,
//       "MinimumBid":    1,
//       "ItemId":        17005
//     }]
//
// Server fills in on response: AuctionId, ClientId, State, CreatedTimestamp /
// EndTimestamp / UpdatedTimestamp, RaidId / RaidName (linked from active raid),
// Notes, ItemTransactionIds. Auctioneer is filled from auth.
//
// IMPORTANT: there is NO RaidId field in the request body. The server auto-links
// the new auction to whatever raid is currently active under this client. So
// before calling createAuctions(), make sure a raid exists (via createRaid).
//
// CRITICAL: ItemId and Item.GameItemId MUST be real EQ item IDs from the OpenDKP
// catalog. An earlier test with a fake ItemId (31337) returned HTTP 500. Use the
// item-autocomplete the Bidding Tool uses to discover valid IDs.
//
// payload: ARRAY of auction items, each:
//   { BidType, ItemQuantity, Duration, Bids, Item, AllowDeletes,
//     Auctioneer, AutoAdjustBids, MaximumBid, MinimumBid, ItemId }
async function createAuctions(auctions) {
  if (!Array.isArray(auctions) || auctions.length === 0) {
    throw new Error('createAuctions: pass a non-empty array of auction objects');
  }
  const headers = await _bearerHeaders(true);
  const body    = JSON.stringify(auctions);
  return _post({
    ..._clientUrl('/auctions'),
    method: 'PUT',
    headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
  }, body);
}

// GET /clients/{name}/auctions[?page=N] — list active + closed auctions
// Captured cURL (2026-05-28): https://api.opendkp.com/clients/wolfpack/auctions?page=1
// Same endpoint the OpenDKP web UI uses; Bearer auth works (the web UI uses
// IAM Sig V4 because it's a Cognito Identity Pool, but API Gateway accepts
// the User Pool ID token on this route too — same pattern as /characters).
//
// Pagination: ?page=1 returns the first page. Walk pages until the returned
// list is empty or shorter than the previous page. Pre-settled active
// auctions carry Bids[] which is the only source for runner-up bid data —
// settling an auction discards everything but the winner.
async function getAuctions(page = 1) {
  const headers = await _bearerHeaders();
  const p = page > 1 ? `?page=${page}` : '';
  return _get({ ..._clientUrl('/auctions' + p), headers });
}

// PUT /clients/{name}/auctions/{auctionId}/bids — submit a bid on an active auction.
// Captured cURL (2026-05-26, auth token redacted):
//   PUT /clients/wolfpack/auctions/993920/bids
//   Authorization: Bearer <Cognito ID token>
//   Body: {"CharacterId":108064,"SessionId":993920,"Rank":"Officer","Priority":1,"Value":1}
//
// SessionId in the body equals the {auctionId} segment in the URL — both required.
// Rank: bidder's guild rank (Officer / Member / Recruit / Raid Alt / etc.).
// Priority: tier multiplier (1 = standard).  Value: DKP amount.
async function submitBid(auctionId, payload) {
  if (!auctionId) throw new Error('submitBid: auctionId is required');
  const headers = await _bearerHeaders(true);
  const body    = JSON.stringify(payload);
  return _post({
    ..._clientUrl(`/auctions/${auctionId}/bids`),
    method: 'PUT',
    headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
  }, body);
}

// DELETE /clients/{name}/auctions/{auctionId}/bids/{bidId} — cancel a placed bid.
// Unusual: DELETE carries a JSON body with the full bid object (matches captured cURL).
// Pass the bid object as returned from getAuctions(); the server keys off BidId.
async function cancelBid(auctionId, bidId, bidObject) {
  if (!auctionId || !bidId) throw new Error('cancelBid: auctionId and bidId are required');
  const headers = await _bearerHeaders(true);
  const body    = JSON.stringify(bidObject);
  return _post({
    ..._clientUrl(`/auctions/${auctionId}/bids/${bidId}`),
    method: 'DELETE',
    headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
  }, body);
}

// POST /clients/{name}/auctions/extendauctions — extend the timer on one or more auctions.
// Body is an ARRAY of full auction objects (pass through what getAuctions() returned).
// Server keys off AuctionId; other fields (Duration, MaximumBid, etc.) describe the
// post-extend state.
async function extendAuctions(auctions) {
  if (!Array.isArray(auctions) || auctions.length === 0) {
    throw new Error('extendAuctions: pass a non-empty array of auction objects');
  }
  const headers = await _bearerHeaders(true);
  const body    = JSON.stringify(auctions);
  return _post({
    ..._clientUrl('/auctions/extendauctions'),
    method: 'POST',
    headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
  }, body);
}

// POST /clients/{name}/auctions/endauctions — close out one or more auctions.
// Same shape as extendAuctions: array of full auction objects.  Server records the
// winning bid(s), deducts DKP, and marks the auction closed.
async function endAuctions(auctions) {
  if (!Array.isArray(auctions) || auctions.length === 0) {
    throw new Error('endAuctions: pass a non-empty array of auction objects');
  }
  const headers = await _bearerHeaders(true);
  const body    = JSON.stringify(auctions);
  return _post({
    ..._clientUrl('/auctions/endauctions'),
    method: 'POST',
    headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
  }, body);
}

// POST /clients/{name}/auctions — restore (re-open) a previously-ended auction.
// Captured cURL (2026-05-26): POST with body = single auction object (NOT array),
// State=1 (reopened), Bids=[] (cleared). Lets officers undo an end-auction click.
//
// Note the API verb overloading on this base path:
//   PUT  /auctions  with array  = create
//   POST /auctions  with object = restore one
//
// Pass the full auction object (typically what getAuctions() returned, then
// set Bids=[] and State=1 before sending).
async function restoreAuction(auctionObject) {
  if (!auctionObject || !auctionObject.AuctionId) {
    throw new Error('restoreAuction: auctionObject with AuctionId is required');
  }
  const headers = await _bearerHeaders(true);
  const body    = JSON.stringify(auctionObject);
  return _post({
    ..._clientUrl('/auctions'),
    method: 'POST',
    headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
  }, body);
}

// DELETE /clients/{name}/auctions/{auctionId} — permanently remove an auction.
// No request body. Typically used to clean up an ended auction after winners
// have been settled, or to discard a mistakenly-created auction.
async function deleteAuction(auctionId) {
  if (!auctionId) throw new Error('deleteAuction: auctionId is required');
  const headers = await _bearerHeaders(); // no Content-Type since no body
  return _post({
    ..._clientUrl(`/auctions/${auctionId}`),
    method: 'DELETE',
    headers,
  });
}

// ── Raids API ─────────────────────────────────────────────────────────────────
// Captured cURL (2026-05-28) confirms /clients/{name}/raids/:id works with
// the same Bearer auth as /characters and /auctions. Switching reads off the
// legacy /beta/raids path means we no longer need OPENDKP_CLIENT_ID for
// the sync — bearer covers everything. updateRaidById was already on the
// bearer path; getRaids/getRaid now match.
//
// GET /clients/{name}/raids — all raids (summary, no ticks detail)
async function getRaids() {
  const headers = await _bearerHeaders();
  return _get({ ..._clientUrl('/raids'), headers });
}

// GET /clients/{name}/raids/:id — single raid with full Ticks + Items
async function getRaid(raidId) {
  const headers = await _bearerHeaders();
  return _get({ ..._clientUrl(`/raids/${raidId}`), headers });
}

// Convenience: fetch all raids, return the most recent by Timestamp.
// Useful for /loot to confirm there's an open raid before creating auctions
// (the auction endpoint auto-links to the active raid server-side; this lets
// the bot show "Linking to raid: <name> #<id>" in the embed AND refuse to
// post if there's no raid at all).
//
// Returns null when the API returns no raids.
async function getMostRecentRaid() {
  const raids = await getRaids();
  if (!Array.isArray(raids) || raids.length === 0) return null;
  return [...raids].sort((a, b) =>
    new Date(b.Timestamp || 0) - new Date(a.Timestamp || 0)
  )[0];
}

// PUT /beta/raids — create new raid
async function createRaid(payload) {
  const headers = await _writeHeaders();
  const body    = JSON.stringify(payload);
  return _post({
    ..._raidsUrl(),
    method: 'PUT',
    headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
  }, body);
}

// POST /beta/raids — update existing raid (add/edit ticks)
async function updateRaid(payload) {
  const headers = await _writeHeaders();
  const body    = JSON.stringify(payload);
  return _post({
    ..._raidsUrl(),
    method: 'POST',
    headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
  }, body);
}

// POST /clients/{name}/raids/{raidId} — save the full raid record.
// Captured cURL (2026-05-26): used by the "Edit Raid" UI to save items, ticks,
// attendance, and metadata in one shot. This is the path for awarding loot
// manually (charge a character DKP for an item awarded outside the auction
// flow — common when bids happened in-game on /ooc and an officer needs to
// record the transaction).
//
// Full body shape:
//   {
//     "RaidId":     96336,
//     "ClientId":   "8fa8662b40c12",
//     "Name":       "Test Raid",
//     "Timestamp":  "2026-05-26T12:00:00.000Z",
//     "Attendance": 1,
//     "Version":    3,
//     "Pool":       {"PoolId":5, "Description":"Shadows of Luclin", "Name":"SoL", "Order":3},
//     "Items":      [{
//       "ItemId":         17005,
//       "ItemName":       "Backpack",
//       "CharacterName":  "Hitya",       (NB: name not id — server resolves)
//       "Dkp":            1,
//       "Notes":          "free-form",
//       "GameItemId":     17005
//     }],
//     "Ticks":      [{
//       "TickId":      575429,
//       "Value":       5,
//       "Description": "Tick 1 (Raid Start)",
//       "Characters":  [<characterId>, ...]   (empty = no attendance change)
//     }]
//   }
//
// Distinct from updateRaid() which posts to the legacy /beta/raids endpoint;
// both backends accept full-raid payloads but the /clients/ path is the one
// the new Bidding Tool UI uses and is preferred for new code.
async function updateRaidById(raidId, raidObject) {
  if (!raidId) throw new Error('updateRaidById: raidId is required');
  const headers = await _bearerHeaders(true);
  const body    = JSON.stringify(raidObject);
  return _post({
    ..._clientUrl(`/raids/${raidId}`),
    method: 'POST',
    headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
  }, body);
}

module.exports = {
  getRaids, getRaid, createRaid, updateRaid, updateRaidById, getMostRecentRaid,
  getCharacters, createCharacter,
  createAuctions, getAuctions, restoreAuction, deleteAuction,
  submitBid, cancelBid, extendAuctions, endAuctions,
};
