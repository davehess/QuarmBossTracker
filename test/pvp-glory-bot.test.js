// test/pvp-glory-bot.test.js — the bot's half of the Rallosian Glory kill broadcast (Quarm's PoP patch;
// the guild lead, 2026-09-28: "Some new messages"). The line names no guilds: the bot fills them in from
// /who and the roster, treats the kill as player-versus-player, keeps it out of the boss-timer path, and
// collapses it with the old-format broadcast of the same kill. Runs the bot's real functions on fakes.
//
// Run: npx vitest run test/pvp-glory-bot.test.js

import { describe, it, expect } from 'vitest';
import { readSource, BOT_INDEX, sliceBlock, stripJs } from './_source-slice.js';

const bot = readSource(BOT_INDEX);

function loadDedup() {
  const block = [
    'const _recentPvpBroadcasts = new Map();',
    'const PVP_DEDUP_BUCKET_MS = 15_000;',
    sliceBlock(bot, 'function _pvpNorm(b) {', '\n}'),
    sliceBlock(bot, 'function _pvpBucket(b) {', '\n}'),
    sliceBlock(bot, 'function _isPvpDupe(b) {', '\n}'),
  ].join('\n');
  // eslint-disable-next-line no-new-func
  return new Function(block + '\nreturn { _isPvpDupe };')();
}

function loadResolver({ who = [], roster = [] } = {}) {
  const calls = [];
  const supabase = {
    isEnabled: () => true,
    select: async (table, q) => { calls.push([table, q]); return who; },
  };
  const block = sliceBlock(bot, 'async function _resolveGloryGuilds(broadcasts) {', '\n}\n');
  // eslint-disable-next-line no-new-func
  const fn = new Function('require', '_rosterNameSet', 'WP_GUILD_NAME', block + '\nreturn _resolveGloryGuilds;')(
    () => supabase, async () => new Set(roster.map(n => n.toLowerCase())), 'Wolf Pack');
  return { fn, calls };
}

const glory = (over) => Object.assign({
  ts: '2026-09-28T20:18:40.000Z', killType: 'pvp', source: 'rallos_glory',
  killer: 'Myto', killerGuild: null, victim: 'Songfin', victimGuild: null,
  zone: 'The Fungus Grove', glory: false,
  text: "Rallos Zek watches as Myto spills Songfin's blood in The Fungus Grove, but finds no worthy conquest.",
}, over);

