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

// GET /beta/raids — all raids (no ticks detail)
async function getRaids() {
  return _get({ ..._raidsUrl(), headers: _readHeaders() });
}

// GET /beta/raids/:id — single raid with full ticks and attendees
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

module.exports = { getRaids, getRaid, createRaid, updateRaid };
