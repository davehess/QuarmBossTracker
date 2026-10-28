# Mimic app & releases

The desktop app: install, update channels, tray, settings, stable cuts. Oldest first. Find an entry by its ID in [the index](README.md); new decisions go in `inbox/` and are merged here.

## 2026-08-10/20 — Crash review: consent in Mimic, dumps stay local (guild lead, 2026-08-12)
*2026-08-10 · DECISIONS-2026-08-10.md · Crash reports need in-app consent; dumps stay local*

Prompted by a member crashing twice while zoning. Three findings, in order of
usefulness.

**His crash was never captured.** Crash upload is gated on
`WOLFPACK_CRASH_REPORTS=1`, an environment variable — which is why 393 stored
reports come from exactly two uploaders. The data layer has been right all along
(Zeal writes the zip, the agent uploads only parsed fields, the minidump never
leaves the machine); what is missing is any way for a normal user to say yes.

**A parser bug had been silently eating the most valuable reports.**
`/Character:\s*(.+)/i` — `\s` matches newlines, so a BLANK `Character:` field
swallowed the line break and captured the following line; 55 rows carried
`character = 'UI Skin: UIFiles\NillipussUI_1080p\'`. `Character` is blank exactly
when the client crashes WHILE ZONING, so the reports we most wanted to attribute
were the unattributable ones. Fixed in agent 3.5.65 (all fields line-anchored,
horizontal whitespace only, empty means null), 10 tests, and the 55 rows repaired
in place. The same fix replaced `path.basename` with a split on both separators,
because on the Linux/Deck build POSIX basename would return a whole Windows path
and silently split one crash signature into two.

**There is a real signal in the corpus:** `0x6ef @ kernelbase.dll +9f54` went
from 1 crash in July to 28 in August on an unchanged Zeal 1.4.2. Worth chasing —
but with two uploaders it describes one machine, which is the whole argument for
the consent prompt.

Design recorded in `docs/DESIGN-crash-review.md`: Mimic detects the crash (EQ
gone + a new zip), offers to review THIS one, and separately offers a standing
preference that defaults off and is revocable in Settings. Review means telling
the USER what happened — module, exception, zone, and "this matches N others" —
not just shipping telemetry upward. Local-only review works with no upload at
all. Dumps are never uploaded; that is a storage decision as much as a privacy
one, and it is recorded in the self-host wizard planning.

## 2026-08-19/1 — Tray ↔ dashboard parity is now a RULE (the guild lead)
*2026-08-19 · DECISIONS-2026-08-19.md · Tray features must also exist on dashboard*

**The call:** *"Anything that's available from the taskbar should be available
from the dashboard as well."* Named instance in the same breath: *"Overlay
layouts should be saves and in the overlay tab."*

**Why:** the tray menu is where features go to be forgotten — the per-character
layout saves existed since v1.2 and the guild lead met them tonight. The dashboard
Overlays tab is where people actually look.

