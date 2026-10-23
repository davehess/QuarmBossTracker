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
    expect(src.match(/actorName\(u\)/g) || []).toHaveLength(2);
  });
});
