# Decisions — 2026-09-10

## Zeal 1.4.6 ships the spawn id, and it changes a CLAUDE.md scope boundary

Hitya: *"zeal 1.4.6 was released so spawn ID is now exposed for anyone that's on
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

## The Setup checklist now says WHICH wall you hit (agent 3.6.35, beta)

Two members lost an evening to the same page. Abrahms/AirborneSapper had Zeal
installed and a dead feed; the checklist said *"install/enable Zeal"* regardless
of what was on disk, so he clicked **Check / install Zeal** — which failed with a
raw `EPERM: operation not permitted, copyfile …` because his EQ lives in
`C:\Program Files (x86)\TAKP`. He posted it to Discord asking what the red
gobbledygook was. Two separate walls; the checklist pointed at neither.

- `/api/state.eqFolder` now carries `zealInstalled` and `writable` (both
  tri-state) — see the HOW-ITS-BUILT entry for the shape.
- ⚠ **The write test is a probe write, never `fs.accessSync(W_OK)`.** On Windows
  Node's `access()` reflects the read-only attribute, not the ACL. I said
  "one-line accessSync" in chat first; it would have passed on Program Files and
  shipped the bug with a green test. A test asserts the probe directly.
- The install handler translates a permission denial into the three real fixes
  and keeps the errno for support.

**Root cause of the dead feed was the elevation mismatch, now n=2** (Jankzer
2026-07-05, Abrahms 2026-09-10) — and it takes the OVERLAYS with it, which we
had never written down. All three of his symptoms (no Zeal, no overlays, EPERM
install) cleared the moment Mimic ran as admin. His own words, recorded in
`zealPipe.js` because they narrow it further than anything we had: *"I can get
em all up when doing the placement mode. and moving/resizing. even the hotkey
flip them from on to hidden. but nothing ever makes it to my screen."* The
windows exist and respond; they are never composited over the game.

⚠ **Sequencing trap for anyone advising this member:** "don't run either as
admin" is right in general and will break him, because his EQ is under Program
Files. Move the EQ folder out FIRST, then drop admin from both.

## I pushed main CI red on 2026-09-08 and did not notice

`scripts/mimic-netdiag.ps1` was committed BOM-less with em-dashes, arrows and
box-drawing. `test/powershell-ascii.test.js` has existed since 2026-08-13 and
failed from that commit until 2026-09-10. I ran the targeted tests for that
change and not the full suite.

It was not only a red test: Windows PowerShell 5.1 decodes a `.ps1` with the
system ANSI codepage unless the file opens with a UTF-8 BOM, so the script
handed to a member would not have parsed at all. Fixed with a BOM (matching
`install-node.ps1` / `start-logsync.ps1`); the `.bat` is now pure ASCII.

**Run the full suite before pushing, not the targeted file.** The repo already
had the guard; I just did not consult it.

## The Tank mini's damage-shield box is PER HIT (Hitya, 2026-09-11)

*"The Damage shield component should be the sum of damage per hit, not the
total from all the times being hit."* The spiky box on the Tank mini shows
what ONE hit returns — the sum of the tank's active damage-shield buffs
(Shield of Blades 65 + Barrier of Combustion 20 → `85/hit`) — pops on each
hit, and changes only when a DS lands or fades. Today's full overlay keeps
its running-total line; the two are now computed from the same per-hit
figure. Landed on `beta` (ea2893c9) in the vote page's mocks and option
text; it is the spec for the Mimic build once a Tank option is picked.

## The 2.6.7 stable went out Friday morning, not at 00:35

The post-raid push trigger was created Thursday 21:07 ET with `run_once_at`
a day late (2026-09-12T04:35Z instead of 09-11). Nothing fired at 00:35 ET;
noticed at 06:55 ET when a beta push showed the clock. Pushed the held batch
by hand (Friday is not a raid night) and deleted the trigger. Lesson: after
creating a one-shot trigger, read `next_run_at` back in ET before trusting
it — the tool echoes it.

## The v2.6.7 release body is the wrong commit (2026-09-11)

`release-mimic.yml` takes the release body from the commit at the TIP of the
push. The stable cut (`a5017b1f`, with its member-facing bullets) went up
with four commits above it, so the published body is the docs commit about
the mis-dated trigger, and the #mimic-releases announcer reposted it. The
installer and tag are correct; only the text is wrong. Repair: edit the
v2.6.7 release on GitHub and paste the bullets from the roadmap entry
("Puts the Setup buttons back" + the quiet-mode line) — Hitya's action, no
tool here can edit a release. Rule added to CLAUDE.md: the version-bump
commit is the tip of its own push, or the tip carries `<!--player-notes-->`.

