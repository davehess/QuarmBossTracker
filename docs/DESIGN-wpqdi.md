# DESIGN — wpqdi (Wolf Pack Quarm Database Interface)

An in-house, **guild-gated** EverQuest/Project-Quarm database browser on
wolfpack.quest — our own PQDI (pqdi.cc), built on the `eqemu_*` mirror we
already sync weekly. Motivation: pqdi.cc uptime has been poor, and every
catalog cross-link we ship today deep-links *out* to it (search results, the
`/character/*/spells` links, the Target Info overlay #186). wpqdi brings that
in-house so a raider looking up an item/mob/spell never hits a third-party
outage.

**Status:** design / not started. Author: cloud session 2026-07-27.
**Product name + route are Hitya's call** (see Open Questions) — "wpqdi" is a
working title.

---

## Decisions locked (2026-07-27)

1. **Guild-gated, NOT public.** Keep the existing per-page sign-in gate
   (`supabaseServer().auth.getUser()` + `redirect('/auth/signin')`, the same
   pattern every catalog page already uses). No public-RLS work, no separate
   anonymous surface. This is *simpler* than a public clone would be:
   - No need to strip guild-specific joins out of a "public view."
   - We can read via `supabaseAdmin()` (service-role) exactly like the other
     catalog pages (`web/lib/supabase.ts:23`).
2. **Lean into the guild-data differentiator.** Because it's behind the gate,
   every wpqdi page can weave in *our* data — the thing pqdi.cc can never show:
   - Item page → "held by N guildmates" (`character_inventory`), "won X times /
     avg DKP / last dropped" (`loot_drops`), wishlist demand (`wishlists`).
   - NPC page → "our kills: last killed, avg fight duration, best parse" from
     `encounters`, with a link to the existing `/boss/[id]` history view.
   - Zone page → our recent activity there.
   - Honor the opt-out flags (`exclude_inventory`, `exclude_from_stats`) on
     every guild-data join — see Domain policies in CLAUDE.md.

---

## Data readiness (VERIFIED 2026-07-27 — don't re-derive)

The back-end is ~95% of what PQDI itself renders, refreshed weekly by
`sync-quarm.yml`. Live counts:

| Entity | Rows | Table(s) |
|---|---|---|
| Items | 26,971 | `eqemu_items` |
| NPCs | 18,033 | `eqemu_npc_types` |
| **Spawn placements** | **43,654 points, all w/ x/y/z + respawn, 182 zones; 16,187/18,033 NPCs placed (90%)** | `eqemu_spawn2` + `eqemu_spawnentry` + `eqemu_spawngroup` |
| Loot | 44,587 drop entries | `eqemu_loottable(_entries)` → `eqemu_lootdrop(_entries)`; view `eqemu_npc_drops` |
| Spells | 3,933 | `eqemu_spells` |
| Factions | ~7k | `eqemu_faction_list_full`, `eqemu_npc_faction(_entries)`, `eqemu_faction_list_mod` |
| Recipes | 7,448 / 54,229 entries | `eqemu_tradeskill_recipe(_entries)` |
| Merchants | 25,875 | `eqemu_merchantlist` |
| Forage/fishing/ground/turn-ins | present | `eqemu_forage`, `eqemu_fishing`, `eqemu_ground_spawns`, `scripted_npc_turnins` |

### The spawn-location win (corrects a stale doc)
Until this was checked, CLAUDE.md and `eqemu-catalog-cheatsheet.md` both said
the spawn tables were empty and the only NPC→zone path was the id-encoding
trick. **That is no longer true** — the spawn tables are fully populated. The
canonical "where does this NPC live" join, with a verified sample:

```sql
SELECT n.name, n.level, s.zone_short,
       s.x, s.y, s.z, s.respawntime, se.chance
FROM eqemu_npc_types n
JOIN eqemu_spawnentry se ON se.npc_id = n.id
JOIN eqemu_spawn2 s      ON s.spawngroup_id = se.spawngroup_id
WHERE n.id = <npc_id>;
-- e.g. #Aaryonar → templeveeshan (-781,208,99) respawn 1,700,000s (raid dragon)
--      #Ashenbone_Broodmaster → 8 spawn points in hate_instanced, chance 10% each (PH chain)
```

`se.chance` gives placeholder odds; multiple rows = multiple spawn points /
zones. Read zone from `eqemu_spawn2.zone_short` (the join), **NOT** from
`eqemu_npc_types.zone_short` (that denormalized column is still 100% NULL).
For the ~10% of NPCs with no spawn row, fall back to the id-encoding trick
(`floor(npc_id/1000)` → `eqemu_zone.zone_id`).

### Real data gaps (bounded, none block Phase 1)
1. **Spell scribe-levels.** `eqemu_spells` has no per-class level columns;
   scroll `required_level`/`recommended_level` are 0. Level is known only from
   guild spellbook uploads (`character_spellbook.spell_level`) or officer seed
   (`spell_level_seed`), both sparse. → Show level *when known*, omit otherwise.
   Stats/effects display is unaffected.
2. **Item icons.** `eqemu_items.icon` is a sprite-atlas index; the gequip atlas
   isn't hosted. → **Needs a local session** to extract `gequip*.dds/tga` from
   `A:\EQ`, slice to per-icon PNGs, host in `web/public` or Supabase Storage.
   Not a P1 blocker — ship with a slot/class glyph placeholder first.
3. **Item id-duplication.** Quarm re-itemizes some items under duplicate
   `eqemu_items` ids. → Match by name as well as id (mirror the bot's approach,
   `index.js:10988-11010`).

---

## Reusable assets (the expensive parts already exist)

How the app reads the catalog today: each catalog page is a Next.js **server
component** calling `supabaseAdmin()` and self-gating with `getUser()`. There
is no shared catalog data-access layer — queries are inlined per page. RLS on
Tier-1 `eqemu_*` is already `authenticated`-readable, and `middleware.ts` does
NOT enforce auth (it only refreshes sessions) — the gate is the per-page
`getUser()`. So wpqdi pages follow the exact same pattern.

| Need | Reuse | Location |
|---|---|---|
| Item stat card (bitmasks, resists, clicky, flags, price) | `ItemHover` + `item_card_info` RPC | `web/app/character/[name]/inventory/ItemHover.tsx`, `inventory/page.tsx:109` |
| Spell effect decoder (SPA slots → text) | `decodeSpell` | `web/app/character/[name]/gear/page.tsx:50` |
| Filterable/sortable loot table | `LootBrowser` | `web/components/LootBrowser.tsx` |
| Cross-entity search (items/spells/npcs) | search API + page + header dropdown | `web/app/api/search/route.ts`, `web/app/search/page.tsx`, `web/components/GlobalSearch.tsx` |
| **Full NPC resolver** (stats + drop table + castable spells) | bot `mob-info` handler — PORT to a web server component | `index.js:10890-11198` (route `:14926`); view `eqemu_npc_drops`; npc_spells inheritance walk `:11068-11162` |
| Faction join chain (npc→faction→list, race/class/deity mods) | factions page logic | `web/app/character/[name]/factions/page.tsx:99-229`, `web/lib/factionGroups.ts` |
| Item name→id linkifier (1h cache) | `item-link` | `web/lib/item-link.ts` |
| NPC-by-eqemu-id routing + zone join skeleton | boss page | `web/app/boss/[id]/page.tsx` |

**Biggest single wiring task:** search results currently deep-link OUT to
pqdi.cc (`api/search/route.ts:94,103`; `search/page.tsx:216,231`). Flipping
those hrefs to internal wpqdi routes is most of what makes the site feel whole.

---

## Information architecture

Base route TBD (Open Questions). Using `/db` as a placeholder:

- `/db` — hub: global search + browse-by-category (items / bestiary / spells /
  zones / factions / recipes).
- `/db/item/[id]` — item detail: full stat block, all effects expanded,
  **dropped-by** (`eqemu_npc_drops` reverse), **sold-by** (`eqemu_merchantlist`),
  **used-in-recipe** (`tradeskill_recipe_entries`), usable-by summary, + guild
  data (held-by / loot history / wishlist).
- `/db/npc/[id]` — bestiary: stats (level/hp/ac/resists/dmg/specials/see-invis),
  **spawn section** (zone + coords + respawn + PH chance from the spawn join),
  loot table, castable spells, faction hits, + "our kills" tab → `/boss/[id]`.
- `/db/spell/[id]` — spell detail (decoded effects, resist, sources; level when known).
- `/db/zone/[short]` — zone contents: NPCs (via `spawn2.zone_short`), notable
  drops, connections (`eqemu_zone_points`, `eqemu_doors`), era.
- `/db/faction/[id]` — faction browser (P3).
- `/db/recipe/[id]` — recipe (P3).

Every entity name renders as an internal cross-link → the link graph
(item↔npc↔spell↔zone↔faction↔recipe) is the whole point.

---

## Phased plan

Sizing assumes a focused solo build reusing the assets above. Each page ships
independently. Web changes → `main`, bump `web/package.json` + a
`web/lib/roadmapData.ts` entry per release.

### Phase 1 — the pqdi.cc reliever (~1–1.5 weeks)
Covers ~80% of PQDI traffic.
- `/db/item/[id]` — reuse `ItemHover` + `item_card_info`; add drop/vendor/recipe
  sources + guild-held/loot data.
- `/db/npc/[id]` — port the bot resolver; add the spawn section (new; the win
  above); add "our kills" link.
- `/db` hub + list/search landing.
- Flip existing search + `/character/*/spells` + (#186) Target Info links from
  pqdi.cc → internal.
- No schema migration; no RLS change (authenticated-readable already).
- Icons optional here (placeholder glyph; real atlas is a local-session dep).

### Phase 2 — zones + spells (~3–5 days)
- `/db/spell/[id]` + spell browser (reuse `decodeSpell`).
- `/db/zone/[short]` (spawn2-by-zone + connections).

### Phase 3 — long tail (~1–2 weeks)
- Faction browser (reuse join logic, new faction-centric route).
- Recipe/tradeskill browser (data mirrored, UI 100% greenfield).
- Item icon atlas (after the local-session extraction lands).
- Quest pages — **data-limited**: our `quest_catalog` is officer-curated, not a
  full quest DB; `scripted_npc_turnins` (4,473) is the raw material. Not full
  PQDI parity; scope with Hitya.
- Global cross-link polish + response caching.

**~3–4 weeks to broad parity; real downtime relief in week one.**

---

## Open questions (for Hitya)

1. **Product name + base route.** "wpqdi" working title; route `/db` vs
   `/wpqdi` vs `/library` etc. (Naming is the guild lead's call per CLAUDE.md.)
2. **How much guild data to weave in**, and confirm the privacy line (honor
   `exclude_inventory` / `exclude_from_stats` on every join).
3. **Retire external pqdi.cc links entirely?** (Closes #186's external
   dependency once Phase 1 item/npc pages exist.)
4. **Icon-atlas extraction priority** — schedule the local session, or ship
   with glyph placeholders indefinitely?

---

## Dependencies / cross-refs
- **Needs a local session:** extract the gequip icon atlas from `A:\EQ` → host
  per-icon PNGs (add to `docs/STATUS.md`).
- Supersedes/redirects **#186** (PQDI link on Target Info overlay).
- Related existing surfaces to cross-link, not duplicate: `/boss/[id]` (our kill
  history), `/character/[name]/{gear,inventory,spells,factions,quests}`.
- Catalog conventions + limits: `docs/eqemu-catalog-cheatsheet.md` (now
  corrected re: spawn tables).
