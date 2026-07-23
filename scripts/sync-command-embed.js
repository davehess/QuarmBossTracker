#!/usr/bin/env node
// scripts/sync-command-embed.js
//
// #65 Hot-servable overlays — single-source-of-truth sync tool.
//
// apps/mimic/command.html is AUTHORITATIVE. The agent serves a byte-exact
// embedded copy (const COMMAND_HTML) at GET /overlay/command so the Command
// Center overlay rides agent hot-swaps. This script regenerates that embed
// from the file. Edit command.html, then run:
//
//     node scripts/sync-command-embed.js
//
// scripts/check-agent-dashboard.js (npm run check:dashboard) FAILS the build
// if the embed drifts from the file — this script is how you fix that failure.
//
// command.html must contain NO backtick, ${...}, or backslash so the embed is
// a verbatim template literal (zero escaping). The script refuses to run if
// that assumption is ever broken (the escape-hazard would make the embed a
// non-byte-exact copy and defeat the drift checker).

const fs = require('fs');
const path = require('path');

const AGENT = path.join(__dirname, '..', 'packages', 'wolfpack-logsync', 'index.js');
const CMD   = path.join(__dirname, '..', 'apps', 'mimic', 'command.html');

const cmd = fs.readFileSync(CMD, 'utf8');
if (cmd.includes('`') || cmd.includes('${') || cmd.includes('\\')) {
  console.error('✗ command.html contains a backtick, ${...} or backslash.');
  console.error('  The verbatim-embed design requires none of these. Either remove');
  console.error('  them from command.html, or switch COMMAND_HTML to an escaped');
  console.error('  embed AND update this sync tool + the drift checker to match.');
  process.exit(1);
}

let src = fs.readFileSync(AGENT, 'utf8');
const OPEN = 'const COMMAND_HTML = `';
const start = src.indexOf(OPEN);
if (start < 0) {
  console.error('✗ Could not find `const COMMAND_HTML = \\`` in the agent source.');
  process.exit(1);
}
const contentStart = start + OPEN.length;
// The embedded content has no backtick, so the very next backtick closes it.
const contentEnd = src.indexOf('`', contentStart);
if (contentEnd < 0) {
  console.error('✗ Could not find the closing backtick of COMMAND_HTML.');
  process.exit(1);
}

const before = src.slice(0, contentStart);
const after  = src.slice(contentEnd); // starts at the closing backtick
const current = src.slice(contentStart, contentEnd);

if (current === cmd) {
  console.log('✓ COMMAND_HTML already matches command.html — nothing to do.');
  process.exit(0);
}

fs.writeFileSync(AGENT, before + cmd + after);
console.log('✓ Re-synced COMMAND_HTML from command.html (' + cmd.length + ' chars).');
console.log('  Run: node --check packages/wolfpack-logsync/index.js && npm run check:dashboard');
