// test/upload-freshness.test.js — "when did each upload last arrive" (gear / inventory / spellbook).
//
// The guild lead, 2026-10-31: "add last upload timestamp for spells, inventory, gear". All three bot endpoints
// checksum-dedup and return early on an unchanged file, so the only timestamps they kept meant "last changed". Now
// every accepted upload stamps characters.<x>_checked_at (the unchanged path too) and a real write also stamps
// <x>_synced_at.
//
// The three handlers are EVALUATED here (real source, stubbed collaborators), not text-matched, so a comment cannot
// satisfy them. The migration and the manual web actions are text-asserted over comment-stripped source.
//
// Run: npx vitest run test/upload-freshness.test.js

import { describe, it, expect, vi, afterEach } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, stripJs, stripSql } from './_source-slice.js';
import { latestIso, uploadTimes, describeUpload } from '../web/lib/uploadFreshness.ts';
import { createRequire } from 'node:module';

const wornSets = createRequire(import.meta.url)('../utils/wornSets.js');

const INDEX = readSource(path.join(ROOT, 'index.js'));
const START = INDEX.indexOf('async function _stampCharacterUpload');
const END = INDEX.indexOf('// POST /api/agent/buff_casts');
if (START < 0 || END < START) throw new Error('upload-freshness: handler region markers not found');
const REGION = INDEX.slice(START, END);

// Build the three real handlers around fake collaborators.
function buildHandlers(fake) {
  const factory = new Function(
    'mimicLink', 'require', '_trackUpload', '_dedupeRows', 'wornSets',
    `${REGION}\nreturn { _handleAgentQuarmy, _handleAgentInventory, _handleAgentSpellbook };`,
  );
  return factory(
    { requireAgentAuth: async () => ({ discord_id: 'd1' }) },
    () => fake,
    () => {},
    (rows) => rows,
    wornSets,
  );
}

// A fake supabase helper that records every characters update and serves one characters row.
function fakeSupabase(charRow, { failUpdate = false } = {}) {
  const updates = [];
  const fake = {
    updates,
    isEnabled: () => true,
    select: async (table) => (table === 'characters' ? (charRow ? [charRow] : []) : []),
    update: async (table, q, body) => {
      if (table === 'characters') updates.push({ q, body });
      if (failUpdate) throw new Error('boom');
      return [];
    },
    del: async () => [],
    insert: async (t, rows) => rows,
    upsert: async (t, rows) => rows,
  };
  return fake;
}

async function post(handler, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  const req = { async *[Symbol.asyncIterator]() { yield body; } };
  const out = { status: null, body: null };
  const res = { writeHead: (s) => { out.status = s; }, end: (b) => { out.body = b ? JSON.parse(b) : null; } };
  await handler(req, res);
  return out;
}

const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const merged = (fake) => Object.assign({}, ...fake.updates.map(u => u.body));

afterEach(() => vi.restoreAllMocks());

const CASES = [
  {
    name: 'quarmy', handler: '_handleAgentQuarmy', checksumCol: 'quarmy_checksum',
    checked: 'quarmy_checked_at', synced: 'quarmy_synced_at',
    payload: { character: 'Aldenmar', checksum: 'abc', equipped: [], bags: [], aas: [] },
  },
  {
    name: 'inventory', handler: '_handleAgentInventory', checksumCol: 'inventory_checksum',
    checked: 'inventory_checked_at', synced: 'inventory_synced_at',
    payload: { character: 'Aldenmar', checksum: 'abc', rows: [{ slot_label: 'Charm', item_id: 1, item_name: 'A Thing', quantity: 1 }] },
  },
  {
    name: 'spellbook', handler: '_handleAgentSpellbook', checksumCol: 'spellbook_checksum',
    checked: 'spellbook_checked_at', synced: 'spellbook_synced_at',
    payload: { character: 'Aldenmar', checksum: 'abc', spells: [{ spell_id: 5, spell_name: 'Spark', spell_level: 1 }] },
  },
];

