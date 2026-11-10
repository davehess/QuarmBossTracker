// test/opendkp-levels.test.js — the /who -> OpenDKP level planner, the update call's
// request shape, and the officer-gated command. Names are invented placeholders.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const https = require('node:https');
const { planLevelUpdates, buildUpdateRecord } = require('../utils/opendkpLevels.js');
const opendkp = require('../utils/opendkp.js');

const NOW = Date.parse('2026-11-10T12:00:00Z');
const DAY = 86400000;
const iso = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString();
const row = (over = {}) => ({
  ClientId: 'abc', CharacterId: 1, AssociatedId: -1, Active: 1, Name: 'Aldenmar', Rank: 'Raid Alt',
  Class: 'Rogue', Level: 58, Race: 'Halfling', Gender: 'Male', Guild: '',
  MainChange: '0001-01-01T00:00:00Z', Deleted: 0, User: 'someone', CreatedDate: '0001-01-01T00:00:00', ...over,
});
const seen = (o) => new Map(Object.entries(o));

describe('planLevelUpdates', () => {
  it('raises only upward, reports lower, counts same and unseen', () => {
    const roster = [
      row({ CharacterId: 1, Name: 'Aldenmar', Level: 58 }),
      row({ CharacterId: 2, Name: 'Brackwyn', Level: 60 }),
      row({ CharacterId: 3, Name: 'Corvale', Level: 60 }),
      row({ CharacterId: 4, Name: 'Rethlan', Level: 50 }),
    ];
    const p = planLevelUpdates(roster, seen({
      aldenmar: { level: 60, seenAt: iso(3) },
      brackwyn: { level: 55, seenAt: iso(3) },
      corvale: { level: 60, seenAt: iso(3) },
    }), NOW);
    expect(p.raise.map(e => [e.name, e.from, e.to])).toEqual([['Aldenmar', 58, 60]]);
    expect(p.lower.map(e => [e.name, e.from, e.to])).toEqual([['Brackwyn', 60, 55]]);
    expect(p.same).toBe(1);
    expect(p.unseen).toBe(1);
  });

  it('matches names case-insensitively', () => {
    const p = planLevelUpdates([row({ Name: 'ALDENMAR' })], seen({ aldenmar: { level: 60, seenAt: iso(1) } }), NOW);
    expect(p.raise).toHaveLength(1);
  });

  it('ignores observations older than 180 days', () => {
    const p = planLevelUpdates([row()], seen({ aldenmar: { level: 60, seenAt: iso(181) } }), NOW);
    expect(p.raise).toHaveLength(0);
    expect(p.skipped.stale).toBe(1);
    const q = planLevelUpdates([row()], seen({ aldenmar: { level: 60, seenAt: iso(179) } }), NOW);
    expect(q.raise).toHaveLength(1);
  });

  it('skips deleted rows and levels outside 1..65', () => {
    const roster = [
      row({ CharacterId: 1, Name: 'Aldenmar', Deleted: 1 }),
      row({ CharacterId: 2, Name: 'Brackwyn' }),
      row({ CharacterId: 3, Name: 'Corvale' }),
    ];
    const p = planLevelUpdates(roster, seen({
      aldenmar: { level: 60, seenAt: iso(1) },
      brackwyn: { level: 66, seenAt: iso(1) },
      corvale: { level: 0, seenAt: iso(1) },
    }), NOW);
    expect(p.raise).toHaveLength(0);
    expect(p.skipped).toMatchObject({ deleted: 1, badLevel: 2 });
  });

  it('sends back the whole row with only Level changed', () => {
    const r = row();
    const sent = buildUpdateRecord(r, 60);
    expect(sent).toEqual({ ...r, Level: 60 });
    expect(Object.keys(sent)).toEqual(Object.keys(r));
    expect(r.Level).toBe(58);   // input not mutated
  });
});

describe('updateCharacter request shape', () => {
  let calls;
  beforeEach(() => {
    calls = [];
    process.env.OPENDKP_COGNITO_CLIENT_ID = 'x'; process.env.OPENDKP_USERNAME = 'u'; process.env.OPENDKP_PASSWORD = 'p';
    delete process.env.OPENDKP_HALT;
    vi.spyOn(https, 'request').mockImplementation((options, cb) => {
      const req = new EventEmitter();
      let body = '';
      req.write = (c) => { body += c; };
      req.end = () => {
        calls.push({ options, body });
        const res = new EventEmitter(); res.statusCode = 200;
        cb(res);
        const payload = options.hostname.includes('cognito')
          ? { AuthenticationResult: { IdToken: 'tok', ExpiresIn: 3600 } } : { ok: true };
        res.emit('data', JSON.stringify(payload)); res.emit('end');
      };
      return req;
    });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('POSTs the whole record to /characters/<id> with Bearer auth', async () => {
    const rec = buildUpdateRecord(row({ CharacterId: 123456 }), 60);
    await opendkp.updateCharacter(123456, rec);
    const c = calls[calls.length - 1];
    expect(c.options.method).toBe('POST');
    expect(c.options.path).toMatch(/\/clients\/[^/]+\/characters\/123456$/);
    expect(c.options.headers.Authorization).toMatch(/^Bearer /);
    expect(c.options.headers['Content-Length']).toBe(Buffer.byteLength(c.body));
    expect(JSON.parse(c.body)).toEqual(rec);
  });

  it('refuses a record whose CharacterId differs', async () => {
    await expect(opendkp.updateCharacter(9, row({ CharacterId: 10 }))).rejects.toThrow(/CharacterId/);
    expect(calls).toHaveLength(0);
  });
});

describe('/opendkplevels command', () => {
  const cmd = require('../commands/opendkplevels.js');
  it('builds with a short description', () => {
    const j = cmd.data.toJSON();
    expect(j.name).toBe('opendkplevels');
    expect(j.description.length).toBeLessThanOrEqual(100);
  });
  it('turns a non-officer away before touching anything', async () => {
    const reply = vi.fn();
    await cmd.execute({ member: { roles: { cache: { some: () => false } } }, reply });
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply.mock.calls[0][0].content).toMatch(/Only officers/);
  });
});