describe('guilds for a Glory kill', () => {
  it('takes the latest /who guild, falls back to our roster, and leaves unknowns empty', async () => {
    const { fn, calls } = loadResolver({
      who: [{ character: 'Songfin', guild_name: 'Europa', observed_at: '2026-09-28T19:00:00Z' },
            { character: 'Songfin', guild_name: 'Old Guild', observed_at: '2026-09-01T19:00:00Z' }],
      roster: ['Myto'],
    });
    const a = glory();
    const b = glory({ killer: 'Kyinen', victim: 'Sweetums', zone: 'Kael Drakkel' });
    await fn([a, b, { killType: 'pvp', killer: 'X', victim: 'Y', killerGuild: 'Keep', victimGuild: 'Me' }]);
    expect(a).toMatchObject({ killerGuild: 'Wolf Pack', victimGuild: 'Europa' });
    expect(b).toMatchObject({ killerGuild: '', victimGuild: '' });
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('who_observations');
    expect(calls[0][1]).toMatch(/character=in\.\(Myto,Songfin,Kyinen,Sweetums\)/);
    expect(calls[0][1]).toMatch(/anonymous=is\.false/);
  });

  it('does not query anything when no Glory lines arrived', async () => {
    const { fn, calls } = loadResolver();
    const old = { killType: 'pvp', killer: 'A', victim: 'B', killerGuild: 'Wolf Pack', victimGuild: 'Zek' };
    await fn([old]);
    expect(calls).toHaveLength(0);
    expect(old).toMatchObject({ killerGuild: 'Wolf Pack', victimGuild: 'Zek' });
  });

  it('never puts an odd name into the query', async () => {
    const { fn, calls } = loadResolver();
    await fn([glory({ killer: 'Myto),or(1', victim: 'Songfin' })]);
    expect(calls[0][1]).not.toMatch(/or\(1/);
  });
});

describe('one kill, two wordings, one post', () => {
  it('collapses the Glory line and the old broadcast of the same kill', () => {
    const { _isPvpDupe } = loadDedup();
    const old = { killType: 'pvp', killer: 'Myto', victim: 'Songfin', ts: '2026-09-28T20:18:39.000Z',
      text: 'Songfin of <Europa> has been killed in combat by Myto of <Wolf Pack> in The Fungus Grove!' };
    expect(_isPvpDupe(old)).toBe(false);
    expect(_isPvpDupe(glory())).toBe(true);
  });
  it('still keeps two different kills apart', () => {
    const { _isPvpDupe } = loadDedup();
    expect(_isPvpDupe(glory())).toBe(false);
    expect(_isPvpDupe(glory({ victim: 'Other', text: 'different' }))).toBe(false);
  });
});

describe('the handler', () => {
  const code = stripJs(sliceBlock(bot, 'async function _handleAgentPvp(req, res) {', '\nasync function _handleAgentPvpAssists'));
  it('fills guilds before anything reads them', () => {
    const at = code.indexOf('await _resolveGloryGuilds(broadcasts);');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(code.indexOf('const harvestedRows = [];'));
  });
  it('counts a Glory kill as ours even when the other guild is unknown, and never as a boss kill', () => {
    expect(code).toMatch(/isWpKill\s*=\s*killType === 'pvp' && killerGuild === WP_GUILD_NAME && \(isGlory \|\| _hasRealGuild\(victimGuild\)\)/);
    expect(code).toMatch(/isWpDeath\s*=\s*killType === 'pvp' && !!killer && victimGuild === WP_GUILD_NAME && \(isGlory \|\| _hasRealGuild\(killerGuild\)\)/);
    expect(code).toMatch(/if \(killType === 'pvp' && !victimGuild && victim && !isGlory\)/);
    expect(code).toMatch(/if \(b\?\.source === 'rallos_glory'\) continue;/);
  });
  // The Oct 1 wordings (the guild lead's unmatched-lines file, 2026-10-02; DECISIONS §132).
  it('posts a forfeit as one, not as a death', () => {
    expect(code).toContain("content = `${killType === 'forfeit' ? '🏃' : '☠️'} ${text}`;");
  });
});

describe('the Oct 1 wordings', () => {
  it('keeps a guild the line named and fills only the missing side', async () => {
    const { fn } = loadResolver({
      who: [{ character: 'Brackwyn', guild_name: 'Europa', observed_at: '2026-10-01T19:00:00Z' },
            { character: 'Aldenmar', guild_name: 'Stale Guild', observed_at: '2026-10-01T19:00:00Z' }],
    });
    const b = glory({ killer: 'Aldenmar', killerGuild: 'Zek', victim: 'Brackwyn', victimGuild: null });
    await fn([b]);
    expect(b).toMatchObject({ killerGuild: 'Zek', victimGuild: 'Europa' });
  });

  it('records a death to an NPC and a death with no killer, and no forfeit', () => {
    const block = sliceBlock(bot, 'function _pvpDeathRow(b, guildId, discordId, petOwners) {', '\n}');
    // eslint-disable-next-line no-new-func
    const row = new Function('petOwnerEntries', block + '\nreturn _pvpDeathRow;')(() => []);
    const npc = row({ killType: 'npc', source: 'rallos_glory', victim: 'Brackwyn', victimGuild: 'Zek',
      killer: 'a small mushroom', zone: 'The Fungus Grove', ts: '2026-10-01T06:43:40.000Z' }, 'wolfpack', null, {});
    expect(npc).toMatchObject({ victim: 'Brackwyn', killer: 'a small mushroom', killer_is_npc: true, killer_guild: null });
    const foe = row({ killType: 'pvp', source: 'rallos_glory', victim: 'Brackwyn', victimGuild: '',
      killer: null, zone: 'Kedge Keep', ts: '2026-10-01T06:25:21.000Z' }, 'wolfpack', null, {});
    expect(foe).toMatchObject({ victim: 'Brackwyn', killer: null, killer_is_npc: false });
    expect(row({ killType: 'forfeit', source: 'rallos_glory', victim: 'Brackwyn', victimGuild: null,
      killer: null, ts: '2026-10-01T06:25:21.000Z' }, 'wolfpack', null, {})).toBeNull();
  });
});