describe.each(CASES)('$name upload stamps the character row', (c) => {
  it('stamps checked_at ONLY (not synced_at) when the file is unchanged', async () => {
    const fake = fakeSupabase({ name: 'Aldenmar', class: 'Wizard', [c.checksumCol]: 'abc' });
    const out = await post(buildHandlers(fake)[c.handler], c.payload);
    expect(out.body).toEqual({ ok: true, skipped: 'unchanged' });
    const patch = merged(fake);
    expect(patch[c.checked]).toMatch(ISO);
    expect(patch).not.toHaveProperty(c.synced);
    expect(fake.updates[0].q).toContain('name=eq.Aldenmar');
  });

  it('stamps both checked_at and synced_at, and the checksum, when the content changed', async () => {
    const fake = fakeSupabase({ name: 'Aldenmar', class: 'Wizard', [c.checksumCol]: 'old' });
    const out = await post(buildHandlers(fake)[c.handler], c.payload);
    expect(out.status).toBe(200);
    expect(out.body.ok).toBe(true);
    const patch = merged(fake);
    expect(patch[c.checked]).toMatch(ISO);
    expect(patch[c.synced]).toMatch(ISO);
    expect(patch[c.checksumCol]).toBe('abc');
  });

  it('stamps a first upload that carries no checksum', async () => {
    const fake = fakeSupabase({ name: 'Aldenmar', class: 'Wizard' });
    const { checksum, ...noSum } = c.payload;
    await post(buildHandlers(fake)[c.handler], noSum);
    const patch = merged(fake);
    expect(patch[c.checked]).toMatch(ISO);
    expect(patch).not.toHaveProperty(c.checksumCol);
  });

  it('writes nothing for an opted-out character', async () => {
    const fake = fakeSupabase({ name: 'Aldenmar', exclude_inventory: true, [c.checksumCol]: 'abc' });
    const out = await post(buildHandlers(fake)[c.handler], c.payload);
    expect(out.body).toEqual({ ok: true, skipped: 'opted_out' });
    expect(fake.updates).toHaveLength(0);
  });

  it('never fails the upload when the timestamp write throws (unchanged and changed paths)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const stored of ['abc', 'old']) {
      const fake = fakeSupabase({ name: 'Aldenmar', class: 'Wizard', [c.checksumCol]: stored }, { failUpdate: true });
      const out = await post(buildHandlers(fake)[c.handler], c.payload);
      expect(out.status).toBe(200);
      expect(out.body.ok).toBe(true);
    }
  });
});

describe('migration 20261031120000', () => {
  const SQL = stripSql(readSource(path.join(ROOT, 'supabase/migrations/20261031120000_character_upload_checked_at.sql')));
  it('adds all five columns with IF NOT EXISTS, as timestamptz', () => {
    for (const col of ['quarmy_checked_at', 'inventory_checked_at', 'spellbook_checked_at', 'inventory_synced_at', 'spellbook_synced_at']) {
      expect(SQL).toMatch(new RegExp(`alter table characters add column if not exists ${col}\\s+timestamptz;`));
    }
    expect(SQL.match(/add column/gi)).toHaveLength(5);
    expect(SQL.match(/add column if not exists/gi)).toHaveLength(5);
  });
  it('backfills only nulls, so a re-run never overwrites a stamp the bot wrote', () => {
    expect(SQL).toMatch(/inventory_synced_at is null/);
    expect(SQL).toMatch(/spellbook_synced_at is null/);
    expect(SQL).toMatch(/lower\(c\.name\) = m\.lname/);
  });
  it('is not destructive', () => {
    expect(SQL).not.toMatch(/\bdrop\b|\bdelete\b|\btruncate\b/i);
  });
});

