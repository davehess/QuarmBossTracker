# Zeal & upstream

The Zeal fork, upstream PRs, the pipe, spawn ids, tags, Wolf Pack Zeal. Oldest first. Find an entry by its ID in [the index](README.md); new decisions go in `inbox/` and are merged here.

## 2026-08-07/5 — Zeal `/tag` (#194)
*2026-08-07 · DECISIONS-2026-08-07.md · Spawn ids collide across zones*

**Spawn ids are per-zone and structurally collide.** Ids are allocated in spawn
order from a low base in EVERY zone, so zone-boot NPCs share ids across zones —
14 named NPCs inside ids 11–45 in one zone alone. An id belongs to a spawn
INSTANCE and dies with the mob, so same-zone respawn reuse does not happen.

**Same-name identity IS available at scale — but operator-driven.** Measured:
4 simultaneous `a decaying skeleton`, 5 `a brown bear`, ~17 `an elder thought
horror`. All separable. But it needs a human to tag each mob against a chat
rate limit (~8/min), so design tags as high-confidence labels layered over
clustering, never as full coverage.

**Two upstream asks are drafted** (`docs/zeal-tag-spawn-id-collision.md`,
`docs/zeal-spawn-id-request.md`) and not yet sent.

**Tagging is only useful if the tag REACHES THE LOG — and two Zeal settings
silently stop that.** The broadcast is
`ZEALTAG | <text> | <mob name> | <spawn id>`, and that spawn id is the only
thing in the entire external surface that can separate same-name mobs. But:
  · `/tag suppress on` — Zeal drops the message before it is written to the
    log. Nothing to parse, ever. Cost us every capture from one raider for a
    whole session; their own tags never reached their own agent.
  · `/tag prettyprint on` — rewrites the line to `text => mob` and **strips the
    spawn id**, degrading the tag to a name we already had.
Both are warned about on the Mimic dashboard's tag-capture card with the exact
fix. A third and fourth way a tag draws the nameplate arrow but reaches no log:
`/tag local` (never broadcasts) and the server's chat rate limit. The arrow is
NOT evidence the broadcast happened.

## 2026-08-13/3 — XP compatibility mode on eqgame.exe breaks the Zeal pipe (EPERM)
*2026-08-13 · DECISIONS-2026-08-13.md · Compatibility mode on game exe breaks pipe*

**The finding (a member, 2026-08-13).** Zeal data never reached Mimic; the
agent log churned `[zeal] disconnected from \\.\pipe\zeal_36464 (EPERM)` on
every 25s poll. **Turning OFF "Run this program in compatibility mode for
Windows XP (Service Pack 2)" on `eqgame.exe` fixed it immediately.** Clean
before/after on one machine, nothing else changed.

**Why this is worth a decision entry and not just a support note.** The guild
points new raiders at `quarm.guide`'s *Xanax's Checklist for Minimal Crashes*,
and **item 8 of that checklist recommends XP SP2 compatibility mode**. So the
guide we recommend actively steers people into a configuration that silently
kills Zeal integration. Every `EPERM` report should now open with "is compat
mode on?" — before elevation, before antivirus, before anything else.

**Three distinct pipe failures now, with three distinct signatures.** Read the
signature before guessing the cause; they have nothing in common but the symptom
"no Zeal data":

| Log signature | Cause | Fix |
|---|---|---|
| never connects, `ENOENT` | Mimic installed *inside* the EQ folder; its DLLs shadow Zeal's DX hook (a member, 2026-06-12) | reinstall Mimic elsewhere |
| connects, then instantly closes, **no error code** | EQ elevated, Mimic not — pipe ACL denies the lower-integrity process (a member, 2026-07-05) | match elevation |
| `(EPERM)` on connect | **XP compatibility mode on eqgame.exe** (a member, 2026-08-13) | untick compatibility mode |

**Mechanism unknown, and deliberately left unknown rather than invented.**
`EPERM` is libuv's mapping of Win32 `ERROR_ACCESS_DENIED` (5), so Windows is
refusing the open outright. Compatibility mode does not change a process's
integrity level or its user, which is exactly why I told the guild lead it *couldn't* be
the cause — an inference that sounded solid and was wrong. What would actually
pin it: Process Explorer → eqgame.exe → Security tab (virtualization flag,
integrity level) and `accesschk \\.\pipe\zeal_<pid>` for the pipe's ACL, taken
with compat mode on and off. Until someone does that, the honest claim is the
observation, not a theory.

**Diagnostic worth keeping** — this splits "the pipe is broken" from "Mimic is
being blocked" in one shot, run non-elevated as the same user with EQ up:

```powershell
$p = New-Object System.IO.Pipes.NamedPipeClientStream('.','zeal_<pid>',[System.IO.Pipes.PipeDirection]::In)
try { $p.Connect(3000); 'CONNECTED' } catch { "FAILED: $($_.Exception.Message)" } finally { $p.Dispose() }
```

**Two product gaps this exposed, both of which cost the round-trip:**

1. **We knew it was `EPERM` and never told the user.** `zealPipe.js` captures
   `lastError` on the socket and hands it out through `onStatus` — and nothing
   displays it. Not the Zeal health overlay, not the tray. The single most
   diagnostic fact in the incident existed only in the raw agent log, which is
   why the guild lead found it and the affected raider could not.
2. **The one hint we do have fires once per install, ever.** The "Zeal pipes
   look off" notification leads with the elevation fix, but it is latched behind
   `cfg.zealHintShown`, persisted across launches. Dismiss it once and it can
   never fire again — for a condition that is environmental and recurring.

Fix for both: surface `lastError` on the Zeal health overlay with a
cause-specific line per signature above, and re-arm the hint when the error
*code* changes rather than latching forever.

**Follow-up (the guild lead): can the pipe be exposed WITH compat mode on?** It matters —
compat mode is a stability lever, so "turn it off" trades crashes for Zeal data
and nobody should have to pick. Three answers, in order of how fast they can be
tried:

1. **Run Mimic as Administrator, compat mode left ON.** A High-integrity client
   can open a Medium/Low-integrity object, so if the shim is perturbing the
   pipe's label or default DACL, elevating the *client* should punch through.
   Untested as of writing; costs one minute. Note this is the exact inverse of
   the earlier fix, which is a good reminder that "run as admin" is not a
   universal answer — it is a specific answer to a specific mismatch.
2. **Check whether XP SP2 specifically is required.** The Xanax checklist's own
   author ranks items 2/3/4 (AV exclusion, `#server-files` patch files, latest
   Zeal) as "the biggest contributors to stability" and describes compat mode as
   something "people swear by" — not a top lever. A lighter mode, or none, may
   cost nothing.
3. **The durable fix is upstream in Zeal, and it is small.** The pipe's security
   descriptor is set where Zeal calls `CreateNamedPipe`. If it passes `NULL` for
   `lpSecurityAttributes` — the common default — the pipe inherits the creating
   process's default DACL, which is precisely what the compat shim appears to
   disturb. Passing an explicit `SECURITY_ATTRIBUTES` with a permissive DACL and
   a low mandatory label (`S:(ML;;NW;;;LW)`) is the standard pattern for a pipe
   that must be reachable from other contexts. ⚠ We have NOT seen that call site
   — `docs/zeal-pipe-protocol.md` was assembled from the message format in
   `named_pipe.cpp`, not from pipe creation — so confirm before asking.
   **This is a far more tractable upstream ask than the spawn_id one**, which
   `CLAUDE.md` records as having gone nowhere partly because it aimed at the
   hardest possible surface: self-contained, well-precedented, and with a
   reproducible user-visible bug behind it.

**Mimic cannot fix this alone** — we are the client, and a client cannot widen
permissions on an object it does not own. What we can do is stop failing
silently, which is gap 1 above.

## 2026-09-01/1 — Zeal spawn-id capability is OBSERVED, never inferred from the version
*2026-09-01 · DECISIONS-2026-09-01.md · Spawn-id capability observed, never inferred from version*

**The call:** track two things about each raider's Zeal, not one —
`agent_upload_stats.zeal_version` (what the client reports) and
`.spawn_id_seen_at` (when it last actually sent us a spawn id). Branch on the
second; use the first only to chase adoption.

**Why, and it is not a style preference:** Zeal PR #229 is not in a numbered
release. A build carrying the patch reports the **same version string** as a
stock build of the same release — the author's own patched client reports
`1.4.5`, identical to stock `1.4.5`. So a version comparison would classify a
capable client as incapable, silently, and the fleet board would be wrong in
exactly the direction that makes it useless. Once the PR ships in a numbered
release the version becomes a legitimate second signal; guessing that number
today would bake a wrong answer into the schema.

**Both facts are sticky** (`coalesce()` for the version, `greatest()` for the
timestamp). Not targeting anything is the common case between pulls, so an
upload that carries no id must leave an earlier proof standing rather than
retract it. Capability is something you prove once.

**The latch sits on the pipe intake (`POST /api/zeal-state`), not on the
live-state upload.** That upload is change-signature gated: a capable client can
hand us ids for a whole fight without ever tripping a send, and latching there
would report it incapable. All three ids count (`spawn_id` / `target_id` /
`pet_id`) — a client parked at the guild lobby with nothing targeted still
streams its own `spawn_id` every frame.

**Counted in players, never characters** (per the 2026-08-16 rule). A Zeal
install reports once per install rather than once per character, so a character
count overstates adoption.

**"Not yet proven" renders as nothing, not as a red failure.** It genuinely does
not distinguish stock Zeal from a patched client that hasn't fought yet, and
showing that ambiguity as a failure sends officers chasing people who have
nothing to fix.

**The fallback is unchanged and still matters:** a raider whose client sends no
id can still be separated by `/tag`, which broadcasts the same `Entity::SpawnId`
over chat. These columns say **who needs that fallback**, not whether it exists.

## 2026-09-10/1 — Zeal 1.4.6 ships the spawn id, and it changes a CLAUDE.md scope boundary
*2026-09-10 · DECISIONS-2026-09-10.md · Zeal 1.4.6 exposes spawn id*

Guild lead: *"zeal 1.4.6 was released so spawn ID is now exposed for anyone that's on
that version and has named pipes exposed and sending data."* Confirmed in our
own data, not taken on faith:

| Day | Landings | Name-only (blind) | Raiders sending ids |
|---|---|---|---|
| Sep 3 | 2,071 | 99.9% | 1 of 19 |
| Sep 6 | 5,006 | 100% | 0 of 23 |
| Sep 7 | 16,656 | 91.9% | 6 of 36 |
| Sep 8 | 6,047 | 49.3% | 9 of 25 |
| Sep 10 | 1,550 | 51.9% | **11 of 19** |

