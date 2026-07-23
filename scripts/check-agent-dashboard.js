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

function main() {
  let html, embeds;
  try {
    embeds = loadEmbeds();
    html = embeds.WEB_HTML;
  } catch (err) {
    console.error('✗ Could not load WEB_HTML from the agent:', err.message);
    process.exit(1);
  }

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

  // RULE (Uilnayar 2026-07-08, after the 1.7.0-beta.2 Zeal-pipe collapse):
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

  console.log('\nAll dashboard script blocks parse cleanly; all <details> carry wpKeep; COMMAND_HTML in sync. ✅');
}

main();
