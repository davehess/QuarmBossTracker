#!/usr/bin/env node
// Reads decision entries out of dated decision logs (docs/DECISIONS-*.md, or the inbox files under
// docs/decisions/inbox/) and prints them as JSON: [{ id, title, date, from, body }].
//   node scripts/decisions/extract.js docs/DECISIONS-*.md > entries.json
// An entry is a "## " or "### " heading; in the numbered log only "N." / "Na." headings start one, so the
// sub-headings inside an entry stay in its body. The "Open — read this first" table is not an entry.
'use strict';
const fs = require('fs');
const path = require('path');

function fileDate(file) {
  const m = /(\d{4}-\d{2}-\d{2})/.exec(path.basename(file));
  return m ? m[1] : null;
}

function extract(file, { numbered: forceNumbered = false } = {}) {
  const text = fs.readFileSync(file, 'utf8').replace(/\r/g, '');
  const lines = text.split('\n');
  const numbered = forceNumbered || (text.match(/^#{2,3} \d+[a-z]?\. /gm) || []).length > 5;
  const startRx = numbered ? /^(#{2,3}) (\d+[a-z]?)\. (.*)$/ : /^(##) ()(.*)$/;
  const fdate = fileDate(file);
  const out = [];
  let cur = null;
  let seq = 0;
  let skip = false;
  for (const line of lines) {
    const isOpen = /^#{2,3} Open\b/.test(line);
    const m = isOpen ? null : startRx.exec(line);
    if (m || isOpen || (numbered && /^## /.test(line) && !m)) {
      if (cur) out.push(cur);
      cur = null;
      skip = isOpen || !m;
      if (m) {
        seq += 1;
        const title = m[3].trim();
        const d = /\((\d{4}-\d{2}-\d{2})/.exec(title);
        cur = {
          num: m[2] || null,
          title,
          date: (d && d[1]) || fdate,
          from: path.relative(process.cwd(), file),
          seq,
          body: [],
        };
      }
      continue;
    }
    if (cur && !skip) cur.body.push(line);
  }
  if (cur) out.push(cur);
  return out.map(e => ({ ...e, body: e.body.join('\n').trim() }));
}

function assignIds(entries) {
  const seen = new Map();
  for (const e of entries) {
    // "§N" is the running number the code and docs cite: the 2026-09-21 log and the inbox that continues it.
    // Older logs (numbered or not) are cited by file, so they keep "<date>/<n>".
    const canonical = /DECISIONS-2026-09-21\.md$|[\\/]inbox[\\/]/.test(e.from);
    let id;
    if (e.num && canonical) id = '§' + e.num;
    else id = fileDate(e.from) + '/' + (e.num || e.seq);
    const n = (seen.get(id) || 0) + 1;
    seen.set(id, n);
    e.id = n > 1 ? `${id}~${n}` : id; // the numbered log reused a few numbers
    delete e.num;
    delete e.seq;
  }
  return entries;
}

if (require.main === module) {
  const files = process.argv.slice(2).sort();
  const all = assignIds(files.flatMap(extract));
  process.stdout.write(JSON.stringify(all, null, 1) + '\n');
}

module.exports = { extract, assignIds };
