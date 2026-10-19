// test/quarantine-guard.test.js — keeps the test quarantine honest (the guild lead, 2026-10-19: "quarantine the
// five failing tests so CI goes green").
//
// vitest.config.js skips every file listed in test/quarantine.json (main) and test/quarantine.beta.json (beta
// only). A skip is only safe while it is loud and temporary, so each entry must name an owner, a reason and an
// expiry, the listed file must exist, and the expiry must be neither past nor more than 30 days after the day the
// quarantine was written (2026-10-19). An expired entry fails CI here, naming the file: fix the test or renew the
// entry on purpose. This file is never itself excluded.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LISTS = ['test/quarantine.json', 'test/quarantine.beta.json'];
const LATEST_EXPIRY = '2026-11-18';   // 30 days after the quarantine was written, 2026-10-19

const today = () => new Date().toISOString().slice(0, 10);

// The problems with one list's entries, each naming its file. An empty array is a clean list.
function problems(list, { exists = (f) => fs.existsSync(path.join(ROOT, f)), now = today() } = {}) {
  const out = [];
  if (!list || !Array.isArray(list.files)) return ['the list has no "files" array'];
  for (const e of list.files) {
    const f = e && e.file;
    if (typeof f !== 'string' || !f.trim()) { out.push('an entry has no file'); continue; }
    if (!exists(f)) out.push(`${f}: the listed file does not exist`);
    for (const k of ['reason', 'owner', 'expires']) {
      if (typeof e[k] !== 'string' || !e[k].trim()) out.push(`${f}: ${k} is empty`);
    }
    const d = e.expires;
    if (typeof d === 'string' && d.trim()) {
      const t = new Date(d + 'T00:00:00Z');
      const valid = /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(t) && t.toISOString().slice(0, 10) === d;
      if (!valid) out.push(`${f}: expires "${d}" is not a YYYY-MM-DD date`);
      else if (d < now) out.push(`${f}: quarantine EXPIRED ${d} — fix the test or renew the entry on purpose`);
      else if (d > LATEST_EXPIRY) out.push(`${f}: expires ${d}, later than ${LATEST_EXPIRY}`);
    }
  }
  return out;
}

describe('the quarantine lists', () => {
  const present = LISTS.filter((l) => fs.existsSync(path.join(ROOT, l)));

  it('at least the main list is present', () => {
    expect(present).toContain('test/quarantine.json');
  });

  for (const l of present) {
    it(`${l} is clean`, () => {
      const list = JSON.parse(fs.readFileSync(path.join(ROOT, l), 'utf8'));
      expect(problems(list)).toEqual([]);
    });
  }

  it('no file is listed twice across the lists', () => {
    const all = present.flatMap((l) => JSON.parse(fs.readFileSync(path.join(ROOT, l), 'utf8')).files.map((e) => e.file));
    expect(all.filter((f, i) => all.indexOf(f) !== i)).toEqual([]);
  });
});

describe('the check itself catches each way an entry goes bad', () => {
  const good = { file: 'test/a.test.js', reason: 'r', owner: 'o', expires: '2026-11-02' };
  const run = (over, opts) => problems({ files: [{ ...good, ...over }] }, { exists: () => true, now: '2026-10-19', ...opts });

  it('passes a good entry', () => expect(run({})).toEqual([]));
  it('fails an expired date, naming the file', () => {
    expect(run({}, { now: '2026-11-03' }).join('\n')).toMatch(/test\/a\.test\.js: quarantine EXPIRED 2026-11-02/);
    expect(run({}, { now: '2026-11-02' }), 'the expiry day itself still passes').toEqual([]);
  });
  it('fails a missing reason, owner or expiry', () => {
    expect(run({ reason: '' }).join()).toMatch(/reason is empty/);
    expect(run({ owner: '  ' }).join()).toMatch(/owner is empty/);
    expect(run({ expires: undefined }).join()).toMatch(/expires is empty/);
  });
  it('fails a listed file that does not exist', () => {
    expect(problems({ files: [good] }, { exists: () => false, now: '2026-10-19' }).join()).toMatch(/does not exist/);
  });
  it('fails a bad or too-far-out date', () => {
    expect(run({ expires: '2026-13-40' }).join()).toMatch(/not a YYYY-MM-DD date/);
    expect(run({ expires: 'soon' }).join()).toMatch(/not a YYYY-MM-DD date/);
    expect(run({ expires: '2026-11-19' }).join()).toMatch(/later than 2026-11-18/);
  });
});