And the capability claim itself, measured: **twelve distinct spawn ids for
`A Shik`nar Forager` in one 3-minute window** (Sun 09-07 22:27 ET), 27 landings
attributed cleanly — one bard's `Denon`s Bereavement` + `Selo`s Chords`, and we
only know it was twelve because that bard had updated.

**CLAUDE.md's "Zeal pipe carries no spawn id — same-name mobs are NOT
disambiguable" is therefore superseded**, including its instruction not to
design for N≥3 simultaneous same-name identities off the pipe. Marked as history
rather than deleted, because the name-keying in existing consumers only makes
sense read against it. `docs/zeal-spawn-id-request.md` is closed, not pending.

⚠ The remaining problem is **adoption, not capability** — about half of all
landings are still name-only because the raider who saw them has not updated.
Hence the poster (`zeal-update-why.png`), built entirely from the figures above.

## 2026-09-10/10 — Zeal 1.4.7 review: Target of Target is client-side only, not on the pipe (2026-09-12)
*2026-09-12 · DECISIONS-2026-09-10.md · Target-of-target is client-side, not on pipe*

The guild lead asked for a review of Larcen22's PR #228 ("Target of Target Assistbar",
merged 2026-09-09 as `b7a61d1`, shipped in **Zeal v1.4.7, 2026-09-10**, README
in #231). Read from the source, not the PR page:
- **How it works.** The legacy client does not store other entities' targets,
  so `AssistTarget` derives the candidate two ways and shows the fresher:
  (A) sniffs every `OP_Damage` (0x4058) packet into `victim_of` (attacker →
  last victim) and `hit_by` (victim → last attacker) maps with a freshness
  window (default 8 s) — mode `assist` = who my target last hit (ToT), mode
  `defend` = who last hit my target; (B) fires the client's own `do_assist`
  on the current target, intercepts the `OP_Assist` (0x4200) reply as the
  authoritative answer and SWALLOWS it so the player is not retargeted —
  on every target change (2 s cooldown) and optionally on a timer (`refresh
  on [ms]`, 5–60 s, default 10 s). Renders "ToT: Name" + HP bar at a fixed
  position (clickable; LMB-drag code present but `#if 0` pending a mouselook conflict). Settings under `[AssistBar]`.
- **Not on the pipe.** `named_pipe.cpp` emits nothing from it; the only pipe
  additions since are our #229 spawn ids (1.4.6). Mimic cannot read ToT from
  Zeal today. The candidate lives in `candidate_entity`, computed only in the
  render callback while the bar is enabled, so a pipe field needs a small
  follow-up: a getter on `AssistTarget` (or the selection lifted out of
  render) and one line in the type-3 player block, e.g.
  `player_data["target_of_target_id"]` + `assist_mode`. Same shape as #229.
- **New commands, CORRECTED 2026-09-12** (first pass listed `clickable` as
  live; it is not — see below): `/assistbar on|off|toggle · position <left>
  <top> · font <size> · mode assist|defend · window <ms> · refresh on|off
  [interval_ms]`, plus two that work but are deliberately absent from the
  in-game usage text — `refresh-now` and `verbose` (prints every OP_Damage to
  chat, a ready-made probe for what combat a client actually receives) — and a
  new keybind **Assist Refresh** (silent /assist poll). Same release:
  `/labels showtargetspawnid` appends the target's spawn id to the target
  label — the human-readable twin of our spawn-id work.
- ⚠ **The whole mouse path is compiled out of v1.4.7 — FOUR `#if 0` blocks**,
  each commented *"Temporarily disable until lmb drag conflict with mouselook
  is sorted out"*: the `LMouseUp` hook registration (line 65), the
  `UpdateDrag()` call (273), the `clickable` usage line (393) and the
  `clickable` command handler itself (467). So in the shipped build
  `/assistbar clickable on` is not a command, clicking the bar does nothing,
  and dragging does nothing — while the usage text still says *"or drag the
  bar with LMB"*, which is exactly what a member hit in #zeal-suggestions.
  `HandleLMouseUp` is fully written (bounds check, re-validate the entity,
  `set_target`), so "make the ToT clickable" is *finish the disabled path*,
  not a new feature; the mouselook conflict is the real blocker.
- ⚠ **How I got it wrong, because the failure repeats:** I grepped for the
  command handlers and read the matches. Preprocessor guards sit OUTSIDE a
  grep window that matches on handler text, so four `#if 0` lines were
  invisible — the same class as asserting on source text that a comment can
  satisfy. Reading a C++ feature means reading the block, not the hits.
- **Cost note:** auto-refresh sends a real /assist request per poll per
  raider; default off. If Mimic ever recommends it, keep the interval long.

## §59e — Targeting the pet from the Charm window — not buildable from Mimic alone; a Zeal change
*2026-09-21 · DECISIONS-2026-09-21.md · Targeting pet from Charm window needs Zeal*

*"It would be awesome if you could click target the pet from the charm tracker window"* / the guild
lead: *"I don't know if we can inject a target back into EQ."*
**What is true today** (read from the Zeal source, 2026-09-27):
- **The pipe only goes one way.** `named_pipe.cpp` creates it `PIPE_ACCESS_OUTBOUND`: Zeal writes,
  Mimic reads. There is no channel for Mimic to ask the client for anything.
- **Zeal already has everything on the client side.** `Zeal::Game::get_pet()` returns the player's
  pet entity (off `PetID`), and `Zeal::Game::set_target(Entity*)` targets an entity without the
  `/target` range rules. A `/targetpet` command is a few lines in the commands registry.
**Options, cheapest first:**
1. **A `/targetpet` slash command in Zeal (fork).** No Mimic change; the member binds it to a social
   hotkey. Build: an hour. Maintenance: none. Runtime: none. Change: easy. It does not give a click
   in the Charm window, which is what was asked.
2. **An inbound command channel in Zeal, one verb only** — a second pipe Zeal opens
   `PIPE_ACCESS_INBOUND`, accepting exactly `target_pet` (and nothing that casts, moves or sends
   text), which Mimic writes when the pet row is clicked. Build: a day (C++ + the Mimic bridge + the
   click handshake). Maintenance: low, but it is our fork only — members on upstream Zeal do not get
   it. Runtime: none. Change: every new verb is a new decision. **Its risk is policy, not code:**
   anything outside the game driving the client is the category server rules are written about, so
   it needs the guild lead's call and ideally a word with the server staff before it ships.
3. **Keystroke injection** (Mimic sends a keypress into the EQ window). **Not recommended:** it
   steals focus mid-fight, breaks under a remapped key, and is squarely automation.
**Recommendation:** 1 now (it answers the need with no policy question), 2 only if the guild lead
wants the click and is comfortable with the server question. Nothing built.

## §26 — A Bandolier chat filter for Zeal — change on the guild lead's fork (2026-09-25)
*2026-09-25 · DECISIONS-2026-09-21.md · Bandolier chat filter added to Zeal fork*

The guild lead, from the Quarm Discord thread "Bandolier Spam/Filter Option":
*"This is something I'd like to get implemented in Zeal. Please review Zeal and
lets find a way to add a chat filter for Bandolier messages. Currently they're in
Other i believe."*

**Confirmed in Zeal's source (v1.4.7):** `/bandolier` is Zeal's own feature and
prints with `print_chat()`'s default color 0 — the client's **Other** filter. So
it is fixable entirely inside Zeal, no server change.

**The change** (`docs/zeal-bandolier-filter-request.md` has the PR text; branch
`bandolier-chat-filter` on github.com/davehess/zeal, 25 lines across 5 files):
a new `CHANNEL_BANDOLIER` and a **Bandolier** entry in the Zeal chat-filter
submenu, on the existing `/mystats` pattern. Routine status lines (loading, swap
complete, already equipped, please wait, saving, list) go there; failures keep
their channels so a swap that did not happen is still seen. Same colour as
before; unassigned it shows in the main window, so nothing moves until someone
assigns it. Appended last because Zeal saves each filter's window by list
position (`ChannelMap41+index`). A filter, not a suppress checkbox: it covers
both asks (own window, or a window kept out of the way) and adds no setting.

Not compiled here (no MSVC in a cloud session). The other open Zeal issues the
guild lead shared are triaged in the same doc — #218 is already done (can be
closed), #213 (target level/class/race + loc on the pipe) is the one worth doing
next for Mimic.

