# Wolf Pack — Active Backlog & Handoff Notes

> Working doc so an implementation can resume cleanly after a context summary.
> Authoritative architecture lives in `CLAUDE.md`; this is just the live queue +
> in-flight findings that aren't obvious from the committed code yet.

## Current state (as of this writing)
- Versions: **Bot 3.0.0 · Agent 3.0.3 · Web 1.0.3 · Mimic 1.0.5**
- Dev branch: `claude/sharp-lamport-dC0TW`. Workflow: commit on branch → push
  branch → merge to `main` with a descriptive `-m` (Railway deploy name) →
  push `main` → return to branch. Bot deploys from `main` (Railway), web from
  `main` (Vercel), Mimic + Parser build via GitHub Actions on `apps/mimic/
  package.json` / version-tag pushes.
- After ANY edit to the agent's `WEB_HTML` template literal
  (`packages/wolfpack-logsync/index.js`): run `npm run check:dashboard`. A bare
  backtick / `${` / unescaped char inside that template breaks the localhost
  dashboard. (Hit twice this session — both were backticks in comments.)

## In-flight findings (not yet acted on)
- **Zeal pet gauge slot = 16.** Confirmed from Hopeya's gauge dump: slot 1=self,
  slot 6=target, slot 16=the charm pet (a 2nd "A Netherbian Drone" at 100% vs
  the target drone in slot 6). Slot 24 ("4", ~53%) is a fixed UI gauge, not the
  pet. → wire slot 16 (HP% + text=name) into Mimic `_zealAbsorb`
  (`apps/mimic/main.js`) so the charm overlay gets live pet HP directly instead
  of via the log-based charm-tracker cross-reference.
- **`character_live_state` migration is ALREADY APPLIED** (Supabase). Columns:
  guild_id, character, zone_id, zone_name, self_hp_pct, buffs jsonb, buff_count,
  uploaded_by, updated_at; RLS on, authenticated SELECT, service_role write.
  Still needs: agent push (debounced flush of `_zealState` per character) →
  new bot endpoint `POST /api/agent/live-state` (bearer) → upsert → web /me
  section that reads it + "see the local dashboard for live data" note.
- **PvP assists are NOT linked by `pvp_kill_id`** (each agent records its own
  assist row independently, FK null, ~1s clock skew). Co-assisters are grouped
  on killer+victim within a 2-min window (web `pvp/[name]/page.tsx`). Any future
  assist work should keep that in mind (or fix the agent to link the FK).

## BACKLOG (pick next 2–3 to do well)

### Quick wins
- **A. Pet slot 16 → charm overlay** — Mimic `_zealAbsorb` reads gauge slot 16
  (pet HP% + name); feed into charm overlay + Buffs & Zone pet line. (agent/mimic)
- **B. Resisted-spells dropdown** — `info` tab "Spells Resisted (incoming)" rows
  should expand to show which mobs cast each spell + counts. Needs the agent to
  track per-caster breakdown for resisted spells (currently only spell→count;
  "Last seen from" is always —). (agent)
- **C. Overlays submenu expansion** — tray Overlays submenu currently has DPS
  HUD / Trigger alerts / Charm. Add: Healing, Tanking, Threat, Overall DMG,
  Buff Timers (these already exist as dashboard panel overlays via the card
  "🪟 overlay" buttons; surface them as named toggles too). (mimic)

### Medium
- **D. Detrimental-spell assist credit** — a debuff cast on the PvP victim
  should count as an assist (currently assist correlation keys off recent
  *damage* to the victim, so non-damaging debuffs/snares/etc. don't credit).
  Signal ideas: "X resisted your <spell>" names victim; spell land "cast on
  other" messages. Needs real Quarm log samples to do reliably. (agent
  `_checkPvpAssist` / pvp assist buffer)
- **E. Char live-state sync** — see in-flight note above. Migration done;
  build agent push + bot endpoint + web display. Update on login (push when
  `_zealState` changes, debounced). (agent+bot+web)

### Large
- **F. /who web section** — name search w/ autocomplete, browse-by-guild,
  and let signed-in users set their own toon's class when known (write to
  `characters.class`, owner-gated). Data: `characters` + `who_observations`.
  (web; maybe a small write endpoint)
- **G. Mimic overlay/setup overhaul** (real install friction — Dafeet hit it):
  - First-run setup page (`apps/mimic/loading.html`) should include an **EQ
    folders** card as the **2nd** item (reuse `findEqInstalls`/`pickEqDir`).
  - Token card should offer **"enter token OR sign in with Discord"** in the
    same area (reuse `mimicLinkStart` device-code flow already built).
  - Overlays **OFF by default** (config defaults: showHud/enableTriggerTts/
    showCharm → false in `defaultConfig()`), and each overlay needs an **✕** in
    the corner to hide it directly (overlay.html / triggers.html / charm.html +
    panel overlays via preload).
  - **Panel overlays** (e.g. "Known Pets This Session") pop up full-window with
    no way to resize/close — add ✕ close + make the gear→setup resize obvious.
- **H. Buff/Debuff coordination queue** — shared raid queue of "needs": boss
  debuff X needs recast, person Y needs rez, person Z cursed→needs cure. Anyone
  can push an item to the top when their buff drops / they get dispelled. Make
  it a FIFO-ish queue with priority bumps. Used to keep a boss debuffed without
  gaps. (agent overlay + bot relay + maybe web view) — design first.
- **I. CH-chain DDR minigame** — complete-heal rotation tool, "DDR style", per
  https://github.com/peetar/rotatonator . Ties into the CLAUDE.md roadmap "CH
  chain chatter analysis". Big; design first.

## Done this session (for reference)
- Pause Discord tells (tray + agent + bot), dashboard stutter fix, stale Zeal
  char prune, charm-land detection (Quarm pet-command acks), Buffs & Zone card
  with zone names, copy-guild-trigger→personal, TTS triggers fire, EQLP
  .tgf/.gz import + timer warnings, GINA-style timer rows, Mimic Discord login
  (device-code), graduated everything out of beta (3.0.0 / 1.0.0), assisted
  installer + self-cleaning uninstall + discoverable uninstaller, no-logs
  crash-loop fix + run-process EQ-folder detection, PvP "most killed guilds" +
  individual-page Assists (+ co-grouping fix), web nav/home/header cleanup,
  dashboard stability (gauge details, My Crits flicker, ✕ hide buttons, buff
  time format), tray reorder.
