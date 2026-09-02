// test/mobinfo-spawn-id-agent.test.js — the AGENT half of scoping Target Info
// effects to a spawn instead of a name.
//
// Hitya, 2026-09-02: "we also need to incorporate the spawn ID into the target
// info window so we dedup those effects between same named mobs, off of spawn
// id." Bot half + the read filter: test/target-info-spawn-id-scope.test.js.
//
// ⚠ AN ID IS PROVABLE FAR LESS OFTEN THAN IT SOUNDS, and pretending otherwise
// is the way this feature turns into wrong data. A landing line names its target
// by NAME; the pipe carries a spawn id for exactly one mob — the observer's own
// current target. A cleric who was on the tank when the debuff landed cannot say
// which of three same-name adds took it. Guessing there is worse than null,
// because the read side TRUSTS a present id and drops rows that disagree.
//
// Run: npx vitest run test/mobinfo-spawn-id-agent.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import { readSource, AGENT_INDEX, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const src = readSource(AGENT_INDEX);

// Both helpers, run for real. End-anchored on the NEXT declaration, never on
// either body — a mutation must fail an assertion, not break the slice.
function build() {
  return evalBlock(
    'const _zealState = {};\n'
    + sliceBlock(src, 'function _normMobName(v) {', '\n// Record one observed landing under its TARGET NAME')
    + '\nfunction put(ch, name, id){ _zealState[ch] = { target_name: name, target_id: id }; }',
    ['_normMobName', '_provableTargetId', 'put'],
  );
}
let h;
beforeEach(() => { h = build(); });

describe('proving which spawn a landing hit', () => {
  it('returns the id when the observer was targeting that mob', () => {
    h.put('Hitya', 'a thought horror evoker', 4471);
    expect(h._provableTargetId('Hitya', 'a thought horror evoker')).toBe(4471);
  });

  // ⚠ The case that makes null the normal answer.
  it('returns null when the observer was targeting something else', () => {
    h.put('Hitya', 'Abrahms', 991);
    expect(h._provableTargetId('Hitya', 'a thought horror evoker')).toBe(null);
  });

  it('returns null when the client sends no id at all (every released Zeal)', () => {
    h.put('Hitya', 'a thought horror evoker', null);
    expect(h._provableTargetId('Hitya', 'a thought horror evoker')).toBe(null);
  });

  it('returns null for an observer we have no pipe state for', () => {
    expect(h._provableTargetId('Kazmodon', 'a thought horror evoker')).toBe(null);
  });

  // ⚠ Instanced raid mobs are spelled differently by the two sources — the Zeal
  // gauge says "#Diabo_Xi_Va_Temariel", the landing emote says "Diabo Xi Va
  // Temariel". A raw compare would fail on exactly the bosses this matters for.
  it('matches an instanced mob across the two spellings', () => {
    h.put('Hitya', '#Diabo_Xi_Va_Temariel', 3312);
    expect(h._provableTargetId('Hitya', 'Diabo Xi Va Temariel')).toBe(3312);
  });

  it('matches the observer name case-insensitively', () => {
    h.put('Hitya', 'Lord of Ire', 7);
    expect(h._provableTargetId('hitya', 'lord of ire')).toBe(7);
  });

  it('treats spawn id 0 as a real id', () => {
    h.put('Hitya', 'Lord of Ire', 0);
    expect(h._provableTargetId('Hitya', 'Lord of Ire')).toBe(0);
  });

  it('is null-safe on missing arguments', () => {
    expect(h._provableTargetId(null, 'x')).toBe(null);
    expect(h._provableTargetId('Hitya', '')).toBe(null);
  });
});

describe('wiring', () => {
  const agent = stripJs(src);

  it('stamps the id on both landing paths, before the upload push', () => {
    expect(agent).toContain('bcEvt.target_id = _provableTargetId(b.character, bcEvt.target);');
    expect(agent).toContain('dbEvt.target_id = _provableTargetId(b.character, dbEvt.target);');
    // ...and the stamp precedes THIS path's buff_casts enqueue, or the upload
    // ships without the id it just worked out. Scoped to the live-tail block:
    // there are three push sites and the other two are backfill (below).
    const live = sliceBlock(agent, '        if (bcEvt && !_sourceExcluded) {', '\n          recordTargetBuffLanding(bcEvt);');
    const stampAt = live.indexOf('bcEvt.target_id = _provableTargetId');
    const pushAt  = live.indexOf('buffCastBuffer.push(bcEvt)');
    expect(stampAt).toBeGreaterThan(-1);
    expect(pushAt).toBeGreaterThan(stampAt);
  });

  // ⚠ THE BACKFILL PATHS MUST NOT STAMP, and this is not an oversight to tidy.
  // _provableTargetId reads the LIVE Zeal gauge; a --since replay is feeding it
  // lines from hours ago. A stamp there attaches the spawn id of whatever the
  // user is targeting NOW to a historical landing, and it misfires exactly when
  // the names match — the same-name case the id exists to resolve. The read
  // side trusts a present id, so this would be wrong data, not missing data.
  it('never stamps an id on a backfilled landing', () => {
    for (const anchor of ['const bcEvt = parseBuffLanding(line, f.character);',
                          'const bcEvt = parseBuffLanding(line, b.character);']) {
      const at = agent.indexOf(anchor);
      expect(at).toBeGreaterThan(-1);
      expect(agent.slice(at, at + 200)).not.toContain('_provableTargetId');
    }
  });

  it('stores the id on the local landing entry', () => {
    expect(agent).toContain('target_id: Number.isFinite(bcEvt.target_id) ? bcEvt.target_id : null,');
  });

  // ⚠ Filtering at READ time, on a NAME-keyed map, on purpose: an id-keyed map
  // would fragment a mob's effect list the moment one landing was unprovable,
  // which is most of them.
  it('filters at read time and keeps unproven entries', () => {
    const fn = sliceBlock(agent, 'function targetBuffsFor(targetLower, wantId) {', '\n  if (mp.size === 0)');
    expect(fn).toContain('if (wantId != null && b && b.target_id != null && Number(b.target_id) !== Number(wantId)) continue;');
    // never deletes — the entry still belongs to its own mob
    expect(fn).not.toMatch(/mp\.delete\(k\);\s*continue;\s*\}\s*const durSecs/);
  });

  it('sends the id to the relay and keys its cache by it', () => {
    expect(agent).toContain("url += '&target_id=' + encodeURIComponent(targetId)");
    expect(agent).toContain('fetchTargetBuffs(st.target_name, selfChar, _curIdForRelay)');
    expect(agent).toContain('_relayCacheKey(st.target_name, selfChar, _curIdForRelay)');
  });

  // ⚠ target-casts shares _relayCacheKey and is NOT spawn-scoped yet. Folding
  // the id into the key both use would leave fetchTargetCasts computing a key
  // it never writes — a cache that misses every poll and refetches forever.
  it('leaves the target-casts key alone', () => {
    expect(agent).toContain('fetchTargetCasts(st.target_name, selfChar);');
    expect(agent).toContain('const relayKey = _relayCacheKey(st.target_name, selfChar);');
  });
});
