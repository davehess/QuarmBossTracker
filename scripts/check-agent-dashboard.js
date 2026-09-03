#!/usr/bin/env node
// scripts/check-agent-dashboard.js
//
// Guards against the blank-dashboard escape bug that has bitten us twice
// (agent v2.4.25 — bare `\n`; v2.4.27 — bare `\'`). The agent's web
// dashboard is one big backtick template literal containing browser-side
// JS; a single mis-escaped character there renders the WHOLE page blank
// with an Uncaught SyntaxError and no partial degradation.
//
// This script:
//   1) Loads packages/wolfpack-logsync/index.js as a module WITHOUT booting
//      it (strips the `if (require.main === module) main()` tail), exporting
//      the fully-interpolated WEB_HTML string.
//   2) Extracts every <script>…</script> body — i.e. exactly what the
//      browser receives.
//   3) Feeds each through `new Function(body)` to assert it parses as valid
//      JS. A throw here is the same SyntaxError a user's browser would hit.
//
// Run after any edit to WEB_HTML:  node scripts/check-agent-dashboard.js
// Exit code 0 = clean, 1 = a script block failed to parse (build break).

const fs   = require('fs');
const path = require('path');

const AGENT = path.join(__dirname, '..', 'packages', 'wolfpack-logsync', 'index.js');
const COMMAND_FILE = path.join(__dirname, '..', 'apps', 'mimic', 'command.html');

// WEB_HTML must be the machine-generated fold of dashboard.html — the file is
// authoritative (Decision #3 slice, 2026-08-30). A hand-edit to the literal,
// or an unsynced edit to the .html, both land here as a byte diff.
function checkDashboardDrift() {
  const { buildLiteral, literalRegion, HTML } = require('./sync-dashboard-embed.js');
  const src = fs.readFileSync(AGENT, 'utf8');
  const region = literalRegion(src);
  if (!region) { console.error('✗ WEB_HTML literal not found'); return 1; }
  const expected = buildLiteral(fs.readFileSync(HTML, 'utf8'));
  const actual = src.slice(region[0], region[1]);
  if (expected === actual) {
    console.log(`✓ WEB_HTML matches dashboard.html fold (${actual.length} literal chars)`);
    return 0;
  }
  const at = firstDiff(expected, actual);
  console.error(`✗ WEB_HTML has DRIFTED from dashboard.html (first diff at literal offset ${at}).`);
  console.error('  If you edited dashboard.html:      npm run sync:dashboard');
  console.error('  If you edited the literal by hand: revert — dashboard.html is authoritative.');
  return 1;
}

