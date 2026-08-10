# EQEmu catalog + derived-data cheat-sheet

Load-bearing facts about the `eqemu_*` mirror and the character pages built on
it, so nobody re-derives them from EXPLAIN plans again. If you're about to query
`eqemu_*` or touch the gear/spells/inventory pages, read this first.

## Tier-1 `eqemu_*` mirror conventions

- **Zone is encoded in the NPC id.** `eqemu_npc_types.id = zoneid * 1000 + n`.
  So `floor(npc_id / 1000)` = the zone's numeric id → join
  `eqemu_zone.zone_id`. Cheap NPC→zone path that needs no spawn join, and the
  fallback for the ~10% of NPCs (1,846 of 18,033) with no spawn row (below).
- **`eqemu_merchantlist.merchantid` is NPC-id-shaped** (range ~1008–210059), so
  `floor(merchantid / 1000)` = zoneid too. Use it to find which zone sells an
  item — no spawn join needed.
- **`eqemu_zone.expansion`** is the era signal: `0` Classic · `1` Kunark ·
  `2` Velious · `3` Luclin · `4` **Planes of Power** · `-1`/`99` special/system.
  22 PoP zones (poknowledge, potimea, bothunder, …). This is how you tell an
  item/spell's expansion when there's no expansion column on the item itself.
- **`spawn2` / `spawnentry` / `spawngroup` ARE populated** (verified 2026-07-27:
  43,654 spawn points — all with x/y/z + respawn — across 182 zones; 16,187 of
  18,033 NPCs placed). Join `npc_id → eqemu_spawnentry.spawngroup_id →
  eqemu_spawn2` for a mob's zone(s), coords, and per-entry spawn
  `chance` (placeholder odds); read zone from `eqemu_spawn2.zone_short`. For
  `respawntime` see the warning below — it is NOT the raid timer. The
  *denormalized* `eqemu_npc_types.zone_short` column is still NULL — don't read
  that one. (This bullet used to say the spawn tables were empty; the weekly
  `sync-quarm.yml` mirror now pulls them.)
- **Item → source zone(s):**
  - *Sold:* `eqemu_merchantlist m ON m.item = item.id` →
    `eqemu_zone z ON z.zone_id = m.merchantid/1000` → `z.expansion`.
  - *Dropped:* `eqemu_npc_drops d ON d.item_id = item.id` (denormalized:
    `npc_id, item_id, item_name`) → `z.zone_id = d.npc_id/1000` → `z.expansion`.
    (The normalized path is npc_types.loottable_id → loottable_entries →
    lootdrop_entries.item_id; `eqemu_npc_drops` is the shortcut.)
- **⚠ `eqemu_spawn2.respawntime` IS NOT THE RAID TIMER — `data/bosses.json`
  `timerHours` is.** Measured 2026-08-06 against PQDI: Derakor the Vindicator's
  real instance timer is **2d18h (66h)**, and the catalog says **472.22h**
  (1,700,000s). That 472.22h is a flat **sentinel**, not a measurement — 15 of
  the 19 tracked raid bosses that join to a spawn row carry the identical value
  whether their true timer is 66h or 162h. Instanced raid targets are spawned by
  the instance system, so the spawn2 row just parks a very-long placeholder.
  Three bosses happen to agree (Aten Ha Ra 162, Maestro of Rancor 66, a
  Dracoliche 66) — coincidence, not a rule to lean on — and Saryrn disagrees the
  *other* way (catalog 72h, actual 168h), so "catalog value looks plausible" is
  not a safety check. Nothing in the bot reads this column today (only
  `scripts/sync-from-eqmac.js` writes it); keep it that way. Trash respawns are
  a different matter and look real — the Kael protectors' 24.4m, the Sleeper's
  Tomb 24h — but they are unverified against live behaviour.
- **Useful indexes exist** on `eqemu_merchantlist(item)` and
  `eqemu_npc_drops`… but NOT a prefix index on `eqemu_items.name` (only a GIN
  tsvector) — see the spells-page perf note below.

## Items & spells catalog shape

- **Spell scrolls are items named `Spell: %`.** The class mask is
  `eqemu_items.classes` (bitmask `1 << classId`, WAR=1 … ENC=14). The scribed
  spell name is `regexp_replace(substring(name from 8), '\*+\s*$', '')` (strip
  `Spell: ` prefix and any trailing `*`).
- **`eqemu_items.required_level` / `recommended_level` are 0 for every spell
  scroll** — do NOT use them to infer scribe level.
- **`eqemu_spells` is minimal: `id, name, raw`, plus effect/resist columns.**
  There are **no per-class level columns** and `raw` only holds
  `{eff, base, max, formula}` effect slots (decoded by
  `web/app/character/[name]/gear/page.tsx#decodeSpell`). **There is no reliable
  scribe-level source in the catalog** — level comes only from guild spellbook
  uploads (`character_spellbook.spell_level`) or officer seed
  (`spell_level_seed`), both sparse.
