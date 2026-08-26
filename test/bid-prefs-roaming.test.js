// Roaming bid prefs — the half that makes planned bids survive a reinstall.
//
// Hitya, 2026-08-26: "have these all local and sync them up to the DB and bring
// them back down to a local mimic." Before this, logsync.plannedbids.json /
// lootdismiss.json / bidfamily.json were LOCAL ONLY with no bot-side
// counterpart at all — reinstall Mimic, or play the Deck instead of the
// desktop, and every planned bid was gone.
//
// What these guard is mostly the failure modes, because a planned bid is what
// someone is about to spend DKP on:
//   - the write path MUST authenticate (rows are keyed by character name, so
//     an unauthenticated write is "overwrite anyone's planned bids");
//   - a corrupt local file must not become a multi-megabyte write;
//   - last-writer-wins must not be quietly turned into a merge, which would let
//     a stale machine resurrect a bid the user just cleared.
//
// Run: npx vitest run test/bid-prefs-roaming.test.js
import { describe, it, expect } from 'vitest';
import { readSource, BOT_INDEX } from './_source-slice.js';

const src = readSource(BOT_INDEX);
const handler = src.slice(
  src.indexOf('async function _handleAgentBidPrefs'),
  src.indexOf('async function _handleAgentPlaceBid'),
);

describe('the write path', () => {
  it('authenticates before writing anything', () => {
    // Rows are keyed by CHARACTER NAME, so an unauthenticated write is
    // "overwrite anyone else's planned bids".
    expect(handler).toContain('requireAgentAuth');
    expect(handler.indexOf('requireAgentAuth')).toBeLessThan(handler.indexOf('supabase.upsert'));
  });

  it('caps the request body', () => {
    expect(handler).toMatch(/total > 256 \* 1024/);
    expect(handler).toContain('413');
  });

  it('caps the row count so a corrupt file cannot become a huge write', () => {
    expect(handler).toMatch(/\.slice\(0, 2000\)/);
  });

  it('drops rows with no character or a bad item id rather than writing junk', () => {
    expect(handler).toMatch(/filter\(r => r\.character && Number\.isInteger\(r\.item_id\) && r\.item_id > 0\)/);
  });

  it('treats an empty batch as success, not an error', () => {
    // The agent syncs on a timer; an empty sync is the normal steady state and
    // must not log an error every cycle.
    expect(handler).toMatch(/written: 0/);
  });

  it('coerces autobid and dismissed to real booleans', () => {
    // A stray "false" string from a hand-edited file must not read as true —
    // and autobid reading true when the user meant false spends their DKP.
    expect(handler).toMatch(/autobid:\s*!!r\.autobid/);
    expect(handler).toMatch(/dismissed:\s*!!r\.dismissed/);
  });

  it('upserts on the full key so one character cannot clobber another', () => {
    expect(handler).toMatch(/'guild_id,character,item_id'/);
  });
});

describe('the design record', () => {
  const doc = readSource(new URL('../docs/DESIGN-bid-assist.md', import.meta.url).pathname);

  it('records the ask verbatim — this feature was lost once already', () => {
    expect(doc).toContain('tickbox for auto bid');
    // Apostrophe-agnostic: the doc quotes him with a straight ', and pinning
    // the curly one made this fail on a difference nobody cares about.
    expect(doc).toMatch(/we don.t ever want to default these on/);
  });

  it('pins the autobid safety rules that Hitya set', () => {
    // "we don't ever want to default these on in case they won other items for
    // the same slots" is the governing constraint, not a nice-to-have.
    expect(doc).toMatch(/Off for every item, always, until explicitly ticked/i);
    expect(doc).toMatch(/Never inferred/i);
    expect(doc).toMatch(/A win clears it/i);
    expect(doc).toMatch(/ceiling is required/i);
  });

  it('keeps autobid last, behind the two safe steps', () => {
    expect(doc).toMatch(/Autobid is deliberately last/i);
  });
});
