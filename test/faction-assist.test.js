// utils/factionAssist.js — which faction a mob is on, which it will help, and who helps IT.
// The guild lead, 2026-10-06, on "an enforcer" in Plane of Justice: Target Info said only "No
// faction change recorded for this mob", while a High Guardian of Justice had come to its aid.
//
// Behaviour first: the real module over a fixture of that zone (the enforcer, two same-name
// High Guardians where only one assists through its KOS entry, the helper rules one by one),
// the real loader over a fake PostgREST that enforces the 1,000-row cap, and the real
// _buildMobInfo (sliced out of index.js) for what the answer looks like on the wire.
//
// Fixture names are the catalog's own NPC and faction names (game data, not members).
//
// Run: npx vitest run test/faction-assist.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, stripJs, BOT_INDEX } from './_source-slice.js';
import { installFakePostgrest } from './_fake-fetch-postgrest.js';

const nodeRequire = createRequire(import.meta.url);
const supabase = nodeRequire('../utils/supabase.js');
const FA = nodeRequire('../utils/factionAssist.js');
const { buildIndex, assistFor, getIndex } = FA;

// ── The Plane of Justice fixture ─────────────────────────────────────────────────────
const FACTION_NAMES = [
  { id: 5017, name: 'KOS' }, { id: 5037, name: 'Planes_Neutral' }, { id: 1625, name: 'Guardians of Justice' },
  { id: 1626, name: 'Jacosh Steldenn' }, { id: 1627, name: 'Prisoners of Justice' },
  { id: 1628, name: 'Creatures of Justice' }, { id: 1657, name: 'Rats of Justice' }, { id: 7000, name: 'Elsewhere' },
];
const NPC_FACTIONS = [
  { id: 79,  primaryfaction: 5017, ignore_primary_assist: 0 },   // KOS_assist
  { id: 563, primaryfaction: 1625, ignore_primary_assist: 0 },   // Guardians of Justice
  { id: 1407, primaryfaction: 1626, ignore_primary_assist: 0 },  // the other High Guardian
  { id: 1010, primaryfaction: 5017, ignore_primary_assist: 0 },
  { id: 900, primaryfaction: 5017, ignore_primary_assist: 1 },   // KOS, but will not help its own
  { id: 901, primaryfaction: 5017, ignore_primary_assist: 1 },   // same, yet it lists KOS with 1
  { id: 902, primaryfaction: 7000, ignore_primary_assist: 0 },   // lists KOS with 0 and with -1
  { id: 903, primaryfaction: 0,    ignore_primary_assist: 0 },   // no primary faction at all
];
const ENTRIES = [   // npc_value of every row; the loader reads only the ones above 0
  { npc_faction_id: 79,  faction_id: 5017, npc_value: 1 },
  { npc_faction_id: 563, faction_id: 5037, npc_value: 1 },
  { npc_faction_id: 563, faction_id: 1627, npc_value: 1 },
  { npc_faction_id: 563, faction_id: 1628, npc_value: 1 },
  { npc_faction_id: 563, faction_id: 5017, npc_value: 1 },
  { npc_faction_id: 563, faction_id: 1657, npc_value: 1 },
  { npc_faction_id: 1407, faction_id: 1626, npc_value: 1 },
  { npc_faction_id: 1407, faction_id: 1625, npc_value: 1 },
  { npc_faction_id: 1010, faction_id: 5017, npc_value: 1 },
  { npc_faction_id: 901, faction_id: 5017, npc_value: 1 },
  { npc_faction_id: 902, faction_id: 5017, npc_value: 0 },
  { npc_faction_id: 902, faction_id: 1625, npc_value: -1 },
  { npc_faction_id: 903, faction_id: 5017, npc_value: 1 },        // lists KOS, but has no primary
];
const NPCS = [
  { id: 201027, name: 'an_enforcer', npc_faction_id: 79 },            // the subject
  { id: 201028, name: 'an_enforcer', npc_faction_id: 79 },            // its own kind: never "help"
  { id: 201029, name: '#an_enforcer', npc_faction_id: 79 },           // the same name once the # is off
  { id: 201446, name: 'High_Guardian_of_Justice', npc_faction_id: 563 },   // helps through its KOS entry
  { id: 201079, name: 'High_Guardian_of_Justice', npc_faction_id: 1407 },  // does not
  { id: 201035, name: 'Gaoler_of_Justice', npc_faction_id: 563 },
  { id: 201100, name: 'a_blood_leech', npc_faction_id: 79 },          // same primary
  { id: 201106, name: 'a_blood_leech', npc_faction_id: 79 },          // a second body of that name
  { id: 201101, name: '#a_dark_nemesis', npc_faction_id: 1010 },      // same primary AND lists it
  { id: 201102, name: 'an_ignorer', npc_faction_id: 900 },            // ignore_primary_assist = 1
  { id: 201103, name: 'a_listener', npc_faction_id: 901 },            // ignores primary, lists KOS
  { id: 201104, name: 'a_neutral_watcher', npc_faction_id: 902 },     // npc_value 0 and -1
  { id: 201105, name: 'a_mute_thing', npc_faction_id: 903 },          // no primary, lists KOS
  { id: 201107, name: '_', npc_faction_id: 79 },                      // placeholder name
  { id: 202001, name: 'a_kos_mob_elsewhere', npc_faction_id: 79 },    // another zone
];
const fixture = () => ({ names: FACTION_NAMES, factions: NPC_FACTIONS, entries: ENTRIES, npcs: NPCS });
const IX = buildIndex(fixture());
const names = (list) => list.map(h => h.name);

