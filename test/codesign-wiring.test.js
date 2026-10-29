// Mimic code signing (Azure Artifact Signing) must be OFF until the account exists, and
// loud once it is on. This pins both halves: the electron-builder hook is a silent no-op
// without its settings, and release-mimic.yml gates every signing step on them.
//
// Run: npx vitest run test/codesign-wiring.test.js

import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { load as yamlLoad } from 'js-yaml';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const HOOK_PATH = path.join(ROOT, 'apps', 'mimic', 'scripts', 'azure-sign.cjs');
const sign = require(HOOK_PATH);

const KEYS = [
  'AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET',
  'AZURE_SIGNING_ENDPOINT', 'AZURE_SIGNING_ACCOUNT', 'AZURE_CERT_PROFILE',
  'AZURE_SIGNTOOL_PATH', 'AZURE_SIGNING_DLIB_PATH',
];
const saved = {};
for (const k of KEYS) saved[k] = process.env[k];
function clearEnv() { for (const k of KEYS) delete process.env[k]; }
afterEach(() => {
  vi.restoreAllMocks();
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

describe('azure-sign.cjs — the electron-builder hook', () => {
  it('is a silent no-op with no settings: nothing is spawned, nothing is printed', async () => {
    clearEnv();
    const spawn = vi.spyOn(cp, 'spawnSync');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(sign({ path: 'C:\\fake dir\\Raid Mimic.exe' })).resolves.toBeUndefined();
    expect(spawn).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('is a no-op when only some of the six settings are present', async () => {
    clearEnv();
    process.env.AZURE_TENANT_ID = 't';
    process.env.AZURE_CLIENT_ID = 'c';
    process.env.AZURE_CLIENT_SECRET = 's';
    process.env.AZURE_SIGNING_ENDPOINT = 'https://eus.codesigning.azure.net';
    process.env.AZURE_SIGNING_ACCOUNT = '   ';   // blank counts as absent
    const spawn = vi.spyOn(cp, 'spawnSync');
    await sign({ path: 'x.exe' });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('fails closed once configured but the tools are missing (never silently unsigned)', async () => {
    clearEnv();
    for (const k of KEYS.slice(0, 6)) process.env[k] = `value-of-${k}`;
    const spawn = vi.spyOn(cp, 'spawnSync');
    await expect(sign({ path: 'x.exe' })).rejects.toThrow(/signtool\.exe/);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('when configured: one argument per path (spaces survive), no shell, secrets never printed', async () => {
    clearEnv();
    for (const k of KEYS.slice(0, 6)) process.env[k] = `value-of-${k}`;
    process.env.AZURE_CLIENT_SECRET = 'SUPER-SECRET-VALUE';
    const tools = fs.mkdtempSync(path.join(os.tmpdir(), 'codesign-test-'));
    const fakeTool = path.join(tools, 'signtool.exe');
    const fakeDlib = path.join(tools, 'Azure.CodeSigning.Dlib.dll');
    fs.writeFileSync(fakeTool, ''); fs.writeFileSync(fakeDlib, '');
    process.env.AZURE_SIGNTOOL_PATH = fakeTool;
    process.env.AZURE_SIGNING_DLIB_PATH = fakeDlib;

    const calls = [];
    vi.spyOn(cp, 'spawnSync').mockImplementation((cmd, args, opts) => {
      calls.push({ cmd, args, opts, meta: fs.readFileSync(args[args.indexOf('/dmdf') + 1], 'utf8') });
      return { status: 0, stdout: 'ok SUPER-SECRET-VALUE', stderr: '' };
    });
    const out = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => out.push(a.join(' ')));

    const target = 'C:\\build\\win-unpacked\\Raid Mimic.exe';
    await sign({ path: target });

    expect(calls).toHaveLength(1);
    const { cmd, args, opts, meta } = calls[0];
    expect(cmd).toBe(fakeTool);
    expect(opts.shell).toBeFalsy();
    expect(args[0]).toBe('sign');
    expect(args).toContain('SHA256');
    expect(args[args.indexOf('/dlib') + 1]).toBe(fakeDlib);
    expect(args[args.length - 1]).toBe(target);                 // the spaced path is ONE argument, unquoted
    expect(args.indexOf('/tr') >= 0 && args[args.indexOf('/tr') + 1]).toBe('http://timestamp.acs.microsoft.com');
    const m = JSON.parse(meta);
    expect(m).toMatchObject({
      Endpoint: 'value-of-AZURE_SIGNING_ENDPOINT',
      CodeSigningAccountName: 'value-of-AZURE_SIGNING_ACCOUNT',
      CertificateProfileName: 'value-of-AZURE_CERT_PROFILE',
    });
    expect(JSON.stringify(args)).not.toContain('SUPER-SECRET-VALUE');
    expect(meta).not.toContain('SUPER-SECRET-VALUE');
    expect(out.join('\n')).not.toContain('SUPER-SECRET-VALUE');
    // The metadata file is temporary.
    expect(fs.existsSync(args[args.indexOf('/dmdf') + 1])).toBe(false);
  });

  it('a signtool failure throws, with the secret scrubbed from the message', async () => {
    clearEnv();
    for (const k of KEYS.slice(0, 6)) process.env[k] = `value-of-${k}`;
    process.env.AZURE_CLIENT_SECRET = 'SUPER-SECRET-VALUE';
    const tools = fs.mkdtempSync(path.join(os.tmpdir(), 'codesign-test-'));
    process.env.AZURE_SIGNTOOL_PATH = path.join(tools, 'signtool.exe');
    process.env.AZURE_SIGNING_DLIB_PATH = path.join(tools, 'd.dll');
    fs.writeFileSync(process.env.AZURE_SIGNTOOL_PATH, ''); fs.writeFileSync(process.env.AZURE_SIGNING_DLIB_PATH, '');
    vi.spyOn(cp, 'spawnSync').mockReturnValue({ status: 1, stdout: '', stderr: 'denied for SUPER-SECRET-VALUE' });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(Atomics, 'wait').mockReturnValue('ok');
    const err = await sign({ path: 'x.exe' }).then(() => null, (e) => e);
    expect(err).toBeTruthy();
    expect(err.message).toMatch(/could not sign x\.exe/);
    expect(err.message).not.toContain('SUPER-SECRET-VALUE');
  });
});

describe('apps/mimic/package.json — the hook is wired and sha256-only', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'package.json'), 'utf8'));
  it('build.win.sign points at an existing hook', () => {
    expect(pkg.build.win.sign).toBe('./scripts/azure-sign.cjs');
    expect(fs.existsSync(path.join(ROOT, 'apps', 'mimic', pkg.build.win.sign))).toBe(true);
  });
  it('signs once per file (sha256 only) so the service is not called twice', () => {
    expect(pkg.build.win.signingHashAlgorithms).toEqual(['sha256']);
  });
});

describe('release-mimic.yml — signing is gated on configuration', () => {
  const raw = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release-mimic.yml'), 'utf8');
  const doc = yamlLoad(raw);
  const steps = doc.jobs.build.steps;
  const byName = (re) => steps.find((s) => re.test(s.name || ''));
  const GATE = "steps.sign.outputs.configured == 'true'";

  it('has a detect step that every signing step depends on', () => {
    const detect = steps.find((s) => s.id === 'sign');
    expect(detect, 'no step with id: sign').toBeTruthy();
    for (const k of ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET']) {
      expect(detect.env[k]).toContain(`secrets.${k}`);
    }
    for (const k of ['AZURE_SIGNING_ENDPOINT', 'AZURE_SIGNING_ACCOUNT', 'AZURE_CERT_PROFILE']) {
      expect(detect.env[k]).toContain(`vars.${k}`);
    }
  });

  it('installs the signing tools and verifies the signature only when configured', () => {
    for (const re of [/Install signing tools/, /Verify Authenticode/]) {
      const s = byName(re);
      expect(s, `missing step ${re}`).toBeTruthy();
      expect(s.if).toContain(GATE);
    }
    const dotnet = steps.find((s) => /setup-dotnet/.test(s.uses || ''));
    expect(dotnet.if).toContain(GATE);
  });

  it('verify step fails on anything but Valid and checks the manifests against the signed installer', () => {
    const v = byName(/Verify Authenticode/);
    expect(v.id).toBe('verify');
    expect(v.run).toMatch(/Get-AuthenticodeSignature/);
    expect(v.run).toMatch(/-ne 'Valid'[\s\S]*throw/);
    expect(v.run).toMatch(/sha512/);
    expect(v.run).toMatch(/Raid Mimic\.exe/);
  });

  it('hands the AZURE_* settings to the build only when configured', () => {
    const build = byName(/Build Windows installer/);
    for (const k of ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_SIGNING_ENDPOINT', 'AZURE_SIGNING_ACCOUNT', 'AZURE_CERT_PROFILE']) {
      expect(build.env[k], k).toContain(GATE);
    }
  });

  it('the verify step sits between the build and the release notes', () => {
    const i = (re) => steps.findIndex((s) => re.test(s.name || ''));
    expect(i(/Build Windows installer/)).toBeLessThan(i(/Verify Authenticode/));
    expect(i(/Verify Authenticode/)).toBeLessThan(i(/Build release notes/));
  });

  it('the release body says signed-by only when signing ran, otherwise keeps the unsigned line', () => {
    const notes = byName(/Build release notes/);
    expect(notes.env.SIGNED_BY).toContain(GATE);
    expect(notes.env.SIGNED_BY).toContain('steps.verify.outputs.publisher');
    expect(notes.run).toMatch(/code-signed by %s/);
    expect(notes.run).toMatch(/not code-signed \(SmartScreen/);
  });

  it('never echoes a secret', () => {
    const lines = raw.split('\n').filter((l) => !/^\s*#/.test(l));
    for (const l of lines) {
      if (/\b(echo|printf|Write-Host|Write-Output)\b/.test(l)) {
        expect(l, `secret printed: ${l}`).not.toMatch(/CLIENT_SECRET|secrets\.AZURE/);
      }
    }
    // Secrets are referenced only in env blocks (`KEY: ${{ ... }}`), never inside a run script.
    for (const s of steps) {
      expect(String(s.run || ''), s.name).not.toMatch(/secrets\.AZURE/);
    }
  });

  it('leaves the Linux build alone', () => {
    const linux = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'build-mimic-linux.yml'), 'utf8');
    expect(linux).not.toMatch(/AZURE_|azure-sign/);
  });
});
