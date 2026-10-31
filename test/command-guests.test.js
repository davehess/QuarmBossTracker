// test/command-guests.test.js — the Command Center's officer-only Guests card: the agent reads the bot's guest list and
// forwards +1h / +3h, and command.html draws the rows (the guild lead, 2026-10-30: "add guests to the command center for
// officers/admins with an extend button for +1/+3"). The bot half is test/guest-extend.test.js on main.
//
// The agent's REAL fetch / extend functions run against a throwaway local HTTP server standing in for the bot, and the
// card's REAL guestsHtml runs from command.html's own source. Source assertions run on comment-stripped text.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, AGENT_INDEX, ROOT } from './_source-slice.js';

const agentSrc = readSource(AGENT_INDEX);
const cmd = readSource(path.join(ROOT, 'apps', 'mimic', 'command.html'));
const SID = '7b2f0c1e-0000-4000-8000-000000000001';
const H = 3600_000;

// ── the agent's block, evaluated for real ────────────────────────────────────
const agentBlock = sliceBlock(agentSrc, '// ── Guest links for officers (Command Center "Guests" card)', '\n// ── PoP raid objectives proxy (popraid.html)');
function loadAgent(logs) {
  const fakeConsole = { log: (m) => logs.push(String(m)) };
  // eslint-disable-next-line no-new-func
  return new Function('http', 'https', 'console', 'AGENT_VERSION',
    'let _uploadOpts = null; let _mimicIdentity = null;\n' + agentBlock + '\n'
    + 'return { fetchGuestLinks, _guestLinksSnapshot, extendGuestLink, state: () => _guestLinks,'
    + ' setOpts: (o) => { _uploadOpts = o; }, setIdentity: (i) => { _mimicIdentity = i; } };')(http, https, fakeConsole, 't');
}

let server, port, hits, listAnswer, extendAnswer, logs, agent;
beforeEach(async () => {
  hits = []; logs = [];
  listAnswer = { status: 200, body: { ok: true, guests: [{ id: SID, label: 'Brackwyn of Another Guild', expires_at: new Date(Date.now() + H).toISOString(), revoked: false, fights: 2 }] } };
  extendAnswer = { status: 200, body: { ok: true, guest: { id: SID, expires_at: new Date(Date.now() + 4 * H).toISOString() } } };
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      hits.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
      const a = req.url === '/api/agent/guest-links/extend' ? extendAnswer : listAnswer;
      res.writeHead(a.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(a.body));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  agent = loadAgent(logs);
  agent.setOpts({ botUrl: `http://127.0.0.1:${port}/api/agent/encounter`, token: 'wpms_x' });
});
afterEach(async () => { await new Promise(r => server.close(r)); vi.restoreAllMocks(); });
const settle = async () => { for (let i = 0; i < 40 && agent.state().inflight; i++) await new Promise(r => setTimeout(r, 10)); await new Promise(r => setTimeout(r, 10)); };

describe('agent: reading the guest list', () => {
  it('never calls the bot for anyone who is not an officer, and the card state stays null', async () => {
    agent.setIdentity({ is_officer: false });
    expect(agent._guestLinksSnapshot()).toBeNull();
    agent.setIdentity(null);
    expect(agent._guestLinksSnapshot()).toBeNull();
    await settle();
    expect(hits).toHaveLength(0);
  });
  it('an officer asks once with the bearer token, then serves the list, and rereads only after 30 s', async () => {
    agent.setIdentity({ is_officer: true });
    expect(agent._guestLinksSnapshot()).toBeNull();   // nothing known yet: the read is lazy and in flight
    await settle();
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ method: 'GET', url: '/api/agent/guest-links', auth: 'Bearer wpms_x' });
    expect(agent._guestLinksSnapshot()).toHaveLength(1);
    await settle();
    expect(hits).toHaveLength(1);   // inside the TTL: no second call
    agent.state().at = Date.now() - 31_000;
    agent._guestLinksSnapshot();
    await settle();
    expect(hits).toHaveLength(2);
  });
  it('a bot without the route (404) or a refusal (403) hides the card, logs once, and backs off 5 minutes', async () => {
    agent.setIdentity({ is_officer: true });
    listAnswer = { status: 404, body: { error: 'not found' } };
    agent._guestLinksSnapshot();
    await settle();
    expect(agent._guestLinksSnapshot()).toBeNull();
    expect(agent.state().retryAt).toBeGreaterThan(Date.now() + 4 * 60_000);
    agent.state().at = 0;
    agent._guestLinksSnapshot(); await settle();
    expect(hits).toHaveLength(1);   // backed off: no retry before the window
    agent.state().retryAt = 0;
    listAnswer = { status: 403, body: { error: 'officers only' } };
    agent._guestLinksSnapshot(); await settle();
    expect(hits).toHaveLength(2);
    expect(logs.filter(l => l.includes('[guest-links]'))).toHaveLength(1);
  });
  it('a passing failure keeps the last good list, so the card does not flicker off', async () => {
    agent.setIdentity({ is_officer: true });
    agent._guestLinksSnapshot(); await settle();
    expect(agent._guestLinksSnapshot()).toHaveLength(1);
    listAnswer = { status: 503, body: { error: 'unavailable' } };
    agent.state().at = 0;
    agent._guestLinksSnapshot(); await settle();
    expect(agent._guestLinksSnapshot()).toHaveLength(1);
  });
  it('does nothing without a bot connection', async () => {
    agent.setIdentity({ is_officer: true });
    agent.setOpts(null);
    expect(agent._guestLinksSnapshot()).toBeNull();
    expect(hits).toHaveLength(0);
  });
});

