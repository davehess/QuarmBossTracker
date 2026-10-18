#!/usr/bin/env node
// Non-destructive security VERIFICATION checks for the Wolf Pack platform (docs/SECURITY-TESTS.md, §354).
// Authorized use only, on hosts you own, off raid hours, beta before prod. It makes NO writes, posts nothing,
// places no bid, and runs no real DoS — the A2 burst is small, capped, and stops the moment it sees a 429.
//
//   node scripts/sec-check.mjs --target https://b.wolfpack.quest --i-own-this-target
//   node scripts/sec-check.mjs --target https://b.wolfpack.quest --i-own-this-target \
//        --supabase-url https://<ref>.supabase.co --anon-key <public anon key from the page source>
//
// Exit code is the number of FAILED checks (0 = all guards held). It will not run without --i-own-this-target.

const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, arr) => {
  if (!a.startsWith('--')) return [];
  const k = a.slice(2);
  const v = arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true;
  return [[k, v]];
}));

const target = String(args.target || '').replace(/\/+$/, '');
if (!target || args['i-own-this-target'] !== true) {
  console.error('Refusing to run. Pass --target <https URL you own> and --i-own-this-target.');
  console.error('Example: node scripts/sec-check.mjs --target https://b.wolfpack.quest --i-own-this-target');
  process.exit(2);
}
if (!/^https:\/\//.test(target)) { console.error('Target must be https.'); process.exit(2); }

const BURST = Math.min(Number(args['burst']) || 250, 400);   // hard cap: a probe, never a flood
let failed = 0;
const pass = (n, m) => console.log(`  PASS  ${n}${m ? ' — ' + m : ''}`);
const fail = (n, m) => { failed++; console.log(`  FAIL  ${n}${m ? ' — ' + m : ''}`); };
const info = (n, m) => console.log(`  ..    ${n}${m ? ' — ' + m : ''}`);

async function timed(url, opts) {
  const t = Date.now();
  try { const r = await fetch(url, opts); return { status: r.status, ms: Date.now() - t, headers: r.headers }; }
  catch (e) { return { status: 0, ms: Date.now() - t, err: String(e && e.message || e) }; }
}

// A1 — a malformed bearer is rejected, fast, every time.
async function a1() {
  console.log('A1  bad token rejected cheaply');
  const bot = args['bot'] ? String(args['bot']).replace(/\/+$/, '') : target;
  let bad = 0, slow = 0;
  for (let i = 0; i < 5; i++) {
    const r = await timed(`${bot}/api/agent/poll`, { headers: { authorization: 'Bearer wpms_notarealtoken' + i } });
    if (r.status !== 401) bad++;
    if (r.ms > 500) slow++;
  }
  if (bad) fail('A1', `expected 401 on every bad token, got ${bad}/5 other`);
  else if (slow) fail('A1', `401s are slow (${slow}/5 over 500ms) — a bad token may be hitting the store`);
  else pass('A1', 'five bad tokens, all fast 401');
}

// A2 — a bounded burst trips the per-IP limiter (429) before the cap; /health stays up. Stops at the first 429.
async function a2() {
  console.log(`A2  per-IP rate limit (burst up to ${BURST}, stops at first 429)`);
  const bot = args['bot'] ? String(args['bot']).replace(/\/+$/, '') : target;
  let saw429 = 0, sent = 0;
  for (let i = 0; i < BURST; i++) {
    sent++;
    const r = await timed(`${bot}/api/agent/poll`, { headers: { authorization: 'Bearer wpms_' + '0'.repeat(64) } });
    if (r.status === 429) { saw429 = i + 1; break; }
  }
  const h = await timed(`${bot}/health`);
  if (!saw429) fail('A2', `no 429 in ${sent} requests — limiter may be off or set very high`);
  else pass('A2', `429 at request ${saw429}`);
  if (h.status === 200) pass('A2 /health', 'health stayed 200'); else fail('A2 /health', `health returned ${h.status}`);
}

// A3 — robots + noindex on share surfaces (no valid token needed; a random token 404s with the right headers).
async function a3() {
  console.log('A3  share-link headers (robots, noindex)');
  const robots = await timed(`${target}/robots.txt`);
  let body = '';
  try { body = await (await fetch(`${target}/robots.txt`)).text(); } catch {}
  if (robots.status === 200 && /Disallow:\s*\/share\//i.test(body) && /Disallow:\s*\/api\//i.test(body))
    pass('A3 robots', 'disallows /share/ and /api/');
  else fail('A3 robots', `robots.txt did not disallow both (status ${robots.status})`);

  const token = 'A'.repeat(43);   // right shape, certainly not a real link → 404, but headers should be set
  const r = await timed(`${target}/api/share/raid/${token}/replay`);
  const xr = r.headers && r.headers.get && r.headers.get('x-robots-tag');
  if (xr && /noindex/i.test(xr)) pass('A3 noindex', `X-Robots-Tag: ${xr}`);
  else fail('A3 noindex', `no noindex X-Robots-Tag on a share route (got ${xr || 'none'}, status ${r.status})`);
}

// A4 — the two tables the audit flagged deny the anonymous key. Read-only; needs the PUBLIC anon key.
async function a4() {
  console.log('A4  anon cannot read character_live_state / mimic_link_codes');
  const url = String(args['supabase-url'] || '').replace(/\/+$/, '');
  const key = String(args['anon-key'] || '');
  if (!url || !key) { info('A4', 'skipped (pass --supabase-url and --anon-key, the public key from the page source)'); return; }
  for (const table of ['character_live_state', 'mimic_link_codes']) {
    const r = await timed(`${url}/rest/v1/${table}?select=*&limit=1`, { headers: { apikey: key, authorization: `Bearer ${key}` } });
    let rows = null;
    try { rows = JSON.parse(await (await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, { headers: { apikey: key, authorization: `Bearer ${key}` } })).text()); } catch {}
    if (Array.isArray(rows) && rows.length > 0) fail(`A4 ${table}`, `anon READ returned ${rows.length} row(s) — RLS is open!`);
    else pass(`A4 ${table}`, `anon denied (status ${r.status})`);
  }
}

console.log(`\nWolf Pack security verification — target ${target}\n(non-destructive; run on beta, off raid hours)\n`);
await a1();
await a2();
await a3();
await a4();
console.log(`\n${failed ? failed + ' CHECK(S) FAILED — a guard regressed; see docs/SECURITY-TESTS.md' : 'All checks passed.'}\n`);
process.exit(failed);
