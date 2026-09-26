// The Discord /who lookups are for members only (the guild lead, 2026-09-26: "we shouldnt just give
// away our secret weapon … end users should ultimately decide on if their characters are linked outside
// of the guild"). /whois unmasks anonymous players from history and flags Zeks; /who and /whoall, their
// autocomplete labels and the Show Family button say which character is whose alt. Anyone in the
// Discord server could run them before.
//
// Run: npx vitest run test/who-commands-members-only.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, BOT_INDEX, sliceBlock, stripJs } from './_source-slice.js';

const require = createRequire(import.meta.url);
const roles = require('../utils/roles');
const whois = require('../commands/whois');
const who = require('../commands/who');
const whoall = require('../commands/whoall');

beforeEach(() => { process.env.ALLOWED_ROLE_NAMES = 'Pack Member,Officer,Guild Leader'; });

const member = (roleNames) => ({ roles: { cache: { some: (fn) => roleNames.some(name => fn({ name })) } } });
function interaction({ roleNames, dm = false } = {}) {
  const calls = { reply: [], respond: [] };
  return {
    calls,
    member: dm ? null : member(roleNames || []),
    options: { getString: () => 'Aldenmar', getFocused: () => 'ald' },
    reply: (x) => { calls.reply.push(x); return x; },
    respond: (x) => { calls.respond.push(x); return x; },
  };
}

describe('isGuildMember', () => {
  it('a member role passes; no role, another role, or no member at all (a DM) does not', () => {
    expect(roles.isGuildMember(interaction({ roleNames: ['Pack Member'] }))).toBe(true);
    expect(roles.isGuildMember(interaction({ roleNames: ['Officer'] }))).toBe(true);
    expect(roles.isGuildMember(interaction({ roleNames: [] }))).toBe(false);
    expect(roles.isGuildMember(interaction({ roleNames: ['Ally', 'Visitor'] }))).toBe(false);
    expect(roles.isGuildMember(interaction({ dm: true }))).toBe(false);
    expect(roles.isGuildMember(null)).toBe(false);
  });
});

describe('the commands refuse non-members before reading anything', () => {
  for (const [name, cmd] of [['whois', whois], ['who', who], ['whoall', whoall]]) {
    it(`/${name}: a non-member gets the members-only line, nothing else`, async () => {
      const i = interaction({ roleNames: ['Visitor'] });
      await cmd.execute(i);
      expect(i.calls.reply).toHaveLength(1);
      expect(i.calls.reply[0].content).toBe(roles.MEMBERS_ONLY);
      expect(i.calls.reply[0].embeds).toBeUndefined();
    });
  }
  for (const [name, cmd] of [['who', who], ['whoall', whoall]]) {
    it(`/${name} autocomplete: a non-member gets no suggestions (the labels name alts)`, async () => {
      const i = interaction({ roleNames: [] });
      // The roster is empty here, so an ungated lookup would ALSO answer []; refusing means never reading.
      i.options.getFocused = () => { throw new Error('read the roster for a non-member'); };
      await cmd.autocomplete(i);
      expect(i.calls.respond).toEqual([[]]);
    });
  }
  it('a member still gets an answer from /whois', async () => {
    const i = interaction({ roleNames: ['Pack Member'] });
    await whois.execute(i);
    expect(i.calls.reply[0].content).not.toBe(roles.MEMBERS_ONLY);
  });
});

describe('the Show Family button', () => {
  it('checks membership before building the family', () => {
    const h = stripJs(sliceBlock(readSource(BOT_INDEX), 'async function handleWhoFamily(interaction) {', '\n}\n'));
    const gate = h.indexOf('if (!isGuildMember(interaction)) return interaction.reply(');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(h.indexOf('buildWhoallEmbed(name)'));
  });
});