## Quiet mode is now a mute; hiding overlays is its own switch (Hitya, 2026-09-11)

*"Quiet mode should separate between muted and not seeing overlays at all.
Two options, and the current mode should just mute."* Landed on `beta`
(0cd30781, agent 3.6.39, builds 2.6.8-beta.2):
- `cfg.quietMode` keeps its key and now means MUTE — no voice callouts, no
  sounds, overlays unchanged. Until today it hid every overlay and silenced
  nothing (callouts speak from the hidden trigger window), so the old label
  "hide HUD + TTS" was wrong both ways.
- `cfg.hideOverlays` (new, default off) is "Don't show any overlays" — the
  EQLogParser / other-parser case. It owns every visibility gate,
  `_overlayWanted`, the tray enables and the tooltip. Uploads and voice are
  unaffected.
- Mute reaches renderers as one boolean (`wp-mute`, broadcast on every
  save-config, read once at load) and is checked in the three places that
  make noise: triggers.html (speak + sound files), chchain.html, charm.html.
- No migration: someone who had Quiet mode on gets their overlays back and
  goes silent, which is what "the current mode should just mute" asks for.
- The vote page also lets people remove a pick (web 1.7.34).

## The relay scope gate never worked, and now fails closed outside a raid (Hitya, 2026-09-11)

Hitya, alone on Canopy in Vex Thal, kept getting "Shaman Slow" callouts:
*"I'm not in a zone with another guild member, or in a group, or even a raid.
These random slips need to stop."* The fires were Lucker's — Turgur's Insects
landing on Ssraeshza Temple trash every 30–60s from 13:49 UTC — relayed to
everyone. The 3.1.111 gate resolved the sender's zone from `payload.character`,
which no agent sends, so the origin was always null and the fail-open branch
passed every fire since it shipped. The fleet-wide "works the moment the bot
deploys" design was right; the field it read was wrong.

Bot 3.1.125: origin zones come from the uploading ACCOUNT (`_requesterZones`
on the sender too), "in a raid" also means "this listener uploaded a raid
roster in the last 10 min" (off-schedule raids stay raid-wide), and outside a
raid an unplaceable sender or listener is NOT local — dropped. The
`test/relay-scope-gate.test.js` fail-open pins were rewritten on purpose.
Follow-up for beta: the Recent-fires card labels relayed fires "guild", same
as local ones, which is why this took a code read to diagnose — show "relay".

## Lord Mobsincamp — the assistant is named, configurable, and designed (Hitya, 2026-09-12)

Hitya: *"could we hook up a local LLM agent that would be exposed to our members
as the search element and run off of the larger local database copy? if we
experience issues to our supabase hosted database could we fail back to the
copy on tower and offload? I'd like to name it Lord Mobsincamp and have that be
a configurable name in the setup."*

Decided: the name is **Lord Mobsincamp**, carried as `ASSISTANT_NAME` (default
that value; the self-host wizard asks for it). Design + assessment in
`docs/DESIGN-lord-mobsincamp.md`: model on Tower (P40, 14B tool-caller), a
read-only allowlisted tool service over the archive (no free SQL, site scopes
enforced, every Q&A logged), reached through a broker via the bot so Tower
stays unexposed; the site's search box gains an "Ask" mode. Honest failover:
READS can fail over to Tower (with a staleness banner), WRITES queue at the
agents and must not; auth is the wall (local JWT verification first). Offload of
heavy reads to Tower is the part that pays. The enabler for both freshness and
failover is a live logical replica, which needs the Supabase IPv4 add-on.

## Zeal 1.4.7 review: Target of Target is client-side only, not on the pipe (2026-09-12)

Hitya asked for a review of Larcen22's PR #228 ("Target of Target Assistbar",
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

## Open — read this first

