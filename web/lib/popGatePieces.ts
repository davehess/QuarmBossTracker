// What each PoP gate is BUILT FROM, piece by piece (the guild lead, 2026-11-01, shown a table of their
// characters against "Saryrn's half / Marr's half / Vallon's notes / Tallon's notes" and "only the Seer and
// Maelin left?": "this format is needed for the pop guide - the side bar where it says specifically what you're
// missing, not just the last thing mentioned").
//
// popFlags.ts says a zone needs `cipher_1` and `zeks_6`. That is true and tells a raider nothing: the cipher is
// two kill-halves joined by Maelin, the Zek reading is two sets of notes read by Maelin. This file is the one
// table that opens each requirement flag into the pieces it is made of, so a page can say which piece is missing.
//
// DERIVED vs HAND-LISTED
//   derived  the gates themselves (POP_ZONES[].requires, popFlags.ts), the flags a piece is proven by (the
//            catalog flags and the stage keys of utils/popFlagStages.js / popSteps.ts), the Seer's pending
//            memories (popRecital.ts PENDING_MEMORIES). test/pop-gate-pieces.test.js holds every key named here
//            to those tables, so a rename in one fails the build instead of silently emptying a column.
//   listed   which stages make up a requirement flag (the series order is popSteps.ts and the scripts:
//            eqemu_quest_scripts potranquility/, poknowledge/Grand_Librarian_Maelin.lua sha b1d5b43b, read
//            2026-10-27 by web/lib/popNextSteps.ts), and the words ("a Marr kill") that go in a verdict.
//   `verified: false` marks a piece whose make-up is a guess or rests on a catalog flag popFlags.ts itself calls
//            unverified. The page shows it with a "?" and says so; nothing here is invented to look complete.
//
// THE THREE KINDS
//   kill     a kill AND the hail to its Planar Projection (one stage). Missing means a kill is still owed.
//   task     a trial, a shrine, a hail: something done in a zone that is no kill and no hand-in.
//   handin   things carried to an NPC (Maelin, Elder Fuirstel, Thelin, Meldrath, the Tribunal). Never a kill.
//
// PENDING MEMORIES. A kill whose earlier step was skipped leaves a checklist flag ('cl_saryrn'): the server
// credited the kill and the Seer is HOLDING it until she is asked to 'unlock memories' (popRecital.ts). That is a
// kill DONE and a hand-in still owed to the Seer, so a piece names its `pending` key and shows ⏳ for it.
//
// KILL FLAGS ARE NOT STAGES. `saryrn_dead` says Saryrn died in a raid the character was credited in; it does not
// say the Planar Projection was hailed afterwards, and the half is given by that hail (saryrn_1). A piece's
// `proof` therefore lists the STAGE keys, and the kill flags sit apart in `kills`: a kill on record without its
// stage is "not recorded", never done. popGateStatus.ts closes held keys without expanding kill flags to match.

import { POP_ZONES, POP_FLAGS, type PopNode } from './popFlags';

export type PieceKind = 'kill' | 'task' | 'handin';

export type GatePiece = {
  key: string;          // unique across the whole table
  label: string;        // the column / checklist wording: "Saryrn's half"
  kind: PieceKind;
  /** pop_flags keys that prove the piece is DONE. Any one of them does, or every one when `all` is set. */
  proof: string[];
  all?: boolean;
  /** The Seer's checklist key ('cl_saryrn'): the kill is credited and held until she unlocks it. */
  pending?: string;
  /** Catalog kill flags that show the kill happened but not that the step after it was done. */
  kills?: string[];
  /** Who the piece is carried to, for a hand-in ("Maelin"); used to say who is left. */
  to?: string;
  /** What to say when the piece is the thing missing: "a Marr kill". */
  needs: string;
  verified: boolean;
  note?: string;
};

