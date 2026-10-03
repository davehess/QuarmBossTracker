// test/spellbook-upload-owner.test.js — a spellbook upload accepts an alt through its family root.
//
// The guild lead, 2026-10-03: "spellbook upload is screwing up the upload". The upload's ownership
// check matched only the character's own discord_id, and alts often carry a NULL or stale one, so
// 11 alts answered "not your character". It now falls back to the family root (main_name), the
// rule /me's toggles already use (web/app/me/actions.ts setCharacterExclusion).
//
// Run: npx vitest run test/spellbook-upload-owner.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, stripJs } from './_source-slice.js';

const SRC = stripJs(readSource(path.join(ROOT, 'web/app/me/spellbook-actions.ts')));
const gate = SRC.slice(SRC.indexOf('async function ownsOrOfficer'), SRC.indexOf('export async function uploadSpellbook'));

describe('spellbook upload: who may upload for a character', () => {
  it('reads the character\'s main_name with its discord_id', () => {
    expect(gate).toContain(".select('name, discord_id, main_name')");
  });
  it('falls back to the family root when the alt\'s own link does not match', () => {
    expect(gate).toMatch(/if \(ch\.discord_id === me\.discord_id\) return \{ ok: true \};/);
    expect(gate).toMatch(/\.ilike\('name', ch\.main_name\)/);
    expect(gate).toMatch(/if \(root\?\.discord_id === me\.discord_id\) return \{ ok: true \};/);
  });
  it('still lets an officer upload for anyone, and refuses everyone else', () => {
    expect(gate).toMatch(/if \(await isOfficer\(user\.id\)\) return \{ ok: true \};/);
    expect(gate.trim().endsWith("return { ok: false, error: 'not your character' };\n}") || /return \{ ok: false, error: 'not your character' \};\s*\}\s*$/.test(gate)).toBe(true);
  });
});