- **Worn ATK / haste / Flowing Thought ride the worn-effect SPELL**, not item
  columns, on this era's catalog. Gear page decodes them (SPA 2=atk, 15=FT,
  124–143=focus). Worn ATK caps at 250 in game; item.attack == worneffect SPA-2
  (same stat — max, don't sum).

## PoP-spell detection (no expansion column on spells)

A spell is treated as "PoP, unobtainable until the 2026-10-01 unlock" when its
catalog sources are PoP-only:
`has_expansion_4_source AND NOT has_expansion_0..3_source` (sell OR drop, via the
paths above). Optionally also `known_scribe_level >= 61` (Luclin capped at 60;
61–65 is unambiguously PoP). **Precision is high, recall is partial:** most 61–65
spells have NO merchant/drop row in the mirror at all (~107 scrolls have no
catalog source), so they can't be auto-classified — officer seed is the fallback.

## Character data-export surfaces (three DIFFERENT files)

| In-game file | Agent parser | Supabase table | Web page |
|---|---|---|---|
| `<Name>Quarmy.txt` (manual in-game export, also for quarmy.com) | `scanQuarmyExports` | `character_gear` (equipped+bags), `character_aas` | `/character/[name]/gear` |
| `<Name>-Inventory.txt` (`/output inventory`; Zeal ExportOnCamp regenerates on camp) | loadout scan | in-memory `characterInventories`, `character_inventory` | agent dashboard "Weapon Loadouts", `/character/[name]/inventory` |
| Spellbook paste (📖 on `/me`) | web upload | `character_spellbook` | `/character/[name]/spells` |

- **Polling:** `scanQuarmyExports` runs 30s after agent start, then **every 10
  min**, checksum-deduped (`_quarmyUploaded[char] === checksum`) — only
  re-uploads when the file's bytes change. Same cadence for the spellbook scan.
- **Camping ≠ gear refresh.** Zeal's ExportOnCamp regenerates
  `/output inventory` (loadouts), NOT the Quarmy export — so a consumed item can
  linger on the gear page until the member re-runs the Quarmy export in game.
- **Privacy:** Bank/SharedBank/coin rows are dropped in `parseQuarmyExport`
  on the member's machine before upload; `exclude_inventory` on `/me` stops the
  read entirely. See `docs/DESIGN-quarmy-gear.md` / `docs/PRIVACY.md`.

## `/character/[name]/spells` (missing-spells) data path

`character_missing_spells(p_guild_id, p_character, p_class_bit)` RETURNS
`(spell_name, scroll_item_id, spell_id, scribe_level, held_by[], buyable, pop)`:
- pool = `eqemu_items WHERE name LIKE 'Spell: %' AND classes & bit` minus what's
  in `character_spellbook` for the character.
- `buyable` = exists in `eqemu_merchantlist`. `held_by` = guildmates with the
  scroll in `character_inventory`. `scribe_level` = min guild-uploaded level or
  `spell_level_seed`. `pop` = PoP-only source (see above).
- **Perf:** the pool step seq-scans `eqemu_items` for `name LIKE 'Spell: %'`
  (~27k rows). Kept fast by `eqemu_items(name text_pattern_ops)` +
  `eqemu_spells(lower(name))` indexes (migration 20260714…). Without them the
  RPC is ~3s and the `force-dynamic` page "spins" on soft-nav (no `loading.tsx`
  feedback). A `[name]/loading.tsx` skeleton covers the perceived hang.
</content>
</invoke>

---

## `/useitem <slot>` — the equipped-slot click numbers

Asked for periodically by members, so it lives here rather than being re-derived.
`/useitem N` fires whatever is equipped in slot N. Weaker than `/use <itemname>`
(it does not follow the item if you move it) but **consistent for that slot**,
which is exactly what you want in a macro that should always click the thing on
your wrist.

| N | Slot | | N | Slot |
|---:|---|---|---:|---|
| 0 | Left Ear | | 11 | Hands |
| 1 | Head | | 12 | Primary |
| 2 | Face | | 13 | Secondary |
| 3 | Right Ear | | 14 | Left Finger |
| 4 | Neck | | 15 | Right Finger |
| 5 | Shoulders | | 16 | Chest |
| 6 | Arms | | 17 | Legs |
| 7 | Back | | 18 | Feet |
| 8 | Left Wrist | | 19 | Waist |
| 9 | Right Wrist | | 20 / 21 | Ammo |
| 10 | Ranged | | 22–29 | General inventory |

⚠ **The in-game inventory diagram misprints Waist as `10`.** It is **19** — 10 is
Ranged. Copying the diagram literally produces a macro that fires your ranged
item instead of your waist clicky, and it fails silently.

⚠ **These are NOT the EQEmu internal slot ids.** The internal ids in
`eqemu_*` start at Charm = 0, so they run one AHEAD of this list from Left Ear
onward (internal Left Ear = 1, `/useitem` Left Ear = 0). Never feed a DB slot id
straight into `/useitem`.

### What we can and cannot auto-generate today

`character_inventory.slot_label` stores slot NAMES, not numbers — `Primary`,
`Chest`, `Waist`, `General1`, `SharedBank6-Slot2` and so on. So:

- **Auto-generable**: every unambiguous equipped slot — Head, Face, Neck,
  Shoulders, Arms, Back, Ranged, Hands, Primary, Secondary, Chest, Legs, Feet,
  Waist. A `slot_label` → N lookup is all it takes.
- **NOT auto-generable**: the paired slots. We store `Ear`, `Wrist` and `Fingers`
  with no left/right distinction, so we cannot tell 0 from 3, 8 from 9, or 14
  from 15. A clicky generator must either ask which side, or emit both and let
  the user delete one. **Do not guess a side** — a wrong number is a macro that
  silently clicks the wrong item mid-raid.
- Bag slots (`General1`…) are inventory, not equipped, so `/useitem` numbering
  above 21 is only meaningful for items actually sitting in the top-level
  general slots.
