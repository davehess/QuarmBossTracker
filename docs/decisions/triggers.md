# Triggers, callouts & voice

Guild and personal triggers, trigger timers, voices, callout wording. Oldest first. Find an entry by its ID in [the index](README.md); new decisions go in `inbox/` and are merged here.

## 2026-08-07/7 — Triggers — the `{s}` timestamp swallow (2026-08-09)
*2026-08-09 · DECISIONS-2026-08-07.md · Unanchored name capture was eating the timestamp*

**An unanchored pattern opening with `{s}` was eating the timestamp.** When
`compileTriggerPattern` replaced `_translateDotNetRegex`, `{s}` went from an
allow-list char class to `.+?`. The old class could not match `[`, so the engine
skipped past `"[Sun Aug 02 21:10:45 2026] "` on its own; `.+?` at index 0 of an
unanchored pattern consumes it happily. So the capture contained the timestamp.

This was the RECOMMENDED shape — `CLAUDE.md` tells authors to write patterns
unanchored, because a bare `^` anchors before the timestamp and can never fire.
The `^`-rewrite path had a guard and its comment claimed "a leading {s1} no
longer swallows the timestamp"; that was only ever true for `^`-anchored
patterns. Live casualty: the **Razor Fang** guild trigger. A timestamp inside a
name capture breaks every name-keyed consumer at once — charm-pet suppression
stops recognising your own pet, action text and TTS speak the timestamp, and a
captured timer key mints a new bar per fire.

Fix: `_expandTriggerTokens` reports `leadingWildcard`, and `compileTriggerPattern`
prepends the same OPTIONAL `^(?:<ts>)?` prefix the anchor rewrite uses when a
pattern is unanchored AND opens with `{s}`/`{n}`. `{c}` is exempt — it expands to
a literal alternation that cannot match inside a timestamp.
→ agent 3.5.54, pinned by `test/trigger-class.test.js`.

**Found only because the graduation ran main's suite.** `test/trigger-class.test.js`
does not exist on `beta`, so agent 3.5.44–3.5.53 shipped with nothing checking
this. Same class of gap as the 2026-08-04 "CI runs on beta now" P0.

## 2026-08-10/1 — Tank-buster callout moved from "as it happens" to a prep sequence
*2026-08-10 · DECISIONS-2026-08-10.md · Tank buster callout becomes timed prep warnings*

**The call (the guild lead, post-Ssra):** the Emperor tank buster needs a warning at
**10s** ("big heals and spell shields") and at **4s** ("start curse cures") —
not a single announcement when it lands.

**Why.** The prep is a sequence, not a reaction: shaman/druid off-heals want to
be in flight ~10s out so they land *into* the hit, spellshields have to be up
before it, and curse cures started at 5/4/3s strip the curse the instant it
lands so the follow-up heal is fully effective. A callout at T-0 is too late for
every one of those. On the wipe pull a member — who normally calls this
verbally — was busy stabilising after a member died, so the raid got nothing.
**That is the case automation exists for: the raid leader is a single point of
failure and is least available exactly when the raid most needs the call.**

**What was actually wrong.** Nothing missing in code. `guild_triggers` supports
multiple warnings via the `timer_warnings` jsonb column (agent 3.5.52, the
EQLogParser-parity work; the fleet is on 3.5.54/3.5.55, so every raider already
has it). The trigger `Emperor Ssra Tank Buster — countdown`
(`0680b9f6-e5e4-4a29-87cb-78c0b1ae1b83`) simply had `warning_seconds = null` and
no `timer_warnings` — it spoke once on match, then counted 60s in silence.

**Applied 2026-08-10, DB only, no release:**

```sql
update guild_triggers set timer_warnings = '[
  {"seconds": 10, "text": "10 SECONDS. BIG HEALS AND SPELL SHIELDS.", "tts": true},
  {"seconds": 4,  "text": "START CURSE CURES", "tts": true}
]'::jsonb where id = '0680b9f6-e5e4-4a29-87cb-78c0b1ae1b83';
```

Shape per `_timerWarnings`: `seconds` counts *before* expiry, `text` drives both
the overlay and the spoken line, `tts` defaults true. Sorted descending, so 10s
fires before 4s.

**Revert** (back to silence): `set timer_warnings = null`.

**Caveats.**
- The warnings inherit whatever accuracy the 60s cadence has. If the buster
  drifts, they drift with it — the « Earlier / ✓ Good! / » Too early buttons on
  the callout remain the way to correct it.
- This adds two spoken lines per 60s cycle, raid-wide, for the whole Emperor
  fight. That is a deliberate raid-noise trade against the alternative of the
  prep not happening. If it reads as too chatty, drop the 10s line first — the
  curse-cure call is the one with no verbal substitute mid-crisis.

## 2026-08-10/7 — DI callout: the guild lead's four calls (2026-08-11)
*2026-08-11 · DECISIONS-2026-08-10.md · Divine Intervention callout selection rules*

X OR Y when both are ready and neither is about to CH; clerics only (druids
cannot DI); when the Mimic-running clerics are known-not-ready, rely on the
non-Mimic ones (unknown stays eligible, measured-down never does); and **the one
casting calls it out** — the selector nominates, a human closes the ambiguity on
voice. Points 1–3 were confirmed as already shipped in 3.5.59's ranker; point 4
landed in 3.5.60 as the "— caster call it" cue on the TTS and overlay text.
Full mapping in `DESIGN-di-callout.md` §7.

## 2026-08-20/1 — DT countdown: a gated fire on a timer-bearing trigger still ARMS the timer (the guild lead, mid-raid)
*2026-08-20 · DECISIONS-2026-08-20.md · Gated fire on timer trigger still arms timer*

**The call.** *"we still missed the deathtouch timer from the second cursed
cycle mob on a pet."* Two holes, two fixes: (1) the guild trigger's target
capture had no space in its class, so multi-word victims (warders, charm pets)
never matched on ANY agent — pattern broadened in the `guild_triggers` row
directly (live in ≤2 min via the poll, no deploy); (2) the
`require_raid_member` gate early-returned BEFORE `_startTimer`, so a fire whose
victim an agent couldn't prove dropped the whole countdown — agent **3.5.93**
arms the timer on a gated fire and suppresses only the text/tts actions.

**Why.** A DT countdown is CYCLE state, not a victim callout — a Death Touch
spent on anyone's pet still means the next one is 120s away. This deliberately
INVERTS the 2026-08-09 note that treated "a pet got a countdown" as the bug;
the inversion is recorded in the trigger row's notes so it doesn't get
re-fixed backwards.

**Where it landed.** `packages/wolfpack-logsync/index.js`
(`_fireTriggerActions`), guild_triggers `d1a04e39…`, beta build off `0debca07`.

## 2026-09-06/1 — A trigger placeholder only resolves if its capture group ALWAYS participates
*2026-09-06 · DECISIONS-2026-09-06.md · Placeholder needs capture group that always participates*

The guild lead, mid-raid: *"this one trigger is showing {tank} instead of the tank's name
on the overlay. what should the syntax be?"*

**The syntax was never wrong — the capture was conditional.** The old pattern:

```
(?:(?<tank>\w+) feels the watchful eyes of the gods upon them|You feel the watchful eyes of the gods upon you)\.
```

Two branches, and `tank` lives in only the FIRST. When the self-cast line
matched ("You feel…") the group did not participate, so `m.groups.tank` was
undefined. `_buildCaptureBag` only copies groups that are non-null, and
`_expandTemplate` leaves an unresolved token **exactly as written** — by design,
so literal braces in a callout survive. Hence a literal `{tank}` on the overlay,
and "D I landed on open-brace tank" out of TTS.

**The fix is one group over both wordings, not a second placeholder:**

```
^\[.+?\]\s+(?<tank>\w+) feels? the watchful eyes of the gods upon (?:them|you)\.
```

`feels?` covers "feels"/"feel" and `(?:them|you)` covers the tail, so the ONE
`tank` group captures on both lines — the name when it is someone else, the
literal word **You** when it is you, which reads correctly in both surfaces
("D.I. ✓ You"). Verified against the real spell text: `eqemu_spells` 1546,
`cast_on_other` = "feels the watchful eyes of the gods upon them.",
`cast_on_you` = "You feel the watchful eyes of the gods upon you."

⚠ **Duplicate named groups are NOT an option** — `(?<tank>…)|(?<tank>…)` is a
SyntaxError on the Node the fleet runs. One group covering both wordings is the
only shape that works.

**Also anchored past the timestamp** (`^\[.+?\]\s+`, the `TIMESTAMP_PREFIX`
convention in `web/lib/triggerPattern.ts`). The negative tests found the old
unanchored pattern fired on a guild-chat line QUOTING the message — a raider
pasting "You feel the watchful eyes of the gods upon you." set off everyone's
D.I. callout. Anchoring makes the message have to START with the name.

### The general rule, for the next one

A `{placeholder}` renders literally whenever its group did not participate in
the match. Two ways that happens, and the second is the sneaky one:
1. no group of that name exists in the pattern at all;
2. the group sits inside ONE branch of an alternation.

An alternation that does not contain the group (a damage-number choice, a
list of spell names inside the group) is fine. Check whether the group is on
every path, not whether the pattern has a `|`.

## 2026-09-06/2 — Two more found by the same sweep — NOT changed, awaiting a word
*2026-09-06 · DECISIONS-2026-09-06.md · Two more unresolvable trigger placeholders found*

A sweep of all 120 guild triggers for unresolvable placeholders flagged five;
three were benign (the alternation does not touch the captured group:
"Death touch — countdown", "AOE — dodge", "Resisted (your cast)"). Two are real
and are left alone because only the D.I. row was asked for, and both would be
live edits during a raid:

- **`Carnage` (enabled)** — overlay text is `Carnage: >>> ${name}` and the
  pattern is the bare string `prepares for carnage!` with **no capture group at
  all**, so it has always rendered `${name}` literally. Fix, same shape as
  above, against `eqemu_spells` 2158:
  `^\[.+?\]\s+(?<name>[\w'` -]+?) prepares for carnage!`
- **`Copied Carnage` (enabled)** — pattern `You prepare for carnage!` but the
  real `cast_on_you` is **"You prepare for carnage."** with a PERIOD. The `!`
  cannot match, so this trigger has never fired. It is the self-side of the pair
  above, which is why nobody noticed: the other one fires and shows `${name}`.

Both are one-field updates whenever the guild lead wants them.

## 2026-09-06/3 — Note — the D.I. row was edited during a raid, deliberately
*2026-09-06 · DECISIONS-2026-09-06.md · Trigger row edited live during raid*

`guild_triggers` is a database row, not a deploy: `_guildTriggersFor` reads
Supabase live and the fleet picks it up on the ~2-minute poll, so no restart and
no push. The raid-night freeze covers pushes to `main` (which redeploy Railway
and Vercel); it does not cover this. **The doc you are reading was committed
during the freeze and pushed after it lifted at 00:30 ET.**

## 2026-09-10/8 — The relay scope gate never worked, and now fails closed outside a raid (guild lead, 2026-09-11)
*2026-09-10 · DECISIONS-2026-09-10.md · Relay scope gate fails closed outside raid*

The guild lead, alone on a member in Vex Thal, kept getting "Shaman Slow" callouts:
*"I'm not in a zone with another guild member, or in a group, or even a raid.
These random slips need to stop."* The fires were a member's — Turgur's Insects
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

## §59d — Trigger timers can start at the top (agent 3.7.34, beta)
*2026-09-21 · DECISIONS-2026-09-21.md · Trigger timers can start at top*

The member's own words, relayed by the guild lead: *"It would be nice if the trigger timer had an
option to start the timers at the top, and go down with successive triggers to track, instead of
always starting at the bottom of window and growing up."* Right-click the trigger overlay →
**⇅ Timers start at: TOP**. On: `#timers` hangs off the top edge below the ✥/🗑/✕ gutter (34 px, 58 px
in setup) and reads down, the centred callout column is pushed DOWN off the stack instead of up, and
the window's ⬆ grow-upward is switched OFF for this overlay — without that, auto-height keeps the
bottom edge fixed and walks the first timer up the screen as rows arrive. Off restores both (the
grow entry is deleted so the default returns). The bottom-anchored default stays the default: it is
the guild lead's 2026-08-10 call that the screen centre is reserved (v2 §3). One option, not
variants: it is a small change inside an established overlay, and the member described exactly
what they want. `cfg.triggerTimersTopDown`; test `charm-break-instant`.

## §189 — Callouts and Extended Target keep to your raid, or your group when you are not in one (bot 3.1.222, 2026-10-08)
*2026-09-21 · DECISIONS-2026-09-21.md · Callouts stay within your raid or group*

The guild lead, 2026-10-07 ~22:40 ET, after the raid broke into groups: *"We need to do a better job of not leaking
other group's mobs or callouts when we're not in a raid mode."* The Extended Target screenshot (not in a raid, "21
online · MA …", five mobs targeted from other groups in the same zone) had the same cause as the relay's.

- **Two leaks.** (1) The trigger relay kept every guild callout guild-wide for the whole Sun/Wed/Thu 19:00–01:00 ET
  window, and for 10 minutes after any raid-roster upload, whether or not the listener was in a raid. (2) The bot
  scoped Extended Target by ZONE only; the "outside a raid, only your group" rule lives in the agent
  (`_scopeExtToGroup`, `EXT_RAID_FRESH_MS` 60 s) and steps aside whenever a Zeal raid window arrived in the last
  minute, or the Mimic has no fresh group list. A raid that only splits into groups stays one raid, so the board
  is still raid-wide by design.
- **The rule (`utils/groupScope.js`, decided from data, not the clock):** in a raid = the live roster (an uploader's
  latest `raid_roster`, 2 minutes, the §124 `groupRaids` rule) puts the listener's account or character in one;
  else their GROUP when the Mimic told the bot; else the old same-zone rule, and nothing wider. Raid: unchanged,
  and with two raids a sender KNOWN to be in the other one is dropped (one raid changes nothing). Group: only the
  listener's group's fires and targets; a sender in a raid while the listener is not is another group.
- **Where the bot learns a group:** it did not. `live-state`, `raid-roster` and the heartbeat carried only the RAID
  group number. The reporter heartbeat now accepts `group_names` (names in the played character's Zeal group window,
  memory only, 60 s fresh); the relay stamps `origin_raid` / `origin_group` on each fire at POST. **Until a Mimic
  sends `group_names`, "group unknown" applies: the zone rule, minus the raid-evening blanket.** Agent 3.7.103 (beta)
  sends it: `_heartbeatGroupNames` reads the played character's Zeal group window, only when under 60 s old;
  `[]` = solo, left out = unknown. Stable Mimic installs keep the zone rule until the next stable cut.