**Follow-up, same day — failures go in the filter too.** The first build (`4d16f8d`)
compiled clean (0 warnings, 0 errors) and passed in game: Bandolier listed after
Zeal Spam, loads and swaps in their own window. The guild lead then spotted a red
*"You cannot swap items when holding something in the cursor!"* and asked where it
went. Zeal prints the same "cannot swap" text two ways: default colour (Other) when
the pre-swap check catches it, spell-failure red when a step fails mid-swap; "no
empty inventory slot" / "item not found" were red too. Offered: A (leave as
tested), B (make the pre-swap ones red for consistency), and the option the session
advised against, routing failures into the filter (a hidden Bandolier window would hide a
failed swap). **The guild lead's call: *"B, those should all be part of the
filter"*** — every bandolier message goes to the Bandolier filter, failures in red.
Landed as a second channel, `CHANNEL_BANDOLIER_FAILURE` (1012) → spell-failure
colour, taken by the same filter entry, so failures still stand out *inside* that
window. Usage stays default colour (it also prints after a successful `/band bag`,
a pre-existing fall-through that was left alone). Amended into the single commit
(`30a79bb`, still the guild lead's authorship), force-pushed. **Rebuilt and passed
in game the same day**: cursor, no-empty-slot and set-does-not-exist failures red in
the Bandolier window, loads/swaps in the default colour. A load typed mid-cast never
reaches Zeal — the client answers "You can't use that command right now" first —
which the guild lead called fine; the PR's test step was reworded to match. Ready to
open.

## §27 — Six icon shapes for Zeal `/tag` — branch on the guild lead's fork (2026-09-25)
*2026-09-25 · DECISIONS-2026-09-21.md · Six new tag icon shapes on fork*

The guild lead: *"We should make another branch for additional zeal tag icons. see
about generating some of these"*, with a reference strip of six raid markers
numbered 1–6: skull, red X, gold sword, blue diamond, green flame, purple star.
The upstream maintainer had said in the Quarm Discord that a skull was tried and
dropped because *"the 2-d extrusion approach"* did not look right.

**The approach that gets past that:** each shape is several convex parts (fan-
triangulated), concave outlines come from overlapping parts, and detail is a part
standing 0.03 proud of both faces in a dark or light accent tone — eye sockets,
nose and teeth on the skull, the sword's fuller, the diamond's facet, the flame's
core. Same unlit, vertex-coloured triangle-strip path as the arrow/octagon/paw; no
textures. Geometry lives in a new DirectX-free `tag_shapes.cpp`, which is what made
an off-client check possible: `docs/upstream/zeal-tag-shapes/preview/` compiles it
unchanged with g++, decodes the strips exactly as Direct3D draws them (all indices
in range, no stray join triangles) and rasterises `preview.png` with the same
gradients. Keys `^1^`–`^6^` follow the numbering on the reference strip; older
clients ignore an unknown key and still show the text. Side fix in the same
change: the shape is chosen from the tag's own colour before a nameplate colour is
substituted, so a nameplate colour can no longer draw a paw by coincidence.

Not compiled with MSVC yet (no Windows SDK in a cloud session). Branch `tag-shapes`
(`fefa1c0`), starts from 1.4.7, independent of the Bandolier branch. Our agent's
tag parser knows only R/O/Y/G/B/W/P/S — it needs `1`–`6` (and the prettyprint
regex the six names) once upstream ships, not before.

## §28 — Zeal tags that survive a crash, relog or character switch — and stay in their zone (2026-09-25)
*2026-09-25 · DECISIONS-2026-09-21.md · Tags persist across crash and stay in zone*

The guild lead: *"We should see what it would take to persist zeal tags in zones
for users that crash and come back in and lose the tags on mobs or switch
characters and lose them. That's a current issue"*, then *"As well as not tag same
spawn-ids in other zones"*.

**Both causes, read from Zeal 1.4.7:** tags live only in `nameplate_info_map`
(keyed by entity pointer), which `clean_ui()` empties on zoning, character select
and a graphics device reset — nothing is ever written to disk. And
`handle_tag_message` applies a received tag by `get_entity_by_id(spawn_id)` alone.
Spawn ids are per zone, so an rsay or chat-channel tag from someone in another zone
lands on whichever local mob has that number, even though the sender already puts
the stripped target name in the message.

**Built rather than scoped** — branch `tag-persistence` on the fork (`0d66a28`, now `ca71999` — see the crash note below),
starting from 1.4.7:
- a received tag must also match the local entity's stripped name; no message
  format change, so older clients and our agent's parser are unaffected;
- about once a second, live tags are mirrored into a map keyed by {zone, spawn id}
  with the name, written to `<character>_tags.txt` on change (temp file + rename),
  and restored onto a returning entity with the same zone, id and name;
- dropped when the mob becomes a corpse, when another name holds the id, on a
  `clear` (the whole zone, out-of-view mobs included), or 3 hours after last seen.
  `/tag persist` toggles it and defaults to on.

The file load and save functions were extracted verbatim and round-trip tested with
g++. Mutating the merge rule and the expiry rule each made the test fail. Not
compiled with MSVC yet.

**Choices made without asking, listed in the PR doc so the guild lead can change
them:** 3 h expiry (a zone that repops overnight reissues the same ids and names,
so a long window would restore yesterday's tags on today's mobs); on by default;
one file per character; name-only cross-zone check (a zone field in the message
would close the rare same-name-same-id case but changes the wire format our agent
parses). **Not covered:** tags sent while a client was offline — recovering those
needs a resync between clients over rate-limited chat channels, a separate design.
Doc: `docs/upstream/zeal-tag-persistence/`.

**Crash on first build, same day.** The combined `test-all` build crashed EQ at
launch: Zeal's own dialog, a null read in `Zeal.asi`, `Callbacks: Startup`. The
Windows 11 update in §29 was ruled out by `winver` (the guild lead is on Windows 10,
build 19045). The guild lead sent the crash zip plus their `Zeal.asi` and `Zeal.pdb`.
`scripts/read-minidump.py` gave the offset `Zeal.asi+0x9fcd9`, and `llvm-symbolizer`
on the PDB named the chain: `NamePlate::NamePlate` → `setting_zeal_fonts`'
constructor → `ZealSetting::init` runs its change callback → `clean_ui()` → the new
`saved_tags` loop, on a map declared *below* the settings and so not yet
constructed. Fix `ca71999`: the persistence state moved to the top of the class,
with a comment. **Lesson for any Zeal change:** a `ZealSetting` with a callback runs
that callback during construction, so anything the callback touches must be
declared above it. **Method worth keeping:** crash zip + `Zeal.asi` + `Zeal.pdb` →
`read-minidump.py` → `llvm-symbolizer --obj=Zeal.asi <0x10000000+offset>` gives
file:line from a cloud session in two commands.

## §30 — Zeal tags, round two — letter keys, numbered badges, a wolf; corpse tags checked (2026-09-25)
*2026-09-25 · DECISIONS-2026-09-21.md · Tags round two: letters, numbers, wolf*

**In game, first test build (`test-all`):** all six icons rendered over live mobs.
Persistence held through a camp and through `/q` (the
guild lead's stand-in for a crash, quicker to log back in from).

**The guild lead's calls:**
- *"we should have numbered tags 1-12, each of those other icons should have their
  own tag that's not a number"*.
- *"add in a wolf"*, with the guild's wolf-head logo as the reference.

**Landed on `tag-shapes` (`b83036b`):**
- **Icon letter keys:** `K` skull, `X` X, `A` sword, `D` diamond, `F` flame, `T`
  star, `L` wolf.
  - Chosen to avoid R/O/Y/G/B/W/P/S. An older Zeal reads only the first key
    character, so a free letter shows the text and no shape. `S` for skull would
    have drawn a stop sign on those clients, the opposite message.
  - `L` is the only free letter in "wolf".
- **Numbered badges `^1^`–`^12^`:** a white disc with block digits.
  - `^10^`–`^12^` are read as two-digit keys only when both characters are digits
    and a `^` follows, so no existing prefix changes meaning.
  - The digits sit on each face separately, with the back copy mirrored, so a badge
    never reads backwards.
  - A dark badge was rendered too and lost contrast on dark backgrounds, so white
    is the default (one constant).
- **Tests:** the key parser was extracted verbatim and tested with g++ for every
  number, every letter, `13`/`0`/`-`, and no collision between badge values and
  named colours. All 19 meshes pass the strip check.

**Corpse tags — why they don't work today.** It is deliberate code in
`nameplate.cpp` (1.4.7), not an engine limit:
1. `is_taggable_target()` allows only Player and NPC types, so `/tag` on a corpse
   answers "Must have a valid target with a visible nameplate".
2. `handle_tag_message` adds tag text only to `Type == NPC`.
3. `render_ui` skips both tag text and shape when `is_corpse`.
4. The tagged-nameplate colour is skipped for corpses.
5. `/tag target` needs a tab-targetable NPC, and corpses are not.

A tag on a living mob therefore stays in memory after it dies, just hidden. Our
persistence branch drops it at death.

**Allowing it** would take about five small edits, plus one design choice: whether
a kill marker should vanish at death. The recommendation is yes. Hide tags a mob
carried before it died, and show only tags set on the corpse itself (a flag saved
when the tag is applied). Otherwise every "kill skull" would linger on the corpse.

Not built: the guild lead's call, together with whether player corpses (rez
priority) are in scope. The corpse keeps the NPC's spawn id on EQEmu, as far as we
know. That is **unverified on Quarm**, and so is whether a player corpse keeps the
player's id. The name check would still hold either way, since `strip_name` drops
"'s corpse".

## §31 — Zeal tags, round three — traced wolf (five variants), moon, lasso, lute, shield, lettered paws (2026-09-25)
*2026-09-25 · DECISIONS-2026-09-21.md · Tags round three: traced wolf variants, more icons*

**The guild lead's calls, in order:**
- *"That wolf doesn't look good, try 5 more versions. use the wolfpack.quest
  landing page svg and make the eyes yellow"*.
- A moon, a lasso and a lute as reference images: *"that's a moon, lasso for
  pulling, and a lute for bard"*.
- *"Take the pet paw and add each digit and letter in so charmers can add their
  initial in"*.
- *"we also need a version of this shield"*.

**The wolf is now traced, not hand-built.** The landing-page wolf is a PNG, not
an SVG: `web/public/wolf.png` (bone, alpha-keyed) plus `wolf-eyes.png` (the
`#FFCF5C` eye islands); provenance in `wolf.provenance.txt`.

`trace_wolf.py` builds it with the standard library only: a PNG decoder,
crack-following contours, Douglas–Peucker, ear clipping. It follows the artwork's
nesting (face → dark linework → yellow eye islands → pupils) and fills each region
as its own layer, one step prouder than its parent, so nothing needs a polygon
with holes. The output is `Zeal/tag_shapes_wolf.inc`, generated data like the
paw's point tables.

**Five variants, all built from that trace** (`wolf-variants.png`):
1. **classic:** the landing wolf in bone.
2. **outlined:** a dark border, for bright backgrounds.
3. **badge:** on a dark disc, matching the numbered badges.
4. **shadow:** a dark silhouette with glowing eyes, like the site's
   `wolf-solid` + `wolf-eyes` layering.
5. **steel:** grey with light linework.

A full-detail trace and a silhouette-only version were tried and dropped: the
first reads the same as classic at tag size, and the second lost its eyes on a
bone face. **Classic ships as a placeholder until the guild lead picks.**

**New keys** (all avoid the letters an older client already draws):
- `M` moon (mez);
- `U` lasso (pull);
- `N` lute (bard);
- `H` shield (tank; the reference was a 50-px grey heater shield, built with a
  darker rim, cross band and boss);
- `^P0^`–`^PZ^`: the paw with a 5×7 block letter or digit on its pad. It is
  drawn as the paw plus a glyph shape queued at the same spot, so there are 36
  small glyph meshes rather than 36 paws. An older client reads `^PK^` as a
  plain paw.

**Checks:**
- All 59 meshes pass the strip check, and each wolf variant was compiled through
  the real code.
- The key parser was extracted verbatim and tested: every number and paw glyph,
  every letter, lowercase paw letters, and no collision among named, numbered and
  paw-glyph colours.
- `static_assert`s now tie `TagArrows::Shape` to `TagShapes::Kind`.

**Found in passing:** a `test-all` rebuild hit a merge conflict (the include lists
of the shapes and persistence branches). A pipe masked the failed merge, so
`test-all` was briefly pushed without persistence (`e4af8d0`). Fixed within
minutes as `302f764`. Lesson: never pipe a `git merge` whose exit status gates a
push.

## §32 — Zeal tags, round four — outlined wolf on `^WP^`, $ and €, and a symbol for each guild (2026-09-25)
*2026-09-25 · DECISIONS-2026-09-21.md · Tags round four: outlined wolf, guild symbols*

**The guild lead's calls, in order:**
- *"Dollar Symbol, Euro symbol. For the wolf i like the second column"*: the
  **outlined** wolf ships, plus `^$^` (green) and `^E^` (amber).
- *"We should try to make a symbol for each of these guilds"*, with a list of 29
  guilds.
- *"make the wolf WP"*: the wolf's key moved from `^L^` to **`^WP^`**, and `L` is
  free again.
- *"before you render all of those symbols in c++ please show me a preview of all
  of those guild symbols"*: **no C++ for the guild symbols until the guild lead
  has picked from the preview.**

**`^WP^` is the one icon key that an older client draws as something.** It reads
the `W` and shows a white arrow, where every other new key shows text only. A white
arrow is still a plain marker, not a contradicting one. Only an exact `^WP^` changes
meaning; `^W^` and `^WPx^` stay white arrows. The extracted-parser test covers all
three, and it was mutation-checked in both directions: dropping the two-character
read, and mapping `WP` back to white.

**Guild symbols: two directions, prototyped in Python only**
(`docs/upstream/zeal-guild-emblems/`, the script in
`zeal-tag-shapes/preview/guild_emblems.py`). Both use the same part rules as
`tag_shapes.cpp`, for 30 guilds: the list plus Wolf Pack, whose symbol is the
`^WP^` wolf from a dump of the real meshes.
- **Pictograms, one per guild.** These read far better at tag size.
  - Cost: every new, renamed or redesigned guild is a Zeal release.
  - Risk: a table of guild artwork may not be something upstream wants.
- **Monogram banners.** One template, with any code typed in the tag.
  - Cost: no maintenance per guild.
  - Measured weaknesses: colour computed from the letters collides (9 of 30
    green), and three letters are barely legible at about 40 px.
- **Proposed: both behind one key, `^#<code>^`.** Zeal draws the guild's pictogram
  when it has one, and the banner otherwise. What people type never changes when
  a guild gains a pictogram.
  - Checked against upstream `e24a3ed`: an older client turns the shape off and
    shows the text.

**Guessed, for the guild lead to correct:**
- Every code (guilds may have their own).
- The symbols the proposal marks as a stretch: Axiom, Hardened Casuals, The Drift
  and Mass Group Ego.

**Checks:**
- All meshes pass the strip check (wolf 854 vertices, dollar 650, euro 500).
- `preview.png` was re-rendered with 13 icons.
- The patch was regenerated from `22ce809`.

**Found in passing: a chained push command reset a local branch.** A
`--force-with-lease` push with no remote-tracking ref (the fork's fetch refspec
covers only `main`) was refused as "stale info". The command's `a && b || c`
chain then ran the fallback `git reset --hard main` on the current branch, which
was `tag-shapes`. Nothing reached the remote. It was restored from the reflog, and
the diff was verified to be only the `WP` change.

Lessons:
- On that fork, give the lease explicitly: `--force-with-lease=<branch>:<sha>`.
- Never let `||` follow a chain that contains a push.
- Check the merge state by hand: `set -e` did not stop the merge loop that
  rebuilt `test-all`.

## §33 — Guild marks built: a banner (`^B<code>^`) and an icon (`^I<code>^`) for 30 guilds (2026-09-25)
*2026-09-25 · DECISIONS-2026-09-21.md · Guild banners and icons for thirty guilds*

**The guild lead's calls:**
- *"I like the flags, make them B__ for Banner. Lets put them all in and give me a
  list of each of the tag commands so i can try them out in game after we compile"*
- *"I want both"*: the banners and the icons.

**What landed on `tag-shapes` (`3c02f65`; `test-all` `dfe6143`):**
- **One table, `TagShapes::kGuilds`**, one row per guild: code, name, banner colour,
  icon colour. Changing a code is a one-row edit.
- **`^B<code>^`** is the swallowtail banner with the code in the paw glyphs' 5×7
  font.
  - Banner colours step round the hue wheel by the golden ratio, alternating bright
    and deep. This replaces the preview's colour hashed from the letters, which put
    9 of 30 in green.
  - Wolf Pack's banner is the platform gold.
- **`^I<code>^`** is the guild's icon: 27 ported from the Python prototype.
  - Wolf Pack, Europa and Loot & Some Fun use the existing wolf, € and $ through
    an `icon_key` alias, so no mesh is duplicated.
  - The d20 now shows its "20": the prototype drew the digits level with the face,
    so they were hidden.
- **Keys:** `B` or `I`, then letters up to the next `^`, read as a guild key only
  when they name a guild (either case).
  - So `^Blue^` stays a blue arrow, as does `^BC^` (Breakfast Club is `^BBC^`).
  - On an older client a banner shows as a blue arrow; an icon shows as text only.
  - **The icon letter `I` was our pick**: the guild lead named only `B`. `I` is not a
    key on older clients, so nothing wrong is drawn there.
- **`/tag guilds`** prints every code and name, five to a line. The help, README,
  prettyprint (`Banner EUR`, `Icon MAY`) and tooltip all know the new marks.
- **Geometry additions:**
  - a small ear-clipping triangulator, for the concave outlines (bolt, crescent,
    wings, claws, crown);
  - tapered-stroke, petal and chain-link helpers;
  - a settle step that centres each icon and puts its base at z = 0.

**Checks:**
- All 120 new meshes pass the strip check. The three alias icons are empty by
  design.
- The build is clean with `-Wall -Wextra -Wconversion`. Zeal builds with MSVC `/W2`
  and does not treat warnings as errors.
- The key test covers every guild in both cases, the alias icons, the unknown-code
  cases, and all **126 tag colours distinct**.
  - It now also extracts `TagArrows::Shape` from `tag_arrows.h`, so the shape
    lookup is tested against the real enum.
  - Four mutations were each caught: dropping the guild key read, the banner
    colour, the icon alias, and the banner shape.
  - The test ran on the `tag-shapes` source and again on the merged `test-all`.
- The vertex buffer grows from about 12k to about 32k vertices (about 0.5 MB).
- `guilds.png` is rendered from the real meshes.

**For the guild lead:** `docs/upstream/zeal-tag-shapes/TRY-IN-GAME.md` has the build
steps, every command, and the cases that must not change.

## §34 — Corpses can be tagged; the test list is labelled key-then-name (2026-09-25)
*2026-09-25 · DECISIONS-2026-09-21.md · Corpses taggable; labelled in-game test list*

**The guild lead's calls:**
- *"give me the testing list for the /tag local <tag> but the actual name at the end
  should be the tag lettering and then afterwards the guild name"*.
  - Done: every line in `TRY-IN-GAME.md` now reads `/tag local ^BEUR^BEUR Europa`
    (`^K^K Skull` for the non-guild shapes).
  - A tag's text is capped at 32 characters **including the `^key^` prefix**. Only
    the two Here There Be Monsters lines (33) are cut, to "…Be Monster".
- *"Also i can't tag corpses or anything without visible nameplates"*, with a
  screenshot of "Must have a valid target with a visible nameplate to tag". **Read as
  the §30 corpse decision: build it**, with the design recommended there.

**Built on a new branch, `tag-corpses` (`aa975e1`, off upstream main).** It is its own
branch so it can be its own PR. The change is 31 lines added, 11 removed:
- NPC and player corpses are taggable, and take text and the default arrow.
- `NamePlateInfo::corpse_tag` marks a tag set on the corpse itself.
  - The render path, the tagged colour and `/tag target` honour a corpse's tag only
    with that flag.
  - The first tag on a corpse replaces the mob's pre-death tag, which stays hidden
    until then.
  - So "kill skull" never lingers on the body, while "loot" or "rez me" on a corpse
    shows.
- `/tag target` reaches corpses: its filter is line of sight, not entity type.
- It merges cleanly into `test-all` (`1f866c4`). The key test passes on the merge.
- The persistence branch still drops a mob's saved tag at death, and does not save
  corpse tags across a relog (corpses decay).

**Not built: tagging a target whose model is not drawn** (too far away, or not loaded
yet).
- A tag lives on the per-nameplate entry keyed by entity pointer, which is created only
  for a drawn actor and erased in the entity-destructor hook.
- Pre-creating one for an undrawn actor risks a dangling pointer if that hook does not
  fire for it.
- The safe design is to hold the tag by spawn id and apply it when the nameplate
  appears (what the persistence branch already does on restore).
- **Waiting on the guild lead:** which mob hit the message, and whether this case is
  wanted.
- Race-hidden nameplates and "names off" were checked: those mobs have an entry and
  can be tagged today.

**Not compiled with MSVC here.** The corpse change touches only `nameplate.cpp/.h`,
which needs the DirectX headers. It was reviewed and formatted but not compiled.
`test-all` is the first real build of it.

## §38 — Guild logos become tag pictures you drop in a folder, like target rings (2026-09-26)
*2026-09-26 · DECISIONS-2026-09-21.md · Guild logos as drop-in tag pictures*

**The ask.** Another guild's leader sent their painted shield logo. They wrote *"This
graphic is probably too complex to make into one of those"*, but asked anyway.

**The guild lead:** *"requests are coming in, probably best to have a preset and treat
them like the target rings where you can add some"*.

**The call:**
- The 30 built-in marks stay as the presets.
- New marks are **picture files** that anyone can add, the way target ring textures work:
  - `uifiles/zeal/tagicons/<name>.png` or `.tga`, used as `^I<name>^`;
  - no code change and no Zeal release per guild.
- A picture takes over from a built-in icon with the same code.

**Why pictures, not shape files** (both costed in the PR doc):
- **The requests are painted art.** A detailed shield cannot become an extruded shape
  without being redrawn.
- **Shape files would need tracing per guild.** A file format for outlines is also a
  contract that is painful to change once guilds hold files.
- **Pictures cost one textured-quad path, once.** It is modelled on the target ring and
  the 3-D nameplate text.

**Built:** branch `tag-icon-files` on the fork (`ac5d177`), merged into `test-all`
(`e742081`).
- It is not compiled here: the draw path needs the Windows build.
- The key parser, folder scan and file-header check are tested off-client with g++ and
  mutation-checked (8 of 8 breaks caught).
- PR text, patch and harness: `docs/upstream/zeal-tag-icon-files/`.
- In-game steps: `TRY-IN-GAME.md` → "Pictures".
- A picture is checked before it is decoded:
  - PNG or true-colour TGA, recognised by its header;
  - at most 512 pixels a side;
  - at most 1 MB.

**Consequences:**
- **Only players who have the file see the picture.** Everyone else sees the guild's
  built-in shape, or just the text. Tag messages are unchanged.
- **Nobody outside our own build sees any of this until the Zeal maintainers merge
  it.** Any reply to the requesting guild has to say so.
- **The logo page (§36) gets simpler.** The public gallery can offer each guild's picture
  as a download, still with no upload on our site.
  - Our step is offline: remove the background, crop, and cap the size.
  - Installing a pack through Mimic is a later option. It is not built.
- **Other guilds' art stays out of this public repo.** The test copy of the requesting
  guild's shield went to the guild lead privately. Only our own orientation card
  (`test-pictures/UP.png`, `UP2.tga`) is committed.
- **Known gap:** a picture tag comes back as its fallback shape after a relog. The
  tag-persistence file stores the shape colour, not the picture name. It is a small
  follow-up once both branches land.

## §39 — The tag icons render in game; the gallery hosts the picture files (2026-09-26)
*2026-09-26 · DECISIONS-2026-09-21.md · Tag icons render in game; gallery hosts files*

**In game.** The guild lead sent screenshots from the combined test build. They show:
- all 13 symbols (the sword and diamond close up in 3-D);
- the numbered badges 1–12;
- the lettered paws;
- every guild icon, on the labelled test list and over real players of those guilds in
  a crowded scene (Nocturnal, Mayhem, Savage, Erud's Crossing Guard, Hardened Casuals,
  Axiom, Former Glory).

The banners (`^B<code>^`) were not in the screenshots, so they are still to check.

**The call:** *"yes, host the picture files in the gallery"*. It answers §38's open
question and confirms §36's option A: a public gallery, logos through Discord, no uploads
on our site.

**Built on `beta` as a preview (`f71e9975`):**
- `/zeal-icons`, in two layouts to pick from, per the UI-options rule:
  - **A**: `b.wolfpack.quest/zeal-icons`, one catalogue page. All 30 guilds with an anchor
    each (`#eur`), the downloads, the symbols, badges and paws.
  - **B**: `b.wolfpack.quest/zeal-icons?v=b`, a short guild index. Each guild gets its
    own page, `/zeal-icons/<code>`, to hand one guild leader.
- **Costs:**

| | Build | Maintenance | Runtime | Change |
|---|---|---|---|---|
| **A** | S | S: a row in the data file plus two images | One page; 121 small PNGs (828 KB), lazy-loaded | S |
| **B** | M | S: the guild pages come from the same data | Index ~30 icons; a guild page loads 2–3 images | M: 30 URLs go out in Discord, so the path is a promise once shared |

- **The images are ours, rendered from the real Zeal meshes.**
  - The exporter is `docs/upstream/zeal-tag-shapes/preview/export_marks.py`.
  - Provenance is in `web/public/zeal/PROVENANCE.txt`.
- **The one picture file so far is Europa's shield**, as `EUR.png` and `EUR.tga`. Its
  background was removed here. It is published because their guild leader asked for it to
  become a Zeal icon.
- **The test refuses any hosted picture Zeal would refuse:** a bad header, over 512 px,
  over 1 MB, or a file name that does not match the key.

**Kept off the public page on purpose:**
- **The crowded in-game screenshots.** They carry other players' character names. Tight
  crops of the icons alone would be fine, if wanted.
- **An image in Discord link previews for guild pages (B).** It needs a change to the
  shared preview route, `api/embed-meta`, so it waits for the pick.

## §40 — A tagged player keeps the tag: players are saved by name, not spawn id (2026-09-26)
*2026-09-26 · DECISIONS-2026-09-21.md · Tagged players saved by name, not spawn id*

**The guild lead:** *"tagged players should keep their tags if possible - i know they have
spawn ids that change"*.

**What was wrong** on the tag-persistence branch (§28): saved tags were keyed by zone and
spawn id, which only works for NPCs.
- **A player gets a new spawn id every time they zone in.** So a tagged player who
  zoned out and back, or zoned with you, came back untagged.
- **Worse:** if they left and returned while you stayed in the zone, the saved copy was
  still marked "seen live". The untagged newcomer read as a clear, and the saved tag was
  deleted.

**The call:** players are saved by name, in their own map and tied to no zone. A
character name is unique on the server.
- **The tag comes back** when they return after zoning, camping or dying.
- **It follows them** into another zone with you.
- **Their corpse** neither takes the tag nor drops it.
- **The entity destructor** marks a leaving player's saved tag as not live, so their
  return restores it.
- **A clear in view still drops it**, and a `clear` drops every player tag. Tags expire 3
  hours after the player was last seen.
- **The tag file** gains player lines (zone `-1`, spawn id `0`, then the name). Older
  builds never match them.

**Where it landed:** `tag-persistence` `9a3fd09`, merged into `test-all` `d32bed1`.
- **Tests:** `docs/upstream/zeal-tag-persistence/test/sync.sh` runs the real save/restore
  loop and destructor hook, extracted verbatim, through each case above. It also runs
  the file round trip. Six deliberate breaks, all caught.
- **Steps to try in game:** TRY-IN-GAME → "Tagged players keep their tags"; the PR
  test plan, steps 9–11.

## §151 — The guild lead's recent Zeal crashes are on the fork's test build (2026-10-04, agent 3.7.77 beta)
*2026-10-04 · DECISIONS-2026-09-21.md · Zeal crashes traced to test build*

The guild lead: *"i've had a number of zeal crashes lately that i can't tell if they're from my test versions
or from the main version, please look into them"*. Read from `crash_reports` (639 rows since 2026-08-03).

- **How a build identifies itself:** the crash dialog's `Zeal Version: 1.4.8 (<label>)`, stored
  verbatim in `crash_reports.zeal_version`.
  - An official release labels it with the bare short commit hash (`create_release.yml`).
  - Our fork's CI build uses `testall-<hash>` (`build-test-all.yml`).
  - A hand build uses whatever was typed (`testall`, `pr229`), or `UNOFFICIAL`.
  - ⚠ `agent_upload_stats.zeal_version` drops the label, so fleet-wide fork vs official can only be
    read from crash rows.
- **What it found:**
  - All four crashes the guild lead uploaded since 2026-09-20 were on fork or test builds; none on
    official since 2026-08-14.
  - **Three are one new signature:** `eqgame.exe` at `0x00520EFF`, last Zeal callback
    `CleanUpUI : Exit`, game state 1 (leaving the world for character select).
    - On 10-01 (twice) and 10-02, all on `1.4.8 (testall-0a2e25d)`.
    - Seen nowhere else in the corpus: no other player, never on official.
  - The fourth (09-25, `Zeal.asi` at Startup) is the fork init-order bug already fixed (§28).
- **Not proven:**
  - The fault is in the client's own code (between `MountEQPlayer` and `GetFullZoneName`), so naming the
    function needs the dumps.
  - The fork runs code in that teardown window at two points: `NamePlate::handle_entity_destructor`
    reads the entity's name for saved player tags, and the CleanUI path releases tag-picture textures.
  - In all three crashes the freed `Self` entity was overwritten with pixel-like bytes; official-build
    teardown crashes still held a real zone id there.
  - The NVIDIA driver also changed in the same weeks (a confounder).
  - The newest test build changes neither path, so updating is not a fix.
- **Shipped:** Mimic's crash list (Info → Crash review) printed the version only in a closed fold.
  Each crash's title now carries **"Zeal official"** or **"🧪 Zeal test build"** (`wpZealBuildTag`,
  agent 3.7.77, beta).
