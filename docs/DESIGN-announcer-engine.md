<!-- Written 2026-10-06 with docs/DESIGN-raid-announcers.md (the cast bible). Decisions: DECISIONS §169.
Machine-specific placement for the guild lead's own home is in the private briefing. -->

# Announcer Engine: miMIC, Bristlebane and Lord Mobsincamp

*Design, 2026-10-06. Replaces the earlier engine draft in full (its tier table, earcons, caps, routing rows and example lines are superseded). Public-repo version: no member names, no home details. Where things run is written as roles; which machine plays which role is kept privately.*

## TLDR

- **Moments in, lines out.** Detectors raise a **Moment**; a **Director** picks persona, line and time; a **Renderer** voices or posts it. miMIC renders on each raider's PC and never waits on the network; the two gods share one Discord voice connection and speak only in windows the engine can prove are quiet.
- **Personas are Character Card V2 files** plus one shared lorebook; the engine's pack lives inside the card, so the cards stay the one source for the ear, the bots, the rehearsal room and the clips.
- **This week:** stop double-speaking, prove Discord playback, latch first kills, re-voice today's callouts with clips, and post god lines as text. Raid night never depends on a GPU box.

---

## 0. Where it runs

| Role | Runs | Never |
|---|---|---|
| **Each raider's PC** | the agent (detectors), Mimic's local director, the tactical clip pack, the browser-voice fallback | depends on anything remote for a tactical call |
| **Bot host** | moment producers, `RaidPhase`, the `announcer-feed` long-poll (memory only, no database read on the raid path), webhook posts, the night ledger in `bot_kv` | audio |
| **The always-on box** (wired, never gamed on) | the raid voice bot and raid director, the render queue, a live voice tier, speech-to-text, the local model, the rehearsal room, the clip share, guild-facing chat agents | games; anything a raid cannot survive losing |
| **Gaming PCs (helpers)** | picture jobs and expressive voice renders, leased only when free | always-on duties; any job while the game runs |

**Rules**
1. **One moment, one speaker.** Before any clip ships, every voice path on a PC joins one queue and every moment has one owner (§3.3).
2. **Renderer swap, never a fork.** The persona layer sits behind `_pushOverlay` and `speak()`; Quiet mode, the #136 allow-list, dedup and staleness stay put.
3. **Tactical words are a raid contract.** Today's words, timing and audience hold until the guild lead changes them; packs cannot.
4. **Silence is fine for flavour, never for tactics:** clip → browser voice → flash.
5. **Raid night needs no GPU box:** every voiced line is pre-rendered; if the always-on box is down, the gods post text and miMIC is unaffected.

---

## 1. The persona pack: Character Card V2

Each persona is one `chara_card_v2` JSON (or PNG with the card embedded), authored and rehearsed in a SillyTavern group chat. The engine's data rides in a namespaced extension that SillyTavern round-trips untouched.

| Card field | Holds |
|---|---|
| `name` | display name (`ASSISTANT_NAME` maps here) |
| `description`, `personality`, `scenario` | identity, lane, the camp and the other two |
| `system_prompt` | the offline writers'-room prompt (bible §8) |
| `post_history_instructions` | the never-list, condensed |
| `mes_example` | approved lines as style examples |
| `first_mes`, `alternate_greetings` | the open line and variants |
| `character_version` | the pack version |
| `character_book` | the lorebook entries this persona needs, for when a card travels alone |
| `extensions.wolfpack_announcer` | the engine pack |

```jsonc
"wolfpack_announcer": {
  "format": "persona-pack/2", "role": "tactical | fun | ceremony",
  "voice": { "render": {"engine": "name@version", "reference": "path#sha256"}, "live": {"engine": "kokoro@1.0"},
             "dsp": [], "browser": {"rate": 1.0, "localOnly": true},
             "consent": {"source": "designed | member", "consentRef": "voice_consents:<id> | null"} },
  "sounds": {"lead": "clip", "close": "clip"}, "reserved": ["..."], "owns": ["moment.id"],
  "lines": { "<moment.id>": { "window": "kill | lull | break | open | close", "ttlSec": 60,
    "variants": [ { "id": "stable", "segments": ["{boss}", " takes a bow."], "spoken_text": "...",
                    "rarity": "common | legendary", "heat": "kind | any", "when": {}, "takes": ["sha256:..."] } ] } } }
```

