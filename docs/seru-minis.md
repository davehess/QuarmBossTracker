# Seru Minis — the four Praesertum of Sanctus Seru

Guild name for the group event (Hitya, 2026-08-19, from Hawkner's "Seru
Mini's" forum thread; roster corrected by Hitya same day — **"they are these
four"**): the Praesertum house leaders, one per city quadrant, each dropping
one Shard. **Deliberately NOT on the boss board** — 18-hour respawns per
Hitya, and the group is the event. The suggest-nudge flow knows them as the
`evt_seru_minis` group event (`GROUP_EVENTS` in `utils/suggestNudge.js`, bot
3.1.56/57); individual kills persist to `encounters` via the bot 3.1.52
self-registration path, so parses and kill cards work without board entries.

## The four (mirror, zone 159 `sseru` — `#`-prefixed rows)

| Named | Quadrant | Shard (100%) | npc_id | HP | Hits | Also drops (100%) |
|---|---|---|---|---|---|---|
| Praesertum Bikun | NW | Shard of the Shoulder | 159052 | 200,000 | 168–500 | Massive Girdle of the Forge |
| Praesertum Vantorus | SW | Shard of the Hand | 159055 | 250,000 | 130–510 | Axe of Reckoning |
| Praesertum Rhugol | NE | Shard of the Eye | 159054 | 200,000 | 139–500 | Arms of Augmentation |
| Praesertum Matpa | SE | Shard of the Heart | 159035 | 150,000 | 106–418 | Mace of Prescience |

Shared template: level 66, AC 500, MR/CR/FR 100, DR/PR 180, flagged
`raid_target`, all casters (spell sets 1277/1278). Occasional extras: era
spells (Matpa can drop **Koadic's Endless Intellect** ~7%, Rhugol Blessing of
Aegolism, Vantorus Brell's/Warder's Protection, Bikun Nature's Recovery) and
colored Silken Bridles.

**Per-mob ability kits (eqemu `special_abilities`)** — all four **summon**,
land magical hits, and are uncharmable/unfearable; beyond that they differ:

- **Bikun (NW):** enrage, flurry, triple + quad attack, **unslowable**,
  unmezzable — the tank-and-spank trap of the four.
- **Vantorus (SW):** enrage, flurry, triple + quad attack, unmezzable —
  Bikun's kit but slowable, with the biggest HP pool (250k) and top-end hit.
- **Rhugol (NE):** enrage, quad attack, **unstunnable**.
- **Matpa (SE):** quad attack, **unsnareable**, no enrage — the softest
  (150k HP, 106–418).

**Not the minis:** Lord Inquisitor Seru (159000, 1.02M HP, MR 1000, hits
249–771) is the raid boss. The city's wider office-named tier (Stoic Aealin,
Custos Valar, Quaestorius Martolin and ~17 more on a 100k HP / 500-resist
template) is a different, lesser hunt — don't confuse either with the event.

## ⚠ Mirror caveats (Quarm divergences)

- **Respawn:** the four's spawn rows carry ~19.7-day parked timers
  (1,700,000s) — script/park convention, not the live cadence. **18h live on
  Quarm per Hitya**; trust the live observation.
- Hawkner's quest **"reports"** don't exist in the mirror at all —
  Quarm-custom quest items. Killing them is the only source of truth.
- The four's own loot tables (above) look era-correct, unlike the junk-era
  tables on the office-named tier — but verify against real drops on the
  first event; `loot_observations` becomes the durable record.