describe('the enforcer in Plane of Justice', () => {
  const out = assistFor(IX, 201027);

  it('says which faction it is on, with the id the faction page is keyed by', () => {
    expect(out.faction_primary).toEqual({ id: 5017, name: 'KOS' });
  });

  it('lists the High Guardian that comes through its KOS entry, and only that one body', () => {
    const guardians = out.faction_assisted_by.filter(h => h.name === 'High Guardian of Justice');
    expect(guardians).toEqual([{ name: 'High Guardian of Justice', npc_id: 201446 }]);
  });

  it('answers with exactly the helpers the rule allows: cross-faction first, then its own faction, by name', () => {
    expect(out.faction_assisted_by).toEqual([
      // through another faction's entry (a mob with no primary of its own counts as another faction)
      { name: 'a mute thing', npc_id: 201105 },
      { name: 'Gaoler of Justice', npc_id: 201035 },
      { name: 'High Guardian of Justice', npc_id: 201446 },
      // sharing KOS
      { name: 'a blood leech', npc_id: 201100 },             // the lowest id of two bodies
      { name: 'a dark nemesis', npc_id: 201101 },            // # and underscores cleaned
      { name: 'a listener', npc_id: 201103 },                // ignore_primary_assist, but it lists KOS
    ]);
    expect(out.faction_assisted_by_more).toBe(0);
  });

  it('assists no faction of its own beyond its primary', () => {
    expect(out.faction_assists).toEqual([]);
  });
});

describe('the helper rules, one at a time', () => {
  const helpers = names(assistFor(IX, 201027).faction_assisted_by);

  it('ignore_primary_assist = 1 stops same-primary help (a mob that lists nothing, 201102)', () => {
    expect(helpers).not.toContain('an ignorer');
  });
  it('...but a helper that lists the faction with npc_value 1 still comes', () => {
    expect(helpers).toContain('a listener');
  });
  it('npc_value 0 and -1 are not assist (201104)', () => {
    expect(helpers).not.toContain('a neutral watcher');
  });
  it('a mob in another zone never helps, whatever its faction (202001)', () => {
    expect(helpers).not.toContain('a kos mob elsewhere');
  });
  it('mobs of the subject\'s own name are not help: same name, and the # form of it', () => {
    expect(helpers).not.toContain('an enforcer');
    expect(assistFor(IX, 201027).faction_assisted_by.some(h => h.npc_id === 201028 || h.npc_id === 201029)).toBe(false);
  });
  it('a placeholder "_" name is never listed', () => {
    expect(assistFor(IX, 201027).faction_assisted_by.some(h => h.npc_id === 201107)).toBe(false);
  });
  it('the other High Guardian (factions 1407, primary 1626) does not help the enforcer', () => {
    const lone = buildIndex({ ...fixture(), npcs: NPCS.filter(n => n.id !== 201446) });
    expect(names(assistFor(lone, 201027).faction_assisted_by)).not.toContain('High Guardian of Justice');
  });
});

