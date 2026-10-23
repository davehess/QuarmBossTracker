// test/actor-name.test.js — an officer action is stored and shown under a Discord name, never an email address.
//
// The guild lead, 2026-10-23, on a parse page that read "marked by <address>": "Needs to remove email from this and
// instead do username". actorName is what the parse actions write; shownActor guards rows written before it.
//
// Run: npx vitest run test/actor-name.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import { actorName, shownActor } from '../web/lib/actorName.ts';

describe('actorName', () => {
  it('takes the Discord name, and never an address even when that is all there is', () => {
    expect(actorName({ user_metadata: { full_name: 'Aldenmar', email: 'someone@example.com' } })).toBe('Aldenmar');
    expect(actorName({ user_metadata: { name: 'Brackwyn' } })).toBe('Brackwyn');
    expect(actorName({ user_metadata: { full_name: 'someone@example.com', email: 'someone@example.com' } })).toBe('an officer');
    expect(actorName({ user_metadata: {} })).toBe('an officer');
    expect(actorName(null)).toBe('an officer');
  });
});

describe('shownActor', () => {
  it('hides an address or a raw account id stored by the old code, and shows a name as it is', () => {
    expect(shownActor('someone@example.com')).toBe('an officer');
    expect(shownActor('6a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d')).toBe('an officer');
    expect(shownActor('Corvale')).toBe('Corvale');
    expect(shownActor('auto')).toBe('auto');
    expect(shownActor(null)).toBeNull();
  });
});

describe('the parse actions write a name, not the email', () => {
  it('no `.email ||` left in web/app/parses/actions.ts', () => {
    const src = stripJs(fs.readFileSync(path.join(ROOT, 'web/app/parses/actions.ts'), 'utf8'));
    expect(src).not.toMatch(/\.email\s*\|\|/);
    // classification_by and created_by_name are only ever written as actorName(u)
    const writes = (src.match(/(?:classification_by|created_by_name):\s*[^,\n}]+/g) || []).map(w => w.trim());
    expect(writes.filter(w => !/:\s*null$/.test(w)).length).toBeGreaterThanOrEqual(2);
    for (const w of writes) expect(w).toMatch(/:\s*(?:actorName\(u\)|null)$/);
  });
});

// FB sweep (the guild lead, 2026-10-23, "sweep all six"): every officer action under web/app writes a Discord name.
function appSources(dir = path.join(ROOT, 'web/app'), out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) appSources(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('no officer action under web/app writes an email address', () => {
  // auth/mimic-link shows a person THEIR OWN address back to them; it writes nothing.
  const SHOWS_OWN = new Set(['web/app/auth/mimic-link/page.tsx']);
  it('no `.email ||` writer remains', () => {
    const files = appSources();
    expect(files.length).toBeGreaterThan(100);
    const bad = files
      .filter(f => !SHOWS_OWN.has(path.relative(ROOT, f).split(path.sep).join('/')))
      .filter(f => /\.email\s*\|\|/.test(stripJs(fs.readFileSync(f, 'utf8'))))
      .map(f => path.relative(ROOT, f));
    expect(bad).toEqual([]);
  });

  it('the pages that print a stored actor wrap it in shownActor', () => {
    for (const [file, re] of [
      ['web/app/admin/overlays/page.tsx', /shownActor\(data\.updated_by_name\)/],
      ['web/app/admin/voice/page.tsx', /shownActor\(row\.updated_by_name\)/],
      ['web/app/admin/comp/page.tsx', /shownActor\(data\.updated_by_name\)/],
      ['web/app/admin/console/page.tsx', /shownActor\(f\.tuningUpdatedBy\)/],
      ['web/app/who/page.tsx', /shownActor\(o\?\.set_by_name\)/],
    ]) {
      expect(stripJs(fs.readFileSync(path.join(ROOT, file), 'utf8')), file).toMatch(re);
    }
  });
});
