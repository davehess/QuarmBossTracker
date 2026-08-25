// test/opendkp-halt.test.js — the OpenDKP halt switch actually halts.
//
// 2026-08-25: OpenDKP's owner reported API Gateway costs past $200/month and
// asked anyone running automation to make contact. Wolf Pack runs the heaviest
// automation we know of against that API, so we stopped first and measured
// second (Hitya: "can you halt all traffic to opendkp").
//
// This guards the property that matters: the halt sits at the two HTTP
// primitives every one of the ~25 endpoint wrappers funnels through, so no
// caller can bypass it. A halt gated at each call site, or at the loop
// schedulers, would be one forgotten wrapper away from still spending
// somebody else's money.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// Static import is correct here: opendkpHalted() reads process.env at CALL
// time, not at module load, so one instance serves every case.
import * as api from '../utils/opendkp.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'utils/opendkp.js'), 'utf8');

const ORIGINAL = process.env.OPENDKP_HALT;
beforeEach(() => { delete process.env.OPENDKP_HALT; });
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.OPENDKP_HALT;
  else process.env.OPENDKP_HALT = ORIGINAL;
});

describe('the halt switch', () => {
  it('is OFF by default — an absent env var must never block a raid night', () => {
    const { opendkpHalted } = api;
    expect(opendkpHalted()).toBe(false);
  });

  it('accepts the spellings an operator would actually type', () => {
    const { opendkpHalted } = api;
    for (const v of ['1', 'true', 'TRUE', 'yes', ' 1 ']) {
      process.env.OPENDKP_HALT = v;
      expect(opendkpHalted(), `value ${JSON.stringify(v)}`).toBe(true);
    }
  });

  it('treats 0 / empty / anything else as NOT halted', () => {
    const { opendkpHalted } = api;
    for (const v of ['0', '', 'false', 'no', 'off']) {
      process.env.OPENDKP_HALT = v;
      expect(opendkpHalted(), `value ${JSON.stringify(v)}`).toBe(false);
    }
  });

  it('blocks reads AND writes, and every endpoint funnels through those two', async () => {
    // Dummy creds so the wrappers get PAST their own credential checks and
    // actually reach the HTTP primitives — otherwise this passes for the
    // wrong reason (a missing-env error, not the halt) and would keep passing
    // if the halt were deleted.
    const CREDS = {
      OPENDKP_CLIENT_ID: 'dGVzdA==', OPENDKP_RAIDS_URL: 'https://example.invalid',
      OPENDKP_COGNITO_CLIENT_ID: 'test', OPENDKP_USERNAME: 'test',
      OPENDKP_PASSWORD: 'test', OPENDKP_API_URL: 'https://example.invalid',
    };
    const saved = {};
    for (const [k, v] of Object.entries(CREDS)) { saved[k] = process.env[k]; process.env[k] = v; }
    process.env.OPENDKP_HALT = '1';
    try {
      // A read wrapper and a write wrapper, taking different auth paths.
      await expect(api.getAuctions(1)).rejects.toThrow(/halted/i);
      await expect(api.createCharacter({ Name: 'Nobody' })).rejects.toThrow(/halted/i);
    } finally {
      for (const k of Object.keys(CREDS)) {
        if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
      }
    }
  });
});

describe('where the halt lives (so it cannot be bypassed)', () => {
  it('gates the two HTTP primitives, not individual endpoints', () => {
    // If someone moves the guard to call sites, this fails — which is the
    // point. _get and _post are the only functions that open a socket.
    const get  = SRC.slice(SRC.indexOf('function _get('),  SRC.indexOf('function _get(')  + 200);
    const post = SRC.slice(SRC.indexOf('function _post('), SRC.indexOf('function _post(') + 200);
    expect(get).toMatch(/opendkpHalted\(\)/);
    expect(post).toMatch(/opendkpHalted\(\)/);
  });

  it('rate-limits its own logging — a halted 20s queue must not flood the log', () => {
    expect(SRC).toMatch(/_lastHaltLog/);
    expect(SRC).toMatch(/60_000/);
  });

  it('names the way back in the error text', () => {
    expect(SRC).toMatch(/OPENDKP_HALT=0/);
  });
});