describe('what a mob will help (faction_assists)', () => {
  it('lists every faction its npc_faction assists, its own primary left out, by name', () => {
    const out = assistFor(IX, 201446);
    expect(out.faction_primary).toEqual({ id: 1625, name: 'Guardians of Justice' });
    expect(out.faction_assists).toEqual([
      { id: 1628, name: 'Creatures of Justice' },
      { id: 5017, name: 'KOS' },
      { id: 5037, name: 'Planes_Neutral' },
      { id: 1627, name: 'Prisoners of Justice' },
      { id: 1657, name: 'Rats of Justice' },
    ]);
  });
  it('leaves the primary out even when the npc_faction lists it (1407 lists 1626, its own)', () => {
    expect(assistFor(IX, 201079).faction_assists).toEqual([{ id: 1625, name: 'Guardians of Justice' }]);
  });
  it('npc_value 0 and -1 rows are not assists (902)', () => {
    expect(assistFor(IX, 201104).faction_assists).toEqual([]);
  });
});

describe('who helps a guardian', () => {
  it('another High Guardian is the same NAME, so it is not listed; a Gaoler of the same faction is', () => {
    const out = assistFor(IX, 201446);
    expect(out.faction_assisted_by).toEqual([{ name: 'Gaoler of Justice', npc_id: 201035 }]);
  });
});

describe('a mob with no primary faction', () => {
  it('calls nobody, but still reports what it would help', () => {
    const out = assistFor(IX, 201105);
    expect(out.faction_primary).toBeNull();
    expect(out.faction_assisted_by).toEqual([]);
    expect(out.faction_assisted_by_more).toBe(0);
    expect(out.faction_assists).toEqual([{ id: 5017, name: 'KOS' }]);
  });
  it('two mobs with no primary are not "sharing a faction" (0 is none, not a faction)', () => {
    const ix = buildIndex({ ...fixture(), npcs: [...NPCS, { id: 201108, name: 'a_mute_friend', npc_faction_id: 903 }] });
    expect(assistFor(ix, 201105).faction_assisted_by).toEqual([]);
  });
});

describe('answers nothing for what the catalog cannot place', () => {
  it('a mob with no npc_faction, an unknown id, a bad id, a dangling npc_faction, no index', () => {
    const ix = buildIndex({ ...fixture(), npcs: [...NPCS, { id: 201200, name: 'a_bare_thing', npc_faction_id: 0 }, { id: 201201, name: 'a_lost_thing', npc_faction_id: 4242 }] });
    expect(assistFor(ix, 201200)).toBeNull();
    expect(assistFor(ix, 201201)).toBeNull();
    expect(assistFor(ix, 999999)).toBeNull();
    expect(assistFor(ix, 'x')).toBeNull();
    expect(assistFor(ix, null)).toBeNull();
    expect(assistFor(null, 201027)).toBeNull();
  });
  it('a faction the name list lacks still comes back, labelled by its id', () => {
    const ix = buildIndex({ ...fixture(), names: FACTION_NAMES.filter(n => n.id !== 5017) });
    expect(assistFor(ix, 201027).faction_primary).toEqual({ id: 5017, name: 'Faction 5017' });
  });
});

