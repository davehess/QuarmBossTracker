// test/pet-possessive-owner.test.js — a possessive pet name credits its owner
// on EVERY client, not just the owner's own.
//
// Shavimo's Warder counted in the parse HE sent (56.6K "+Pets") and vanished
// from every other client's copy of the same fight (35.8K, no pets). Same shape
// for Wabumkin and Kravenn. Cause: the possessive-name shortcut that exists to
// rescue Beastlord Warders — whose "My leader is X" line fires once at summon
// and is gone forever if the agent wasn't tailing at that instant — only fired
// when the possessive matched the READER'S own character.
//
// "Shavimo`s Warder" is server truth about ownership regardless of who is
// reading the line, so it should credit Shavimo on anyone's machine.
//
// The guards matter as much as the fix: a possessive is not proof of a PLAYER
// ("a gnoll`s pet"), and vision eyes have their own choke point that this
// second birthplace of ownership has to agree with.
//
// Run: npx vitest run test/pet-possessive-owner.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, AGENT_INDEX } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
const block = sliceBlock(src, '    if (event.attacker) {', '    // ── Damage-shield flavor line');

// Mirror of the shipped rule, so the cases below describe behaviour rather
// than just asserting on source text.
const POSSESSIVE = /^([A-Z][\w`]*)['`]s\s+\S/;
const isEye = (n) => /^eye\s+of\s+/i.test(String(n || '').trim());
function ownerFor(petName, { self, confirmedPlayers = [] }) {
  if (isEye(petName)) return null;
  const m = String(petName).match(POSSESSIVE);
  if (!m) return null;
  const owner = m[1];
  if (self && owner.toLowerCase() === self.toLowerCase()) return self;
  if (confirmedPlayers.some(p => p.toLowerCase() === owner.toLowerCase())) return owner;
  return null;
}

describe('the shipped code credits the named owner, not only self', () => {
  it('no longer requires the possessive to match this.character', () => {
    expect(block).toMatch(/isConfirmedPlayer\(_owner\)/);
    expect(block).toMatch(/this\.petLeaders\[_plKey\] = _owner/);
  });

  it('still short-circuits self without needing a /who sighting', () => {
    // The owner's own client must keep working even before anyone has been
    // /who'd — that was the original 2026-07-03 fix and it must not regress.
    expect(block).toMatch(/const _isSelf = this\.character && _owner\.toLowerCase\(\) === this\.character\.toLowerCase\(\)/);
  });

  it('keeps the vision-eye choke point on this path too', () => {
    expect(block).toMatch(/!_isVisionEyePet\(_pl\)/);
  });

  it('never overwrites an ownership already established', () => {
    // A live declaration ("My leader is X") outranks a name guess; this path
    // only fills a gap.
    expect(block).toMatch(/!this\.petLeaders\[_plKey\]/);
  });
});

describe('who gets credited', () => {
  it('credits the owner on a BYSTANDER machine — the reported bug', () => {
    expect(ownerFor('Shavimo`s Warder', { self: 'Hitya', confirmedPlayers: ['Shavimo'] })).toBe('Shavimo');
  });

  it('still credits the owner on their OWN machine', () => {
    expect(ownerFor('Shavimo`s Warder', { self: 'Shavimo' })).toBe('Shavimo');
  });

  it('handles the straight apostrophe as well as the backtick', () => {
    // EQ logs backtick possessives; other sources emit a straight quote.
    expect(ownerFor("Shavimo's Warder", { self: 'Hitya', confirmedPlayers: ['Shavimo'] })).toBe('Shavimo');
  });

  it('works for the other two names in the same parse', () => {
    const seen = ['Wabumkin', 'Kravenn'];
    expect(ownerFor('Wabumkin`s Warder', { self: 'Hitya', confirmedPlayers: seen })).toBe('Wabumkin');
    expect(ownerFor('Kravenn`s Warder',  { self: 'Hitya', confirmedPlayers: seen })).toBe('Kravenn');
  });
});

describe('what must NOT become a pet owner', () => {
  it('refuses an unconfirmed name — a possessive is not proof of a player', () => {
    expect(ownerFor('Gnoll`s pet', { self: 'Hitya', confirmedPlayers: [] })).toBeNull();
  });

  it('refuses a vision eye even if it were possessive-named', () => {
    expect(ownerFor('Eye of Peopleslayer', { self: 'Hitya', confirmedPlayers: ['Peopleslayer'] })).toBeNull();
    expect(ownerFor('Eye of Zomm', { self: 'Hitya', confirmedPlayers: ['Zomm'] })).toBeNull();
  });

  it('refuses names that are not possessive at all', () => {
    for (const n of ['a decaying skeleton', 'Warder', 'Shavimo', 'a gnoll pup']) {
      expect(ownerFor(n, { self: 'Hitya', confirmedPlayers: ['Shavimo'] }), n).toBeNull();
    }
  });

  it('refuses a lowercase leading token — NPC possessives are not Title-cased', () => {
    expect(ownerFor('a gnoll`s pet', { self: 'Hitya', confirmedPlayers: [] })).toBeNull();
  });
});
