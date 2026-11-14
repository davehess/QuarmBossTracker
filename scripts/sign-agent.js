#!/usr/bin/env node
// scripts/sign-agent.js — offline Ed25519 signing for the agent hot-swap (readiness audit #6).
// Run on the guild lead's own machine; the private key is never stored in the repo, the bot or CI.
//
//   node scripts/sign-agent.js --keygen --out <private-key.pem>   new keypair; prints the PUBLIC key to embed
//   node scripts/sign-agent.js --key <private-key.pem> [file]     writes <file>.sig (default: the agent index.js)
//   WOLFPACK_SIGN_KEY=<path> node scripts/sign-agent.js [file]    same, key path from the environment
//   node scripts/sign-agent.js --verify [--pub <b64>] [file]      checks <file>.sig (default key list: Mimic's)
//
// Sign AFTER `npm run sync:dashboard`, as the last step before committing: the signature covers the exact bytes.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_FILE = path.join(__dirname, '..', 'packages', 'wolfpack-logsync', 'index.js');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const positional = args.filter((a, i) => !a.startsWith('--') && !['--key', '--out', '--pub'].includes(args[i - 1]));
const file = positional[0] || DEFAULT_FILE;
const die = (m) => { console.error(m); process.exit(1); };

if (flag('--keygen')) {
  const out = val('--out');
  if (!out) die('--keygen needs --out <path> for the private key (choose a place that is NOT in the repo)');
  if (fs.existsSync(out)) die('refusing to overwrite ' + out);
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(out, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  console.log('private key written to ' + out + ' (keep it offline; back it up; never commit it)');
  console.log('PUBLIC key (add to TRUSTED_PUBLIC_KEYS in apps/mimic/agentSignature.js):');
  console.log(publicKey.export({ type: 'spki', format: 'der' }).toString('base64'));
} else if (flag('--verify')) {
  const { verifyAgentSignature, TRUSTED_PUBLIC_KEYS } = require('../apps/mimic/agentSignature.js');
  const pub = val('--pub');
  const r = verifyAgentSignature(fs.readFileSync(file), fs.readFileSync(file + '.sig', 'utf8'), pub ? [pub] : TRUSTED_PUBLIC_KEYS);
  console.log(r.ok ? 'OK: ' + file + '.sig verifies (key #' + r.keyIndex + ')' : 'FAIL: ' + r.reason);
  process.exit(r.ok ? 0 : 1);
} else {
  const keyPath = val('--key') || process.env.WOLFPACK_SIGN_KEY;
  if (!keyPath) die('need --key <private-key.pem> or WOLFPACK_SIGN_KEY');
  const key = crypto.createPrivateKey(fs.readFileSync(keyPath));
  if (key.asymmetricKeyType !== 'ed25519') die('not an Ed25519 key');
  const sig = crypto.sign(null, fs.readFileSync(file), key).toString('base64');
  fs.writeFileSync(file + '.sig', sig + '\n');
  console.log('wrote ' + file + '.sig');
}
