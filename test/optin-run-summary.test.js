// An opt-in log parse ends with ONE signal to the bot, which posts one PvP note for the whole run
// instead of one message per old kill (the guild lead, 2026-09-27: "when parsing through old logs
// make sure we're not posting in the channels for it each time … a note in pvp that the @user's
// opt-in log parse found N new pvp kills and assists and total them out per guildie").
//
// Run: npx vitest run test/optin-run-summary.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, stripJs, AGENT_INDEX } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
const tail = sliceBlock(src, '  if (!whoOnly && runJobs.length > 0) {', '    }).catch(() => {});\n  }');

function run({ jobs, whoOnly = false, dryRun = false, buffered = [] }) {
  const calls = [];
  const pvpAssistBuffer = buffered.slice();
  new Function('whoOnly', 'runJobs', 'pvpAssistBuffer', 'uploadPvpAssists', '_uploadOpts', 'botUrl', 'token', 'dryRun',
    'enqueueUpload', 'AGENT_VERSION', 'runStartedAt', tail)(
    whoOnly, jobs, pvpAssistBuffer, (list) => calls.push(['assists', list.length]), { dryRun }, 'u', 't', dryRun,
    (kind, body) => calls.push([kind, body]), '3.7.30', '2026-09-27T02:00:00.000Z');
  return { calls, pvpAssistBuffer };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('the end of an opt-in run', () => {
  it('waits for every file, flushes the buffered assists, then sends one summary signal', async () => {
    let finish;
    const slow = new Promise((r) => { finish = r; });
    const { calls, pvpAssistBuffer } = run({ jobs: [Promise.resolve(), slow], buffered: [{}, {}] });
    await settle();
    expect(calls).toEqual([]);                       // one file still running
    finish(); await settle(); await settle();
    expect(calls).toEqual([
      ['assists', 2],
      ['optin_summary', { agent_version: '3.7.30', backfill: true, started_at: '2026-09-27T02:00:00.000Z' }],
    ]);
    expect(pvpAssistBuffer).toEqual([]);
  });
  it('a file that failed still ends the run', async () => {
    const { calls } = run({ jobs: [Promise.reject(new Error('x')).catch(() => { throw new Error('y'); })] });
    await settle(); await settle();
    expect(calls.map(c => c[0])).toEqual(['optin_summary']);
  });
  it('a /who-only rescan uploads no PvP, so it sends nothing', async () => {
    const { calls } = run({ jobs: [Promise.resolve()], whoOnly: true });
    await settle(); await settle();
    expect(calls).toEqual([]);
  });
  it('a dry run flushes locally but tells the bot nothing', async () => {
    const { calls } = run({ jobs: [Promise.resolve()], dryRun: true, buffered: [{}] });
    await settle(); await settle();
    expect(calls).toEqual([['assists', 1]]);
  });
  it('every file of the run is a job, stamped with when the run began, and the signal has a route', () => {
    const s = stripJs(src);
    expect(s).toMatch(/const runStartedAt = new Date\(\)\.toISOString\(\);\s*const runJobs = \[\];/);
    expect(s).toMatch(/runJobs\.push\(\(async \(\) => \{\s*const stored\s*= _optinState\.progress\[f\.path\];/);
    expect(s).toMatch(/case 'optin_summary':\s*return base \+ '\/optin_summary';/);
  });
});
