# Decisions — 2026-09-01

## Zeal spawn-id capability is OBSERVED, never inferred from the version

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

**Counted in players, never characters** (per the 2026-08-16 rule). One person
runs 3–12 boxes off ONE Zeal install, so a character count overstates adoption
roughly tenfold.

**"Not yet proven" renders as nothing, not as a red failure.** It genuinely does
not distinguish stock Zeal from a patched client that hasn't fought yet, and
showing that ambiguity as a failure sends officers chasing people who have
nothing to fix.

**The fallback is unchanged and still matters:** a raider whose client sends no
id can still be separated by `/tag`, which broadcasts the same `Entity::SpawnId`
over chat. These columns say **who needs that fallback**, not whether it exists.

## Extended Target: an id beats the HP guess, but does not clear the warning

**The call:** at ≥2 distinct `(zone_name, target_id)` pairs for one mob name,
the ids REPLACE HP clustering for that name. Below that, nothing changes.

- The key is `(zone_name, target_id)`, **never the id alone** — an id is a slot
  in the ZONE's entity table (measured 2026-08-31: you get a new one entering a
  zone, and the corpse keeps the old one). An observation with no zone is
  treated as having no id.
- `ambiguous` deliberately **stays true** on a proven split, because it also
  gates the NAME-keyed restore cache that two instances of one name would
  clobber. The row carries a separate `id_proven` flag for the overlay.
- Same-name debuff POOLING is left in place for proven rows. Un-pooling is the
  next step but needs real multi-reporter id data to validate, and wrong per-mob
  debuffs are worse than pooled ones.

## We are on Supabase Pro, and there is no call budget to blow

**Corrected 2026-09-01.** Code comments and archived docs across the repo say the
project is on the Supabase **free tier**. It is on **Pro** (org `hesstastic`,
verified through the Management API), and has been since before several of those
comments were written. Three live files carried the stale claim, one of them in
copy displayed to officers on `/admin/agents`; all three fixed.

**The bigger correction is what Supabase actually meters: NOT requests.** Neither
Free nor Pro has a per-request quota — the line items are Egress (250 GB/mo on
Pro), Database Size (8 GB/project), Storage, MAU, Edge Function invocations and
Realtime. So "how many POSTs a day can we afford" has no answer, and any design
that budgets calls is budgeting against a limit that does not exist.

What follows from that, and it is close to the opposite of how this repo has been
reasoning:

- **Uploads are nearly free. READS are what cost.** Egress is data leaving
  Supabase. A stream's send frequency barely registers; a poll cadence, a wide
  `select`, or an un-cached overlay refresh is the bill. Optimise the read side.
- **Database size is the only meter that ratchets.** 1.72 GB of 8 GB (21%) today.
  That is the real justification for pruning `buff_casts` to 7 days and for
  retiring the row-per-upload `agent_uploads` log — both were argued as call-cap
  savings, and both are right for the wrong reason.
- **Railway is not a constraint at all.** The bot averages 0.4% of an 8-vCPU limit
  and 1.6% of 8 GB RAM over 7 days, peaking at 8.7% CPU.

⚠ **Two things nobody has actually checked, both dashboard-only:** the **Spend
Cap** setting (with it ON, an overage means read-only mode and 402s, not a bill),
and **current egress against the 250 GB**. The Management API exposes neither.
Until someone reads them off the dashboard, do not quote an egress percentage and
do not assume an overage would merely cost money.

This is also why the mid-raid load-shed flags and the admission-control budgets
are still worth having — they exist to protect *raid-night latency and the bot's
own responsiveness*, not a billing quota. Keep them; just stop justifying them
with the free tier.

## Open — read this first

| Item | State |
|---|---|
| ⚠ **Zeal PR #229** | Approved by the server owner; the Zeal maintainer was to review it. Nothing on our side is blocked — everything shipped is inert without it |
| ⚠ **Two comments still unposted by Hitya** | `docs/upstream/zeal-spawn-id/pr-229-build-report.md` on the PR, and `issue-218-comment.md` on issue #218 (drop its now-false "no Windows/MSVC setup" paragraph first) |
| **The API request to Moncs** | Still unsent. Artifact written and refreshed; the bids-detail need is already folded in |
| **Two local OpenDKP fixes, recommended before sending** | Gate the roster walk on a `Character Created/Updated` audit signal; make `dkpTick._resolveCharacterIds` read `characters.opendkp_id` instead of walking 12 pages |
| **`_logStandingsShapeOnce`** | Prints on the next raid-window standings refresh (Wednesday) — that resolves the DKP field-name question |
| **Autobid button** | Deliberately NOT shipped: the flag exists but nothing consumes it, and `DESIGN-bid-assist.md` needs a ceiling column that does not exist yet |
| **`bump_agent_upload_stat` now has three overloads** | 8-, 9- and 11-arg. Pre-existing pattern (the 8-arg predates this work) and PostgREST resolves by named args, so nothing is broken — but the two stale ones should be dropped once the fleet is fully on bot ≥3.1.107 |
| **The weekly OpenDKP sweep is TEMPORARY** | Revert to `OPENDKP_LIST_FULL_SWEEP_DAYS=0,3,4` when OpenDKP ships `since` |
| ⚠ **Supabase Spend Cap + current egress** | Both dashboard-only, both unread. Needed before any "we can afford it" claim |
| **Tag channel autojoin file-write** | Still blocked on one line from a real character ini |

_Carried forward from `DECISIONS-2026-08-30.md`; the bid-detail backfill and the
00:02 ET sweep diagnostic rows retired there (both ran)._
