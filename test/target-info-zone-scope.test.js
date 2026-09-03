// test/target-info-zone-scope.test.js — Target Info stops hiding a third of the
// raid's debuffs.
//
// Hitya, live 2026-09-02, with a screenshot: "Debuffs don't show on Target Info
// but show on Extended Target." The Extended Target row carried Asphyxiate,
// Weakness and Tashanian on The Avatar of War; the Target Info panel for the
// same mob showed none of them.
//
// ⚠ THE TWO SURFACES DISAGREED ON THE SAME NULL, AND THAT WAS THE BUG.
// `_zoneScopeKeep` DROPS a row whose observer it cannot place — but unknown is
// the ORDINARY case: `_liveZoneMap` only sees 10 minutes of
// character_live_state while buff_casts is read 3 hours back, and a raider not
// running Mimic is never in it at all. Measured on live data: 8 of the 21
// observers of the last two hours of debuffs had no resolvable zone. Extended
// Target's own code says the opposite — "a raider whose zone we can't resolve
// rides along rather than vanishing — never hide data on missing info".
//
// The discriminator #141 actually needed is whether the NAME is ambiguous.
// eqemu_npc_types.id encodes its zone (id = zoneid*1000 + n), so the distinct
// zone count is a column read. Grounded, not guessed: a_geonid — #141's own
// worked example — is 2 zones; The_Avatar_of_War is 1.
//
// Run: npx vitest run test/target-info-zone-scope.test.js

