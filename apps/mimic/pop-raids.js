// pop-raids.js — Planes of Power / Plane of Time encounter database for the
// PoP Raid Slideshow overlay (popraid.html loads this via <script src>).
//
// Sources: EQProgression encounter pages (guide URLs per encounter), TAKP
// wiki, EQ Fandom — transcribed from the guild's reference docs
// (wolfpack-pop-raid-reference.md + wolfpackplaneoftimeslideshow.md,
// Uilnayar 2026-07-10). Numbers are GUIDE ESTIMATES; "confirmed on Quarm"
// is the source of truth after the 2026-10-01 PoP unlock. The ⚑ Flag
// anomaly button on each panel exists exactly for the deltas.
//
// Images/diagrams: HOTLINKED from EQProgression (the end user's Mimic loads
// them directly from the public host — we never store or re-serve someone
// else's content, and pay no egress on it). Every panel links its source
// guide page as credit. Diagram entries are filenames relative to imageBase
// unless they start with http.
//
// ⚠ PoTime Phases 2 & 3 were not in the captured tabs and EQProgression
// 403s our server (same as PQDI) — those sections carry pending:true and
// fill in via docs/pop-raids-local.md (local-machine capture runbook).

window.POP_RAIDS = {
  imageBase: 'https://www.eqprogression.com/wp-content/uploads/PoTime_Raid_Guide/',
  quarmGlobalNotes: [
    'Access levels differ by source (46 / 55 / 60 / 62 per-zone on TAKP) — verify per zone.',
    'PoStorms flag = Askr collect quest (not a boss kill).',
    'Flag caps: 72 standard · 36 Carprin · 54 Earth A.',
    'Quarm combat changes already live carry into PoP: pet/invis rework, hybrid fizzle (incl. Beastlords), zone-punt grace, raid-crash handling.',
  ],
  sections: [
    // ═══════════════ TIER 1 ═══════════════
    {
      id: 'tier1', title: 'Tier 1',
      encounters: [
        {
          id: 'grummus', name: 'Grummus', zone: 'Plane of Disease', npcName: 'Grummus',
          callouts: [
            'Easy for a L60+ mid raid. Two minis before him.',
            'Group heals + disease cures for the DoTs.',
          ],
          stats: { hp: '~500K (MoTM)', hits: '1500+', slow: 'slowable', ramp: 'rampages' },
          abilities: [
            { name: 'Decay of the Plaguebringer', note: 'ST 300 DoT + 60% slow — disease' },
            { name: 'Stench of Decay', note: 'PBAE 200 DoT' },
            { name: 'Plasma Decay', note: 'PBAE escalating DoT' },
          ],
          tracker: [
            { id: 'minis', label: 'Minis down' },
            { id: 'boss', label: 'Grummus down' },
            { id: 'proj', label: 'Planar Projection hailed' },
            { id: 'sewer', label: 'Sewer cap → drop to Crypt of Decay' },
          ],
          guide: 'https://www.eqprogression.com/npc-grummus/',
        },
        {
          id: 'behemoth', name: 'Manaetic Behemoth', zone: 'Plane of Innovation', npcName: 'Manaetic Behemoth',
          callouts: [
            'Need factory key (1 person; Xanamech). "I will test the machine" → Giwin (pre-flag).',
            'SPLIT THE RAID IN TWO and hold BOTH doors — spiders run in and explode for 4000 AE.',
            '~5–10 min holding → Behemoth targetable. Keep holding doors during the kill.',
            'Everyone OUT on death, then mop up spiders. NEVER enter unless doors are held.',
          ],
          stats: { hp: '~175K (MoTM)', hits: '500+', slow: 'slowable (disease easiest)', ramp: null },
          abilities: [
            { name: 'Gyrosonic Disruption', note: 'PBAE knockback + 600 DD' },
            { name: 'Wave of White Noise', note: 'PBAE silence — unresistable' },
          ],
          tracker: [
            { id: 'giwin', label: 'Giwin pre-flag' },
            { id: 'doors', label: 'Doors held (L/R)' },
            { id: 'target', label: 'Behemoth targetable' },
            { id: 'boss', label: 'Behemoth down' },
            { id: 'out', label: 'Raid OUT + spiders cleared' },
            { id: 'hail', label: 'Giwin (E door) hailed' },
          ],
          guide: 'https://www.eqprogression.com/npc-manaetic-behemoth/',
          pageImages: ['Factory-Door-Map.png', 'behemoth-map.png'],
        },
        {
          id: 'xanamech', name: 'Xanamech Nezmirthafen (Factory Key)', zone: 'Plane of Innovation', npcName: 'Xanamech Nezmirthafen',
          callouts: [
            'Optional — keys 1 person. Collect 3 zone-wide drops (Intact Power Cell, Copper Node, Bundle of Super Conductive Wires) → give to Nitram Anizok → he paths to Xanamech → kill.',
            'DO NOT let the dragon kill the gnome (mez / memblur / HoT him). Hail Nitram after.',
          ],
          stats: { hp: '250K (MoTM)', hits: '1500+', slow: 'slowable', ramp: null },
          abilities: [
            { name: 'Oil Spray', note: 'PBAE snare' },
            { name: 'Electrical Short', note: 'targeted AE 300 + stun' },
            { name: 'Steam Blast', note: 'PBAE 880 — fire' },
          ],
          tracker: [
            { id: 'drops', label: '3 drops collected' },
            { id: 'gnome', label: 'Nitram alive at Xanamech' },
            { id: 'boss', label: 'Xanamech down' },
            { id: 'hail', label: 'Nitram hailed' },
          ],
          guide: 'https://www.eqprogression.com/npc-xanamech-nezmirthafen/',
          pageImages: ['Nitram-Map.png'],
        },
        {
          id: 'terris-a', name: 'Terris-Thule (flag)', zone: 'Plane of Nightmare B', npcName: 'Terris Thule',
          callouts: [
            'Requires the 18-man Hedge Maze first. Clear trash to her chamber.',
            '75%: small adds (some mez).',
            '50%: MASS AE DISPEL — all but MT + 2 healers hide behind the wall, wait it out, return.',
            '~35% (often delayed): 4 Gargoyles — off-tank/kite them and burn Terris.',
            'Kill gargoyles after; hail the Projection.',
          ],
          stats: { hp: '500K (MoTM)', hits: '1100+', slow: 'slowable', ramp: null },
          abilities: [],
          tracker: [
            { id: 'p75', label: '75% adds' },
            { id: 'p50', label: '50% dispel dodged' },
            { id: 'p35', label: '35% gargoyles' },
            { id: 'boss', label: 'Terris down' },
            { id: 'gargs', label: 'Gargoyles cleared' },
            { id: 'proj', label: 'Projection hailed' },
          ],
          guide: 'https://www.eqprogression.com/npc-terris-thule-nightmare/',
        },
        {
          id: 'poj-trials', name: 'Plane of Justice Trials', zone: 'Plane of Justice',
          callouts: [
            'One trial flags; all 6 unlock The Seventh Hammer. All minis ~30-40K HP, hit 600+, slowable.',
            'EXECUTION (easiest, DPS check): 4 waves of 4; every kill resets the Executioner\'s walk — don\'t let him reach the guillotines → Prime Executioner Vathoch → loot Mark. (Armor Break PBAE −270 AC)',
            'FLAME: waves → Punisher of Flame (Rain of Molten Lava PBAE 300).',
            'LASHING: 4 waves (+ untargetable scourge of honor); kill flickering spirits in halls → Lashman Akazal (Thunderclap PBAE stun).',
            'STONE: 4 waves of 4; snipers above; PROTECT the halfling prisoners → Yurae Zhaleem (harmtouch; Gravel Rain PBAE snare/250, curse).',
            'SUFFOCATION: kill "spirit of suffocation" FIRST → Gallows Master Teion (Wing Squall tAE 350+stun; ENC spells).',
            'TORTURE: 4 waves in the yellow circles; kill wraith of agony fast → Punisher Veshtaq (Pain and Suffering PBAE 100, unresistable).',
            '7TH HAMMER: all 6 Marks → "knowledge" to Tribunal → Mark of Justice → blue portal. Endurance fight: hits 1400+, AE ramps, high HP, slowable. (Justice ST 850 unres · Tremor of Justice PBAE 800 · Verdict of Eternity PBAE mana/life DoT, curse)',
          ],
          stats: { hp: 'minis 30-40K · 7th Hammer high', hits: '600+ (7th: 1400+)', slow: 'slowable', ramp: '7th Hammer AE ramps' },
          abilities: [],
          tracker: [
            { id: 'w1', label: 'Execution W1' }, { id: 'w2', label: 'W2' },
            { id: 'w3', label: 'W3' }, { id: 'w4', label: 'W4' },
            { id: 'prisoner', label: 'Prisoner alive' },
            { id: 'vathoch', label: 'Vathoch down' },
            { id: 'mark', label: 'Mark looted' },
          ],
          guide: 'https://www.eqprogression.com/plane-of-justice-trials-guide/',
          pageImages: ['Justice-Ring.jpg', 'Justice-Map.jpg'],
        },
      ],
    },
    // ═══════════════ TIER 2 ═══════════════
    {
      id: 'tier2', title: 'Tier 2',
      encounters: [
        {
          id: 'aerindar', name: 'Aerin`Dar', zone: 'Plane of Valor', npcName: 'Aerin`Dar',
          callouts: [
            'EVERYONE INVIS to the locked door (spiders + guards see-invis / KoS). Need Crystalline Globe (1 person).',
            'PULL HIM OFF HIS PLATFORM — it becomes a fake floor to HoH; premature clicks drop people before they hail. Projection spawns where he dies.',
            'Untargetable golems become active mid-fight — CC them (Rahlgon mez+root, rest root-only).',
          ],
          stats: { hp: '~250-300K', hits: '1600+', slow: 'slowable', ramp: 'rampages' },
          abilities: [
            { name: 'Glass Shards', note: '375 DD on the MT' },
            { name: 'Glass Roar', note: 'PBAE fear + 500 DoT' },
          ],
          tracker: [
            { id: 'invis', label: 'Invis run OK' },
            { id: 'pulled', label: 'Pulled off platform' },
            { id: 'golems', label: 'Golems CC\'d' },
            { id: 'boss', label: 'Aerin`Dar down' },
            { id: 'proj', label: 'Projection hailed (all)' },
            { id: 'tunnel', label: 'Tunnel cleared → HoH lightning beams' },
          ],
          guide: 'https://www.eqprogression.com/npc-aerin-dar/',
        },
        {
          id: 'carprin', name: 'Carprin Deatharn (Event)', zone: 'Crypt of Decay', npcName: 'Carprin Deatharn',
          callouts: [
            '36-FLAG CAP. Aggro spawns 3 adds → KILL GUARDS FIRST (Carprin HP-locks otherwise), Carprin respawns, then kill him.',
            'Named chain after — kill one to spawn the next: Avhi Escron (permarooted) → Bishop Toluwon (flurries) → Raex Pwodill + Vindor Mawnil (together; Raex slow-immune) → High Priest Ultor Szanvon (tank CDs).',
            'Click the chair at zone-in for the basement. Hail Tarkil Adan.',
          ],
          stats: { hp: '~150K', hits: '1500+', slow: 'slowable', ramp: null, immune: 'disease-immune' },
          abilities: [
            { name: 'Gift of Hate', note: '20% memblur' },
            { name: 'Theft of Life', note: 'proc — 3500 lifetap' },
          ],
          tracker: [
            { id: 'guards', label: 'Guards down' },
            { id: 'boss', label: 'Carprin down' },
            { id: 'avhi', label: 'Avhi' }, { id: 'bishop', label: 'Bishop' },
            { id: 'raex', label: 'Raex+Vindor' }, { id: 'priest', label: 'High Priest' },
            { id: 'hail', label: 'Tarkil Adan hailed' },
          ],
          guide: 'https://www.eqprogression.com/npc-carprin-deatharn/',
        },
        {
          id: 'bertox-cod', name: 'Bertoxxulous (Event)', zone: 'Crypt of Decay', npcName: 'Bertoxxulous',
          callouts: [
            'Need Carprin flag. Kill Spectre of Corruption to start. Waves of 6-10; 12 NAMED on timers; last 4 spawn TOGETHER in different tunnels.',
            'Pullers bring everything to the main room; CC as needed. Hail Projection center on death.',
            'Named timing (min): Darwol 10 · Feig 11 · Xhut 12 · Kavilis 13 · Raddi 21 · Wavadozzik 22 · Zandal 22 (AE slow) · Akkapan 22 · Meedo/Qezzin/Pzo/Bhaly 29 (Bhaly flurries) · Bert 35.',
          ],
          stats: { hp: '~550-650K (MoTM)', hits: '2300+', slow: 'slowable', ramp: 'rampages', immune: 'disease-immune' },
          abilities: [
            { name: 'Rot of the Plaguebringer', note: 'PBAE 500 + mana — disease, 72-counter cure' },
          ],
          tracker: [
            { id: 'spectre', label: 'Spectre down' },
            { id: 'named1', label: 'Wave 1 named (4)' },
            { id: 'named2', label: 'Wave 2 named (4)' },
            { id: 'named3', label: 'Final 4 named' },
            { id: 'boss', label: 'Bert down' },
            { id: 'proj', label: 'Projection hailed' },
          ],
          guide: 'https://www.eqprogression.com/npc-bertoxxulous/',
        },
        {
          id: 'keeper', name: 'Keeper of Sorrows (Event)', zone: 'Plane of Torment',
          callouts: [
            'Need Screaming Sphere key (1 person) for Saryrn\'s tower. Clear 4 named up (Salczek, Acolyte, Ta\'Grusch, Maareq).',
            'Kill MAAREQ THE PROPHET (flurries) → Tylis targetable. Raid under cage, RL on stairs LoS → "we are ready" → mini-dungeon.',
            'DON\'T FALL IN WATER/MUD (spawns adds). Path: right stair → next right + up → straight ahead → ramp.',
            'Kill Keeper (trivial) → ALL hail Tylis → ONLY hail, no other dialogue → one person "ready to return".',
          ],
          stats: { hp: 'trivial', hits: null, slow: null, ramp: null },
          abilities: [],
          tracker: [
            { id: 'maareq', label: 'Maareq down' },
            { id: 'ported', label: 'Ported in' },
            { id: 'dungeon', label: 'Dungeon cleared' },
            { id: 'keeper', label: 'Keeper down' },
            { id: 'hail', label: 'All hailed Tylis' },
            { id: 'return', label: 'Returned' },
          ],
          guide: 'https://www.eqprogression.com/npc-the-keeper-of-sorrows-plane-of-torment-event/',
        },
        {
          id: 'saryrn-a', name: 'Saryrn (flag)', zone: 'Plane of Torment', npcName: 'Saryrn',
          callouts: [
            'Spawns adds periodically — kill or CC.',
            'Pet bird SORROWSONG (untargetable early, PBAE silence) becomes targetable — MUST kill.',
            'Hail the Projection after.',
          ],
          stats: { hp: '~800K', hits: '700+', slow: 'partially slowable', ramp: 'AE ramps' },
          abilities: [],
          tracker: [
            { id: 'adds', label: 'Adds managed' },
            { id: 'bird', label: 'Sorrowsong down' },
            { id: 'boss', label: 'Saryrn down' },
            { id: 'proj', label: 'Projection hailed' },
          ],
          guide: 'https://www.eqprogression.com/npc-saryrn-potorment/',
        },
      ],
    },
    // ═══════════════ TIER 3 ═══════════════
    {
      id: 'tier3', title: 'Tier 3',
      encounters: [
        {
          id: 'agnarr', name: 'Agnarr the Storm Lord (3 phases)', zone: 'Bastion of Thunder', npcName: 'Agnarr the Storm Lord',
          callouts: [
            'Need Symbol of Torden key (1 person) for the statue. Askr ports between rooms.',
            'P1: Evynd Firestorm (FIRE-IMMUNE, 500K) + kill 3 red summon portals fast → "transport".',
            'P2: Emmerik Skyfury (high cold resist, 600K; nasty AEs Meteor Storm / Storm Comet) + 3 portals → "storm".',
            'P3: tanks in FIRST (instant aggro), then healers. 5 portals (middle unkillable). Named adds ~100/75/50/25%: Jolur / Ekil (fire-immune) / Oljin (cold-immune) / Hibdin (slow-immune).',
            'Karana → "follow the path of the fallen".',
          ],
          stats: { hp: '1.1M', hits: '1600+', slow: null, ramp: null },
          abilities: [
            { name: 'Manastorm', note: 'AE' },
            { name: 'Rage of the Rainkeeper', note: 'spin-stun' },
          ],
          tracker: [
            { id: 'p1portals', label: 'P1 portals' }, { id: 'evynd', label: 'Evynd' },
            { id: 'p2portals', label: 'P2 portals' }, { id: 'emmerik', label: 'Emmerik' },
            { id: 'p3portals', label: 'P3 portals' },
            { id: 'jolur', label: 'Jolur' }, { id: 'ekil', label: 'Ekil' },
            { id: 'oljin', label: 'Oljin' }, { id: 'hibdin', label: 'Hibdin' },
            { id: 'boss', label: 'Agnarr down' }, { id: 'flag', label: 'Karana flag' },
          ],
          guide: 'https://www.eqprogression.com/npc-agnarr-the-storm-lord/',
        },
        {
          id: 'hoh-trials', name: 'Halls of Honor Trials (3)', zone: 'Halls of Honor',
          callouts: [
            'T1 Trydan Faye (NE, dragon): "we are ready" → Custodian → Rydda`Dar (500K, hits 2000+, Crystal Roar PBAE fear/−AC/slow, Screeching Bellow proc). Hail Trydan.',
            'T2 Rhaliq Trell (NW, 3-room): PROTECT the villagers in Room 1; kite Rooms 2/3 if small. Hail Rhaliq (Room 1).',
            'T3 Alekson Garn (SE, 3-room): split 3 groups; named per room — Advocent Joran (flurries) / Halgoz Rellinic / Freegan Haun. Hail Alekson (Room 1).',
          ],
          stats: { hp: 'Rydda`Dar 500K', hits: '2000+', slow: null, ramp: null },
          abilities: [],
          tracker: [
            { id: 't1', label: 'T1 Rydda`Dar + Trydan' },
            { id: 't2', label: 'T2 villagers + Rhaliq' },
            { id: 't3', label: 'T3 3 named + Alekson' },
          ],
          guide: 'https://www.eqprogression.com/halls-of-honor-trials-raid-guide/',
        },
        {
          id: 'marr', name: 'Lord Mithaniel Marr', zone: 'Halls of Honor B', npcName: 'Lord Mithaniel Marr',
          callouts: [
            '3 minis first, IN ORDER: Halon → Edium → Ralthazor (190-270K each). Pull everything to the hallway; clear the room before spawning Marr.',
            'Off-MT (Paladin) takes the ST rampage. CH chain. Corner tank, casters back.',
          ],
          stats: { hp: '~1.3M', hits: '2300+', slow: 'disease-slowable', ramp: 'AE + ST ramps · flurries' },
          abilities: [
            { name: 'Silence of Marr', note: 'ST root' },
            { name: 'Strike of Marr', note: 'proc 3500 + stun' },
          ],
          tracker: [
            { id: 'halon', label: 'Halon' }, { id: 'edium', label: 'Edium' },
            { id: 'ralthazor', label: 'Ralthazor' }, { id: 'room', label: 'Room cleared' },
            { id: 'boss', label: 'Marr down' }, { id: 'proj', label: 'Projection hailed' },
          ],
          guide: 'https://www.eqprogression.com/npc-lord-mithaniel-marr/',
        },
        {
          id: 'vallon-a', name: 'Vallon Zek (standalone)', zone: 'Plane of Tactics', npcName: 'Vallon Zek',
          callouts: [
            'Clear the room corners. SPLITS INTO 5 at ~60% — only 1 real. /target Vallon_Zek00 (the real one spawns first, casts + runs faster).',
            'Kill real → new wave of 5 (repeat ~4-5×). Method B (kill fakes first) is safer for less-experienced raids.',
            'Hail Projection; door behind him → zone out.',
          ],
          stats: { hp: null, hits: '~1000 (MoTM)', slow: null, ramp: null },
          abilities: [],
          tracker: [
            { id: 'w1', label: 'Wave 1 real' }, { id: 'w2', label: 'Wave 2' },
            { id: 'w3', label: 'Wave 3' }, { id: 'w4', label: 'Wave 4' },
            { id: 'final', label: 'Final' }, { id: 'proj', label: 'Projection' },
          ],
          guide: 'https://www.eqprogression.com/npc-vallon-zek-potactics/',
        },
        {
          id: 'rallos-event', name: 'Rallos Zek the Warlord (event, 4 phases)', zone: 'Plane of Tactics', npcName: 'Rallos Zek the Warlord',
          callouts: [
            'P1: kill Decorin Berik + Decorin Grunhork within 6 MIN of each other (clear both halls; don\'t kill on Tallon/Vallon spawn points).',
            'P2: Tallon + Vallon spawn N/S halls; pull before they roam into the Fake Rallos room; split one out. Kill within ~20 min of each other. Tallon harder — lev + hide from AE; Vallon splits, kill real first.',
            'P3 Fake Rallos: corner tank, raid in the adjacent corner; AE ramps + hall adds; despawns ~50% → real spawns in arena.',
            'P4 Rallos (arena): DPS check; corner tank; adds every 54s (kite team); melee at max range (AE ramp). Hail Projection center.',
          ],
          stats: { hp: '~1.1-1.2M', hits: '1300+', slow: null, ramp: 'AE ramp' },
          abilities: [],
          tracker: [
            { id: 'decorin', label: 'Both Decorin' },
            { id: 'tallon', label: 'Tallon' }, { id: 'vallon', label: 'Vallon' },
            { id: 'fake', label: 'Fake Rallos → 50%' },
            { id: 'adds', label: 'Arena adds kited' },
            { id: 'boss', label: 'Rallos down' }, { id: 'proj', label: 'Projection hailed' },
          ],
          guide: 'https://www.eqprogression.com/npc-rallos-zek-the-warlord/',
        },
        {
          id: 'solro', name: 'Tower of Solusek Ro (5 minis + Solusek Ro)', zone: 'Tower of Solusek Ro', npcName: 'Solusek Ro',
          callouts: [
            '5 minis (each = flag + click stone) via the tower staircases:',
            'XUZL (far left): pre-split flaming-sword trash (130K, flurry, harder than the boss). 650K.',
            'ARLYXIR (2nd left): easy, pre-clear. 800K.',
            'JIVA (center): trash-heavy hall; Reckless Mutterings PBAE; trivial adds. 750K.',
            'RIZLONA (2nd right): human (250K) → DRAGON ON DEATH (650K); Flame Song → Lava Breath (dispel it).',
            'PROTECTOR OF DRESOLIK (far right): kill 4 Guardians of Dresolik first (250-300K). 850-900K.',
            'SOLUSEK RO: clear 6 Guardians of Fire (L73) first. Ranged at max range. Projection → drop to PoFire.',
          ],
          stats: { hp: '~900K (boss, L80)', hits: '2.1K+ (2.5K+ ungeared)', slow: 'slowable', ramp: 'ramps' },
          abilities: [
            { name: 'Solar Flame', note: 'ST 2000' },
            { name: 'Solar Winds', note: 'targeted AE 1000' },
            { name: 'Corona of Sol', note: 'dispellable damage shield' },
          ],
          tracker: [
            { id: 'xuzl', label: 'Xuzl' }, { id: 'arlyxir', label: 'Arlyxir' },
            { id: 'jiva', label: 'Jiva' }, { id: 'rizlona', label: 'Rizlona' },
            { id: 'protector', label: 'Protector' },
            { id: 'guardians', label: 'Guardians of Fire' },
            { id: 'boss', label: 'Solusek Ro down' },
            { id: 'drop', label: 'Projection + drop to PoFire' },
          ],
          guide: 'https://www.eqprogression.com/npc-solusek-ro/',
        },
      ],
    },
    // ═══════════════ TIER 4 — ELEMENTAL PLANES ═══════════════
    {
      id: 'tier4', title: 'Tier 4 — Elemental Planes',
      encounters: [
        {
          id: 'xegony', name: 'Xegony the Queen of Air', zone: 'Plane of Air', npcName: 'Xegony',
          callouts: [
            'Kill Muzlakh the Chosen on zone-in (AE snare). Clear room trash (Elementals memblur, Councilmen slow).',
            'PARK THE RAID BEHIND XEGONY; MT tanks her 125+ away (Wing of Xegony has 125 range). CH chain (4-5 clerics), keep slow up.',
            '6 WAVES at ~engage/85/70/55/40/25% (order varies): Iron Knights / Spiders / Elementals / Bugs / Efreeti / Phoenixes — each with a named (AE silence OR tAE slow+1250).',
            'Kite team on adds; enchanters mez if undergeared.',
          ],
          stats: { hp: null, hits: null, slow: 'keep slow up', ramp: null },
          abilities: [
            { name: 'Wing of Xegony', note: 'PBAE 30% slow / 200 DoT / 1000 DD — range 125' },
          ],
          tracker: [
            { id: 'muzlakh', label: 'Muzlakh' }, { id: 'room', label: 'Room clear' },
            { id: 'w1', label: 'W1' }, { id: 'w2', label: 'W2' }, { id: 'w3', label: 'W3' },
            { id: 'w4', label: 'W4' }, { id: 'w5', label: 'W5' }, { id: 'w6', label: 'W6' },
            { id: 'boss', label: 'Xegony down → Amorphous Cloud of Air' },
          ],
          guide: 'https://www.eqprogression.com/xegony-the-queen-of-air-strategy-guide/',
        },
        {
          id: 'rathe', name: 'The Rathe Council + Avatar of Earth', zone: 'Plane of Earth B', npcName: 'Avatar of Earth',
          callouts: [
            '★ HARDEST FIGHT IN POP. 12 councilmen: 6 mezzable, 6 rootable. All hit ~3000 at full HP (less as HP drops).',
            '3 teams: MEZ (drop-down tunnel) · TANK (outside temple across water) · PULL.',
            'Pull mezzables 1 at a time → DPS to 5-10% → enchanters hold. Pull team roots/debuffs the 6 rootables.',
            'Earthen Vengeance (AE DoT/−atk speed/1000 DD) = REMOVE GREATER CURSE.',
            'Don\'t let a councilman exit combat (regens). KILL ALL 12 WITHIN ~6-7 MIN → Avatar of Earth spawns.',
            'Avatar: Ashen Form drops MT aggro −95% — AGGRO DISCIPLINE. Essence of Earth → Mound of Living Stone.',
          ],
          stats: { hp: 'Avatar 550K (MoTM)', hits: 'council ~3000 · Avatar 2400+', slow: 'Avatar slowable', ramp: null },
          abilities: [
            { name: 'Earthen Vengeance', note: 'AE DoT / −atk speed / 1000 DD — Remove Greater Curse' },
            { name: 'Ashen Form', note: '−95% aggro on the MT' },
            { name: 'Marl', note: 'PBAE' },
          ],
          tracker: [
            { id: 'mez6', label: '6 mezzables → 5-10%' },
            { id: 'root6', label: '6 rootables → 5-10%' },
            { id: 'all12', label: 'All 12 dead (window)' },
            { id: 'avatar', label: 'Avatar down' },
            { id: 'hail', label: 'Essence hailed' },
          ],
          guide: 'https://www.eqprogression.com/npc-avatar-of-earth/',
        },
        {
          id: 'fennin', name: 'Fennin Ro the Tyrant of Fire (5 phases)', zone: 'Plane of Fire', npcName: 'Fennin Ro',
          callouts: [
            'P1: Guardian of Doomfire (175K, flurries).',
            'P2: ~9 trash packs (demon models rootable, ramp, hit 2000+); small aggro radius.',
            'P3: 4 named — Azobian (blind AE) / HEBABBILYS (DISPEL + SLOW ASAP — self-haste, hits 3500+) / Javonn (Fiery Assault spin-stun) / Reaxnous (Rain of Burning Fire). 220K each.',
            'P4 (castle): 4 named — Chancellor Kirtra (Web of Flame root) / Chancellor Traxom (Rising Suns blind) / Omni Magus Crato (Comet of Flames tAE 3300) / Warlord Prollaz (ramp). 250K each. 4th death → Fennin spawns + bridge demons block entry.',
            'P5 Fennin: corner-tank at the steps, melee at max range, CH chain.',
          ],
          stats: { hp: '1.1M', hits: '2500+', slow: null, ramp: 'AE ramp' },
          abilities: [
            { name: 'Cataclysm of Ro', note: 'PBAE 3300 / mana / HP DoT — fire, 18-counter curse cure' },
          ],
          tracker: [
            { id: 'guardian', label: 'Guardian' },
            { id: 'trash', label: 'Trash packs' },
            { id: 'p3', label: 'P3 4 named (Hebabbilys dispelled)' },
            { id: 'p4', label: 'P4 4 named' },
            { id: 'boss', label: 'Fennin down → Globe of Dancing Flame' },
          ],
          guide: 'https://www.eqprogression.com/fennin-ro-the-tyrant-of-fire-guide/',
        },
        {
          id: 'coirnav', name: 'Coirnav the Avatar of Water', zone: 'Plane of Water', npcName: 'Coirnav',
          callouts: [
            '⏱ 14-MINUTE TIMER — starts when the Guardian of Coirnav dies.',
            '3 WAVES, each = a named + 20-25 fiend adds: W1 Pwelon of Vapor + vaporfiends / W2 Nrinda of Ice + icefiends / W3 Vamuil of Water + waterfiends.',
            'Paladin roots the named away (debuff, don\'t summon); AE the adds.',
            'Then the 3 named respawn at Coirnav — pull/kill (low HP). Then Coirnav targetable + many adds: BURN DISCS, ZERG HIM (low HP), off-tank adds.',
            'Fail = ported to PoK. Essence of Water → Sphere of Coalesced Water.',
          ],
          stats: { hp: '~270K', hits: '1700+', slow: null, ramp: 'AE ramp' },
          abilities: [
            { name: 'Curse of the Triumvirate', note: 'PBAE 2000 / dispel' },
          ],
          tracker: [
            { id: 'guardian', label: 'Guardian (timer starts)' },
            { id: 'w1', label: 'W1 Pwelon' }, { id: 'w2', label: 'W2 Nrinda' },
            { id: 'w3', label: 'W3 Vamuil' }, { id: 'named3', label: '3 named respawns' },
            { id: 'boss', label: 'Coirnav down (<14 min)' },
            { id: 'hail', label: 'Essence hailed' },
          ],
          guide: 'https://www.eqprogression.com/coirnav-the-avatar-of-water-raid-guide/',
        },
      ],
    },
    // ═══════════════ TIER 5 — PLANE OF TIME ═══════════════
    {
      id: 'potime-p1', title: 'PoTime — Phase 1: The Five Trials',
      note: '18 per trial · all 5 within 1 hour to advance',
      video: 'https://youtu.be/8DRj1LSBwg0',
      guide: 'https://www.eqprogression.com/phase-1/',
      encounters: [
        {
          id: 'neimon', name: 'Air Trial — Neimon of Air', zone: 'Plane of Time', npcName: 'Neimon of Air',
          callouts: [
            '2 waves. W1 = 4x Air Phoenix Noble (root / mez / neither — varies).',
            'W2 = 4x Servitor of Xegony + boss; inner 2 mez, outer 2 root/off-tank.',
            'DISPEL Neimon.',
          ],
          stats: { hp: '240K', hits: '1300+', slow: 'slowable', ramp: 'AE rampage' },
          abilities: [
            { name: 'Caustic Aura', note: 'dispel it' },
            { name: 'Caustic Atmosphere', note: 'PBAE haste debuff, −150 PR' },
          ],
          tracker: [
            { id: 'w1', label: 'W1 down' }, { id: 'aura', label: 'Aura dispelled' },
            { id: 'boss', label: 'Neimon down' }, { id: 'w2', label: 'W2 birds cleared' },
          ],
          diagrams: ['PoAirWave1.jpg', 'PoAirWave2.jpg'],
        },
        {
          id: 'terlok', name: 'Earth Trial — Terlok of Earth', zone: 'Plane of Time', npcName: 'Terlok of Earth',
          callouts: [
            'All slowable — DPS check. 3x pile of living rubble (tank only).',
            'Each rubble death → 2-4x rock shaped assassin (mez, no root).',
            'After the 6th assassin → Terlok spawns.',
          ],
          stats: { hp: '290K', hits: '1300+', slow: 'slowable', ramp: 'rampage' },
          abilities: [],
          tracker: [
            { id: 'r1', label: 'Rubble 1' }, { id: 'r2', label: 'Rubble 2' },
            { id: 'r3', label: 'Rubble 3' }, { id: 'boss', label: 'Terlok down' },
          ],
          diagrams: ['Earth-Trial.jpg'],
        },
        {
          id: 'kazrok', name: 'Fire Trial — Kazrok of Fire', zone: 'Plane of Time', npcName: 'Kazrok of Fire',
          callouts: [
            'All slowable. W1 = 3x flame mephit (no mez); each → 2x inferno mephit.',
            'W2 = Kazrok; DISPEL + SLOW ASAP; adds at 75/50/25%.',
          ],
          stats: { hp: '230K', hits: '1300+', slow: 'slowable', ramp: 'rampage' },
          abilities: [
            { name: 'Pyrokinetic Aura', note: 'dispel it' },
            { name: 'Black Pyre', note: 'PBAE' },
          ],
          tracker: [
            { id: 'w1', label: 'W1 mephits' }, { id: 'aura', label: 'Aura dispelled' },
            { id: 'a75', label: '75% adds' }, { id: 'a50', label: '50% adds' },
            { id: 'a25', label: '25% adds' }, { id: 'boss', label: 'Kazrok down' },
          ],
          diagrams: ['Fire-Wave-1.jpg', 'Fire-Wave-2.jpg'],
        },
        {
          id: 'rythor', name: 'Undead Trial — Rythor of the Undead', zone: 'Plane of Time', npcName: 'Rythor of the Undead',
          callouts: [
            '4 waves, all slowable. W1 3x guardian L64 (root), W2 4x guardian L65 (root), W3 4x guardian (mez), W4 2x undead protector + Rythor.',
          ],
          stats: { hp: '290K', hits: '1300+', slow: 'slowable', ramp: 'AE rampage' },
          abilities: [
            { name: 'Insidious Calamity', note: 'PBAE cold DD + DoT' },
          ],
          tracker: [
            { id: 'w1', label: 'W1' }, { id: 'w2', label: 'W2' }, { id: 'w3', label: 'W3' },
            { id: 'w4', label: 'W4 protectors' }, { id: 'boss', label: 'Rythor down' },
          ],
          diagrams: ['UndeadWave1-4.jpg'],
        },
        {
          id: 'anar', name: 'Water Trial — Anar of Water', zone: 'Plane of Time', npcName: 'Anar of Water',
          callouts: [
            'One long wave. Anar + 2x triloun at start; +2 deepwater triloun at ~90% and ~45% (6 adds total).',
            'Anar NOT slowable; adds are. Undergeared → kill adds first.',
          ],
          stats: { hp: '290K', hits: '1300+', slow: 'NO slow', ramp: 'rampage' },
          abilities: [
            { name: 'Aqueous Flux', note: 'PBAE 850 DD / snare / atk-slow' },
          ],
          tracker: [
            { id: 'start', label: 'Start adds' }, { id: 'a90', label: '90% adds' },
            { id: 'a45', label: '45% adds' }, { id: 'boss', label: 'Anar down' },
          ],
          diagrams: ['Water-Trial.jpg'],
        },
      ],
    },
    {
      id: 'potime-p2', title: 'PoTime — Phase 2', pending: true,
      guide: 'https://www.eqprogression.com/phase-2/',
      note: 'Not captured yet — EQProgression blocks server fetches; run the local capture runbook (docs/pop-raids-local.md) and paste the panels in.',
      encounters: [],
    },
    {
      id: 'potime-p3', title: 'PoTime — Phase 3', pending: true,
      guide: 'https://www.eqprogression.com/phase-3/',
      note: 'Not captured yet — same as Phase 2.',
      encounters: [],
    },
    {
      id: 'potime-p4', title: 'PoTime — Phase 4: God Bosses',
      note: 'Kill Tallon before Vallon for room',
      video: 'https://www.youtube.com/watch?v=w-V5joD1UNI',
      guide: 'https://www.eqprogression.com/phase-4/',
      overviewDiagram: 'Phase-4.png',
      encounters: [
        {
          id: 'tallon', name: 'Tallon Zek', zone: 'Plane of Time', npcName: 'Tallon Zek',
          callouts: [
            'Tank & spank, HUGE tank damage — Defensive Disc + CH chain.',
            'Stack junk debuffs at the top of the buff list. Don\'t aggro Vallon.',
            'Planeshift on a 7-min CD (can pre-trigger by leashing).',
          ],
          stats: { hp: '1.5M', hits: '3500+', slow: 'NO slow', ramp: 'rampages' },
          abilities: [
            { name: 'Barb of Tallon', note: 'every 5s — 1 of 4 types' },
            { name: 'Tallon\'s Balance', note: '−300 all resists, unresistable' },
            { name: 'Strategic Blow', note: 'stun' },
          ],
          tracker: [
            { id: 'pos', label: 'Positioned clear of Vallon' },
            { id: 'planeshift', label: 'Planeshift pre-triggered' },
            { id: 'boss', label: 'Tallon down' },
          ],
          diagrams: ['Tallon-Zek-cut.png'],
        },
        {
          id: 'vallon', name: 'Vallon Zek', zone: 'Plane of Time', npcName: 'Vallon Zek',
          callouts: [
            'FD+stuns the tank every 24s — MULTIPLE tanks on aggro, spam-heal (no CH chain).',
            'Raid aggro debuff — DPS watch hate.',
            'At 45-50% → 2 clone adds (kite/root; PAL/RNG).',
          ],
          stats: { hp: '1.3M', hits: '3500', slow: 'NO slow', ramp: 'rampages' },
          abilities: [
            { name: 'Vallon\'s Precision', note: 'PBAE +40% aggro' },
            { name: 'Tactical Strike', note: 'FD tank + 30s stun' },
          ],
          tracker: [
            { id: 'rotation', label: 'Multi-tank rotation set' },
            { id: 'clones', label: '50% clone adds controlled' },
            { id: 'boss', label: 'Vallon down' },
          ],
          diagrams: ['Vallon-Zek-cut.png'],
        },
        {
          id: 'saryrn-t', name: 'Saryrn', zone: 'Plane of Time', npcName: 'Saryrn',
          callouts: [
            'DISEASE-CURE Torrent of Agony off the tank (drops aggro + slows).',
            '4 adds at ~90-95/50/10%; right = mez, left = tank. PBAE mana drain.',
          ],
          stats: { hp: '1.5M', hits: '2000+', slow: 'NO slow', ramp: 'rampages' },
          abilities: [
            { name: 'Torrent of Agony', note: 'ST — disease cure it off the tank' },
            { name: 'Horrifying Affliction', note: 'PBAE mana drain' },
          ],
          tracker: [
            { id: 'a90', label: '~90% adds' }, { id: 'a50', label: '50% adds' },
            { id: 'a10', label: '10% adds' }, { id: 'cure', label: 'Torrent cured' },
            { id: 'boss', label: 'Saryrn down' },
          ],
          diagrams: ['Saryrn-Cut.png'],
        },
        {
          id: 'terris-t', name: 'Terris-Thule', zone: 'Plane of Time', npcName: 'Terris Thule',
          callouts: [
            'Like Saryrn. 4 adds at ~90-95/50/10%; right = mez, left = tank.',
            'PBAE mana drain + PBAE hate-aggro debuff — WATCH AGGRO. Some adds can mez YOU.',
          ],
          stats: { hp: '1.2M', hits: '1900+', slow: 'NO slow', ramp: 'rampages' },
          abilities: [
            { name: 'Quivering Nightmares', note: 'PBAE' },
            { name: 'Phantasmal Torment', note: 'PBAE' },
          ],
          tracker: [
            { id: 'a90', label: '~90% adds' }, { id: 'a50', label: '50% adds' },
            { id: 'a10', label: '10% adds' }, { id: 'boss', label: 'Terris down' },
          ],
          diagrams: ['Terris-Thule-Cut.png'],
        },
      ],
    },
    {
      id: 'potime-p5', title: 'PoTime — Phase 5: Final Gauntlet → Quarm',
      video: 'https://youtu.be/l2vt7VHUppg',
      guide: 'https://www.eqprogression.com/phase-5/',
      overviewDiagram: 'Phase-5.png',
      encounters: [
        {
          id: 'cazic', name: 'Cazic-Thule', zone: 'Plane of Time', npcName: 'Cazic Thule',
          callouts: [
            'ST fear on the tank → Knight with the Fear Immunity AA.',
            'AE silence + AE damage; group/AE heals, watch resists. Pullable.',
          ],
          stats: { hp: '1.9M', hits: '1500+', slow: 'NO slow', ramp: 'rampages' },
          abilities: [
            { name: 'Aura of Fear', note: 'PBAE' },
            { name: 'Call of the Faceless', note: 'silence + snare' },
            { name: 'Timeless Panic', note: 'ST tank fear' },
          ],
          tracker: [
            { id: 'tank', label: 'Fear-immune tank assigned' },
            { id: 'boss', label: 'Cazic down' },
          ],
          diagrams: ['Cazic-Thule-Cut.png'],
        },
        {
          id: 'bertox-t', name: 'Bertoxxulous', zone: 'Plane of Time', npcName: 'Bertoxxulous',
          callouts: [
            'Starts spell-resistant / low melee. 3x emote ("blisters...burst") lowers resists, raises melee: after 1st 1300+, 2nd 1700+, 3rd 1900+, then trickles down past 50%.',
            'No leash.',
          ],
          stats: { hp: '1.9M', hits: '1900+', slow: 'NO slow', ramp: 'rampages' },
          abilities: [
            { name: 'Rain of Bile', note: 'targeted AE' },
            { name: 'Black Plague', note: 'PBAE — 18-counter disease cure' },
          ],
          tracker: [
            { id: 'e1', label: 'Emote 1' }, { id: 'e2', label: 'Emote 2' },
            { id: 'e3', label: 'Emote 3' }, { id: 'boss', label: 'Bert down' },
          ],
          diagrams: ['Bertoxxulous-Cut.png'],
        },
        {
          id: 'rallos-t', name: 'Rallos Zek', zone: 'Plane of Time', npcName: 'Rallos Zek',
          callouts: [
            'Hits hard / fast / accurate — Defensive. Power gains: 75% AE ramp, 50% flurry, 25% increased attack.',
            'Adds at 90/75/50/25%.',
            'DISPEL BLIND RAGE before/during engage (self-buff, 7 min).',
          ],
          stats: { hp: '1.9M', hits: '2600+', slow: 'NO slow', ramp: 'rampage + AE ramp + flurry' },
          abilities: [
            { name: 'Rage of Zek', note: 'PBAE curse' },
            { name: 'Vindictive Strike', note: 'ST 3850 + stun' },
          ],
          tracker: [
            { id: 'dispel', label: 'Blind Rage dispelled' },
            { id: 'a90', label: '90% adds' }, { id: 'a75', label: '75%' },
            { id: 'a50', label: '50%' }, { id: 'a25', label: '25% adds' },
            { id: 'boss', label: 'Rallos down' },
          ],
          diagrams: ['Rallos-Zek-Cut.png'],
        },
        {
          id: 'innoruuk', name: 'Innoruuk', zone: 'Plane of Time', npcName: 'Innoruuk',
          callouts: [
            'Adds at 80% (3) and 20% (4) — kill or CC (PAL root ideal), debuff+slow them.',
            'PBAE fear once/min → Knight with Fear Immunity AA.',
            'Healers can heal through the wall from the "click to Quarm" room to dodge the fear.',
          ],
          stats: { hp: '1.9M', hits: '2200+', slow: 'NO slow', ramp: 'rampages' },
          abilities: [
            { name: 'Barrier of Hatred', note: 'self-buff damage shield' },
            { name: 'Seething Hatred', note: 'PBAE fear' },
          ],
          tracker: [
            { id: 'tank', label: 'Fear-immune tank' },
            { id: 'a80', label: '80% adds' }, { id: 'a20', label: '20% adds' },
            { id: 'boss', label: 'Innoruuk down' },
          ],
          diagrams: ['Innoruuk-Cut.png'],
        },
        {
          id: 'quarm', name: '★ QUARM (final)', zone: 'Plane of Time', npcName: 'Quarm',
          callouts: [
            'Every 25% he SELF-DISPELS (Balance of the Nameless) — RE-DEBUFF including SLOW, and he loses a head.',
            'Spawns "a time vortex" adds — MEZ them; they proc Time Warp (disease cure, 36 counters).',
            'Spell set shifts per head count: 4H(100-75) Epoch Conviction, Venomed Mist, Plagued Earth, Infernal Flames, Glacier Breath · 3H(75-50) +Glacier Blast (3000 DD cold) · 2H(50-25) +Venom Blast (3000 DD poison) · 1H(25-0) +Plagued Seism (3000 DD magic).',
          ],
          stats: { hp: '2M', hits: '4500+', slow: 'SLOWABLE', ramp: 'light AE ramp' },
          abilities: [
            { name: 'Balance of the Nameless', note: 'self-dispel every 25% — re-debuff + re-slow' },
            { name: 'Time Warp', note: 'vortex proc — disease cure, 36 counters' },
          ],
          tracker: [
            { id: 'p75', label: '75% re-debuff/reslow' },
            { id: 'p50', label: '50% re-debuff' },
            { id: 'p25', label: '25% re-debuff' },
            { id: 'vortex', label: 'Vortex adds mezzed' },
            { id: 'cure', label: 'Time Warp cured' },
            { id: 'boss', label: 'QUARM DOWN' },
          ],
          diagrams: ['Quarm-Cut.png', 'a-time-vortex.jpg'],
        },
      ],
    },
  ],
};
