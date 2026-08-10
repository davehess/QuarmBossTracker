// triggerScanner.js — Locate GINA + EQ Log Parser (EQLP) installations on the
// local machine and report what trigger files they hold. (Uilnayar 2026-06-26
// — v1.1.1 foundation: take advantage of the fact that the agent already runs
// on each raider's machine to discover their existing trigger setup, rather
// than asking them to upload an XML file.)
//
// This module does DISCOVERY ONLY. It returns paths, sizes, modified times,
// and a coarse pack-signature fingerprint ("looks like Safe Space"); it does
// NOT parse trigger XML, ingest anything to the bot, or do anything with the
// found triggers. Later betas (1.1.2 = parse + preview, 1.1.3 = import,
// 1.1.4 = log-correlation observations) layer on top.
//
// Privacy stance: results are returned to the LOCAL Mimic dashboard only.
// Nothing is uploaded to the bot from this module. Membership in any pack
// (Safe Space, etc.) is inferred from trigger NAMES — never from chat or
// social regexes.

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// Folders to probe in priority order. Each entry is a function that returns
// candidate absolute paths to search (an array — so we can probe several
// locations per app on the same OS).
//
// GINA:
//   - %LocalAppData%\GINA\               (modern installs — TriggerLibrary.xml + Sounds\)
//   - %AppData%\GamParse\                (older installs that piggybacked on GamParse)
// EQLP (EQLogParser):
//   - %LocalAppData%\EQLogParser\        (default install)
//   - <EQ folder>\EQLogParser\           (sometimes installed under EQ)
//   - %UserProfile%\Documents\EQLogParser\
function _winRoots() {
  const out = [];
  const localAppData = process.env.LOCALAPPDATA || (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Local') : null);
  const roamingAppData = process.env.APPDATA   || (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Roaming') : null);
  const userProfile    = process.env.USERPROFILE || os.homedir();
  if (localAppData)   out.push({ kind: 'gina', root: path.join(localAppData, 'GINA') });
  if (roamingAppData) out.push({ kind: 'gina', root: path.join(roamingAppData, 'GamParse') });
  if (localAppData)   out.push({ kind: 'eqlp', root: path.join(localAppData, 'EQLogParser') });
  if (userProfile)    out.push({ kind: 'eqlp', root: path.join(userProfile, 'Documents', 'EQLogParser') });
  return out;
}
// macOS / Linux (rare — but doesn't hurt to probe ~/.config + ~/Documents).
function _posixRoots() {
  const home = os.homedir();
  if (!home) return [];
  return [
    { kind: 'gina', root: path.join(home, '.local', 'share', 'GINA') },
    { kind: 'gina', root: path.join(home, 'Documents', 'GINA') },
    { kind: 'eqlp', root: path.join(home, '.config', 'EQLogParser') },
    { kind: 'eqlp', root: path.join(home, 'Documents', 'EQLogParser') },
  ];
}
function _candidateRoots() {
  return process.platform === 'win32' ? _winRoots() : _posixRoots();
}

// Recursively walk a directory looking for trigger files. We hard-stop at a
// shallow depth and a small file-count cap because some users have *huge* GINA
// directories (every test pack they've ever tried). The cap is generous enough
// to capture a working library but won't iterate forever on a misconfigured
// install. Audio files are NOT returned by this scan — they're listed by name
// only (the parse step later in 1.1.2 will resolve those references).
const MAX_DEPTH = 4;
const MAX_FILES = 400;
const TRIGGER_EXT_RX = /\.(gtp|xml|gxml|eqltp|eqlpb|json)$/i;

function _statSafe(p) { try { return fs.statSync(p); } catch { return null; } }
function _readdirSafe(p) { try { return fs.readdirSync(p); } catch { return []; } }

function _walk(root, kind, out, depth = 0) {
  if (out.length >= MAX_FILES) return;
  if (depth > MAX_DEPTH) return;
  const entries = _readdirSafe(root);
  for (const name of entries) {
    if (out.length >= MAX_FILES) return;
    if (name.startsWith('.')) continue;
    const p = path.join(root, name);
    const st = _statSafe(p);
    if (!st) continue;
    if (st.isDirectory()) {
      // Audio / Sounds subdirs are uninteresting for the scanner step —
      // skip to avoid wasting the budget. The audio import step will revisit.
      if (/^(Sounds|Audio|Media|Cache|Backups?)$/i.test(name)) continue;
      _walk(p, kind, out, depth + 1);
    } else if (st.isFile() && TRIGGER_EXT_RX.test(name)) {
      out.push({
        kind,
        path: p,
        name,
        size: st.size,
        modified: new Date(st.mtimeMs || st.mtime).toISOString(),
      });
    }
  }
}

// Coarse pack-fingerprint: read just the first ~16KB of each file and look
// for telltale strings. Cheap to do, useful for the Mimic settings card to
// say "looks like Safe Space v3" without parsing the XML.
const PACK_SIGNATURES = [
  { name: 'Safe Space',       rx: /\bsafe[\s_-]?space\b/i },
  { name: 'Goonsquad',        rx: /\bgoonsquad\b/i },
  { name: 'Bardtholemu',      rx: /\bbardtholemu\b/i },           // observed from custom packs
  { name: 'EQ Watcher',       rx: /\beqwatcher\b/i },
  { name: 'GINA default',     rx: /\bginadefaults?\b/i },
  // The Quarm-flavoured triggers everyone copies from /admin/triggers tend
  // to mention common boss names; not a pack signature per se, but useful.
  { name: 'Wolf Pack guild',  rx: /\bwolfpack\b|\bwolf[\s_-]?pack\b/i },
];

function _packFingerprint(filePath) {
  let buf;
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      buf = Buffer.alloc(16 * 1024);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      buf = buf.slice(0, n);
    } finally { fs.closeSync(fd); }
  } catch { return []; }
  const txt = buf.toString('utf8');
  const hits = [];
  for (const s of PACK_SIGNATURES) if (s.rx.test(txt)) hits.push(s.name);
  return hits;
}

