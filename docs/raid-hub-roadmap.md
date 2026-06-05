# `/raid` — the unified operational raid view (next-gen `/buffs`)

Captured 2026-06-05 night. This is the design for the next-gen raid view that
replaces `/buffs`. Read this before resuming.

## The pitch in one sentence

The current `/buffs` page becomes **`/raid`** — the live, structured operational
view of the raid (grouped exactly like in-game), and it becomes the **launchpad**
for loot distribution, buffing coordination, recruiting confirmation, and player
triage. Every feature in this doc orbits this one screen.

---

## The data backbone (mostly already shipped)

What's already flowing today:
- **Raid roster by group + rank** — Zeal type-5 → `raid_roster` (`name`, `class`,
  `group_num`, `level`, `rank`). `rank === '2'` = Raid Leader; `'1'` = Group
  Leader.
- **Per-character live state** — `character_live_state` (buffs, zone, target,
  self HP %, target HP %) for every Mimic-running raider.
- **Buff categorization + HP-slot model + role targets** —
  `web/lib/buffs.ts` (HP slots A/B/C, category buckets, per-role expectations).
- **Character → Discord linking** — `characters.discord_id` + family rollup.
- **Auto-Raid-Invite per character** — `state.ari` (per-char password + setter).
- **DKP balances + recent OpenDKP raids** — bot caches both, 60s TTL.
- **Recent damage / parses** — `encounter_players`, `encounter_threat_snapshots`.
- **Quarmy AA + worn items** — sync just landed (`eqemu_altadv_vars`,
  `eqemu_aa_effects`) → AA mapping + gear-focus lookup.

What's missing (the gaps we'll build toward):
- **Per-buff cast attribution + timer** (who cast which buff on whom, when).
- **Mass-buff cooldown tracking** per caster (Aego/Symbol/POTG/COTH/etc.).
- **Feral Avatar uptime + worn-attack-cap awareness** per player.

---

## The features (in priority order)

### 1. `/buffs` → `/raid` rename + restructure
- Route + nav both rename to `/raid`. Existing `/buffs` redirects.
- Grouped by **live raid group** (already done in `BuffsGrid`).
- Header line shows: raid leader (with crown), group leader per group, total
  raid size, "N running Mimic / M total" coverage.
- Per-character background color tier (the at-a-glance triage signal):
  - **bright green** — all expected buffs present + plenty of time
  - **yellow** — some non-critical missing
  - **orange** — expiring soon (next refresh imminent)
  - **red** — missing critical (HP slot, HP cap class, etc.)
- Click a character → side panel (or modal): full buff list, missing buffs,
  copy `/target <name>` to clipboard, last seen, zone, HP %.

### 2. Raid Leader → Discord auto-link
When `raid_roster` shows a member with `rank === '2'` AND that character has
`/ari` configured AND a `characters.discord_id`, surface:
- "Raid lead: **@<discord>** · ARI: `<char> / <password>`" at the top of `/raid`.
- A **Discord interactive component** in the raid-mobs channel pinned post (or
  a small embed) showing current raid leader, with a "Join Auto-Raid-Invite"
  button that DMs the `/ari` to the clicker. (Replaces hunting for the cmd.)

### 3. Buffer mode (the killer feature)
Click "I'm buffing as <class>" on `/raid` — the page filters/sorts to **the
buffs that class provides**, ordered by who needs them most:
- Cleric → ordered by missing HP slot (POTG/Aego), then by stale Symbol, etc.
- Shaman → missing Avatar/Focus/SoW/etc., with worn-attack-capped tanks first.
- Enchanter → missing C2/KEI, then haste, then runes/rune timers.
- Druid → missing POTG (preferred for casters for the mana regen), thorns,
  SoW, regrowth.
- Bard → missing songs, with a separate sub-view.
- The queue shows **a one-tap "copy /target Name" + the exact spell name**.
- When a buff would benefit a whole group, suggest a **MGB candidate** (and
  surface the buffer's MGB cooldown if known — see #6).

### 4. Group-buff regrouping suggestions
If multiple raiders missing the **same** group buff are in **different
groups**, suggest a temporary regrouping so the buffer can hit them all at
once:
> "Move Hopeya, Melting, Hitya into Group 4 — Bardtholemu can hit all 3 with
> Songs of the Storyteller in one cast."

The suggestion is officer/raid-leader gated (they have move authority). One-tap
to "/raid disband / /raid invite" copy-paste, or eventually a Mimic→EQ pipe.

### 5. RaidHelper integration — confirm sign-ups vs. live roster
- RaidHelper sign-ups define expected attendance + classes per slot.
- `raid_roster` is the live truth.
- Diff: who signed up + isn't in raid? Who's in raid but wasn't on the list?
  Are class slots filled (need a 6th cleric, etc.)?
- Live-update during the raid; the raid leader sees gaps fill or open in
  real time.

### 6. Mass-buff cooldown + Feral Avatar queue
- Track each MGB-capable buffer's cast → cooldown timer (Cleric Aego MGB,
  Shaman Avatar MGB, Enchanter Clarity MGB, etc.).
