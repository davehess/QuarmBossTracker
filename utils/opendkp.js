// utils/opendkp.js — OpenDKP API client.
// Reads use a static clientid header. Writes authenticate via AWS Cognito USER_PASSWORD_AUTH
// and cache the ID token (1-hour expiry, refreshed automatically).
//
// Required env vars:
//   OPENDKP_CLIENT_ID        — base64 clientid for read requests (from OpenDKP site JS)
//   OPENDKP_RAIDS_URL        — API Gateway base URL for the raids resource
//                              e.g. https://XXXXXXXX.execute-api.us-east-2.amazonaws.com
//   OPENDKP_COGNITO_CLIENT_ID — Cognito App Client ID (from OpenDKP site JS, looks like: abc123xyz)
//   OPENDKP_EMAIL            — officer/admin account email
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

  const cognitoClientId = process.env.OPENDKP_COGNITO_CLIENT_ID;
  const email           = process.env.OPENDKP_EMAIL;
  const password        = process.env.OPENDKP_PASSWORD;

  if (!cognitoClientId || !email || !password) {
    throw new Error('OPENDKP_COGNITO_CLIENT_ID, OPENDKP_EMAIL, OPENDKP_PASSWORD must be set');
  }

  const body = JSON.stringify({
    AuthFlow: 'USER_PASSWORD_AUTH',
    AuthParameters: { USERNAME: email, PASSWORD: password },
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

// GET /clients/{name}/characters — all characters
async function getCharacters() {
  const headers = await _writeHeaders();
  return _get({ ..._clientUrl('/characters'), headers });
}

// PUT /clients/{name}/characters — create a new character
// payload: { Name, Class, Race, Level, Active, Rank, ParentId }
// Returns object with CharacterId on success.
async function createCharacter(payload) {
  const headers = await _writeHeaders();
  const body    = JSON.stringify(payload);
  return _post({
    ..._clientUrl('/characters'),
    method: 'PUT',
    headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
  }, body);
}

// ── Auction API ───────────────────────────────────────────────────────────────
// PUT /clients/{name}/auctions — create an auction for one or more items.
//
// ⚠️  PENDING API CAPTURE: payload format not yet confirmed (500 on test with fake ItemId).
//     Once a successful auction creation cURL is captured from the OpenDKP Bidding Tool,
//     update this function with the correct payload structure.
//
// Known required fields (from failed attempt + context):
//   ItemId, ItemName, GameItemId, ItemQuantity, RaidId, PoolId, ClientId
//
// payload: { items: [{ ItemId, ItemName, GameItemId, ItemQuantity }], raidId, poolId }
async function createAuctions(payload) {
  throw new Error(
    'createAuctions: pending API capture. ' +
    'Please submit a real bid in OpenDKP and capture the Network request, ' +
    'then share the cURL so this function can be implemented.'
  );
  // ── Uncomment and update when confirmed ──
  // const headers = await _bearerHeaders(true);
  // const body = JSON.stringify(payload);
  // return _post({
  //   ..._clientUrl('/auctions'),
  //   method: 'PUT',
  //   headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
  // }, body);
}

// GET /clients/{name}/auctions — list active auctions
// Returns array of auction objects with Bids.
// ⚠️  PENDING API CAPTURE: exact endpoint path not confirmed.
async function getAuctions() {
  const headers = await _bearerHeaders();
  return _get({ ..._clientUrl('/auctions'), headers });
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

// ── Raids API ─────────────────────────────────────────────────────────────────
// GET /beta/raids — all raids (no ticks detail)
async function getRaids() {
  return _get({ ..._raidsUrl(), headers: _readHeaders() });
}

// GET /beta/raids/:id — single raid with full ticks, attendees, and loot Items
async function getRaid(raidId) {
  return _get({ ..._raidsUrl(`/${raidId}`), headers: _readHeaders() });
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

module.exports = {
  getRaids, getRaid, createRaid, updateRaid,
  getCharacters, createCharacter,
  createAuctions, getAuctions,
  submitBid, cancelBid, extendAuctions, endAuctions,
};
