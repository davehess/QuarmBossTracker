# Seru Minis — the Sanctus Seru house leaders

Guild name for the group event (Hitya, 2026-08-19, from Hawkner's "Seru
Mini's" forum thread): the named office-holders spread through Sanctus Seru's
houses. **Deliberately NOT on the boss board** — 18-hour respawns per Hitya,
and the group is the event, not any one mob. The suggest-nudge flow knows them
as the `evt_seru_minis` group event (`GROUP_EVENTS` in
`utils/suggestNudge.js`, bot 3.1.56); individual kills still persist to
`encounters` via the bot 3.1.52 self-registration path, so parses and kill
cards work without board entries.

## The roster (mirror, zone 159 `sseru`)

Twenty nameds share one deliberate mini-boss template — **100,000 HP, 500 in
every resist, AC 200, hits 260–376**, levels 61–66:

| Named | Lvl | npc_id | | Named | Lvl | npc_id |
|---|---|---|---|---|---|---|
| Adipiscorus Glipo | 66 | 159371 | | Percontorius Ontu | 66 | 159375 |
| Caravan Master Goshul | 66 | 159368 | | Percontorius Salnu | 61 | 159150 |
| Cohortis Emon | 65 | 159304 | | Pius Truthtaker | 65 | 159292 |
| Cornicularius Wassein | 65 | 159305 | | Praetor Falak | 62 | 159307 |
| Custos Valar | 66 | 159373 | | Quaestorius Martolin | 66 | 159377 |
| Erus Ereptor Yuka | 61 | 159374 | | Redeemer Balakaz | 66 | 159149 |
| Legatarius Banael | 61 | 159370 | | Scelestus Venator Taol | 66 | 159378 |
| Oraculum Yalkin | 61 | 159376 | | Scriptor Ducis Yusi | 66 | 159369 |
| Pecuniosus Kezzlek | 66 | 159367 | | Stoic Aealin | 66 | 159302 |
| Decurion Ralla* | 61 | 159303 | | Vigilum Naillo | 61 | 159306 |

\* Decurion Ralla carries the 100k template but normal (35) resists.

About half carry small caster spell sets (`npc_spells_id` 1/2/5/8/10 —
generic class sets); the rest are pure melee. Single spawn points, 100%
chance (no placeholder lottery in the mirror data).

**Not minis, don't confuse them:** Lord Inquisitor Seru (159000) is the raid
boss — 1,025,000 HP, AC 500, MR 1000, hits 249–771, `raid_target`. Falak
Tholos / Adren Tholos (1,000,000 HP each) and Arena Master Ferin (320,000)
are also separate, much bigger animals in the same zone.

## ⚠ What the mirror CANNOT answer here (Quarm divergences)

- **Respawn:** the mirror's spawn2 rows say ~26 minutes (1559s) for the whole
  tier. Hitya says **18 hours live on Quarm** — trust the live observation;
  this zone's spawn timing is Quarm-custom relative to the eqmac-lineage dump.
- **Loot:** the mirror's tables for all twenty are junk-era (Fine Steel /
  Ringmail / Combine weapons; two — Goshul and Ontu — have NO loot table at
  all). That is plainly not what Quarm's minis drop. Do not build loot
  expectations (or Fight Cards drop tables) from the mirror for these mobs.
- **The "reports"** Hawkner needs (quest drops) do not exist in the mirror at
  all — Quarm-custom quest items. A local session with the live server, or
  simply killing them, is the only source.

First real kills will backfill truth: encounters + loot_observations from the
event itself become the durable record the mirror can't provide.