- **Next:**
  - The guild lead A/Bs on official Zeal for a few nights, or runs `/tag persist off` on the fork. Not
    both changes at once with the driver.
  - A local session reads the three dumps (STATUS, ⚠ Needs a local session).
  - Fork change only after one of those points at the fork's code.

## §213 — Zeal draws a cursor while the UI is hidden (pick B); the tag PRs are squashed; the Europa logo is replaced (2026-10-09)
*2026-10-09 · DECISIONS-2026-09-21.md · Zeal draws cursor when UI hidden*

**The pick** (the guild lead, 2026-10-09): *"b, BUILT in hide ui hides the mouse and zeal could show it. we need to finish
cleaning up these zeal PRs"*. B was "the fork draws the cursor", over A (the fork reports UI state on the pipe and Mimic
draws one) and C (Mimic watches F10). §13 has why nothing else can bring the game's own cursor back.
- **Built:** branch `hide-ui-cursor` on the fork, one commit on v1.4.8 (`2433493`), merged into `test-all` (`4014c49`) so
  Mimic's Test build carries it. A `HideUiCursor` class on `RenderUI` draws a flat white arrow with a black outline at
  `mouse_client_x/y` when the UI is hidden, in game, not mouse-looking and EverQuest is focused. Setting
  `ShowCursorWithUiHidden`, on by default; `/uicursor [on|off]`. PR package and the 9-step in-game test:
  `docs/upstream/zeal-hide-ui-cursor/`. Drafted by a Sonnet agent, reviewed here; clang-format clean; not compiled
  (no MSVC in a cloud session) and not run in game.
