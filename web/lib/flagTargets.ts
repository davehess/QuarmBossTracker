// The pick list a flag event is made from: one entry per thing a raid can go and kill (or do) that hands raiders a
// piece of a Planes of Power gate. ONE list for two readers: the invented-guild demo (web/lib/demoGuild.ts, the
// raidmimic.com click-through) and the real board (web/app/pop/flag-events, wolfpack.quest/pop/flag-events), so the
// demo shows exactly the choices the product offers (the guild lead, 2026-11-02: option A of the flag-event board,
// "Post an event, see who needs it").
//
// A target is a gate (web/lib/popGatePieces.ts: the planes with something to open, by chart key) plus the keys of
// the pieces of that gate the event hands out. "Who needs it" is then the REAL gate rule (popGateStatus.ts
// gateReport) read for just those pieces. Only pieces that exist in REQ_PIECES for the gate belong here:
// test/flag-events.test.js holds every entry to that, so a renamed piece fails loudly instead of quietly never
// matching anyone. Targets whose make-up is a guess (popGatePieces.ts `verified: false`: the earth rings, the four
// essences) are left out on purpose.
//
// `key` is stored in flag_events.target_key. Never rename one that has been posted; add a new entry instead.

export type FlagTarget = {
  key: string;
  label: string;
  /** The gate the target's pieces belong to (popGatePieces.ts), so "who needs it" is the real gate rule. */
  gate: string;
  /** Piece keys (popGatePieces.ts) that must be done; a character who lacks any of them needs the target. */
  pieces: string[];
  blurb: string;
};

export const FLAG_TARGETS: FlagTarget[] = [
  { key: 'marr-trials', label: 'Temple of Marr trials', gate: 'hohb', pieces: ['hoh_t1', 'hoh_t2', 'hoh_t3'], blurb: 'Three trials in the Halls of Honor' },
  { key: 'saryrn', label: 'Saryrn', gate: 'solro', pieces: ['c_saryrn'], blurb: 'Half of the cipher' },
  { key: 'marr', label: 'Mithaniel Marr', gate: 'solro', pieces: ['c_marr'], blurb: 'The other half of the cipher' },
  { key: 'tallon-vallon', label: 'Tallon & Vallon', gate: 'solro', pieces: ['z_vallon', 'z_tallon'], blurb: 'Both sets of Zek notes' },
  { key: 'terris', label: 'Terris Thule', gate: 'torment', pieces: ['t_terris'], blurb: 'Half of the Torment gate' },
  { key: 'bertox', label: 'Bertoxxulous', gate: 'torment', pieces: ['f_bertox'], blurb: 'The other half of the Torment gate' },
  { key: 'rallos', label: 'Rallos Zek', gate: 'fire', pieces: ['s_rallos'], blurb: 'Needed for Doomfire and the elemental planes' },
  { key: 'grummus', label: 'Grummus', gate: 'cod', pieces: ['grummus_kill'], blurb: 'Opens the Crypt of Decay' },
  { key: 'behemoth', label: 'Manaetic Behemoth', gate: 'tactics', pieces: ['behemoth_kill'], blurb: 'Opens the Plane of Tactics' },
  { key: 'aerindar', label: 'Aerin`Dar', gate: 'hoh', pieces: ['aerindar_kill'], blurb: 'Opens the Halls of Honor' },
  { key: 'agnarr', label: 'Agnarr', gate: 'air', pieces: ['p_karana'], blurb: "Karana's notes, for the air, earth and water planes" },
  { key: 'solusek', label: 'Solusek Ro', gate: 'fire', pieces: ['s_solusek'], blurb: 'The Doomfire portal' },
];

export const flagTargetByKey = (key: string): FlagTarget | undefined => FLAG_TARGETS.find(t => t.key === key);