- **Import:** a card without the extension is a writers'-room character; it can be rehearsed, never speak. **Export:** cards go back out with the extension intact; a round-trip test keeps them identical.
- **The shared lorebook** (one SillyTavern World Info file) is the **Book of the Pack**: stories, sayings members submitted, nicknames people chose. An entry that names a member needs that member's yes, and they can remove it whoever wrote it.
- **Tiers, audiences, caps and windows are not in cards.** They live in `moments.v1.json`, the one catalog the bible and the code both cite. Slot types: `raider:tactical` (always spoken, stays local), `raider:praise`, `raider:any` (a deathroll loser is this), and `boss`/`zone`/`item`/`count` clips, all through `spoken_as`.
- **The linter fails the build on:** an unknown moment or slot; a tier above the catalog; word caps; the cross-cast reserved words and the Thank-You Embargo; backticks or numerals in rendered text; a boss or zone without `spoken_as`; a missing "two or fewer" count rule; a placeholder for an opted-out name; a lore-gated line without its citation; a lorebook entry naming someone without their yes; a guild trigger set to CRITICAL by its category (category tiers cap at ALERT; "loot" is split out of "mechanic" first).
- **Guild-facing chat agents** (for example an OpenClaw agent on a local model) may wear a card as their own Discord application: never in voice; their **own empty workspace** with a `SOUL.md` generated from the card, never a personal assistant's workspace; the lorebook as their only memory; the same linter and consent rules in guild channels; a local model unless `/privacy` names a hosted one.

---

## 2. Routing