// Public: run the scan + return everything we found, formatted for the
// dashboard. Always returns the same shape so the UI can render gracefully
// even when nothing was found.
function scanLocalTriggers() {
  const startMs = Date.now();
  const platform = process.platform;
  const roots = _candidateRoots();
  const sources = []; // one entry per kind (gina, eqlp) that we DETECTED

  // Group probed paths by kind so 'gina' has one consolidated entry even when
  // we probed multiple candidate roots (LocalAppData + Roaming, etc.).
  const byKind = new Map();
  for (const cand of roots) {
    const exists = !!_statSafe(cand.root);
    if (!byKind.has(cand.kind)) byKind.set(cand.kind, { kind: cand.kind, probed: [], detectedRoot: null, files: [] });
    const entry = byKind.get(cand.kind);
    entry.probed.push({ path: cand.root, exists });
    if (exists && !entry.detectedRoot) entry.detectedRoot = cand.root;
  }
  for (const entry of byKind.values()) {
    if (entry.detectedRoot) _walk(entry.detectedRoot, entry.kind, entry.files);
    // Fingerprint pass — coarse pack guess across the first N files.
    const packsSeen = new Set();
    for (const f of entry.files.slice(0, 40)) {
      for (const p of _packFingerprint(f.path)) packsSeen.add(p);
    }
    sources.push({
      kind:           entry.kind,
      detectedRoot:   entry.detectedRoot,
      probed:         entry.probed,
      fileCount:      entry.files.length,
      packsDetected:  [...packsSeen].sort(),
      // First 50 files only — the dashboard shows a preview, not a dump.
      // Heaviest first so the user sees the meaty trigger libraries on top.
      files:          entry.files.slice().sort((a, b) => b.size - a.size).slice(0, 50),
      truncated:      entry.files.length >= MAX_FILES,
    });
  }
  return {
    ok:        true,
    platform,
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - startMs,
    sources,
    // Convenience summary so the Mimic card can render a one-line headline
    // without doing arithmetic in JS.
    summary: sources.reduce((s, src) => ({
      totalFiles:    s.totalFiles + src.fileCount,
      sourcesFound:  s.sourcesFound + (src.detectedRoot ? 1 : 0),
      packsDetected: [...new Set([...s.packsDetected, ...src.packsDetected])],
    }), { totalFiles: 0, sourcesFound: 0, packsDetected: [] }),
  };
}

module.exports = { scanLocalTriggers };