// requirement flag (an entry of POP_ZONES[].requires) → the pieces it is made of, in the order they happen.
export const REQ_PIECES: Record<string, GatePiece[]> = {
  // ── Tier one → two ────────────────────────────────────────────────────────
  // Justice flag, popSteps.ts justice (mavuin 1-3). Opens Valor and Storms.
  trial_justice: [
    { key: 'mavuin_case', label: "Mavuin's case", kind: 'task', proof: ['mavuin_1'], to: 'Mavuin', needs: "Mavuin's case (hail him)", verified: true },
    { key: 'justice_trial', label: 'A trial won', kind: 'task', proof: ['mavuin_2'], needs: 'a Justice trial won', verified: true },
    { key: 'mavuin_hail', label: 'Tribunal + Mavuin', kind: 'handin', proof: ['mavuin_3'], to: 'Mavuin', needs: 'the Tribunal and then Mavuin', verified: true },
  ],
  // Crypt of Decay: the pipe by Grummus. Only the kill is needed, so the Seer's held memory counts as the kill.
  grummus_dead: [
    { key: 'grummus_kill', label: 'Grummus dead', kind: 'kill', proof: ['grummus_dead', 'cl_grummus'], needs: 'a Grummus kill', verified: true },
  ],
  // Lower Crypt: Tarkil Adan's key. The hail prints no flag line (popSteps.ts), so only the Seer's read shows it.
  carprin_cycle: [
    { key: 'carprin_key', label: "Tarkil Adan's key", kind: 'task', proof: ['bertox_key_1'], needs: 'the Carprin cycle, then Tarkil Adan', verified: true, note: 'Silent step: only the Seer or a #popflags read shows it' },
  ],
  // Terris Thule's lair: the hedge maze and Thelin (thelin 2).
  hedge_event: [
    { key: 'hedge_maze', label: 'Hedge maze + Thelin', kind: 'task', proof: ['thelin_2'], pending: 'cl_maze', needs: 'the hedge maze (hail Adroha first)', verified: true },
  ],
  // ── Torment: BOTH Tranquility thank-yous (potranquility/player.lua; popFlags.ts torment) ──
  // fuirstel 1-5 (popSteps.ts disease, cod, codb). Hail Adler Fuirstel BEFORE the kill or the Seer holds it.
  fuirstel_5: [
    { key: 'f_grummus', label: 'Grummus + projection', kind: 'kill', proof: ['fuirstel_2'], pending: 'cl_grummus', kills: ['grummus_dead'], needs: 'a Grummus kill (hail Adler Fuirstel first)', verified: true },
    { key: 'f_ward', label: 'Ward to Elder Fuirstel', kind: 'handin', proof: ['fuirstel_3'], to: 'Elder Fuirstel', needs: 'the ward taken to Elder Fuirstel', verified: true },
    { key: 'f_bertox', label: 'Bertoxxulous + projection', kind: 'kill', proof: ['fuirstel_4'], pending: 'cl_bertox', kills: ['bert_dead'], needs: 'a Bertoxxulous kill', verified: true },
    { key: 'f_elder', label: 'Elder Fuirstel thanks', kind: 'handin', proof: ['fuirstel_5'], to: 'Elder Fuirstel', needs: 'Elder Fuirstel (hail him again)', verified: true },
  ],
  // thelin 1-4 (popSteps.ts nightmare, ponb).
  thelin_4: [
    { key: 't_maze', label: 'Maze + Thelin', kind: 'task', proof: ['thelin_2'], pending: 'cl_maze', needs: 'the hedge maze (hail Adroha first)', verified: true },
    { key: 't_terris', label: 'Terris Thule + projection', kind: 'kill', proof: ['thelin_3'], pending: 'cl_terris', kills: ['tthule_dead'], needs: 'a Terris Thule kill', verified: true },
    { key: 't_thelin', label: 'Thelin thanks', kind: 'handin', proof: ['thelin_4'], to: 'Thelin', needs: 'Thelin (hail him in Tranquility)', verified: true },
  ],
  // ── Tier two → three ──────────────────────────────────────────────────────
  // Thunder: Askr's talisman, touched to the Storms shrine (karana 1-3).
  askr_quest: [
    { key: 'askr_giants', label: 'Storm giants + Askr', kind: 'kill', proof: ['karana_1'], needs: 'the storm giants (then Askr)', verified: true },
    { key: 'askr_talisman', label: "Askr's talisman", kind: 'handin', proof: ['karana_2'], to: 'Askr', needs: 'the giant pieces taken to Askr', verified: true },
    { key: 'askr_shrine', label: 'Shrine touched', kind: 'task', proof: ['karana_3'], needs: 'the talisman touched to the shrine', verified: true },
  ],
  // Halls of Honor: Aerin`Dar and the Valor door. aerindar_1 prints no flag line (popSteps.ts valor).
  aerindar_dead: [
    { key: 'aerindar_kill', label: 'Aerin`Dar + projection', kind: 'kill', proof: ['aerindar_1', 'aerindar_2'], pending: 'cl_aerindar', kills: ['aerindar_dead'], needs: 'an Aerin`Dar kill', verified: true, note: 'Silent step: only the Seer or a #popflags read shows it' },
  ],
  // Temple of Marr: the three trials. popFlags.ts marks hoh_trials unverified, so these inherit that.
  hoh_trials: [
    { key: 'hoh_t1', label: 'Rydda`Dar', kind: 'task', proof: ['hoh_trial_1'], needs: "Rydda`Dar's trial", verified: false },
    { key: 'hoh_t2', label: 'Villagers', kind: 'task', proof: ['hoh_trial_2'], needs: "the villagers' trial", verified: false },
    { key: 'hoh_t3', label: 'Nomads', kind: 'task', proof: ['hoh_trial_3'], needs: "the nomads' trial", verified: false },
  ],
  // Tactics: zeks 2 or more, the Behemoth kill and Giwin's hail.
  behemoth_dead: [
    { key: 'behemoth_kill', label: 'Behemoth + Giwin', kind: 'kill', proof: ['zeks_2'], pending: 'cl_behemoth', kills: ['behemoth_dead'], needs: 'a Manaetic Behemoth kill (hail Giwin first)', verified: true },
  ],
  // ── Sol Ro: the cipher AND Maelin's reading of the Zek notes ──
  // Maelin joins the halves only when both are held (poknowledge/Grand_Librarian_Maelin.lua :15-20).
  cipher_1: [
    { key: 'c_saryrn', label: "Saryrn's half", kind: 'kill', proof: ['saryrn_1'], pending: 'cl_saryrn', kills: ['saryrn_dead'], needs: 'a Saryrn kill', verified: true },
    { key: 'c_marr', label: "Marr's half", kind: 'kill', proof: ['mmarr_1'], pending: 'cl_mmarr', kills: ['marr_dead'], needs: 'a Marr kill', verified: true },
    { key: 'c_maelin', label: 'Maelin joins the halves', kind: 'handin', proof: ['cipher_1'], to: 'Maelin', needs: "Maelin's cipher", verified: true },
  ],
  // Maelin reads Vallon's and Tallon's notes (zeks 3, 4 → 6); she offers it ONLY with the cipher in hand
  // (Grand_Librarian_Maelin.lua :65-81, the same read web/lib/popNextSteps.ts cites).
  zeks_6: [
    { key: 'z_vallon', label: "Vallon's notes", kind: 'kill', proof: ['zeks_3'], pending: 'cl_vallon', kills: ['vallon_dead'], needs: 'a Vallon kill', verified: true },
    { key: 'z_tallon', label: "Tallon's notes", kind: 'kill', proof: ['zeks_4'], pending: 'cl_tallon', kills: ['tallon_dead'], needs: 'a Tallon kill', verified: true },
    { key: 'z_maelin', label: 'Maelin reads the notes', kind: 'handin', proof: ['zeks_6'], to: 'Maelin', needs: "Maelin's Zek reading", verified: true, note: 'Maelin only offers it once you hold the cipher' },
  ],
  // ── Fire: Solusek Ro dead and the projection hailed (pofire 1-2). popFlags.ts asks for the solro_dead KILL;
  // the portal itself asks for pofire_2, which needs the five wings, Miak and the Rallos Zek step (popSteps.ts solro).
  solro_dead: [
    { key: 's_wings', label: 'Five cauldron wings', kind: 'task', proof: ['sol_room_1', 'sol_room_2', 'sol_room_3', 'sol_room_4', 'sol_room_5'], all: true, needs: 'all five cauldron wings', verified: true },
    { key: 's_miak', label: "Miak's talk", kind: 'task', proof: ['pofire_1'], needs: "Miak's talk in Tranquility", verified: true },
    { key: 's_rallos', label: 'Rallos Zek step', kind: 'kill', proof: ['zeks_7'], pending: 'cl_rallos', kills: ['rallos_dead'], needs: 'a Rallos Zek kill (after the Zek reading)', verified: true },
    { key: 's_solusek', label: 'Solusek Ro + projection', kind: 'kill', proof: ['pofire_2'], pending: 'cl_solusek', kills: ['solro_dead'], needs: 'a Solusek Ro kill', verified: true },
  ],
  // ── Air, Earth and Water: Maelin's power source (zebuxoruk 1-2) ──
  // Her second reading needs zeks 7: Rallos Zek's projection hailed (Grand_Librarian_Maelin.lua :57-61).
  zebuxoruk_2: [
    { key: 'p_karana', label: "Karana's notes", kind: 'kill', proof: ['karana_4'], pending: 'cl_karana', kills: ['agnarr_dead'], needs: 'an Agnarr kill (then Karana)', verified: true },
    { key: 'p_mithaniel', label: "Mithaniel's notes", kind: 'kill', proof: ['mmarr_book_1'], pending: 'cl_mmarr_book', kills: ['marr_dead'], needs: 'a Marr kill', verified: true },
    { key: 'p_rallos', label: 'Rallos Zek step', kind: 'kill', proof: ['zeks_7'], pending: 'cl_rallos', kills: ['rallos_dead'], needs: 'a Rallos Zek kill (after the Zek reading)', verified: true, note: 'Needs the Zek reading (Maelin, and so the cipher) first' },
    { key: 'p_lore', label: 'Maelin reads the notes', kind: 'handin', proof: ['zebuxoruk_1'], to: 'Maelin', needs: "Maelin's reading of both notes", verified: true },
    { key: 'p_power', label: "Maelin's power source", kind: 'handin', proof: ['zebuxoruk_2'], to: 'Maelin', needs: "Maelin's power source", verified: true },
  ],
  // Ragrax: the Arbitor of Earth with the four earth rings. The rings are not tracked, and popFlags.ts marks
  // arbitor_dead unverified, so this is a guess at the make-up.
  arbitor_dead: [
    { key: 'e_arbitor', label: 'Arbitor of Earth', kind: 'kill', proof: ['earthb_key_1'], kills: ['arbitor_dead'], needs: 'an Arbitor of Earth kill (with the four rings)', verified: false, note: 'The four earth rings are not tracked' },
  ],
  // ── Time: the four elemental essences carried to Meldrath's machine (GATE_IMPLIES.time_1 in popWho.ts names the
  // four gods). Whether the loot counts as the essence is not confirmed: popFlags.ts lists the loot flags apart.
  time_1: [
    { key: 'time_fire', label: 'Fire: Fennin Ro', kind: 'kill', proof: ['fennin_dead', 'globe_loot'], needs: 'a Fennin Ro kill', verified: false },
    { key: 'time_water', label: 'Water: Coirnav', kind: 'kill', proof: ['coirnav_dead', 'sphere_loot'], needs: 'a Coirnav kill', verified: false },
    { key: 'time_earth', label: 'Earth: Rathe Council', kind: 'kill', proof: ['rathe_dead', 'stone_loot'], needs: 'the Rathe Council', verified: false },
    { key: 'time_air', label: 'Air: Xegony', kind: 'kill', proof: ['xegony_dead', 'cloud_loot'], needs: 'a Xegony kill', verified: false },
    { key: 'time_machine', label: "Meldrath's machine", kind: 'handin', proof: ['time_1'], to: 'Meldrath', needs: "Meldrath's time machine", verified: true, note: 'The portal also needs level 65' },
  ],
};

