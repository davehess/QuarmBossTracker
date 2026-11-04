'use strict';
// Windows 7 build only (the guild lead, 2026-11-04: "try a release on Electron 23 and Node 14 for him as a beta release
// for Windows 7 specifically. He needs the charm stuff"). Electron 22 is the last Electron that starts on Windows 7, and
// the agent runs under Electron's own Node (ELECTRON_RUN_AS_NODE), which there is 16.17. Node 16 lacks the two newer
// things the agent leans on: the global fetch (18) and AbortSignal.timeout (17.3). main.js loads this file with
// --require ahead of the agent ONLY when its Node is older than 18, and every branch below is skipped on a Node that
// already has the feature, so it is inert anywhere else.
//
// The fetch here covers what the agent reads off a response (ok, status, statusText, headers.get, json, text,
// arrayBuffer) and nothing more: no streaming body, no gzip (it never asks for it), no cookies, no CORS. It reads the
// whole body before resolving, which is all the agent's own-API calls need.
// ponytail: a hand-rolled subset; if a future agent needs response streaming or FormData on Windows 7, add it here.

const http = require('http');
const https = require('https');

function abortError(reason) {
  const e = new Error(reason === 'timeout' ? 'The operation was aborted due to timeout' : 'This operation was aborted');
  e.name = reason === 'timeout' ? 'TimeoutError' : 'AbortError';
  e.code = 'ABORT_ERR';
  return e;
}

if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout !== 'function') {
  AbortSignal.timeout = function timeout(ms) {
    const c = new AbortController();
    const t = setTimeout(() => { c.signal.__wpTimedOut = true; c.abort(); }, Number(ms) || 0);
    if (t.unref) t.unref();
    return c.signal;
  };
}

function headerObject(h) {
  const out = {};
  if (!h) return out;
  if (typeof h.forEach === 'function' && !Array.isArray(h) && typeof h.get === 'function') h.forEach((v, k) => { out[k] = v; });
  else for (const [k, v] of Array.isArray(h) ? h : Object.entries(h)) if (v != null) out[k] = String(v);
  return out;
}

function makeResponse(res, buf, href, redirected) {
  const hdr = res.headers || {};
  const one = k => { const v = hdr[String(k).toLowerCase()]; return v == null ? null : Array.isArray(v) ? v.join(', ') : String(v); };
  let used = false;
  const take = () => { if (used) throw new TypeError('Body has already been consumed.'); used = true; return buf; };
  return {
    ok: res.statusCode >= 200 && res.statusCode < 300,
    status: res.statusCode,
    statusText: res.statusMessage || '',
    url: href,
    redirected,
    headers: {
      get: one,
      has: k => one(k) != null,
      forEach(fn) { for (const k of Object.keys(hdr)) fn(one(k), k); },
    },
    get bodyUsed() { return used; },
    text: async () => take().toString('utf8'),
    json: async () => JSON.parse(take().toString('utf8')),
    arrayBuffer: async () => { const b = take(); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); },
  };
}

function shimFetch(input, init, hops, redirected) {
  init = init || {};
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(String(input && typeof input === 'object' && input.url ? input.url : input)); }
    catch (_) { reject(new TypeError('Failed to parse URL from ' + String(input))); return; }
    const lib = url.protocol === 'https:' ? https : url.protocol === 'http:' ? http : null;
    if (!lib) { reject(new TypeError('fetch failed: unsupported protocol ' + url.protocol)); return; }
    const method = String(init.method || 'GET').toUpperCase();
    const headers = headerObject(init.headers);
    let body = init.body;
    if (body != null && typeof body !== 'string' && !Buffer.isBuffer(body)) body = body instanceof Uint8Array ? Buffer.from(body) : String(body);
    if (body != null && !Object.keys(headers).some(k => k.toLowerCase() === 'content-length')) headers['Content-Length'] = String(Buffer.byteLength(body));
    const signal = init.signal;
    if (signal && signal.aborted) { reject(abortError(signal.__wpTimedOut ? 'timeout' : '')); return; }
    let done = false;
    const finish = (fn, v) => { if (done) return; done = true; if (signal) signal.removeEventListener('abort', onAbort); fn(v); };
    const req = lib.request(url, { method, headers }, res => {
      const loc = res.headers.location;
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && loc && init.redirect !== 'manual') {
        res.resume();
        if (hops >= 20) { finish(reject, new TypeError('fetch failed: too many redirects')); return; }
        const toGet = res.statusCode === 303 || ((res.statusCode === 301 || res.statusCode === 302) && method === 'POST');
        const next = { ...init, method: toGet ? 'GET' : method, body: toGet ? undefined : init.body };
        finish(resolve, shimFetch(new URL(loc, url).href, next, hops + 1, true));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => finish(resolve, makeResponse(res, Buffer.concat(chunks), url.href, redirected)));
      res.on('error', e => finish(reject, e));
    });
    function onAbort() { const e = abortError(signal.__wpTimedOut ? 'timeout' : ''); req.destroy(e); finish(reject, e); }
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    req.on('error', e => finish(reject, done ? e : Object.assign(new TypeError('fetch failed'), { cause: e })));
    if (body != null) req.write(body);
    req.end();
  });
}

if (typeof globalThis.fetch !== 'function') {
  globalThis.fetch = function fetch(input, init) { return shimFetch(input, init, 0, false); };
}

module.exports = { shimFetch };
