#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/import-quest-scripts.js
//
// Import quest turn-in handlers from the ProjectEQ quest scripts repo
// (https://github.com/ProjectEQ/projecteqquests) into scripted_npc_turnins.
// Authoritative source for every NPC turn-in in EQ — what items the player
// gives, what items come back, faction nudges, cash, exp. Quarm runs the
// same script set; specific items may differ but the structure is identical.
// (Uilnayar 2026-06-24: "Build the script import".)
//
// Patterns recognized:
//
// Perl turn-in handler (the dominant case in the repo):
//   sub EVENT_ITEM {
//     if (plugin::check_handin(\%itemcount, ITEM_ID => QTY [, ITEM_ID2 => QTY2])) {
//       quest::summonitem(ITEM_ID);                      ← fixed reward
//       quest::summonitem(quest::ChooseRandom(A,B,C));   ← random pick
//       quest::faction(FACTION_ID, DELTA);
//       quest::givecash(COPPER, SILVER, GOLD, PLAT);     ← any subset
//       quest::exp(AMOUNT);
//     } elsif (...) { ... }
//   }
//
// Lua turn-in handler (newer):
//   if(item_lib.check_turn_in(e.self, e.trade, {item1=X, item2=Y, ...})) then
//     e.other:QuestReward(e.self, 0,0,0,0, REWARD_ID[, EXP]);
//     e.other:Faction(e.self, FACTION_ID, DELTA);
//   end
//
// Each matching branch is one row. We dedup by (zone_short, npc_name, snippet).
//
// USAGE:
//   SUPABASE_URL=...  SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-quest-scripts.js [--limit N] [--zone Z] [--commit]
// Without --commit we DRY-RUN and just summarize.

'use strict';

const https = require('https');
const path  = require('path');
const fs    = require('fs');

const REPO   = 'ProjectEQ/projecteqquests';
const BRANCH = 'master';
const RAW    = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;
const TREE   = `https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`;

// ── tiny HTTP fetch (no deps) ────────────────────────────────────────────────
function fetchText(url, { isJson = false, headers = {}, retries = 4 } = {}) {
  // GitHub anon rate-limit is 60/hr; honor Retry-After / X-RateLimit-Reset on
  // 403/429 by sleeping past the reset, then retrying.
  return new Promise((resolve, reject) => {
    const attempt = (left) => {
      const req = https.get(url, {
        headers: {
          'User-Agent': 'wolfpack-quest-importer',
          'Accept': isJson ? 'application/vnd.github.v3+json' : 'text/plain',
          ...headers,
        },
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchText(res.headers.location, { isJson, headers, retries: left }).then(resolve, reject);
        }
        if ((res.statusCode === 403 || res.statusCode === 429) && left > 0) {
          const reset = parseInt(res.headers['x-ratelimit-reset'] || '0', 10);
          const ra    = parseInt(res.headers['retry-after']        || '0', 10);
          const waitMs = ra ? ra * 1000
            : reset ? Math.max(1000, reset * 1000 - Date.now() + 1000)
            : 60_000;
          res.resume();
          console.warn(`[rate-limit] ${res.statusCode} — sleeping ${Math.round(waitMs / 1000)}s before retry`);
          return setTimeout(() => attempt(left - 1), Math.min(waitMs, 5 * 60_000));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', reject);
      });
      req.on('error', reject);
      // Aggressive timeout — one stuck blob shouldn't lock a worker forever.
      // The retry path takes over if a transient drop fires this.
      req.setTimeout(15_000, () => { req.destroy(new Error(`timeout ${url}`)); });
    };
    attempt(retries);
  });
}

// ── Perl handler parser ──────────────────────────────────────────────────────
// Extract the body of EVENT_ITEM (or sub EVENT_ITEM) — multi-line, balanced
// braces. We tolerate variations (curly placement, comments) by walking the
// text and counting braces from the first { after the EVENT_ITEM keyword.
function extractEventBlock(src, keyword) {
  const rx = new RegExp(`(?:sub\\s+)?${keyword}\\b[^{]*\\{`, 'i');
  const m = rx.exec(src);
  if (!m) return null;
  let depth = 1, i = m.index + m[0].length;
  const start = i;
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    i++;
  }
  return src.slice(start, i - 1);
}

