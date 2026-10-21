// Fixture data for the raidmimic landing captures (web/public/raidmimic/shots/*.webp).
//
// The captures are the REAL Mimic overlay pages (apps/mimic/*.html) rendered in Chromium against a stand-in agent
// that answers their /api/* routes with the data below. Nothing here comes from a live raid: every PLAYER name
// is invented (PLAYERS, below). Mob, item, zone and spell names are game data and are real on purpose.
//
// ⚠ This repo is public. A name added here must be invented, never a member's character. test/raidmimic-landing.test.js
// asserts every player name below is in PLAYERS and that PLAYERS holds no duplicates.
//
// Regenerate: node scripts/raidmimic-shots/shoot.mjs <out-dir>   (needs Playwright + Chromium; see shoot.mjs)

// Fixed "now": a Wednesday raid night, 20:14:30 Eastern. The pages' Date.now() is pinned to it so a clock reads
// the same in every capture.
export const T = Date.UTC(2026, 9, 22, 0, 14, 30);

// Invented. None of these is anybody.
export const PLAYERS = [
  'Aldenmar', 'Brackwyn', 'Corvale', 'Rethlan', 'Nyssara', 'Zarrin', 'Tavrin', 'Odelle', 'Halric', 'Fenwick',
  'Ysolde', 'Mirela', 'Joska', 'Pell', 'Varn', 'Kaelith', 'Dunmar', 'Elowen', 'Garrick', 'Lorwyn', 'Osric',
  'Perrin', 'Sylvar', 'Torvald', 'Vessa', 'Wynne', 'Bramwell', 'Cassivane', 'Ulric',
];
// Invented pet name (a warder / a charmed beast); owners are in PLAYERS.
export const PETS = ['Grimble', 'Snarlpaw'];

const STILL = ['Aldenmar', 'Brackwyn', 'Corvale', 'Rethlan', 'Nyssara', 'Zarrin', 'Tavrin', 'Odelle', 'Halric', 'Fenwick',
  'Ysolde', 'Mirela', 'Joska', 'Pell', 'Varn', 'Kaelith'];
const HAILED = ['Dunmar', 'Elowen', 'Garrick', 'Lorwyn', 'Osric', 'Perrin', 'Sylvar', 'Torvald', 'Vessa', 'Wynne', 'Bramwell', 'Cassivane'];

// ─── Command Center (apps/mimic/command.html, /api/command-center) ─────────────────────────────────────
export function commandCenter() {
  const cureRows = [
    ['Brackwyn', ['curse']], ['Aldenmar', ['curse', 'disease']], ['Joska', ['curse', 'disease']], ['Zarrin', ['curse', 'disease']],
    ['Tavrin', ['curse', 'disease']], ['Halric', ['disease']], ['Pell', ['curse', 'disease']],
  ];
  const CURE = { curse: { cure: 'curse', counters: 9 }, disease: { cure: 'disease', counters: 36 } };
  return {
    character: 'Vessa',
    target: { name: 'Thelin Poxbourne', hp_pct: 43 },
    rampage: { target: 'Aldenmar', hp_pct: 100 },
    hail: [{
      id: 'w1', npc_name: 'A Planar Projection', ms_left: (18 * 60 + 50) * 1000, ends_at_ms: T + (18 * 60 + 50) * 1000,
      flag_cap: 72, flags_granted: 12, flags_left: 60, seen_by: 6,
      still: STILL.map((name) => ({ name })),
      hailed: HAILED.map((name) => ({ name, how: 'seen' })),
      already_flagged: ['Ulric'],
    }],
    da_broadcasts: [{ name: 'Aldenmar', kind: 'Defensive', state: 'cooldown', cooldown_secs: 7 * 60 + 15 }],
    healer_mana: [
      { name: 'Corvale', class: 'Cleric', pct: 11 },
      { name: 'Odelle', class: 'Druid', pct: 20 },
      { name: 'Nyssara', class: 'Shaman', pct: 47 },
    ],
    cures: cureRows.map(([name, kinds]) => ({ id: name.toLowerCase(), name, curses: kinds.map((k) => CURE[k]) })),
    death_recaps: [
      { name: 'Joska', ts: T - 95000, lastChOffMs: 2300, dmg6: 9100 },
      { name: 'Pell', ts: T - 41000, lastChOffMs: null, dmg6: 6400 },
    ],
  };
}