describe('manual web uploads stamp the same columns', () => {
  const inv = stripJs(readSource(path.join(ROOT, 'web/app/me/inventory-actions.ts')));
  const spl = stripJs(readSource(path.join(ROOT, 'web/app/me/spellbook-actions.ts')));
  it('inventory', () => {
    expect(inv).toMatch(/\.update\(\{ inventory_synced_at: now, inventory_checked_at: now \}\)/);
  });
  it('spellbook', () => {
    expect(spl).toMatch(/\.update\(\{ spellbook_synced_at: now, spellbook_checked_at: now \}\)/);
  });
});

describe('page wiring', () => {
  const page = (p) => stripJs(readSource(path.join(ROOT, 'web/app/character/[name]', p)));
  it('all three pages draw the line', () => {
    for (const p of ['gear/page.tsx', 'inventory/page.tsx', 'spells/page.tsx']) {
      expect(page(p)).toMatch(/<UploadFreshness /);
    }
  });
  it('gear page reads the newest gear row, not gear[0], and drops the date-only "Last sync"', () => {
    const g = page('gear/page.tsx');
    expect(g).toContain('latestIso(...gear.map(g => g.updated_at))');
    expect(g).not.toMatch(/gear\[0\]\?\.updated_at/);
    expect(g).not.toContain('Last sync');
  });
  it('gear page hides the inventory and spells stamps from a viewer who cannot open those pages', () => {
    const g = page('gear/page.tsx');
    expect(g).toMatch(/mayViewInvSpells = officerViewer \|\| ownerViewer \|\| !!char\?\.show_inventory_publicly/);
    expect(g).toMatch(/mayViewInvSpells \? uploadStampsFor\('inventory'/);
    expect(g).toMatch(/mayViewInvSpells \? uploadStampsFor\('spells'/);
  });
});

describe('uploadFreshness helpers', () => {
  const NOW = Date.parse('2026-10-31T12:00:00Z');
  const ago = (ms) => new Date(NOW - ms).toISOString();
  const H = 3600_000, D = 24 * H;

  it('latestIso picks the newest and ignores junk', () => {
    expect(latestIso(null, undefined, 'nope', '2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z')).toBe('2026-10-02T00:00:00Z');
    expect(latestIso(null, undefined)).toBeNull();
  });

  it('arrival is the newest of checked, synced and row; change is the newest of synced and row', () => {
    const t = uploadTimes({ checkedAt: '2026-10-30T00:00:00Z', syncedAt: '2026-10-01T00:00:00Z', rowAt: '2026-09-01T00:00:00Z' });
    expect(t).toEqual({ arrivedAt: '2026-10-30T00:00:00Z', changedAt: '2026-10-01T00:00:00Z' });
  });

  it('falls back to synced_at, then to the row timestamp, when checked_at is null', () => {
    expect(uploadTimes({ checkedAt: null, syncedAt: '2026-10-01T00:00:00Z', rowAt: '2026-09-01T00:00:00Z' }).arrivedAt).toBe('2026-10-01T00:00:00Z');
    expect(uploadTimes({ checkedAt: null, syncedAt: null, rowAt: '2026-09-01T00:00:00Z' }).arrivedAt).toBe('2026-09-01T00:00:00Z');
  });

  it('says "never" when nothing exists', () => {
    expect(describeUpload({}, 'UTC').label).toBe('never');
    expect(describeUpload(null, 'UTC').label).toBe('never');
    expect(describeUpload(undefined, 'UTC').label).toBe('never');
  });

  it('labels relative age and mentions "content last changed" only when the two differ', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const same = describeUpload({ checkedAt: ago(2 * H), syncedAt: ago(2 * H) }, 'UTC');
      expect(same.label).toBe('2h ago');
      expect(same.title).not.toContain('content last changed');

      const apart = describeUpload({ checkedAt: ago(2 * H), syncedAt: ago(12 * D) }, 'UTC');
      expect(apart.label).toBe('2h ago');
      expect(apart.title).toContain('content last changed');
      expect(apart.title).toContain('Oct 19, 2026');

      expect(describeUpload({ checkedAt: ago(3 * D) }, 'UTC').label).toBe('3d ago');
    } finally {
      vi.useRealTimers();
    }
  });
});