describe('agent: extending', () => {
  it('forwards id and hours to the bot with the bearer token and passes the answer through', async () => {
    const r = await agent.extendGuestLink(SID, 3);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(hits[0]).toMatchObject({ method: 'POST', url: '/api/agent/guest-links/extend', auth: 'Bearer wpms_x' });
    expect(JSON.parse(hits[0].body)).toEqual({ id: SID, hours: 3 });
  });
  it('puts the new expiry on the cached row at once and marks the list for a refetch', async () => {
    agent.setIdentity({ is_officer: true });
    agent._guestLinksSnapshot(); await settle();
    const before = agent._guestLinksSnapshot()[0].expires_at;
    await agent.extendGuestLink(SID, 3);
    expect(agent._guestLinksSnapshot()[0].expires_at).toBe(extendAnswer.body.guest.expires_at);
    expect(agent._guestLinksSnapshot()[0].expires_at).not.toBe(before);
    expect(agent.state().at).toBe(0);
  });
  it('passes a refusal (revoked, too old) through and leaves the cache alone', async () => {
    agent.setIdentity({ is_officer: true });
    agent._guestLinksSnapshot(); await settle();
    const before = JSON.stringify(agent._guestLinksSnapshot());
    extendAnswer = { status: 409, body: { error: 'revoked' } };
    const r = await agent.extendGuestLink(SID, 1);
    expect(r).toEqual({ status: 409, body: { error: 'revoked' } });
    expect(JSON.stringify(agent._guestLinksSnapshot())).toBe(before);
  });
  it('answers 503 when there is no bot connection', async () => {
    agent.setOpts(null);
    expect((await agent.extendGuestLink(SID, 1)).status).toBe(503);
  });
});

describe('agent wiring', () => {
  const src = stripJs(agentSrc);
  it('puts guests on the Command Center state for officers only', () => {
    expect(src).toMatch(/guests:\s+\(_mimicIdentity && _mimicIdentity\.is_officer\) \? _guestLinksSnapshot\(\) : null,/);
  });
  it('the local extend route is officer-gated, takes only 1 or 3 hours and a session id, and forwards', () => {
    const route = sliceBlock(src, "if (req.url === '/api/guest-extend' && req.method === 'POST') {", 'return res.end(JSON.stringify(gr.body));');
    expect(route).toContain("if (!(_mimicIdentity && _mimicIdentity.is_officer)) { res.writeHead(403");
    expect(route).toContain('ghours !== 1 && ghours !== 3');
    expect(route).toContain('[0-9a-f-]{36}');
    expect(route).toContain('await extendGuestLink(gid, ghours)');
  });
  it('the fetch gate is the officer flag, before any request', () => {
    const fn = sliceBlock(src, 'function fetchGuestLinks() {', 'const url = _guestLinksUrl');
    expect(fn).toContain('if (!(_mimicIdentity && _mimicIdentity.is_officer)) return;');
  });
});