// ─── Rolls (the Rolls card of the same overlay) ───────────────────────────────────────────────────────────
export function rollsState() {
  const first = [
    ['Kaelith', 692], ['Dunmar', 571], ['Elowen', 523], ['Garrick', 478], ['Lorwyn', 462], ['Osric', 443], ['Perrin', 217],
    ['Sylvar', 197], ['Torvald', 136], ['Vessa', 129], ['Wynne', 125], ['Bramwell', 116], ['Cassivane', 95], ['Aldenmar', 24], ['Brackwyn', 16],
  ];
  const set = (to, item, players, winner, value, started, rolls) => ({
    from: 0, to, item, started_at_ms: T - started * 1000, open: true, players,
    winners: [{ name: winner, value }], rolls: rolls || [],
  });
  return {
    character: 'Vessa',
    rolls: [
      set(711, 'Ethereal Parchment', 15, 'Kaelith', 692, 240, first.map(([name, value]) => ({ name, value }))),
      set(811, 'Spectral Parchment', 23, 'Elowen', 735, 200),
      set(511, 'Fetid Flesh Wristband', 8, 'Kaelith', 488, 160),
      set(622, 'Ring of the Pox-bearer', 2, 'Wynne', 311, 120),
      set(522, 'Fetid Flesh Wristband', 1, 'Wynne', 432, 80),
      set(611, 'Ring of the Pox-bearer', 9, 'Dunmar', 530, 40),
    ],
  };
}

// ─── Target Info (apps/mimic/mobinfo.html, /api/state mobInfo) ─────────────────────────────────────────────
const buff = (name, rem, total, extra) => ({ name, good: 0, remaining_secs: rem, total_secs: total, ...extra });
export function targetStats() {
  return {
    activeCharacter: 'Vessa',
    mobInfo: {
      target_name: 'a nightstalker',
      target_hp_pct: 10,
      mob: {
        id: 14231, name: 'a nightstalker', class: 'Warrior', level: 60, hp: 23000, mindmg: 104, maxdmg: 471, ac: 200,
        resists: { mr: 65, fr: 50, cr: 75, pr: 45, dr: 45 }, see_invis: true,
        specials: ['Summon', 'Enrage', 'Does Not Equip', 'Magical', 'Immune Fleeing', 'Immune Non-Magical'],
      },
      target_slow: { name: 'Slowed', ambiguous: true, display_name: 'SLOWED?', remaining_secs: 6 * 60 + 1, family: ['Turgur\'s Insects', 'Sha\'s Advantage'] },
      target_buffs: [
        buff('Funeral Pyre of Kelador', 13, 54),
        buff('Tashan', 159, 840, { owner: 'Brackwyn' }),
        buff('Sha\'s Advantage', 178, 210, { owner: 'Brackwyn' }),
        buff('Turgur\'s Insects', 361, 390, { unproven: true }),
        buff('Malo', 807, 840, { owner: 'Rethlan' }),
        buff('Malosini', 1197, 1230, { owner: 'Brackwyn' }),
      ],
      target_hits: { seen: 179, slash: 0, pierce: 0, blunt: 179, verbs: { crush: 120, bash: 59 } },
    },
  };
}

export function targetQuest() {
  return {
    activeCharacter: 'Vessa',
    mobInfo: {
      target_name: 'Thelin Poxbourne',
      target_hp_pct: 45,
      target_npc_ht: { ready: true },
      mob: {
        id: 209234, name: 'Thelin Poxbourne', level: 60, hp: 15000, mindmg: 67, maxdmg: 329, mana: 2000,
        class_ambiguous: true, class_variants: [{ class: 'Shadow Knight', gender: 'male' }, { class: 'Warrior', gender: 'male' }],
        specials: [],
      },
    },
  };
}

