// The public call counter behind wolfpack.quest/opendkp.
//
// Context: on 2026-08-25 our traffic cost OpenDKP's owner real money and got
// our IP blocked. He is unblocking us on our word, so the counter is the
// evidence replacing that word. Two properties therefore matter more than the
// feature working at all:
//
//   1. Endpoint names must match the shape HIS API Gateway logs group by, or
//      the page cannot be read across against his table and is just our numbers
//      in our format — which is what he already had reason to distrust.
//   2. The counter must not become the thing it measures. A row per call is
//      exactly the write amplification that caused the incident.
//
// Run: npx vitest run test/opendkp-call-stats.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as api from '../utils/opendkp.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'utils/opendkp.js'), 'utf8');

describe('endpoint normalization matches OpenDKP\'s own log shape', () => {
  const n = api._normalizeEndpoint;

  it('collapses the client slug, as his log group does', () => {
    expect(n('/clients/wolfpack/auctions')).toBe('/clients/{client}/auctions');
  });

  it('collapses numeric ids so one auction is not one endpoint', () => {
    // Otherwise every bid creates a new "endpoint" and the chart is useless.
    expect(n('/clients/wolfpack/auctions/993920/bids')).toBe('/clients/{client}/auctions/{id}/bids');
    expect(n('/clients/wolfpack/raids/412')).toBe('/clients/{client}/raids/{id}');
  });

  it('drops the query string — ?page=2 is the same endpoint', () => {
    expect(n('/clients/wolfpack/auctions?page=2')).toBe('/clients/{client}/auctions');
    expect(n('/clients/wolfpack/audits?page=15')).toBe('/clients/{client}/audits');
  });

  it('reproduces the exact rows from his 6-hour sample', () => {
    // Verbatim from the API Gateway table he shared, 2026-08-25.
    expect(n('/clients/wolfpack/dkp')).toBe('/clients/{client}/dkp');
    expect(n('/clients/wolfpack/characters')).toBe('/clients/{client}/characters');
  });

  it('never returns empty', () => {
    expect(n('')).toBe('/');
    expect(n(null)).toBe('/');
  });
});

describe('the counter does not become the problem', () => {
  it('aggregates in memory and upserts minute buckets, never a row per call', () => {
    expect(SRC).toContain("upsert('opendkp_call_stats'");
    expect(SRC).toMatch(/minute,endpoint,method/);
    // The tell that it is per-minute, not per-call.
    expect(SRC).toMatch(/Math\.floor\(Date\.now\(\) \/ 60000\) \* 60000/);
  });

  it('only flushes completed minutes, so a bucket is written once', () => {
    // Re-writing the in-flight minute every 60s is a smaller version of the
    // fetched_at bug that cost us 141M row updates.
    expect(SRC).toMatch(/force \|\| r\.minute < cutoff/);
  });

  it('fails open — a counter must never take the bot down', () => {
    const flush = SRC.slice(SRC.indexOf('async function flushCallStats'), SRC.indexOf('function _noteRateLimited'));
    expect(flush).toMatch(/catch\s*\{/);
    expect(flush).toContain('flushed: 0');
  });
});

describe('the two halts', () => {
  const ORIGINAL = process.env.OPENDKP_HALT;
  beforeEach(() => { delete process.env.OPENDKP_HALT; api.setRuntimeHalt(false); });
  afterEach(() => {
    api.setRuntimeHalt(false);
    if (ORIGINAL === undefined) delete process.env.OPENDKP_HALT;
    else process.env.OPENDKP_HALT = ORIGINAL;
  });

  it('the runtime flag halts without touching the env var', () => {
    // This is the one that works with no redeploy — the "shut it down quickly"
    // we promised in exchange for being unblocked. A Railway build is not quick.
    expect(api.opendkpHalted()).toBe(false);
    api.setRuntimeHalt(true);
    expect(api.opendkpHalted()).toBe(true);
  });

  it('either halt is sufficient, and clearing one does not resume', () => {
    process.env.OPENDKP_HALT = '1';
    api.setRuntimeHalt(true);
    api.setRuntimeHalt(false);
    expect(api.opendkpHalted()).toBe(true);      // env still holds it
    delete process.env.OPENDKP_HALT;
    expect(api.opendkpHalted()).toBe(false);
  });

  it('blocked calls are still counted — halted must not look like dead', () => {
    // If a halt zeroed the counters entirely, the public page could not
    // distinguish "the kill switch works" from "the bot fell over".
    // Asserted on the PROPERTY, not the exact argument list — an earlier
    // version pinned the literal and broke the moment `hostname` was threaded
    // through, which told us nothing about whether blocked calls are counted.
    expect(SRC).toMatch(/noteCall\(options\.path, _m, \{ blocked: true[^)]*\}\)/);
    expect(SRC).toMatch(/noteCall\(options\.path, 'GET', \{ blocked: true[^)]*\}\)/);
  });
});

// ── The 2026-08-26 unblock-day finding ──────────────────────────────────────
// The public page showed 1,486 "refused by us" against 4 real calls, which
// reads like we tried to hammer OpenDKP 1,486 times. We did not: every one was
// AWS Cognito, our own sign-in provider, which never touches his API. Two
// separate bugs produced it, and both are fixed here.
describe('Cognito is not OpenDKP traffic', () => {
  it('labels the auth host distinctly so the page cannot overstate our volume', () => {
    // Overstating is the ONE direction a page built to regain trust must never
    // be wrong in — it invites a re-block for traffic we never sent.
    const e = api._normalizeEndpoint('/', 'cognito-idp.us-east-2.amazonaws.com');
    expect(e).toMatch(/^cognito:/);
    expect(e).toMatch(/not OpenDKP/i);
  });

  it('still labels real OpenDKP paths normally', () => {
    expect(api._normalizeEndpoint('/clients/wolfpack/auctions', 'api.opendkp.com'))
      .toBe('/clients/{client}/auctions');
  });

  it('does not collapse an unknown host into the auth bucket', () => {
    expect(api._normalizeEndpoint('/clients/x/dkp', 'example.invalid'))
      .toBe('/clients/{client}/dkp');
  });
});

describe('auth failures back off instead of spinning', () => {
  it('a recent auth failure short-circuits the next attempt', () => {
    // Every endpoint wrapper calls getAuthToken FIRST, so a failing token turns
    // one retrying caller into an auth storm — and a LOCAL refusal fails without
    // touching the network, so it spins at CPU speed (~106/min measured).
    expect(SRC).toMatch(/_authFailUntil/);
    expect(SRC).toMatch(/backing off after a recent failure/);
  });

  it('keeps the happy path cached, not re-authenticating per call', () => {
    expect(SRC).toMatch(/if \(_token && Date\.now\(\) < _tokenExpiry\) return _token;/);
  });
});