// ── the card, from command.html's own source ─────────────────────────────────
describe('command.html: the Guests card', () => {
  const END = '\n  function guestExtend(id, hours){';
  const block = sliceBlock(cmd, '  var GUEST_REVIVE_MS = ', END).replace(END, '');
  const NOW = Date.UTC(2026, 9, 31, 1, 0, 0);
  function html(list, over = {}) {
    // eslint-disable-next-line no-new-func
    const f = new Function('esc', '_isCollapsed', 'secToggle', 'Date', block + '\nreturn { guestsHtml, _guestFlash, _guestPend };');
    const fakeDate = { now: () => NOW, parse: Date.parse };
    const env = f((s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]),
      () => !!over.collapsed, (key, label, count) => `<span class="sec-toggle" data-collapse-key="${key}">${label}${count != null ? ` (${count})` : ''}</span>`, fakeDate);
    if (over.pend) env._guestPend[over.pend] = true;
    if (over.flash) env._guestFlash[over.flash.id] = { txt: over.flash.txt, bad: !!over.flash.bad, until: NOW + 4000 };
    return env.guestsHtml(list);
  }
  const g = (over) => ({ id: SID, label: 'Brackwyn of Another Guild', approved_by: 'Approver Ann', expires_at: new Date(NOW + 42 * 60_000).toISOString(), revoked: false, fights: 3, ...over });

  it('a running guest reads "expires in 42m", the fight count, and two press targets with the hover handshake', () => {
    const out = html([g()]);
    expect(out).toContain('Brackwyn of Another Guild');
    expect(out).toContain('expires in 42m');
    expect(out).toContain('3 fights');
    expect(out).toContain('data-guest-h="1"');
    expect(out).toContain('data-guest-h="3"');
    expect(out.match(/class="guestExt" data-wp-interact/g)).toHaveLength(2);
    expect(out).toContain('+1h');
    expect(out).toContain('+3h');
  });
  it('a lapsed guest reads "expired 5m ago" and can still be extended; one fight is singular', () => {
    const out = html([g({ expires_at: new Date(NOW - 5 * 60_000).toISOString(), fights: 1 })]);
    expect(out).toContain('expired 5m ago');
    expect(out).toContain('gwhen out');
    expect(out).toContain('1 fight<');
    expect(out).toContain('guestExt');
  });
  it('colors the last ten minutes, and counts hours as 1h05m', () => {
    expect(html([g({ expires_at: new Date(NOW + 9 * 60_000).toISOString() })])).toContain('gwhen soon');
    expect(html([g({ expires_at: new Date(NOW + 65 * 60_000).toISOString() })])).toContain('expires in 1h05m');
  });
  it('leaves off a revoked guest and one that ended more than 12 hours ago, and is empty when none are left', () => {
    expect(html([g({ revoked: true })])).toBe('');
    expect(html([g({ expires_at: new Date(NOW - 13 * H).toISOString() })])).toBe('');
    const out = html([g({ revoked: true }), g({ id: 'b', label: 'Other', expires_at: new Date(NOW - 11 * H).toISOString() })]);
    expect(out).toContain('Other');
    expect(out).not.toContain('Brackwyn');
  });
  it('escapes a label, shows the pending dots and the answer in place of the buttons, and folds away', () => {
    expect(html([g({ label: '<b>x</b>' })])).toContain('&lt;b&gt;x&lt;/b&gt;');
    const pend = html([g()], { pend: SID });
    expect(pend).toContain('gflash">…');
    expect(pend).not.toContain('guestExt');
    const flash = html([g()], { flash: { id: SID, txt: '+3h ✓' } });
    expect(flash).toContain('+3h ✓');
    expect(flash).not.toContain('guestExt');
    const folded = html([g()], { collapsed: true });
    expect(folded).toContain('Guests (1)');
    expect(folded).not.toContain('guest-row');
  });
  it('is drawn only when the state has guests, and the press calls the local agent route', () => {
    const src = stripJs(cmd);
    expect(src).toMatch(/if \(s\.guests && s\.guests\.length\) html \+= guestsHtml\(s\.guests\);/);
    expect(src).toContain("fetch('http://127.0.0.1:' + PORT + '/api/guest-extend'");
    expect(src).toMatch(/closest\('\.guestExt'\)[\s\S]{0,200}guestExtend\(ext\.getAttribute\('data-guest-id'\), Number\(ext\.getAttribute\('data-guest-h'\)\)\)/);
    expect(src).toMatch(/mousedown/);
  });
  it('keeps command.html free of the characters the verbatim embed bans', () => {
    expect(cmd.includes('`')).toBe(false);
    expect(cmd.includes('${')).toBe(false);
    expect(cmd.includes('\\')).toBe(false);
  });
});