import { describe, it, expect } from 'vitest';
import { readSource, BOT_INDEX, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const src = readSource(BOT_INDEX);

const { _zoneScopeKeep, _zoneScopeKeepForName } = evalBlock(
  sliceBlock(
    src,
    'function _zoneScopeKeep(requesterZone, observerZone) {',
    '\n// Sibling of the above, one level down: same NAME, same ZONE, DIFFERENT SPAWN.',
  ),
  ['_zoneScopeKeep', '_zoneScopeKeepForName'],
);

const KAEL = 'Kael Drakkel';
const CC   = 'Crystal Caverns';

describe('the reported case: a unique boss name', () => {
  it('keeps a debuff whose observer we cannot place', () => {
    // The Avatar of War exists in one zone, so nobody can be observing a
    // different one. This is the row that used to vanish.
    expect(_zoneScopeKeepForName(KAEL, null, 1)).toBe(true);
  });

  it('keeps it even when the observer is long gone from live-state', () => {
    // Same thing from the caller's side: a null zone is a missing record, not
    // evidence the observation was somewhere else.
    expect(_zoneScopeKeepForName(KAEL, null, 1)).toBe(true);
    expect(_zoneScopeKeepForName(KAEL, null, 0)).toBe(true);   // name not in catalog → keep
  });
});

describe('#141 is not reopened', () => {
  it('still drops an unplaceable observer for a name that spans zones', () => {
    // "a geonid" is genuinely 2 zones (Crystal Caverns and The Wakening Land),
    // which is the case #141 was written for.
    expect(_zoneScopeKeepForName(KAEL, null, 2)).toBe(false);
  });

  it('still drops a placeable observer who is in the WRONG zone', () => {
    // Unchanged behaviour, and it must stay unchanged for both name shapes —
    // a known-different zone is proof, whatever the name.
    expect(_zoneScopeKeepForName(KAEL, CC, 1)).toBe(false);
    expect(_zoneScopeKeepForName(KAEL, CC, 2)).toBe(false);
  });

  it('keeps an observer in the requester\'s own zone', () => {
    expect(_zoneScopeKeepForName(KAEL, KAEL, 1)).toBe(true);
    expect(_zoneScopeKeepForName(KAEL, KAEL, 2)).toBe(true);
  });

  it('keeps everything when the REQUESTER has no zone', () => {
    // Pre-existing fail-open; relaxing the observer side must not disturb it.
    expect(_zoneScopeKeepForName(null, CC, 2)).toBe(true);
    expect(_zoneScopeKeepForName(null, null, 2)).toBe(true);
  });
});

describe('the original predicate is untouched', () => {
  it('still drops on an unknown observer zone', () => {
    // _zoneScopeKeep is documented and depended on elsewhere. The fix wraps it
    // rather than editing it, so this contract must still hold exactly.
    expect(_zoneScopeKeep(KAEL, null)).toBe(false);
    expect(_zoneScopeKeep(KAEL, CC)).toBe(false);
    expect(_zoneScopeKeep(KAEL, KAEL)).toBe(true);
    expect(_zoneScopeKeep(null, null)).toBe(true);
  });

  it('differs from the wrapper ONLY on the unknown-observer + unique-name case', () => {
    // Anything else changing would be a behaviour change nobody asked for.
    for (const [rq, ob] of [[KAEL, CC], [KAEL, KAEL], [null, CC], [null, null]]) {
      for (const zones of [1, 2]) {
        expect(_zoneScopeKeepForName(rq, ob, zones), `${rq}/${ob}/${zones}`)
          .toBe(_zoneScopeKeep(rq, ob));
      }
    }
    expect(_zoneScopeKeepForName(KAEL, null, 1)).not.toBe(_zoneScopeKeep(KAEL, null));
  });
});

// How many zones a name spans is what the whole relaxation turns on, so its two
// fail-open paths need pinning: a name the catalog does not know, and a lookup
// that throws. Both must answer "1" (unambiguous → keep), because hiding data
// on missing info is the failure this fix exists to correct.
function loadCounter(supabaseStub) {
  return evalBlock(
    `const require = ${supabaseStub};
`
    + sliceBlock(
        readSource(BOT_INDEX),
        'const _NAME_ZONES_TTL_MS =',
        '\n// Zone scope for a row whose observer we may not be able to place.',
      ),
    ['_nameZoneCount'],
  );
}
const stub = (impl) => `(() => ({ isEnabled: () => true, select: ${impl} }))`;

describe('counting the zones a name spans', () => {
  it('counts distinct zones from the id encoding (id = zoneid*1000 + n)', async () => {
    // The REAL a_geonid rows from our mirror: 119026 in The Wakening Land
    // (zone 119) and 121013 + 121067 in Crystal Caverns (zone 121) — #141's own
    // worked example. Both ids sit in the same 100000-block on purpose, so a
    // wrong divisor collapses them to one zone and this fails; an earlier draft
    // used ids that survived that mutation by luck.
    const { _nameZoneCount } = loadCounter(stub(
      `async () => [{ id: 119026 }, { id: 121013 }, { id: 121067 }]`));
    expect(await _nameZoneCount('a geonid')).toBe(2);
  });

  it('reports one zone for a unique boss', async () => {
    const { _nameZoneCount } = loadCounter(stub(`async () => [{ id: 118001 }]`));
    expect(await _nameZoneCount('The Avatar of War')).toBe(1);
  });

  it('treats a name the catalog does not know as unambiguous', async () => {
    // An instanced or renamed mob with no npc_types row must not be silently
    // hidden — we cannot look it up, which is not evidence against it.
    const { _nameZoneCount } = loadCounter(stub(`async () => []`));
    expect(await _nameZoneCount('something we have never seen')).toBe(1);
  });

  it('fails OPEN when the lookup throws', async () => {
    // A Supabase hiccup must not blank Target Info raid-wide.
    const { _nameZoneCount } = loadCounter(stub(`async () => { throw new Error('boom'); }`));
    expect(await _nameZoneCount('The Avatar of War')).toBe(1);
  });

  it('underscores the name, because npc_types stores it that way', async () => {
    let asked = '';
    const { _nameZoneCount } = loadCounter(
      `(() => ({ isEnabled: () => true, select: async (t, q) => { globalThis.__q = q; return [{ id: 118001 }]; } }))`);
    await _nameZoneCount('The Avatar of War');
    asked = globalThis.__q || '';
    expect(asked).toContain('The_Avatar_of_War');
  });
});

describe('both relays actually use it', () => {
  const bot = stripJs(readSource(BOT_INDEX));
  it('target-buffs filters through the name-aware wrapper', () => {
    expect(bot).toContain('if (!_zoneScopeKeepForName(requesterZone, observerZone, _nameZones)) continue;');
  });
  it('target-casts filters through the same wrapper', () => {
    expect(bot).toContain('if (!_zoneScopeKeepForName(requesterZone, casterZone, _nameZones)) continue;');
  });
});
