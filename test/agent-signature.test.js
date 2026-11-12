// Agent hot-swap signature (readiness audit #6). The keypair below is generated PER RUN, in memory:
// it is a TEST key, not the guild's real signing key, and nothing here is a secret.
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';

const require = createRequire(import.meta.url);
const sig = require('../apps/mimic/agentSignature.js');

const mk = () => crypto.generateKeyPairSync('ed25519');
const pubB64 = (k) => k.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const sign = (data, k) => crypto.sign(null, data, k.privateKey).toString('base64');
const data = Buffer.from('console.log("agent");\n'.repeat(50));
const A = mk(), B = mk();
const good = 'https://raw.githubusercontent.com/davehess/raidmimic/beta/packages/wolfpack-logsync/index.js';

describe('verifyAgentSignature', () => {
  it('accepts a good signature and reports the key slot (rotation)', () => {
    expect(sig.verifyAgentSignature(data, sign(data, A), [pubB64(A)])).toMatchObject({ ok: true, keyIndex: 0 });
    expect(sig.verifyAgentSignature(data, sign(data, B), [pubB64(A), pubB64(B)])).toMatchObject({ ok: true, keyIndex: 1 });
  });
  it('refuses a tampered file', () => {
    const bad = Buffer.concat([data, Buffer.from(' ')]);
    expect(sig.verifyAgentSignature(bad, sign(data, A), [pubB64(A)])).toMatchObject({ ok: false, reason: 'signature-mismatch' });
  });
  it('refuses a signature from a key that is not trusted', () => {
    expect(sig.verifyAgentSignature(data, sign(data, B), [pubB64(A)]).ok).toBe(false);
  });
  it('refuses garbage and fails closed with no keys', () => {
    expect(sig.verifyAgentSignature(data, 'AAAA', [pubB64(A)]).reason).toBe('bad-signature-format');
    expect(sig.verifyAgentSignature(data, sign(data, A), [])).toMatchObject({ ok: false, reason: 'no-keys' });
    expect(sig.verifyAgentSignature(data, sign(data, A), ['not a key']).ok).toBe(false);
  });
  it('ships with NO key baked in until the guild lead generates one', () => {
    expect(sig.TRUSTED_PUBLIC_KEYS).toEqual([]);
  });
});

describe('checkUrl / checkRedirect', () => {
  it('accepts the fixed https host and repo path', () => { expect(sig.checkUrl(good).ok).toBe(true); });
  it('refuses http, other hosts, other repos, credentials, odd ports', () => {
    expect(sig.checkUrl(good.replace('https:', 'http:')).ok).toBe(false);
    expect(sig.checkUrl('https://evil.example.com/davehess/raidmimic/main/index.js').ok).toBe(false);
    expect(sig.checkUrl('https://raw.githubusercontent.com/someone/else/main/index.js').ok).toBe(false);
    expect(sig.checkUrl('https://u:p@raw.githubusercontent.com/davehess/raidmimic/x').ok).toBe(false);
    expect(sig.checkUrl('https://raw.githubusercontent.com:8443/davehess/raidmimic/x').ok).toBe(false);
    expect(sig.checkUrl('nonsense').ok).toBe(false);
  });
  it('redirects stay on the same allowed host', () => {
    expect(sig.checkRedirect(good, '/davehess/raidmimic/main/x.js').ok).toBe(true);
    expect(sig.checkRedirect(good, 'https://evil.example.com/davehess/raidmimic/x').ok).toBe(false);
    expect(sig.checkRedirect(good, 'http://raw.githubusercontent.com/davehess/raidmimic/x').ok).toBe(false);
  });
});

describe('decideUpdate modes', () => {
  const ok = { ok: true, keyIndex: 0 }, bad = { ok: false, reason: 'signature-mismatch' };
  it('a hash mismatch never installs, in any mode', () => {
    for (const mode of ['off', 'warn', 'enforce']) expect(sig.decideUpdate({ mode, hashOk: false, sig: ok }).accept).toBe(false);
  });
  it('off ignores signatures', () => { expect(sig.decideUpdate({ mode: 'off', hashOk: true, sig: bad }).accept).toBe(true); });
  it('warn accepts unsigned and bad (logged), enforce refuses both', () => {
    expect(sig.decideUpdate({ mode: 'warn', hashOk: true, sig: null })).toMatchObject({ accept: true });
    expect(sig.decideUpdate({ mode: 'warn', hashOk: true, sig: bad })).toMatchObject({ accept: true });
    expect(sig.decideUpdate({ mode: 'enforce', hashOk: true, sig: null }).accept).toBe(false);
    expect(sig.decideUpdate({ mode: 'enforce', hashOk: true, sig: bad }).accept).toBe(false);
    expect(sig.decideUpdate({ mode: 'enforce', hashOk: true, sig: ok }).accept).toBe(true);
  });
  it('an unknown mode is enforce, and the shipped constant is a real mode', () => {
    expect(sig.normalizeMode('wran')).toBe('enforce');
    expect(['off', 'warn', 'enforce']).toContain(sig.SIG_MODE);
  });
});

describe('wiring in apps/mimic/main.js', () => {
  const src = stripJs(fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'main.js'), 'utf8'));
  it('the agent download goes through the allowlist and decideUpdate', () => {
    expect(src).toMatch(/_agentSig\.checkUrl\(url\)/);
    expect(src).toMatch(/_agentSig\.decideUpdate\(/);
    expect(src).not.toMatch(/protocol === 'http:' \? require\('http'\) : require\('https'\)\;\s*\n\s*return new Promise\(\(resolve, reject\) => \{\s*\n\s*const req = lib\.get/);
  });
});