- **Open in game:** whether the game still updates the mouse position in F10 mode (if not, read `GetCursorPos` instead),
  and whether the arrow draws above the world (`RenderUI` runs before the game's UI pass).
- **PR cleanup.** None of the tag branches is open upstream yet. Each was a feature commit plus a "merge main (1.4.8)"
  commit (and, for tag pictures, two follow-ups). Rebuilt locally as one commit per branch on `50dc9a4`, messages folded
  together, with trees byte-identical to the pushed branches; `tag-icon-files` stays stacked on `tag-shapes` (it uses the
  guild shapes). All four pass the repo's own `Zeal/.clang-format`. **Force-pushed** on the guild lead's word (*"force
  push github"*), each with a lease on the head it replaced: `tag-shapes` 8b4ff07→`c2a5333`, `tag-persistence`
  a5f104d→`c143cee`, `tag-corpses` ccf7c07→`7f7c824`, `tag-icon-files` e8254ec→`9035722`. The old commits stay reachable
  through `test-all`'s merges. A local checkout of any of them must `git fetch && git reset --hard origin/<branch>`.
  **Not deleted:** `bandolier-chat-filter` (merged upstream as #238, head `30a79bb`) and `pipe-spawn-id` (obsolete since
  Zeal 1.4.6, head `b585ab6`). The cloud session's git proxy refuses branch deletion (HTTP 403), so that is a GitHub
  Branches-page click for the guild lead.
- **Europa logo.** *"Try making this the Europa logo"*, with a picture of a wooden shield with "EUROPA" across it. It
  replaces `web/public/zeal/tagicons/EUR.png`/`.tga` (226×256, transparent); processing in `web/public/zeal/PROVENANCE.txt`.
  web 1.8.133 on `beta` (`ba445fa4`), an existing page, so beta first: https://b.wolfpack.quest/zeal-icons.

## §224 — Pipe presses: ignore repeats inside a running timer, carry target name / spawn id; tags as roles (WPMA, follow) (2026-10-10)
*2026-10-10 · DECISIONS-2026-09-21.md · Pipe presses ignore repeats, tags as roles*

**The calls** (the guild lead):
- *"pipe messages sent between timers should be ignored if tied to your timers"* — a `/pipe <word>` that arrives
  while that ability's own timer is still running does not restart it (the game refused that press).
- *"...and taking a target name and/or spawn id ... should also help with identification. %t outputs target name in
  game, we may need one for spawn id."* — `/pipe <word> %t` keys the timer to that mob; a Zeal fork code for the
  target's spawn id (alongside `%t`) is to be added so same-name mobs separate.
- *"if you tag something 'foo' and you /target foo it will target the tagged foo target"* — Zeal tags double as a
  targeting handle. Two role conventions follow:
  - **Follow:** a raider tags themselves with a follow tag (e.g. `<Name>Follow`) so a slow-moving raider can
    `/target <tag>` then `/follow` (the guild lead raised it for a specific raider; not named here).
  - **Main assist `WPMA`:** the tank who holds main assist is tagged `WPMA`; everyone else can `/target WPMA` then
    `/assist` (or `/assist WPMA`). Taking the job: `/target WPMA`, `/tag chat clear`, `/target <self>`,
    `/tag chat WPMA` (to be confirmed against Zeal's tag semantics). Mimic should treat the `WPMA`-tagged raider as
    the declared main assist, latest tag winning, alongside the existing raid-chat declaration.
- *"even include a specific zeal target for MA. maybe target with 4 arrows pointing at it?"* — a new tag shape for
  main assist: a target ring with four arrows pointing inward.
- **Status:** two research agents scoping (Zeal fork: the spawn-id code, `/target`-by-tag semantics, the MA shape as
  a local draft; agent: the repeat-press guard, the pipe grammar with target name / spawn id, WPMA as the MA signal).
- **WPMA only** (the guild lead): *"WPMA is Wolf Pack Main Assist. if MA we can do that, but the in-game assist may look
  for someone names MA---- as their name"* — plain `MA` could match a player whose name starts with "Ma", so only
  `WPMA` counts as the main-assist tag.
- **Agent design (scoped):** a pipe press inside its own running timer is ignored when it lands earlier than 1.5 s
  before the timer's end (pipe latency cancels between presses; the server arms at reuse − 1 s); log-line starts
  always win; AA presses keep the previous press so a refused one cannot teach a too-short reuse. Grammar:
  `/pipe [cd ]<word> [<mob name>] [<spawn id>]`, longest known word first, a trailing integer is the spawn id only
  after a name. WPMA is kept by NAME in the agent (outside the 10-minute tag TTL and the zone wipe), newest wins, cleared
  by `clear` or after 6 h; the bot's `utils/mainAssist.js` gains a tag source beside the raid-chat declaration.
  ⚠ `docs/PRIVACY.md` never says that the structured tag extract (mob, tag text, tagger) uploads — fix it in this
  change, with the MA name and pipe-target timers.
- **Raid-leader handoff** (asked the same day): *"research if we could use a zeal command to give raid leader to
  someone as a guild officer, or if we have a password attached that the user sets for being able to have someone take
  raid lead"* — under research (client/server mechanics, Quarm's rules on automation, security of a shared password).
- **Zeal fork findings (2026-10-10, local draft `ma-draft` 2c9d691 on top of `test-all` 59bbfca, NOT pushed, not
  compiled):**
  - `%t` is the game's own code; Zeal runs its `percent_replacements` first (chat.cpp), and `/pipe`, `/log` and
    `/assist` all pass through it. The draft adds **`%tid`** (alias `%targetid`) = the target's spawn id, empty with
    no target. Multi-letter on purpose: Zeal's replace is a case-insensitive regex and native single-letter codes
    could not be enumerated here, so a clash would be silent.
  - Tag-based targeting today is `/tag target <text>`: exact, case-sensitive match on the tag's text fields, over
    visible NPCs and corpses within 250 units, nearest wins. ⚠ **A player cannot carry tag TEXT, only a shape**, so
    tagging yourself "WPMA" as text would not be targetable. The draft lets plain `/target <text>` try tags first
    (then falls back to the game's `/target`) and lets `/target ^MA^` match by SHAPE, which works on players.
  - ⚠ **`/tag chat clear` wipes ALL tags on every receiving client** — it is not a per-sender clear. It must not be
    part of the "take MA" sequence.
  - **Main-assist marker:** key `^MA^`, a target ring with four inward arrows (preview sent to the guild lead).
    Exclusive: a new `^MA^` clears the previous holder. Take MA: `/target <your name>` (or Target Self), then
    `/tag chat ^MA^`. Everyone else: `/target ^MA^`, then `/assist`. Older clients read `^MA^` as `^M` (the moon).
  - **Follow** needs no new code: `/tag chat ^PF^` on yourself (paw with an F); followers `/target ^PF^`, `/follow`.
  - Open: whether the key stays `^MA^` or becomes `^WPMA^` to match the guild's name; Mimic treats the marker holder
    as the WPMA main assist either way.
- **The handle is guild configuration** (the guild lead: *"the one for other guilds may be RaidMA or something else
  make it configuration but with the stipulation that nobody should have that name in the raid OR of there are any
  mobs that start with that phrase"*): `main_assist_tag` in `guild/config.json`, Wolf Pack `WPMA`. Because `/target`
  matches name prefixes, the value is rejected at config time if any NPC name or known character name starts with it,
  and Mimic warns at raid time if a raid member or a targeted mob does. Measured: `WPMA` / `RaidMA` match nothing;
  `MA` matches 171 NPC names and 295 players seen in `/who`. Rule + check list in `docs/DESIGN-guild-kit.md` §3.
- **Raid-leader handoff researched** (`/tmp` notes not kept; summary here):
  - Server (EQMacEmu): the make-leader button sends `OP_RaidInvite` action 20 and is honoured **only from the current
    leader** — no officer, GM or password path. When the leader camps, goes linkdead or leaves, leadership passes to
    the **first other member in the raid list** (only with 3+ remaining), not by rank.
  - Zeal already has `/raidpromote` (`/rp`, sends Quarm's `#raidpromote`; its README says raid leader, its changelog
    says group leader — unverified) and a password precedent, `/autoraidinvite <password>`, which invites on a matching
    tell. The Zeal pipe is output-only, so Mimic cannot send commands into the client.
  - Both proposed designs (an officer's message or a password making the leader's client promote someone) fail in the
    case that matters most — a linkdead or AFK leader can run nothing — and put secrets in chat logs. Quarm's posted
    rules (quarm.guide/about-project-quarm: "If you have to ask if you can do it or not, just don't do it"; "All forms of
    automation software are not allowed…") make acting on another player's message **not clearly allowed** — treat it
    as not allowed unless the Quarm team says otherwise in writing.
  - Options put to the guild lead: A no automation — keep an officer FIRST in the raid list so the server's own
    handoff lands on them (and/or promote at raid start); B a confirm-first prompt where a human presses a key;
    C a password auto-promote (copy of `/autoraidinvite`; rules risk). Recommended A.

## §225 — Raid lead: C (password auto-handoff) as a Zeal setting, B as the no-password fallback; `/pipe ARI` posts the invite password to Discord; marker key `^MA^` (2026-10-10)
*2026-10-10 · DECISIONS-2026-09-21.md · Raid lead handoff as Zeal setting*

**The calls** (the guild lead):
- *"/raidpromote makes someone a group leader presumably from unassigned making a new group in order from 1 to N where
  the first open group with no member is."* — so `#raidpromote` is a group-leader tool, not a raid-leader one.
- *"A is good to know, but we figure that out from Zeal pipes now too. update command center when raid lead changes."*
  — the raid leader is already visible from the Zeal pipe; the Command Center must update when it changes.
- *"B is good if there is a password and the person asking to take over raid lead doesn't have the password."* — the
  confirm-first prompt is the fallback for a request WITHOUT the password.
- *"C is ideal because we can set it to automatically take raid lead. this would be ideal to be able to set in our
  zeal in like we so with autojoining channels in eqclient.ini."* — the password auto-handoff, configured persistently
  in the Zeal ini like channel auto-join.
- *"may need to accept client only passwords and make sure it doesn't throw an error or crash anyone if the person
  receiving the request didn't have zeal or doesn't have it up to date OR neither person is a raid lead or officer or
  anything else."* — the password lives only on the leader's client (never uploaded); every failure path is silent
  and safe: no Zeal / old Zeal on either side, the receiver not raid leader, the sender not in the raid.
- *"marker should be MA"* — the main-assist tag key stays `^MA^`.
- *"a /pipe ARI should update something on our side in discord with/Ari and the Password given. it may not need to
  overwrite only the current ARI person and password if we're doing more than one raid for something.."* — the
  auto-invite (ARI) password goes to Discord so raiders can get invited, ONE ENTRY PER LEADER (several raids can run).
- *"ARI is cleared currently when you restart the client"* — ARI should persist across a client restart.
- ⚠ **Rules note (recorded, not overriding the call):** §224's research found Quarm's posted rules forbid automation
  and say "if you have to ask… don't". Zeal already ships `/autoraidinvite`, which acts on a tell the same way, so the
  auto-handoff sits in that existing precedent; the guild lead may still want a written OK from the Quarm team.
- **Status:** a Zeal fork draft (persisted ARI, escaped password match, `/autoraidlead`, pipe notices) and the
  Mimic/bot side (ARI card in Discord per leader, raid-leader change on the Command Center) are being drafted.
- **Drafted (2026-10-10):** Zeal local branch `raidlead-draft` b15b8a2 (on `ma-draft`; not compiled, not pushed):
  `AutoRaidInvite` / `AutoRaidLead` per character in zeal.ini, plain-string whole-message match (fixes the
  unescaped-regex bug), `/arl give`, a "raidlead" tell prompt, 10 s rate limit, pipe lines `ARI set|clear`,
  `ARL on|off`. The handoff sends `OP_RaidInvite` (0x425f) action 20 through Zeal's mapped `send_message`, with a
  `RaidGeneral_Struct` built from the server source — **must be proven in a two-person raid** before raid use. The raid
  leader was already on the type-5 pipe (rank "Raid Leader"). Bot/Mimic design: one ARI entry per leader in `bot_kv`
  (new `utils/ariBoard.js`, replacing the single state.json entry), one edited-in-place Discord message, 20-minute
  heartbeat, Mimic scrubs any non-on/off `ARL` pipe line to `ARL ***`.
- **"defaults"** (the guild lead) to the five open questions: a dedicated members-only thread for the ARI list;
  entries drop 4 h after the last heartbeat; officer-set and Mimic-set entries share one list; `/ari` shows the
  password to non-officers too; raid-lead changes show on the Command Center only (no Discord post).
- **Next asked:** suggestion-thread write-ups (what / why / how / how tested) and test cases for every Zeal change,
  and a referenceable showcase branch in the fork for preview images and posters.

## §226 — Zeal write-ups, test cases and a showcase branch; a banner on every Zeal PR; Burnouts cigarette and logo banners (2026-10-10)
*2026-10-10 · DECISIONS-2026-09-21.md · Zeal PR write-ups and test cases*

- **Asked** (the guild lead): *"start drafting overviews for each zeal PR update for me to post in zeal suggestions
  threads that read as what, why, how, and how tested. then write me the test cases and help me get this referenceable
  in a different fork version"*, then *"the banners are for all of the zeal PRs once they're filed"*.
- **Landed:** `docs/upstream/zeal-<change>/SUGGESTION.md` (≤350 words, banner on top) and `TEST-CASES.md` for 11
  changes; `docs/upstream/README.md` is the status index. The fork's **`showcase` branch** holds only docs: an index,
  one folder per change, and per change a 1200×675 poster and a 1280×320 PR header banner rendered from one JSON
  (`showcase/tools/render-posters.js`). **When a PR is filed:** set `pr_url` and `status` in its JSON, re-run the
  script, commit — the banner's pill and the index row follow. Spawn ids (upstream PR 229) checked merged 2026-09-01.
- **Burnouts icon** (the guild lead: *"a burning rolled cigarette instead of match"*) and **guild banners carry the
  guild's logo** in a colour contrast-checked against the flag (*"have the logo on them that contrasts well"*), with
  logo + name as a one-line switch (*"could we try putting the names on the flags also?"*). Local branch
  `guildicon-draft` `bbd5fe0`, not pushed, not compiled with MSVC. Open: the guild lead picks L (logo) or LN (logo +
  name); the website's banner PNGs change with it and go through beta.
- **Settled in review (same day):** names on the flags (LN) is the default, **full names for every guild** (*"keep
  full names"*, *"fix intervention with its whole name"*, *"full name for tranquillity"*), names may sit above and
  below the logo (Here There Be Monsters **stacked**: HERE / THERE, serpent, BE / MONSTERS; Mass Group Ego: MASS,
  mirror, GROUP / EGO). The wolf stays white with black details (*"needs to be closer to the white"*). **Banner logos
  use the guild icon's own colours** (*"missing colors from many of these on the inside, please consult the non-banner
  ones"*), with a thin dark or light rim only where the icon's colour fails 3:1 against the flag — **no backing disc**,
  Tranquility included. Commits `30606bc` (names, layouts, wolf) and `30a4eb2` (icon colours, rims) on
  `guildicon-draft`; Intervention as INTER- / VENTION (`d9dd631`); **Tranquility shows TRANQ** (the guild lead:
  *"make it TRANQ for tranquility"*, `dca0b85`). Website banners on beta: web 1.8.136 / 1.8.137.
- **Europa's picture file was too big for the fork's tag pictures (found 2026-10-10).** The `tag-icon-files` review
  fixes (`b20331f`) lowered Zeal's picture limit from 512 to 128 pixels a side, but the site kept offering a 226×256
  `EUR.png`/`EUR.tga` and still told guilds "512". In game that file is skipped with a chat note and the built-in
  Europa icon draws instead. Beta (web 1.8.137) ships a 113×128 copy and says 128. **Graduated to `main`** (the guild
  lead: *"send the Europa fix to main"*): web 1.8.138 `b8d08da3` — the 10-09 shield logo at 113×128, the 128 rule, a
  roadmap entry; beta bumped to the same 1.8.138 (`8aba1676`) first so the main→beta sync merges cleanly.
- **Zeal drafts pushed and in the test build** (the guild lead: *"push"*). `ma-draft` `206b884`, `raidlead-draft`
  `b15b8a2` and `guildicon-draft` `dca0b85` are on the fork; `raidlead-draft` and `guildicon-draft` each sit on
  `ma-draft`. `test-all` = previous `59bbfca` + both, merge `3c4766c` (CHANGELOG conflict: both sides kept); the GitHub
  Windows build passed, so `tag_arrows.cpp` compiles. Nothing run in game yet. ⚠ The test build's moon key is `^MEZ^`
  (`^M^` no longer draws it); the website's symbol list still says `^M^`, correct for official Zeal and the
  `tag-shapes` PR — decide which the site shows.
- **Guild flag key is `^F<code>^`, replacing `^B<code>^`** (the guild lead: *"maybe we should make it F<Guild
  acronym> for Flag"*, then *"instead of b for banner"*, and *"nobody has installed this but me, were safe to
  proceed"*). `^FWP^` = Wolf Pack's flag; `^F^` alone and `^Fire^` stay the flame (a guild key must name a real code);
  `^B` is the plain blue arrow again, so an old saved `^BWP^` tag now shows a blue arrow. A flag picture override is
  `FEUR.png`. Website: beta 1.8.139 (`5e8f67b9`) and `main` 1.8.139 (`2e68c737`) the same day — same version on both
  so the sync merges. Docs, posts, test cases and showcase changed in the same round; the fork's `tag-shapes`,
  `tag-icon-files`, `guildicon-draft` and `test-all` get the code change.
- **Welcome card "Set up parsing" refreshed** (the guild lead: *"this needs to be updated"*): bot 3.1.240 `98512340`.

## §227 — Test hotkeys write the evidence; every Zeal post carries PR + evidence lines; PoP flags export added (2026-10-10)
*2026-10-10 · DECISIONS-2026-09-21.md · Test hotkeys write evidence for Zeal posts*

- **In-game testing runs from socials, and the log is the evidence** (the guild lead: *"make me a config file of
  hotkeys … make them have the test numbers and also output the results so that I can just grab the log"*; then
  *"you can just have me join a channel"*, and *"/leave 1 5 times in a row to have everything go to channel 1"*).
  Each test button posts what to look for into a password channel (as `/1`), writes `[id] target=%t id=%tid` with
  `/log`, then runs the commands; PASS/FAIL are buttons 11/12 on every page. ⚠ A new character cannot talk in a
  custom channel ("not high enough level or high enough karma"), and the guild lead's real characters have no 7 free
  socials pages, so the default is now `/say` for the what-to-look-for line and `/log` for the target, PASS/FAIL and
  notes (`/log NOTE …`); `/log` works at any level. The channel flow stays as an option. 64 buttons on pages 4–10, every
  fork change plus PoP flags. Generated from one list: `showcase/tools/hotkey-tests.json` + `hotkey-socials.py` on the
  fork's `showcase` branch (`61f19c6`); `tools/evidence.py` turns the log into one EVIDENCE.md per change, replacing
  the tester's and any listed character names, and reports tests with no PASS/FAIL. The character-specific .ini and
  guide stay out of the repo.
- **Every suggestion post carries a "Pull request" and a "Testing evidence" line** (the guild lead: *"I'm going to make
  Zeal suggestion threads link to these PRS as well … I'll need to have the testing evidence"*). Placeholders until the
  PRs are filed and the run is done (`d206a452` here, `61f19c6` on the showcase). Guild emblems rides the tag-shapes
  PR and mez/slow rides the main-assist PR, and their posts say so.
- **PoP flags export on /camp** (the guild lead: *"add this in"*, with the suggestion thread 'Zeal "Export data on
  /camp" option to include a full #POPFLAGS output?'). New fork branch `popflags-export` (`195433e` + include fix
  `9b0186d`) on Zeal 1.4.8: with "Export data on /camp" on, camping sends `#popflags all` once, keeps 3 seconds of
  server-coloured reply lines and writes `<name>-PoPFlags.txt`; `/outputfile popflags [name]` does it on demand; one
  request per 10 seconds. Drafted by a Sonnet agent and reviewed here. The first `test-all` build (`ab95a91`) failed
  on a missing `callbacks.h` include; `test-all` is now `2c5e006`. Posts and showcase entry:
  `docs/upstream/zeal-popflags-export/`, `showcase/popflags-export/`.
- **First in-game run: `#popflags all` is staff-only; the export now sends the overview and tiers 1–5.** The guild lead's
  test file held one server line, "The all option is restricted to server staff." That proves the camp hook, the colour
  filter and the file write; the command was wrong. Quarm's `zone/gm_commands/popflags.cpp` (EQMacEmu, public) gives
  players `#popflags` = overview and `#popflags 1`–`5` = each tier; `all` needs admin 80. Every reply line is White,
  Lime, Yellow or Red, all kept by the filter. Fork `ef17b00`: six commands one second apart (all scheduled up front,
  none from inside a delayed callback), file written 3 s after the last, the chat timestamp the run showed on each
  line removed, 15 s between requests. `test-all` `67bea01`. The test character is new, so its
  `<Char>_pq.proj.ini` has no `[Socials]` section yet; the hotkey guide now says to paste the whole file, header
  included, in that case (the format matches existing characters' `PageNButtonM…` socials).
- **Second run: the camp export spammed the chat** (the guild lead: *"the popflag spam on camp is noticeable"*). Each
  section printed several times (Tier 4 ×3, Plane of Time ×10). Cause: Zeal's `CallbackManager::invoke_delayed`
  (`callbacks.cpp:142-149`) fires a callback when `now >= time` but erases it only when `now > time`, and
  `GetTickCount64` moves in 10–16 ms steps, so a delayed callback runs on every frame inside that step. Fix on our side
  (popflags `b27bb26`, test-all `593f848`): each send checks its turn and runs once; captured reply lines are cleared
  from the chat output (the same `msg = ""` suppression nameplate.cpp uses), so they reach the file only; only the four
  reply colours are taken; sends are 250 ms apart with a 1.5 s tail. ⚠ The `invoke_delayed` bug is upstream and
  affects any feature that schedules with `AddDelayed`; a one-character fix (erase with `>=`) would make a small,
  separate upstream PR — not bundled into ours.
- **Guild marks include /roleplay players** (the guild lead: *"Roleplaying toons still expose their guild, so they
  should be included"*). Only `/anon` (`AnonymousState == 1`) is skipped now, matching Zeal's own `show_guild` check.
  tag-shapes `4447114` (amended), merged down to tag-icon-files `ddde80a`, guildicon-draft `605ef22`, test-all
  `99c7345`.

## §228 — The upstream Zeal bar for our PRs: small, modular, off with no cost, existing behaviour untouched (2026-10-10)
*2026-10-10 · DECISIONS-2026-09-21.md · Upstream bar: small modular off-by-default PRs*

- **What the upstream maintainer wants** (relayed by the guild lead, 2026-10-10): *"Preferably your PRs are modular and
  easy to disable w/out any performance impact (or just small and easy to see they are safe / do not break existing
  behavior)."* The same note called another contributor's open PRs "minor examples of where the LLM generated code
  gets clumsy / bloated / repetitive and makes the existing code/functionality harder to maintain."
- **What that slop looked like** (the guild lead asked us to comb upstream #245 and #236; two Sonnet reviews,
  verified here against the diffs and 1.4.8):
  - **#245, tick bar:** the render code reaches into the wrong layer and runs for every nameplate string. It has
    dead plumbing (`is_self` set, never read), unused locals, tick math copied from `tick.cpp`, and a latent D3D8
    bug (`DrawPrimitiveUP` resets stream 0 inside the font loop).
  - **#236, spell effects:** a wrong prefix length drops persisted `replace-classic` entries, and a 256-character
    single ini value truncates. It also leaves debug `print_chat` in sync loops, a mutex that guards nothing, one
    switch pasted three times, and nine commits including fixups.
  - The full notes are a scratchpad deliverable, not committed: they review someone else's work, so the guild lead
    decides whether to share them.
- **Our checklist before filing a fork PR** (applies to every branch in §226/§227):
  1. One squashed commit.
  2. One setting turns it off, and with it off the hot paths do zero extra work: no per-frame lookups, no
     allocations.
  3. Nothing changes for players who never touch the feature.
  4. No dead code, debug output or review-chatter comments.
  5. No copied helpers; reuse Zeal's own.
  6. clang-format clean.
  7. A README that matches the actual commands.
- **Size check (code under `Zeal/`, vs each branch's base):**

  | Branch | Lines added | Commits | Files | Notes |
  |---|---|---|---|---|
  | spell-id-tooltip | +28 | 2 | | squash to one when filing (§229) |
  | tag-corpses | +29 | 1 | | |
  | popflags-export | +121 | 3 | | |
  | hide-ui-cursor | +194 | 1 | | |
  | raidlead-draft | +223 | 1 | | |
  | tag-persistence | +291 | 3 | | |
  | tag-icon-files | +354 | 4 | | |
  | guildicon-draft | +454 | 10 | | |
  | ma-draft | +1175 | 41 | 75 | |
  | tag-shapes | +1964 | 3 | | mostly geometry tables |

  The last two fail "small" on their face and need splitting or slimming before they go up.

## §229 — Zeal: the spell id in spell info windows (`/spellid`), built to the §228 bar (2026-10-10)
*2026-10-10 · DECISIONS-2026-09-21.md · Spell id in spell tooltips*

- **The ask** (the guild lead): *"add in a bit for zeal to include the spell ID in a spell's tooltip to make it easier
  to block"*. Blocking a buff (and our `#blockbuff` picker, §157) works by id, and the client never shows one.
- **What shipped:** fork branch `spell-id-tooltip` (`0a57fba` + README wording `67cb705`; squash to one commit when
  filing), on Zeal `main` 1.4.8. `/spellid [on|off]` (bare toggles) adds `Spell ID: <id>` as the last line of the spell
  info window. One `ZealSetting` (`[Zeal] ShowSpellId`, **off by default**) and one helper appended in
  `UpdateSetSpellText`, on both the enhanced and the stock path; nothing per frame. +32/−1 across `item_display.cpp`,
  `item_display.h`, README. clang-format clean on every changed line (the file's two existing diffs are upstream's).
- **Where it shows:** every window that goes through `CItemDisplayWnd::SetSpell` — the buff window, spell gems, the
  spellbook. **Not** item windows (a scroll in your bags, an item's click effect): those go through `SetItem`. The
  first README said "scrolls"; corrected before it was filed.
- **Built:** merged into `test-all` `035d8a3`; GitHub build passed, release `test-all (035d8a3)`. Not run in game.
- **Docs:** `docs/upstream/zeal-spell-id-tooltip/` (post + 13 test cases), the fork's `showcase` branch
  (`3e115b6`: poster, banner, index row), hotkey tests `SI1`–`SI3` (page 10, buttons 4–6).
- **Not done, on purpose:** the item-window path (a scroll's or click effect's spell id). It is a second hook in a
  different function; add it only if blocking needs it.

## §230 — Other guilds' logos become Zeal tag pictures, shipped with the fork's Zeal build (2026-10-10)
*2026-10-10 · DECISIONS-2026-09-21.md · Guild logos become Zeal tag pictures*

- **The ask** (the guild lead): 17 guild logos collected from their Discord servers, *"capture and queue for cutting"*,
  then *"cut them into icons and banners"*, then *"these are for zeal"*.
- **Cut:** 16 guilds (Loot & Some Fun sent two logos), each an icon `<CODE>.png` (`^I<CODE>^`; Continuum as
  `ICON.png`, since Windows reserves `CON`) and a 128x64 banner `F<CODE>.png` (`^F<CODE>^`). The banner is the
  guild's own name-bearing logo where the art has one, else the icon beside the name in a colour from the logo.
  All within Zeal's limits (128 px a side, 2:1, 1 MB). Reproducible: `docs/upstream/zeal-guild-icon-refresh/intake/`
  (`cutlib.py`, one `recipes_*.py` per group, sources, `cut/`, `QUEUE.md`). First drafts by three Sonnet agents, each
  preview reviewed here.
- **Shipped in Zeal, not the website:** fork branch `guild-tagicons` (`ad52240`, data only, on `tag-icon-files`, so
  that branch's upstream PR stays code), merged into `test-all` `e1fde3d` with Europa's picture. Anyone on that build
  sees them; a player's own picture in `tagicons\custom` still wins; official Zeal shows the built-in shape. The
  merge kept test-all's tagicons README and fixed two lines in it: the size limit (128, not 512) and the 160 px
  templates, which must be scaled down to load.
- **Not done:** the wolfpack.quest gallery does not list them (its test wants each file named exactly the guild
  code, which `F<CODE>` and `ICON` are not). Weak spots: Intervention and Tranquility came from small sources; the
  Novae, Zek, Continuum and Tranquility banner names are small; the Eclipse corona has a hard left edge.

## §235 — Zeal fork: tag-persistence squashed; the popflags commands no longer show in chat on camp (2026-10-11)
*2026-10-11 · DECISIONS-2026-09-21.md · Zeal tag persistence squashed, quieter commands*

- **Squash** (the guild lead: *"go ahead and squash these into persistence"*): `tag-persistence` is now ONE
  commit, `7bacdd3`, on v1.4.8. It has the same tree as the old tip `6ab82a9` (checked with `git diff`), and the
  message carries the Safety bullets. Force-pushed with a lease on the old tip. Both PR descriptions are
  paste-ready in `docs/upstream/zeal-tag-persistence/PULL-REQUEST.md` and `docs/upstream/zeal-tag-corpses/`
  (the corpses one uses upstream's own tag keys).
- **Popflags echo** (the guild lead, with a screenshot: *"On camp we see these commands"*): all six `#popflags`
  sends showed as say lines (`[S] [Name]: #popflags 3`, abbreviated chat), although `do_say(true, …)` hides the
  local echo. While a request is pending, `popflags_capture` now also clears any non-server-colour line containing
  `#popflags`, and stores nothing from it. `popflags-export` `80a8de9`, merged into `test-all` `75e85e4`.
  Not yet seen in game: the next camp should show no `#popflags` lines.
- **Not settled:** why the hidden say still comes back. Either the server echoes the say to the speaker, or the
  echo patch misses this path. The fix works either way. Other hidden `#` commands (for example `#showhelm`) may
  show the same echo; nobody has reported it.

## §243 — Target position past 250: removed in the test build, a raised limit asked upstream (2026-10-12)
*2026-10-12 · DECISIONS-2026-09-21.md · Target range cap removed, upstream ask*

- **Ask** (the guild lead): *"remove the 250 hard cap on range - it should be longer because certain spells and range
  attacks can be longer like 500"*, then *"Grab me a list of the spells and ranged attacks above 250 range for an
  upstream request, but remove it for beta so i can see the line beyond 250"*.
- **Where the cap lives:** Zeal itself, not us. Zeal 1.4.8's pipe sends `target_loc` only within 250 units
  (`named_pipe.cpp`, added with upstream #239 as a server-policy limit). The Map overlay draws whatever arrives.
- **Test build only:** fork branch `target-loc-range` (`f987701`) drops the check, marked in the source as never for
  upstream; merged into `test-all` (`5bcd34a`, which also carries the `/pipedelay` print fix `53befe7`). Live players on
  release Zeal still stop at 250.
- **Upstream ask: raise to ~450, not remove** — `docs/upstream/zeal-target-loc-range/SUGGESTION.md`. Evidence from the
  2026-09-27 Quarm dump: archery is bow + arrow range (82 bows reach 251–300 and 66 reach 301–400 with a 150 arrow,
  the best 400–420); the Wizard and Magician bolt line is 300; Flare 400, Fade 350; crowd control is 200 and unaffected.
  Long-range utility (Summon Corpse, Call of the Hero, Yonder) is deliberately left out of the ask. Not filed.

## §390 — Zeal / UI release picker is a watch list (2026-10-20)
*2026-10-20 · DECISIONS-2026-09-21.md · Zeal and UI release picker watch list*

- **A, watch list.** Not built.
- **Guard to ship first:** a Zeal zip can overwrite `uifiles/default` today. `/loadskin` vs `/load` wording is
  unverified in game, so no copy should assert either.
- **Next:** the guard, then the picker (Open table).

## §454 — Zeal PRs: 253 and 254 filed; 253 reworked to show the reply by default (2026-10-27)
*2026-10-27 · DECISIONS-2026-09-21.md · Upstream Zeal PRs 253 and 254*

The guild lead filed upstream PR 253 (PoP flags on `/camp`) and PR 254 (`/pipedelay` printed 0), then asked for another slop check
against the maintainer's bar plus a ponytail review, and picked **1B, 2B, 3A**, then *"Popflags showing in chat should be an option
actually"*.
- **PR 253** (`pr/popflags-export`, now `d36a336`, one commit on upstream `d88b691`, force-updated in place). The earlier capture cleared
  every server-colour line for ~3 s after camping, so an unrelated system message could be lost. Now the reply shows in chat by
  default and `/outputfile hidepopflags` (setting `PopFlagsHide`, off) hides only the reply's lines and the command echo. Capture and
  hiding take only reply-shaped lines: `===` / `---` headers, `Label: value` lines, and yellow hints once a header has arrived (every
  message in the server's `popflags.cpp` @ `11024c19` checked; the yellow Seer / Maelin / Miak hints were missed by the first draft of
  the fix). Still tied to "Export data on /camp" (2B). No CHANGELOG edit. The agent's file reader and the paste parser already handle
  the hint lines. `d36a336` itself is untested in game.
- **PR 254**: passed the check, left as filed.
- **Tags (3A)**: two small PRs instead of one: the name-match fix alone, and persistence + corpses with persistence default OFF, no
  shapes, no CHANGELOG. Shapes stay off upstream (meshes built for every font user, a per-frame guild loop, the guild roster, the wolf
  mesh).
- Reviews of the other open upstream PRs 249 and 251 (both auto-regroup of returning raid members; 251 is the maintainer's own) are
  ready to paste; 252 (melody item clicks) is unchanged since its review.

## §455 — Wolf Pack Zeal: one suggested Zeal, rebuilt from the latest official release (2026-10-27)
*2026-10-27 · DECISIONS-2026-09-21.md · Wolf Pack Zeal built from latest release*

The guild lead: *"let's make a consistent Wolfpack zeal version that we can suggest to our raiders. always rebuilt from
the latest releases that are approved. we will need to bring forward the Coastalredwood changes as they come through."*
- **Base = the latest upstream RELEASE**, not upstream `main` (a release is what the maintainer signed off). Our additions
  are cherry-picked onto it from `wolfpack/approved.txt` on the fork's `main`, **pinned by commit sha**, so a later push
  to a branch never ships untested code. Upstream changes come forward by themselves: the daily run (09:41 UTC) takes a
  new release as the base; an addition upstream already shipped, or one that conflicts, fails the run loudly and the
  last build stays up.
- First build `wolfpack-1-6a3ee20` (run 40601028907): 1.4.8 + PR 253 (`d36a336`), PR 254, the tag name check, tag
  persistence (default off) + corpses. All four picked cleanly onto 1.4.8. ⚠ The last two and `d36a336` itself have
  not been run in game; the session's call to include them as the starting list, since the guild lead tested the
  older versions — remove a line if that is too early.
- **One rolling prerelease** (`wolfpack-beta`, never "latest"); the build labels itself `wolfpack-<run>-<hash>` so crash
  reports and screenshots tell it apart. MIT licence: the zip carries `LICENSE` plus a readme saying it is unofficial
  and to report problems to us, not upstream.
- **Mimic**: Settings → Zeal → "Wolf Pack" (beta, agent 4.0.32, `56b30547`); crash card labels it "🐺 Wolf Pack Zeal".
- Open: a stable channel (promote a beta that has raided); asking Quarm staff; telling the Zeal maintainer. Runbook
  `docs/upstream/WOLFPACK-ZEAL.md`.