/** Every piece, in the table's own order. */
export const ALL_PIECES: GatePiece[] = Object.values(REQ_PIECES).flat();

/** A requirement flag with no entry above still gets one piece, so a new gate never renders empty. */
function fallbackPiece(flag: string): GatePiece {
  const label = POP_FLAGS[flag]?.label ?? flag;
  return { key: `flag:${flag}`, label, kind: 'task', proof: [flag], needs: label, verified: false };
}

/** The pieces of one requirement flag. */
export function piecesOfFlag(flag: string): GatePiece[] {
  return REQ_PIECES[flag] ?? [fallbackPiece(flag)];
}

/** The planes with something to open: every zone with a requirement, in the chart's order. */
export const GATES: PopNode[] = POP_ZONES.filter(z => z.requires.length > 0);

/** A gate's pieces: each requirement flag's pieces, in order. */
export function gatePieces(zone: PopNode): GatePiece[] {
  return zone.requires.flatMap(piecesOfFlag);
}

/** Pieces for a flag a progression line is waiting on: the flag's own decomposition, else every piece it proves
 *  or whose kill it is (a kill flag such as 'agnarr_dead' belongs to the notes it hands out), else one fallback. */
export function piecesForBlocker(flag: string): GatePiece[] {
  if (REQ_PIECES[flag]) return REQ_PIECES[flag];
  const via = ALL_PIECES.filter(p => p.proof.includes(flag) || (p.kills ?? []).includes(flag));
  return via.length ? via : [fallbackPiece(flag)];
}
