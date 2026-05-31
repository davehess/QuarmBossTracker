// scripts/stage-agent.js — copy the wolfpack-logsync agent into staged-agent/
// so electron-builder's extraResources can bundle it. Runs on `npm install`
// (postinstall) and is safe to run repeatedly. Keeps a single source of truth:
// the agent lives in packages/wolfpack-logsync/, NOT duplicated in git here.
//
// In dev (`npm start`) main.js points straight at the repo's agent; this
// staging copy only matters for the packaged build.
'use strict';
const fs   = require('fs');
const path = require('path');

const repoRoot  = path.resolve(__dirname, '..', '..', '..');
const agentSrc  = path.join(repoRoot, 'packages', 'wolfpack-logsync');
const stageDir  = path.join(__dirname, '..', 'staged-agent');

const FILES = ['index.js', 'supervisor.js', 'package.json'];

function main() {
  if (!fs.existsSync(agentSrc)) {
    console.error('[stage-agent] agent source not found at', agentSrc);
    console.error('[stage-agent] (expected to run inside the QuarmBossTracker monorepo)');
    process.exit(0); // don't hard-fail npm install in unusual layouts
  }
  fs.mkdirSync(stageDir, { recursive: true });
  for (const f of FILES) {
    const src = path.join(agentSrc, f);
    if (!fs.existsSync(src)) { console.warn('[stage-agent] missing', f); continue; }
    fs.copyFileSync(src, path.join(stageDir, f));
    console.log('[stage-agent] staged', f);
  }
  console.log('[stage-agent] done →', stageDir);
}
main();
