# Gear / Quarmy Integration — Design (queued)

Owner ask (2026-06-10): pull members' gear into character pages — full focus
effects, missing spells, AAs; recommend items to fill focus/+ATK gaps with
drop sources + recent DKP prices; compute stats (base / self-buffed /
clickies); PvP buff best-practice; hotkey set recommendations; WORN effects
(Fire Fist, infravision — vision items matter to night-blind races).

## Key insight — we already have the primary data source
The agent already parses `<Char>-Inventory.txt` (`/output inventory`) for the
Weapon Loadouts panel (`characterInventories`: weapons + bandolier). Quarmy
profiles are built from the SAME dump. So phase 1 needs no external fetch:
extend the existing parser to ALL worn slots + clickies, upload, join
`eqemu_items` (mirrored — has focuseffect/worneffect/proc/clicky + stats).
`characters.exclude_inventory` opt-out ALREADY exists (data-floor migration)
and must gate the upload agent-side, like exclude_from_stats does.

## Phases
1. **Worn-gear ingest**: agent uploads parsed slots (slot→item_id) on change;
   `character_gear` table (one row per char per slot, upsert-overwrite =
   compact, latest-state — same philosophy as faction v2). Char page section:
   paper-doll list w/ PQDI links.
2. **Effects analysis** (read-time, no new data): per char — worn effects
   present (incl. vision: infravision/ultravision flagged prominently),
   focus effects present vs the era's focus list, clicky inventory.
3. **Recommendations**: missing focus/worn slots → candidate items from
   `eqemu_npc_drops` view (drop source) + `opendkp_auctions` history (last N
   winning bids for that item) + wishlist cross-ref. Melee: +ATK item gaps.
4. **Stat calculator**: base (race/class/level) + worn sums + self-buff
   stack + clicky buffs. PvP best-practice buff/hotkey templates live in
   UI Studio's PvP sets (`uiStudioListPvpSets`) — link the two.
5. **Spells/AAs**: spellbook + AA are NOT in the inventory dump. Sources:
   missing-spells advisor design in CLAUDE.md roadmap (eqemu_spells × class/
   level vs observed casts); AAs need Quarmy scrape or manual — blocked on
   sample (below).

## Blocked on owner input
- **Sample Quarmy profile URL + page source/export** (sandbox network 403s
  external sites): needed to decide scrape vs our-own-inventory-first.
  `/quarmy set` URLs are already stored per character (roster chunks).
- **Privacy green light**: full-slot upload honoring `exclude_inventory`;
  display scope (PRIVATE /me vs GUILD char page) per the visibility contract.

## Storage estimate
`character_gear`: ~25 slots × chars ≈ 10k rows, overwrite-in-place — a few
MB, zero growth. Auction history already exists (opendkp mirror).
