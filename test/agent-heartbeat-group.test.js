// The reporter heartbeat's group_names (agent _heartbeatGroupNames). The bot's group scope
// (utils/groupScope.js on main) keeps callouts and Extended Target to your group outside a raid, and
// it can only do that if the agent says who the group is (the guild lead, 2026-10-07: "not leaking
// other group's mobs or callouts when we're not in a raid mode"). Runs the real function.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AGENT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'wolfpack-logsync', 'index.js');
const src = fs.readFileSync(AGENT, 'utf8');
const start = src.indexOf('function _heartbeatGroupNames(');
const end = src.indexOf('\nfunction _reporterHeartbeatOnce', start);
// eslint-disable-next-line no-new-func
const groupNames = new Function(src.slice(start, end) + '\nreturn _heartbeatGroupNames;')();

const NOW = 1_000_000_000;
const member = (name) => ({ name, loc: null, hp_current: null });

describe('heartbeat group_names', () => {
  it('names the played character\'s fresh Zeal group, whatever the key casing', () => {
    const zs = { Aldenmar: { updatedAt: NOW - 5000, group_members: [member('Brackwyn'), member('Corvale')] } };
    expect(groupNames(zs, 'aldenmar', NOW)).toEqual(['Brackwyn', 'Corvale']);
  });

  it('a fresh empty group is solo, not unknown', () => {
    expect(groupNames({ Aldenmar: { updatedAt: NOW, group_members: [] } }, 'Aldenmar', NOW)).toEqual([]);
  });

  it('stale, missing or another character\'s state is unknown (undefined, dropped from the JSON)', () => {
    const stale = { Aldenmar: { updatedAt: NOW - 61_000, group_members: [member('Brackwyn')] } };
    expect(groupNames(stale, 'Aldenmar', NOW)).toBeUndefined();
    expect(groupNames({ Aldenmar: { updatedAt: NOW } }, 'Aldenmar', NOW)).toBeUndefined();
    expect(groupNames({ Rethlan: { updatedAt: NOW, group_members: [] } }, 'Aldenmar', NOW)).toBeUndefined();
    expect(groupNames({}, null, NOW)).toBeUndefined();
    expect(JSON.stringify({ a: 1, group_names: undefined })).toBe('{"a":1}');
  });

  it('the heartbeat body carries it', () => {
    const hb = src.slice(src.indexOf('function _reporterHeartbeatOnce('), src.indexOf('function _reporterHeartbeatOnce(') + 6000);
    expect(hb).toMatch(/group_names = _heartbeatGroupNames\(_zealState, live_character \|\| primary, Date\.now\(\)\)/);
    expect(hb).toMatch(/live_character, group_names, client_now/);
  });
});
