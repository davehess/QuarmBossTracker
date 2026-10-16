// test/mobinfo-spawn-id-agent.test.js — the AGENT half of scoping Target Info
// effects to a spawn instead of a name.
//
// The guild lead, 2026-09-02: "we also need to incorporate the spawn ID into the target
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
    ['_normMobName', '_provableTargetId', '_landingTargetId', 'put'],
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

// FB-83: the landing line names the mob TYPE. With two "A War Boar"s up, a slow on boar B while this observer
// targets boar A matches A's name, so _provableTargetId alone stamped A's id onto B's slow.
describe('which landings may carry a spawn id (FB-83)', () => {
  it('a bystander landing on a generic name gets no id, even when the names match', () => {
    h.put('Hitya', 'A War Boar', 5101);
    expect(h._landingTargetId('Hitya', { target: 'A War Boar' })).toBe(null);
    expect(h._landingTargetId('Hitya', { target: 'an elder thought horror' })).toBe(null);
    expect(h._landingTargetId('Hitya', { target: 'the Ishva Mal' })).toBe(null);
  });

  it('a named mob (no article) is one spawn, so the observer\'s target id proves it', () => {
    h.put('Hitya', 'Lord of Ire', 7);
    expect(h._landingTargetId('Hitya', { target: 'Lord of Ire' })).toBe(7);
  });

  it('our own cast carries the id captured at cast time, generic name or not', () => {
    h.put('Hitya', 'A War Boar', 5101);   // targeting boar A now; the cast went to boar B
    expect(h._landingTargetId('Hitya', { target: 'A War Boar', _castTargetId: 5102 })).toBe(5102);
  });

  it('is null-safe', () => {
    expect(h._landingTargetId('Hitya', null)).toBe(null);
    expect(h._landingTargetId('Hitya', {})).toBe(null);
  });
});

// The read side: an id-less landing on a generic name, read for a specific spawn, comes back marked unproven.
describe('targetBuffsFor marks an unproven landing (FB-83)', () => {
  const { targetBuffsFor, _buffLandingsByTarget: STORE } = evalBlock(
    `
    const _buffLandingsByTarget = new Map();
    const FELL_OFF_LINGER_MS = 300000;
    function _isHotBuff(){ return false; }
    function _spellGood(){ return 0; }
    ` + src.match(/const _GENERIC_MOB_RX = [^\n]+/)[0] + '\n'
      + sliceBlock(src, 'function targetBuffsFor(targetLower, wantId) {', '\n// ── Caster cast-correlation for buff landings ')
      + '\n'
      + sliceBlock(src, 'const PACIFY_SPELLS = new Set([', '\n// ── EQ class-title → base class '),
    ['targetBuffsFor', '_buffLandingsByTarget'],
  );
  function seed(key, rows) {
    STORE.clear();
    STORE.set(key, new Map(rows.map(r => [r.name.toLowerCase(), { landed_at: Date.now(), dur_ticks: 10, ...r }])));
  }

  it('id-less on a generic name, read for a spawn: unproven', () => {
    seed('a war boar', [{ name: 'Tepid Deeds', target_name: 'A War Boar', target_id: null }]);
    expect(targetBuffsFor('a war boar', 5101)[0].unproven).toBe(true);
  });
  it('proven for this spawn: not unproven', () => {
    seed('a war boar', [{ name: 'Tepid Deeds', target_name: 'A War Boar', target_id: 5101 }]);
    expect(targetBuffsFor('a war boar', 5101)[0].unproven).toBe(false);
  });
  it('no spawn asked for (old Zeal): never marked', () => {
    seed('a war boar', [{ name: 'Tepid Deeds', target_name: 'A War Boar', target_id: null }]);
    expect(targetBuffsFor('a war boar', null)[0].unproven).toBe(false);
  });
  it('a named mob is never marked', () => {
    seed('lord of ire', [{ name: 'Tepid Deeds', target_name: 'Lord of Ire', target_id: null }]);
    expect(targetBuffsFor('lord of ire', 7)[0].unproven).toBe(false);
  });
});

describe('wiring', () => {
  const agent = stripJs(src);

  it('stamps the id on both landing paths, before the upload push', () => {
    expect(agent).toContain('bcEvt.target_id = _landingTargetId(b.character, bcEvt);');
    expect(agent).toContain('dbEvt.target_id = _landingTargetId(b.character, dbEvt);');
    // ...and the stamp precedes THIS path's buff_casts enqueue, or the upload
    // ships without the id it just worked out. Scoped to the live-tail block:
    // there are three push sites and the other two are backfill (below).
    const live = sliceBlock(agent, '        if (bcEvt && !_sourceExcluded) {', '\n          recordTargetBuffLanding(bcEvt);');
    const stampAt = live.indexOf('bcEvt.target_id = _landingTargetId');
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
      expect(agent.slice(at, at + 200)).not.toContain('_landingTargetId');
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

  // Both cross-client relays are spawn-scoped as of agent 3.6.24, so they share
  // ONE id-keyed cache key again. ⚠ The invariant that matters is that whatever
  // key a fetch WRITES is the key the reader COMPUTES — when only buffs was
  // scoped, folding the id into the shared key would have left the casts cache
  // missing every poll and refetching forever.
  it('casts and buffs share one id-keyed cache key, and both send the id', () => {
    expect(agent).toContain('const relayKey = _relayCacheKey(st.target_name, selfChar, _curIdForRelay);');
    expect(agent).toContain('fetchTargetCasts(st.target_name, selfChar, _curIdForRelay)');
    expect(agent).toContain('fetchTargetBuffs(st.target_name, selfChar, _curIdForRelay)');
    expect(agent).toContain('_targetCastsByName.get(relayKey)');
    expect(agent).toContain('_targetBuffsByName.get(relayKey)');
  });

  // A cast is the caster's OWN target, so there is nothing to prove — but the
  // name check still matters: a cast line can arrive a beat after they switched
  // target, and stamping the new id onto the old target's cast is worse than
  // sending nothing.
  it('stamps the caster\'s own target id on both cast uploads', () => {
    expect(agent).toContain('target_id: _ownTargetIdFor(character, target),');
    expect(agent).toContain('target_id: _ownTargetIdFor(character, prev.target),');
  });
});