// Split a Perl `if (...) {...} elsif (...) {...} else {...}` chain into branches.
// We do this brace-by-brace because the body of each branch can contain other
// expressions with their own braces.
function splitPerlBranches(eventBody) {
  const branches = [];
  let i = 0;
  while (i < eventBody.length) {
    // Find the next "if(", "elsif(", or "unless(" — the conditional we care about
    const head = /\b(if|elsif|unless)\b\s*\(/.exec(eventBody.slice(i));
    if (!head) break;
    const condStart = i + head.index + head[0].length;
    // Walk parens to find condition end
    let depth = 1, j = condStart;
    while (j < eventBody.length && depth > 0) {
      const c = eventBody[j];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      j++;
    }
    const cond = eventBody.slice(condStart, j - 1);
    // Find opening brace of body
    while (j < eventBody.length && eventBody[j] !== '{') j++;
    if (eventBody[j] !== '{') break;
    const bodyStart = j + 1;
    depth = 1; j = bodyStart;
    while (j < eventBody.length && depth > 0) {
      const c = eventBody[j];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      j++;
    }
    const body = eventBody.slice(bodyStart, j - 1);
    branches.push({ cond, body });
    i = j;
  }
  return branches;
}

// Parse a Perl `plugin::check_handin(\%itemcount, ID => QTY, ID => QTY)` call.
// Returns the {item_id, qty}[] tuples or null if the cond isn't a check_handin.
// Returns { items: [{item_id, qty}], money: {plat,gold,silver,copper}|null }
// — null when this branch isn't a check_handin. The EQ trade window holds 4
// items + currency, so a turn-in can require both, and both forms occur:
//   (a) currency inside check_handin: plugin::check_handin(\%ic, 7836 => 1, platinum => 100)
//   (b) currency as a prefix condition: ($platinum >= 900) && plugin::check_handin(\%ic, ...)
// We collect both. (Uilnayar 2026-06-24.)
function parseCheckHandinPerl(cond) {
  const m = /plugin::check_handin\s*\(\s*\\?%\w+\s*,\s*([^)]*)\)/.exec(cond);
  if (!m) return null;
  const args = m[1];
  const items = [];
  let pm;
  const pairRx = /(\d+)\s*=>\s*(\d+)/g;
  while ((pm = pairRx.exec(args)) !== null) {
    items.push({ item_id: parseInt(pm[1], 10), qty: parseInt(pm[2], 10) });
  }
  const money = { plat: 0, gold: 0, silver: 0, copper: 0 };
  let any = false;
  // Inline currency keys
  const curRx = /\b(platinum|plat|gold|silver|copper)\b\s*=>\s*(\d+)/gi;
  while ((pm = curRx.exec(args)) !== null) {
    const k = pm[1].toLowerCase().replace(/^plat$/, 'plat').replace('platinum', 'plat');
    money[k] = parseInt(pm[2], 10); any = true;
  }
  // Prefix-condition form: ($platinum >= 900)
  const prefRx = /\$(platinum|plat|gold|silver|copper)\s*>=\s*(\d+)/gi;
  while ((pm = prefRx.exec(cond)) !== null) {
    const k = pm[1].toLowerCase().replace(/^plat$/, 'plat').replace('platinum', 'plat');
    money[k] = Math.max(money[k] || 0, parseInt(pm[2], 10)); any = true;
  }
  if (items.length === 0 && !any) return null;
  return { items, money: any ? money : null };
}