| Surface | Latency | For |
|---|---|---|
| **Mimic in-ear** | ≤300 ms | tactical calls and personal moments; works offline |
| **Discord voice** (the voice bot's one player) | 1–3 s + window wait | shared moments heard together |
| **Discord text** (one webhook per persona; an officer creates the URLs, stored as environment variables) | seconds | durable, skimmable; reaches people not in voice |
| **`/screen` captions** | 3 s | every voiced god line |
| **Website** | — | Ask, `/ledger`, `/announcers`, Say my name, consent |

The ear is miMIC's alone; Mimic never repeats a moment Discord voice owns; both gods use the voice bot's one connection and one budget. Moment ownership is the bible's Part I §3.

---

## 3. Noise budget

### 3.1 The ear

| Tier | Contents | Rule |
|---|---|---|
| **CHAIN** (3) | the CH slot call, slot holder only | cuts off anything; nothing cuts it |
| **CRITICAL** (2) | own charm break; officer-flagged move-now; "on you" variants | preempts ALERT and below |
| **ALERT** (1) | rampage, enrage, slows, mez, DI, chain gaps, key-role deaths, death-touch countdown | if cut off, re-queued once inside its TTL |
| **INFO** (0) | loot, timers, Board, rez, kills | only when the agent's own fight is not live |
| **FLAVOUR** | garnish | one-slot aside: queue empty, nothing speaking, no fight, `caller_speaking_until` and `discord_voice_busy_until` passed |

- **Phase 0 keeps today's two levels** (CH GO above all); the split is a contract item for the guild lead. A slice test proves CH GO cuts off a CRITICAL already playing.
- **Audience by role** comes from the catalog: slot holder, healers, clerics, slowers, non-tank melee and pets, leader and officers, the subject.
- **Collapse rule:** three key-role deaths in 10 s, or a quarter of the raid down, stops death and gap calls for that fight; one red chip.
- **Load budget:** past 25 words a minute for a listener, INFO drops first, then ALERTs not addressed to them.
- **Boss gating** reads a reviewed **raid-target list per zone**, separate from the timer board (several god bosses are not on it).

### 3.2 The allow-list stays the gate

#136 still decides whether a fire speaks. A persona only re-voices what passes. `_calloutAllowedToSpeak` returns the matched category so its tier (capped at ALERT) can be looked up.

### 3.3 One moment, one speaker (step zero)

- The chain and charm overlays' own `speechSynthesis` calls move onto the trigger window's queue in the same release as the first clips (the chain overlay's `cancel()` would cut the others).
- Where a built-in call owns a moment (DI, enrage), the matching guild-trigger speech is muted. Test: one DI landing, one spoken line.
- The old bot's Discord trigger voice is off on nights the voice bot speaks, or folded into `discord_voice_busy_until`.

### 3.4 Dials

| Who | Setting | Values |
|---|---|---|
| Each raider (tray and dashboard parity) | **Quiet mode** (unchanged) | no speech; text still flashes |
| Each raider | **miMIC personality** | **Off** (default for two weeks) · Light · Full |
| An officer, per raid | **Cast setting** | **Text** · **Standard** · **Festive** |
| Automatic | caller gate | no raid leader opted in to caller detection tonight → Text |
| Ripcords | tuning keys | `flag_announcer_quiet=1`; a cap on everyone's personality dial (Off on progression nights); `/bristlebane hush 10m` |

Discord's per-user volume mutes both gods at once, so each god's text echo carries a "too much" reaction and `/me` has a per-persona vote; the rates are reviewed after two nights before any cap rises.

### 3.5 RaidPhase (fail closed)

A pure, dependency-free `utils/raidPhase.js` that the bot or the voice bot can host, tested like `decide()`.

| Phase | Entered when | Gods may |
|---|---|---|
| OFF | no Start raid and outside the raid window | nothing |
| FORMING | an officer's Start raid, or raid-live **inside** the raid window | open lines |
| ENGAGED | **any one** placed raider's agent reports a live fight (a fight-live bit on the 1.5 s poll it already makes), the puller's pull included | nothing |
| KILL_WINDOW | a raid-target kill, opening at the leader's first pause (cap 20 s), 45 s or until ENGAGED | 1 line (2 for a first kill) |
| LULL | ENGAGED released by a kill, a wipe, or 45–60 s of positive out-of-combat reports from enough fresh agents | low-priority lines |
| BREAK | 5 minutes quiet, or an officer's "med break" | honors, bits |
| CLOSING | an officer's End raid, delivered on the feed within seconds | the Close; the voice bot stays until `close_done` or 4 minutes |

- **Unknown is ENGAGED:** a shed stream, a poll gap or too few fresh agents. Test: "streams shed, boss alive, no triggers for 45 s" → ENGAGED.
- Raid-live samples feed the tracker before the shed check, so shedding the database write cannot blind it.
- **Wipe signal** †: a raid-target engagement that ended unconfirmed **and** a set share of placed raiders dead within 60 s. Until it ships, wipe-dependent lines are off.
- The agent flushes a boss kill immediately instead of on the 5 s relay tick; a confirmed-kill encounter is a second source.

### 3.6 The caller gate

- `/bristlebane caller optin` lets the leader, puller or chain caller hold the floor. The voice bot acts on speaking events from those members only; it never subscribes to audio, stores nothing, ignores everyone else.
- Speech detection has its own `ANNOUNCER` flag, separate from recording, and its own visible marker when undeafened without recording. No receive → text only.
- A god line needs 3 s of caller silence; a caller starting to talk stops it within a packet and drops it. The feed publishes `caller_speaking_until` for miMIC's flavour.

### 3.7 Caps (the director's, generated from the catalog)

| | Per window | Min gap | Per hour | Per night |
|---|---|---|---|---|
| Bristlebane | 1 | 4 min | 8 | Standard 20 (15 on progression nights), Festive 30 |
| Lord | 1 (first kill exempt) | 5 min | 6 + open, close | 20; "Wolf Pack." 3 |
| Both, in voice | 1 (2 for a first kill) | 20 s | 12 | — |

No god voice from "loot posted" to the officer's close; one roll line after. Lines ≤6 s mid-raid; ceremony ≤25 s. Overflow goes to text.

### 3.8 The night ledger and learning

- Every per-night counter (caps, spotlight, rotation, latches, bits, Stash writes) lives in `bot_kv` keyed by night, written through **one authenticated director route** on the bot, so a voice-bot redeploy mid-raid resumes. Quip no-repeat is **season**-scoped (about ten raids). Mimic's once-a-night marks live in the agent's state file. The voice bot's deploys watch only its folder and pause in raid windows.
- Every spoken persona line is an exposure (`announcer_events` until `callout_fires` ships): line id, variant, take, surface, and a hash per slot, never the name. Flavour variants self-tune from hush and "too much" rates (weight × (1 − rate), floor 0.2). Tactical lines never auto-change.

---

## 4. Voices

- **Rendered ahead:** fixed segments; tactical name templates as **whole sentences** for every roster character (default pronunciation, marked unverified: safety calls need no consent, and a robot/clip mix breaks "same words, same voice"); praise templates only for **verified** `spoken_as`, seeded from the guild's existing officer-verified pronunciation list (private, server-side) and corrected on `/me` by the owner or an officer; boss, zone and raid-loot names; numbers 0–999.
- **Cache key:** sha256 of persona voice version, engine version, normalised text, each name's lexicon version, DSP version.
- **Format:** Ogg Opus 48 kHz mono ~32 kbps (Chromium decodes it; Discord plays it without transcoding).
- **Memory:** Mimic preloads ~20 fixed tactical clips; tonight's roster sentences decode at raid start or on demand under an LRU cap (a decoded second is ~190 KB).
- **Fallback:** browser speech from `spoken_text`, **local voices only** (`localService === true`; cloud voices would send names to a third party).
- **Distribution:** the nameless tactical pack as a public release asset; anything with a name in a private bucket behind signed URLs; god packs on the always-on box's share.

| Persona | Render | Live tier (puppet box, unseen names) |
|---|---|---|
| miMIC | Kokoro-82M (Apache-2.0), radio band | Kokoro, same voice |
| Bristlebane | Chatterbox Turbo (MIT) from a reference: the guild lead's performance (pick) or a designed voice; laugh tags; best of 5 | a Kokoro understudy |
| Lord | Qwen3-TTS VoiceDesign (Apache-2.0) baked to a reference, cloned with Chatterbox; low shelf, room by tier | Kokoro + the same DSP |

- **Sounds, defined once:** no lead sound on urgent lines; miMIC's hinge leads INFO and FLAVOUR, its clack closes a resolved item; Bristlebane's bell; the Lord's ember. Shared moments are sequenced clips, not a duet engine.
- **Licences:** only Apache, MIT or CC-BY engines render shippable packs; non-commercial engines are audition references; GPL engines are never bundled into Mimic.
- **Older datacenter GPUs** (Pascal class): fp32/int8 only, the last CUDA 12.6 PyTorch lane and the last supporting driver, pinned. They suit Kokoro, int8 speech-to-text and a mid-size model; expressive renders go to a free gaming PC.
- **CH GO timing gate:** a clip replaces today's voice only if log-to-"GO" onset matches or beats it, A/B'd on a farm night.
- **Latency:** CHAIN/CRITICAL ≤150 ms after the agent sees the line (preloaded clip); ALERT ≤400 ms; Discord kill lines 3–9 s after the kill, at the leader's pause. The old Microsoft-hosted voice is retired, not a fallback.

---

## 5. The model and Whisper

- **Writes style, never facts, never live.** The writers' room is the three cards and the lorebook in a SillyTavern group chat on the always-on box, on a local model: replay last night's real review facts, harvest what lands. Candidates go to `/admin/announcers` as pending; an officer approves, edits or rejects; approved lines render. Weekly, candidates also post to a Discord thread for reactions.
- **FactCards** are built by SQL: a first kill is the first **confirmed** kill of a raid target, excluding the current encounter, and "first" only for bosses with no confirmed kill whose expansion opened after tracking began.
- **The validator** rejects a number or proper noun not in the card, lexicon or lore list; a name without its slot's consent; blame; over-cap lines; anything about character families, tells, officer chat, absence or where a member went.
- **No live generation.** The earlier live jester path is deleted (it could not meet its own timeout and would have posted unreviewed names). Unforeseen moments get a generic bank line or silence.
- **Hosted models** get only nameless cards, after `/privacy` lists them. The lorebook stays local.
- **The puppet box:** an officer types, or dictates through local speech-to-text, a god line; it passes the linter and plays in the next quiet window in the live understudy voice (text if the always-on box is asleep). A person wrote it.
- **Ask (the Lord):** text first, read-only tools, logged; declines per-person death counts, rankings, bottoms, absence and last-seen for anyone not in tonight's raid; a voiced answer never holds a fact about a specific member.
- **Whisper (later):** push-to-talk only, never always-listening; the member's opt-in plus a separate `ask` consent; their audio only, a 10 s window, memory only, never written to the recordings share; biased with tonight's boss and raider names; the answer posts as text and is voiced only if it names nobody. Tactical calls never come from voice.

---

## 6. Consent and kindness

The rules are the bible's Part I §2.8–2.9; the engine enforces them. Additions:
- **Every named output, text included, waits** for the `announce_name` migration and the `/privacy` section. Nameless lines (first-kill cards) can ship now.
- **Data scopes:** honors carry only what the member's own Mimic recorded; spells only where their Inventory page is public; nothing inferred from other raiders' sightings is announced about a person.
- **Disconnects:** collected for announcer use only for members set to `any`; only "is back" is said; a "not tonight" command lowers `any` to `praise` for the night.
- **Hot Dice** reads the guild lead's midnight award at the next open; its query gains the exclusion filter.
- **Voice log and `/ledger`:** line ids and slot hashes; names render at view time through current consent; `any`-tier named lines are never kept; a retention period in the privacy table.
- **Voice cloning:** a `voice_consents` row from a private form that defaults to no and can be revoked silently; proof as text plus a timestamp; revocation deletes the reference and re-renders. Raid recordings are never a clone source; impressions need the subject's own yes; `/privacy` says each persona voice is synthetic and whose it is.
- **The Pack Chorus** plays a member's own clip (no cloning): one checkbox, revocable.
- **The consent screen says where lines appear:** raid voice and chat, which are stored, readable by anyone in those channels, and may be streamed.
- **`/privacy` additions:** the voice section, caller detection, pronunciations, the voice log, the Pack Chorus, push-to-talk (when built), the hosted-model rule.

---

## 7. Phasing (four costs each)

### Phase 0 — this week (Mimic and agent on beta; new pages live with [beta]; nothing to `main` in the raid freeze)

1. **Step zero** (§3.3) with the one-DI-one-line test.
2. **Voice-bot spike:** deploy, join a DAVE channel, play one Ogg Opus clip, receive one opted-in speaking event. Until it passes, the gods are text only.
3. **First-kill latch** (the Aten Ha Ra pattern, generalised): a `bot_kv`-latched kill card for every raid target's first confirmed kill, with the kill number and time since; a Mimic guild-trigger fanfare (no words) on the death line; the remaining Planes of Power first-kill lines pre-rendered on a free gaming PC (an officer may play one by hand until playback works); the weekly Blessing reads the first kills already missed.
4. **The contract:** the catalog, the card extension, the linter, a public example card with invented names.
5. **miMIC clip pilot:** today's exact strings and two priority levels, CH GO on top, the timing gate, behind a "miMIC voice (beta)" toggle; personality dial default Off.
6. **God text via webhooks:** nameless now, named after item 7.
7. **Collection:** `announce_name` and `name_pronunciations`, the pronunciation seed, Say my name, `/announcers` [beta], the `/privacy` section.
8. **`/ledger` [beta]** with the first plate rendered by hand.

| Build | Maintenance | Runtime | Change |
|---|---|---|---|
| ~4–6 session-days | low: data files; one new service only as a spike | ~$0: <1 MB per Mimic, no new reads on the raid path | low: lines are data; tiers are one table |

### Phase 1 — 2–5 weeks

- **Voice bot:** the raid director (`speakGate()`, pure, tested), playback, caller gate, CLOSING, catalog budgets, the night ledger via the director route.
- **Bot:** `RaidPhase`, the fight-live bit, `announcer-feed` with `caller_speaking_until` and `close_done`, producers (kills, first kills, deathrolls, fun events, flags, honors), the raid-target list, the immediate kill flush, `/screen` captions.
- **Always-on box:** the render queue with the **picture-helper pattern**, the hash cache, the private clip bucket, the rehearsal room.
- **Web:** `/admin/announcers` (review, audition, budgets, exposure and votes), the recap and voice log, `/hail` replies, the Favour meter after its pick.
- **Mimic:** name clips, exposure logging, the four tiers and each contract item as promoted.

**The picture-helper pattern:** one job queue on the always-on box. A helper on each gaming PC leases a job only when the game is not running, the GPU is idle and its owner has not marked it busy. It checks every few seconds; if the game starts, it aborts, unloads the model, frees the GPU and returns the lease. Leases expire, jobs are idempotent and small to transfer (a Wi-Fi helper is fine), and what is left by morning falls back to the always-on GPU, slowly. The same queue carries expressive voice renders.

| Build | Maintenance | Runtime | Change |
|---|---|---|---|
| ~2–4 weeks | medium: the queue, voice-library churn (DAVE, Node pins), GPU driver and PyTorch pins | electricity only; <50 MB storage; ~1–2 GB/month egress | low to medium: pack edits re-render; a new moment needs a producer |

### Phase 2 — after the always-on GPU is settled

The Lord's Ask box, then push-to-talk; the live voice tier and puppet box; nightly writers'-room batches; the consented voice library and the Pack Chorus; the keepsake (`/ledger` and the voice log, read back by the Lord from logged facts); packaging for other guilds as self-host wizard questions.

| Build | Maintenance | Runtime | Change |
|---|---|---|---|
| ~4–8 weeks | high: model, speech-to-text, consent records, the older GPU's software runway | GPU electricity; $0 model cost when local | medium: model and engine swaps are config; consent flows are sticky |

**Reusable by another guild:** catalog, card extension, linter, director, `RaidPhase`, caller gate, render queue, helper pattern, consent tables. **Not:** our lines, in-jokes, member voices, "mobs in camp" (it generalises as "camp discipline").

---

## 8. Files

| Place | Change |
|---|---|
| `packages/wolfpack-logsync/index.js` | `_pushOverlay` carries `moment`, `tier`, `audience`; `_calloutAllowedToSpeak` returns the category; the fight-live bit; immediate kill flush; night-keyed once-marks |
| `apps/mimic/triggers.html` | `speak()` / `_speakPriority` / `_speakNow` become the tiered renderer chain and the aside; Quiet mode unchanged |
| `apps/mimic/chchain.html`, `charm.html` | speech onto the single queue (Phase 0, with the clips) |
| `apps/mimic/main.js`, pack downloader | pack fetch and cache; the personality dial with tray and dashboard parity |
| `apps/bristlebane/` | player, `speakGate()`, caller gate with its own flag, CLOSING in `decide()`, feed and director-route clients; stays credential-free |
| `index.js` (bot) | `announcer-feed`, producers, the director write route, webhook posts, raid-live gated on the window |
| `utils/raidPhase.js` (new), `utils/hotDiceNight.js` (exclusion filter), `utils/voice.js` (retired once the voice bot speaks) | — |
| `web/` | `/admin/announcers`; `/announcers` and `/ledger` [beta]; Say my name and Announcer /consent on `/me`; `/privacy`; `/screen` captions |
| `guild/` | `personas/*.card.json`, `lorebook.json`, `moments.v1.json`, an example card with invented names |
| Supabase | `announce_name`, `name_pronunciations`, `voice_consents`, `announcer_lines`, `announcer_events`, a retirement flag, a private clip bucket |
| Docs | the dated DECISIONS entry; `DESIGN-selfhost-wizard.md` §3: always-on box vs helpers, render locations, clip storage split, licence rule, GPU pins, voice-log retention, persona config per guild |

## To-do

1. **The guild lead:** answer the picks.
2. **A session on beta:** Phase 0 items 1, 4, 5, 6; record decisions and the wizard §3 lines.
3. **The guild lead:** create the voice bot's app, token and the persona webhooks; **a session** runs the spike.
4. **A session on main, outside the freeze:** the first-kill latch.
5. **A session:** the consent and pronunciation migrations, the seed, `/privacy`, before any named line.
6. **A local session:** render the 12-line audition and the remaining first-kill lines on a free gaming PC; post them; log it under "Needs a local session".
7. **A writers'-room session:** build the v0.2 cards and lorebook from the bible, rehearse a replayed night, and write per-boss lines for the 43 Planes of Power bosses.
