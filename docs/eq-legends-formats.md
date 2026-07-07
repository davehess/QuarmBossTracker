# EQ Legends — client config file formats (reference)

Captured 2026-07-06 from real files Uilnayar provided (account `aiasknight`,
character **Melting** on server **neriak**). No Legends support is built yet —
this doc is the spec to build from when/if we do. Candidate work items at the
bottom; none committed.

Why we care: Mimic's UI Studio backup/restore and character detection are
hard-anchored to Quarm's `*_pq.proj.ini` naming (`apps/mimic/main.js`
`_uiStudioFilesFor()` and friends). Legends uses a different, richer scheme.

---

## File inventory & naming scheme

| File | Quarm equivalent | Purpose |
|---|---|---|
| `<account>_characters.ini` | none | Account→character index: `[Characters]` / `Character0=Melting,neriak` (name,server per line). Enumerates characters WITHOUT needing a log file to exist — better detection than our log-filename inference. |
| `UI_<Char>_<server>_LO<n>.ini` | `UI_<Char>_pq.proj.ini` | Window layout. TWO new suffix parts: a real server name (`neriak`) and a **layout number** (`_LO1`) — one character can keep multiple numbered layouts. |
| `<Char>_<server>_LO<n>.ini` | `<Char>_pq.proj.ini` | Character settings (hotbuttons, socials, spell loadouts…), same suffix scheme. |

The `LO` concept also shows up INSIDE the settings file (`[Combat]`
`AutoSkillsLO0=` / `AutoSkillsLO1=`), so treat the suffix as first-class, not
an anomaly: capture ALL `_LO<n>` variants per character, not just `_LO1`.

## `UI_<Char>_<server>_LO<n>.ini` — layout file

- `[Main]` — `UISkin=default_modern`, `AtlasSkin`, `UITexture`, `UseTellWindows`.
- Per-window sections (`[PlayerWindow]`, `[GroupWindow]`, `[TargetWindow]`,
  `[ChatManager]`, `[Chat 1..N]`, `[HotButtonWnd..11]`, bags, item displays…).
- **Positions are anchor + percentage**: `XRef`/`YRef` (left/center/right ×
  top/center/bottom) + `XPos`/`YPos` as **percentages** + `Width`/`Height` in
  px. Titanium/Quarm uses absolute pixels — this is the big one for UI Studio:
  Legends layouts are already resolution-portable, so the rescaler math that
  justifies UI Studio on Quarm is mostly unnecessary there; backup/restore is
  the whole value.
- Per-resolution minimize flags (`Minimized2560x1440=`) — harmless to carry.
- `[Default]` maps window-set profile numbers (e.g. `TargetWindow=5`) — a
  window→variant map worth preserving verbatim.
- `[ExtendedTargetWnd]` — the Legends client has a NATIVE extended target
  window with `AutoAddHaters=1` and `AggroPct=1` (aggro %!). Context: this is
  the feature we hand-built as a Mimic overlay for Quarm because Titanium has
  nothing. Do not confuse the two if Legends support ever lands.
- `[ChatManager]` — full chat window/tab/container config + a ~108-entry
  `ChannelMap` + per-window timestamp/highlight settings.

## `<Char>_<server>_LO<n>.ini` — settings file

- `[HotButtons]` — `Page<p>Button<b>=<type><id>,@-1,<flags>,0,<label>,`
  Type prefixes observed: `H` (social/macro page ref), `J` (ability — Mend,
  Feign Death, Sneak, Bind Wound), `E` (item/AA by id), `G` (unknown, id 12).
  Labels ride in the 5th field.
- `[SpellLoadouts]` — **named spell-gem sets**: `SpellLoadout<k>.name=2 - buff`,
  `.slot1..14=<spell id | -1>`, `.inuse=0|1`, 60 slots. Directly parseable into
  a web loadout library (like our bandolier loadouts, but for spell sets).
- `[Socials]` — macro pages with real command lines
  (`Page2Button1Line1=/assist Gump`). PRIVACY note: socials can contain
  personal macro text — if we ever ingest these, they're owner-visible only
  (PRIVATE scope per the stat-visibility policy), never guild-wide.
- `[ExternalTargetRoles]` — XT slot/role config, `^`-delimited blob.
- `[Combat]` — `AutoSkillsLO<n>=` per-layout auto-skill sets,
  `UseImpliedHealing`.
- `[Defaults]` — auto-consent flags, volumes.

## What carries over vs what doesn't

- **UI Studio backup/restore (`ui_layout` endpoint)**: storage is already
  format-agnostic named-blob storage — only the CAPTURE list in
  `apps/mimic/main.js` needs the Legends patterns (`<account>_characters.ini`,
  `UI_<c>_<server>_LO<n>.ini`, `<c>_<server>_LO<n>.ini`). Restore is a file
  write-back, same as today.
- **Character detection**: `<account>_characters.ini` beats log-filename
  inference — but note Legends log naming is UNVERIFIED (we have no Legends
  log sample; Quarm's is `eqlog_<Char>_pq.proj.txt`). Get a log sample before
  building anything log-driven.
- **Zeal does NOT exist on Legends** — no pipe, no gauges, no live HP/target.
  Everything Zeal-fed (Extended Target overlay, live-state, buff sync, charm
  tracker) has no data source there. Log-only features (parse, triggers,
  /who, chat relay) are the only plausible ports, pending a log sample.

## Candidate work items (none committed)

1. **UI backup support** — extend the UI Studio capture list to Legends
   naming. Small, self-contained, Mimic-only (beta).
2. **Spell-loadout ingest** — parse `[SpellLoadouts]` (+ names) into the web
   loadout library. Needs a spell-id→name source for Legends (our `eqemu_*`
   mirrors are Quarm's DB — ids may not match Legends).
3. **Full Legends feasibility map** — requires a Legends LOG sample first;
   everything Zeal-backed is out by construction.
4. Nothing — leave as reference.