// Parse the body of a Perl turn-in branch for outputs / faction / cash / exp.
function parsePerlBody(body) {
  const outputs = [];
  let random = false;

  // summonitem(ID)
  let m;
  const fixedRx = /quest::summonitem\s*\(\s*(\d+)/g;
  while ((m = fixedRx.exec(body)) !== null) outputs.push({ item_id: parseInt(m[1], 10), kind: 'fixed' });

  // summonitem(quest::ChooseRandom(A,B,C,...))
  const randRx = /quest::summonitem\s*\(\s*quest::ChooseRandom\s*\(([^)]+)\)/g;
  while ((m = randRx.exec(body)) !== null) {
    random = true;
    for (const idRaw of m[1].split(',')) {
      const id = parseInt(idRaw.trim(), 10);
      if (Number.isFinite(id) && id > 0) outputs.push({ item_id: id, kind: 'random' });
    }
  }

  // faction(FACTION_ID, DELTA[, ...])
  const factions = [];
  const facRx = /quest::faction\s*\(\s*(\d+)\s*,\s*(-?\d+)/g;
  while ((m = facRx.exec(body)) !== null) {
    factions.push({ faction_id: parseInt(m[1], 10), delta: parseInt(m[2], 10) });
  }

  // givecash(COPPER, SILVER, GOLD, PLATINUM) — Perl order is C,S,G,P. Spec at
  // https://docs.eqemu.io/server/quests/perl-methods/. Skip if all zero.
  let cash = null;
  const cm = /quest::givecash\s*\(\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)/.exec(body);
  if (cm) {
    const c = +cm[1], s = +cm[2], g = +cm[3], p = +cm[4];
    if (c || s || g || p) cash = { copper: c, silver: s, gold: g, plat: p };
  }

  // exp(N)
  const em = /quest::exp\s*\(\s*(\d+)/.exec(body);
  const exp_award = em ? parseInt(em[1], 10) : null;

  return { outputs, factions, cash, exp_award, random };
}

// ── Lua handler parser ───────────────────────────────────────────────────────
function parseLuaTurnIns(src) {
  const results = [];
  // Each turn-in: item_lib.check_turn_in(... {item1=X, item2=Y, ...})
  // Both 2-arg (e.trade, {…}) and 3-arg (e.self, e.trade, {…}) variants exist
  // in the wild — Cazic Thule's Lua uses 2-arg and was hiding the Whistling
  // Fists turn-in until we accepted both. Permissive: skip up to the inline
  // table no matter what's in between.
  const checkRx = /item_lib\.check_turn_in\s*\([^{]*\{([^}]*)\}/g;
  let m;
  while ((m = checkRx.exec(src)) !== null) {
    // Inputs from the inline table — items + optional currency keys.
    const inputs = [];
    const itemRx = /item(\d+)\s*=\s*(\d+)/g;
    let im;
    while ((im = itemRx.exec(m[1])) !== null) inputs.push({ item_id: parseInt(im[2], 10), qty: 1 });
    const money = { plat: 0, gold: 0, silver: 0, copper: 0 };
    let anyMoney = false;
    const curRx = /\b(platinum|plat|gold|silver|copper)\b\s*=\s*(\d+)/gi;
    while ((im = curRx.exec(m[1])) !== null) {
      const k = im[1].toLowerCase().replace(/^plat$/, 'plat').replace('platinum', 'plat');
      money[k] = parseInt(im[2], 10); anyMoney = true;
    }
    if (inputs.length === 0 && !anyMoney) continue;

    // Body = next ~600 chars (the if/then…end is local). Crude but works for
    // the EVENT_TRADE handlers in this repo, which are tightly scoped.
    const tail = src.slice(m.index, m.index + 1500);
    const outputs = [];
    let random = false;
    let om;
    // QuestReward(self, c,s,g,p, REWARD_ID[, EXP])
    const rewRx = /QuestReward\s*\(\s*e\.self\s*,\s*-?\d+\s*,\s*-?\d+\s*,\s*-?\d+\s*,\s*-?\d+\s*,\s*(\d+)/g;
    while ((om = rewRx.exec(tail)) !== null) outputs.push({ item_id: parseInt(om[1], 10), kind: 'fixed' });
    // SummonItem(ID)
    const sumRx = /SummonItem\s*\(\s*(\d+)/g;
    while ((om = sumRx.exec(tail)) !== null) outputs.push({ item_id: parseInt(om[1], 10), kind: 'fixed' });

    const factions = [];
    const facRx = /Faction\s*\(\s*e\.self\s*,\s*(\d+)\s*,\s*(-?\d+)/g;
    while ((om = facRx.exec(tail)) !== null) factions.push({ faction_id: parseInt(om[1], 10), delta: parseInt(om[2], 10) });

    results.push({
      inputs, outputs, factions, cash: null, exp_award: null, random,
      money_required: anyMoney ? money : null,
      snippet: tail.slice(0, 800),
    });
  }
  return results;
}

// ── Per-file parse ───────────────────────────────────────────────────────────
function parseScript({ source, lang }) {
  if (lang === 'lua') {
    return parseLuaTurnIns(source);
  }
  // Perl
  const eventBody = extractEventBlock(source, 'EVENT_ITEM');
  if (!eventBody) return [];
  const branches = splitPerlBranches(eventBody);
  const out = [];
  for (const b of branches) {
    const hi = parseCheckHandinPerl(b.cond);
    if (!hi) continue;
    const body = parsePerlBody(b.body);
    if (body.outputs.length === 0 && body.factions.length === 0 && !body.cash && !body.exp_award && !hi.money) continue;
    out.push({
      inputs: hi.items,
      money_required: hi.money,
      outputs: body.outputs,
      factions: body.factions,
      cash: body.cash,
      exp_award: body.exp_award,
      random: body.random,
      snippet: b.body.slice(0, 800),
    });
  }
  return out;
}

// NPC name from filename: "Captain_Bvellos.pl" → "Captain Bvellos"
// "#Doldigun_Steinwielder.pl" → "Doldigun Steinwielder" (leading # marks a
// targetable "the_" / special spawn name in EQEmu convention).
function npcNameFromFile(name) {
  return name.replace(/\.(pl|lua)$/i, '').replace(/^#/, '').replace(/_/g, ' ');
}

// ── Supabase REST writer (no deps) ───────────────────────────────────────────
async function upsertBatch(rows, { commit }) {
  if (!commit) return rows.length;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required to --commit');
  const endpoint = `${url.replace(/\/$/, '')}/rest/v1/scripted_npc_turnins?on_conflict=zone_short,npc_name,raw_snippet`;
  const body = JSON.stringify(rows);
  return new Promise((resolve, reject) => {
    const req = https.request(endpoint, {
      method: 'POST',
      headers: {
        'apikey': key, 'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(rows.length);
        reject(new Error(`upsert HTTP ${res.statusCode}: ${Buffer.concat(chunks).toString('utf8').slice(0, 500)}`));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);
  const opt = { limit: Infinity, zone: null, commit: false, dump: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit') opt.limit = parseInt(argv[++i], 10);
    else if (a === '--zone') opt.zone = argv[++i];
    else if (a === '--commit') opt.commit = true;
    else if (a === '--dump') opt.dump = argv[++i];
  }

  console.log('Fetching repo tree…');
  // Cached tree on disk avoids burning the auth-API rate limit window. Drop the
  // file with: curl -A 'Mozilla/5.0' "$TREE" > /tmp/peq-tree.json
  const treePath = '/tmp/peq-tree.json';
  const tree = fs.existsSync(treePath)
    ? JSON.parse(fs.readFileSync(treePath, 'utf8'))
    : JSON.parse(await fetchText(TREE, { isJson: true }));
  const candidates = (tree.tree || []).filter(t =>
    t.type === 'blob' && /\.(pl|lua)$/i.test(t.path)
      && !/script_init\.lua$/i.test(t.path)
      && !t.path.includes('/encounters/')
      && (!opt.zone || t.path.toLowerCase().startsWith(opt.zone.toLowerCase() + '/'))
  );
  console.log(`Found ${candidates.length} script files${opt.zone ? ` in zone ${opt.zone}` : ''}.`);

  // Parallel-fetch with a tiny concurrency cap so we don't trip GitHub's
  // secondary rate limit (the primary one is generous at 15k/hr for auth, but
  // bursting 8+ concurrent reqs gets you a temporary 403). 3 is gentle enough
  // for 8k files inside one budget while still finishing in ~30 min.
  const CONCURRENCY = 3;
  const queued = [...candidates].slice(0, opt.limit);
  let i = 0, rowsBuffered = [], totalRows = 0, totalScripts = 0, totalErrors = 0;
  const FLUSH_AT = 25;
  // When dumping to a JSONL file, accumulate everything in the dump stream
  // instead of flushing batches to Supabase. The user can then run the SQL
  // through the MCP one chunk at a time.
  const dumpStream = opt.dump ? fs.createWriteStream(opt.dump) : null;

  let lastProgress = Date.now();
  async function worker() {
    while (i < queued.length) {
      const f = queued[i++];
      // Periodic stderr progress so we can see liveness without parsing batches.
      const now = Date.now();
      if (now - lastProgress > 5_000) {
        lastProgress = now;
        process.stderr.write(`[progress] i=${i}/${queued.length} rows=${totalRows} scripts=${totalScripts} errors=${totalErrors}\n`);
      }
      try {
        // `#` is the URL fragment delimiter — EQEmu uses it as a filename prefix
        // for "special" NPC names, so we must encode it (and any other reserved
        // char) on the path. encodeURI keeps slashes; encodeURIComponent on each
        // segment is the safest.
        const safePath = f.path.split('/').map(encodeURIComponent).join('/');
        const source = await fetchText(`${RAW}/${safePath}`);
        const parts = f.path.split('/');
        const zone_short = parts[0];
        const fileName = parts[parts.length - 1];
        const npc_name = npcNameFromFile(fileName);
        const lang = f.path.endsWith('.lua') ? 'lua' : 'perl';
        const turnins = parseScript({ source, lang });
        if (turnins.length > 0) {
          totalScripts++;
          for (const t of turnins) {
            rowsBuffered.push({
              zone_short, npc_name, script_path: f.path, script_lang: lang,
              inputs: t.inputs, outputs: t.outputs,
              faction_changes: t.factions.length ? t.factions : null,
              cash: t.cash, exp_award: t.exp_award,
              money_required: t.money_required || null,
              random_outputs: t.random,
              raw_snippet: t.snippet,
            });
            totalRows++;
          }
        }
      } catch (err) {
        totalErrors++;
        if (totalErrors < 5) console.warn(`[skip] ${f.path}: ${err.message}`);
      }
      if (rowsBuffered.length >= FLUSH_AT) {
        if (dumpStream) {
          for (const r of rowsBuffered) dumpStream.write(JSON.stringify(r) + '\n');
        } else {
          try { await upsertBatch(rowsBuffered, { commit: opt.commit }); }
          catch (err) { console.error('upsert batch failed:', err.message); }
        }
        rowsBuffered = [];
        if (totalScripts % 100 === 0) console.log(`… processed ${i}/${queued.length}, scripts with turn-ins: ${totalScripts}, rows: ${totalRows}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (rowsBuffered.length) {
    if (dumpStream) {
      for (const r of rowsBuffered) dumpStream.write(JSON.stringify(r) + '\n');
    } else {
      try { await upsertBatch(rowsBuffered, { commit: opt.commit }); }
      catch (err) { console.error('final upsert failed:', err.message); }
    }
  }
  if (dumpStream) await new Promise(r => dumpStream.end(r));
  console.log(`Done. Files scanned: ${queued.length}. Scripts with turn-ins: ${totalScripts}. Rows: ${totalRows}. Errors: ${totalErrors}. Commit: ${opt.commit}.`);
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}

// Exports for unit testing the parsers without hitting GitHub
module.exports = { parseScript, parseCheckHandinPerl, parsePerlBody, extractEventBlock, splitPerlBranches, parseLuaTurnIns, npcNameFromFile };