// ── Eaten-backslash detector ────────────────────────────────────────────────
// The old hand-escaped WEB_HTML literal ate backslashes, and the survivors sat
// in the shipped dashboard for months looking like valid code. Found 2026-08-30
// by a raid-night report — an officer's RaidTick file gave "No attendees in
// that source" because `/^file:(d+)$/` matches a literal "d", never "file:0".
// The same sweep found `.split(/s+/)` twice (which silently defeated the
// wp-* class preservation its own comment describes) and `/^✥s*/`.
//
// A lost backslash is INVISIBLE in review and never throws: `d+`, `s*` and `w+`
// are all valid regex, they just match the wrong thing. So it is checked
// mechanically instead. Only the character classes that read as ordinary
// letters are flagged (d s w D S W) and only when followed by a quantifier —
// that is the shape that is always a mistake, and it keeps the check free of
// judgement calls about legitimate literal letters.
const EATEN_BACKSLASH = /(^|[^\\])[dswDSW][+*{]/;
function checkEatenBackslashes(html, label) {
  let bad = 0;
  const lines = html.split('\n');
  lines.forEach((line, i) => {
    if (line.length > 2000) return;   // data: URIs — no code lives there
    for (const m of line.matchAll(/\/((?:[^/\\\n[]|\\.|\[(?:[^\]\\]|\\.)*\])+)\/[gimsuy]*/g)) {
      if (!EATEN_BACKSLASH.test(m[1])) continue;
      bad++;
      console.error(`\u2717 ${label}:${i + 1} regex ${m[0]} looks like it lost a backslash.`);
      console.error(`    ${line.trim().slice(0, 160)}`);
      console.error('    → a bare d/s/w before a quantifier matches the LETTER, not the class.');
    }
  });
  if (!bad) console.log(`\u2713 no eaten backslashes in ${label} regex literals`);
  return bad;
}

function loadEmbeds() {
  let code = fs.readFileSync(AGENT, 'utf8');
  // Prevent the agent from actually starting when we _compile() it.
  code = code.replace(/if \(require\.main === module\)[\s\S]*$/, '');
  const m = new module.constructor();
  // Append an export so we can read the interpolated template literals.
  m._compile(code + '\nmodule.exports = { WEB_HTML, COMMAND_HTML };', AGENT);
  return m.exports;
}

// Byte-offset of the first char where two strings differ, or -1 if identical.
function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

// Parse every <script> body and any browser-side `process.` leak in an HTML
// string. Returns the number of failures (0 = clean). Shared by WEB_HTML and
// the embedded overlay(s) so the escape-hazard guard covers both.
function checkScripts(html, label) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x => x[1]);
  if (scripts.length === 0) {
    console.error(`✗ No <script> blocks found in ${label} — unexpected.`);
    return 1;
  }
  let failed = 0;
  scripts.forEach((body, i) => {
    try {
      // eslint-disable-next-line no-new-func
      new Function(body);
      console.log(`✓ ${label} <script> #${i} parses (${body.length} chars)`);
    } catch (err) {
      failed++;
      console.error(`✗ ${label} <script> #${i} FAILED to parse: ${err.message}`);
      const lineMatch = String(err.stack || '').match(/<anonymous>:(\d+)/);
      if (lineMatch) {
        const lineNo = parseInt(lineMatch[1], 10);
        const ctx = body.split('\n')[lineNo - 1];
        if (ctx) console.error(`    at served script line ${lineNo}: ${ctx.trim().slice(0, 160)}`);
      }
    }
    const lines = body.split('\n');
    for (let ln = 0; ln < lines.length; ln++) {
      const t = lines[ln].trim();
      if (t.startsWith('//') || t.startsWith('*')) continue;
      if (/\bprocess\s*\.\s*\w/.test(lines[ln])) {
        failed++;
        console.error(`✗ Node-only \`process.\` reference in ${label} <script> #${i}, line ${ln + 1}: ${t.slice(0, 160)}`);
      }
    }
  });
  return failed;
}

// Two top-level `function` declarations sharing one name are legal JavaScript
// and silently resolve to the LAST one. In an 8900-line single-scope dashboard
// that is a live hazard, and it shipped: a seconds formatter named _wpDur was
// added above a pre-existing MILLISECONDS formatter of the same name, so every
// buff on the Buffs tab rendered 1/1000 of its real time — Girdle of Karana's
// 56 minutes read "3s" (Hitya 2026-09-02, screenshot against the in-game buff
// window). Nothing threw, nothing looked broken, and the numbers were plausible
// enough to read past.
//
// Cheap to detect, so detect it: a redeclaration is never intentional here.
function checkDuplicateFunctions(html, label) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x => x[1]);
  const seen = new Map();          // name → first line number
  const dupes = [];
  scripts.forEach((body) => {
    const lines = body.split('\n');
    lines.forEach((line, i) => {
      // Top-level declarations only (column 0) — a nested helper is properly
      // scoped and shadowing it is a normal thing to do.
      const m = /^function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/.exec(line);
      if (!m) return;
      const name = m[1];
      if (seen.has(name)) dupes.push({ name, first: seen.get(name), again: i + 1 });
      else seen.set(name, i + 1);
    });
  });
  if (dupes.length) {
    for (const d of dupes) {
      console.error(`✗ ${label}: function ${d.name}() is declared twice (line ${d.first} and line ${d.again}).`);
      console.error('    The LAST declaration silently wins. Rename one — this is how the Buffs tab');
      console.error('    got a milliseconds formatter and showed every buff at 1/1000 of its real time.');
    }
    return dupes.length;
  }
  console.log(`✓ no duplicate top-level function declarations in ${label} (${seen.size} functions)`);
  return 0;
}

