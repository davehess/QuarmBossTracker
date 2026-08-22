# Decisions — 2026-08-21

Previous file: `DECISIONS-2026-08-20.md`.

## PoP flag coverage for raiders without Mimic: witnessed hails (Hitya)

**The call.** *"we need people that don't use mimic to be covered as well. When
someone Hails a flagging NPC and we see that from a mimic-enabled raider, we
should record that as a proper flag when hailing is the thing that correctly
grants a flag (or saying a key phrase)."*

**Why the gap exists.** The authoritative line — "You have received a character
flag!" — is a SELF message. It only ever reaches us for people running Mimic,
which is exactly the population that doesn't need help. A hail is visible to
everyone in range, so one Mimic user in the zone covers the rest.

**The privacy shape is the interesting part.** Public `says` chat is dropped at
the byte filter and stays dropped; agent **3.6.4** adds ONE exception: a say-body
that begins with "Hail". Not say-chat, not shouts, not OOC — and "we should hail
him after" is not a hail. Stored: hailer, NPC, zone, time. Written up in
`docs/PRIVACY.md` AND in member-facing language on `/privacy` (web 1.1.87),
because a filter change people can't see is one they can't consent to.

**Evidence, not proof.** A hail only grants a flag if the hailer already meets
the prerequisites, which we cannot see. Rows carry `source='hail_witnessed'`
and must never render as equal to a self-reported grant.

**Which NPCs matter is a BOT decision**, not an agent one, so the list grows
data-only with no agent release. That matters because the catalog names three
flagging NPCs today. `docs/HANDOFF-pop-quest-extract.md` is the local-session
runbook for the full list — and for the phrase list, without which the "or
saying a key phrase" half stays unbuilt (we will not hunt for phrases by
capturing arbitrary say-chat).

## Foreign lockouts are CAPTURED; foreign raids stay excluded (Hitya)

**The call.** *"several raiders have spent time with Breakfast Club doing raids
on alts. we need to remain vigilant about these not being included, but also
capture loot lockouts for raid mobs when they don't occur with our guild — put
those into another admin section."*

**Two jobs that were being conflated.** A foreign RAID must stay out of our
numbers — /parses already auto-hides an upload whose players are mostly not
ours, and /admin/anomalies owns the review. A foreign LOCKOUT is the opposite:
it must be kept, because it binds US. Someone who killed a boss with another
guild on Tuesday cannot loot it on our Sunday. We were reading `/sll` purely to
nudge boss timers and discarding the rest.

**Bot 3.1.64 + web 1.1.88.** New `character_lockouts` table; the lockout relay
records a per-character row alongside the timer work. `ours` is THREE-state and
never guessed: true = lines up with a kill on our board (30-min tolerance, since
a personal lockout and a guild timer are both derived and drift); false = we
have a kill and it does not line up, so it happened elsewhere; **null = we have
no kill of that boss at all, so we cannot say**. /admin/lockouts shows the three
bands separately, and the null band is labelled "usually just a boss we don't
track — not evidence of anything". An unknown must not read as an accusation.
