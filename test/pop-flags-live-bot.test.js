// test/pop-flags-live-bot.test.js — the bot's half of "Mimic reads #popflags from the log" (the guild lead, 2026-10-26:
// "ideally users are able to have that text come through anytime they do it from mimic").
//
// The agent reads the server's `#popflags` output off the member's own eqlog and sends step KEYS (never the text) as
// pop_flag events with source 'popflags'. The bot stores only a closed vocabulary (popFlagStages.POPFLAGS_KEYS),
// each step with the catalog flags it proves, as pop_flags rows with source 'popflags'. This pins the vocabulary to
// what the readers can emit, and the handler's branch to the shape the agent sends. An OLDER bot must skip the same
// event (it arrives as an empty-text recital), which is checked against the real resolveStage.
//
// Run: npx vitest run test/pop-flags-live-bot.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';
import { parsePopFlags, STAGE_TABLES } from '../web/lib/popFlagsPaste.ts';

const require = createRequire(import.meta.url);
const S = require(path.join(ROOT, 'utils', 'popFlagStages.js'));
const bot = readSource(path.join(ROOT, 'index.js'));

describe('the closed vocabulary', () => {
  it('holds every step the web reader can write from a #popflags paste, so none is dropped on the way in', () => {
    const fixture = fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'popflags-output.txt'), 'utf8');
    const lines = [fixture];
    for (const t of STAGE_TABLES) t.texts.forEach(x => lines.push(`${t.label}: ${x}`));
    lines.push('Plane of Time access: Unlocked', 'Air, Earth, and Water access: Unlocked', 'Plane of Fire access: Unlocked',
      'Plane of Earth B access: Unlocked', 'Factory door access: Unlocked', 'Lower Crypt access: Unlocked',
      'Cipher information: Received', 'Zebuxoruk lore: Received', 'Combined Zek information: Received',
      'Final elemental information: Received', 'Askr and Karana progression: Complete; combined into Zebuxoruk lore');
    const emitted = new Set(parsePopFlags(lines.join('\n')).flags);
    expect(emitted.size).toBeGreaterThan(30);
    for (const k of emitted) expect(S.POPFLAGS_KEYS.has(k), k).toBe(true);
  });
  it('never holds a checklist memory (cl_*) or a made-up key', () => {
    for (const k of S.POPFLAGS_KEYS) expect(k.startsWith('cl_'), k).toBe(false);
    for (const k of ['unmapped', 'hail', 'quarm_dead', 'grummus_dead', '__proto__', 'zeks_5', 'thelin_5']) expect(S.POPFLAGS_KEYS.has(k), k).toBe(false);
  });
});

describe('the handler (stripped source)', () => {
  const fn = stripJs(sliceBlock(bot, 'async function _handleAgentPopFlags(req, res) {', '\n}\n'));
  it('stores a popflags event as source popflags, step by step, only from the closed vocabulary, with what each proves', () => {
    expect(fn).toMatch(/if \(e\.source === 'popflags'\) \{/);
    expect(fn).toMatch(/Array\.isArray\(e\.stages\) \? e\.stages\.slice\(0, 16\) : \[\]/);
    expect(fn).toMatch(/if \(!popFlagStages\.POPFLAGS_KEYS\.has\(st\)\) continue;/);
    expect(fn).toMatch(/push\(e, iso, st, \{ source: 'popflags', stage: st \}\);/);
    expect(fn).toMatch(/popFlagStages\.STAGE_IMPLIES\[st\] \|\| \[\]/);
  });
  it('comes before the boss-map fallback, and never reaches it: a popflags event can never be stored as "unmapped"', () => {
    const at = fn.indexOf("e.source === 'popflags'");
    const unmapped = fn.indexOf("'unmapped'");
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(unmapped);
    const branch = fn.slice(at, fn.indexOf('const bossLower'));
    expect(branch).toMatch(/\bcontinue;\s*\}\s*$/);
  });
  it('an older bot skips the same event: it is an empty-text recital, which resolves to nothing and is not stored', () => {
    const ev = { character: 'Aldenmar', ts: '2026-10-26T21:10:01.000Z', kind: 'recital', source: 'popflags', text: null, stages: ['mavuin_3'] };
    expect(S.resolveStage(ev, '')).toBeNull();
    // …and the older handler's line for that case:
    expect(stripJs(bot)).toMatch(/if \(e\.kind === 'recital' \|\| e\.kind === 'trial'\) continue;/);
  });
  it('the hail board opens windows only from event/checklist rows, so a popflags row can never open one', () => {
    const hb = stripJs(fs.readFileSync(path.join(ROOT, 'utils', 'hailBoard.js'), 'utf8'));
    expect(hb).toMatch(/r\.source === 'event' \|\| r\.source === 'checklist'/);
    expect(hb).not.toMatch(/'popflags'/);
  });
});