function main() {
  let html, embeds;
  try {
    embeds = loadEmbeds();
    html = embeds.WEB_HTML;
  } catch (err) {
    console.error('✗ Could not load WEB_HTML from the agent:', err.message);
    process.exit(1);
  }

  if (checkDuplicateFunctions(html, 'WEB_HTML')) process.exit(1);

  if (typeof html !== 'string' || !html.includes('<!DOCTYPE html>')) {
    console.error('✗ WEB_HTML did not resolve to a dashboard HTML string.');
    process.exit(1);
  }

  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x => x[1]);
  if (scripts.length === 0) {
    console.error('✗ No <script> blocks found in the dashboard — unexpected.');
    process.exit(1);
  }

  let failed = 0;
  scripts.forEach((body, i) => {
    try {
      // eslint-disable-next-line no-new-func
      new Function(body);
      console.log(`✓ dashboard <script> #${i} parses (${body.length} chars)`);
    } catch (err) {
      failed++;
      console.error(`✗ dashboard <script> #${i} FAILED to parse: ${err.message}`);
      // Best-effort: show the offending line from the served HTML so the
      // fix is obvious (these errors carry a line number in the browser too).
      const lineMatch = String(err.stack || '').match(/<anonymous>:(\d+)/);
      if (lineMatch) {
        const lineNo = parseInt(lineMatch[1], 10);
        const lines = body.split('\n');
        const ctx = lines[lineNo - 1];
        if (ctx) console.error(`    at served script line ${lineNo}: ${ctx.trim().slice(0, 160)}`);
      }
      console.error('    → Likely a bare \\n or \\\' inside the WEB_HTML template literal.');
      console.error('      Inside backticks, write \\\\n and \\\\\' so the served HTML keeps the escape.');
    }
  });

  if (failed > 0) {
    console.error(`\n${failed} dashboard script block(s) broken — the localhost page would render BLANK.`);
    process.exit(1);
  }

  // RULE (2026-07-15/16, agent v3.1.59 regression found on raid night): the
  // SERVED script must never reference the Node-only `process` global — a
  // bare `process.env.X` inside the template (instead of a server-side
  // ${...} interpolation) throws "process is not defined" in the browser and
  // kills every top-level statement after it in the page's single script
  // block. Server-side interpolations are already resolved by the time
  // WEB_HTML is a string, so ANY `process.` surviving into a script body is
  // a leak by definition.
  let procLeaks = 0;
  scripts.forEach((body, i) => {
    const lines = body.split('\n');
    for (let ln = 0; ln < lines.length; ln++) {
      const t = lines[ln].trim();
      if (t.startsWith('//') || t.startsWith('*')) continue;   // prose mentions
      if (/\bprocess\s*\.\s*\w/.test(lines[ln])) {
        procLeaks++;
        console.error(`✗ Node-only \`process.\` reference in served <script> #${i}, line ${ln + 1}:`);
        console.error(`    ${t.slice(0, 160)}`);
      }
    }
  });
  if (procLeaks > 0) {
    console.error(`\n${procLeaks} browser-side \`process.\` leak(s) — bake the value server-side with \${...} instead.`);
    process.exit(1);
  }

  // RULE (Hitya 2026-07-08, after the 1.7.0-beta.2 Zeal-pipe collapse):
  // every <details> the dashboard emits MUST persist its open state through
  // the wpKeep store — section repaints (and PARENT-section repaints, which
  // destroy nested placeholders before their own render runs) reset plain
  // <details> to closed every poll. Enforced here so it can't regress: any
  // '<details' emitted in agent source without wpKeep( in the same statement
  // fails the build.
  const src = fs.readFileSync(AGENT, 'utf8');
  const srcLines = src.split('\n');
  let unkept = 0;
  for (let i = 0; i < srcLines.length; i++) {
    const line = srcLines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;   // prose mentions
    // Only EMITTED markup counts: '<details inside a string literal.
    if (!/['"]<details\b/.test(line)) continue;
    // Same-statement scan: this line plus the next two (concatenations wrap).
    const stmt = line + (srcLines[i + 1] || '') + (srcLines[i + 2] || '');
    if (!stmt.includes('wpKeep(')) {
      unkept++;
      console.error(`✗ <details> without wpKeep() at index.js:${i + 1} — it will collapse on every dashboard repaint.`);
      console.error(`    ${trimmed.slice(0, 140)}`);
    }
  }
  if (unkept > 0) {
    console.error(`\n${unkept} <details> element(s) missing wpKeep() — build with: '<details ' + wpKeep('stable|key') + ' ...>'`);
    process.exit(1);
  }

  // RULE (#65 hot-servable overlays, agent v3.4.18): the agent embeds
  // apps/mimic/command.html as COMMAND_HTML and serves it at GET /overlay/
  // command so the Command Center overlay rides agent hot-swaps. The .html
  // file is the SINGLE SOURCE OF TRUTH; the embed MUST be byte-identical or
  // Mimic's agent-served overlay and its file:// fallback diverge silently.
  // Enforced here: any drift fails the build (fix with
  // `node scripts/sync-command-embed.js`). The embed also carries browser JS,
  // so it gets the same <script> escape-hazard + `process.` leak parse.
  const embed = embeds.COMMAND_HTML;
  if (typeof embed !== 'string' || !embed.includes('<!doctype html>')) {
    console.error('✗ COMMAND_HTML did not resolve to the Command Center HTML string.');
    process.exit(1);
  }
  let file;
  try {
    file = fs.readFileSync(COMMAND_FILE, 'utf8');
  } catch (err) {
    console.error('✗ Could not read apps/mimic/command.html:', err.message);
    process.exit(1);
  }
  if (embed !== file) {
    const at = firstDiff(embed, file);
    console.error('✗ COMMAND_HTML has DRIFTED from apps/mimic/command.html.');
    console.error(`    embed length ${embed.length}, file length ${file.length}, first diff at char ${at}.`);
    const show = (s, i) => JSON.stringify(s.slice(Math.max(0, i - 20), i + 20));
    console.error(`    embed …${show(embed, at)}…`);
    console.error(`    file  …${show(file, at)}…`);
    console.error('    → command.html is authoritative. Re-sync with: node scripts/sync-command-embed.js');
    process.exit(1);
  }
  console.log(`✓ COMMAND_HTML byte-matches apps/mimic/command.html (${embed.length} chars)`);

  const cmdFailed = checkScripts(embed, 'command-overlay');
  if (cmdFailed > 0) {
    console.error(`\n${cmdFailed} problem(s) in the embedded Command Center overlay — the /overlay/command page would break.`);
    process.exit(1);
  }

  if (checkDashboardDrift() > 0) process.exit(1);

  const dashText = fs.readFileSync(require('./sync-dashboard-embed.js').HTML, 'utf8');
  const eaten = checkEatenBackslashes(dashText, 'dashboard.html')
              + checkEatenBackslashes(file, 'command.html');
  if (eaten > 0) {
    console.error(`\n${eaten} regex literal(s) missing a backslash — fix before shipping.`);
    process.exit(1);
  }

  console.log('\nAll dashboard script blocks parse cleanly; all <details> carry wpKeep; COMMAND_HTML and WEB_HTML in sync. ✅');
}

// Guarded so tests can require the detector without running the whole check.
if (require.main === module) main();

module.exports = { checkEatenBackslashes, EATEN_BACKSLASH };
