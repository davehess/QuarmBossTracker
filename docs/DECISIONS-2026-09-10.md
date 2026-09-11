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

## Open — read this first

| Item | Where it stands | Next |
|---|---|---|
| Mimic mini mode — every overlay in a less-tall version, right-click ▭ toggle, per-overlay 📌 lock, Minimize-all hotkey (Ctrl+Shift+M) | **guild vote page LIVE on `main` 2026-09-11 — `wolfpack.quest/mimic/mini` (web 1.7.31); reviewed on beta first, graduated so nobody re-signs-in; the guild gets the link today.** Ballot lists only people who have picked; the three minis sit side by side with their descriptions collapsed underneath, opened by your pick (Hitya 2026-09-11). Full mode left, THREE options right (a third was added to every overlay), vote + persistent feedback per overlay, animated mocks with real raiders, Zeal 1.4.6 vs older-Zeal toggle. DS box on the Tank mini = damage returned PER HIT, not the running total (Hitya 2026-09-11). Rampage tank on the Tank mocks is Ashieron, a paladin — warriors do not go DA (Hitya 2026-09-11). Copy button shrinks to tab size, copied line carries `\| local` / `\| merged` (parser tolerance must be checked first); Target-info resists show current-after-debuffs over full | Hitya notifies the guild; watch the votes + feedback (`overlay_design_votes` / `_feedback`); re-park beta at 2.6.8 (page is on main now, nothing to carry); build nothing in Mimic until the picks land |
| Quiet mode split — mute vs hide overlays | **on `beta` 2026-09-11 (agent 3.6.39, 2.6.8-beta.2).** Quiet mode = mute only; new "Don't show any overlays" switch owns visibility; Setup row follows it | beta testers confirm voice stops with Mute on and overlays stay; graduate with the next stable |
| Mimic-wide audit of raw `try/catch` error text + a way to submit errors to Hitya | **requested 2026-09-10, NOT started.** The Zeal-install `EPERM` is one instance, now fixed; Hitya wants every surface swept and a submit path | scope it as its own pass — inventory the catch sites first, then decide the submit channel (the `feedback` table + `/api/agent/feedback-send` already exist and could carry it) |
| Zeal spawn id: Mimic should null a pipe `target_id` of 0 at the edge | open — bot guards it (3.1.123), `apps/mimic/main.js` still trusts `Number.isFinite(0)`, and its comment claiming the pipe OMITS the field is wrong | beta, alongside the agent's `_provableTargetId` |
| Spawn-id adoption is ~half the fleet | open — 11 of 19 on 2026-09-10; poster built to push it | share `zeal-update-why.png`; re-measure the blind % in a week |
| 🎲 rolled-loot card is still ONE event per refresh | open (2026-09-07) | per-event cards filtered by `looted_items.zone` |
| Sequential-kill splitter splits one fight in two | open — one-line RPC fix diagnosed + tested, NOT applied, Hitya's call | plus two duplicate rows from 09-06, untouched (merging is destructive) |
| Loot bidding: update / remove a bid | open — options A/B/C presented, awaiting pick | first live cancel on a low-stakes bid |
| Ashieron: "Mimic takes my internet down" | investigated 2026-09-07; `scripts/mimic-netdiag.ps1` collects the evidence and NOW ACTUALLY PARSES (see above) | he runs `-Watch` while playing, `-Live` when it breaks |
| P40 / local model | open — assessment given 2026-09-07 | Tower has no free x16 |
