#!/usr/bin/env node
// scripts/sync-dashboard-embed.js
//
// Decision #3's first slice (docs/ARCHITECT-REBUILD-2026-08-16.md): the agent
// dashboard is AUTHORED as a real file and MACHINE-folded into the single-file
// artifact. packages/wolfpack-logsync/dashboard.html is authoritative; the
// WEB_HTML template literal in the agent is generated from it. Edit the .html,
// then run:
//
//     npm run sync:dashboard
//
// scripts/check-agent-dashboard.js (npm run check:dashboard) FAILS the build
// if the embed drifts from the file — this script is how you fix that failure.
//
// WHY GENERATED, NOT VERBATIM like command.html: the dashboard contains
// backslashes, quotes, and one literal "${}" in prose, so a verbatim embed is
// impossible. Escaping BY HAND is the class that shipped two blank dashboards
// (v2.4.25, v2.4.27) and bit twice more in review during 2026-08-29..30 (a
// bare \n; a backtick inside a COMMENT terminating the literal). This script
// does the only escaping, mechanically:  \ → \\  ·  ` → \`  ·  ${ → \${
//
// AGENT-SIDE INTERPOLATIONS: written in dashboard.html as {{WP:expr}} — e.g.
// {{WP:AGENT_VERSION}} — and turned into real ${expr} in the generated
// literal. Distinct syntax on purpose: the page's own text may contain "${}"
// (it does, once, in prose), so ${} in the .html could never be trusted to
// mean "agent code". Anything between {{WP: and }} becomes CODE inside the
// agent — dashboard.html is repo source with exactly index.js's trust level.
const fs   = require('fs');
const path = require('path');

const AGENT = path.join(__dirname, '..', 'packages', 'wolfpack-logsync', 'index.js');
const HTML  = path.join(__dirname, '..', 'packages', 'wolfpack-logsync', 'dashboard.html');

// dashboard.html → the exact body of the generated template literal.
// Exported so check-agent-dashboard.js verifies drift with the SAME transform
// rather than a reimplementation that could disagree.
function buildLiteral(html) {
  if (html.includes('\x01')) throw new Error('dashboard.html contains \\x01 — the sentinel char is reserved');
  const exprs = [];
  // pull interpolations out FIRST so the escape pass cannot touch their code
  let s = html.replace(/\{\{WP:([\s\S]*?)\}\}/g, (m, e) => {
    exprs.push(e);
    return '\x01WPI' + (exprs.length - 1) + '\x01';
  });
  s = s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  exprs.forEach((e, n) => { s = s.replace('\x01WPI' + n + '\x01', '${' + e + '}'); });
  return s;
}

// Return [start, end) offsets of the literal body inside the agent source.
function literalRegion(src) {
  const OPEN = 'const WEB_HTML = `';
  const start = src.indexOf(OPEN);
  if (start < 0) return null;
  let j = start + OPEN.length;
  while (j < src.length) {
    if (src[j] === '\\') { j += 2; continue; }
    if (src[j] === '`') break;
    j++;
  }
  return [start + OPEN.length, j];
}

function sync() {
  const html = fs.readFileSync(HTML, 'utf8');
  const lit = buildLiteral(html);

  let src = fs.readFileSync(AGENT, 'utf8');
  const region = literalRegion(src);
  if (!region) { console.error('✗ const WEB_HTML = ` not found in the agent'); process.exit(1); }
  const before = src.slice(region[0], region[1]);
  if (before === lit) { console.log('✓ WEB_HTML already in sync with dashboard.html'); return; }
  src = src.slice(0, region[0]) + lit + src.slice(region[1]);
  fs.writeFileSync(AGENT, src);
  console.log(`✓ WEB_HTML regenerated from dashboard.html (${lit.length} literal chars)`);
  console.log('  now run: npm run check:dashboard');
}

module.exports = { buildLiteral, literalRegion, HTML, AGENT };
if (require.main === module) sync();
