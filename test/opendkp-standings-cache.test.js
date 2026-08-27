// test/opendkp-standings-cache.test.js — nothing but the BOT talks to OpenDKP.
//
// Moncs, OpenDKP's operator, 2026-08-27: "Do you purposefully call /dkp once a
// minute? Looking back over the past 60 minutes, it looks like theres about 54
// calls from 184.144.103.149 calling it".
//
// That ip was a MEMBER'S PC. Every open Mimic asked OpenDKP for the full 472-
// character standings array once a minute, directly, to render one number — so
// the cost scaled with how many people had Mimic open, and none of it appeared
// in our own call counter because it never passed through the bot.
//
// Hitya: "agents shouldnt be reaching out to opendkp like this." So the call
// moved to the bot, where it is counted, governed and haltable, and this file
// holds BOTH halves of that: the agent has no line to OpenDKP at all, and the
// bot's refresh policy spends a call only when one is warranted.
//
// Run: npx vitest run test/opendkp-standings-cache.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, ROOT } from './_source-slice.js';
import path from 'node:path';

const agentSrc = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js'));
const botSrc   = readSource(path.join(ROOT, 'index.js'));

// Comment-stripped view. The removal left tombstone comments explaining what
// used to be here and why it must not come back — those mention the hostname,
// and a naive .not.toContain() matches the explanation instead of the code.
// (It did. That is what this exists for: the first version of these assertions
// failed against its own documentation.) Whole-line comments only, so that
// "https://" inside a real string literal survives.
const agentCode = agentSrc.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

// The bot's policy is pure; exercise the shipped copy.
const block = sliceBlock(
  botSrc,
  'const _PANEL_DKP_TTL_BIDDING_MS =',
  "return { refresh: true, reason: auctionsLive ? 'auction-open' : 'raid-window' };\n}",
);
const h = new Function(`${block}\nreturn { _standingsRefreshDecision, _PANEL_DKP_TTL_BIDDING_MS, _PANEL_DKP_TTL_RAID_MS };`)();
const decide = (o) => h._standingsRefreshDecision({ nowMs: 1_000_000, ...o });

describe('the agent has no line to OpenDKP', () => {
  it('carries no address for OpenDKP’s API', () => {
    // The rule is "no host", not "a slower cache". A cache TTL is a number
    // somebody can turn back up; an absent hostname is not.
    expect(agentCode).not.toMatch(/OPENDKP_API_HOST\s*=/);
    expect(agentCode).not.toContain('api.opendkp.com');
  });

  it('has no fetcher that could call it', () => {
    for (const gone of ['_opendkpGetJson', '_opendkpFetchStandings', '_opendkpAccountDkp']) {
      expect(agentCode, `${gone} must stay deleted`).not.toMatch(new RegExp(`function\\s+${gone}\\s*\\(`));
    }
  });

  it('serves no local route that used to front that call', () => {
    expect(agentCode).not.toContain("req.url.startsWith('/api/loot/dkp')");
  });

  it('reads the balance from the bot instead', () => {
    expect(agentSrc).toContain('fetch("/api/server/account-dkp"');
    expect(botSrc).toContain("if (key === 'account-dkp') {");
  });

  it('still speaks to Cognito, and ONLY Cognito', () => {
    // The member's own login is not the thing being removed — it is per-token,
    // not per-minute, and it is how a bid is attributed to a person. Asserted so
    // that "the agent talks to no third party" is never mis-stated as true.
    expect(agentSrc).toContain('cognito-idp.');
  });
});

describe('the bot spends an upstream call only when one is warranted', () => {
  it('NEVER goes live outside a raid — not even for an open auction', () => {
    // Hitya, 2026-08-27: "the live dkp checkin should be raids-only since users
    // are getting more dkp with each tick. the rest of the time the checkin
    // should be just to the bot and database."
    //
    // Ticks are the only thing that moves a balance, and ticks only happen
    // while raiding — so an off-raid live call buys a number the mirror already
    // has, on somebody else's bill. The FIRST cut of this policy let an open
    // auction alone justify a refresh, and an auction can sit open off-raid (a
    // market night, a late award), which would have kept a trickle running all
    // week. This case is that mistake, pinned.
    expect(decide({ cache: null, auctionsLive: true, inRaid: false }).refresh).toBe(false);
    expect(decide({ cache: { at: 0, models: [] }, auctionsLive: true, inRaid: false }).refresh).toBe(false);
    // …and it stays refused no matter how stale the cached figure gets.
    expect(decide({ cache: { at: 1_000_000 - 7 * 864e5, models: [] }, auctionsLive: true, inRaid: false }).refresh)
      .toBe(false);
  });

  it('refreshes during a raid even with nothing up for bid', () => {
    expect(decide({ cache: null, auctionsLive: false, inRaid: true }))
      .toEqual({ refresh: true, reason: 'raid-window' });
  });

  it('refreshes faster during a raid once an auction opens', () => {
    expect(decide({ cache: null, auctionsLive: true, inRaid: true }))
      .toEqual({ refresh: true, reason: 'auction-open' });
  });

  it('falls back to the mirror off-raid instead of showing nothing', () => {
    // The panel must still carry a number between raids — it just comes from
    // our own database. Reason codes say which, so the UI can label it.
    expect(decide({ cache: { at: 0, models: [] }, auctionsLive: false, inRaid: false }).reason)
      .toBe('off-raid-use-mirror');
    expect(decide({ cache: null, auctionsLive: false, inRaid: false }).reason)
      .toBe('off-raid-no-live-data');
    expect(botSrc).toContain('const m = await _familyDkpFromMirror(family);');
    expect(botSrc).toContain("out = Number.isFinite(m?.family_total)");
  });

  it('computes the mirror figure in ONE place, shared with bid-history', () => {
    // It was inline in bid-history. Two hand-maintained copies of a DKP formula
    // is how the loot panel and the bid panel start disagreeing about what
    // somebody can afford.
    expect(botSrc.match(/async function _familyDkpFromMirror/g) || []).toHaveLength(1);
    expect(botSrc).toContain('try { dkp = await _familyDkpFromMirror(family); }');
  });

  it('holds a bidding-fresh figure for a minute, not for every poll', () => {
    const at = 1_000_000 - h._PANEL_DKP_TTL_BIDDING_MS + 1;
    expect(decide({ cache: { at, models: [] }, auctionsLive: true, inRaid: true }).refresh).toBe(false);
    const stale = 1_000_000 - h._PANEL_DKP_TTL_BIDDING_MS;
    expect(decide({ cache: { at: stale, models: [] }, auctionsLive: true, inRaid: true }).refresh).toBe(true);
  });

  it('is far slacker mid-raid when nothing is actually up for bid', () => {
    const at = 1_000_000 - h._PANEL_DKP_TTL_BIDDING_MS - 1;   // stale for bidding
    expect(decide({ cache: { at, models: [] }, auctionsLive: false, inRaid: true }).refresh).toBe(false);
    expect(h._PANEL_DKP_TTL_RAID_MS).toBeGreaterThan(h._PANEL_DKP_TTL_BIDDING_MS);
  });

  it('does not retry a failure immediately, even mid-auction', () => {
    // Otherwise a broken upstream turns into a poll storm against a third party
    // that is already having a bad time.
    expect(decide({ cache: { at: 999_000, failed: true }, auctionsLive: true, inRaid: true }))
      .toEqual({ refresh: false, reason: 'cached-failure' });
  });
});
