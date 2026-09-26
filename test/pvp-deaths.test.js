// pvp_deaths: every death the PvP broadcast reports, whoever is on either side, for the fight
// history on /pvp (the guild lead, 2026-09-26: "Lets start combining PVP encounters into history").
// pvp_kills keeps only kills with Wolf Pack on one side, which left an alliance-vs-Zek night almost
// invisible (DECISIONS-2026-09-21.md §46).
//
// Run: npx vitest run test/pvp-deaths.test.js

import { describe, it, expect } from 'vitest';
import { readSource, BOT_INDEX, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const bot = readSource(BOT_INDEX);
const { _pvpDeathRow } = evalBlock(
  // petOwnerEntries is the utils/state.js reader: entries are {o, at}, newest last.
  'const petOwnerEntries = (e) => Array.isArray(e) ? e : (e ? [e] : []);\n'
  + sliceBlock(bot, 'function _pvpDeathRow(b, guildId, discordId, petOwners) {', '\n}\n'),
  ['_pvpDeathRow']);

const kill = (over) => Object.assign({
  ts: '2026-09-26T06:04:12.000Z', killType: 'pvp',
  victim: 'Brackwyn', victimGuild: 'Zek', killer: 'Corvale', killerGuild: 'Dungeons and Dragons',
  zone: 'Vex Thal', text: 'Brackwyn of <Zek> has been killed in combat by Corvale of <Dungeons and Dragons> in Vex Thal!',
}, over);

describe('_pvpDeathRow: one row per death, any guilds', () => {
  it('a player kill between two guilds that are not Wolf Pack is kept', () => {
    expect(_pvpDeathRow(kill(), 'wolfpack', '42', {})).toMatchObject({
      victim: 'Brackwyn', victim_guild: 'Zek', killer: 'Corvale', killer_guild: 'Dungeons and Dragons',
      killer_is_npc: false, zone: 'Vex Thal', died_at: '2026-09-26T06:04:12.000Z', source: 'pvp_channel',
      dedup_key: 'wolfpack|brackwyn|2026-09-26T06:04', uploaded_by_discord_id: '42',
    });
  });

  it('a death to an NPC is a death: the NPC is named, never counted as a player', () => {
    const row = _pvpDeathRow(kill({ killType: 'npc', killer: 'Eom Zethon', killerGuild: null }), 'wolfpack', null, {});
    expect(row).toMatchObject({ killer: 'Eom Zethon', killer_guild: null, killer_is_npc: true });
  });

  it('a boss kill is not a death (no victim guild), and neither is an empty broadcast', () => {
    expect(_pvpDeathRow(kill({ victim: 'Aten Ha Ra', victimGuild: null }), 'wolfpack', null, {})).toBe(null);
    expect(_pvpDeathRow(kill({ victim: '' }), 'wolfpack', null, {})).toBe(null);
    expect(_pvpDeathRow(kill({ ts: 'not a time' }), 'wolfpack', null, {})).toBe(null);
  });

  it('an unguilded player still dies; the "<null>" spellings read as no guild', () => {
    expect(_pvpDeathRow(kill({ victimGuild: '<null>', killerGuild: '<>' }), 'wolfpack', null, {}))
      .toMatchObject({ victim_guild: null, killer_guild: null, killer_is_npc: false });
  });

  it('a pet kill is credited to its owner, as pvp_kills does, and keeps the pet name', () => {
    const owners = { xabann: [{ o: 'Rethlan', at: 1 }, { o: 'Aldenmar', at: 2 }] };
    expect(_pvpDeathRow(kill({ killer: 'Xabann' }), 'wolfpack', null, owners))
      .toMatchObject({ killer: 'Aldenmar', pet_name: 'Xabann' });
  });

  it('two relays of one death a second or two apart share a key; a second death a minute on does not', () => {
    const a = _pvpDeathRow(kill({ ts: '2026-09-26T06:04:12Z' }), 'wolfpack', null, {});
    const b = _pvpDeathRow(kill({ ts: '2026-09-26T06:04:14Z' }), 'wolfpack', null, {});
    const c = _pvpDeathRow(kill({ ts: '2026-09-26T06:05:30Z' }), 'wolfpack', null, {});
    expect(a.dedup_key).toBe(b.dedup_key);
    expect(c.dedup_key).not.toBe(a.dedup_key);
  });
});

describe('the relay writes it before the post loop', () => {
  it('every broadcast is offered to pvp_deaths before the Discord dedup can skip it', () => {
    const h = stripJs(sliceBlock(bot, 'async function _handleAgentPvp(req, res) {', '\nasync function _handleAgentPvpAssists'));
    const write = h.indexOf("supabase.upsert('pvp_deaths', [...deathRows.values()], 'dedup_key')");
    expect(write).toBeGreaterThan(-1);
    expect(write).toBeLessThan(h.indexOf('if (_isPvpDupe(b)) { deduped++; continue; }'));
    expect(h).toContain('if (row) deathRows.set(row.dedup_key, row);');
  });
});