- Surface "Aego MGB ready: Cordina · 2 min · 12 min · …" on `/raid`.
- **Feral Avatar queue** — special case:
  - Tracked per character: melee class, recent damage, worn-attack stat (from
    Quarmy worn items + `eqemu_items.attack` focus).
  - **Worn-attack-capped players are NOT eligible** for the queue (Avatar
    overcap is wasted).
  - **Top of queue** = high recent damage + not capped + missing Avatar.
  - Beastlord(s) see this queue first when on `/raid` as their buffer view.

### 7. Buff queue with structured slot organization
On a character's own `/raid` row (when they click into themselves) — show the
buff window organized **by slot priority for their class**, with open slots:
- "You have 12 of 15 buff slots; 3 open."
- "Suggested: KEI in slot 4 (mana regen) · POTG in slot 7 (HP+mana regen)."
- Lets the player **request** what they want from their own page, queued for
  buffers in the same priority view (#3).

### 8. DKP integration — auction winner highlight
- When an OpenDKP auction closes, the winning bid character's row on `/raid`
  briefly highlights (a gold border for 2-3 min).
- "Add as looter" one-tap button shows next to the highlight, posting to
  OpenDKP. (The auction-creation cURL was captured earlier; this is the
  consumer side.)

### 9. HP gauges everywhere we can get them
- Zeal slot-1 self HP is already in `character_live_state`.
- With **a Mimic per group**, we could (potentially) infer near-real-time HP
  for every member via cross-correlation — needs experimentation; Zeal only
  exposes self/group HP to the local client.
- Even partial coverage is useful — heat-map the `/raid` view.

---

## Execution order (when we resume)

1. **Stage 1 — the rename + structured view** (the foundation):
   - `/buffs` → `/raid` route + nav.
   - Raid leader badge + ARI surfacing.
   - Per-character color tier (green/yellow/orange/red).
   - Click-into-character side panel + `/target <name>` copy.
2. **Stage 2 — Buffer mode** (the user value spike):
   - Class selector on `/raid` → filtered queue.
   - Reuses the buff-categorization model already in `web/lib/buffs.ts`.
3. **Stage 3 — Live integrations** (depends on Stage 1+2 + earlier roadmap):
   - Quarmy AA + worn-item parser (already in the trigger roadmap) → unlocks
     duration extension AND worn-attack cap awareness for the Feral queue.
   - RaidHelper sign-up diff.
   - Mass-buff cooldown tracker (new agent signal — "you cast X" → bot upsert).
4. **Stage 4 — Loot loop** (depends on `/raid` being the canonical view):
   - Auction-winner highlight + "Add as looter" button on `/raid`.
5. **Stage 5 — Group-buff regrouping suggestions + RaidHelper class slotting.**
6. **Stage 6 — Mob Info overlay** (user-asked, queued AFTER `/raid` work):
   - Mimic overlay showing current target's stats card (the screenshot the user
     shared: name, class, HP, AC, dmg range, resists MR/FR/CR/PR/DR, Summon /
     Enrage / Flurry / Magical chips, Spells / Loot / Compact tabs).
   - Data ready: target name comes from Zeal (`character_live_state.target_name`);
     mob stats from `eqemu_npc_types` (we mirror it); specials column was added
     to the sync (`npcspecialattks` — needs a forced sync to backfill).
   - Bot endpoint: `mob-info` — target name → best `eqemu_npc_types` row → decode
     class int → "Warrior", decode `npcspecialattks` letter flags →
     Summon/Enrage/Flurry/Magical chips, plus top loot from the drops view.
   - Mimic side: new overlay window with the tabbed card, tray toggle +
     onboarding opt-in (like charm/DPS overlays).
   - Honest limits: trash mobs with the same name in different zones can't be
     disambiguated (no instance id, npc_types.zone_short NULL across the
     catalog); named/raid targets resolve cleanly.

---

## Open design questions (decide before each stage)

- **Color tier thresholds** — what counts as "yellow" vs "orange"? Probably
  category-coverage % + time-to-stale on the worst buff.
- **Buffer view scope** — does Buffer mode show ONLY raiders missing my buffs,
  or all raiders with missing-mine emphasized?
- **MGB cooldown signal** — do we infer the cast from log lines (`You begin
  casting <X>` + MGB AA name match), or require an explicit Mimic-side click?
- **Worn-attack cap** — what's the L60 cap value on Quarm? (Stock EQ ≈ 250 from
  worn; needs verification.)
- **Group regrouping** — officer-only suggestion, or visible to anyone?
  Probably officer-only to avoid noise.

---

## "Click character names" final detail
- On `/raid`: clicking a character name opens the **side panel** (per above) —
  buffs/zone/HP/missing/target-copy.
- On Discord: when this raid view is summarized in chat (raid-mobs anchor,
  daily summary, etc.), character names that are linked render as
  `<@discord_id>` mentions where appropriate (raid leader, auction winner) so
  clicking pings them.
- This is the same primitive as the "mention the sender in relayed tell DMs"
  feature already queued — both lean on the same `character → discord_id`
  resolver.