- **Fail open:** no data, a stale or other-character heartbeat, a failed roster read, or Supabase off → today's rule.
  A listener the bot cannot place at all keeps hearing the whole raid evening (today's), and nothing off-evening
  (the 2026-09-11 rule). `flag_disable_groupscope=1` (tuning map, 60 s) restores the old behaviour for both.
- **Left alone on purpose:** loot posted, boss timers and lockouts, quakes, control-plane notices, the buff queue.
  A grouped player outside a raid no longer gets the raid's main assist on Extended Target. A single raid's board
  still shows non-members in the zone, as before (§124's "one raid is byte-identical").
- **Raid | Group switch on Extended Target (the guild lead, 2026-10-08, answering the raid-group question):** *"Seeing
  the whole raid is often worthwhile, but when grouping it can be annoying to see this mode. Make it a toggle at the
  top."* Both, switchable, in the overlay's title bar (agent 3.7.104, beta). **Raid** (default) = everything the raid
  is on; **Group** = in a raid, your RAID group from the Zeal raid list (outside one it changes nothing — you already
  see only your group). Remembered per install. Raid group 0 is the ungrouped bucket (raid_roster on 2026-10-08:
  group 0 held about twice any real group), so 1..12 count, the same rule as `utils/buffGroups.js`; an ungrouped
  raider falls back to their Zeal group window. Agent-side only (`_scopeExtToGroup`, `?scope=group`); the main
  assist line stays. **Agent 3.7.105: a chosen Group never falls back to the whole board** (the guild lead, the same
  night, "still showing other groups"): an unknown group shows an empty list that says so, and an ownerless pet
  row is dropped. Raid keeps failing open as before. **Agent 3.7.106** (the guild lead, grouped and NOT raiding,
  Group on, still saw the whole raid: "not working"): the group is now read off the group window's F2..F6 HP gauges
  as well as Zeal's group list (`_zealGroupNames`, also used by the heartbeat's `group_names`), the group window
  wins over the raid roster, and when the "active" character has no fresh Zeal state the character Zeal is
  streaming is used (`_zealSelfForScope`).

## §292 — A callout from another zone reached an unplaced member on a Tuesday night (bot 3.1.260, 2026-10-14)
*2026-09-21 · DECISIONS-2026-09-21.md · Stop callouts leaking from other groups*

The guild lead, 2026-10-14 00:24 ET, with a guild-chat screenshot of a member running through Overthere who heard
"enraged <militis>" from Mimic: *"we need to stop having leaks for callouts from other groups or raids when we're
nowhere nearby"*. A group (not a raid; no raid roster had been uploaded for three hours) was fighting militis mobs in
the Bastion of Thunder at the time.

- **Why it got through (two faults together):**
  1. The member could not be placed. Their characters have no `characters.discord_id`, so `_requesterZones` was empty.
  2. An unplaced listener hears every guild callout on a raid evening, and the raid-evening clock attached the hour after
     midnight to the wrong day: `_inRaidWindowEt` read the calendar day, so Wednesday 00:24 counted as a Wednesday raid.
     It covered Tue/Wed/Sat after midnight and missed Thu/Fri/Mon after midnight, the real ones.
- **The fix (bot only, no Mimic update):**
  - `_inRaidWindowEt`: the hour before 01:00 belongs to the night before.
  - An unplaced listener on a raid evening now hears only senders the bot cannot place either (both unknown fails open,
    as before). A sender the bot CAN place in a zone no longer reaches them (`unplacedWindow` in `_relayScopeKeep`; the
    resolver stops setting the raid-wide `inRaidWindow` for that case).
  - Raid mode and group mode are unchanged. Tests: `test/relay-scope-gate.test.js` (behaviour, mutation-checked) and
    `test/group-scope.test.js`.
- **Also affected:** the OpenDKP panel caches (`_panelAuctions`, `_panelStandings`) use the same clock to refresh faster
  in a raid; they now follow the right night too. `utils/openDkpSync.js` has its own copies with the same calendar-day
  reading (its sync cadence only): left alone, listed here.
- **Next, not done:**
  - Place unlinked members by their upload history. `agent_upload_stats` maps character → uploading Discord account
    (493 pairs; 10 characters have two owners; 163 characters lack a link), but it is 1,857 rows, so the read needs
    paging.
  - Defence in depth on the agent: send the sender's zone with each relayed fire and let the listener drop one whose zone
    is not its current Zeal zone (needs a Mimic update).

## §359 — Kokoro voice unpacks without Windows' bzip2 (field fix, 2026-10-18)
*2026-09-21 · DECISIONS-2026-09-21.md · Kokoro voice install without bzip2*

Field report (the guild lead, screenshot): installing the Kokoro voice failed with `tar.exe: Error opening archive:
Can't initialize filter; unable to run program "bzip2 -d"`. Root cause: `apps/mimic/neuralVoice.js` unpacked the two
sherpa-onnx `.tar.bz2` archives with Windows' `tar.exe` (`-j`/bzip2). Many Windows boxes' bundled bsdtar was NOT built
with internal bzip2, so it tries to shell out to an external `bzip2.exe` that stock Windows does not ship — the
comment's assumption that "Windows tar unpacks .tar.bz2" is false on those PCs. Piper and the Windows voice were
unaffected (Kokoro is the optional upgrade), so it degraded, not broke.
- **Fix (beta):** `extractTarBz2` now unpacks in **pure JS**, starting no process — bzip2 via **vendored seek-bzip
  2.0.0** (MIT, AGPL-inbound-compatible, `apps/mimic/vendor/seek-bzip/` with a provenance header) + a small tar reader
  (ustar prefix, GNU long names, pax). The two pinned URLs/sha256/sizes are **unchanged** (no re-host). Kept: the
  `safeZipTarget` path-traversal guard, regular-files-only (links/devices/fifos refused), empty-archive check, size +
  entry caps, bounds checks, and `_rmrf` cleanup on any failure; the whole entry list is validated before any write,
  so a hostile entry late in the archive writes nothing. Removed `tarPath`/`_run`/`NO_TAR`/`execFile` for this path.
  The model unpack decodes block-by-block with an event-loop yield so the tray stays responsive (~18 s, ~525 MB
  transient; a streaming writer is the next step only if low-RAM PCs struggle).
- **Why not re-host as .zip/.tar.gz:** sherpa-onnx publishes neither file as `.zip` (checked the v1.13.0 win-x64 and
  tts-models releases), and re-hosting would mean producing + hosting ~120 MB of assets and re-pinning hashes; the
  pure-JS path keeps the upstream pins and needs no ops.
- **Guard for the future:** the comment-stripped source test in `test/neural-voice.test.js` now bans `tar.exe`,
  `-xjf`/`-tjf` and `exec` in `neuralVoice.js`, so nobody reintroduces the system-tar dependency.
- ⚠ **Not yet re-tested on Windows** (electron-builder packaging of `vendor/` + a real install on a box that showed
  the error). A beta tester with the new build retries the Kokoro install button.

## §7 — Callout and overlay fixes from a live afternoon (2026-09-23)
*2026-09-23 · DECISIONS-2026-09-21.md · Duplicate callouts removed; live overlay fixes*

Reported by the guild lead one screenshot at a time, mid-session. Each was traced
to its cause before anything changed.

**Duplicate callouts — five guild triggers disabled (data, reversible).** "Need to
comb through duplicates and remove them." No two enabled guild triggers overlap:
4,321 spell landing/fade lines checked, max one guild trigger per line, no
identical patterns. Every duplicate was a guild trigger shadowing a BUILT-IN agent
callout on the same line: Shaman / Shaman Plague / Enchanter / Bard Slow landed
vs the built-in "Slow landed" (agent ≥3.4.17), and "Divine Intervention fired
(death save)" vs "DI DOWN" (agent ≥3.5.59, which also names who recasts). All 32
players active in 14 days run agent ≥3.6.38, so no one lost coverage. Disabled,
not deleted, with a dated note on each row. ⚠ One real difference: the built-in
slow callout is main-target only, so a slow landing on an ADD no longer calls out.

**The disable did not reach anyone — bot bug, bot 3.1.138.** The guild-triggers
`version` (the agent's no-change gate) was max(updated_at) over ENABLED rows; a
disable or delete removes the row and never moves it. Every disable ever made
from `/admin/triggers` kept firing until Mimic restarted. Worked around by
touching one enabled all-classes trigger; fixed by hashing which rows are served
and when each changed.

**Enrage was mute — agent 3.6.54.** The #136 callout allow-list mutes guild
triggers whose name/tags/text match none of its categories, and enrage was never
one. Added whole-word. The suggested "Mob is enraged" trigger read an invented
string (`begins to enrage`); now `has become ENRAGED`.

**Damage shield undercount — agent 3.6.54.** "60 returned · 1 hit" for a fight on
a tank wearing 60/hit. The pairing only looked BACKWARD from the shield line for
its swing; replayed, shield-then-swing counted 0 of 10. Now either order pairs;
what counts as a shield is unchanged.

**Extended Target, outside a raid = your group (the guild lead's default).**
"If we're in group but not raid the default is to not show extended target for
outside of group." Agent-side (only the client knows its group); in a raid,
unchanged; fails open. Also: one mob split into #1/3 #2/3 #3/3 by POSITION while
the spawn ids agreed it was one — ids now merge rows too (bot 3.1.139), and a `0`
target_id no longer mints a phantom `#0` instance.

**Mute vs "Trigger alerts speak out loud" — "which one works?"** Neither did what
it said. Mute also HID trigger alerts (a stale gate from when Quiet mode hid
overlays), and the tray's Quiet mode never muted the CH-chain or charm voices
(only a Settings save broadcast Mute). "Trigger alerts speak out loud" is the
master switch for the whole trigger overlay, banner and voice — relabeled. The
old test for "still flashes" only checked that a flash() function existed and
passed throughout; replaced with one that runs fire().

**Tray and Settings.** "No overlays" added to the tray (same flag, same apply
path — parity rule). Overlays submenu sorted A–Z at build time. Settings flows
into columns when maximized. Slow callouts name the mob and its spawn id when
Zeal proves it (agent 3.6.55).

**Tower archive, where it stands.** Three more merge bugs past the FK order —
`encounters` never restored into the snapshot (its id default lives in the
`extensions` schema), one conflict target for 17 tables with two unique indexes,
and DISTINCT FROM joins that could not finish at 1.2M rows. The last manual run
sat silent in the restore at ~06:2x PDT, possibly colliding with the 05:30
nightly job. To check, from a second terminal:
`ps -eo pid,etime,args | grep -E 'refresh-local-archive|pg_restore' | grep -v grep`
— two refresh processes means a collision: stop both, run once. (Resolved: the
catch-up completed that afternoon.)

## §49 — EQLogParser-style timer bars, and the trigger bugs a guild leader hit (2026-09-26, agent 3.7.24 beta)
*2026-09-26 · DECISIONS-2026-09-21.md · Timer bars like EQLogParser; trigger bug fixes*

**Who and why.** The guild's other leader, a bard, is trying Mimic in place of EQLogParser. The guild lead: *"this is a huge deal for me..this is one of the two guild leaders
buying into the platform"*. Their asks, from #bards:
- *"the only thing i need to get is the recharm tick count down timer … and i could get rid of
  eqlogparser i think"*, with screenshots of EQLogParser's timer window: "Recharm Tick", "PACIFY",
  "CALM", "A Soriz Skeleton - Tashania" and a 60-minute "Ring 10";
- *"are guild triggers something that happen no matter what? i dont need to copy to personal?"*;
- *"i added 'rampage on you' to personal triggers, then deleted it … now i cant get it back"*;
- *"i didnt see it on the regular or mini"*, and *"the 'charm break' is a few seconds late?"*.

They run stable Mimic 2.7.1 / agent 3.7.16 (their last agent report says so), not beta, so none
of this reaches them until they switch to beta or a stable is cut.

**What shipped (agent 3.7.24, beta `7b6a0cc9`):**
- **Timer bars.** A new "Timer bars" group in the dashboard's Suggested triggers, with three
  switches:
  - **Recharm tick:** a 6-second countdown to the charmed pet's next break check, counted from the
    charm landing, pinned at the bottom;
  - **Pacify / Calm / Harmony** on the mobs you lulled;
  - **every spell you land on a mob** lasting 30 seconds or more.

  Each row is built by the agent from what it already tracks, and only for your own casts. The
  trigger overlay draws them as full-height filled bars, like EQLogParser's; trigger countdowns
  keep the thin strip. They show in the trigger window, the "TTS box". That window has no mini
  mode, so there is nothing to miss there.
- **"Your charm broke"**, a Suggested alert on the log line "Your charm spell has worn off." Bards
  get that line too. It speaks at once. The Charm overlay's own call waits out a 6-second grace on
  the Zeal pet slot (so a recast does not false-alarm) plus a 1.5-second kill guard. That wait is
  the "few seconds late".

**Bugs found and fixed on the way:**
1. **"Rampage on you" could never fire.** It matched "rampages on you", which no log contains. The
   real line is "*<mob>* goes on a RAMPAGE against *<name>*!". A saved copy with the old text is
   rewritten on load; a pattern someone edited by hand is left alone.
2. **An unticked or "parked" personal trigger still fired.** Nothing on the fire path read
   `enabled`. Guild triggers were fine, because the bot sends only enabled ones.
3. **Personal triggers using `{c}` (your character) never fired after a restart.** They compiled
   before the agent knew your character names. EQLogParser imports use `{C}` a lot, so this would
   have hit the co-leader next.
4. **Every dashboard save stripped warning times, end text and bar colour from EQLogParser
   imports.** A save rebuilds the whole list from a fixed set of fields.
5. **The Charm overlay's "next mob tick" countdown never counted down.** The "pet still there"
   check overwrote the tick anchor on every poll. This is the likely "didn't see it on the regular
   or mini": the countdown was on the Charm overlay but stuck near 6 seconds.
6. **"Can't get it back"**: deleting the Suggested copy from the personal list left the Suggested
   panel showing it ON. Unticking it then looked like nothing happened. Both panels now redraw
   together.

**Answers for the co-leader.** Guild triggers fire on their own; there is no need to copy them to
personal. "Copy to personal" only makes an editable copy of your own. EQLogParser trigger packages
import directly (Triggers → Import). A 60-minute timer like "Ring 10" is a personal trigger with
a 3600-second timer.

**Not done, offered:**
- **All trigger countdowns as filled bars**, not just the timer-bar rows. It costs one CSS rule
  and nothing more to maintain. It would change every raider's overlay, so it is the guild lead's
  call.
- **A separate timers window.** That is Mimic 3.0's overlay-engine work (§36), not a new overlay
  now: a new window owes the whole overlay parity checklist.
- **Same-name mobs share one bar.** Landings are keyed by mob name, so two "a soriz skeleton" with
  Tash show one bar, the most recent.

## §59 — A member's Sunday-morning batch: feedback acks, the charm break, targeting the pet, timer order (2026-09-27)
*2026-09-27 · DECISIONS-2026-09-21.md · Charm break timing, feedback acks, timer order*

Relayed by the guild lead from the feedback thread and a DM with a member (an enchanter on
Mimic 2.7.3-beta.2):

- *"these feedback have no acknowledgement in discord"*
- *"The 'charm break' TTS still feels slightly behind. like 1 or 2 seconds maybe ... not perfect
  like eqlogparser, clock seems fine"* — and the guild lead: *"charm break needs to be as close to
  instant as possible, like EQLogParser"*
- *"It would be awesome if you could click target the pet from the charm tracker window"* — the
  guild lead: *"I don't know if we can inject a target back into EQ, it would be neat if we could."*
- *"he wants an option for reverse ordering on the timers"* (the timer bars grow upward from the
  bottom; he wants the list to read top-down).

## §84 — Suggested triggers per character; pets on the meter (2026-09-29, agent 3.7.44 beta `f857fa6f`, bot 3.1.174)
*2026-09-29 · DECISIONS-2026-09-21.md · Suggested triggers per character*

Two member reports the same morning.
- **FB-34** — *"Can these be made to per character triggers and not across the board?"* (the Suggested
  triggers panel). A personal trigger may now carry a list of characters; no list means every character,
  as before. A line fires it only from the log of a character on that list (after a character swap on
  one client, Zeal's live character wins); Zeal gauge triggers scope the same way; the timer-bar
  switches, which have no line of their own, count as on while one of their characters is being
  played. The panel has a **For:** picker (Every character, or each character this machine has logs
  for). Unticking one character keeps the trigger on for the others, even from an every-character row.
  Guild triggers are untouched — they already have class targeting and are the officers' call.
- **FB-35** — *"This doesn't show pets? maybe its only if they dont use /pet leader, not sure."* Right:
  a summoned pet names its owner only in "My leader is <Owner>." The pet in the report never said it
  on the reporter's screen, its owner does not run Mimic, and the fight's uploads credited the pet as a
  raider. Two layers:
  - The bot already pooled every declaration any raider's agent uploaded (`addPetOwners`). The poll
    now serves that pool as a `pet_owners` stream (bot 3.1.174; latest declaration wins, 12 h max,
    one-word pet names only, sheddable with `flag_shed_pet_owners`). The agent asks every minute while
    fights run, five idle, and a live fight adopts the owner the first time the pet swings — so one
    `/pet leader` seen by anyone names that pet on every Mimic for the night. Old-log replays do not
    borrow tonight's owners.
  - A pet nobody named, whose name came out of the server's pet-name generator (EQMacEmu
    `GetRandPetName`: G/J/K/L/V/X/Z + two optional middles + ab/er/n/tik) and that /who and the raid
    window never showed, is sent as a pet: the DPS HUD labels it **(pet)** and leaves it out of the
    parse copied to /rs.
  - ⚠ **Not changed: the bot's parse cards.** An unowned pet still reaches the Discord parse as a
    player when no upload carried its owner. The pool fixes it whenever anyone saw the leader line;
    folding generator-named pets on the bot side is a separate call (it would touch every parse card).
- Tests: `per-character-triggers-and-pet-owners` (beta; the agent runs for real, every rule
  mutation-checked) and `pet-owners-stream` (main).

## §112 — The PoP trigger pack: checked against our own data, reviewed before import (2026-09-30)
*2026-09-30 · DECISIONS-2026-09-21.md · PoP trigger pack reviewed before import*

The guild lead, the day before Planes of Power opens, sent a 551-trigger PoP pack from another guild's
public material and asked for its triggers, timers, boss info and strategy *"so that we can bring them in
directly"* — reviewed first, and **not attributed in this repository**. The review is a private page
(owner-only, its link kept out of the repo); choices made on it save to that page's own store. Nothing is
imported yet. Our library had no PoP triggers (131 rows, 0 overlap).
- **Spell triggers (354):** every pattern matches the landing, resist and fade text in our spell catalog.
  **53 recast timers disagree with the server:** the pack times each spell by its own recast, while the
  server's NPC spell lists (`eqemu_npc_spells_entries.recast_delay`) often set another, from 2 s vs 60 s to
  30 s vs 8 s. The guild lead picks: server recast, pack numbers, or leave them out.
- **Boss stat cards (139):** 138 match `eqemu_npc_types` exactly (level, MR/CR/FR); the last is a spelling
  variant. Which command prints the "is not online at this time" reply on Quarm is untested.
- **Event callouts (58):** rebuilt from the quest scripts' say, shout, emote and message calls
  (`eqemu_quest_scripts`). **25 never fire on our server as written**: the pack anchors `^…$` on words that
  sit inside a longer zone emote or shout (Bertoxxulous, Fennin Ro's Doomfire, Coirnav, the Air avatars,
  Earth A's rings, the Halls of Honor flag) or keeps one space where the script prints two. Each has a
  corrected pattern tested against the script's line. 6 texts are not in our copy of the scripts.
- **8 triggers are dead in our engine whatever the pattern:** `triggerVisibleLine` drops every `says,` and
  `tells you,` line (the privacy list), which includes NPC speech — the Tribunal's trial lines, Mavuin's
  flag, Thelin, Etumer and Nitram. Proposed: let triggers see NPC speech only (speaker name with a space,
  plus Etumer by name); player tells stay hidden. An agent change, so beta then a stable cut. Waiting on
  the guild lead's yes.
- **Delivery:** imported triggers are guild-trigger rows, which reach raiders in about two minutes with no
  release. Only the NPC-speech change needs a Mimic update.
- The alpha Canvas work (HUD shapes, chat feeds; task list) is paused for this; nothing of it was written.
- **Imported, same day, on the guild lead's calls** (stat cards on, corrected event patterns, server
  recast, NPC speech yes; every zone kept): **374 guild-trigger rows**, `source_pack = 'pop-2026-10'`,
  tagged `pop` + zone + tier, all enabled. 150 recast timers, 134 stat cards, 58 event callouts, 32
  "on you" alerts. 118 of the 551 were left out: 43 "audible" rows that repeat a "Self" alert for the same
  spell, 32 timers whose spell the server recasts instantly, and 43 whose server recast is under 6 s (the
  bar would restart on every cast). Pack triggers that share one pattern across bosses became one row.
  Timer and spell patterns were rebuilt from our catalog's own landing, resist and fade text; landing
  texts too generic to name a spell ("staggers." and 16 others) were dropped from the "someone else" half.
  Checked by row count and checksum after insert.

## §113 — NPC speech reaches triggers; stable 2.7.6; Ring of Fire; no raids until 10/14 (2026-09-30)
*2026-09-30 · DECISIONS-2026-09-21.md · NPC speech reaches triggers, stable 2.7.6*

The guild lead: *"yes to NPC speech, privacy page gets updated with the NPC messages in an exceptions
section that's collapsed / we have no formal raid tonight, or any night until 10/14. / the guild will be
encountering the Ring of Fire event in Acrylia Caverns"*.
- **NPC speech (agent 3.7.54, beta `685bb5db`):** `npcSpeechLine` lets a `says`/`shouts`/`tells you` line
  reach the trigger engine when the speaker's name has a space in it, or is a one-word NPC on a short
  list (Etumer). Pets count (their names have a space). It is ORed in at the live trigger gate and in the
  golden replay only; `triggerVisibleLine` and the feedback log excerpt are unchanged, so player chat
  stays where it was and NPC lines never leave the PC in a feedback report.
  `test/npc-speech-triggers.test.js`.
- **Privacy:** `/privacy` gets a collapsed "Exceptions: NPC speech that triggers can hear" section listing
  the rule and the NPC lines watched; `docs/PRIVACY.md` has the same section.
- **Stable Mimic 2.7.6 (agent 3.7.54)**, cut the same evening so the PoP event triggers fire on the whole
  fleet when the zones open. It also carries the update-gate fix (agent 3.7.53). Beta re-parked at 2.7.7.
- **No formal raids until 2026-10-14**, so the 19:30–00:30 ET freeze does not hold main pushes until
  then. The freeze itself is unchanged.
- **Acrylia Caverns, the Ring of Fire** (server script `acrylia/RingOfFire`): 7 guild triggers,
  `source_pack = 'acrylia-ring-of-fire'`, tagged `acrylia`, `ring-of-fire`, `luclin`:
  - *first wave*: on the start emote, a 70 s bar (waves come 70–80 s after start), ended early by the reset;
  - *boss 1, 2, 3*: bars to waves 10, 20 and 30, each warned at 60 s. Bosses 2 and 3 show only in their
    last 5 minutes (`display_threshold_sec = 300`);
  - *ring reset*: the warder's shout when the ring empties;
  - *Curse of Eternal Suffering on you*: the bosses' proc (spell 2934);
  - *possessed mob completely healed*: a priest healed its group.
  How it runs, from the script: waves alternate 70–80 s and 90–100 s apart, three mobs each (possessed
  corpses, wizards, priests, or a Battlemaster / Battlelord miniboss at 58, unslowable); every 10th wave
  adds one of four level-63 bosses (200k–500k HP, summon, flurry, magic-only melee). Unengaged trash
  depops after 60 s. **The event ends the moment no living, un-feigned player stands in the ring**
  (checked every 2 s) — the bosses depop and the warder shouts the reset. So: keep someone alive and
  standing in the ring the whole time, interrupt or kill the priests first, and do not feign death as the
  last one in. The ring's own speech needs agent 3.7.54, so the reset trigger fires on 2.7.6 and later.
- **Ring of Fire boss cadence: every 10 waves** (the guild lead, same evening: *"the boss waves are
  supposed to change to every 10 waves instead of 30 to start then 15 after"*). Our copy of the script
  (synced 2026-09-29) already reads `wave % 10 == 0`, so bosses come at waves 10, 20, 30 and on. The
  first import timed only the first boss, and at 800 s, which was 20 s late:
  - The gap after each wave flips between 70–80 s and 90–100 s, off a toggle the script never resets
    between events. Wave 10 therefore lands 780–880 s after the start emote when the toggle starts false
    (a fresh zone), and 800–900 s when it starts true.
  - Every later boss is ten gaps on, five of each length, so 800–900 s after the one before. Boss 2 lands
    1,580–1,800 s after the start, boss 3 2,380–2,700 s.
  - The bars run to the earliest time (780, 1,580 and 2,380 s), because no log line marks a wave.
  - If the server still ran the old cadence (first boss at wave 30, then every 15), boss 1's bar would
    end about half an hour early. So if no boss shows by around 15 minutes, the change is not live yet.

## §121 — Trigger timing votes can be switched off (2026-10-01, agent 3.7.61 beta)
*2026-10-01 · DECISIONS-2026-09-21.md · Trigger timing votes can be disabled*

The guild lead: *"Need to be able to opt out for tts timing feedback."*

**What it covers.** After a callout the trigger overlay offers « Earlier / ✓ Good! / » Too early, and since
#207 the agent also reports each callout's ✕ and age-out. All of it lands in `trigger_timing_feedback`.
One switch turns off both halves, because asking and recording are the same thing to the person opting
out.

**Where it lives.** The agent keeps it (`_optinState.timingFeedback`, default on, absent = on) since the
agent is what uploads: while it is off the feedback route answers 200 and records nothing, and
`_recordCalloutFeedback` drops the agent's own ✕ / age-out paths too. Two ways to flip it: the dashboard's
Triggers tab (Timing votes card) and a 🔕 on the vote row, which is where the annoyance happens. The overlay
reads the switch every 30 s, so an overlay that has not caught up yet still sends nothing. No tray item,
so the tray ↔ dashboard rule is not touched. `docs/PRIVACY.md` and `/privacy` list the votes as an upload
with the way to switch it off.

**Beta only.** Stable agents keep asking. If it should reach stable before the next cut, the change is
agent + `triggers.html`, so the overlay half needs a Mimic build, not just the hot-swap.

## §129 — Fifteen more suggested triggers, and four that could never fire (2026-10-02, bot 3.1.189 · web 1.8.76 · agent 3.7.70 beta `e2f06f69`)
*2026-10-02 · DECISIONS-2026-09-21.md · Fifteen more suggested triggers*

The guild lead: *"We need more in suggested triggers, like failed feign death and spell resisted <spell name -
mob name>"*.

- **The rule this ran on: every line is the server's own text, checked, never written from memory.** The
  source of truth is EQMacEmu `zone/string_ids.h` (server messages) and `eqemu_spells.cast_on_you` (spell
  landings). That check is what found the dead ones below.
- **New (15):** Feign Death failed (`STRING_FEIGNFAILED`, "%1 has fallen to the ground." — said with your OWN
  name, so the pattern is `{c} has fallen…` and a monk beside you does not set it off); a spell broke your
  feign; immune to slow / snare / stun; cannot be mezzed (both forms); cannot be charmed (both forms); your mez
  wore off; your slow / root / snare wore off; your fear wore off; you are silenced; no line of sight; out of
  range; not enough mana; invisibility fading.
- **Resists name the mob.** "Your target resisted the %1 spell." never names it, so a new alert word,
  `{mytarget}`, fills it: your Zeal target when you began casting THAT spell (recorded on "You begin casting"),
  else your target now — an instant spell has no begin-casting line, `zone/spells.cpp` sends the begin-cast
  only when `cast_time > 0` — else "your target". "RESISTED: Tashanian — a gnoll warlord". The immunity alerts
  use the same word. A saved row still reading "RESISTED: {1}" is updated on load.
- **Wearing off names the spell, never the mob.** `zone/spell_effects.cpp` `BuffFadeBySlot` sends the caster
  `SPELL_WORN_OFF` ("Your %1 spell has worn off."), with charm and fear spelled "charm" and "fear". So "your mez
  wore off" says which mez, not which mob. A "worn off of <mob>" string exists in the client's list but this
  server never sends it.
- **Dead and fixed (4).** "You are snared / rooted" waited for "You have been ensnared/rooted/bound",
  "mezzed / charmed" for "You feel calm/charmed", "feared" for "You are afraid" — none appears in any spell. The
  real landings run to 70+ snare texts, 30+ mez, 30+ root, 16 fear. So those three now match **by the spell's
  effect**: the bot catalog carries `cc` (mez, charm, fear, stun, root, snare, slow, silence — SPA 31, 22, 23,
  21, 99, 3 negative, 11 under 100, 96) and the agent fires when a line is the landing text of a spell with
  that kind (`catalog_match`). A text that a spell WITHOUT that kind also prints is left out, the Blind Mode
  rule. "Interrupted" read "Your spell interrupted"; the server prints "Your spell is interrupted." Saved rows
  move on load (exact old pattern only; an edited one is the member's).
- **Not touched, and unverified:** the five "your buff dropped" suggestions read "Your Clarity spell has worn
  off." The server sends that line to the CASTER of a DETRIMENTAL spell only; a buff fading on you shows the
  spell's own fade text ("The cool breeze fades."). Whether the client also prints "Your … spell has worn off"
  for your own buffs is not settled from the code here, and fire history has no evidence either way. Left as
  they are; one look at a log when Clarity drops settles it. "You are stunned" is unverified for the same reason.

**Not done:** the buff-drop question above; a stun "on you" by catalog (161 landing texts — wired the same way
when wanted).

## §164 — Enrage at 12%, a fresh log in one click, and what rewrites EQ's ini files (2026-10-05)
*2026-10-05 · DECISIONS-2026-09-21.md · Enrage warning at 12 percent*

- **Enrage soon (agent 3.7.84, beta `2853825c`).** The guild lead: *'"Enrage Soon" goes off WAY too late. it
  should be hitting at 12-10% of mob hp left'*. `ENRAGE_WARN_PCT` 10 → 12 (also the HUD zone and the Tank /
  Command Center threshold), the check every 250 ms instead of 1 s, and "Enrage soon" at speech priority 2
  beside CH GO. The plumbing from Zeal to speech is under 1.5 s; the late part was the threshold and the
  speech queue, which made it wait behind the line being spoken and dropped it after 5 s or behind 3 others.
- **The log stopped again at 10:50 (FB-53).** The guild lead: *"that's unacceptable. We need a quick way to
  backup log and start fresh in the mimic client"*. Built (agent 3.7.85, beta `9a5f5a4a`): 🗄 Archive log &
  start fresh, and the log-silent header banner, which 3.7.81 computed but never drew. Not caused by the bug
  report's log read: both FB-51 and FB-53 were sent after the log had already stopped. Why EQ stops writing is
  still unknown; `/log off` + `/log on` is the in-game step to try first.
- **« Earlier (the guild lead: *"the earlier button no longer works on TTS"*).** Votes now file under the
  trigger's name and id, not the shown text, so a built-in callout's votes add up (`f568d5fe`); votes still
  change no timing. The guild lead confirmed the Canvas is on. Reproduced in Chromium with the real Canvas:
  the callout column was centred in the callouts panel, so a panel shorter than callout + vote row cut the
  row off first (0–15% of « Earlier visible at 420×120, 420×60, 720×36, 300×120, scale 1.5; no vote sent).
  Fixed (`b67bc333`): the column sits on the panel's bottom edge; all of those send the vote. By design a vote
  still cannot land while the Canvas is being arranged, or under another panel.
- **Buff blocks: a set's Name could not be edited** (the guild lead: *"the starter set ne set for blocking
  buffs does not let me edit the Name from New set"*). Opening "✏ Edit this set" changes the markup (wpKeep
  writes `open`), so the next 5 s poll rewrote the tab under the Name field, which has no id to restore:
  typing "My Pull Set" saved "My Pul". Fixed (agent 3.7.86, `7b6a2606`): the tab holds its repaint while an
  id-less text field has focus and repaints on focusout; and a rename followed at once by another set button
  no longer puts the old name back (the change goes into the view before the save).
- **Bags and the lost /corpse social.** Zeal's toggle-all-bags (keybind 215) opens bags with the client's own
  call and places nothing; positions come from EQ's own save. The one Mimic writer that can revert
  `UI_<char>` (bag spots) is UI Studio's Save: it writes the position of EVERY window it read (the ~50 bag
  windows included, though the stage hides them) from the copy read when Studio opened, as whole files; its
  deferred "after logout" form runs unattended and keeps EQ's copy as `.bak-eq-<ms>`. It does not write the
  socials file, so the lost /corpse social more likely came from EQ closing without a zone or camp. Backups
  only read (`readFileSync`, no lock). Offered: **A** (Save writes only the windows you moved, into the file as
  it is on disk; a cloud snapshot loaded into Studio still writes every window; old whole-file pending saves
  are dropped at upgrade) or **B** (keep whole files, guard the deferred queue). **Picked A** (the guild lead,
  2026-10-05: *"A for UI Studio"*). **Built** (Mimic beta, `c281fea6`): Save sends key edits for the windows
  moved or resized only (every window on a rescale to another resolution block; a moved-only window keeps
  EQ's current size), main re-reads each file and changes only those keys (`apps/mimic/iniKeyEdits.js`),
  immediate and after-logout alike; old whole-text pending saves are dropped at load. One departure from the
  draft: a cloud backup loaded into Studio keeps the whole-file restore (a new PC may have no files to
  merge into) and refuses while the character is logged in rather than queueing a restore.
- **Flag hails in the Command Center** (the guild lead: *"Upon boss death and spawn of a creature that needs
  to be hailed … track who has not yet hailed and who has already"*). Scoped: 15 PoP kills spawn a hail NPC
  (Planar Projection and others, 10–20 min, Agnarr/Karana wants a phrase not a hail); only the raid at the
  kill can get credit; "hailed" comes from a raider's own flag line (Mimic) or a witnessed
  "<Name> says, 'Hail, …'" (wired only into old-log imports today, `parseWitnessedHail`); "already flagged"
  from `pop_flags` + `STAGE_IMPLIES`. Offered **A** shared board (bot-backed, everyone sees the same list,
  tap to mark) or **B** local only. Recommended A; waiting on the pick.
- **Timers for the PoP named on the board** (the guild lead: *"timers for the guild instances bosses in our
  zones. They're 3 hours"* → *"put them on the pop board per zone"*, with Quarm's Oct 4–5 notes). Bot
  3.1.204 (release branch): Bastion of Thunder's eight named at 3 h, the 24 h named per zone (Crypt of Decay,
  Disease incl. Grummus 66→24, Innovation's Prototypes IX–XI, the Justice crawler, Nightmare's five, Valor's
  two). Buttons for timers ≤ 24 h show the Eastern time the boss is up; ≤ 6 h bosses stay off spawn alerts
  and "Spawning in 24 Hours". The new named file no character lockouts (`lockout: false`; the notes give
  respawns only) — Grummus keeps its old lockout behaviour, unconfirmed. The PoP board grows to 4 messages:
  someone runs `/board` once after the deploy (until then the board silently does not refresh). Found while
  scoping, fixed in the same change: the boss matcher took "a tortured soul" / "a tortured banshee" for
  **Ture** (8 trash fights since Oct 2, 24 false lockout rows, a false Ture board timer to 2026-10-07 23:08 ET;
  the rows are left to expire unless the guild lead says delete) and would take "a chokidai terror" /
  "a cleric of vallon zek" for Terror / Vallon Zek.
- **HUD procs and stuns/aggro per mob** (the guild lead: *"the number of procs that you have had on a mob, as
  well as how many stuns/aggro spells you've put into the mob. on the right side of the circle hud above the
  damage shield"*). Agent 3.7.88 (beta `9050be57`): ⚡ procs (the hit ledger's proc flag) and ✦ stuns/aggro
  (a landed own-cast whose catalog entry is cc 'stun', SPA 21, or adds hate, SPA 92 positive base), per mob
  keyed name#spawn id, reset on death; one row flush against the ring above the DS badge, builder part
  `procs`. The hate field comes from bot 3.1.205 (release branch); until it deploys only stuns count.
  Placement read: procs then stuns left to right, above the DS column; no separate damage chip (the damage
  is already the hit column and the END arc's "out").
- **HUD "1 6%" arc** (the guild lead: *"what is this little bar at the top left"*). The low-HP side arc
  (`_meSideArcs`) took every Zeal gauge with text except 1/6/16, so the XP, AA XP, cast, tick and spell-gem
  gauges could list as raiders under 25%. Fixed (agent 3.7.87, `f1f1f38a`): group-member gauges 11-15 only,
  beside the raid window.
- **Tower patch for raid positions:** `docs/PATCH-tower-raid-track.md` (pinned to `04d90890`, md5s, 22-check
  self-test). This session cannot write to Tower (read-only login, SSH blocked by tailnet policy), so a local
  terminal or a Claude in Chrome session runs it.

## §181 — Guild-trigger countdown, warning and repeat are set on /admin/triggers, beta first (2026-10-07, web 1.8.115 beta, FB-31)
*2026-10-07 · DECISIONS-2026-09-21.md · Guild trigger countdown set on admin page*

- **The form refuses what the agent would silently ignore**: a warning needs its seconds, its words and a countdown
  longer than it; a repeat needs a countdown; whole numbers only. Max repeats blank or 0 means until cancelled
  (stored NULL; the agent reads 0 the same way). Caps are the agent's own clamps: countdown 3600 s, 1000 repeats, 200
  characters of warning. All 512 live rows passed the rules on 2026-10-07, so none is blocked from a re-save.
- **Beta first, not main**, because it changes an existing page (CLAUDE.md's UI rule): one form in the page's own
  style, no variants, since the fields were named by the request. Read it at `https://b.wolfpack.quest/admin/triggers`.
- **The migration went to production ahead of the web build** (`guild_triggers_loop`, additive: two columns with
  defaults) and its file is committed identically on `main` and `beta`, so the sync merges it cleanly.

## §184 — An unticked 🔊 on a Suggested alert means silent, and a charm break is said once (2026-10-07, agent 3.7.100 beta, FB-12, FB-21)
*2026-10-07 · DECISIONS-2026-09-21.md · Unticked alert silent, charm break once*

- **FB-21, what it was.** One suggested trigger (`self_charm_broke`) shows in two lists, so ticking either box moves
  both — not two triggers. The 🔊 box is the row's `tts` text; unticked, the row had none, and both the agent and the
  trigger overlay read the DISPLAY text aloud when a fire has no tts — so unticking silenced nothing, on every
  Suggested alert. And the instant charm fire was marked "spoken" only when 🔊 was ticked, so with it unticked the
  Charm overlay and the trigger overlay both spoke.
- **The call:** an unticked 🔊 on a `suggested:` row is muted (flash only), by the same `mute` switch the raid callout
  allow-list uses. Personal triggers written with no tts still read their text, and guild rows are untouched. The
  charm fire counts as spoken only when the row is on, on for that character, and 🔊 ticked.
- **Session pick, the guild lead can flip it:** with the row's 🔊 unticked, the Charm overlay's own "charm break"
  voice still speaks once (one voice, from a separate feature). The other way, an enabled row would silence the
  Charm overlay whatever its 🔊 says, and the "flash here, voice there" combination would be gone.
- **FB-12:** Mana and Endurance are separate HUD parts; an old combined setting becomes both, so nobody's HUD changes on
  update.

## §200 — Plane of Tactics boar stampede: what starts it, and two guild triggers (2026-10-08, live)
*2026-10-08 · DECISIONS-2026-09-21.md · Tactics boar stampede triggers*

**The ask** (the guild lead): *"There is a stampede … in Plane of Tactics where a bunch of boars run from around
-350, 1200. What triggers that? is it a timer? can we build in a trigger for those in the zone when that
happens?"*
- **What starts it:** a zone controller script (`potactics/Stampede_Controller.lua` in the server's quest set) on a
  random timer, re-rolled to 40–120 minutes after each run, and skipped while Rallos Zek is up. Each run sends the
  zone emote **"You hear the pounding of hooves."**; the boars spawn about 15 s later. Confirmed in a raider's own
  log: the emote at 2026-10-07 16:20, 2026-10-08 12:45 and 13:28 (43 minutes apart), boars engaged ~40 s after it.
- **Where it landed:** two guild triggers, `source_pack` `potactics-stampede`, live through the 2-minute guild
  trigger poll: "Tactics: boar stampede incoming" (pattern `You hear the pounding of hooves\.`, overlay + TTS
  "Stampede", 15 s timer, 120 s cooldown) and "Tactics: next stampede possible" (same line, 40-minute timer, shown
  from 5 minutes out). The 40 minutes is the script's minimum; the real gap can run to 2 hours.
- **Follow-up, same day: the whole window, shown at once** (the guild lead: *"we should be able to say when a spawn
  may happen after seeing the stampede go off and give a timer"*; a member's FB-69 asked to record the time of the
  emote). The first timer hid until its last 5 minutes and said nothing about the far edge. Now two bars start the
  moment the emote is seen: **"Tactics: stampede window opens"** (40 min, spoken warning at 5 min, ends "Stampede
  possible now") and **"Tactics: stampede by"** (120 min, text warning at 10 min, ends "Stampede is overdue: Rallos
  Zek up, or the roll ran long"). Guild-trigger rows only, so they reach raiders on the 2-minute poll with no release.
  Implements FB-69.

## §205 — The Feign Death failure callout was muted by the raid callout allow-list (2026-10-08, agent 3.7.107 main · 3.7.111 beta)
*2026-10-08 · DECISIONS-2026-09-21.md · Feign death failure callout unmuted*

**The ask** (the guild lead): *"fd FAILURE callout needs to go off for a monk, it's critical"*.
- **Cause:** the trigger and the match were fine. The guild trigger "Feign Death Fail" (`{c} has fallen to the ground.`, overlay
  "FD FAIL", speech "FD failure", enabled since May) fires on the monk's own agent. But §136's allow-list only lets a
  guild-pushed trigger SPEAK when its name, tags or text hit a critical category (slow, death, tank swap, disc, deathtouch, charm,
  enrage, mechanic). Nothing in "Feign Death Fail", "FD FAIL" or "FD failure" matched, so it rendered on the overlay and stayed
  silent. Same trap as enrage (§1) and the same shape: a trigger that is enabled and firing reads as coverage.
- **Fix:** a `feign` category in `_CALLOUT_ALLOW_CATEGORIES`: `feign` / `feigned` / `feigning`, and `FD fail` / `failed` / `failure`.
  A bare "FD" stays out (an "FD ready" callout stays muted). Shipped to BOTH lines because it is a raid-critical call: stable agent
  3.7.107 (hot-swap on main) and beta agent 3.7.111. No trigger row or bot change.
- ⚠ **Not changed:** the allow-list is a deny-by-default list. Any other guild trigger whose name and text avoid those words is
  still muted on voice. Worth one pass over the live `guild_triggers` for callouts the guild would call critical.
  Measured the same night: **296 of the 487 enabled guild triggers match no category** (boss "recast" warnings, spell-landed
  and zone-event callouts for Fire, Air, Water, Torment, Tower of Solusek Ro, Justice and Hedge Maze among them). Muting them
  is what §136 chose, so that is the guild lead's call, not a bug to fix quietly.
- **My own slip, same night:** the Plane of Tactics stampede triggers (§200) speak "Stampede" and were silent for the same
  reason. `\bstampede\b` is now in the `mechanic` category (stable 3.7.108, beta 3.7.112).

## §238 — "What you hear": per-trigger speak / overlay only / off, a 🔇 button on callouts, personal trigger sync (2026-10-12)
*2026-10-12 · DECISIONS-2026-09-21.md · Per-trigger speak, overlay only, or off*

- **The ask** (the guild lead): *"fix the categorization for triggers within the guild section so that we can pick
  ones that we specifically do not want to hear or can just be shown on the trigger overlay. The charm aging. And
  many other callouts do not have a way to turn them off, such as enrage soon. And it seemed that I was still
  getting the enrage callouts, even though I had turned it off for my character"*, and *"Personal triggers should
  be syncable"*.
- **Why enrage kept speaking:** three separate paths. (a) The built-in "Enrage soon" (12%) had no switch at all.
  (b) The guild triggers "Enrage (Begin)/(End)" fire and are relayed from every raider's Mimic. (c) The switch the
  guild lead used turned off only the suggested "ENRAGED — STOP DPS" row, for one character.
- **Picked B + B, plus a mute button** (*"B and B but then also a mute button on the TTS callouts so people can
  turn it off"*):
  - **Controls (agent 3.7.128, beta `791fe4e0`):**
    - Every callout (guild, personal, built-in) gets Speak / Overlay only / Off, by group (built-in callouts,
      stat cards, one group per zone from the guild tags, class, other guild, personal) with per-trigger
      overrides, for everyone or one character.
    - One checkpoint in `_pushOverlay` covers local AND relayed fires. Timer warnings, blind alerts and
      charm.html's own lines honour the same rules.
    - The built-ins finally have switches: Enrage soon, charm break/aging/breaking, recharm, CH GO, DI DOWN, the
      slow callouts, New Rampage, taking damage, boss countdowns, loot posted, blind.
    - 🔇 Mute under any spoken callout sets that trigger to overlay only, with undo.
    - The CH-chain voice is not covered yet.
  - **Sync (bot 3.1.245, main `428ea8a0`):** an encrypted `personal_trigger_sync` table, household-only,
    newest 20 pushes kept. Routes: `POST /api/agent/personal-triggers/push`, `GET …/list`, `GET …/pull`. The
    payload carries the personal triggers AND the "what you hear" rules. The Mimic Push / Pull buttons are the
    next step on beta.
- **Found on the way:** the Command Center roll-range fix (§236) had edited `command.html` without re-running
  `sync-command-embed`, so the agent's embedded copy was stale and `check:dashboard` failed on beta. Re-synced in
  `791fe4e0`.
- **Not done, needs a yes:** the 134 stat-card guild triggers are read aloud today because they have no voice
  line. Making them display-only is a guild-wide data change, offered to the guild lead.

## §294 — Custom sounds, voice packs and name pronunciation: option C (2026-10-14)
*2026-10-14 · DECISIONS-2026-09-21.md · Custom sounds, voice packs, name pronunciation*

- **The ask:** a member wanted a slap sound when their Willsapper procs. The guild lead then picked **C** (a sound library
  plus voices) and widened it: *"different voice packs, get player pronunciation right. let each player suggest how their
  name should sound phonetically with some coaching and alternate pronunciation available to choose from. this can also
  exist for each character on their page. build this voice pack bit into onboarding and allow users to add their own sound
  effects. allow them to use the sound effects instead of callouts tts"*.
- **What exists before this:** Mimic plays a trigger's `sound` (any URL) and mute silences it. But nothing sets one, GINA
  sounds are dropped on import, there is no volume, and every voice is the Windows default.
- **Shape picked:**
  - **Sounds by name, never by path.** A shipped library (generated by us, so no licence questions) plus a per-PC
    `sounds\` folder whose files override shipped ones. A synced or guild trigger therefore plays on every PC.
  - **Per-trigger choices:** volume, and "add to the callout" vs "play instead of speaking". Members can attach their own
    sound to a guild trigger on their own machine.
  - **Voice packs** are presets over installed voices (voice, rate, pitch) with a per-trigger override. Clip packs (the
    announcer personas) come later.
  - **Name pronunciation:** a guild table `name_pronunciations`. The owner sets each character's phonetic spelling from
    suggested alternates plus coaching tips, in Mimic onboarding or on the character's page. Every agent applies it to spoken
    text.
  - **The Willsapper proc** lands as "<mob> yawns.", and ten other spells print the same line, the shaman slows among them. So
    the trigger only fires within 1.5 s of the member's own melee hit on that mob (`after_my_melee_ms`).
- **Where it lands:** bot + migration on main, web character page on beta, agent + Mimic on beta (§295 records the ship).

## §295 — Shipped: sounds, voice packs, names, the Willsapper slap, and the Map's Full mode (2026-10-14)
*2026-10-14 · DECISIONS-2026-09-21.md · Shipped sounds, voices, names, Full map mode*

- **Bot 3.1.261 (main, `1b343563`):**
  - `utils/pronounce.js` and the agent routes `GET /api/agent/pronunciations` (ETag), `GET /api/agent/pronunciation-suggest`
    and `POST /api/agent/pronunciation`.
  - Who may save: the owner, meaning `characters.discord_id` is theirs or the family root's is.
  - The `name_pronunciations` migration file is in the repo. ⚠ Applying it through the MCP was cancelled, so check the
    table exists before relying on it.
- **Web 1.8.151 (beta, `3b3b4cba`):** "How to say this name" on the character page: ▶ Listen for everyone, and the editor
  (alternates, coaching, Save) for the owner. `web/lib/pronounce.ts` gives the same output as the bot's (checked on 3,033
  names).
- **Agent 3.7.163 + Mimic beta (`ef9fbf79`..`b7d2632c`):**
  - The sound library: eight sounds generated with ffmpeg, plus `<userData>/sounds`, where your own files override shipped
    ones.
  - Per trigger: `sound`, `sound_volume` and `sound_mode` add/replace. Your own sound on a guild trigger, on this PC only.
  - The editor fields, a Sounds card, and the tray's "Open my sounds folder".
  - GINA / EQLogParser imports bring their sound file along.
  - Voice packs (Default, Herald, Quick, Narrator) plus an installed-voice picker. Pronunciations are applied to
    trigger speech.
  - Two walkthrough steps: "Your voice" and "Say your name".
  - The "Willsapper proc" suggested trigger: slap, replace, `after_my_melee_ms` 1500.
  - Not done: sound files packed inside a `.gtp`, and names in the Charm and CH-chain overlays' own speech.
- **Map Full mode + keep-clear areas (agent 3.7.162, beta `c7d881a8`):**
  - Full lays the map over EverQuest's client area, click-through always (`_coversScreen`).
  - Keep-clear areas: the UI ini's open windows plus your own boxes.
  - Open: the timers column is hidden in Full; nothing has been tried on Windows yet.

## §352 — Pronunciations on the website, free voices in Mimic, the server's Oct 5–17 patch notes, label encryption (2026-10-16/17)
*2026-10-16 · DECISIONS-2026-09-21.md · Pronunciation pages, free voices, patch notes*

- **Pronunciations: picked A** (the guild lead: *"where can i update the pronounciation in the website and hear them? Can you
  make it so that admins can update everyone's"*). `/me/voice` [beta] (your characters, ▶ in the browser voice, suggestions,
  save/clear) and `/admin/pronunciations` [beta] (officer-only, every name with who set it). Officers may set any existing
  character's, on the website and through Mimic's agent route. Web 1.8.173, bot 3.1.289. Beta also carries an older
  per-character editor on the character page writing the same table; reconcile when beta's web graduates.
- **Free voices: "A and B ... A as default, B as upgrade"** (Piper default, Kokoro upgrade). Agent 3.7.190 on beta: Piper
  downloads on demand (pinned MIT 2023.11.14-2 Windows build) with two voices, Kristin and John, public domain. The
  example voices lessac, ryan and joe were left out because their licences do not allow redistribution. Any failure or
  >2.5 s synthesis speaks that callout with the Windows voice. **Kokoro is a stub**: its JavaScript route needs ~450 MB of
  runtime in the installer; the next route is the sherpa-onnx command line (same shape as Piper). Charm and CH-chain
  callouts still use the Windows voice. ⏳ A Windows tester: download, test, a rehearsed callout, remove.
- **Server patch notes, Oct 5–17** (pasted by the guild lead). Applied (bot 3.1.288, web 1.8.172): Earth A projection 72 (was
  54); Saryrn's projection 30 min; Tylis Newleaf 30 min plus an entrance Tylis needing no Screaming Sphere; Askr and the
  vortex no longer leave at 55 min; Karana 20 min; projection/essence credit survives camping out or changing group and
  late joiners qualify. ⏳ Not applied (no values given): which lower-plane loot lockouts were removed and which retry
  timers shortened. ⏳ The guild lead: whether the same "claim later" wording covers Giwin, Tarkil, Nitram and the Halls of
  Honor trials; whether officers may tap a late joiner onto the hail board.
- **Account labels encrypted** (the guild lead: *"we should be encrypting game_accounts.label"*): AES-256-GCM in the website,
  key `GAME_ACCOUNT_LABEL_KEY`, bound to owner and slot, new column `label_enc`. Parked on branch `claude/label-encrypt`
  until the column exists (the read selects it). ⏳ The guild lead: run the column SQL, set the key in Vercel (Production and
  Preview), say done; then it ships (re-bump web past 1.8.173).
- **Threat snapshots** (asked why one character had ~130k more): every uploader runs ~6–7 snapshots per minute of combat;
  the gap is time in combat, not a fault. Offered: upload them only in a group or raid. ⏳ The guild lead's yes/no.
- **Supabase call map** dashboard (a claude.ai artifact on the edge logs, live). Today's fixes cut the upload counters to 0
  and raid-state reads by ~10×; the damage meter's live read now leads (~2.3k/h), the next thing to trim.

## §353 — Kokoro + gated voices, corpses on the Map, corpses off /me, a Voice tab (2026-10-17)
*2026-10-17 · DECISIONS-2026-09-21.md · Kokoro and gated voices, Voice tab*

- **Kokoro and restricted voices: "A&B but specifically with a warning that the B ones are meant to be research only
  and are experimental."** Agent 3.7.191, beta. A: Kokoro is a scripted one-click install (sherpa-onnx v1.13.0 win-x64
  + kokoro-int8-en-v0_19, pinned size and sha256, unpacked with Windows' `tar.exe`, needs the Visual C++ runtime). B: Piper
  voices that may not be redistributed download only after the player accepts that voice's licence, in two tiers:
  non-commercial and research; the research tier carries the research-only / experimental warning. Ryan (medium) is in
  the research tier because it is fine-tuned from lessac. **Auto prefers Piper, then Kokoro** ("A as default, B as
  upgrade", §352): Kokoro took 2.7–5 s per phrase on the test VM, past the 2.5 s callout limit, so under auto it would
  often fall back to the Windows voice.
- **Corpses on the Map** (the guild lead: *"add the corpses on to the map and give a link to someone that is dragging that
  corpse ... start dragging ... stop dragging ... summoning corpse ... tell where that corpse landed"*). Bot 3.1.290 (main,
  `POST /api/agent/map-corpse`, `bot_kv` `map_corpses:<zone>`, 24 h), agent 3.7.192 (beta). Log lines confirmed against the
  server's string table: 4064 begin drag, 4066/4065 stop dragging the corpse(s), 429/430 summoning, 289 rez experience.
  Zoning while dragging ends the drag where the corpse was left (the server drops it silently). ⏳ Not confirmed, so not
  handled: a "corpse emptied" line (none exists in the string table) and a rez that gives no experience — those corpses
  age out. With two corpses dragged, the singular stop line ends the oldest drag.
- **Corpses off /me** (the guild lead: *"Corpses shouldn't show on the /me page"*, with "Melting's corpse480" under
  *Characters we think are yours*). Cause: Zeal names a dead character "<Name>'s corpse<N>", and the trigger-feedback
  upload used that as its voter, which wrote an upload-stats row. Bot 3.1.291 drops corpse names in `_trackUpload`,
  the feedback voter and live-state ingest; web 1.8.174 skips them on the card. Measured before the fix: 67
  upload-stats rows, 1,740 live-state rows, 105 feedback voters, 49 target observations. The agent itself is
  unchanged: its death detection may lean on the corpse name, and the bot guard covers every path. ⏳ The guild lead
  (optional): the cleanup SQL in that day's reply (match the `'s corpse<N>` suffix only; a real character's name
  contains "corpse").
- **Dashboard tabs** (the guild lead: *"voice things ... need their own tab ... Replay should be on the fights tab ... Buff
  blocks can be on the buffs tab. make it Buffs (and blocking) ... Minimize the kill switches"*). Agent 3.7.193, beta: a
  🗣 Voice tab (voice engine and names, What you hear, callout allow-list, loot announce, Sounds); ⏪ Replay at the foot of
  ⚔️ Fights; ✨ Buffs (and blocking) with the picker under the buffs; 🛑 Kill switches folded into one closed card with an
  "N switched on" badge and a confirm on every flip. *What you hear* and *Sounds* went to Voice (they are about what
  Mimic says); the per-trigger sound picker stays in the trigger editor.
- Account-label encryption (§352) now ships as web past **1.8.174**.

## §371 — PoP "recast" timers fired on our own nukes; the other-target line is dropped (2026-10-19, data only)
*2026-10-19 · DECISIONS-2026-09-21.md · Remove recast timers firing on own nukes*

The guild lead, with a screenshot of "Garrison's Superior Sundering recast — Punisher of Flame, Arch Mage Alchtonion",
"Brushfire recast — Emmerik Skyfury" and "Frozen Wind recast" bars: *"Why am i seeing these? we're not fighting that
named"*.
- **Cause:** the 150 `guild_triggers` rows named "<spell> recast — <mob>" (`source_pack='pop-2026-10'`, §112) match the
  spell's landing text with no mob or zone in the pattern. The text prints whoever casts it. Garrison's Superior
  Sundering is a wizard nuke (scroll class mask 2048) and sits in 441 NPCs' spell lists. Brushfire and Frozen Wind are
  ranger spells carried by 195 NPCs. So our wizards and rangers, or any mob nearby, started a named's recast bar.
- **Applied (data only, 20 rows):** the "<someone> is …" alternative is removed from the high-risk rows. Each keeps
  "You resist the X spell!" and its on-you line, so a raider who is hit still gets the bar, and a nuke landing on a mob
  no longer starts one. Each row's `notes` holds the old pattern (`[2026-10-19] … Was: …`) for a revert. The other 7
  high-risk rows (Markar's Discord, Invert Gravity, Gravity Flux, Greater Fetter, Boltran`s Agacerie, Life Leech, Touch
  of Innoruuk) already had only "you" lines. The ~15 medium-risk rows (spells 2–28 NPCs carry: Meteor Storm, Storm
  Comet, Lava Breath, …) were left as they are.
- **Still open:** the engine has no zone or target gate (`zeal_condition` is HP-only; `condition_expr` is read by
  nothing). A `zone_ids` gate checked against Zeal's zone (old agents ignore it and fail open) would let the bars fire
  only in the named's zone, and would let the other-target lines come back. Not built; the guild lead's call.

## §379 — The afternoon's asks: enrage, voice reports, death recap, map kill, charm aging (2026-10-19, agent 3.8.13–3.8.16, bot 3.2.8, web 1.9.9)
*2026-10-19 · DECISIONS-2026-09-21.md · Enrage callouts, voice reports, death recap*

- **Enrage callouts** (agent 3.8.13). The guild lead: *"restrict them to bosses. enrage needs to pop off at 9% on other
  mobs. should be muteable per mob/this session/permanently."*
  - Bosses (the named list or the catalog's raid target flag) keep "Enrage soon" at 12%. Any other mob that can enrage
    gets one "<mob> enraging" at 9% (`ENRAGE_OTHER_PCT`).
  - 🔇 on an enrage callout, and on its Recent fires row, offers: this mob for the session, all enrage for the session,
    this mob always. "Always" is a `builtin:enrage_soon:<mob>` rule in `trigger_rules.json`; session mutes live in memory.
    `/api/enrage-mute`.
- **Voice unclear, slice 1** (the guild lead picked B: raiders fix in Mimic, officers approve on the site).
  - Mimic (agent 3.8.15): a 🔊 Voice unclear button under spoken callouts; Recent fires keeps what was spoken, the voice
    that really played it and the speed, with replay and a "Say" line to suggest a better wording.
  - Bot 3.2.8 / web 1.9.9 on main: `POST /api/agent/voice-report` (`utils/voiceReports.js`, the reporter is the session's
    Discord id, 30 an hour), `/admin/voice-reports` [beta]. The table
    (`supabase/migrations/20261019150000_voice_reports.sql`) is **not created**; until it is, the route answers 503 and
    Mimic says reports are not set up.
  - Slice 2 (not built): a phrase-respelling table that officers approve, read by every Mimic.
- **FB-84, part A: a death recap from your own log** (agent 3.8.14; the guild lead: *"A first then B"*). The last 20 s
  before each death: hits, heals (CHs marked), damage in the last 6 s, the killer, time since the last CH, the chain's
  beat. On the dashboard's Deaths card and in the Command Center beside the rez board. Targeting a corpse opens that
  player's recap, and the recap stays when an empty corpse vanishes. Local only, last 50. B (a web panel per death) next.
- **"☠ killed" on the Map's timers** (agent 3.8.16). Up, Watched and Engaged rows get a button that starts the respawn
  timer from the mob's last death line in your log, or from now. `POST /api/map-kill` goes down the log-death path.
- **Charm aging is off by default** (agent 3.8.16): `BUILTIN_DEFAULT_MODES`. A choice already made, by the cue or its
  group, is kept.
- **A mob's death clears its debuff timers; the row shows its spawn id** (agent 3.8.17, `c931616f`). The guild lead:
  *"when a mob dies it should remove those triggers for debuffs. Mention the mob's spawn id in the timer"*.
  - `_dropDebuffTimersOnDeath` runs on a live slain/died line and when the Zeal target turns into a corpse or hits 0 HP.
  - Matched by spawn id when the landing proved one, else by name only while the name is provably one mob. With two or
    more same-name mobs and no id, nothing is removed and the timers run out. Players, pets, charm spells and friendly
    buffs are never touched; a landing more than 1.5 s after the death is a new mob.
  - The row reads "A scrounging rat #4182 - Turgur's Insects" when the id is known.
- **Timers panel settings** (Mimic beta `5206c69c`). The guild lead: *"Only For should say Any class or specific
  classes, then show the rest. No way to turn off the sample lines."*
  - "Only for" asks Any class / Specific classes; the class chips show only under Specific. The stored `cls` shape is
    unchanged; Specific with nothing ticked behaves as Any class.
  - The sample rows: arranging forced them on and the button only knew the 30 s test, so it read "Show test rows" with
    TEST rows up. A per-panel `noSample` flag (saved in the layout) now turns them off while arranging.
- **Asked, with pictures (open):** a row menu to move a countdown to another panel and mute it for good, with a review
  list on the dashboard (A, recommended) or drag + right-click (B); the Canvas across several screens, one window over
  all screens behind a switch (A, recommended) or one Canvas per screen (B).
- **Canvas prebuilt pieces** (Mimic beta `a15ddca4`). The guild lead: *"TARGET INFO broken apart looks like it breaks
  when you click. Command center is blank, can't break the as-is hud box into pieces, the as pieces version is HUGE by
  comparison. it should fit into the same setup. that applies for all of these prebuilts. … needs a 'As Whole' button"*,
  and *"when pieces isn't on the screen its confusing why this line is there"*.
  - Target Info taken apart made pieces only for the Stats tab; picking another tab emptied them. The Loot, Spells and
    F/Q/V parts are now made too and show only while their tab is picked. The ⚡ mana switch now reaches every copy.
  - Command Center: the Canvas loaded the agent-served copy (another origin, no fallback); it now loads the bundled
    `command.html`. Inferred, not reproduced.
  - HUD (box): `me.html` marks its blocks, `sections.js` has a 14-part `me` map, so ✂ Take it apart works.
  - "As pieces" is scaled to the whole overlay's footprint (`fitRows` in `parts.js`), then refit from the real page.
  - "the overlay it…" was a label, not a control: now an **as whole** chip beside **as pieces**.
  - The chooser-row ↔ piece line draws only while the Pieces list is open and the row is in view (`linkStart`).
  - Test: `test/canvas-prebuilt-fit.test.js`.

## §394 — Mimic picks (2026-10-21)
*2026-10-21 · DECISIONS-2026-09-21.md · Mute links warning; buff expiry warnings*

- **Muting a countdown also mutes its warning (A).** Not built.
- **Warn when levitate / run speed drops (A), and warn BEFORE it drops.** The guild lead: *"zeal exposes time left on
  buffs. we alert based on that"*: Zeal's buff `meta.ticks` is the time remaining. The agent's suggested-trigger comment
  saying no warning is possible is wrong for Zeal users. Not built.
- **An empty trigger import is an error** (built, agent 3.8.34). **The Canvas lock stays as built.**
