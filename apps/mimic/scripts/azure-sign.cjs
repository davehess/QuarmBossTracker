// azure-sign.cjs — electron-builder custom signing hook for Azure Artifact Signing
// (formerly Trusted Signing). Wired in apps/mimic/package.json as build.win.sign.
//
// OFF UNTIL CONFIGURED. electron-builder calls a `win.sign` hook for every file it
// signs (the app exe, the NSIS installer, the NSIS uninstaller) even when no
// certificate is configured, so this hook is invoked on EVERY build. It does
// nothing unless all six settings below are present, which keeps a fork, a local
// `npm run dist` and a CI run without secrets exactly as unsigned as they were.
//
//   AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET   service principal
//   AZURE_SIGNING_ENDPOINT   e.g. https://eus.codesigning.azure.net (must match the account's region)
//   AZURE_SIGNING_ACCOUNT    Artifact Signing account name
//   AZURE_CERT_PROFILE       certificate profile name
//
// Once configured it FAILS CLOSED: a missing tool or a rejected signature throws, so a
// release that was meant to be signed can never ship unsigned by accident.
// Tool locations come from the workflow's install step (AZURE_SIGNTOOL_PATH,
// AZURE_SIGNING_DLIB_PATH).
//
// How: Microsoft's documented SignTool + Artifact Signing dlib route,
//   signtool sign /v /debug /fd SHA256 /tr http://timestamp.acs.microsoft.com /td SHA256
//                 /dlib <Azure.CodeSigning.Dlib.dll> /dmdf <metadata.json> <file>
// https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-signing-integrations
//
// Why a hook and not electron-builder's own Azure option: that path breaks on file
// paths containing spaces, and our exe is "Raid Mimic.exe" (docs/code-signing.md).
// Here signtool is launched with an ARGUMENT ARRAY and no shell, so a path with a
// space stays one argument and nothing needs quoting.
//
// SHA-256 only: package.json sets win.signingHashAlgorithms to ["sha256"], otherwise
// electron-builder would call this twice per file (sha1 then sha256 as a nested sign).
//
// Secrets are never printed: the child's output is scrubbed of their values.

'use strict';

const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REQUIRED = [
  'AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET',
  'AZURE_SIGNING_ENDPOINT', 'AZURE_SIGNING_ACCOUNT', 'AZURE_CERT_PROFILE',
];
const SECRETS = ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET'];
const TIMESTAMP_URL = 'http://timestamp.acs.microsoft.com';
const ATTEMPTS = 3;

function isConfigured(env) {
  return REQUIRED.every((k) => typeof env[k] === 'string' && env[k].trim() !== '');
}

function scrub(text, env) {
  let out = String(text || '');
  for (const k of SECRETS) {
    const v = env[k];
    if (v && v.trim()) out = out.split(v).join('***');
  }
  return out;
}

function writeMetadata(env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'azsign-'));
  const file = path.join(dir, 'metadata.json');
  fs.writeFileSync(file, JSON.stringify({
    Endpoint: env.AZURE_SIGNING_ENDPOINT.trim(),
    CodeSigningAccountName: env.AZURE_SIGNING_ACCOUNT.trim(),
    CertificateProfileName: env.AZURE_CERT_PROFILE.trim(),
    // Use only the service principal from the environment; skip the other credential probes.
    ExcludeCredentials: [
      'ManagedIdentityCredential', 'WorkloadIdentityCredential', 'SharedTokenCacheCredential',
      'VisualStudioCredential', 'VisualStudioCodeCredential', 'AzureCliCredential',
      'AzurePowerShellCredential', 'AzureDeveloperCliCredential', 'InteractiveBrowserCredential',
    ],
  }, null, 2));
  return { dir, file };
}

async function sign(configuration) {
  const env = process.env;
  if (!isConfigured(env)) return;                // fail-open: unsigned build, exactly as before

  const file = configuration && configuration.path;
  if (!file) throw new Error('[azure-sign] electron-builder gave no file path to sign');
  const signtool = env.AZURE_SIGNTOOL_PATH;
  const dlib = env.AZURE_SIGNING_DLIB_PATH;
  if (!signtool || !fs.existsSync(signtool) || !dlib || !fs.existsSync(dlib)) {
    throw new Error('[azure-sign] signing is configured but signtool.exe / Azure.CodeSigning.Dlib.dll was not found '
      + '(AZURE_SIGNTOOL_PATH, AZURE_SIGNING_DLIB_PATH). The workflow\'s "Install signing tools" step sets them.');
  }

  const meta = writeMetadata(env);
  try {
    const args = ['sign', '/v', '/debug', '/fd', 'SHA256', '/tr', TIMESTAMP_URL, '/td', 'SHA256',
      '/dlib', dlib, '/dmdf', meta.file, file];
    let last = '';
    for (let i = 1; i <= ATTEMPTS; i++) {
      const r = cp.spawnSync(signtool, args, { env, encoding: 'utf8', windowsHide: true, timeout: 5 * 60 * 1000 });
      if (r && r.status === 0) {
        console.log(`[azure-sign] signed ${path.basename(file)}`);
        return;
      }
      last = scrub(`${(r && r.stdout) || ''}\n${(r && r.stderr) || ''}\n${(r && r.error && r.error.message) || ''}`, env).trim();
      console.log(`[azure-sign] attempt ${i}/${ATTEMPTS} failed for ${path.basename(file)}`);
      if (i < ATTEMPTS) {
        // A short pause between tries (service throttling / timestamp server blips).
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, i * 5000);
      }
    }
    throw new Error(`[azure-sign] could not sign ${path.basename(file)} after ${ATTEMPTS} attempts:\n${last}`);
  } finally {
    try { fs.rmSync(meta.dir, { recursive: true, force: true }); } catch { /* temp dir; the runner is discarded anyway */ }
  }
}

module.exports = sign;
module.exports.isConfigured = isConfigured;
