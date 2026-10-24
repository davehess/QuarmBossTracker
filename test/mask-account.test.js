// test/mask-account.test.js — the game-account name on /me/inventory shows as ab***89 until
// clicked (the guild lead, 2026-10-24). The function and the plan are real-imported; the two
// source assertions strip comments first so a comment cannot satisfy them.
// Names are invented.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { maskAccount } from '../web/lib/maskAccount.ts';
import { planSharedBanks } from '../web/lib/sharedBank.ts';
import { ROOT, stripJs } from './_source-slice.js';

const read = rel => stripJs(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

describe('maskAccount', () => {
  it('keeps two characters at each end around exactly ***', () => {
    expect(maskAccount('abcdefgh')).toBe('ab***gh');
    expect(maskAccount('abcde')).toBe('ab***de');
    expect(maskAccount('longname76')).toBe('lo***76');
  });
  it('shows only the first character of a name of four or fewer', () => {
    expect(maskAccount('abcd')).toBe('a***');
    expect(maskAccount('ab')).toBe('a***');
    expect(maskAccount('a')).toBe('a***');
  });
  it('leaves an empty name empty', () => {
    expect(maskAccount('')).toBe('');
  });
});

describe('account name vs the default labels', () => {
  const placements = label => [
    { character: 'Aldenmar', accountId: 'a3', slot: 3, label },
    { character: 'Brackwyn', accountId: 'a3', slot: 3, label },
  ];
  it('carries the owner-given name so the page can mask it', () => {
    const acct = planSharedBanks([], placements('longname76')).accounts[0];
    expect(acct.name).toBe('longname76');
    expect(acct.label).toBe('longname76 (Aldenmar, Brackwyn)');
  });
  it('has no name for the "Account 3" fallback, which is not worth masking', () => {
    expect(planSharedBanks([], placements(null)).accounts[0].name).toBeNull();
  });
});

describe('the Who has it cell', () => {
  const src = read('web/app/me/inventory/InventoryExplorer.tsx');
  it('renders a named shared-bank account through MaskedAccount', () => {
    expect(src).toMatch(/<MaskedAccount name=\{h\.account\.name\} \/>/);
  });
  it('no longer prints the raw account label for an account holding', () => {
    expect(src).not.toMatch(/\{h\.account\.label\}/);
    expect(src).not.toMatch(/title=\{[^}]*account\.(name|label)/);
  });
  it('MaskedAccount toggles per button with the accessible labels', () => {
    const c = read('web/components/MaskedAccount.tsx');
    expect(c).toMatch(/useState\(false\)/);
    expect(c).toMatch(/Show account name/);
    expect(c).toMatch(/Hide account name/);
    expect(c).toMatch(/aria-pressed=\{shown\}/);
    expect(c).not.toMatch(/localStorage|sessionStorage/);
  });
});
