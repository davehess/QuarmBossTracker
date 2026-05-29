# 3.0 — Triggers & Overlays

Status: **design + import spike** (branch `claude/triggers-3.0-prototype`, nothing deploys).
Decisions locked with the user:
- **Overlay approach: phased A → B.** 3.0 ships triggers + TTS + sound + a
  browser/OBS overlay (zero new deps). 3.1 adds a thin native always-on-top
  click-through companion. The zero-dep single-file parser stays intact.
- **First slice: the web trigger library** on wolfpack.quest — guildies
  browse/enable packs, the agent syncs the enabled set. Infra before client.

## What we're importing

EQLogParser `.tgf` (the format the user's real export uses; GINA `.gtp` is a
secondary target). `.tgf` is a JSON tree — array of nodes, each a GROUP
(`.Nodes`, no `.TriggerData`) or a TRIGGER (`.TriggerData`). Reverse-engineered
from a real 1,541-trigger / 509-group export and cross-checked against
github.com/kauffman12/EQLogParser.

`TriggerData` fields we map (see `scripts/import-eqlp-triggers.js`):
`Pattern`, `UseRegex`, `Priority`, `TimerType` (0 none / 1 countdown /
2 stopwatch / 4 repeating), `EnableTimer`, `DurationSeconds`,
`ResetDurationSeconds`, `WarningSeconds`, `RepeatedResetTime`,
`TriggerAgainOption`, `TimesToLoop`, `LockoutTime`, and the notification
channels `TextToDisplay` / `TextToSpeak` / `Warning*` / `End*` /
`SoundToPlay` / `EndSoundToPlay`. Capture placeholders: `{S}` whole match,
`{Sn}` group n, `{C}` counter.

### The user's real set (validated)
1,541 triggers / 509 groups. Overwhelmingly **TTS (912)** + **display-text
(1,062)**, heavy regex (837). Only **51 live timers**, **4 sounds**, **1
overlay**. So v1 can be voice + on-screen-text first; timer bars second.

### Quarm-relevance auto-scoring
~630 of the triggers are the shared "Safe Space Super GINA" pack authored for
other servers (P99 etc.) — their patterns name mobs/spells absent on Quarm and
never fire. `scoreRelevance()` tags each trigger:
- **live** — pattern names a Quarm boss/zone/spell (word-boundary match)
- **generic** — generic EQ system line, fires anywhere
- **dormant** — proper-noun pattern with no Quarm match (likely another server)

Offline floor (bosses.json only): 86 live / 242 generic / 1,212 dormant.
Production scoring runs against `eqemu_npc_types` (14k) + `eqemu_spells` (26k)
and will reclassify many "dormant" → live. Officers toggle packs on the web;
dormant triggers import but ship disabled.

## Proposed data model (Supabase)

```sql
-- A shareable bundle of triggers (an import, or a curated guild pack).
create table trigger_packs (
  id          uuid primary key default gen_random_uuid(),
  guild_id    text not null,
  name        text not null,
  source      text,                 -- 'eqlogparser_tgf' | 'gina_gtp' | 'manual'
  imported_by text,
  created_at  timestamptz default now()
);

-- One normalized trigger. group_path preserves the EQLP folder tree.
create table triggers (
  id            uuid primary key default gen_random_uuid(),
  pack_id       uuid references trigger_packs(id) on delete cascade,
  guild_id      text not null,
  group_path    text,
  name          text not null,
  pattern       text,
  use_regex     boolean default false,
  priority      int default 3,
  timer_type    text default 'none',   -- none|countdown|stopwatch|repeating
  timer_enabled boolean default false,
  duration_sec  int default 0,
  warning_sec   int default 0,
  trigger_again text default 'restart',
  text_display  text,
  text_speak    text,
  warn_text_display text, warn_text_speak text,
  end_text_display  text, end_text_speak  text,
  sound text, end_sound text,
  relevance     text default 'generic', -- live|generic|dormant|no_pattern
  enabled       boolean default false,  -- officer toggles; dormant ships off
  created_at    timestamptz default now()
);
create index triggers_pack_idx on triggers(pack_id);
create index triggers_enabled_idx on triggers(guild_id, enabled) where enabled;
```

RLS: authenticated read; service_role write (bot/import route only).

## Build order

1. **Import pipeline** (done as offline spike): `scripts/import-eqlp-triggers.js`
   parses `.tgf[.gz]` → normalized rows + relevance. Next: a bot route
   `POST /api/triggers/import` (officer-gated) that runs the same parser,
   scores against eqemu catalogs, and upserts packs/triggers.
2. **Web library** (`/admin/triggers` or `/triggers`): browse packs → groups →
   triggers; filter by relevance; per-trigger + per-group enable toggle;
   "enabled set" is what agents sync. Relevance chips (live/generic/dormant).
3. **Agent sync**: agent pulls the enabled trigger set on startup + every N min
   (`GET /api/agent/triggers`), compiles regex once, evaluates each kept log
   line against them in the existing per-line loop. Matches → TTS (PowerShell
   `System.Speech`), sound (`System.Media.SoundPlayer`), and overlay events
   pushed over SSE/WebSocket to the browser overlay.
4. **Browser overlay** (Path A): agent serves a transparent overlay page
   (text stack + timer bars) consumable as an OBS browser-source or a
   borderless always-on-top browser window. Draggable/resizable regions saved
   to agent state.
5. **Native companion** (Path B, 3.1): thin always-on-top click-through window
   rendering the same overlay payload.

## Open items for the morning
- Confirm the data model before the migration lands in prod Supabase.
- The user mentioned a Vercel site with triggers "built in" — re-share the link
  so we fold its set into the import target list.
- GINA `.gtp` (ZIP+XML) import: needed, or is EQLogParser `.tgf` the only
  source in practice? (`.tgf` is already JSON; `.gtp` needs ZIP central-dir
  parsing in pure Node.)
- TTS voice/rate defaults; whether to honor each trigger's `VoiceRate`/`Volume`.
