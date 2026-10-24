# DESIGN — a local model that understands how your game works (decision points)

**Status: DESIGN, written 2026-10-24. A decision-points document, not a build plan. Nothing is built, nothing is
wired, no dependency is added.** Every claim about a specific model, runtime, speed or licence is marked
**(unverified)** unless it was read from this repo; those are Phase 0's job to settle (§6).

> *"start planning extra decision points that could turn mimic into your local small language model that
> understands how your game works."* — the guild lead, 2026-10-24. Same message, the hard constraint: **no
> automations come back into the client.**

Builds on, and does not repeat: `docs/PRIVACY.md` (what leaves the PC), `docs/DESIGN-lord-mobsincamp.md` (the
members' assistant on Tower, over the hub's archive), `docs/DESIGN-open-hub.md` (history lives on the PC),
`docs/DESIGN-mimic3-voice.md` (callouts must never go silent), `docs/DESIGN-agent-third-party-calls.md` (who the
agent may talk to).

## 0. TLDR for the reader in a hurry

- Most of what the guild lead means by "understands how the game works" is **facts the agent already holds on the
  PC** (spell/item/mob catalogs, the log, Zeal's live state, the local store) plus **rules we already wrote**.
  A language model is the thin layer on top that reads a question and phrases an answer. It is not the memory.
- Small models (1–4B class) are **too slow for anything mid-pull** on a machine that is also running EverQuest, and
  too unreliable to be trusted with "cast this now". They fit **between pulls and between raids**: writing a
  trigger from a sentence, recapping a death, explaining a fight.
- The first use case should be the one with an **automatic test oracle**: natural-language trigger authoring, where
  the existing trigger compiler and a replay of a log decide pass or fail.
- The model only ever **displays**. It has no path to the client: not the Zeal pipe's write side, not keystrokes,
  not a macro. That is enforced by structure and by a test, not by a promise (§4).

## 1. What "understands how your game works" could mean

### 1a. What a local model could actually see today

Read from the code, not assumed. Everything here is on the raider's PC already.

| Source | Where it lives | Notes |
|---|---|---|
| The EverQuest log | `eqlog_*_pq.proj.txt`, tailed by the agent | Filtered at the byte level before parsing (`shouldKeep`, `triggerVisibleLine`); tells, group, officer and custom channels are dropped. The same filter guards *Rebuild from my logs* and the feedback excerpt |
| Zeal's live state | `_zealState` per character: gauges (self, target, pet; HP per-mille), buffs, zone, position, raid and group frames | The pipe is **output-only**: Zeal writes, Mimic reads (`DECISIONS-2026-09-21.md` §59e). Spawn ids ride the pipe since Zeal 1.4.6 |
| Catalogs | `logsync.spell-catalog.json`, `logsync.item-catalog.json`, `logsync.item-clickies.json`, cached `mob-info` rows; the weekly `data-latest` data pack (60 MB budget) feeds a standalone Mimic | Game data, public. Spell catalog carries landing messages, `npc` and `ae` flags |
| The local store | `_localStore`, NDJSON under `local/<kind>/<UTC day>.ndjson`: `fight`, `raid_session`, `death`, `loot`, `zone_visit`, `track_minute` (90 days), `hub_encounter` (the guild's merged record, 120 days) | Never uploaded. "On this PC" pages read it (`/api/local/*`) |
| The History ring | last `FIGHT_HISTORY_MAX = 100` fights, all players, 7 days | In `logsync.stats` |
| Triggers | guild set (polled from the bot), `personal_triggers.json`, imported GINA / EQLogParser files | Regex + Zeal gauge conditions, `text_overlay`, `tts`, timers |
| Charm / pet / CH chain / threat / DPS state | in-memory trackers in the agent, the 🐺 Charm diagnostic card | Derived, per fight |
| Voice | Piper and Kokoro run as child processes (`apps/mimic/neuralVoice.js`), Windows voice as fallback | The precedent for "download a runtime and a model, run it as a child process" |

What is **not** local: other raiders' per-hit detail past what this PC saw, the hub's hail board and PoP flag
state for the rest of the raid, anything older than the local windows above. Those live on the hub, and that is
Lord Mobsincamp's territory.

⚠ The agent is one zero-dependency file (`packages/wolfpack-logsync/index.js`, 65.6k lines at this writing),
copied into Mimic alongside `supervisor.js` and `package.json`, running on Electron 31 / Node 20. **A model
runtime therefore cannot be an npm module the agent `require`s.** It has to be a separate process the agent
starts and talks to over localhost, exactly as Piper and the sherpa-onnx synthesiser are.

### 1b. Five use cases, ranked

Real-time need: **RT** = must answer in under a second, **S** = seconds are fine. "LLM needed?" asks whether the
language layer earns its cost, or whether a deterministic answer is the better product.

| # | Use case | Mid-raid value | Between-raids value | Data it needs | Local already? | Real time? | LLM needed? |
|---|---|---|---|---|---|---|---|
| 1 | **Say it, get a trigger.** "Warn me 10 s before the next rampage" becomes a trigger the raider previews and saves | Low (nobody authors mid-pull) | **High** | Spell/mob catalog, the trigger schema, existing triggers, a sample of log lines | Yes, all of it | S | **Yes**: free text in, structured JSON out. The existing compiler checks the result |
| 2 | **"Why did I die?"** The last 30–60 s before your own death: what hit you, from whom, which buff was missing, what the mob does | Medium (between pulls, on the corpse run) | High | Own log window, `death` record, Zeal buffs at the time (a buff history ring is **unverified**; the log's own landing and fade lines are the fallback), `mob-info` specials, spell catalog | Yes | S (answer is read on the run back) | Partly: the **recap** is deterministic; the model explains and phrases it |
| 3 | **Explain a fight.** "Why was that kill slow?" "What happened at 40%?" | Low | **High** | `fight` records, `track_minute`, History ring, the hub's merged record for the difference, fight timeline | Yes (own fights 365 days; all-player ring 7 days) | S to tens of seconds | Partly: numbers are deterministic; narration is the model |
| 4 | **"What should I cast next?"** | **High** | Low | Zeal buffs, target, mana, spellbook, cooldowns, catalogs, the buff / cure queues | Yes | **RT** | **No.** The queues already do this with rules. A 1–4B model on CPU cannot answer in under a second and can be confidently wrong while a pull is live. Keep it deterministic; at most the model explains *why the queue said so*, afterwards |
| 5 | **"Who has the flag?"** | Medium (a PoP boss just died, the flag NPC stands 20 minutes) | Medium | Guild-wide hails and flag state | **Only your own.** The guild-wide answer is hub data (`hail-board`, `pop_flags`) | S | **No** locally. It is a lookup the hub already serves on its pages; the model would only be a front door. Belongs to Lord Mobsincamp (§2, option B) |

Reading the table: **use cases 1–3 are where a language layer pays; 4 and 5 are better served without one.**
That is a finding, not a ranking accident: the first thing Phase 0 should prove is that a deterministic "tool"
layer answers most of 2 and 3 on its own, so the model is judged on what it adds.

One more that fell out of the exercise and is cheap: **catalog Q&A between pulls** ("what does Turgur's Insects do
and who can cast it?"). The Mob Info overlay and the catalogs already answer it by name; it is use case 3's
sibling and needs no extra data. Not ranked separately.

⚠ **The spirit of the platform constrains use case 2 and 3.** `docs/PRIVACY.md`: *"We don't track who caused a wipe,
and we never will."* The model explains **your** death and **your** fight. It must not rank other players, assign
blame, or produce "who messed up". This is a guardrail (§4), and it is part of the eval set (§6): a prompt that
asks "who caused the wipe" must be declined.

## 2. Where the model runs — three options

All three share the same shape underneath: **a fixed set of read-only tools produces structured facts; the model
turns a question into a tool call and facts into a sentence.** That is the Lord Mobsincamp pattern
(`DESIGN-lord-mobsincamp.md` §3: no free-form SQL, tools only), moved to the PC. It matters because 1–4B models
are weak at multi-step tool use (unverified), so the design leans on rules for routing and on the model for
language only.

### A — Pocket model: a small model runs on the raider's own PC

*What makes it different: nothing leaves the machine, so the privacy page does not change. The raider's PC pays.*

- **Shape.** Mimic starts a model runtime as a child process bound to `127.0.0.1` (the way it starts Piper), and the
  agent talks to it through an OpenAI-compatible local endpoint. The weights are downloaded on demand, never in the
  installer (the `ghDownload.js` / `uiPacks.js` / voice-pack precedent; `DESIGN-mimic3-voice.md` "Distribution
  and size").
- **A cheap first step inside A: bring your own endpoint.** Mimic only talks to a localhost endpoint the raider
  configures (LM Studio, Ollama or similar); we ship no runtime and no model. Same code path as the managed version,
  so it can grow into it, and it lets Phase 1 start before the packaging question is settled.
- **Runtime candidates (all unverified):** `llama.cpp`'s `llama-server` prebuilt Windows binaries (MIT; a single
  executable with an OpenAI-compatible HTTP server, the same shape as the Piper download); Ollama (MIT; an
  installer and a background service, a heavier thing to own and to retire); `onnxruntime-genai` (MIT). sherpa-onnx
  is already shipped for Kokoro; whether it serves text models is **unverified**.
- **Model candidates in the 1–4B class (all unverified: sizes, licences and quality are from memory):**
  Qwen2.5-1.5B / 3B-Instruct and Qwen3-1.7B / 4B (licence differs between sizes, check each); Llama-3.2-1B / 3B-Instruct
  (Llama community licence, redistribution terms apply); Phi-3.5-mini-instruct, 3.8B (MIT); Gemma 2 2B / Gemma 3 1B / 4B
  (Gemma terms of use); SmolLM2-1.7B-Instruct (Apache-2.0). At 4-bit quantisation these are roughly 0.8 to 2.5 GB on
  disk and about 1.5 to 3.5 GB of RAM or VRAM once loaded with a few thousand tokens of context (unverified).
- **Honest hardware picture.** This is the machine that is also running EverQuest, Zeal, Mimic's Electron overlay
  windows (transparent, always-on-top, GPU-composited), possibly Kokoro, and, for a multiboxer, more than one client
  (how many raiders multibox is **unverified**). The pressure points:
  - **CPU.** Prompt processing and generation on CPU can use every core in a burst. Rough shape (unverified,
    measure it): a 1.5k-token prompt plus an 80-token answer on a 3B model is **about 10 to 20 s on a mid-range
    CPU and 2 to 5 s with GPU offload**. That alone rules out anything mid-pull.
  - **GPU / VRAM.** Offloading to the GPU takes VRAM and shader time from the game and from the overlay
    compositing. A 3B 4-bit model plus context is about 2 to 3 GB (unverified). Mimic already has a "GPU off at
    start" escape for machines where acceleration misbehaves (`_gpuOffAtStart`), a sign that some raiders' graphics
    stacks are fragile.
  - **RAM.** Loaded weights stay resident unless the runtime is stopped between uses. Mimic reads cores, RAM and free
    disk today (`/api/pc-specs`, built for the Voice card's "will it keep up on this PC" readout); **it does not
    read GPU or VRAM**, so that probe is new work.
  - **Mitigations that follow existing precedent:** run only when no fight is live (the update gate and the
    local backfill both already wait on a live fight); lowest process priority and a thread cap; unload after N
    idle minutes; a measured "will it keep up" readout that refuses the download on a machine that cannot.
    Whether process priority and a thread cap actually protect EQ's frame time is **unverified**; Phase 0
    measures it with EQ running.
  - The **Steam Deck / Linux** channel is a smaller, shared-memory machine; treat it as out of scope for the first
    cut (unverified).
- **Privacy against `docs/PRIVACY.md`.** Nothing is sent, so "What leaves your PC" is unchanged. Two things still
  change the page: (1) a **new download host** if weights come from anywhere other than GitHub ("Who Mimic talks to"
  lists the guild server, GitHub, time servers and OpenDKP's sign-in service; a model host is a fifth entry, and
  `DESIGN-agent-third-party-calls.md` applies); (2) a new **"What Mimic keeps on your PC"** paragraph if the model's
  conversations are stored. Recommended: they are not stored by default. As everywhere else in that file, the text
  lands **with the code that keeps the promise**, not before.
- **Cost, four numbers.** Build **high** (about 25 to 35 days across runtime packaging, download and hash
  verification, hardware readout, tool layer, UI, eval harness). Maintenance **medium to high** (runtime and model
  updates, driver and AV quirks on a fleet of unknown PCs, a support load that lands on the guild lead).
  Runtime: **zero on the hub, real on the raider's PC** (disk 1 to 3 GB, RAM and CPU bursts). Change: **easy to swap
  the model** if the agent only knows "an OpenAI-compatible local endpoint"; **hard to retract** a runtime once it
  sits on a fleet.

### B — The hub answers: the bot calls a hosted model

*What makes it different: nothing heavy on the PC, but the model can only see what the hub already holds.*

- **Shape.** Mimic asks the bot (Railway); the bot runs the tool layer over the hub's data and calls a hosted model
  for the language. This is Lord Mobsincamp's **phase 0** (`DESIGN-lord-mobsincamp.md` §8: hosted API via the bot,
  cents a question), extended with a Mimic client. It should be **one tool service, not two**.
- **What it can answer.** Everything the hub stores: fights, deaths, buffs landed (7 days), threat (30 days),
  loot, attendance, hails and PoP flags. Strongest for use case 5 and for guild-wide use case 3.
- **What it cannot.** Anything the privacy filter keeps on the PC: tells, group and officer chat, the Chat
  overlay's lines, your local recording, a local `death` record that never uploaded, per-hit detail past 7 days.
  Sending those to answer a question would break the "never leaves your PC" rule, so B **cannot** answer "why did I
  die?" at hit level from your own log. That is a structural limit, not a tuning problem.
- **Privacy against `docs/PRIVACY.md`.** Adds a processor: the hosted model provider sees the question and the
  tool output. That is a new row in "Who else handles it" and a new line under "What leaves your PC". It also puts
  member-visible stat scopes (PRIVATE / ANON / GUILD) and `exclude_from_stats` in the tool layer's hands, which
  `DESIGN-lord-mobsincamp.md` §2b already requires. **Prompt injection** applies: fight data contains
  player-chosen strings (pet names, `/random` text, NPC speech). Tool results are data, never instructions.
- **Cost, four numbers.** Build **low to medium** if Lord Mobsincamp's tool service is built first, **medium** if not
  (about 10 to 15 days of Mimic client, endpoint, budgets, UI). Maintenance **low** (one server, one place to fix).
  Runtime **cents a question on the guild's bill**, a bot budget kind (the admission-control budgets, #73 in
  `CLAUDE.md`), and one more reason the single-replica rule matters. Change **easy** (swap the model in one place).

### C — Hybrid: local facts, cloud phrasing

*What makes it different: the facts are gathered on the PC, only a tiny typed fact sheet goes out, and the raider sees it first.*

- **Shape.** The PC runs retrieval and the tool layer (as in A, with no model runtime), builds a **fact sheet**
  from an allowlisted serializer (spell names, mob names from the catalog, numbers, timestamps; never free text from
  the log, never a character name), shows it to the raider ("this is what will be sent"), and only then asks a
  cloud model to phrase the answer. The same rule `docs/PRIVACY.md` already uses for feedback: *"read the preview
  before you send."*
- **Privacy against `docs/PRIVACY.md`.** "Enforced by what is sent": the serializer's output schema is the whole
  contract and a test proves it cannot carry log text. It still sends something to a third party (a processor row,
  an opt-in, never on by default) and the fact sheet about *your death* is personal even without names. If the
  cloud key is the guild's and runs through the hub, the hub sees the question and the guild lead owns the bill;
  if it is the raider's own key, the guild sees nothing and the raider pays.
- **Cost, four numbers.** Build **medium** (about 15 to 20 days: tool layer, serializer, preview UI, a provider
  path). Maintenance **medium** (two paths to keep honest: the schema and the provider). Runtime **small on the PC,
  cents a question in the cloud**. Change **medium**: the schema is a public contract the privacy page leans on.

### Recommendation on where it runs

**A, staged: bring-your-own-endpoint first, a managed download later.** It is the only option whose privacy story
is "nothing leaves", which matches the direction already decided (`DECISIONS-2026-09-21.md` §401–§403 "personal
data lives on each player's PC", §423 "history lives on the PC"). It has no per-question bill. And because the
design splits facts from language, even a modest model has little to get wrong.

**C is the fallback** if Phase 0 shows small local models cannot write a valid trigger or a clear recap often
enough, or the contention numbers are bad on typical PCs. **B should not be built for this ask**: it duplicates
Lord Mobsincamp and cannot see the personal data that makes use cases 1 to 3 valuable. If the guild lead wants
use case 5, that is one more tool in Lord Mobsincamp, not a Mimic feature.

## 3. How the model would "know the game"

Three ways, usually combined. The recommendation is to start with the first and prove it fails before paying for
the second.

### 3a. Retrieval over local stores and catalogs (recommended base)

The game is **entity-heavy and exact**: spell names, mob names, zone short names, item ids. Exact and keyword
lookup beats embeddings here, and the agent is zero-dependency, so a vector index (and its embedding model) is a
cost with no clear return. Retrieval sources, each already in the repo:

| Source | In the repo | Use |
|---|---|---|
| Spells, items, clickies | `eqemu_spells` / `eqemu_items` mirrors; `spell-catalog`, `item-clickies`, `item-catalog` payloads; `docs/eqemu-catalog-cheatsheet.md` for the conventions (NPC id encodes zone, era codes) | Exact lookup by name or id, with landing messages for matching log lines |
| Mobs and zones | `eqemu_npc_types`, `spawn*`, `data/bosses.json`, `data/named-bosses.json`, `data/zones.json`, the cached `mob-info` rows (special abilities, resists, level-windowed spell list) | "What does this mob do", ability 31 (Immune Pacify), rampage / enrage |
| Weekly data pack | `data-latest` release (`scripts/build-data-pack.js`): spell catalog, item clickies, item catalog, per-zone packs, quests; 60 MB budget | The delivery channel for any new retrieval content; the local model does not need a second one |
| Trigger library | `guild_triggers`, the portable trigger shape (`text_overlay` + `tts`, `timer_duration_sec`, `warning_seconds`), `web/lib/triggerPattern.ts` | Few-shot examples for use case 1; the normalizer and compiler as the validator |
| Domain policy | The "Domain policies" block of `CLAUDE.md` (Harmony is not Pacify, engage locks, character identity scopes), `docs/DESIGN-death-semantics.md`, `DESIGN-mechanic-capture.md` | A **curated card set**, a few hundred short entries. Not the raw DECISIONS corpus (§3d) |
| The raider's own history | `_localStore`, History ring, `death` / `fight` / `loot` kinds | Use cases 2 and 3 |

Cards in the data pack are kilobytes, version with the game data, and update weekly without a Mimic release.

### 3b. Fine-tuning on EQ / Quarm data (not yet)

- **What it buys:** the model speaks EQ fluently without being handed context, and, more usefully, **emits valid
  trigger JSON without a long prompt**. That second benefit is the real one, because it is where 1–4B models stumble.
- **What it costs.** Training data has to be made: synthetic Q&A from the catalogs, request-to-trigger pairs from the
  guild's existing triggers, log-excerpt-to-recap pairs from the synthetic golden logs. A small LoRA-style tune on
  one consumer GPU is feasible (unverified). Then every **Quarm patch** that changes a spell or item makes the model
  stale, so facts must still come from retrieval; the tune only teaches *style and format*. We would own a trained
  artifact, its licence obligations (§3d), and a re-train cadence.
- **Cheaper than a fine-tune for format:** constrained decoding. `llama.cpp` supports grammar-constrained output
  (GBNF; unverified in detail) which can force output to be valid trigger JSON. Try that first.
- **Recommendation:** no fine-tune until Phase 0 shows retrieval plus constrained decoding is not enough.

### 3c. Prompt-only with the catalog in context (rejected as a base)

The spell catalog alone is about 3.9k entries and the item catalog is larger; small models carry a few thousand to a
few tens of thousands of tokens of context (unverified) and slow down sharply as the prompt grows. Prompt-only works
for a **slice** (the spells that landed in this fight, the mob's ability list), which is exactly what retrieval hands
it. So "prompt-only" is not an alternative; it is how retrieval is delivered.

### 3d. Licensing and privacy caveats on the data

- **The `eqemu_*` mirrors** come from the EQMacEmu project's published dumps (`scripts/sync-from-eqmac.js`). The
  server code is open source; the status of the data content, and of the game's own text and names, is
  **unverified**. Using it as retrieval content in a PC-local tool is the same use the catalogs already have. Training a
  model whose weights we redistribute is a larger step: get a view before doing it.
- **Scraped and third-party layers.** The spell level seed came from a scrape of a public EQ database;
  `DESIGN-selfhost-wizard.md` records that one map layer "carries no stated licence" and is served only behind the
  sign-in and never committed. **Anything without a stated licence stays out of a training set and out of the data
  pack.**
- **The DECISIONS corpus** is public and rich in guild policy, but it quotes members and contains fixtures with real
  names (`CLAUDE.md`, attribution rule). **Do not feed it raw to anything.** The curated card set (§3a) is written
  in roles, in the same style as the docs.
- **Never in any corpus:** the `feedback` table (member-submitted), `anon_feedback` (strangers; untrusted text),
  tells, chat history, `who_observations`, OpenDKP bids, anything from `character_*` or `wolfpack_members`.
- **Evaluation data is synthetic.** The golden logs (`test/fixtures/golden/`) are hand-written with invented names
  by rule. A raider's real log is **never committed** and never leaves their PC; Phase 0 measures on the guild lead's own
  machine and records only numbers.
- **Model licences.** The agent is AGPL-3.0-or-later (`docs/LICENSING.md`); a model's weights carry their own terms
  (Llama and Gemma ship custom terms; Qwen sizes differ; MIT and Apache-2.0 are the simplest, all unverified). If we
  host the weights ourselves (a GitHub release asset, as the data pack does) we redistribute them and must follow
  their terms. If we link to the model's official host, we add a "Who Mimic talks to" entry instead. Either way it is
  a decision (D7 in §5).

## 4. Guardrails

Each is a structure plus a test, not a sentence in a prompt. `docs/PRIVACY.md`'s own rule applies: *describe what the
software does today, not what we intend.*

### 4a. It never sends input to the client

*"No automations come back into the client."* The Zeal pipe is output-only today (`PIPE_ACCESS_OUTBOUND`,
§59e). Quarm's posted rules ban automation software (§224 records the wording and the "if you have to ask, don't"
line). So:

- **The model's output type is text, spoken text, or a draft object the raider must accept.** It has no output that
  is a key, a click, a command, a `/` line, a macro, a target change or a raid action.
- **No code path from the model to the client.** The model runtime runs as its own child process with no handle to the
  pipe, no window handle for EQ, no `SendInput` or equivalent, and no IPC channel except "text in, text out" to the
  agent. The module that talks to it imports nothing from `zealPipe.js` beyond read-side helpers.
- **A structural test fails the build** if the model module (or anything under it) references a pipe-write function, an
  input-injection call, or the draft Zeal inbound verbs (`DECISIONS-2026-09-21.md` §59e option 2, §225
  `/autoraidlead` draft). Stripped-comment text assertions follow the repo rule (`stripJs`); a behaviour test is better
  (the module's exports contain no function that accepts a client command).
- **It advises; it does not decide.** "Cast X now" style output is a banner of text with its evidence, never a
  button wired to anything. Use case 4 stays rule-based for exactly this reason.

### 4b. What it may never read (from `docs/PRIVACY.md`)

Default read set is **the same filter the live reader and *Rebuild from my logs* already apply** (`shouldKeep`,
`triggerVisibleLine`), so there is exactly one chokepoint to audit, not a second reader to get wrong:

- Never: tells (in either direction), group chat, officer chat, custom channels (including the guild tag channel),
  `/say`, OOC, shouts, auctions. A raid-say line is used only to know who spoke, never its words.
- Never: any character set to `exclude_from_stats` (not recorded, not read). The Chat overlay's 24-hour encrypted
  file is **not** part of the default read set.
- Never: the unfiltered raw log file. The model's tools read through the filtered reader.
- Never: another raider's data that arrives from the hub for display (rosters, buffs) beyond what the raider can already
  see on their own screen.
- The one exception that already exists, NPC speech that triggers can hear (`npcSpeechLine`, agent 3.7.54), is available
  to the trigger-writing use case only as a *sample line* the raider chooses to include.

### 4c. What it may never upload

- **Option A uploads nothing.** No question, no answer, no prompt, no telemetry. The "feedback" path may carry a 👍/👎
  and, only if the raider ticks it, the question and the answer, through the existing feedback preview.
- **Conversations are not saved by default.** If they ever are, they join "What Mimic keeps on your PC" with a
  retention, like the 90-day recording.
- **Option C sends only the previewed fact sheet**, nothing else, and a test pins the serializer's schema.
- **Raid codes hold back uploads** (`RAID_HOLD_KINDS`). Any future model upload kind joins that hold list.

### 4d. Kill switches (three, because one is not enough)

1. **On this PC:** off by default; tray item **and** a dashboard Overlays/Settings control that drive the same
   internals (the tray-to-dashboard parity rule); an env switch like `WP_LOCAL_TRACK=0`.
2. **Fleet:** a tuning key riding the same poll as `flag_agent_kill` and `min_agent_ver_num`, honoured fail-open (no
   key, no effect; bot down, agents run normally). An officer sets it in `/admin/overlays`. **Honest limit:** a
   local-only install (no token) never hears from the bot, so for them the local switch is the only switch.
3. **Raid-time:** inference does not start while a fight is live (the same gate the updater and the backfill respect),
   and a live fight pre-empts a running generation. An officer-forced "no model tonight" is the fleet key.

### 4e. How answers are labelled

- **Evidence first, prose second.** Each answer starts with the lines or rows it used (the six log lines before the
  death, the catalog row for the spell), then the sentence. A raider can check in one glance.
- A visible badge: **"AI-written from your log and the game data. May be wrong."** plus the model name and version, and
  which retrieval sources contributed.
- **Facts from the catalog vs guesses are marked differently.** A claim about game mechanics with no catalog or card
  behind it is shown as *"unsourced guess"* or not shown.
- A trigger the model drafts is a **draft**, never saved without a click, always previewed (the ▶ Preview that already
  exists), and always run through the existing compiler, `web/lib/triggerPattern.ts`-style normalization, and a replay
  against the raider's chosen sample lines. Dead-pattern classes the repo already lists (a bare leading `^`, an invented
  pattern, `{s}` eating a leading space) are checked mechanically before the draft is shown. A pattern written by a model
  and run against every log line is also a **stall risk** (catastrophic regex backtracking); whether the compiler bounds
  that today is **unverified** and must be settled before use case 1 ships.
- Untrusted input: log text, NPC speech and pet names go to the model **as quoted data**, never as instructions; the
  model's output never executes anything.
- No blame output: refuse "who caused the wipe" and "who is the worst DPS" (§1b).

## 5. Decision points for the guild lead

Each pick below follows the repo's ask format: letter, short name, what makes it different, a sample, a tag, and a
recommendation. Samples here are text mockups; **rendered pictures go with the ask itself** when the pick is put to
the guild lead.

**1. Which use case first.**
- **A: Trigger writer.** *You type a sentence, get a trigger to preview and save; the compiler and a log replay decide
  pass or fail.* Sample: `"warn me 10 s before the next rampage"` becomes a card showing the draft trigger, the
  lines it fired on in your sample, and **[▶ Preview] [Save] [Discard]**. *(Cheapest to test, can become B and C's
  plumbing.)*
- **B: Death recap.** *After you die, a card says what hit you and what was missing, with the evidence lines.*
  Sample: `Died 21:14:07. Last 30 s: 3 hits from <mob>, 2 spells resisted. Not up: <buff>. Mob does: Area Rampage.
  [show the lines]`. *(Higher raider value, but a deterministic recap ships without a model, so it tests the model
  least.)*
- **C: Fight explainer.** *Ask a question about a fight on "My parses".* Sample: `Why was that kill slow? Boss HP
  curve with a stall at 40%, tank down 22 s, two adds up at once.` *(Needs the most data and is the easiest to get
  subtly wrong.)*
- **Recommendation: A, then B.** It is the only use case with an automatic test oracle (§6), it is entirely
  between-raids, it has no safety-of-play consequence, and the draft cannot do anything until a person saves it.
  B follows because its deterministic half is useful even if the model never ships.

**2. Where it runs.**
- **A: Pocket model.** *Local on the raider's PC; nothing leaves.* Costs: build high, maintenance medium to high,
  runtime on the raider's PC, change easy (swap model) but hard to retract. *(Recommended long-term; can start as
  bring-your-own-endpoint.)*
- **B: Hub answers.** *The bot calls a hosted model; sees only hub data.* Costs: build low to medium (shares Lord
  Mobsincamp's tool service), maintenance low, runtime cents a question, change easy. *(Cheaper; cannot see your
  own log.)*
- **C: Hybrid.** *Local facts, a previewed fact sheet goes to a cloud model for phrasing.* Costs: build medium,
  maintenance medium, runtime small plus cents, change medium. *(Fallback if small local models are not good enough.)*
- **Recommendation: A, staged as bring-your-own-endpoint first, a managed download later; C is the fallback; do not
  build B for this ask** (it belongs to Lord Mobsincamp).

**3. How a raider opts in.**
- **A: One switch.** *All-or-nothing.* Sample: `[ ] Local assistant`. *(Simplest, coarse.)*
- **B: Per feature, default off.** *Install once, switch each use on separately.* Sample: `Assistant: installed ·
  [x] Trigger writer · [ ] Death recap · [ ] Fight explainer`. *(Recommended: matches "the sensitive things are off
  until you turn them on", and lets a raider keep the cheap ones.)*
- **C: Default on for local-only features.** *Like the on-PC recorder.* *(Rejected: a 1 to 3 GB download and CPU/RAM
  use is not the same kind of default as a 90-day recording.)*
- **Recommendation: B, plus the fleet kill switch in §4d, which is not optional.**

**4. Which data it may see.**
- **A: Narrow.** *Game data, your own filtered log, your own local store. No chat of any kind.* *(Recommended; the
  same chokepoint as everything else.)*
- **B: Plus chat on request.** *A per-question tick adds recent guild / raid chat from the Chat overlay's local
  lines.* Sample: `[ ] include recent guild chat in this question`. *(Later, once A is trusted.)*
- **C: Everything the Chat overlay holds, tells included.** *(Refused: tells involve a person who has not agreed
  (`docs/PRIVACY.md`, Tells), and the model would then hold the most sensitive text on the PC.)*
- **Recommendation: A now; B only as a separate decision after a raid cycle of A.** C is not offered.

**5. Can answers be spoken.**
- **A: Text only.** *A card, nothing audible.* *(Recommended first; zero risk to callouts.)*
- **B: Speak on press.** *A ▶ button speaks the answer with Piper or Kokoro, only when no callout is playing and no
  fight is live.* Sample: `Answer card ... [▶ Read aloud]`. *(Recommended second; reuses the voice engines and
  `DESIGN-mimic3-voice.md`'s rule that a callout must never be silenced by anything else.)*
- **C: Auto-speak.** *Every answer is spoken.* *(Rejected: competes with callouts mid-raid.)*
- **Recommendation: A at launch, B in a later phase, C never.** The speech queue is lowest priority and every
  trigger callout pre-empts it.

**6. How it is tested before raid night.**
- **A: Offline golden set.** *A frozen list of questions and synthetic logs, scored automatically.* *(Necessary,
  not sufficient.)*
- **B: A plus a shadow cycle.** *The model runs in the background on beta testers' PCs for one raid cycle, answers
  logged locally and never shown, measuring CPU, RAM and EQ frame time.* *(Catches the contention failure that
  no offline test can.)*
- **C: A plus B plus a visible beta.** *Opt-in beta testers see answers with a 👍/👎 that files a feedback report.*
  *(The full path; slowest.)*
- **Recommendation: all three, in that order, each a gate to the next** (§6). Never on `main` and never on a raid
  night first: it ships on the beta Mimic channel only, which is pull-based.

**7. How the model weights are delivered.**
- **A: Raider supplies it.** *Bring-your-own endpoint; we ship no runtime and no model.* Costs: build low,
  maintenance low, runtime the raider's, change easy. *(Fastest; the Phase 1 form.)*
- **B: Downloaded on demand from a host we name.** *Like the voices: fetched outside the installer, and checked against a published hash (the hash check is new work; whether the voice downloads verify one was not checked here).* Costs:
  build medium, maintenance medium, runtime the raider's disk, change medium. Needs the licence decision
  (redistribute vs link to the official host) and a PRIVACY.md "Who Mimic talks to" entry. *(Recommended once Phase 1
  proves the idea.)*
- **C: Bundled in the installer.** *(Rejected: every update re-downloads gigabytes.)*
- **Recommendation: A in Phase 1, B in Phase 2.**

## 6. Rough phase plan

Day figures are **rough, build-days of one session or person, unverified**; the Windows measurements in Phase 0 need
the guild lead's PC (a cloud session cannot see `A:\EQ` or run EverQuest) and go on `docs/STATUS.md` as a "needs a
local session" item when this starts.

| Phase | What | Days | Touches users? | Gate to continue |
|---|---|---|---|---|
| **0 — dry experiment** | An offline harness, **kept out of every shipped component** (a scratch folder, not `experiments/` shipped code, not a dependency). Build the eval set from public, synthetic material: ~40 trigger requests whose ground truth is an existing guild trigger written back into English, ~20 death cases from the synthetic golden logs, ~15 catalog questions, ~10 "must refuse" prompts (blame, tells, input). Run 3 to 4 candidate models (§2 A) through `llama-server` on the guild lead's gaming PC **with EverQuest running** and on one mid-range PC. Record tokens a second, time to first token, RAM / VRAM, EQ frame time with and without inference, and pass rate. Baseline every question against the tools-only answer with no model | **3 to 5** | **No.** Only the guild lead's own machine; no code ships; numbers recorded, no logs committed | Proposed bars (to be argued): trigger drafts compile and replay-fire on the right lines at or above 80%; refusals 100%; under 5% EQ frame-time loss during inference and none outside it; under 20 s on CPU or 5 s on GPU. If the bars fail, switch the plan to C or stop |
| **1 — Trigger writer on bring-your-own endpoint** | Dashboard card (beta Mimic only, default off), local OpenAI-compatible endpoint setting, tool layer (catalog lookup, trigger compile, replay against sample lines), constrained output, the §4a structural test, fleet kill key, tray and dashboard parity | 7 to 10 | Beta testers who opt in and bring their own endpoint | A raid cycle of shadow use with no reported frame-rate regressions |
| **2 — Managed runtime** | Download checked against a published hash (the voice-download precedent for fetching, new work for the check), GPU/VRAM readout added beside `/api/pc-specs`, idle unload, pause during fights, PRIVACY.md and the website privacy page updated in the same change | 8 to 12 | Beta testers | Hardware readout refuses unsuitable PCs correctly on at least three machine types |
| **3 — Death recap** | Deterministic recap first, model phrasing second, evidence-first card, no-blame refusals in the eval set | 6 to 8 | Beta | Feedback 👍 rate and zero blame outputs in the logged sample |
| **4 — Fight explainer** | Over `fight`, `track_minute`, History ring and the hub difference | 6 to 10 | Beta | Same |
| **5 — Optional** | Speak on press (§5, pick 5B); the hybrid path C if A's quality failed | 3 to 5 (speech), 12 to 18 (hybrid) | Beta | Guild lead's call |

Total if everything ships: about **35 to 50 days**; the first thing a raider can use (Phase 0 plus Phase 1) is about
**10 to 15 days** out. Stable Mimic graduation is a separate decision and not before a full raid cycle on beta.
Release names are the guild lead's call and none is proposed here.

## 7. Open questions this document cannot answer

- How many raiders run on a PC that could carry a 3B model next to EverQuest? Measured fleet hardware is not in the repo;
  the Voice card's `/api/pc-specs` readout could be summarised anonymously, counting players and not characters, if the
  guild lead wants the number before choosing.
- Whether Quarm's staff are comfortable with an assistant that reads the log and advises (the rule text bans
  automation software and says to ask if unsure; `DECISIONS-2026-09-21.md` §224, §225). A display-only assistant is the
  same class of thing as the Buff queue and Mob Info, but a written word from the server team is the safe way to know.
- The licence position on redistributing game-derived data inside model weights (§3d).
- Whether any 1 to 4B model in Phase 0 writes valid trigger JSON well enough with constrained decoding. Everything in
  §2 and §3 that depends on that is a bet until Phase 0 reports.
