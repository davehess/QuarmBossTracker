#!/usr/bin/env node
// scripts/update-golden.js  —  regenerate the #75 golden-log expectations.
//
//   npm run golden:update          rewrite the expectation files
//   npm run golden:update -- --check   print the diff-relevant summary, write nothing
//
// The golden log is a CHARACTERIZATION fixture: it records what the shipped
// agent parser does today so any change to that behavior shows up as a review-
// able diff instead of reaching 40 raiders on a Sunday night. Which means:
//
//   ⚠ Running this script is how you ACCEPT a behavior change. Never run it to
//     "make the test pass". Run it only after you have decided the new parse is
//     correct, then READ THE DIFF — every changed number is a change in what
//     the raid's parses will say.
//
// The fixtures themselves (test/fixtures/golden/*.log) are hand-written and are
// NOT regenerated here; only the expectation JSON is.

const fs   = require('node:fs');
const path = require('node:path');

const R = require('../test/fixtures/golden/_replay.js');

const DIR = path.join(__dirname, '..', 'test', 'fixtures', 'golden');
const PARSE_OUT     = path.join(DIR, 'expected-parse.json');
const ENCOUNTER_OUT = path.join(DIR, 'expected-encounter.json');

const check = process.argv.includes('--check');

const parse = {};
for (const name of Object.keys(R.LOGS)) parse[name] = R.parseLines(name);

const payloads = R.replayEncounter('raid-pull.log');
if (payloads.length !== 1) {
  console.error(`golden: raid-pull.log flushed ${payloads.length} encounters, expected exactly 1`);
  process.exit(1);
}
const encounter = R.digestEncounter(payloads[0]);

const parseJson     = JSON.stringify(parse, null, 2) + '\n';
const encounterJson = JSON.stringify(encounter, null, 2) + '\n';

function summarize() {
  for (const [name, rows] of Object.entries(parse)) {
    const kept   = rows.filter((r) => r.keep).length;
    const parsed = rows.filter((r) => r.event).length;
    const types  = [...new Set(rows.filter((r) => r.event).map((r) => r.event.type))].sort();
    console.log(`${name}: ${rows.length} lines · ${kept} kept · ${parsed} parsed · ${types.length} families`);
    console.log(`  ${types.join(', ')}`);
  }
  console.log(`raid-pull encounter: boss=${encounter.boss_name} events=${encounter.event_count} ` +
              `dur=${encounter.active_duration_s}s kill_credit=${encounter.kill_credit}`);
}

if (check) {
  summarize();
  const stale = [[PARSE_OUT, parseJson], [ENCOUNTER_OUT, encounterJson]]
    .filter(([p, want]) => !fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== want)
    .map(([p]) => path.basename(p));
  if (stale.length) {
    console.error(`\ngolden: OUT OF DATE → ${stale.join(', ')}  (run: npm run golden:update)`);
    process.exit(1);
  }
  console.log('\ngolden: expectations match the current parser.');
  process.exit(0);
}

fs.writeFileSync(PARSE_OUT, parseJson);
fs.writeFileSync(ENCOUNTER_OUT, encounterJson);
summarize();
console.log(`\nwrote ${path.relative(process.cwd(), PARSE_OUT)}`);
console.log(`wrote ${path.relative(process.cwd(), ENCOUNTER_OUT)}`);
console.log('\n⚠ Review the diff. Every changed number is a change in what the raid sees.');
