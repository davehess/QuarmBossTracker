#!/usr/bin/env node
// scripts/zeal-pipe-peek.js — does the running Zeal put spawn ids on the pipe?
//
// Written to verify CoastalRedwood/Zeal#229 against a locally built Zeal.asi,
// because the PR is unverified: we have no Windows/MSVC x86 environment, so the
// diff was written by reading the source. This is how you tell a build that
// carries the patch from one that doesn't, without guessing.
//
// It reuses apps/mimic/zealPipe.js rather than reimplementing the reader. That
// matters: the pipe is a stream of CONCATENATED JSON objects (not newline
// delimited) and each one wraps its real payload as a JSON STRING in `data`.
// A hand-rolled reader gets both wrong and reports a false "the patch isn't
// working", which would waste a maintainer's time on a bug that isn't there.
//
//   node scripts/zeal-pipe-peek.js [--seconds 12]
//
// Exit 0 = the build carries the patch. 1 = it does not. 2 = couldn't tell.

const { startZealWatch } = require('../apps/mimic/zealPipe.js');

// player.spawn_id is emitted UNCONDITIONALLY by the patch, so it alone decides
// the verdict. target_id and pet_id are omitted by design when you have no
// target or no pet, so their absence proves nothing either way.
const CONDITIONAL = {
  target_id: 'target something and re-run',
  pet_id: 'charm or summon a pet and re-run',
};

function summarize(seen, sawPlayer, pids) {
  const out = [];
  const row = (label, text) => out.push(label.padEnd(20) + text);

  out.push(`connected to eqgame.exe: ${pids.length ? pids.join(', ') : 'none'}`);
  out.push('');
  row('player.spawn_id', seen.player_spawn_id !== undefined
    ? '✓ ' + seen.player_spawn_id : '✗ not present');
  for (const [key, hint] of Object.entries(CONDITIONAL)) {
    const v = seen['player_' + key];
    row('player.' + key, v !== undefined ? '✓ ' + v : '— not seen (' + hint + ')');
  }
  row('raid[].spawn_id', seen.raid_spawn_id !== undefined
    ? '✓ ' + seen.raid_spawn_id + ' (' + seen.raid_count + ' members)' : '— not seen (not in a raid)');
  row('group[].spawn_id', seen.group_spawn_id !== undefined
    ? '✓ ' + seen.group_spawn_id : '— not seen (not in a group)');
  out.push('');

  if (!sawPlayer) {
    out.push('VERDICT: could not tell — no player message arrived.');
    out.push('  Zeal not loaded, or the pipe is off. In game try: /pipedelay 100');
    return { lines: out, exitCode: 2 };
  }
  if (seen.player_spawn_id === undefined) {
    out.push('VERDICT: this build does NOT carry the patch.');
    out.push('  player messages arrived but had no spawn_id, which the patch always emits.');
    return { lines: out, exitCode: 1 };
  }
  out.push('VERDICT: this build CARRIES the patch. ✓');
  return { lines: out, exitCode: 0 };
}

function main() {
  if (process.platform !== 'win32') {
    console.error('This only works on Windows — it reads the Zeal named pipe of a running eqgame.exe.');
    process.exit(2);
  }
  const argIdx = process.argv.indexOf('--seconds');
  const secs = argIdx > 0 ? Math.max(3, Number(process.argv[argIdx + 1]) || 12) : 12;

  const seen = {};
  let sawPlayer = false;
  const pids = new Set();

  console.log(`Listening to the Zeal pipe for ${secs}s…\n`);

  const watch = startZealWatch({
    onEvent(pid, obj) {
      pids.add(pid);
      let payload;
      try { payload = JSON.parse(obj.data); } catch { return; }   // data is double-encoded
      if (obj.type === 3) {                                        // player
        sawPlayer = true;
        for (const k of ['spawn_id', 'target_id', 'pet_id']) {
          if (payload[k] !== undefined) seen['player_' + k] = payload[k];
        }
      } else if (obj.type === 5 && Array.isArray(payload)) {       // raid
        const withId = payload.filter(m => m && m.spawn_id !== undefined);
        if (withId.length) {
          seen.raid_spawn_id = withId.slice(0, 3).map(m => m.spawn_id).join(', ');
          seen.raid_count = withId.length;
        }
      } else if (obj.type === 6 && Array.isArray(payload)) {       // group
        const withId = payload.filter(m => m && m.spawn_id !== undefined);
        if (withId.length) seen.group_spawn_id = withId.map(m => m.spawn_id).join(', ');
      }
    },
  });

  setTimeout(() => {
    watch.stop();
    const { lines, exitCode } = summarize(seen, sawPlayer, [...pids]);
    console.log(lines.join('\n'));
    process.exit(exitCode);
  }, secs * 1000);
}

if (require.main === module) main();
module.exports = { summarize };
