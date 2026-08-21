# Local session: extract PoP flag + spell-turn-in data from `D:\EQServer`

**Run this in a LOCAL Claude session on the machine that has `D:\EQServer`.**
A cloud session cannot: the quest scripts are files on that box, and the egress
proxy blocks pqdi.cc / eqemulator.org, so there is no second source.

**Why it matters.** Two features are built and waiting on this data:

1. **Flag coverage for non-Mimic raiders** (agent 3.6.4, already shipping to
   beta). Agents now capture *witnessed hails* — `Fittir says, 'Hail, Seer Mal
   Nae'` — because the authoritative grant line is a self-message only Mimic
   users produce. The agent deliberately does **not** decide which NPCs matter;
   the bot maps NPC → flag against a catalog. **That catalog currently names
   three NPCs** (Mavuin, Giwin Mirakon, Elder Poxbourne). Everything else we
   witness will land as `unmapped` until this runs.
2. **PoP spell turn-ins** (web 1.1.86, live). We inferred the rule
   *Ethereal Parchment → 61-62 · Spectral Parchment → 63-64 · Glyphed Rune Word
   → 65* from ONE class's script (cleric, all 25 spells fit, no exceptions).
   It needs a second witness before we lean on it harder.

---

## 0. Orient

```powershell
cd D:\EQServer
Get-ChildItem quests -Directory | Select-Object -First 20 Name
Get-ChildItem quests -Recurse -Include *.lua,*.pl | Measure-Object
```

Quest scripts are per-zone folders under `quests\`, one file per NPC
(`<NPC_Name>.lua` / `.pl`), plus shared `player.lua` / `global\`.

If `rg` (ripgrep) is present it is far faster than `Select-String`; both forms
are given below.

---

## 1. Flagging NPCs — who grants what, on hail or phrase

EQEmu grants PoP flags a few different ways. Search for all of them:

```powershell
# Lua
rg -n --glob "*.lua" "set_zone_flag|SetZoneFlag|character flag|flagcharacter" quests
# Perl
rg -n --glob "*.pl"  "SetPEQZoneFlag|quest::flagcharacter|character flag" quests
# Fallback without ripgrep
Get-ChildItem quests -Recurse -Include *.lua,*.pl |
  Select-String -Pattern "set_zone_flag|SetPEQZoneFlag|flagcharacter|character flag"
```

For every hit, open the file and record **what triggers it**. The two shapes:

```lua
-- hail-triggered
function event_say(e)
  if (e.message:findi("hail")) then
    e.self:Say("...")
    eq.set_zone_flag(211)          -- <- the grant
  end
end

-- phrase-triggered (this is the "key phrase" case)
  if (e.message:findi("i am ready")) then
    eq.set_zone_flag(215)
  end
```

**Record for each: zone folder, NPC file name, trigger kind (`hail` or
`phrase`), the exact phrase if not a hail, and the zone id / flag granted.**
The phrase list is what unblocks the second half of the feature — we
deliberately do NOT capture arbitrary say-chat hunting for these, so nothing
works until the phrases are known.

Map zone ids to names with the local DB:

```sql
-- creds in D:\EQServer\eqemu_config.json
SELECT zoneidnumber, short_name, long_name FROM zone WHERE expansion >= 4;
```

---

## 2. PoP spell turn-ins — confirm or break the tier rule

Find every NPC that takes the three parchments (ids `29112` Ethereal, `29131`
Spectral, `29132` Glyphed Rune Word):

```powershell
rg -n --glob "*.lua" -e "29112|29131|29132|Ethereal Parchment|Spectral Parchment|Glyphed Rune Word" quests
```

For each script, record the `eq.ChooseRandom(...)` pool for each parchment.
Then **test the rule** — for every spell in every pool:

```sql
SELECT s.id, s.name, i.classes
FROM spells_new s
LEFT JOIN items i ON i.name = CONCAT('Spell: ', s.name)
WHERE s.name IN ('Faith','Tarnation', ...);   -- the pool
```

The claim to falsify: **every Ethereal pool spell is level 61-62, every
Spectral 63-64, every Glyphed 65.** One exception breaks it and we go back to
per-class pools — which is worth knowing, so report exceptions loudly rather
than smoothing them over.

(Levels live in our Supabase `spell_level_seed`, not in `spells_new` — the
eqmac dump has no level columns. If you need the level locally, PQDI works from
this machine.)

---

## 3. Hand the results back

Write **one JSON file** into the repo and commit it — do not paste large
results into chat, and do not hand-edit the catalogs from memory:

`data/pop-quest-extract.json`

```json
{
  "extracted_at": "2026-08-21",
  "server_path": "D:\\EQServer",
  "flag_npcs": [
    { "npc": "Seer Mal Nae", "zone": "poknowledge", "file": "quests/poknowledge/Seer_Mal_Nae.lua",
      "trigger": "hail", "phrase": null, "grants_zone_id": 211, "grants_zone": "potactics",
      "notes": "requires prior flag X" }
  ],
  "spell_turnins": [
    { "npc": "Priest of Life", "zone": "poknowledge", "class": "Cleric",
      "turn_in_item": "Ethereal Parchment", "turn_in_item_id": 29112,
      "pool": ["Faith", "Symbol of Kazad", "..."] }
  ],
  "tier_rule_holds": true,
  "tier_rule_exceptions": []
}
```

Then, on a `claude/*` branch:

```powershell
git add data/pop-quest-extract.json
git commit -m "data — PoP quest extract from D:\EQServer (flag NPCs + spell turn-in pools)"
git push -u origin <branch>
```

A cloud session folds it into `web/lib/popFlags.ts` (NPC → flag) and
`web/lib/popSpells.ts` (tier rule), and wires the bot's NPC matcher. Both are
data-only edits by design, so no agent release is needed for any of it.

---

## Notes

- **Nothing here is sensitive.** These are server content files and the public
  item/spell catalog — no player data, no credentials in the output. Keep
  `eqemu_config.json` itself out of anything you commit.
- **If a script disagrees with our catalog, the SCRIPT wins** and the catalog
  entry gets corrected with a note. `popFlags.ts` already carries `verified`
  flags for exactly this.
- Related: `docs/PRIVACY.md` §"Hail greetings" explains what the agent captures
  and why it is deliberately narrow.
