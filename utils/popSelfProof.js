// utils/popSelfProof.js — the two PoP flag proofs the site collects besides Mimic's pop_flags, in the bot's terms.
//
// The guild lead, 2026-10-14 (raid night): the hail board listed raiders who already held the flag it was
// asking them to hail for. It read pop_flags only. The site already counts two more kinds of evidence, and
// both come from people who may not run Mimic:
//   ticks — a member's own checklist tick on /pop/guide (table pop_guide_ticks), their word for a step done;
//   /who  — a character seen by /who inside a plane holds that plane's gate (RPC pop_who_sightings), so a
//           sighting in Torment proves the Crypt of Decay chain that leads to it.
//
// ⚠ These two tables are COPIES of web/lib (TypeScript, which the bot cannot load): WHO_ZONE + whoProves in
// web/lib/popWho.ts, and the guide item → flag column of web/lib/popGuide.ts with the `flag:` rule of
// web/lib/popSelfFlags.ts. test/hail-board.test.js imports the originals and fails when a copy drifts, so a
// gate or guide step edited on the site cannot quietly leave the board behind. Edit both together.
'use strict';

const popFlagStages = require('./popFlagStages');

// A /who zone (the server's short name, or the long name a plain /who footer prints, lower-cased) → the
// chart's zone key. Instanced copies and open planes are absent on purpose: they prove nothing.
const WHO_ZONE = {
  postorms: 'storms', povalor: 'valor', codecay: 'cod', nightmareb: 'ponb', potorment: 'torment',
  bothunder: 'bot', hohonora: 'hoh', hohonorb: 'hohb', potactics: 'tactics', solrotower: 'solro',
  poeartha: 'earth', poearthb: 'poeb', poair: 'air', powater: 'water', pofire: 'fire',
  potimea: 'time', potimeb: 'time',
  'plane of storms': 'storms', 'plane of valor': 'valor', 'the crypt of decay': 'cod',
  'the lair of terris thule': 'ponb', 'torment, the plane of pain': 'torment', 'bastion of thunder': 'bot',
  'halls of honor': 'hoh', 'temple of marr': 'hohb', 'drunder, the fortress of zek': 'tactics',
  'tower of solusek ro': 'solro', 'plane of earth': 'earth', 'plane of air': 'air', 'plane of water': 'water',
  'plane of fire': 'fire', 'plane of time': 'time',
};
const WHO_ZONE_NAMES = Object.keys(WHO_ZONE);

// Chart zone → every catalog flag a character standing there must hold (whoProves, already walked through
// the plane's way in and through the steps each gate implies).
const EARTH = ['zebuxoruk_2', 'askr_quest', 'trial_justice', 'agnarr_dead', 'marr_dead', 'hoh_trials', 'aerindar_dead'];
const TORMENT = ['fuirstel_5', 'grummus_dead', 'bert_dead', 'carprin_cycle', 'thelin_4', 'hedge_event', 'tthule_dead'];
const SOLRO = ['cipher_1', 'saryrn_dead', ...TORMENT, 'marr_dead', 'hoh_trials', 'aerindar_dead', 'trial_justice',
  'zeks_6', 'behemoth_dead', 'vallon_dead', 'tallon_dead'];
const FIRE = ['solro_dead', ...SOLRO];
const WHO_PROVES = {
  storms: ['trial_justice'], valor: ['trial_justice'], cod: ['grummus_dead'], ponb: ['hedge_event'],
  torment: TORMENT, bot: ['askr_quest', 'trial_justice'], hoh: ['aerindar_dead', 'trial_justice'],
  hohb: ['hoh_trials', 'aerindar_dead', 'trial_justice'], tactics: ['behemoth_dead'], solro: SOLRO,
  earth: EARTH, poeb: ['arbitor_dead', ...EARTH], air: EARTH, water: EARTH, fire: FIRE,
  time: ['time_1', 'fennin_dead', ...FIRE, 'coirnav_dead', 'zebuxoruk_2', 'askr_quest', 'agnarr_dead',
    'rathe_dead', 'arbitor_dead', 'xegony_dead'],
};

// Guide checklist item key → the flag a tick of it reports (only the items that name one). A tick of a flag
// no guide step names is stored as `flag:<flag_key>`.
const FLAG_TICK_PREFIX = 'flag:';
const GUIDE_TICK_FLAG = {
  flag_grummus: 'grummus_dead', justice_mavuin_hail: 'trial_justice', flag_behemoth: 'behemoth_dead',
  flag_hedge: 'hedge_event', flag_tthule: 'tthule_dead', flag_carprin: 'carprin_cycle', flag_bert: 'bert_dead',
  storms_zone_bot: 'askr_quest', flag_aerindar: 'aerindar_dead', flag_keeper: 'keeper_dead',
  flag_saryrn: 'saryrn_dead', flag_agnarr: 'agnarr_dead', flag_marr: 'marr_dead', maelin_cipher: 'cipher_1',
  flag_vallon: 'vallon_dead', flag_tallon: 'tallon_dead', zeks_maelin: 'zeks_6', flag_rallos: 'rallos_dead',
  zebuxoruk_maelin: 'zebuxoruk_2', flag_solro_minis: 'solro_minis', flag_solro: 'solro_dead',
  flag_fennin: 'fennin_dead', flag_avatars_air: 'avatars_air', flag_xegony: 'xegony_dead',
  flag_coirnav: 'coirnav_dead', flag_arbitor: 'arbitor_dead', flag_rathe: 'rathe_dead', time_muon: 'time_1',
  flag_quarm: 'quarm_dead',
};

// A tick row's item_key → the flag keys it proves (the flag, and what a later step of its series implies,
// the same expansion the ingest applies to a recorded flag), or [].
function flagsForTickKey(itemKey) {
  const k = String(itemKey || '');
  const flag = Object.prototype.hasOwnProperty.call(GUIDE_TICK_FLAG, k) ? GUIDE_TICK_FLAG[k]
    : k.startsWith(FLAG_TICK_PREFIX) ? k.slice(FLAG_TICK_PREFIX.length) : null;
  if (!flag || flag === 'unmapped') return [];
  return [flag, ...(popFlagStages.STAGE_IMPLIES[flag] || [])];
}

// The /who zone names whose sighting proves at least one of `wanted` (a Set or array of flag keys): the RPC is
// asked only about those, so a board that needs the Torment chain does not read every sighting in Fire.
function whoZonesProving(wanted) {
  const want = new Set(wanted);
  return WHO_ZONE_NAMES.filter(n => WHO_PROVES[WHO_ZONE[n]].some(f => want.has(f)));
}

module.exports = { WHO_ZONE, WHO_ZONE_NAMES, WHO_PROVES, GUIDE_TICK_FLAG, FLAG_TICK_PREFIX, flagsForTickKey, whoZonesProving };