describe('the cap and the dedupe', () => {
  // 30 mobs of KOS, 1 of them a cross-faction helper whose name sorts LAST.
  const crowd = () => {
    const npcs = [{ id: 300001, name: 'a_subject', npc_faction_id: 79 }];
    for (let i = 0; i < 30; i++) npcs.push({ id: 300100 + i, name: `a_kos_${String(i).padStart(2, '0')}`, npc_faction_id: 79 });
    npcs.push({ id: 300500, name: 'zzz_guardian', npc_faction_id: 563 });
    return buildIndex({ ...fixture(), npcs });
  };

  it('caps at 12 and counts the rest', () => {
    const out = assistFor(crowd(), 300001);
    expect(out.faction_assisted_by).toHaveLength(12);
    expect(out.faction_assisted_by_more).toBe(31 - 12);
  });
  it('the cap keeps the cross-faction helper even though its name sorts last', () => {
    const out = assistFor(crowd(), 300001);
    expect(out.faction_assisted_by[0]).toEqual({ name: 'zzz guardian', npc_id: 300500 });
    expect(out.faction_assisted_by[1].name).toBe('a kos 00');
    expect(out.faction_assisted_by[11].name).toBe('a kos 10');
  });
  it('the cap is a parameter', () => {
    const out = assistFor(crowd(), 300001, { cap: 3 });
    expect(out.faction_assisted_by).toHaveLength(3);
    expect(out.faction_assisted_by_more).toBe(28);
  });
  it('exactly at the cap leaves nothing "more"', () => {
    const ix = buildIndex({ ...fixture(), npcs: [{ id: 300001, name: 'a_subject', npc_faction_id: 79 },
      ...Array.from({ length: 12 }, (_, i) => ({ id: 300100 + i, name: `a_kos_${i}`, npc_faction_id: 79 }))] });
    const out = assistFor(ix, 300001);
    expect(out.faction_assisted_by).toHaveLength(12);
    expect(out.faction_assisted_by_more).toBe(0);
  });
  it('bodies of one name collapse to one entry; the cross-faction body wins over the lower id', () => {
    const ix = buildIndex({ ...fixture(), npcs: [
      { id: 300001, name: 'a_subject', npc_faction_id: 79 },
      { id: 300010, name: 'a_twin', npc_faction_id: 79 },      // same faction, lower id
      { id: 300020, name: 'a_twin', npc_faction_id: 563 },     // through the entry
    ] });
    expect(assistFor(ix, 300001).faction_assisted_by).toEqual([{ name: 'a twin', npc_id: 300020 }]);
  });
  it('the name test is case-blind: a_Twin and a_twin are one entry', () => {
    const ix = buildIndex({ ...fixture(), npcs: [
      { id: 300001, name: 'a_subject', npc_faction_id: 79 },
      { id: 300010, name: 'a_Twin', npc_faction_id: 79 },
      { id: 300020, name: 'a_twin', npc_faction_id: 79 },
    ] });
    expect(assistFor(ix, 300001).faction_assisted_by).toHaveLength(1);
  });
});