// What /api/npc-interact answers for the quest tab: what to say, what to hand in, who to see next.
export function npcInteract() {
  return {
    npc: {
      say: [
        { say: 'hail', keywords: ['hail'], replies: [{ text: 'Greetings. Do you come seeking the way through the nightmare?', kind: 'say' }] },
        { say: 'ready', keywords: ['ready'], replies: [{ text: 'Then bring me what is broken, and I will mend it.', kind: 'say' }] },
        {
          say: 'hail', keywords: ['hail'], gated: true, flag: true,
          replies: [
            { text: 'I do not recognize your face. Are you a vision sent by Terris?! Begone from my thoughts and begone from my dreams!', kind: 'say' },
            { text: 'Thelin Poxbourne tells you, \'Please destroy her for all that have had to endure her hideous visions.\' Thelin closes his eyes and is swept away from his nightmare. The land of pure thought begins to vanish from around you...', kind: 'say' },
          ],
        },
      ],
      turnins: [{
        inputs: [{ name: 'Dagger Blade Shard', qty: 1 }], outputs: [{ name: 'Thelin\'s Dagger' }], warn: { spawn_other: true },
        says: [{ text: 'The shard hums, and something answers from the dark.' }],
      }],
      next: [{ name: 'Thelin Poxbourne', zone_long: 'Plane of Nightmares', y: 1104, x: -1519 }],
    },
  };
}

// ─── DPS meters (threatmeter.html bars, overlay.html table; /api/state currentEncounterThreat) ─────────────
const row = (swing, proc, spell, total, extra) => ({ swing, proc, spell, heal: 0, total, dmg: total, took: 0, ...extra });
export function threat() {
  return {
    activeCharacter: 'Rethlan',
    currentEncounterThreat: {
      bossName: 'a bloodthirsty raven', targetName: 'a bloodthirsty raven', startedAt: new Date(T - 20000).toISOString(),
      uploader: 'Rethlan',
      perPlayer: {
        Aldenmar: row(1100, 100, 0, 1200),
        Brackwyn: row(900, 120, 80, 1100),
        Corvale: row(500, 120, 430, 1050, { pet_threat_total: 2000 }),
        Zarrin: row(780, 120, 100, 1000, { pet_threat_total: 1000 }),
        Rethlan: row(450, 80, 70, 600),
        Fenwick: row(12, 0, 0, 12),
        Odelle: row(0, 0, 0, 0),
        Tavrin: row(0, 0, 0, 0),
      },
    },
  };
}
export function dps() {
  const lone = (dmg, extra) => ({ dmg, took: 0, swing: dmg, proc: 0, spell: 0, heal: 0, total: dmg, ...extra });
  const s = (a, b) => [T - a, T - b];
  return {
    activeCharacter: 'Rethlan',
    currentEncounterThreat: {
      bossName: 'a bloodthirsty raven', targetName: 'a bloodthirsty raven', startedAt: new Date(T - 19000).toISOString(), uploader: 'Rethlan',
      perPlayer: {
        Corvale: lone(1300), Grimble: lone(1410, { pet_owner: 'Corvale', pet_summoned: true }),
        Zarrin: lone(1290), Snarlpaw: lone(1000, { pet_owner: 'Zarrin', pet_summoned: true }),
        Aldenmar: lone(1430), Brackwyn: lone(1050), Rethlan: lone(555), Fenwick: lone(12),
      },
      spans: {
        Corvale: s(19000, 8000), Zarrin: s(18000, 8000), Aldenmar: s(1000, 0), Brackwyn: s(13000, 8000),
        Rethlan: s(5000, 3000), Fenwick: s(19000, 8000),
      },
    },
  };
}

// ─── The death timeline strip (apps/mimic/triggers.html) ──────────────────────────────────────────────────
// Boss names are game data. `now` is when the page is loaded, because the strip counts from the real clock.
export function timeline(now) {
  const s = (x) => now - x * 1000;
  return {
    activeTimers: [
      { id: 'd1', target: 'Tagrin', effect: 'Slow', duration_sec: 90, remaining_ms: 61000, group: 'debuff' },
      { id: 'd2', target: 'Tagrin', effect: 'Malo', duration_sec: 90, remaining_ms: 38000, group: 'debuff' },
      { id: 'd3', target: 'Decorin Berik', effect: 'Next Rampage', duration_sec: 30, remaining_ms: 12000, group: 'trigger' },
    ],
    recentTriggerFires: [], blindEvents: [],
    recentDeaths: [
      { name: 'Glykus', zone: 'Plane of Tactics', atMs: s(17 * 60 + 30), boss: true },
      { name: 'Tagrin', zone: 'Plane of Tactics', atMs: s(9 * 60 + 8), boss: true },
      { name: 'Decorin Berik', zone: 'Plane of Tactics', atMs: s(2 * 60 + 48), boss: true },
    ],
  };
}
