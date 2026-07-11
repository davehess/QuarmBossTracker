# Bazaar Filter Pack — finding the good stuff fast (Quarm, Luclin era)

Copy-paste presets for the in-game Bazaar Search window + item watchlists for
price-checking and sniping. Everything below was validated against the Quarm
item DB (2026-07-11): every listed item **exists on Quarm, is in-era, and is
tradable** (several famous "tradables" turned out NO DROP here and were cut —
Pegasus Feather Cloak, Stein of Ulissa).

> **No live price feed exists.** quarm.tips is gone and quarmtraders.com
> froze in March 2024 (EC-tunnel era) — its prices predate the Bazaar and
> Luclin. Where a historical anchor is shown below, treat it as relative
> value only. The in-game search IS the market.

---

## 1. Bazaar Search window presets (the "copy this" part)

The search caps results, so sweep by **Min Price** bands instead of browsing:

| Preset | Settings | What it surfaces |
|---|---|---|
| **Whale sweep** | Min Price `10000`, everything else Any | Every big-ticket listing in the zone. If it caps out, raise to 20000. |
| **Mid sweep** | Min `2000`, Max `10000` | The FBSS/haste-belt/spell tier. |
| **Haste check** | Slot `Waist`, Min `1000` | Haste belts are the most-flipped category — FBSS, RBB, Girdle of Rapidity. Repeat with Slot `Hands` (SCHW) and `Back` (CoF, Siblisian). |
| **Caster sweep** | Class `<your caster>`, Slot `Range`/`Primary`, Min `1000` | Clickies and focus items (Solist's Wand, Staff of Forbidden Rites tier). |
| **Spell snipe** | Item Type `Spell`? — if the type filter is flaky, text-search `Spell:` with Min Price `500` | Dropped rare spells; the real money is the level-56–60 drops (list below). |
| **Gem/commodity check** | Text `Diamond` / `Jacinth`, no price filter | Commodity price floor check before you sell your own. |

## 2. High-value watchlists (validated tradable, in-era)

**Haste (worn)** — Cloak of Flames (36%, the king — historical 50k EC-era),
Flowing Black Silk Sash (21%), Runed Bolster Belt (31%), Girdle of Rapidity
(31%), Silver Chitin Hand Wraps (22%), Fearsome Girdle (41%), Scalecracker
(41%), Heart of the Spider (41%), Belt of Raging Nature (36%), Cowl of
Mortality (36%), Cloak of Crystalline Waters (36%), Tolapumj's Robe (36%),
Spiked Seahorse Hide Belt (34%), Silver Shiverback Hide Sash (31%), Velium
Swiftblade (36% wpn), Mithril Two-Handed Sword (31% wpn), Sash of the
Dragonborn (24%), Siblisian Berserker Cloak (26%), Runebranded Girdle (27%),
Swiftclaw Sash (15%, budget).

**Flowing Thought (mana regen)** — Viscid Slime Gloves (FT4), Medallion of
the Arcane Scientists (FT3), Boots of Flowing Slime (FT3), Crown of Narandi
(FT2), Belt of Thunderous Auras (FT2), Choker of the Wretched, Mask of
Contemplation, Enameled Giant's Finger Ring (FT1s).

**Clickies & class-defining** — Puppet Strings, Amulet of Necropotence,
Staff of Forbidden Rites, Reaper of the Dead, Shield of the Immaculate,
Fungus Covered Scale Tunic, Fungus Covered Great Staff, Goblin Gazughi Ring,
Bracer of the Hidden, Solist's Icy Wand, Shrunken Goblin Skull Earring,
Lute of the Howler.

**Weapons** — Rod of Annihilation (60/40!), Windblade, Blade of Carnage,
Wurmslayer, Frostbringer, Feartouched Greatsword, Blackend Greatsword,
War Marshall's Bladed Staff, Black Bastardsword, Reaver, Exquisite Velium
Claidhmore/Battle Axe (ratio sleepers from the DB sweep).

**Dropped spells (level 55–60, all confirmed tradable)** — Spell: Torpor,
Spell: Regrowth of the Grove, Spell: Wake of Karana, Spell: Servant of
Bones, Spell: Trucidation, Spell: Bedlam, Spell: Pox of Bertoxxulous,
Spell: Blanket of Forgetfulness, Spell: Divine Intervention, Spell:
Sedulous Subversion.

**Commodities** — Blue Diamond (~1k anchor), Jacinth (~500 anchor), Raw
Diamond, Acrylia Ore (volume, not unit price).

## 3. Regenerating these lists

The stat-derived lists come from the local Quarm DB
(`D:\EQServer`, MariaDB `peq.items`, creds in `eqemu_config.json`):
tradables = `nodrop=1 and id<=32701` (higher ids are imported non-Quarm
content; the Supabase `eqemu_items` mirror is the authoritative id
universe). Category queries: `haste>=15`, `manaregen>=1`, `damage/delay
>= 0.42`. Re-run after era unlocks (PoP 2026-10-01 will obsolete half of
this — Runed Belt of Alacrity etc. arrive).