**Where it landed (agent 3.5.91 + mimic, beta):** 💾 Per-character overlay
layouts card (auto-swap toggle, save-for-active-toon, saved chips with forget
✕), Lock/Unlock + Setup-mode + Hide-all buttons on the actions row, and a Dock
row in BUILT-IN OVERLAYS (Guild lead: "Dock isn't available from the built in
overlays page"). All drive the SAME internals as the tray items — never a
parallel path. **Remaining tray-only items are a queued audit** (STATUS):
quiet mode, tells mode + DM pause, melody bard-only / AE-damage toggles,
auto-arrange-on-show, start-with-Windows, check-for-updates.

## 2026-08-19/2 — Release name: smoOOTH SCAlers (the guild lead) — GRADUATED to stable same day
*2026-08-19 · DECISIONS-2026-08-19.md · Release named and graduated to stable*

The guild lead named the line and its rendering: *"Smoooth Scalers where it starts
with small letters, goes to large in the middle, then small at the end."*
Text surfaces render the size wave as a case-wave — **smoOOTH SCAlers** —
which survives Discord, GitHub, and the roadmap identically. Cut to stable
as **Mimic 2.5.4 (agent 3.5.91)** on 2026-08-19 — file-level promotion of
`apps/mimic/**` + `packages/wolfpack-logsync/**` + their test files (the
whole beta↔main diff; nothing else had drifted, sync-beta working as
designed). Beta re-parked at **2.5.5** immediately after, per the park
rule.

⚠ **The first cut silently no-opped — new CI failure mode, now fixed.**
The graduation push carried TWO commits (version bump, then docs);
`release-mimic.yml` compared the Mimic version HEAD~1 vs HEAD, both read
2.5.4, and the run went GREEN without releasing anything. Caught only by
verifying the releases list, not the run status — **a green release run is
not a release**; check the tag. Fix shipped same hour: the HEAD~1 check is
gone, the tag-existence guard (version already tagged → skip; untagged →
build) is the sole idempotency. The real v2.5.4 landed via
`workflow_dispatch` at ~16:10 ET, verified by fetching the release itself:
tag `v2.5.4`, `prerelease: false`, so `/releases/latest` (the stable
updater path) resolves to it.

## 2026-09-02/4 — The 2.6.4 graduation, and the file it should not have touched
*2026-09-02 · DECISIONS-2026-09-02.md · Partial graduation must exclude held files' tests*

**A partial promotion must exclude the excluded file's TESTS too.** The Mimic
2.6.4 cut promoted beta → main file-by-file (the documented shape — beta must
never promote stale bot/web files), deliberately holding back
`web/app/globals.css` and `web/components/WolfPack.tsx`, which carry beta-only
web work still under review at b.wolfpack.quest. But it promoted
`test/wolf-eyeglow.test.js` along with everything else, and that test asserts
on the reveal ORDERING those two files implement. It failed on main, correctly.

⚠ **The fix taken at the time was to delete it — and main had owned that file
since `ee3fddd8`.** It was never beta's to promote; both branches had a valid
version of the same test, each matching its own branch's web code. Deleting it
removed 13 real assertions from main, and then produced a modify/delete
conflict on the next main→beta sync, which is the only reason it was noticed.

Restored on main as `034acd4a` (main's own copy, verbatim from `4ae5bccb`,
13/13 green). Beta keeps its own version, which adds the one ordering
assertion for the held-back reveal.

**The rule:** when a graduation's file list excludes a source file, grep for
tests that read it and exclude those too. And when a test fails after a partial
promotion, that is evidence the FILE LIST is wrong — check whether the target
branch already had its own copy before touching the test.

## 2026-09-07/2 — a member's "Mimic takes my internet down" report — what the bot saw (investigated, no fix)
*2026-09-07 · DECISIONS-2026-09-07.md · Reported network drop investigated, no fix*

a member via Mimic 2.6.5, 21:22 ET: zoning out while strafe-running, *"the
game hangs, then disconnects, and then my internet connection completely goes
down … Discord disconnects, browser can not connect … adapter looks active.
Only way to fix is to restart. When I stop running mimic, it does not happen
again."* Twice ME→DSP, once Seru→DSP. Guild lead: *"serious implications here."*

**Tonight's instance, reconstructed from the bot's HTTP log and Supabase.**
The originating connection was identified by pairing the 436-event upload with
the request that carried it (⚠ the deploy log's timestamps are batched
flushes, not event times — two uploads from different people share the same
microsecond — so pair on the HTTP stream, never on `[agent] upload from`).

| ET | What |
|---|---|
| 20:27–20:31 | a member (his alt) at the Seru mini, Sanctus Seru; last live-state 20:31:27 |
| 20:31:31–20:32:47 | Agent still polling the bot at the normal 2/s, every request 200, no retries, no burst — but **no live-state posts** in those 75s: the Zeal-fed stream had gone quiet, i.e. EQ was already hung |
| **20:32:47.666** | Last request ever from his machine. Clean cut mid-heartbeat |
| 20:33–21:08 | Nothing from his address, in every sample |
| 21:09:20 | a member enters Dawnshroud (after his restart); 21:22 files the report |

So this was the **Seru→DSP** case, on the alt, and the hang preceded the
network death by about 75 seconds.

**What that rules out.** The obvious theory — Mimic exhausting the machine's
outbound sockets or a router's NAT table — predicts *new* connections failing
while *established* ones keep working, and the agent rides warm keep-alive
sockets, so under that failure its polls would have continued. They stopped
dead instead, in the same second, with no error shape before it. Combined
with the wire rate (2/s per client, and nothing unusual fleet-wide) and
the code review below, the "too many connections" class is refuted for this
instance.

**Code review, for the record.** Mimic batches the 225-event/s pipe into one
localhost POST per ~2s and throttled state pushes, all with `res.resume()` and
3s timeouts; overlays poll the agent at 0.5–2s over keep-alive; the agent's
outbound goes through a 15s-drain durable queue with flat 30s transport
backoff and fire-and-forget ephemeral posts with 8s timeouts; no
immediate-retry patterns, no intervals under 1s. Nothing here can open
connections at the rate a port or NAT exhaustion needs.

**What is left, honestly.** The bot can only see the wire. A total cut with
the adapter still "up", fixed only by a reboot, is the signature of a NIC or
Wi-Fi driver hang or a Winsock-level failure on the box — and those correlate
with gaming load, which is exactly the kind of correlation that reads as
"only when Mimic is running" at n=3. The one Mimic mechanism that could
plausibly touch the *game* at zone time is Zeal-pipe backpressure (Zeal emits
a burst at zone-in; if its pipe write blocks on a slow reader, EQ's thread
stalls). Untested; do not assert it.

**Settling it needs the box, not the bot:**
1. Event Viewer → Windows Logs → System, around 20:32 on 09-07: any adapter
   reset / link-down / driver event names the real culprit in one line.
2. `%APPDATA%\wolfpack-mimic\agent.log` (Mimic's `userData/agent.log`) around
   20:31–20:33: the `[zeal]` disconnect line and its reason.
3. If it recurs: before rebooting, `netstat -ano | find /c "TIME_WAIT"` and
   `Get-NetTCPConnection | Group-Object OwningProcess | Sort Count -Desc`.
   Thousands of TIME_WAITs or one PID with thousands of sockets would revive
   the exhaustion theory; a normal count buries it.
4. One question splits the space: **do other devices in the house lose
   internet at the same time?** Yes → router. No → the PC.
5. Bisect Mimic, not all-or-nothing: `"zealPipe": false` in
   `mimic.config.json` (the opt-out exists in `main.js` but is not in
   Settings). If the zone hang stops with the pipe off, the pipe coupling is
   real and worth fixing upstream.

**Two product follow-ups this exposed, both queued:** bug feedback attaches
only the EQ log — the agent log is the one that answers "what was Mimic doing"
and should ride along; and the Zeal-pipe opt-out should be a Settings toggle
so members can bisect without editing JSON.

## 2026-09-10/2 — The Setup checklist now says WHICH wall you hit (agent 3.6.35, beta)
*2026-09-10 · DECISIONS-2026-09-10.md · Setup checklist names which wall you hit*

Two members lost an evening to the same page. One had Zeal
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

**Root cause of the dead feed was the elevation mismatch, now n=2** (2026-07-05 and
2026-09-10) — and it takes the OVERLAYS with it, which we
had never written down. All three of his symptoms (no Zeal, no overlays, EPERM
install) cleared the moment Mimic ran as admin. His own words, recorded in
`zealPipe.js` because they narrow it further than anything we had: *"I can get
em all up when doing the placement mode. and moving/resizing. even the hotkey
flip them from on to hidden. but nothing ever makes it to my screen."* The
windows exist and respond; they are never composited over the game.

⚠ **Sequencing trap for anyone advising this member:** "don't run either as
admin" is right in general and will break him, because his EQ is under Program
Files. Move the EQ folder out FIRST, then drop admin from both.

## 2026-09-10/5 — The 2.6.7 stable went out Friday morning, not at 00:35
*2026-09-10 · DECISIONS-2026-09-10.md · Stable release went out late; trigger mis-dated*

The post-raid push trigger was created Thursday 21:07 ET with `run_once_at`
a day late (2026-09-12T04:35Z instead of 09-11). Nothing fired at 00:35 ET;
noticed at 06:55 ET when a beta push showed the clock. Pushed the held batch
by hand (Friday is not a raid night) and deleted the trigger. Lesson: after
creating a one-shot trigger, read `next_run_at` back in ET before trusting
it — the tool echoes it.

## 2026-09-10/6 — The v2.6.7 release body is the wrong commit (2026-09-11)
*2026-09-11 · DECISIONS-2026-09-10.md · Stable release body was the wrong commit*

`release-mimic.yml` takes the release body from the commit at the TIP of the
push. The stable cut (`a5017b1f`, with its member-facing bullets) went up
with four commits above it, so the published body is the docs commit about
the mis-dated trigger, and the #mimic-releases announcer reposted it. The
installer and tag are correct; only the text is wrong. Repair: edit the
v2.6.7 release on GitHub and paste the bullets from the roadmap entry
("Puts the Setup buttons back" + the quiet-mode line) — the guild lead's action, no
tool here can edit a release. Rule added to CLAUDE.md: the version-bump
commit is the tip of its own push, or the tip carries `<!--player-notes-->`.

## 2026-09-18/12 — Renaming the repository — the risk is the auto-updater, not the URL
*2026-09-18 · DECISIONS-2026-09-18.md · Repo rename risk is the auto-updater*

> *"this project has become so much more than a quarm boss tracker perhaps the
> GitHub repository name also needs to update?"*

**The name is out of date and the guild lead is right about that.** But this is
not a settings change — it is a fleet operation, and the analysis below exists
so it is done in the right order rather than discovered live.

**The repo name is hardcoded in ~30 places**, and four of them are load-bearing:

| Site | What breaks | GitHub's redirect covers it? |
|---|---|---|
| `apps/mimic/package.json` `build.publish` = `{provider: github, owner: davehess, repo: QuarmBossTracker}` | **The auto-updater in every already-installed Mimic.** This value is compiled into the binary at build time — clients on today's build will keep asking for the old name forever | electron-updater's HTTP client follows redirects, so **probably** — but this is the one to verify, not assume |
| `index.js:66` `_AGENT_RAW_BASE` → `raw.githubusercontent.com/davehess/QuarmBossTracker/<ref>/…` | The agent hot-swap chain: the bot serves agent versions by fetching raw bytes | ⚠ **raw.githubusercontent.com is NOT believed to follow repo renames.** Highest-risk unknown |
| `index.js:10874` the `#mimic-releases` announcer, `https.get` to the GitHub API | Announcements stop **silently** — the code has **no 30x handling**, so a 301 parses as an empty release list | API redirects, but a raw `https.get` does not follow it. **Breaks** |
| `utils/mimicReleases.js`, the web `/mimic*` routes, `web/app/admin/agents` | `/mimic` download links, the agents page | These use `fetch`, which follows redirects → **fine** |

**Two things blunt the worst case, and they are worth knowing before anyone
panics:** the bot ships a **bundled agent fallback** (`_bundledAgentVersion`) so
a dead raw chain degrades to "no new agent versions" rather than a broken fleet;
and `AGENT_RELEASE_REF` is already an env var, so the ref side is tunable
without a deploy.

**The order that makes it safe:**

1. **Centralise the name.** One constant plus an env override (`GITHUB_REPO`),
   replacing ~30 literals. Cheap, and useful on its own — it is the same
   de-branding problem as `DESIGN-guild-kit.md` §7a, so **do it as part of slice
   2, not as a separate sweep.**
2. **Fix the announcer's missing redirect handling** regardless of the rename —
   `https.get` with no 30x branch is a latent bug today.
3. **Verify the raw.githubusercontent behaviour on a throwaway repo first.**
   Create a scratch repo, commit a file, fetch it via `raw.githubusercontent.com`,
   rename the repo, fetch again. Five minutes, and it removes the single biggest
   unknown instead of discovering it against the live fleet.
4. **Cut a Mimic stable carrying the new publish config _after_ the rename** —
   it cannot be shipped before, because the target repo would not exist yet. The
   window between rename and fleet adoption is exactly what step 3 is testing.
5. **Rename during a quiet window, never a raid night**, and verify within
   minutes: the announcer, `/mimic` and `/mimic/beta`, an agent update check.

**On the name itself — that is the guild lead's call**, not a design decision
(`CLAUDE.md`: naming is never proposed unilaterally). One consideration worth
putting on the table: it interacts with §11's generic-build question. A name
that is still Wolf-Pack-specific does not help a forking guild; a neutral one
supports the "Wolf Pack is a configuration, not the configuration" direction
already chosen. Whatever it becomes, `appId` `quest.wolfpack.mimic` is a
**separate** identifier with the same problem and should be decided at the same
time.

**Recommendation: do not rename yet.** Fold step 1 into slice 2, do steps 2 and
3 whenever, and rename when the name is decided and the fleet is on a build that
carries it. The URL redirect is the easy part; the auto-updater is the part that
strands people.

## 2026-09-18/5 — Field finding — Intel iGPU ghosting on the login screen was a missing `ddraw.dll`
*2026-09-18 · DECISIONS-2026-09-18.md · Login ghosting fixed by missing graphics file*

A member setting up on a Comet Lake-U laptop (Intel UHD only, no discrete GPU)
saw a doubled/ghosted cursor on the EQ login and server-select screens. Their
EQ folder had `D3D8.dll`, `dgVoodoo.conf` and `dpvs.dll` byte-size-identical to
our known-good install — so dgVoodoo was present, not missing. **Copying
`d3d8.dll` and `ddraw.dll` from dgVoodoo2's `MS/x86` folder into the game folder
fixed it.** ⚠ **dgVoodoo2 lives at
`https://github.com/dege-diosg/dgVoodoo2/releases` and is NOT part of the Zeal
download** — written down because the omission cost a second member an evening
on 2026-09-20, hunting the Zeal repo for files that were never in it (the guild
lead relayed the link the same night). Agent 3.6.48's crash review now prints
the URL, both filenames and the destination whenever it reports driver churn. The mechanism that fits every observation: the login screens are
DirectDraw-era 2D surfaces; with only `d3d8.dll` wrapped, the 3D world went
through dgVoodoo while the 2D UI still hit Intel's native DirectDraw, which has
no real legacy path. Two follow-ups: `CRASH_FINGERPRINT_FILES` in the agent does
not hash `ddraw.dll`, so telemetry cannot say who else is exposed; and there is
no low-end-hardware guidance anywhere — Mimic's up-to-17 transparent
always-on-top windows are composited by the same 15 W iGPU that renders EQ.

## §310 — Tray menu: layout B (Mimic beta `a9fcbfb4`, 2026-10-14)
*2026-09-21 · DECISIONS-2026-09-21.md · Simplified tray menu layout*

- **The ask (the guild lead, 2026-10-14):** *"We need to refine and simplify the taskbar menu so its not so overwhelming"*, then
  *"Tray layout B"*.
- **What it is:** the top level is status, Show dashboard, Overlays ›, Rescue, Quiet mode, Settings ›, Open ›, Help ›, Quit. Settings ›
  holds the options under Behaviour / Mode / My tells / Updates / crash reports / Account, then Settings…; Open › holds the pages,
  folders and windows; Help › holds the walkthrough, feedback and Restart agent.
- **Calls:** Settings › is one flat submenu with disabled headers and separators, not nested submenus (a checkbox stays one click from
  its group). Positions only: no label, handler or checkbox changed (`test/tray-menu-layout.test.js` checks against a snapshot of the
  old template). Agent only: "Spoken trigger callouts (TTS)" takes the Overlays slot.
- **Open:** a pending "Restart to install update" now sits inside Settings › Updates instead of at the top level; the guild lead's call
  whether it gets a top-level line while one is pending. Tray-only items with no dashboard or Settings twin: "Pop up when an update is
  ready", the four "Pause Discord DMs" items, Uninstall, Show agent log.

## §312 — UI Studio chat routing: real channel names, layout ↔ routing link (Mimic beta `a730c5be`, 2026-10-14)
*2026-09-21 · DECISIONS-2026-09-21.md · UI Studio chat routing with real channel names*

- **The ask (the guild lead, 2026-10-14):** *"These Channels need to say what's actually in these chats, not just Ch 26 or Ch 46"*,
  *"When you select one of these windows it should highlight the chat window routing"*, *"Also the labels are wrong"*, with the
  in-game Filters menus of two windows as ground truth.
- **Call:** `ChannelMap<N>` is the filter-menu position, not a colour id. Ids 0–40 from MacroQuest eqlib `eChatChannel` (corroborated by
  Zeal's `chatfilter.cpp` offsets), 41–56 from Zeal's `Extended_ChannelMaps` in saved order; both in-game windows are golden fixtures and
  match exactly. The old table was invented and wrong from id 3 on. Unsourced ids stay "Ch N"; no guesses.
- **Also:** /join slot names from eqclient.ini's autojoin list, passwords cut in main; selection is one state across layout and cards; chips
  drop onto layout rectangles; stacked titles no longer overlap.
- **Open:** the autojoin order = slot order assumption is unverified (tooltip says so); the default-channel pill names only 3 = Tell
  (`ChatWindow<N>_DefaultChannel` values beyond that need an in-game capture).

## §318 — Installing an update shuts Mimic down like Quit, positions saved (Mimic beta `b26c8162`, 2026-10-14)
*2026-09-21 · DECISIONS-2026-09-21.md · Update install quits gracefully, saves positions*

- **The ask (the guild lead, 2026-10-14):** *"when installing a new version, please exit gracefully and save window position"*.
- **What it fixed:** all four install paths (tray, dashboard, the "Restart now" dialog, install-when-EQ-closes) called `quitAndInstall`
  straight away; bounds saved only on a 400 ms debounce, so a move just before an install was lost; and Quit itself hard-killed the agent
  (`kill()` on Windows skips its exit hooks, so the upload queue flush never ran).
- **Now:** one `_gracefulShutdown` (memoised) flushes every pending bounds and floor save into one config write, stops the watchers,
  asks the agent to stop via its `/api/shutdown` and waits ≤ 3 s (then kills), and only then `_installUpdateNow` → `quitAndInstall`.
  Quit, `before-quit` (covers install-on-quit and OS logoff) and the agent hot-swap use the same path. A throwing install restores
  everything. Test: `test/mimic-graceful-update-exit.test.js`.
- **Open:** the main dashboard window's own size/position is never saved (always 1200×800) — a separate change if wanted; first real
  test is the update AFTER this build, since the build being replaced still has the old shutdown.

## §319 — Tray: Updates is its own submenu (Mimic beta `1ae718c1`, 2026-10-14)
*2026-09-21 · DECISIONS-2026-09-21.md · Tray gets Updates submenu*

- **The ask (the guild lead, 2026-10-14):** *"add updates to the submenus for the taskbar"*. Also settles §310's open question (a
  pending update now shows at the top level, as the submenu's label "Updates — vX ready").
- Same items, same handlers; moved out of Settings ›, placed between Settings › and Open ›.

## §322 — UI Studio: named EverQuest UI layouts per character (Mimic beta `d77a7d5b`, 2026-10-14)
*2026-09-21 · DECISIONS-2026-09-21.md · Named EverQuest UI layouts per character*

- **The ask (the guild lead, 2026-10-14):** *"we should allow for multiple layouts for characters screens so we can have alternative
  modes, and be able to back up both. Name them as well."* (a minimal-chat layout that leans on the Chat overlay, beside the full one).
- **Calls:** a layout is only the character's `UI_<char>*.ini` — EQ keeps changing socials, spell sets and `eqclient.ini` on its own, so a
  switch must never lay old copies of those back. Switching while EQ runs waits for logout (same queue as deferred saves). Backups carry
  the name in the existing `ui_snapshots.label` ("Layout: <name>"): no bot change, no migration.
- **Open:** `ui_snapshots` has no pruning and each layout save adds a row; `/me/ui` may now show "Layout: …" as the newest label;
  Windows + EQ run to confirm EQ keeps the swapped file after a camp.

## §327 — UI Studio: rename, add and delete chat windows, set their font; hotbar pages ask before discarding (Mimic beta `f26fa569`, 2026-10-14)
*2026-09-21 · DECISIONS-2026-09-21.md · UI Studio chat window management and font*

- **The asks (the guild lead, 2026-10-14):** *"need to be able to delete or rename chats, or make new ones in the UI Studio"*; *"clicking
  off the hotbar pages should ask if you want to cancel changes. The UI should shrink to not sit over top of the hotbar pages"*; *"also
  include chat fontsize on the ui studio for chats"*.
- **Calls:** delete moves the window's channels to Main Chat (0) and renumbers later windows; never deletes 0 or a Tell window; falls back
  to last-window-only if an unknown numbered key exists. Font is EQ's `_FontStyle` index 0–6 (point sizes unconfirmed, so the picker
  shows the index). The inspector save stays blocked while EQ runs rather than deferring past logout, because a renumbering planned
  before logout could be stale after EQ rewrites the file. The hotbar editor docks beside the layout and asks Keep editing / Discard.
- **Open:** a live EQ check that a created window loads, that an emptied `[Chat N]` header is harmless, names up to 32 chars, and the
  point size per font index; after-logout deferral for inspector saves if wanted.

## §29 — Field issue — Windows 11 preview update KB5124010 breaks EQ at launch (2026-09-25)
*2026-09-25 · DECISIONS-2026-09-21.md · Windows update breaks game at launch*

A member reported in the Quarm Discord (shared by the guild lead): EQ would not
launch, or crashed at once, with Windows' *"Memory could not be read"* box, **even
with Zeal disabled**. The cause was the Windows 11 preview update **KB5124010**
(build **26200.9550**), installed overnight, and uninstalling it fixed the client.
One machine, mechanism unknown. Written into `docs/RUNBOOK-client-crash-triage.md`
§3b as the first question for any "worked yesterday, crashes at launch even without
Zeal" report, ahead of the §5 ladder.

## §52 — The co-leader's feedback batch, the /who window, Settings drafts (2026-09-26, agent 3.7.27 beta)
*2026-09-26 · DECISIONS-2026-09-21.md · Co-leader's seven feedback reports fixed*

The guild's co-leader filed seven Mimic feedback reports in 25 minutes (00:22–00:47 UTC) and followed
up in Discord. They are on **stable 2.7.1**, so none of this reaches them until they switch to beta or a
stable is cut.

| Report | What was wrong | Shipped |
|---|---|---|
| "/who window … a certain modifiable size … scroll down it" | It sized itself to the zone | `v2.7.2-beta.16`: fixed height with a drag grip (double-click = fit), a scrolling list, CLASS/GUILD filter chips like the tracking window, sort (seen/name/class/level/guild) — the guild lead: *"treat it like the in game tracking with filters for guilds or classes"* |
| "Feedback should include a copy/paste for snips" | — | `beta.15`: Ctrl+V into the feedback card (§51) |
| "right clicking it [the tray] does nothing … no exit, no nothing" | The tray menu was rebuilt on every status push and every change of "active character". Active means whichever Zeal stream reported last, so it can change several times a second, and on Windows replacing the context menu closes the open one | `beta.17`: right-click builds the menu then pops it up, so nothing replaces it; a fallback menu with Quit if the build fails; **⏻ Quit on the dashboard** (tray ↔ dashboard parity) |
| "i closed mimic with task manager and it seems none of settings were saved" | `saveConfig` wrote in place and runs often (auto-sizing overlays persist bounds). A kill mid-write tore the file, and a torn file loaded as all defaults | `beta.17`: atomic write (.tmp → rename), a last-good `.bak`, and loading falls back to it |
| Charm break TTS "about a second off … ONe of the only reasons for me to continue using eqlogparser" | Log read every 500 ms, then a 700 ms overlay poll behind a 400 ms cache; the Charm window added a 1.5 s kill guard | `beta.17`: 150 ms reads while a log is active; a long-poll that speaks a trigger the moment it fires; kill guard 600 ms |
| "server tick … broken out … as a standalone timer" | Only on the HUD | `beta.17`: a Server tick timer bar (Suggested → Timer bars) |
| HUD builder: "mana or endurance … separated to be either or" | — | **not yet**, queued with the half-circle mini HUD |

**Settings drafts (the guild lead: *"saving potential settings changes as drafts as people start
making changes, and give them a reminder to save before exiting the page"*), `beta.17`:**
- Every edit that Save would send is kept as a local draft, never the token.
- The next open brings the draft back with Save / Discard.
- Closing with unsaved edits asks: Save and close / Close without saving / Keep editing.
- Quitting Mimic closes Settings without asking (Electron would otherwise cancel the quit); the
  draft is already on disk.

**Flagged, not changed:** the "active character" flip-flop itself. Besides the tray, it re-applies
per-character overlay layouts on every flip when that feature is on. The right fix is focus-based
(which game window is in front), not "last Zeal report". That touches core behaviour, so it is its own
piece of work.

## §53 — ⤴ beta on the dashboard, next to Check for update (2026-09-27, agent 3.7.28, `v2.7.2-beta.18`)
*2026-09-27 · DECISIONS-2026-09-21.md · Move-to-beta button beside update check*

**The call (the guild lead):** *"put the move to beta on the dashboard next to check for updates"*.

**Why:** the only way into the beta channel was the tray's "Receive beta updates". The co-leader is on
stable 2.7.1, and on that build the tray menu is the thing that would not open (§52). This is the tray ↔
dashboard parity rule (2026-08-19) applied to the one updater control that was tray-only.

**What shipped:**
- A small **⤴ beta** button right after "↻ Check for update", styled like the beta build's ↩ stable.
- It shows on **stable Mimic builds only**. Beta builds keep BETA + ↩ stable; the standalone parser
  gets neither.
- It stays hidden until the shell answers. An older Mimic without the bridge, or a dev build with no
  updater, never shows a button that does nothing.
- Click → Mimic's own confirm → join. The button then reads "✓ beta on next restart" and a second click
  offers to leave.
- The tray checkbox and the button call the same `setBetaChannel(on, source)` in `main.js`. The tray's
  old click body moved there unchanged, so the two cannot drift.

**⚠ It does not reach anyone already on stable 2.7.1.** The button lives in the build, and a stable
user gets the next build only when a stable is cut. So the co-leader still needs one of these:
- the `v2.7.2-beta.18` installer from the releases page (it installs over stable and keeps settings);
- the tray, if it opens for them once;
- or a stable cut.

After that, the button is always there.

**Where:**
- `apps/mimic/main.js`: `setBetaChannel`, plus the `get-beta-channel` / `set-beta-channel` IPC.
- `preload.js`: the bridge.
- `dashboard.html`: the header `{{WP:…}}` else-arm and the `wpJoinBeta` wiring.
- Tests: `test/dashboard-join-beta.test.js`, 14 tests; 8 of 8 mutants killed.

## §57 — Stable 2.7.2; the #pvp note; a Day window; fight sizes; who follows Discord; buffs on the entity's tick; the overlay catalog and the 3.0 plan (2026-09-27)
*2026-09-27 · DECISIONS-2026-09-21.md · Stable 2.7.2 with PvP filters and overlay catalog*

**The calls (the guild lead, one message):** *"do those and move us up to a new patch release. make a
note in the PVP channel for people to run their opt in logs to get historical credit on pvp kills
and assists. also add in a 24hr filter for pvp, and try to figure out fight sizes for opponents vs
allies when a fight happens in pvp. start looking for the messages when people #togglepvp in game
and follow the way of discord vs order. don't forget about server ticks. debuffs and buffs wear off
on entity's ticks, which do not correspond with the server ticks..rather with when an entity
spawned. every component of the overlays … need to be cataloged in a master overlay design doc and
then prepared for an open overlay builder system that I want to develop for a 3.0 release for
mimic … start a full life cycle research and planning cycle … ideal to complete before October 1st."*
And the follow-up: *"this can be an extension of the UI builder, but it needs to be a lot smarter …
elements should have displayed sample data … build out overlays on the fly … snap to other windows
inside the EQ client from native or zeal … adaptivity to a specific character's abilities, clickies,
levels."*

### Stable Mimic 2.7.2 (agent 3.7.31) — `7f82926d`, the tip of its own push
- File-level promotion from beta `07a4765c`: `apps/mimic/`, `packages/wolfpack-logsync/` and their
  tests. Beta.15–.21 all ship: guildmate PvP assists + the one-note parse, the Tick overlay, timer
  bars, the /who window, feedback screenshots, the DIRGE board, HUD tracking arrows, the corpse DM,
  Settings drafts, the ⤴ beta and ⏻ Quit buttons, the tray and config fixes.
- **Four beta-only web tests were left behind** (`about-figures`, `pvp-fights-page`, `tradeskills`,
  `zeal-icons-page`): they test web variants that exist only on beta. The first promotion attempt
  pulled them in and went red; the rule for next time is `--diff-filter=AM` on the test list and
  then drop any test whose subject is a beta-only web file.
- Beta re-parked at **2.7.3** (agent 3.7.32, then 3.7.33 — see the slip below).

### The #pvp note (bot 3.1.157)
`_announceOptinPvpOnce`: the 2.7.1 raid-chat card's shape — bot_kv latch (fail-closed), a wait for
the **stable v2.7.2 release to carry its .exe**, one embed to the PvP thread/channel, pinging nobody.
It waits for 2.7.2 because guildmate assists and the one-note parse reach stable users only in that
build; a note before it would send people to a catch-up that still floods or credits only themselves.

### A Day window on /pvp (web 1.8.26)
The picker already knew `1d`; /pvp now offers it.

### Fight sizes (migration `20260927040000`, applied)
- `pvp_fights` returns `zek_players`, `ally_players`, `players_by_guild`.
- "On the field" = everyone a Wolf Pack log saw: the dead and their killers (`pvp_deaths`), the
  assisters (`pvp_assists`, ±3 min round the fight), everyone `/who` listed in the zone from 4 min
  before the first death to 1 min after the last. One row per name, best guild any source gave.
- Sides: Zek and Rise of Zek are the opponents (the death split's rule); any other guild is an ally;
  no guild or /anon is listed by guild but on neither side.
- **It is a floor.** A /who nobody typed, an anon player, a raider whose log never uploaded — all
  missing. /who's short zone names ("vexthal") don't match the broadcast's long name and are left
  out. The cards and table say "at least".
- Drawn on the beta fight cards ("On the field: Zek 14 v 21 allies (Wolf Pack 9 · …) · at least")
  and the table's Sides column. The default page is unchanged until the layout pick (§46).

### Who follows Discord (migration `20260927040100`, applied)
- **The toggle lines were already parsed** — since 2025-02, `parsePvpFlag`: *"You are now player
  kill and follow the ways of Discord."* → `pvp_flag_on`; *"You now follow the ways of Order."* →
  `pvp_flag_off`. So "Discord" is the PvP-enabled alignment and "Order" the peaceful one, and the
  data was 1,498 toggles across 115 characters waiting to be read.
- `pvp_flag_state` (a `security_invoker` view) is the latest line per character. `/pvp` lists
  "Following Discord now" with how long ago, only when someone is. Measured tonight: 22 characters
  following Discord, 5 of them toggled in the last week.
- ⚠ Self-only lines, so only characters running Mimic have a state. A guildmate without Mimic is
  invisible here; their flag shows only when a fight names them.

### Buffs and debuffs fade on the entity's own tick (agent 3.7.32/3.7.33 beta)
- The rule, in the guild lead's words: *"debuffs and buffs wear off on entity's ticks, which do not
  correspond with the server ticks..rather with when an entity spawned."* The server counts a buff's
  ticks down once per beat of the mob's own 6 s timer, started at spawn; the "server tick" Zeal
  shows (gauge 24) is the *player's* own beat, not the mob's.
- `_entityTickFadeAt(landedMs, durTicks, tick)`: an N-tick buff fades on the Nth of the mob's beats
  after it landed — the first beat strictly after landing, then N−1 more. That is up to 6 s earlier
  than the naive landed + N × 6 s. With no learned tick the naive estimate stands and `snapped` is
  false.
- Used by the trigger window's spell timer bars (a ⏱ after the effect when snapped) and Target
  Info's buff/debuff rows (`tick_snapped`). The mob-tick learner (§50) feeds it: a DoT ticking on
  the mob, or a charm break.
- **Not yet:** six more expiry sites still use landed + N × 6 s (pet buffs, the slow tracker, the
  buff timeline, the target-buff relay rows), and **other raiders' buffs** — each player's own beat
  is their gauge 24, which their agent has and could relay in the live-state upload so the buff
  queue and Extended Target snap too. Both are queued in STATUS.
- "Don't forget about server ticks" is read two ways and both are done: the Tick overlay is in the
  stable, and the entity-tick rule now governs mob timers.

### The slip: 3.7.32 went out red
`npm test | grep …` reports grep's exit status, not the suite's, so the beta push chain did not stop
on six failing tests (`pacify-tracking`, which slices `targetBuffsFor` alone and met the new helper
calls as a ReferenceError). Fixed in 3.7.33 minutes later with the repo's `typeof` guard; behaviour
in the running agent never changed. **Rule:** `set -o pipefail` (or test the suite's own exit code)
in every push chain. Recorded because the fleet hot-swaps the agent from the beta ref.

### The catalog and the 3.0 plan
- `docs/DESIGN-overlay-catalog.md` — every overlay's identity, data sources down to the Zeal pipe
  type, outputs, surfaces, dependencies, raid impact, persisted state and caveats; the shared
  machinery; **twelve findings** the sweep turned up (the two that matter: the DPS HUD and Threat
  meter never know who "you" are, and the active-character flip-flop); and the data contract a
  builder needs.
- `docs/DESIGN-mimic-3.0-overlay-builder.md` — requirements R1–R10 from the ask; what exists to
  build on (UI Studio, the HUD's parts builder, panel overlays, the dock, auto-arrange, the ini
  reader, the character knowledge already on the platform); **the access question** with four
  options costed the guild lead's way (ini files now; a Win32 window-geometry helper next; a Zeal
  "ui windows" pipe message as the standing upstream ask; screen capture only as a one-shot
  self-check, never for layout); the spec → signal → part architecture with sample data per
  signal; six phases sized at **21–34 sessions**; risks; and seven questions for the guild lead.
- **October 1:** the full 3.0 is not achievable in four days, one of them a raid night. What is:
  **3.0-alpha.1** — the alpha channel, the signal registry with sample data, the two identity fixes,
  and the first builder canvas (EQ's windows and Mimic's overlays together, snapping, per-resolution
  save, fake numbers while arranging). The plan says so plainly rather than promising the rest.

### Where
- Stable: `7f82926d` on main; beta re-park `d48a258e`, fix `3.7.33`.
- Bot: `_announceOptinPvpOnce`; web: `loadFlagged`, the Day window; agent: `_entityTickFadeAt`,
  `_serverTicksNow`; migrations `20260927040000`, `20260927040100`.
- Tests: `announce-optin-pvp` (4), `pvp-flag-state` (4), `entity-tick-fade` (8, 6 of 6 mutants
  killed), `pvp-fight-sizes` (5, 2 of 2 mutants killed).

## §68 — UI pack layout options become checkboxes (2026-09-28, Mimic beta)
*2026-09-28 · DECISIONS-2026-09-21.md · UI pack layout options become checkboxes*

The guild lead: *"NIllipuss update with Default is not this, this adds a different bank"* (screenshots:
✓ Applied "Hotbar + Bag 1 slots", the small default bank, and the huge all-bags bank), then *"Default
should be no options, but you should be able to choose or remove multiple options. Resolve which ones
have overlap and make it checkboxes."*
- **What went wrong.** In Nillipuss 3.1 the pack's main `EQUI_BankWnd.xml` IS the all-bags bank (340
  slots); `Options/Bank - Default layout` is the 40-slot one. The old dropdown could only add a layout and
  never showed which were on, and an install or update wrote the all-bags bank back. The Hotbar message
  was the dropdown's real value at the click (value and message are the same string); nothing mapped one
  option to another.
- **The call:** nothing on by default; tick any mix; a tick takes effect at once. Two options that change
  the same file can't both be on, and the other box says which window they share. Two versions of one
  option (Theme - Colors · Purple / Teal) are alternatives even where their files differ. Everything else
  stacks.
- **An option file identical to the pack's own file is ignored.** That was the one open policy question
  from the diagnosis: QQ Layout ships the default hotbar, so it would otherwise clash with both hotbar
  options for no reason. "Blue (default)" shows as what you already have.
- **Restores need the pack's own files,** so Mimic keeps them in `uifiles/<pack>/.mimic-defaults/`, taken
  from the release zip at install. A pack installed before this fetches them once from GitHub (the tag
  Mimic installed, else the latest). Whether a box is on is read off the files, never a saved list, so
  the boxes can't drift from what EQ loads. An update keeps the ticked options on.
- Installs no longer write backup copies inside `Options/`: those copies were being applied as if they
  were layout files. A file the member edited by hand is still backed up before an option replaces it.
- Measured against the real 3.1 packs. 1080p clashes: Bank ↔ QQ, Horizontal Layouts ↔ Hotbar + Bag 1, Mana
  Bar ↔ Mana Timer, and the theme versions. 1440p has more options that share the player/target and
  inventory windows; the matrix is worked out from the files at run time, never written into the code.
- **To get the normal bank back today on stable Mimic:** apply "Bank - Default layout" again, check that
  the ✓ line names it, then `/reloadskin`.

## §72 — Stable Mimic 2.7.3 (2026-09-28, agent 3.7.37)
*2026-09-28 · DECISIONS-2026-09-21.md · Stable Mimic 2.7.3 promotion*

The guild lead: *"push all of this to main"*. File-level promotion from beta (`43f290af`):
`apps/mimic/`, `packages/wolfpack-logsync/` and their seven tests (charm-break-instant, entity-tick-fade,
mini-dps-buffqueue, pet-sheet, pvp-glory, target-info-fqv, ui-pack-options), byte-identical to beta. The
beta-only web variants stay on beta, as at 2.7.2 (/about layouts, the item page's tradeskills, the /pvp
fight pages, the Zeal marks gallery, and their tests). Full gate on the promoted tree: 330 test files,
lint and the dashboard check clean. Beta re-parked at 2.7.4.
- **In it:** F/Q/V on Target Info (§70, §71a), UI pack checkboxes (§68), Rallos Zek kill lines (§66), your
  own row on the DPS meter, buffs fading on the mob's own tick, the instant charm break and top-down trigger
  timers, and the #petstats parser (§63; nothing draws it yet).
- **Open, the guild lead's pick:** *"we need to add a forward and backward button and keep history of who
  we targetted that have quests so we can access the quests. Would this make more sense to have as its own
  overlay?"* Two ways:
  - **A. Inside Target Info's Quest sub-tab:** ◀ ▶ through the quest NPCs you have targeted.
    Build: small (history list, a pinned view). Maintenance: low. Runtime: nothing new; the data is already
    cached per NPC id. Change: the hard part. Target Info's header (name, HP, slow) must follow the live
    target, so a pinned quest body under a different NPC's header reads wrong, and every other tab has to
    respect the pin.
  - **B. Its own Quests overlay (recommended):** it follows your target whenever that NPC has a quest, keeps
    the history (◀ ▶ plus a recent list), and stays on the last quest NPC while you walk, fight or target
    something else. Build: bigger, because a new overlay owes the full parity checklist (✕, ✥ drag +
    right-click, hover handshake, Overlays-tab row, visibility, hide-all, tray + dashboard parity).
    Maintenance: one more overlay in the parity audits. Runtime: one more small window reading data the
    agent already caches. Change: easy, because it stands alone. Target Info keeps the Quest sub-tab as the
    quick look.

## §72a — Stable Mimic 2.7.4: UI pack layouts get an Apply button, and stray screenshots stop clashing (2026-09-28)
*2026-09-28 · DECISIONS-2026-09-21.md · Stable 2.7.4 UI pack Apply button*

The guild lead's screenshot of 2.7.3: nearly every layout box greyed out with "both change the
Screenshot.png", and *"There's no button to install, only reset and untick"*.
- **Cause:** the old Apply copied every file of an option, its `Screenshot.png` included, into the pack's
  main folder. The 2.7.3 rule counted a file as a layout file when the main folder on disk had one by that
  name, so on any machine the old Apply had touched, every option "changed Screenshot.png" and clashed
  with every other. Bank - Default layout could not be ticked. The rule now reads the pack's own main
  folder from the stored release defaults; only before those are fetched does the disk decide, with
  screenshots and readmes named out. A test reproduces the littered folder.
- **Tick, then Apply:** a tick only plans the change; Apply writes the files, lights up while the ticks
  differ from what is on, and says how many changes are waiting. Untick all only clears the boxes. The
  instant-apply of 2.7.3 read as "nothing happens", and the greyed-out boxes hid that anything could.
- **Why a second stable the same evening:** 2.7.3 broke the feature for exactly the members who had used
  the old Apply, the guild lead among them. Promoted file-level from beta (`66dc3d1a`), byte-identical;
  330 test files green, lint and the dashboard check clean. Beta re-parked at 2.7.5.

## §81 — A Mimic 3.0 alpha channel (2026-09-29, Mimic beta `1cd1d423`, bot 3.1.173, web 1.8.45)
*2026-09-29 · DECISIONS-2026-09-21.md · Mimic 3.0 alpha channel created*

The guild lead: *"can we make an alpha channel for 3.0 testing as well? I'm sure we're going to do more beta
releases before that, but I think I should test out the overlay builder soon after this new round of beta
elements."*
- **The branch.** `alpha` = `beta` + the 3.0 overlay-builder work. `sync-alpha.yml` merges beta and main
  into it on every push to either (the sync-beta rule one step down); alpha keeps its park,
  `apps/mimic/package.json` at 3.0.0. CI (`test.yml`, `golden-log.yml`) runs on it.
- **Agent changes land on beta, not alpha.** So the alpha's agent is always beta's, and an alpha Mimic can
  keep hot-swapping along the beta agent line (`?channel=beta`) with no bot change. Builder work that
  needs the agent: agent part to beta first, Mimic part to alpha.
- **The release.** Each push to alpha builds `3.0.0-alpha.<run number>` and REPLACES the files of one
  rolling GitHub release, tag `mimic-alpha` (prerelease). Alpha installs read its `alpha.yml` from that
  fixed download address (a generic feed, `_ALPHA_FEED`), never through GitHub's release feed.
  **Why not a normal `-alpha.N` tag per build:** the feed lists only the newest 10 releases, and
  electron-updater's alpha channel takes the newest non-custom entry — beta included — so a beta pushed
  after an alpha would hide it (checked in electron-updater 6.8.9's `GitHubProvider`), and a day of beta
  pushes would scroll it out of the feed entirely (the 2026-07-30 Linux lesson). One release, replaced
  in place, also never takes more than one slot in the feed.
- **Who gets it.** Opt in from the tray ("Receive alpha updates (Mimic 3.0 builder)") or the dashboard's
  α alpha button — one function, `setAlphaChannel`, confirm first. An alpha build stays on alpha until
  the raider leaves; leaving goes back to beta and is allowed to step down from 3.0.0. Revert-to-stable
  clears the alpha opt-in. The header says ALPHA (purple) on an alpha build.
- **Nothing else may mistake it for the beta.** The #mimic-releases beta card, the bot's beta download
  link (`utils/mimicReleases.js`), `/mimic/beta` and `/admin/agents` all took "the newest prerelease";
  each now takes only a `-beta.N` tag. Any new consumer of releases owes the same filter.
- **Not announced.** The rolling release never reaches #mimic-releases. Alpha testers are told directly.
- ⚠ **electron-builder writes only `latest.yml` under the github publish provider**, whatever the version
  says — the beta releases carry only `latest.yml` too, and beta installs quietly fall back to it. The
  alpha's fixed-address reader has no fallback, so the first alpha (`v3.0.0-alpha.832`) shipped with
  nothing an alpha install could read. The alpha build now copies `latest.yml` to `alpha.yml` and
  publishes that; the second alpha is the first one an install can actually take.
- `test/mimic-alpha-channel.test.js`, `test/alpha-release-isolation.test.js`; CLAUDE.md channel table.

## §88 — "Mimic just closed" during a crash review was an update installing itself (2026-09-29, Mimic beta `7c82aa0a`)
*2026-09-29 · DECISIONS-2026-09-21.md · Mimic closing was update installing*

The guild lead, live with a member: *"mimic just closed as we were reviewing his crash reporting"*.
- **Not a crash.** The member's agent reported Mimic 2.7.2 at 12:35 UTC; the next screenshot showed 2.7.4.
  Stable 2.7.4 had been downloaded and was waiting. EverQuest was not running: it had just failed to start
  with its own "Failed to load the graphics DLL!" box. Since 2026-08-04, Mimic installs a waiting update
  15 seconds after it sees EQ closed, and the new build starts hidden in the tray. So the window vanished
  mid-review, and the new build sat hidden in the tray.
- **The trap is who it hits:** people with Mimic open while EQ is shut are the people troubleshooting EQ.
- **Fix (beta):** the install waits while the Mimic window is up and not minimized. The dashboard's update
  banner still offers "restart now", and the first poll after the window is hidden or minimized installs
  it. Stable users get this at the next stable cut. Until then, if it happens, Mimic is in the tray.
- **The graphics DLL box is EverQuest's, not Mimic's.** Not diagnosed. It is what 32-bit EQ says when its
  graphics layer cannot load, and the crash review had just suggested copying dgVoodoo2's `d3d8.dll` +
  `ddraw.dll` from its `MS\x86` folder. A copy from the x64 folder would produce exactly this box. That is
  the first thing to ask, not a finding.
- Also seen: `AcLayers.dll` on the stack of the member's last EQ crash. That is the Windows compatibility
  layer, so a compatibility-mode setting (or one Windows applied itself) is on for `eqgame.exe`. It is worth
  checking against the XP-compat field issue in CLAUDE.md.
- `test/update-on-eq-close.test.js` has three new cases, and both guards were mutation-checked.

**Follow-up, same hour — EQ still would not start.** Compatibility mode was off, running as administrator
did not help, and removing the two dgVoodoo files did not help either. Evidence from the file fingerprints
his crash report carried (`crash_reports.system.files`, hashed at upload, 12:35 UTC):
- **His `eqgame.dll` is not Quarm's.** It is 241,664 bytes and was written 2026-09-29 01:43 UTC, three hours
  after his last in-game crash. The one other player whose report carries it has 318,464 bytes, dated
  2026-07-07, which matches "eqgame.dll version: 7 (Jul 7 2026)" from `/zeal version`. Mimic and the agent
  never write this file (checked). So the file changed after the last time EQ ran, and EQ has not started
  since. That is the lead. It is not proven: Quarm's own repository is not reachable from a cloud session,
  so a Quarm release that night cannot be ruled out here.
- `eqgfx_dx8.dll`, `dpvs.dll`, `eqw.dll` and `dgvoodoo.conf` are byte-identical to the other players'.
- A normal Quarm install ships dgVoodoo's `D3D8.dll`. Removing it falls back to Windows' own, so it does
  not explain the error, but it should go back.
- **Drivers:** Windows installed a batch of Intel drivers on 9/27. His display driver was 31.0.101.2127 on
  9/17 and 31.0.101.2145 in the 9/28 crash, and that crash shows the graphics driver resetting. That fits
  the in-game crashes, not the refusal to start.
- **What to ask, in order:** put Quarm's `eqgame.dll` (and `D3D8.dll`) back from a working install or the
  official client download, keeping the current one as `.bak`, and ask what was run around 9:40 PM ET on
  9/28. If the crashes continue once it starts, roll the Intel display driver back to 31.0.101.2127.
- **Worth building (not built):** the crash review could compare a player's fingerprints with the rest of
  the fleet and say "your eqgame.dll differs from everyone else's". The data to do that is already
  uploaded.

**Then the driver was blamed, and the driver fix did not work.** From Intel's own driver assistant, install
history: *"Intel 7th–10th Gen Processor Graphics — Windows"*, driver **31.0.101.2145**, released 2026-09-22,
installed **2026-09-27 9:24 AM**; before it, 31.0.101.2141 (2026-04-06). The guild lead: *"THE TOP ONE BROKE
HIS SYSTEM"*. I switched the lead to the driver on that call. Installing 2141 then did not work.

**Resolved: `eqgame.dll`.** The guild lead: *"He replaced the eqgame.dll FROM THE ORIGINAL takp and that got
him working"*. So the first lead was right, and switching off it was the mistake.
- **The likely sequence:** driver 2145 went in on 9/27. An in-game crash with driver resets followed on
  9/28 at 6:39 PM ET. At 9:43 PM ET a different `eqgame.dll` landed in the folder, most likely swapped in
  to chase that crash. From then on, EQ would not start.
- **Where the swapped file came from is still unknown.** If a guide or a Discord post is handing it out,
  others will hit this.
- **The lesson,** now in the runbook: "Failed to load the graphics DLL!" is a file-in-the-folder problem
  first. The fingerprint comparison that found it took one query. The runbook's §3c is now this cause, and
  the driver moved to §3d as a suspect for the in-game crash only.
- **The rest of the guild's drivers:** crash reports carry the GPU driver only for players who share them.
  One other player on Intel graphics has ever sent one (UHD 630, driver 2140, in August).
- **The build idea above earns its place:** the crash review comparing a player's game files with everyone
  else's would have said "your eqgame.dll is not the one the guild has" on the first look. The data is
  already uploaded. It is the guild lead's call (it is UI, so options on beta first).
- **Closed:** after the swap, `/zeal version` on the member's client read `eqgame.dll version: 7 (Jul 7
  2026 09:14:03)`, which is Quarm's current build. It matches the guild lead's working copy (318,464 bytes,
  md5 `d45c9b22…`; full fingerprint in the runbook §3c).

## §91 — Copying a whole Mimic setup to another person's install — options, not built (2026-09-29)
*2026-09-29 · DECISIONS-2026-09-21.md · Copying whole Mimic setup, options only*

The guild lead, relaying a member setting up a second install in their household: *"wants to be able to
copy overlays and triggers and everything. we should support this, Direct sharing should be an option as
well"*. Nothing does this today: Mimic has no settings export, and trigger import reads GINA/EQLP only.
An inventory (file:line in the session that wrote this) says a setup lives in three places:
- **Mimic's `mimic.config.json`** (Windows: `%APPDATA%\wolfpack-mimic\`). It holds overlay positions (absolute
  pixels per screen setup), looks, hotkeys and the canvas layout (fractions). ⚠ **It also holds the sign-in
  and identity**, so copying the file makes the other install upload as the first person. Never tell
  anyone to copy it.
- **Mimic's own `localStorage`:** the HUD builder per character (`wpHudParts:<char>`), plus the DPS HUD,
  Melody, Buff queue, /who, Extended Target and CH chain options.
- **The agent's `agent\personal_triggers.json`:** personal and suggested triggers. Rows can be scoped to
  character names.
**Never in a shared setup:** the sign-in, tokens and Discord identity, EQ and log paths, crash-report consent,
the updater channel, the OpenDKP login, bids, the excluded-characters list, auto-start, and anything tied to
what is installed in the EQ folder. On import:
- per-character parts are re-pointed at the recipient's characters;
- positions are placed on the recipient's EQ screen as fractions;
- triggers that post to Discord arrive switched off, and sounds that point at a file on the sender's PC
  are dropped.

**Options (direct sharing; a file export/import underlies both):**

| | What it is | Build | Maintenance | Runtime | Change |
|---|---|---|---|---|---|
| **A. File + share code** | Export → a file, or "Get a code" (six characters, 24 h). The other person: Import → file or code → preview with ticks → pick which of their characters get the per-character parts | M (the collector and the preview are most of it; one table and two bot routes) | M: every new setting must be marked shareable or private. A test fails on unmarked keys | one row per share, ~50 KB, deleted at expiry | low |
| **B. File + send to a guildmate** | Pick a member; it arrives in their Mimic as "<name> sent you their setup — Preview / Import / Dismiss", via the existing notices | L: A's storage plus a picker, delivery, accept or decline, and limits against spam | M+: who-can-send rules | low | M |

- **Recommendation:** A now; B later on the same storage if people ask. For a household, both people are
  in the room, so a code is as quick as a push.
- The same table is also the 3.0 "back up your setup to your account" (§83 step 2): owner-only rows that
  never expire.
- **Today, on stable, by hand:** copy `personal_triggers.json` between the two installs with Mimic closed,
  then re-pick "For:" characters in Suggested triggers. Overlays: place by hand or use ✨ Auto-arrange.
- Waiting on the guild lead's pick. Then build on beta: Mimic and agent on `beta`; bot routes and the
  migration on `main`.

## §93 — Mimic setup walkthrough: two layouts on beta (2026-09-29, Mimic beta `a9f2db26` + `bbfe59e6`, agent 3.7.46)
*2026-09-29 · DECISIONS-2026-09-21.md · Mimic setup walkthrough two layouts*

The guild lead, reviewing another companion app's onboarding: *"i like the clickthrough. Build out a version
of this for mimic instead of the single setup view. It shouldn't look the same, and should show some of the
optional setup pieces that we have for /me and the abilities that entails"*.
- **`apps/mimic/welcome.html`, one step registry, two layouts.** They differ in shape, never in what they do:
  - **A (`?v=a`), the trail.** A rail of every step, one step at a time, Back / Skip / Next. The three
    needed steps hold Next until done.
  - **B (`?v=b`), essentials then unlocks.** Account, EverQuest folder and characters as a three-part
    stepper. Under it, Zeal, Set up EverQuest, Overlays, Your /me page and Old fights and chat are cards,
    opened one at a time in any order. "Open the dashboard" is always in reach once the gate passes.
- **The gate is the classic page's:** signed in or local-only, a folder saved, the engine up.
- **What it adds over the classic page:**
  - every optional step leads with a "What this turns on" box;
  - a main pick (`cfg.mainCharacter`) whose own log files are read at the finish when "read my main's
    whole log" is left ticked. Not a character set not to send; not a file already being read;
  - Zeal's install state with check and install;
  - Defender exclusions and the clock with their current state and the measured drift. These are the
    dashboard's three fixers, the same calls;
  - the /me abilities: tells, inventory, UI backups, parses, PoP flags, corpse DMs, UI Studio, crash reports.
- **Reached from:** the tray (✨ Setup walkthrough → A / B), the dashboard Setup card (✨ Walkthrough A / B),
  and a link on the classic page. **`loading.html` stays the first-run page until the pick.** Then:
  - `loading.html` sends a first run to the picked layout. Keep it for the engine-failed diagnostics;
  - the other layout is deleted in the same change;
  - web `/start`'s Mimic steps follow the same order.
- **Cost, four numbers each.** Both are one file, so the costs are nearly the same; the difference is who
  they suit.

  | | Build | Maintenance | Runtime | Change |
  |---|---|---|---|---|
  | A trail | S (done) | low: a step is one registry entry | nil | low |
  | B essentials + unlocks | S (done) | low: same registry | nil | low |

  A suits a first install: nothing to choose. B suits reopening it later to do one thing.
- **Found while building (the classic page):**
  - **Unticking "Transmit" only takes effect at the engine's next start** (`excludedCharacters` reaches the
    agent as an env var at launch). Until then that character's log still uploads. The walkthrough restarts
    the engine 2.5 s after the last change (`bbfe59e6`). The classic page is left as it is, since the pick
    retires it. If the pick waits long, give the classic page the same restart; it is one line.
  - **The tells radio (`cfg.tellsMode`) is stored and shown in the tray, but nothing reads it.** The agent
    never receives it; tells are governed on `/me/tells`. The walkthrough leaves it out.
  - **Nothing after setup edits the don't-send list.** The walkthrough can now be reopened for it; a
    Settings entry is still worth adding.
  - **Old logs, two paths.** The classic page saves `cfg.importedLogPaths` and restarts the engine. The
    dashboard hands paths to the agent's importer (`/api/optin` `import`). The walkthrough uses the
    importer: no restart, and the same list the Logsync tab shows.
  - **The Discord `/onboarding` Mimic card is stale** (`utils/onboarding.js`). It says "Mimic v1.0.0" and
    tells people to paste a `/token` into Settings, where Discord sign-in replaced that. This is bot copy,
    left for a bot change.
- **Tests:** `test/setup-walkthrough.test.js`, mutation-checked. It covers:
  - `gateOk`, `mainBackfillPaths` and the restart debounce, run for real;
  - every bridge call the page makes exists on `window.mimic`;
  - the `welcome-optin` relay over a fake http: only `import` and `backfill` pass, paths are cleaned and
    capped at 200;
  - tray, dashboard and preload wiring.
  Rendered headless at 1100 px and 390 px (no sideways scroll).

## §111 — Stable Mimic 2.7.5 (2026-09-30, agent 3.7.52)
*2026-09-30 · DECISIONS-2026-09-21.md · Stable Mimic 2.7.5*

The guild lead: *"new stable now please"*, after the Glory-worthy kill fix (§109) landed on beta. Every
Mimic below agent 3.7.51 misses those kills, so the stable was the fix's real delivery.
- **What:** everything on beta since 2.7.4 — the Canvas (§79, §87, §106), the Overlays tab option C
  (§107), screens and Rescue (§80, §80a, §82, §89), per-character suggested triggers and pets on the meter
  (§84, §85), bard charm (§75), the Quest tab warnings (§74), the /who Zone column (§73), UI Studio's Zeal
  bars (§80), the α alpha opt-in (§81), and today's fixes (§109, §110). FB-33, 34, 35, 38, 39, 41, 42.
- **How:** file-level promotion, as every cut: `apps/mimic/`, `packages/wolfpack-logsync/` and their 44
  tests copied from beta `fadf95f8`, byte-identical (a diff of those two trees against beta is empty).
  Seven tests for beta-only website pages stayed behind. Full gate on the promoted tree: 352 test files,
  lint and the dashboard check clean. Roadmap entry and web 1.8.57 in the commit below the stable one, so
  the release body comes from the stable commit's player notes.
- **Held back:** the setup walkthrough's two layouts (§93) still wait on a pick, and unpicked UI variants
  do not go to production. Rather than let main drift from beta, beta `fadf95f8` (agent 3.7.52) shows its
  tray entry and dashboard buttons on prerelease builds only, so the stable carries the page but offers no
  way in. When a layout is picked, it becomes the first-run page and the gate goes.
- **Beta re-parked at 2.7.6** above the stable, in the same session.
- **The alpha needs no re-park** (the guild lead asked): `3.0.0-alpha.N` sorts above every 2.x. But a
  sync never builds the alpha (it pushes with `GITHUB_TOKEN`), so alpha testers stay on the last alpha
  build until something is pushed to `alpha` under `apps/mimic/`. After this cut, alpha `640018c0` touched
  `apps/mimic/ALPHA.md` (not shipped) to build one; ALPHA.md now says so. The stable push's own alpha sync
  failed on add/add conflicts (main had the Canvas files by file copy, alpha its own); the beta sync a minute
  later carried main in cleanly, so alpha lost nothing.

## §118 — Local mode: Mimic for players outside the guild; eqmimic.quest (2026-10-01)
*2026-10-01 · DECISIONS-2026-09-21.md · Local mode for non-guild players*

The guild lead: *"i'm getting a lot of interest in individual users using this just for the overlays - can we
make a purely local version work?"* Picked A: *"I think A makes sense to begin with here"*. A means: stop
the leak and the nags, label the guild-only overlays, and ship the spell and item data inside the installer.

**A leak, closed (agent 3.7.58, beta `0ec64fef`, `v2.7.7-beta.7`).** With no token, the agent still posted
the upload queue and the live state (zone, buffs, pet) to the bot. Each post was refused with a 401, but the
data had already left the machine. It also polled the version endpoint every 10 minutes. Now `_localOnly()`
(started with no token): `enqueueUpload` drops, `_postLiveState` returns, and the drain and the version poll
are never started. Anything queued in an earlier signed-in session waits on disk for the next one. The
dashboard state carries `localOnly` (its "(local-only)" tag already read it; nothing set it before).
- **No nag.** `cfg.localOnly` is the saved choice: setup's "Run local-only", the welcome screen and the
  banner's new **Stay local-only** set it through the `set-local-only` IPC; `_setupIssue` treats it as
  finished; signing in clears it. `checkAgentUpdate` does not ask the bot without a token, because a local
  Mimic gets its agent inside Mimic's own releases, from GitHub.
- **Guild-only overlays say so.** Buff queue and Extended Target showed "loading" forever; now *"guild
  feature: it needs your raid's Mimics, so sign in to use it"*. Mob Info has no local source (the bot builds
  it) and stays empty in local mode; the eqmimic.quest pages list it under "needs a guild server".
- **What leaves the machine in local mode:** nothing to the guild server. Mimic still checks GitHub for its
  own updates and Zeal's. Checked by listing every host the agent and the Mimic shell contact; the rest are
  links a player clicks.

**Spell and item data in the installer (bot 3.1.180 `301a1274`; Mimic beta).** A local install never
fetches the catalogs, so without this its spell timers and buff names had nothing to read.
- `GET /api/public/catalog/<spell-catalog|item-clickies|item-catalog>` serves the agent routes' cached,
  ETag'd bodies without sign-in. Safe to publish: every row is from the `eqemu_*` mirror, already readable
  with the site's public key, and a hit is served from memory (no database read).
- `apps/mimic/scripts/stage-catalog.js` runs as `predist`, writes the three into `staged-agent/catalog/`
  under the agent's own cache names, and never fails the build (no snapshot = how every installer before
  shipped). On launch `seedBundledCatalog` copies each into the agent folder when it is newer than the copy
  there, so a signed-in install keeps what it fetched itself.
- beta.7's build log: 3,933 spells, 26,972 clicky items, and an item catalog of **1,000**, which is wrong:

**Found on the way: the wishlist item catalog served 1,000 of 11,104 items (bot 3.1.181 `f4557341`).** The
handler asked for pages of 2,000; PostgREST answers at most 1,000, so the first page came back "short" and
ended the loop. Every agent's on-disk item catalog has held only the 1,000 lowest item ids since it shipped
on 2026-08-30. **No player saw it:** nothing calls the agent's `/api/item-search` (the local wishlist search
was built, but no screen was ever wired to it), so the cost was this snapshot. The bot 3.1.181 commit
message says players' searches were affected; that is wrong, and this entry is the correction. `PAGE =
1000`; the test runs the real handler against a fake database with the 1,000 cap (2,500 in, 2,500 out; the
old value returns 1,000). The next beta build's snapshot carries the full list.

**eqmimic.quest.** The guild lead: *"And also a generic miMIC without all of the Wolf Pack detail would work,
we have eqmimic.quest domain now. Does a branch of the parser make sense?"*, then *"lets set this up to work
on eqmimic.quest please, vercel restricts me per project, perhaps this is something that can exist in the
hesstastic project"*.
- **Two page designs, in the hesstastic repo (`7b70545`), not yet picked.** A, demo-led: mock overlays
  over a scene, then the two lists and the steps (`hesstastic.com/eqmimic/`). B, ledger-led: "On your PC"
  beside "Needs a guild server", then privacy in three lines and a short FAQ (`hesstastic.com/eqmimic/b/`).
  Both noindex until picked. The download button asks GitHub for the newest installer with local mode
  (2.7.7-beta.7 or later, the newest stable once one exists) and falls back to the releases page.
  Costs: A builds slower and its mock drifts from the real overlays (maintenance and change: medium);
  B is cheaper on every count (all low). Runtime is the same: one page, inline styles, one GitHub request.
- **Hosting.** The hesstastic repo is a GitHub Pages site, and a Pages site carries one custom domain
  (already hesstastic.com), so Pages cannot serve eqmimic.quest from it. `vercel.json` there routes the
  eqmimic.quest host to `eqmimic/` for the Vercel project that builds that repo. It uses `routes`, not
  `rewrites`, because Vercel serves a matching file before a rewrite, and `/` would hit hesstastic's own
  `index.html`. **Unverified:** that a Vercel project builds that repo (the Vercel connector needs sign-in
  in this session), and the route itself until the domain is added.
- **A branch of the parser: no (recommendation, not yet decided).** A branch rots the way beta did
  (79,199 lines behind before the sync rule) and every fix has to land twice. Recommended instead: one
  codebase with a build-time edition switch. Mimic built as plain "Mimic" with its own app id (so it
  installs beside Wolf Pack Mimic), local mode as the default, the Wolf Pack surfaces hidden (sign-in,
  wolfpack.quest links, guild tabs), and its own update channel. That channel must follow the alpha's
  pattern, one rolling release, because GitHub's release feed keeps only 10 entries and Deck builds once
  pushed the Windows betas out of it. Four costs: build about 2 days (Wolf Pack surfaces are many and
  spread across `main.js`, the dashboard and setup); maintenance low-to-medium (every new guild feature
  needs the edition check); runtime none; change low. Until then, today's installer works for anyone
  in local mode, and the pages say why it is named Wolf Pack Mimic.

## §137 — Crash review moves to the Diagnostics tab (2026-10-03, agent 3.7.72 beta `1af59bd6`)
*2026-10-03 · DECISIONS-2026-09-21.md · Crash review moved to Diagnostics tab*

The guild lead: *"crash reporting should be on the diagnostics tab of mimic"*.

- The whole Crash review card (the "Automatically send crash reports" checkbox, Review my crashes, the
  results) now leads the 🩺 Diagnostics tab. Nothing about it changed; the auto-review still runs once when
  crash files exist.
- **Reverses 2026-08-13**, when the card was put on Info on purpose. The tray toggle still drives the same
  setting.
- Not built (offered by the scoping pass, not asked for): a per-crash "send this one" button and a
  sent/not-sent badge. They need an agent endpoint and a privacy-copy check, since reports are opt-in.

## §156 — A character's UI backups list only that character (2026-10-04, bot 3.1.197 · Mimic beta)
*2026-10-04 · DECISIONS-2026-09-21.md · UI backups list only that character*

The guild lead, after backing up nine characters at once: *"What 19 files were backed up for <main>? My
macros/socials/bandoliers?"* The Backups list under that character showed every character on the account,
unnamed, each with Restore. It was filtered by owner only.

- **Fix:** the bot filters by character too (`test/ui-layout-list-scope.test.js`, live in 3.1.197).
- **New:** Settings → UI backups → 📄 Files lists what a backup holds. The server stores the bundle encrypted
  and keeps no names, so it downloads the backup to list them.
- **What a bundle holds:**
  - `eqclient.ini` and `zeal.ini`.
  - Every top-level `.ini` named for the character: `UI_<Name>*` (layout), `<Name>_pq.proj.ini` (hotbuttons,
    socials, Zeal key binds), and Zeal's `_bandolier.ini` / `_spellsets.ini` / `_protected.ini`.
  - That main's backup was 18 files, with 98 socials indexed from `<Name>_pq.proj.ini`.
- **No harm from a wrong row:** restore writes each file under its own name. Another character's row never
  overwrote this character's files, only the shared `eqclient.ini` / `zeal.ini`.

## §176 — Mimic 2.7.9 stable, and members credited for their reports (2026-10-07, Mimic 2.7.9 · agent 3.7.96, `40af051a`)
*2026-10-07 · DECISIONS-2026-09-21.md · Stable 2.7.9, credit member reports*

The guild lead: *"making sure to attribute recent requests for our members suggestions, please roll out a fresh
stable version."*

- **The cut.** A file-level promotion, beta → main: `apps/mimic` and `packages/wolfpack-logsync` (agent 3.7.96),
  their tests and the `.gitignore` lines. That covers everything since the 2.7.9 park, `52526491` (agent 3.7.76 to
  3.7.96; `git diff v2.7.8 52526491` over those dirs is empty). Gate on the stable tree: 457 test files / 7,821
  tests, lint, `check:dashboard`, `golden:check`. Four beta tests stayed behind: about-figures, buff-groups-web,
  pvp-fight-sizes, pvp-fights-page. They check the /about, /buffs and /pvp B/C web previews, which wait on the guild
  lead's pick and stay on beta. Beta is re-parked at 2.7.10 (`fb48060c`).
- **Release notes = a `<!--player-notes-->` block** on the stable commit (it is the tip of its own push).
  - **Credit by role, never by name.** The release is public and the announcer reposts it. A member's item reads
    "(suggested by a member, FB-n)", or "(a member's request)" when no report number exists.
  - **The checks behind the tags.** `feedback.submitter_discord_id` was compared with the guild lead's id, so the
    lead's own reports carry no member tag: FB-1, FB-39–44, FB-47–49 and FB-51–53. My parses, the meter's Trend
    tab and the lag meter come from members' asks quoted in §170 and §163. FB-54 and FB-22 are members' reports.
- **The FB sweep.** Three Sonnet audits checked every open report against `origin/main`, `origin/beta`, `v2.7.8`
  and `origin/alpha`, with strict rules: done only when the code doing that exact thing was found. Then a
  spot-check confirmed each fix at `v2.7.8` or on `main`.
  - **The stable commit closes** FB-43 (the RIP gate, this cut) and repeats FB-54.
  - **The docs commit after it closes** FB-4, FB-5, FB-6, FB-9, FB-10, FB-11, FB-13, FB-14, FB-15, FB-18, FB-19,
    FB-25 and FB-36. Their fixes reached everyone in earlier releases, but nothing ever marked them done. All
    thirteen are members' reports, so each sender gets the bot's "done and live, thank you" DM. Most shipped
    before FB numbers existed (§159), which is why they sat open.
  - **Stay open.**
    - Partial: FB-3 (the "my last hit" kills), FB-22 (the current-fight copy still drops pets), FB-26 (no warning
      field in the personal trigger form), FB-37 (XP rows are collected; no per-hour view), FB-53.
    - Not done: FB-1, FB-12 (alpha only), FB-17 (needs Zeal), FB-21, FB-23, FB-24, FB-30, FB-31, FB-44, FB-52.
    - Unclear: FB-2, FB-8, FB-16, FB-20, FB-27, FB-28 and FB-32 (too vague to verify).
    - Alpha only: FB-40.
  - **Already closed early.** FB-51 and FB-54 were marked ✅ by their main bot commits before the Mimic half was
    stable. A report never moves backwards, so nothing re-sends.
- **Lesson for the next session:** a fix that ships without an FB line leaves the member's report open forever.
  When a change answers a report, the commit carries `Fixes FB-n` at the gate where the member will see it.

## §188 — The Linux build is refreshed from beta for a native-Wine tester (2026-10-08, branch `claude/deck-156-refresh` `b8fe506d`)
*2026-10-08 · DECISIONS-2026-09-21.md · Linux build refreshed for Wine tester*

The guild lead: a tester runs EverQuest under native Wine; picked A (refresh) *"because windows mimic in the same
wine is throwing wined3d errors"*.

- **Windows Mimic under Wine is out** for now: it throws wined3d errors in the tester's prefix. The native Linux
  AppImage plus the Zeal pipe bridge is the route (`docs/RUNBOOK-linux-zeal-pipe.md`, still unproven end to end).
- **What the refresh was:** beta merged INTO the Linux branch (never the reverse). It had been cut from main on
  2026-08-23 (586 commits behind main, 1,154 behind beta). Of its 108 own commits, 25 are Linux/Deck plumbing, kept
  and re-applied on beta's code; the rest were stale beta-era copies, overridden by beta. Builds now read
  2.7.10-linux.N, above the old 2.6.1-linux.N, so the updater offers it.
- **Also:** the Linux build now stages the offline spell/item catalog (`npm run predist`), as Windows does; and the
  branch's Deck-only prose names people by role.
- **Keeping it current:** the Linux branch does not follow beta by itself (no sync workflow). Re-merge beta into it
  before each Linux test round.

## §190 — Mimic 2.7.10 stable, and bot 3.1.222 + web 1.8.116/117 on main (2026-10-08, after 00:30 ET)
*2026-10-08 · DECISIONS-2026-09-21.md · Stable 2.7.10 cut and main push*

The guild lead, 2026-10-08: *"go ahead and push beta to main"*, and picked **A — cut stable now** over waiting for
the Group switch to be proven in play.
- **Main push (00:36 ET):** the session branch fast-forwarded `main` in two pushes, the web commit first, so Vercel
  built web 1.8.116 (its ignore step reads only a push's last commit). That carried bot 3.1.222 (§189 group scope),
  3.1.221 (encounter-script quest bits), 3.1.220 (hail board cap) and 3.1.219 (FB scanner by reachability).
- **Stable 2.7.10 (agent 3.7.106):** a file-level promotion like 2.7.9: `apps/mimic` and `packages/wolfpack-logsync`
  from beta, plus beta's tests except sixteen that check website or bot work still on beta only (the guild-kit web
  module and tag sweep, `/parses` 7-day default, `/about` and `/pvp` previews, `/buffs` groups, admin row-cap pages,
  guild trigger timer fields) and one main owns newer (`pgrst-cap-bot-reads`). Gate on that tree: 487 files /
  8,801 tests, lint, check:dashboard and golden:check clean. Roadmap entry in web 1.8.117, pushed on its own first;
  the stable commit is the tip of its push so its notes become the release body.
- It closes FB-12, 16, 21, 22, 23, 26, 30, 31, 52, 56, 57, 58, 60, 61, 62, 63 and 65. FB-59 (`/parses` default) is a
  website change still on beta; FB-64 is alpha-only; FB-66 is on the Linux branch.
- Beta re-parks at 2.7.11.

## §195 — Mimic can draw overlays without the graphics card, and setup asks (2026-10-08, Mimic beta `3ba7154a`)
*2026-10-08 · DECISIONS-2026-09-21.md · Software rendering option for overlays*

A member reported Mimic "crashing his computer": the whole screen went black with Windows' device-disconnect
sound, one character, an RTX 50-series card on an older board — a graphics-driver reset, not an app crash
(no crash rows, uploads healthy). Every overlay is a transparent always-on-top window composited on the
graphics card over a DirectX 8 game, and each show/hide/resize can flip how Windows presents the game; newer
50-series drivers have been fragile exactly there. The guild lead picked **A — a switch to draw overlays in
software**, and *"ask people as they set up"*.
- `cfg.disableGpu` (default off = graphics card), read off disk before app-ready, `app.disableHardwareAcceleration()`
  when on; a missing or torn config keeps the graphics card.
- Settings ("Use the graphics card for overlays") and the tray checkbox share `_setGpuDrawing` and offer
  Restart now / Later. The setup walk's optional "Screen flicker" step asks *"Has your screen ever gone black,
  or flickered, while EverQuest and an overlay app were running?"* and lands on the next start (setup never
  restarts mid-walk).
- Cost: overlays use more processor. Member-facing text says "graphics card", never GPU/acceleration.
- Also told the member: newest driver (clean install), hardware-accelerated GPU scheduling off, windowed or
  borderless EQ, and event 4101 in Event Viewer to confirm the reset.

## §199 — Mimic agent-only mode, switchable both ways (2026-10-08, agent 3.7.110 · Mimic beta `8cf8bcc7`)
*2026-10-08 · DECISIONS-2026-09-21.md · Agent-only mode switchable both ways*

**The call** (the guild lead): *"update the installer to have agent only mode and a way to update it to have full
mimic, and vice versa"*, then picked **A — one install, a mode switch** over a second installer.
- **Where it landed:** `cfg.runMode` ('full' default, or 'agent'), read off disk before any window exists and fixed
  for the run, like the graphics-card switch (§195). Agent only keeps uploads, the tray, the dashboard and the
  spoken trigger callouts (the trigger window stays alive and hidden, the one voice); every overlay window is left
  out. The setup walk asks which one; Settings, the tray and the dashboard's Overlays tab switch it later and offer
  a restart (tray ↔ dashboard parity rule). The tray hides overlay-only items in agent only and shows a "Spoken
  trigger callouts (TTS)" check instead.
- **Why one install:** a second installer doubles the release work and the updater channels, and switching would
  mean uninstalling. The overlay code is on disk either way; agent only just never opens it.
- **Guard:** `test/mimic-agent-only-mode.test.js` fails any `create*Overlay` / `create*Window` without the gate.
- Graduates with the next stable cut.

## §207 — Mimic 2.8: stable 2.8.0 on main, beta re-parked at 2.8.1 (2026-10-08, 18:27 ET)
*2026-10-08 · DECISIONS-2026-09-21.md · Stable Mimic 2.8.0, beta repark*

**The asks** (the guild lead): *"we should move to 2.8, don't mention the loot page"*, then *"main to 2.8.0, beta repark 2.8.1"*.
- **Cut:** `9f1dea7f` on main, Mimic 2.8.0 + agent 3.7.113, a file-level promotion of `apps/mimic/**` and
  `packages/wolfpack-logsync/**` and their tests from beta (never a branch merge; beta carries web and bot work that is not
  ready). Pushed before the 19:30 ET raid freeze, on its own, so the commit body is the release body (its `player-notes` block).
  Beta re-parked at Mimic 2.8.1 / agent 3.7.114 (`04a47a2f`).
- **The Loot page is not announced:** the release notes and the roadmap entry name nothing about it, by the guild lead's call.
  The Loot tab code is in the build; it is just not mentioned. Not a bug or a leak: do not add it to the notes later without
  asking.
- **Web roadmap entry** (web 1.8.126) went out as its own push AFTER the stable commit, so the Mimic commit stayed the tip of
  its push (release body) and the web commit stayed the tip of its own (Vercel's ignoreCommand compares only the last commit).
- **Linux:** the `linux-follow-windows` workflow (§206) turns the stable into `2.8.0-linux.N` and the next beta into
  `2.8.1-linux.N`.

## §231 — Mimic 2.8.1 stable cut from beta as-is; the beta sync had been failing all evening (2026-10-10)
*2026-10-10 · DECISIONS-2026-09-21.md · Stable 2.8.1 cut from beta*

- **The ask** (the guild lead): *"cut a fresh stable mimic for this evening with the updates for the birthday"*.
  Nothing named a birthday anywhere (repo, branches, briefing); asked, the guild lead picked **all of beta as-is**.
- **Shipped:** `main` `d76fedbc` (web 1.8.141, the roadmap entry, pushed alone) then `3200f49b` (Mimic 2.8.1,
  agent 3.7.127, pushed alone so it is the tip; player notes in the release body). Release `v2.8.1` published
  23:17 UTC. File-level promotion of `apps/mimic` + `packages/wolfpack-logsync` from beta (byte-identical) plus the 17
  agent/Mimic tests beta had added or changed; web and bot beta work stays on beta. Graduates FB-72 and FB-73.
  Gate: dashboard check and lint clean; the suite passed 9,842/9,842 on the second run (the first run had one
  load-timing failure in `pgrst-cap-bot-reads`, a bot test, which passes alone with and without the promotion).
- **Beta sync repaired by hand:** `sync-beta.yml` had failed on every main push since 19:33 UTC (conflicts in
  `web/package.json` and `web/public/zeal/PROVENANCE.txt`), so beta was missing the day's main work. Hand-merged on
  beta (`483210ef`): `web/package.json` takes main's 1.8.141, PROVENANCE keeps beta's guildicon-draft paragraph;
  beta's full suite 10,103 passed. Then re-parked at **2.8.2** (`9738bb0c`). A sync failure is loud only in Actions:
  check its runs before a stable cut.

## §232 — Merging socials across machines: scoped, options out; UI backups now owner-only (2026-10-11)
*2026-10-11 · DECISIONS-2026-09-21.md · Merging socials across machines, backups owner-only*

- **The ask** (the guild lead): *"we should be able to merge socials across machines with the knowledge from today.
  directly into characters files while making a backup"*.
- **What exists** (two research agents): Mimic's ☁ backup already uploads each character's whole file set, with the
  machine's name, and ↩ Restore writes a whole bundle back (refused while EQ runs, `.bak` first). The agent and Mimic
  both have key-level ini writers that wait for the character to log out (`_applyIniKeyEditsToFile`,
  `apps/mimic/iniKeyEdits.js`). Missing: a socials-only merge, any `[CustomValid]` handling (§227: a file without
  `Valid=42` seemed to make the client ignore `[Socials]`), automatic capture, and pruning of `.bak` files.
- **Fixed first:** the UI-backup and staged-UI-edit routes now answer only to the character's owner (bot 3.1.243,
  `7d93301f`; details in the guild lead's private briefing).
- **Open:** the guild lead picks between pull-from-my-other-PC, automatic sync and a web hub.

## §234 — EverQuest on an Android phone: the Winlator route, written up as a draft (2026-10-11)
*2026-10-11 · DECISIONS-2026-09-21.md · EverQuest on Android via Winlator*

- **The ask** (the guild lead): *"let's get back to getting this to work on mobile"*. This means the Windows
  client under Winlator, after a third-party build was dropped for the official one.
- **Landed:** `docs/RUNBOOK-android-winlator.md`. It carries the Deck's working renderer chain across
  (dgVoodoo `D3D8.dll` + `dgVoodoo.conf` → D3D11 → DXVK → Vulkan, now on Turnip), along with its failure
  signatures, the `patchme` + working-directory launch, and the FPS cap. Every Winlator-specific step is marked
  [verify]: a web search found no report of EverQuest under Winlator or its forks.
- **Scope:** EverQuest + Zeal on the phone. Mimic and log uploads stay on the PC. Streaming from the PC
  (Moonlight/Sunshine or Steam Link) is the dependable route when the overlays matter.
- **No device details** go in the runbook or a report (the guild lead's standing "don't post my PII").
- **Follow-up, the same night:** *"people are running games in browsers now as well, perhaps that's a way forward
  with mimic in the mix?"* Two research agents:
  - no browser EverQuest client can reach Quarm, and Windows-in-the-browser runs at about 1 fps;
  - Mimic's overlays could run in a phone browser against an agent in Termux, log-driven panels only.
  Options went out: **A**, stream the PC (Mimic comes along unchanged); **B**, phone-only, with a Termux agent and
  browser overlays (a small agent change, and only after Winlator boots EverQuest). **Open:** the guild lead
  picks. Recorded in the runbook's last section.

## §272 — Mimic 2.9.0, the Cartography Release, and the Map training page (2026-10-13, stable `700dc1f9`, web 1.8.146 `7d1e179a`)
*2026-10-13 · DECISIONS-2026-09-21.md · Mimic 2.9.0 map release and training page*

- **The call** (the guild lead): *"push out a new minor release as 2.9, the Cartography Release, focused on the map.
  add a training page on the map to send out to the users, give me some samples ... simple terms please, but talk
  about persistence."* The release name is the guild lead's.
- **Shipped:** Mimic 2.9.0 stable (agent 3.7.156) graduated from beta: `apps/mimic`, `packages/wolfpack-logsync` and
  their 27 tests; the website and bot work on beta stays there. Beta re-parked at 2.9.1 (`8255c70a`). Release body
  from the `player-notes` block; `Fixes FB-77` repeated so FB-77 moves to Implemented.
- **Training page** `/mimic/map` [beta], two samples: Guided tour (default, eight lessons) and Cheat sheet (`?v=b`).
  The persistence claims were each checked against the code. One correction to what we had been saying: respawn
  timers are not only local, they are shared with your raid or group (never "?" guesses, never positions).
- **Open:** the guild lead picks a sample; the other is deleted in the same change.

## §331 — Mimic 2.9.1 stable (agent 3.7.176), and why `pop-quests.js` stayed behind (2026-10-14)
*2026-10-14 · DECISIONS-2026-09-21.md · Mimic 2.9.1 stable release*

- **The call** (the guild lead, 2026-10-14): push all of today's beta work to main.
- **Shipped:** `apps/mimic` and `packages/wolfpack-logsync` from beta `acd4f048`, plus the Mimic/agent tests, as a file-level
  promotion (no merge). Roadmap entry + web 1.8.159. Beta re-parks at 2.9.2. No new FB numbers in this cycle (FB-77 went out with 2.9.0).
- **`apps/mimic/pop-quests.js`** is GENERATED from `web/lib/popGuide*.ts`, so it travels with the web PoP guide. The web PoP graduation
  (web 1.8.158, `42c117c4`) carried beta's copy and `test/pop-overlay-quests.test.js` to main before this cut, so the 2.9.1 installer
  ships the beta guide's quests. (The prep note said it stayed behind; that was written before the graduation landed.) Web-only tests stayed behind.
- **Bot routes the promoted code calls are already on main:** `/api/agent/charm-pets`, `/api/agent/pronunciations`, the live-state
  target fields (bot 3.1.263). Each degrades quietly if absent (404 hides the section / turns names off).

## §339 — UI Studio: picking a character shows their current UI as it is (2026-10-15, Mimic beta)
*2026-10-15 · DECISIONS-2026-09-21.md · UI Studio shows character's current UI*

- **The reports** (the guild lead): *"LOAD AND RESCALE in ui studio is not loading in my current configuration, only
  the ones that i saved"*, *"Update from current did not update from what my current actually is"*, and *"selecting the
  character from the UI studio dropdown should just pull up the current configuration in the current format, no
  conversion target necessary."*
- **What the code showed:** both buttons already re-read the live files on disk every time; neither reads a saved
  layout. Likely causes: (1) Load + Rescale renders the block for the Source dropdown's resolution (default
  2560×1440), and EverQuest keeps old `XPos<W>x<H>` blocks, so a stale block wins over the one in use; (2) EverQuest
  writing window positions only on camp/zone/quit (unverified), so the disk lags the screen. "Update from current"
  also never refreshes the canvas.
- **Built (Mimic beta `5ce28ec4`):** picking a character loads their live files at their own resolution with no
  conversion — eqclient.ini `[VideoMode]` Width/Height when the UI file has a block for it, else the block with the
  most windows; other blocks are named on the status line. Load + Rescale stays the explicit conversion step. The
  status line and the Update confirm show "UI file last written <time>".
- **Open:** the guild lead to check at the PC whether that time changes after /camp or zoning and stays put while only
  dragging windows (confirms or kills cause 2).
- **Same day, "DELETE BUTTONS DON'T WORK IN UI STUDIO. LOAD DOES." (Mimic beta `2ee913cb`):** the chat-window 🗑 was the
  broken one; the named-layout Delete works (driven end to end in jsdom against the real store). Three causes: the
  refusal for unsaved window moves showed only as a note at the top of the chat block; a Save never re-baselined the
  window positions, so the refusal stayed until the next Load; and any pointer wobble on a click counted as a move.
  Fixed: the refusal shows in that window's card and the status bar and names the way out; a successful Save becomes
  the new baseline (and the open inspector adopts the saved chat geometry, so a later delete cannot write stale
  positions); a press must travel 4 px before it drags.

## §367 — Mimic 3.0 graduates to the beta channel; alpha re-parks at 3.0.1 (2026-10-18)
*2026-10-18 · DECISIONS-2026-09-21.md · Mimic 3.0 moves from alpha to beta channel*

The guild lead: *"move the alpha work all up to beta 3.0 and move alpha to 3.0.1."* The 3.0 overlay-builder (the Canvas,
overlays-as-panels, Pieces and everything §160–366 built on the alpha line) is now the Windows **beta** channel, not a
separate alpha-only line. Mechanics, for the next session that touches these branches:
- `alpha` was `beta` + the 3.0 overlay-builder and nothing else (verified: `beta` was an ancestor of `alpha`, and the
  delta was only `apps/mimic/{canvas,sections,parts,preload}` + the overlay part-hooks + their tests + these docs — no
  bot/web divergence). So graduating was a `--no-ff` merge of `alpha` into `beta`, which brought exactly the 3.0 work.
- **Parks:** `beta` park moved `2.10.0` → **3.0.0** (the channel now builds `3.0.0-beta.N`); `alpha` re-parked
  `3.0.0` → **3.0.1** so it keeps leading beta by semver and builds `3.0.1-alpha.N`. `sync-alpha` keeps alpha's park on
  a conflict, so the two stay apart on their own.
- **The agent is unchanged** — alpha always carried beta's agent, so the 3.0 beta runs the same agent line the 2.x beta
  did; nothing on the agent moved.
- The beta graduation commit (`da3ad2e8`) carries the member-facing 3.0 notes in a `<!--player-notes-->` block, so the
  #mimic-releases announcer reposts those, not a git log.
- **Not yet done:** a roadmap entry (`web/lib/roadmapData.ts`) for the 3.0 beta line — held for the guild lead's wording
  since 3.0's public name is their call; and the usual in-game beta checks (the D/B/E items in the §360 row).
- ⚠ **This is the beta CHANNEL, not stable.** 3.0 has NOT graduated to `main`/stable; the whole 3.0 estate (code + these
  §360–367 docs) flows to `main` only when the line is cut stable.

## §391 — Live EverQuest (log-only Mimic): yes, legal review first (2026-10-20)
*2026-10-20 · DECISIONS-2026-09-21.md · Log-only Mimic for live EverQuest, legal first*

The answer is yes to a log-only Mimic for live EverQuest, after a legal review of what it may read and send. No code
until the review is back; nothing off Quarm uploads today (§377).

## §404 — The 3.0 cut rebuilt on the 2026-10-21 main: Raid Mimic, the hub route, and what is held (2026-10-21)
*2026-10-21 · DECISIONS-2026-09-21.md · 3.0 cut rebuilt on current main*

The first `release-3.0` branch went stale the same day (beta took agent 3.8.49 to 3.8.57 and web 1.9.22 to 1.9.29), so
the cut was redone as `release-3.0b`: file-level promotion from beta `e382b151` onto `main` `ff98babe`, still no branch merge.
- **Added to beta since the first cut:** 3.8.49 roll calls in the "Item x6 - 555" form; 3.8.50 raid codes let the live overlay
  streams through; 3.8.51 Death Touch never fires for a pet destroying itself; 3.8.52 the Map aggro circle follows the mob;
  3.8.53 "Can see invis" and a /consider while invisible proving or cancelling it; 3.8.54 the Tactics timeline counts down no
  pair windows (the encounter script has none; the notes no longer promise countdowns); 3.8.55 Command Center Last deaths
  always names who died and rows can be dismissed; 3.8.56 the Map stops copying one name-only health onto a pack; 3.8.57 the
  Canvas is a choice in the setup tour and "Take the tour again" sits in the tray and on the dashboard. Mimic: Canvas resize
  corner, "Keep inside the screen", text-size slider, the timers header on the Map, local-site back and forward, a dashboard
  drag guard (a guard plus evidence, not a proven fix). Web: raid share links can be extended or follow the raid.
- **The app is renamed Raid Mimic (option A):** same appId `quest.wolfpack.mimic`, package name `wolfpack-mimic` (so
  `%APPDATA%\wolfpack-mimic` and every setting carry over), `productName` "Raid Mimic", artifacts `Raid-Mimic-*`. The
  download routes, the release announcer, `/admin/agents` and the Linux helper accept BOTH installer names and land
  BEFORE the rename in the push. The Map's built-in walls now read "walls: built-in" instead of "walls: Wolf Pack".
- **Carried from the first cut:** the `local-sync` route and its migration FILE (bot, applied by hand), the privacy
  page's on-PC paragraph, and the approved setup page `/raidmimic/setup` (marked [beta]).
- **HELD, not promoted (no pick yet):** the raidmimic landing previews (output gallery, mascot hero, their images and
  the screenshot scripts) and the PoP Flags sticky controls bar (web 1.9.23). They stay on beta.
- **Versions:** bot 4.0.0, web 2.0.0, agent 4.0.0, Mimic 3.0.0, Bristlebane 1.0.0. Unnamed ("Version 3.0"). The release body
  no longer mentions the Decorin and Tallon / Vallon countdowns.

## §412 — Windows jumping to the top-left while dragged (2026-10-22, open)
*2026-10-22 · DECISIONS-2026-09-21.md · Windows jumping to top-left during drag*

The guild lead's screen recordings (and a member's report): the dashboard, dragged by its own title bar, snaps several times a
second to about (0,0); the Dock overlay jumps and collapses during its ✥ drag. The pattern is a native `SetWindowPos` restack
without `SWP_NOMOVE`, or another periodic writer moving a window mid-drag; a fix is being built on beta with a log line that
proves it on the next report. Same batch: Target Info cached a failed mob lookup for 6 h (a bot redeploy at the first target hid
a mob's stats and resists, e.g. hobgoblins) → a miss now retries within a minute; overlay windows get crash recovery.

## §453 — Mimic 3.0.5 stable, and everything on beta to main (2026-10-27)
*2026-10-27 · DECISIONS-2026-09-21.md · Mimic 3.0.5 stable, beta promoted to main*

The guild lead: *"PUSH TO MAIN for a new release"*. Commit 74181d15 on main: a file-level graduation of every file on beta that
differed from main (143), so main's tree equals beta's plus the roadmap's 3.0.5 entry. Mimic 3.0.4 → 3.0.5 stable, agent 4.0.30, web
2.1.57 (the beta-only web work goes live: Brewall raid maps, raid groups and the Kills tab, parse classes and chart fit, the wishlist set,
the gear finder's quest/tradeskill sources and caps, Summon first). One commit so Vercel's last-commit check deploys the web and the
release body is that commit's player notes. It repeats `Fixes FB-98, FB-99, FB-100, FB-102, FB-103, FB-104`; FB-101 stays open (XL / M).
The beta sync failed on the roadmap again and was merged by hand (main's roadmap is beta's plus the 3.0.5 entry); beta re-parked at
3.0.6 (e1d330a9).