| Item | Where it stands | Next |
|---|---|---|
| Mimic mini mode — every overlay in a less-tall version, right-click ▭ toggle, per-overlay 📌 lock, Minimize-all hotkey (Ctrl+Shift+M) | **guild vote page LIVE on `main` 2026-09-11 — `wolfpack.quest/mimic/mini` (web 1.7.31); reviewed on beta first, graduated so nobody re-signs-in; the guild gets the link today.** Ballot lists only people who have picked; the three minis sit side by side with their descriptions collapsed underneath, opened by your pick (Hitya 2026-09-11). Full mode left, THREE options right (a third was added to every overlay), vote + persistent feedback per overlay, animated mocks with real raiders, Zeal 1.4.6 vs older-Zeal toggle. DS box on the Tank mini = damage returned PER HIT, not the running total (Hitya 2026-09-11). Rampage tank on the Tank mocks is Ashieron, a paladin — warriors do not go DA (Hitya 2026-09-11). Copy button shrinks to tab size, copied line carries `\| local` / `\| merged` (parser tolerance must be checked first); Target-info resists show current-after-debuffs over full | Hitya notifies the guild; watch the votes + feedback (`overlay_design_votes` / `_feedback`); re-park beta at 2.6.8 (page is on main now, nothing to carry); build nothing in Mimic until the picks land |
| Lord Mobsincamp — local assistant as the members' search | **designed 2026-09-12** (`docs/DESIGN-lord-mobsincamp.md`); name decided + configurable (`ASSISTANT_NAME`); nothing built | Hitya's four calls (§9): broker vs tunnel; IPv4 add-on for a live replica; hosted-model bridge / fallback; accept the desktop (where the P40 actually is, 2026-09-12 — not Tower) as the model host, up when that PC is. Then Phase 0 = tool service + site UI |
| Zeal: put Target of Target on the pipe | **patch drafted 2026-09-12** (`docs/zeal-tot-pipe.patch`, applies to v1.4.7, NOT compiled here; PR text in `docs/zeal-tot-pipe-request.md`). **Consumer side LIVE on `beta` (agent 3.6.40, 2.6.8-beta.3):** Mimic sanitizes the two keys, the agent folds the answer into `observed_tanks` (raid-wide via the bot's #194 clustering) and patches the Extended Target row that is my own target (`mob_victim_source`, `mob_hit_by`), the overlay marks 🎯 / → / ⚔ | Hitya builds the Zeal patch locally and opens the PR; nothing shows until a Zeal that carries it is released. Bot follow-up (main): store `target_of_target` / `target_hit_by` on `character_live_state` and prefer authoritative connects in the clustering |
| Quiet mode split — mute vs hide overlays | **on `beta` 2026-09-11 (agent 3.6.39, 2.6.8-beta.2).** Quiet mode = mute only; new "Don't show any overlays" switch owns visibility; Setup row follows it | beta testers confirm voice stops with Mute on and overlays stay; graduate with the next stable |
| Recent-fires card cannot tell a relayed fire from a local one | open — `dashboard.html` collapses `guild_relay` into "guild" (line ~2973); it hid which side the Shaman Slow leak was on | beta, agent bump: label relays "relay · from <name>" |
| Mimic-wide audit of raw `try/catch` error text + a way to submit errors to Hitya | **requested 2026-09-10, NOT started.** The Zeal-install `EPERM` is one instance, now fixed; Hitya wants every surface swept and a submit path | scope it as its own pass — inventory the catch sites first, then decide the submit channel (the `feedback` table + `/api/agent/feedback-send` already exist and could carry it) |
| Zeal spawn id: Mimic should null a pipe `target_id` of 0 at the edge | **done on `beta` 2026-09-12** — `_pipeSpawnId` in `apps/mimic/main.js` nulls 0 / non-numbers for spawn, target and pet ids (agent 3.6.40); the bot guard (3.1.123) stays for older Mimics | the agent's `_provableTargetId` still trusts a finite 0 from a pre-3.6.40 Mimic — tighten when convenient |
| Spawn-id adoption is ~half the fleet | open — 11 of 19 on 2026-09-10; poster built to push it | share `zeal-update-why.png`; re-measure the blind % in a week |
| 🎲 rolled-loot card is still ONE event per refresh | open (2026-09-07) | per-event cards filtered by `looted_items.zone` |
| Sequential-kill splitter splits one fight in two | open — one-line RPC fix diagnosed + tested, NOT applied, Hitya's call | plus two duplicate rows from 09-06, untouched (merging is destructive) |
| Loot bidding: update / remove a bid | open — options A/B/C presented, awaiting pick | first live cancel on a low-stakes bid |
| Ashieron: "Mimic takes my internet down" | investigated 2026-09-07; `scripts/mimic-netdiag.ps1` collects the evidence and NOW ACTUALLY PARSES (see above) | he runs `-Watch` while playing, `-Live` when it breaks |
| P40 / local model | superseded 2026-09-12 by the Lord Mobsincamp design above; the card is in the Canopy desktop, not Tower, and stays there — no slot swap | see that row |
