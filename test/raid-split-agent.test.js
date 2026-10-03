// test/raid-split-agent.test.js — Mimic's side of two raids at once (DECISIONS §124).
//
// The guild lead, 2026-10-01: "extended Target, buff queue, the in-mimic raid dashboard and the
// wolfpack.quest raid page should reflect that." The bot scopes the queues and names the raids
// ({ key, leader, size, mine }) on the buff-queue and Extended Target payloads, and only when there
// are two or more; the agent remembers that for the Command Center, and each overlay says whose
// raid it is showing. With one raid nothing new renders.
//
// Run: npx vitest run test/raid-split-agent.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, AGENT_INDEX, ROOT, stripJs } from './_source-slice.js';

const AGENT = readSource(AGENT_INDEX);
const read = (p) => readSource(path.join(ROOT, p));

describe('the agent remembers which raids the bot named', () => {
  const block = sliceBlock(AGENT, 'let _raidSplitSeen = { at: 0, raids: null };', '? _raidSplitSeen.raids : null;\n}');
  const fns = () => evalBlock(block, ['_noteRaidSplit', '_raidSplitNow']);
  const two = [{ key: 'aldenmar', leader: 'Aldenmar', size: 26, mine: true }, { key: 'nyssara', leader: 'Nyssara', size: 16, mine: false }];

  it('two raids on a payload are remembered for a minute', () => {
    const { _noteRaidSplit, _raidSplitNow } = fns();
    _noteRaidSplit({ buff_queue: [], raids: two });
    expect(_raidSplitNow(Date.now())).toEqual(two);
    expect(_raidSplitNow(Date.now() + 61_000)).toBe(null);
  });
  it('a payload without them (one raid) clears it; an error payload leaves it alone', () => {
    const { _noteRaidSplit, _raidSplitNow } = fns();
    _noteRaidSplit({ targets: [], raids: two });
    _noteRaidSplit({ error: 'internal error' });
    expect(_raidSplitNow(Date.now())).toEqual(two);
    _noteRaidSplit({ targets: [] });
    expect(_raidSplitNow(Date.now())).toBe(null);
  });
  it('both proxies feed it', () => {
    expect(AGENT).toMatch(/_buffQueueCache\.set\(key, \{ at: Date\.now\(\), payload: j \}\); _noteRaidSplit\(j\);/);
    expect(AGENT).toMatch(/_extTargetCache\.set\(key, \{ at: Date\.now\(\), payload: j \}\); _noteRaidSplit\(j\);/);
  });
});

describe('the Command Center keeps to this raid', () => {
  const src = stripJs(AGENT);
  it('the guild-wide priest mana list is cut to this Mimic\'s raid window only while two raids run', () => {
    expect(src).toMatch(/const _ownRaidOnly = !!_raidSplitNow\(nowMs\) && _raidRosterMembers\.size > 0 &&/);
    expect(src).toMatch(/if \(_ownRaidOnly && !_raidRosterMembers\.has\(String\(h\.name \|\| ''\)\.toLowerCase\(\)\)\) continue;/);
  });
  it('its state names the raids only when there are two or more', () => {
    expect(src).toMatch(/bqCached\.payload\.raids\.length > 1\)\s*\? bqCached\.payload\.raids : undefined,/);
    expect(stripJs(read('apps/mimic/command.html'))).toMatch(/if \(s\.raids && s\.raids\.length > 1\) html \+= raidsNoteHtml\(s\.raids\);/);
  });
});

// The guild lead, 2026-10-03: "command center could use raid overview information (raid leaders
// and player counts) for when we have multiple raids going." One row per raid, yours first.
describe('Command Center: a Raids card with each leader and player count', () => {
  const cmd = read('apps/mimic/command.html');
  const block = sliceBlock(cmd, 'function raidsNoteHtml(raids){', "return h + '</div>';\n  }");
  const collapsed = {};
  const stubs = "var esc = function(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;'); };"
    + "var _isCollapsed = function(k){ return !!collapsed[k]; };"
    + "var secToggle = function(k, label){ return '[' + label + ']'; };";
  const { raidsNoteHtml } = new Function('collapsed', stubs + block + '\nreturn { raidsNoteHtml };')(collapsed);
  const raids = [
    { key: 'a', leader: 'Aldenmar', size: 9, mine: false },
    { key: 'b', leader: 'Brackwyn', size: 33, mine: false },
    { key: 'c', leader: 'Corvale', size: 8, mine: true },
  ];

  it('lists every raid with its leader and count, yours first then the biggest', () => {
    const h = raidsNoteHtml(raids);
    expect(h).toContain('[⚔ 3 raids · 50 players]');
    const order = ['Corvale', 'Brackwyn', 'Aldenmar'].map((n) => h.indexOf('👑 ' + n));
    expect(order.every((i) => i > 0)).toBe(true);
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
    expect(h).toMatch(/👑 Brackwyn<\/span><b class="cnt">33<\/b>/);
    expect(h).toMatch(/class="row mine"><span class="nm">👑 Corvale<\/span><span class="yours">yours<\/span><b class="cnt">8<\/b>/);
    expect(h.match(/yours<\/span>/g)).toHaveLength(1);
  });

  it('collapsed, it keeps the totals in the header and drops the rows', () => {
    collapsed.raids = true;
    const h = raidsNoteHtml(raids);
    collapsed.raids = false;
    expect(h).toContain('[⚔ 3 raids · 50 players]');
    expect(h).not.toContain('👑');
  });

  it('a leader name is escaped', () => {
    expect(raidsNoteHtml([{ leader: '<b>', size: 1, mine: true }, { leader: 'x', size: 2 }])).toContain('👑 &lt;b>');
  });
});

describe('each surface says whose raid it shows, and only with two or more', () => {
  it('Extended Target', () => {
    const s = stripJs(read('apps/mimic/extarget.html'));
    expect(s).toMatch(/var raids = \(payload && Array\.isArray\(payload\.raids\) && payload\.raids\.length > 1\) \? payload\.raids : null;/);
    expect(s).toMatch(/if \(raids\) h \+= /);
  });
  it('Buff queue (not in mini mode)', () => {
    const s = stripJs(read('apps/mimic/buffqueue.html'));
    expect(s).toMatch(/if \(html && raids && !document\.body\.classList\.contains\('wp-mini'\)\) \{/);
  });
  it('the dashboard Raid tab, whose crowns now read Zeal\'s rank text', () => {
    const dash = read('packages/wolfpack-logsync/dashboard.html');
    const { _isRaidLeadRank, _isGroupLeadRank } = evalBlock(
      sliceBlock(dash, 'function _isRaidLeadRank(r)', '\nfunction renderRaidTab(q) {').replace(/\nfunction renderRaidTab\(q\) \{$/, ''),
      ['_isRaidLeadRank', '_isGroupLeadRank'],
    );
    expect(_isRaidLeadRank('Raid Leader')).toBe(true);
    expect(_isRaidLeadRank('2')).toBe(true);
    expect(_isRaidLeadRank('Group Leader')).toBe(false);
    expect(_isGroupLeadRank('Group Leader')).toBe(true);
    const s = stripJs(dash);
    expect(s).not.toMatch(/m\.rank === '2'/);
    expect(s).toMatch(/var raids = \(q && Array\.isArray\(q\.raids\) && q\.raids\.length > 1\) \? q\.raids : null;/);
  });
});