// ── The loader: the real supabase layer over a fake PostgREST that enforces the cap ──────
describe('getIndex', () => {
  let fake;
  beforeEach(() => {
    FA._resetCache();
    supabase._resetBreaker();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { fake && fake.restore(); fake = null; vi.restoreAllMocks(); vi.useRealTimers(); FA._resetCache(); });

  // Past every 1,000-row page: 1,300 npc_factions, 2,600 assist entries, 2,500 NPCs over 3 zones.
  function big() {
    const factions = [], entries = [], npcs = [];
    for (let nf = 1; nf <= 1300; nf++) {
      factions.push({ id: nf, name: `KOS_${nf}`, primaryfaction: 10000 + nf, ignore_primary_assist: 0 });
      entries.push({ npc_faction_id: nf, faction_id: 20000 + (nf % 50), npc_value: 1, value: 0 });
      entries.push({ npc_faction_id: nf, faction_id: 30000 + (nf % 70), npc_value: 1, value: 0 });
      entries.push({ npc_faction_id: nf, faction_id: 40000, npc_value: 0, value: 0 });   // not an assist
    }
    for (let i = 0; i < 2500; i++) npcs.push({ id: 1000 * (1 + (i % 3)) + Math.floor(i / 3), name: `mob_${i}`, npc_faction_id: 1 + (i % 1300), level: 5 });
    const names = Array.from({ length: 1300 }, (_, i) => ({ id: 10001 + i, name: `Faction ${10001 + i}` }));
    return { eqemu_faction_list_full: names, eqemu_npc_faction: factions, eqemu_npc_faction_entries: entries, eqemu_npc_types: npcs };
  }

  it('reads every row of every table past the 1,000-row cap, ordered on a unique key', async () => {
    const tables = big();
    fake = installFakePostgrest({ tables });
    const ix = await getIndex(supabase);
    expect(ix.byNpcFaction.size).toBe(1300);
    let assists = 0;
    for (const f of ix.byNpcFaction.values()) assists += f.assists.size;
    expect(assists).toBe(2600);                                    // the npc_value 0 rows stay out
    let npcs = 0;
    for (const list of ix.byZone.values()) npcs += list.length;
    expect(npcs).toBe(2500);
    const q = (t) => fake.calls.filter(c => c.table === t).map(c => c.query);
    expect(q('eqemu_npc_faction_entries')[0]).toContain('order=npc_faction_id.asc,faction_id.asc');
    expect(q('eqemu_npc_faction_entries')[0]).toContain('npc_value=gt.0');
    expect(q('eqemu_npc_types')[0]).toContain('order=id.asc');
    expect(q('eqemu_npc_faction')[0]).toContain('order=id.asc');
    expect(q('eqemu_npc_types')).toHaveLength(3);                  // 2,500 rows = 3 pages
  });

  it('is built once, and the second ask is free (six-hour cache)', async () => {
    fake = installFakePostgrest({ tables: big() });
    const a = await getIndex(supabase);
    const callsAfterFirst = fake.calls.length;
    const b = await getIndex(supabase);
    expect(b).toBe(a);
    expect(fake.calls.length).toBe(callsAfterFirst);
  });

  it('rebuilds after six hours', async () => {
    vi.useFakeTimers();
    fake = installFakePostgrest({ tables: big() });
    const a = await getIndex(supabase);
    vi.setSystemTime(Date.now() + FA.TTL_MS - 1000);
    expect(await getIndex(supabase)).toBe(a);
    vi.setSystemTime(Date.now() + 2000);
    const b = await getIndex(supabase);
    expect(b).not.toBe(a);
  });

  it('three callers at once share one rebuild', async () => {
    fake = installFakePostgrest({ tables: big() });
    const [a, b, c] = await Promise.all([getIndex(supabase), getIndex(supabase), getIndex(supabase)]);
    expect(a).toBe(b); expect(b).toBe(c);
    expect(fake.calls.filter(x => x.table === 'eqemu_npc_faction')).toHaveLength(2);   // 1,300 rows = 2 pages, once
  });

  it('a failed page is null, not a partial index, and is not pinned for six hours', async () => {
    vi.useFakeTimers();
    const tables = big();
    fake = installFakePostgrest({ tables, failWhen: ({ table, query }) => table === 'eqemu_npc_types' && /offset=1000/.test(query) });
    expect(await getIndex(supabase)).toBeNull();
    const callsAfterFail = fake.calls.length;
    expect(await getIndex(supabase)).toBeNull();                   // inside the retry window: no new reads
    expect(fake.calls.length).toBe(callsAfterFail);
    fake.failWhen = null;
    vi.setSystemTime(Date.now() + FA.RETRY_MS + 1000);
    const ix = await getIndex(supabase);
    expect(ix).not.toBeNull();
    expect(ix.byZone.size).toBe(3);
  });

  it('a failed refresh keeps serving the index it already has', async () => {
    vi.useFakeTimers();
    fake = installFakePostgrest({ tables: big() });
    const first = await getIndex(supabase);
    fake.failWhen = ({ table }) => table === 'eqemu_npc_faction';
    vi.setSystemTime(Date.now() + FA.TTL_MS + 1000);
    expect(await getIndex(supabase)).toBe(first);
  });

  it('is null when Supabase is off', async () => {
    expect(await getIndex({ isEnabled: () => false })).toBeNull();
  });
});

// ── The wire: the real _buildMobInfo for the enforcer, with the catalog behind it ────────
describe('_buildMobInfo', () => {
  const SRC = readSource(BOT_INDEX);
  const slice = sliceBlock(SRC, 'async function _buildMobInfo(supabase, {', '\n  return mob;\n}');
  const helpers = [
    sliceBlock(SRC, 'function _mobCaseKey(n) {', '\n}'),
    sliceBlock(SRC, 'function _mobRowsForCase(rows, caseKey) {', '\n}'),
  ].join('\n');
  const GENDER = "const _GENDER_NAMES = { 0: 'male', 1: 'female', 2: 'neuter' };";
  const CLASSES = "const _MOB_CLASS_NAMES = { 1:'Warrior', 12:'Wizard' };";

  let fake, warns;
  beforeEach(() => {
    FA._resetCache();
    supabase._resetBreaker();
    warns = [];
    vi.spyOn(console, 'warn').mockImplementation((...a) => { warns.push(a.join(' ')); });
  });
  afterEach(() => { fake && fake.restore(); fake = null; vi.restoreAllMocks(); FA._resetCache(); });

  // The catalog tables the faction index reads, plus the one body the lookup resolves.
  function stack() {
    const bodies = NPCS.filter(n => n.npc_faction_id > 0).map(n => ({
      ...n, class: 1, level: 62, maxlevel: 62, hp: 1000, mana: 0, ac: 10, mr: 0, fr: 0, cr: 0, pr: 0, dr: 0,
      mindmg: 1, maxdmg: 2, runspeed: 1.25, npcspecialattks: '', special_abilities: '', raid_target: 0,
      bodytype: 1, npc_spells_id: 0, see_invis: 0, see_invis_undead: 0, see_hide: 0, see_improved_hide: 0, race: 1, gender: 0,
    }));
    // The lookup's own name query (an `or=` filter) is outside the fake's grammar; everything
    // else (the four catalog tables, paged) goes through the real layer and the cap.
    fake = installFakePostgrest({ tables: {
      eqemu_faction_list_full: FACTION_NAMES, eqemu_npc_faction: NPC_FACTIONS,
      eqemu_npc_faction_entries: ENTRIES, eqemu_npc_types: bodies,
    } });
    const sb = Object.assign(Object.create(supabase), {
      select: async (table, q) => {
        if (table === 'eqemu_npc_types' && q.startsWith('or=')) {
          const want = decodeURIComponent(q.slice('or=(name.ilike.'.length, q.indexOf(',name.ilike')));
          return bodies.filter(b => b.name.replace(/^#/, '').toLowerCase() === want.toLowerCase());
        }
        if (['eqemu_npc_drops', 'bosses_local', 'encounters'].includes(table)) return [];
        return supabase.select(table, q);
      },
      selectAllPaged: (t, q, o) => supabase.selectAllPaged(t, q, o),
    });
    return sb;
  }

  function build(factionRowsFor) {
    // eslint-disable-next-line no-new-func
    return new Function('mobSpecials', 'factionAssist', '_factionRowsFor', 'process', 'console',
      `${helpers}\n${GENDER}\n${CLASSES}\n${slice}\nreturn _buildMobInfo;`)(
      nodeRequire('../utils/mobSpecials.js'), FA, factionRowsFor || (async () => null), process, console);
  }
  const ask = (fn, sb, name, reqZoneId = 201) =>
    fn(sb, { name, norm: name.toLowerCase().replace(/\s+/g, '_'), caseKey: name.replace(/\s+/g, '_'), reqZoneId, reqGender: null });

  it('the enforcer carries its faction, who it assists and who assists it, beside the fields it always had', async () => {
    const sb = stack();
    const mob = await ask(build(async () => [{ name: 'KOS', value: -5 }]), sb, 'an_enforcer');
    expect(warns).toEqual([]);
    expect(mob).not.toBeNull();
    expect(mob.id).toBe(201027);
    expect(mob.factions).toEqual([{ name: 'KOS', value: -5 }]);        // untouched
    expect(mob.faction_primary).toEqual({ id: 5017, name: 'KOS' });
    expect(mob.faction_assists).toEqual([]);
    expect(mob.faction_assisted_by).toContainEqual({ name: 'High Guardian of Justice', npc_id: 201446 });
    expect(mob.faction_assisted_by_more).toBe(0);
  });

  it('a mob with no npc_faction gets none of the four fields', async () => {
    const sb = stack();
    fake.tables.eqemu_npc_types.push({ ...fake.tables.eqemu_npc_types[0], id: 201300, name: 'a_plain_thing', npc_faction_id: 0 });
    const mob = await ask(build(), sb, 'a_plain_thing');
    expect(mob).not.toBeNull();
    for (const k of ['faction_primary', 'faction_assists', 'faction_assisted_by', 'faction_assisted_by_more']) {
      expect(Object.prototype.hasOwnProperty.call(mob, k), k).toBe(false);
    }
  });

  it('a catalog that cannot be read costs the overlay nothing else', async () => {
    const sb = stack();
    fake.failWhen = ({ table }) => table === 'eqemu_npc_faction';
    const mob = await ask(build(), sb, 'an_enforcer');
    expect(mob).not.toBeNull();
    expect(mob.hp).toBe(1000);
    expect(Object.prototype.hasOwnProperty.call(mob, 'faction_primary')).toBe(false);
  });
});

// ── The hook in index.js, as text (comments stripped: the comment above it names every one) ──
describe('index.js wiring', () => {
  const src = stripJs(readSource(BOT_INDEX));
  const body = src.slice(src.indexOf('async function _buildMobInfo('), src.indexOf('\n// ── Zone packs'));

  it('requires the module', () => {
    expect(src).toMatch(/const factionAssist = require\('\.\/utils\/factionAssist'\);/);
  });
  it('looks the mob up by npc id, and adds the fields only through the spread', () => {
    expect(body).toMatch(/factionAssist\.assistFor\(ix, r\.id\)/);
    expect(body).toMatch(/\bfactions,\s*\n\s*\.\.\.\(assist \|\| \{\}\),\s*\n\s*\};/);
  });
  it('the zone packs build through the same function, so they carry the fields too', () => {
    expect(src).toMatch(/await _buildMobInfo\(supabase, \{ name: n,/);
  });
});
