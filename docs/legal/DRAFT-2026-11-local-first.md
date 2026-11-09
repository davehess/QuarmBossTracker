# DRAFT: Raid Mimic privacy and terms for the local-first direction (2026-11-09)

Draft for review, not legal advice. Written against DECISIONS §545, §546, §547 and §539. Nothing here is published; the
pages change in the same change that makes each sentence true (section 5 lists what must exist first). Anything I could not
find in the repo is marked [CONFIRM]. No member, character or guild name appears except "Wolf Pack" where the current text
already uses it as the one live guild.

Line numbers are for `web/app/raidmimic/privacy/page.tsx` (P), `terms/page.tsx` (T), `refunds/page.tsx` (R),
`web/app/privacy/page.tsx` (W).

---

## 1. Summary in plain words

**For a player with no guild.** You sign in with Discord (we get your id, name and avatar; the sign-in provider also holds
your email). You can load up to 8 characters from the PoPFlags file Zeal writes when you camp. We keep the character names,
the flag steps in it and the time Zeal stamped on it. We do not keep the file itself (confirmed in `web/lib/hubImport.ts`:
only parsed rows go to `hub_characters` / `hub_flags`). Your full record stays in Mimic on your own PC. What reaches our
servers is kept 7 days, then deleted, unless a guild that pays has claimed it. Only you can see it today. Later, guilds you
apply to can see the characters you choose to share, per character, off until you switch it on.

**For a guild.** A guild that pays keeps its members' hosted data while it pays and gets the analytics (raid reviews, merged
parses, trends, attendance, flag planning). Analytics are what is sold; storage comes with it. If it stops paying, there is a
grace period and an export, then the data is deleted. A guild can post raids with open slots (up to 72), name partner
guilds, state its loot rules, and recruit by class. We display its loot rules; we do not enforce them. A guild answers for
the guests it accepts.

**Guests.** Someone can play their own characters on another person's PC with Mimic. Those characters are marked "guest";
nothing of theirs leaves that PC, and the PC owner's account never receives it.

---

## 2. raidmimic.com Privacy (P)

### 2.1 "The short version" (P:80-89)

Current (P:82-83):
> You sign in with **Discord**. We keep your Discord id, name and avatar.
> **A guild owns its members' raid records.** We hold them for the guild and follow its choices.

Proposed (replace both bullets, keep the rest):
> - You sign in with **Discord**. We keep your Discord id, name and avatar.
> - **Your full record stays on your own PC.** Mimic keeps it there. We never see it.
> - **What you send us is kept 7 days, then deleted,** unless a guild that pays for storage has claimed it.
> - **A paying guild keeps its members' data for as long as it pays.** The guild owns those records. We hold them for it.
> - **You choose what other guilds see,** one character at a time. It is off until you switch it on.

Why: the current "guild owns" line is the only rule stated; local-first adds the 7-day default and the player-owned local copy.
Also current P:64 says "Everything else: no deletion date today", which stops being true (see 2.7).

### 2.2 "Who runs it" (P:97-101)

Current (P:98-100):
> **What is live today.** One guild, Wolf Pack, runs on this platform. Running other guilds is **coming**. This page is written for that hosted product so it is in place before the first other guild moves in. The free Mimic app on your own PC sends nothing to us until you sign it in.

Proposed:
> **What is live today.** One guild, Wolf Pack, runs on this platform. Any player on the server can sign in and load their
> own characters (<a>My characters</a>). Running other guilds, raid posts and paid plans are **coming**; each is marked
> "coming" where it appears below. The free Mimic app on your own PC sends nothing to us until you sign it in.

Why: the player lane is live (`web/app/characters`), so "nothing for players" is no longer the whole picture.

### 2.3 "Your account" (P:104-124), add four bullets

Current text stays. Add after the "Your guilds" bullet (P:115):

> - **Your characters.** Up to 8 names you load from Zeal's PoPFlags file. For each we keep the name, which flag steps it
>   has, and the time Zeal stamped on the file. **We do not keep the file.** We keep how sure we are the name is yours
>   ("claimed", or "contested" if another account holds it too).
> - **No guild needed.** You do not have to belong to a guild to load characters.
> - **Where it is stored.** In our database and file storage at Supabase. Region: the United States (us-east-2, Ohio; read from the Supabase project 2026-11-09).
> - **What you post (coming).** What flags or loot a character is looking for, and which raids you ask to join. Plain text.
>   You can delete a post any time.

Why: states what the player lane collects. Verified: `hubImport.ts` inserts only `FlagRow`s and character rows.

### 2.4 NEW section "Your PC, and what you send us" (insert after "Your account")

> ## Your PC, and what you send us
> Mimic keeps your full record on your own PC: logs, parses, flags, gear. That copy is yours. We never see it and cannot
> delete it for you; you delete it by removing it from your PC.
>
> When you sign Mimic in, parts of that record are sent to us. What happens next depends on one thing: **has a guild that
> pays for storage claimed you?**
> - **No guild:** what you sent is kept **7 days**, then deleted. Send it again and the 7 days start again.
> - **A paying guild has claimed it:** the guild keeps it while it pays (see "When a guild stops paying" below).
>
> Bulk data (a fight, an upload) is stored as one compressed file each, with a small index in the database. Deleting
> means deleting both the file and its index row.
>
> **Guest characters.** If you play your own characters on someone else's PC with Mimic, they are marked "guest" there.
> **Nothing about a guest character leaves that PC.** The owner of the PC never receives a guest's data on their account,
> and the guest's own account is not involved. When you leave, nothing of yours stays behind except what you saved on
> that PC; ask the PC's owner to remove it.

Why: §547 and the guest-character behaviour. Needs [CONFIRM] that guest data is truly not written to the host's log-derived
uploads (see section 5, item 9).

### 2.5 "What a guild stores" (P:126-139)

Current (P:127):
> Once a guild runs on Raid Mimic, its members' Mimic installs upload for that guild:

Proposed:
> Once a guild runs on Raid Mimic, its members' Mimic installs upload for that guild. **A guild that has not paid keeps
> nothing past 7 days.** A guild that pays keeps the following while it pays:

Bullets and the private-chat paragraph (P:129-138): keep. Add one bullet:
> - raid posts: open slots, partner guilds, the loot rules the guild states, the raid lead, and the character to send a tell
>   to for an invite (**coming**).

Why: ties the list to the paid/unpaid split.

### 2.6 "Whose records they are" (P:163-177)

Current (P:164-165):
> **The guild owns them. We process them for the guild.** We are the ones who look after your account; the guild decides what its records are for.

Proposed:
> **Your own record is yours. A guild owns what its members upload to it while the guild pays. We process that for the guild.**

Current (P:169-171), three bullets that turn false once data crosses guilds (DESIGN-flag-exchange §5):
> - Anything combined across guilds is anonymised counts and totals, never names or characters.
> - A guild's `/who` observations are never added to anyone else's data.
> - One guild's observations are never merged into another's as fact.

Proposed (keep the 2nd and 3rd as they are; they stay true. Replace the 1st):
> - **Other guilds see a character of yours only if you switch that character on.** Per character, off by default, and you
>   can switch it off again. Without that switch, a guild sees only counts across players (for example "12 players still
>   need this flag"), never your name or character.
> - If you **publish** a character's needs, a raid lead can see that character by name. That is your choice, never the guild's.

Why: this is exactly the §5 list. Counts-vs-names is the open question in §545; the draft takes "counts unless the player
publishes" as the brief says. Add to "Whose records" a bullet:
> - A guild you apply to sees only the characters you chose to share with it, and only for the raid you applied to.
>   [CONFIRM: whether sharing is per guild or per raid; see open question 4.]

### 2.7 "Who else handles it" (P:179-187) and "How long we keep it" (P:189-198)

Current processors table (P:32-41) is accurate for Supabase, Vercel, Discord. Edits:
- Supabase row (P:33): `'The database and the sign-in'` -> `'The database, the sign-in and the file storage'`;
  `'Everything stored for the service, including the email Discord gives it'` -> add `', and the compressed fight and upload files'`.
- Add a note under the table: **"Stored in the United States (Supabase, us-east-2)."**
- Leave Railway, GitHub, time servers, Anthropic rows as they are.

Current (P:64):
> ['Everything else', 'No deletion date today. Kept until you or your guild ask us to remove it.']

Proposed, add rows ABOVE it and change this one:
> ['Hosted data from a player with no paying guild (characters, flags, uploads)', '7 days, then deleted']
> ['Hosted data a paying guild has claimed', 'While the guild pays, plus a 30-day grace period [CONFIRM] after it stops']
> ['Raid posts and looking-for posts (coming)', 'Until you delete them, or 30 days after the raid date [CONFIRM]']
> ['Everything else', 'No deletion date today. Kept until you or your guild ask us to remove it. (Wolf Pack only.)']

Current (P:192-196), the backups and archive paragraph:
> Two copies live outside the hosted database ... **backups**, a full copy of the database every night, sign-in records and emails included, kept for 30 days; and an **archive**, a permanent copy of what the hosted database deletes on the schedule above, plus chat, tells and page views.

**This is a conflict, not just an edit.** An archive that is a permanent copy of whatever the database deletes would make the
7-day promise false. Two ways to keep it true (the guild lead picks, open question 1): (a) the archive does not take hub
rows or the hosted files, and the page says so; or (b) the page says "7 days on the hosted service; backups hold it up to
30 days longer". Proposed text for (a):
> The archive does **not** copy characters, flags or uploads from players with no paying guild. Those are gone after 7 days,
> except in the nightly **backups**, which age out 30 days after they are made.

Why: "deleted after 7 days" is false if either copy keeps it longer without saying so.

### 2.8 NEW section "When a guild stops paying"

> ## When a guild stops paying
> - The guild keeps read access and an **export** for **30 days** (decided 2026-11-09, §551) after its last paid day. We tell the
>   guild's owner before it starts and before it ends.
> - After that, the data the guild held is deleted, files and index rows both. Players' own PC copies are not touched.
> - A player's characters go back to the 7-day rule from the day the claim ends.
> - You can ask for an earlier deletion any time: <contact>.

### 2.9 "See it, take it, remove it" (P:222-239)

Current (P:226-227):
> Delete removes your own data and your sign-in; a guild's raid records stay with the guild, unlinked from your Discord account.

Proposed addition:
> **Your characters and flags** are in the download and are removed by Delete (checked in `selfData.ts` and the
> `member_self_delete` function). Hosted data not claimed by a guild is gone after 7 days anyway. What your PC holds is
> yours to delete.

Current (P:237):
> Backups age out within 30 days. Copies already posted in Discord have to be removed there.

Keep. Backups window of 30 days is stated at P:193 and P:237, so it is not a [CONFIRM]. Speed of the delete: the self-serve
delete runs in one transaction (`20261102220000_self_delete_hub_sync.sql`: "single transaction"); say "immediately" only after
a real test [CONFIRM]. Also add: **disputing a character name:** "If another account holds a name you play, or a name is
refused, tell us on the feedback form. We look at it by hand and write back." (The feedback form exists on the Wolf Pack
site and at <raidmimic.com> [CONFIRM the raidmimic.com path]; do not link wolfpack.quest, per
`test/raidmimic-no-wolfpack.test.js`.)

### 2.10 NEW section "Character claims"

> ## Character claims
> You load a character by sending the file Zeal wrote when it camped. That shows you had the file, not that the character
> is yours. So:
> - If two players load the same name, both are marked **contested**, and a contested name is hidden from every guild view
>   until it is settled.
> - If a guild on this platform already links a name to one of its members, the name is **refused** for everyone else.
> - Nothing here stops someone loading a name that nobody else has loaded. Do not claim characters you do not play; see
>   the Terms.
> - To dispute a claim, use the feedback form. We decide by hand.

Why: matches `hubImport.ts` / `decideClaim`. The 8-character cap is in the same file (`MAX_CHARACTERS_PER_PLAYER`).

### 2.11 "Cookies", "Age", "Never used to train AI models" (P:200-220)

No change. Children: current text (P:217-218) "not for children under {MIN_AGE}" kept as is.

### 2.12 "Changes" (P:241-247)

Current: date at the top changes; page is in the public repository. Add:
> When a change means we keep something longer, show it to more people, or share it with a new service, we say so on the
> page **before** it takes effect and, for signed-in players, on their next sign-in. [CONFIRM we can build the
> sign-in notice; if not, drop the second half.]

---

## 3. raidmimic.com Terms (T)

### 3.1 "The service, as it is" (T:45-59)

Current (T:47-50):
> **Free.** The Mimic app on your own PC is free and open source, with no account. We may change, pause or end a free feature. There is no promise of uptime.

Proposed (replace; keep the next two bullets):
> - **Free.** The Mimic app on your own PC is free and open source, with no account. **Signing in is free too.** Free hosting
>   keeps what you send for **7 days**, best effort, with no promise it is available or kept that long. Keep your own copy
>   (Mimic does, on your PC).
> - **Paid, for guilds.** A paying guild gets the analytics and keeps its members' hosted data while it pays.

Current (T:55-57): "**Hosting other guilds is coming.** Today one guild, Wolf Pack, runs on the platform." Keep, add:
"Raid posts, partner guilds and looking-for posts are also **coming**."

### 3.2 "Pro plans and billing" (T:61-74)

Current (T:70-71):
> Going back to Free does not delete a guild's records. Write to us if you want them removed.

**This turns false.** Proposed:
> - **What is sold is the analytics** (raid reviews, merged parses, trends, attendance, flag planning). Storage comes with
>   them; it is not the product.
> - **Going back to Free:** you keep an export window of **30 days** after your last paid day. Download your
>   guild's data in that time. After it, the data is deleted (see the Privacy policy). Write to us to have it removed sooner.

Why: §547 replaces "keeps forever" with "keeps while it pays".

### 3.3 "Accounts and guilds" (T:76-85), add bullets

> - **Guests.** A guild that accepts a player's character into a raid answers for who it accepts. The guild lead picks who
>   gets accepted; we do not check that a guest is who they say.
> - **Loot rules are the guild's.** A raid post shows the loot system its guild chose (flagging only, rolls, need before
>   greed, DKP or another point system). **We only display it.** We do not run the loot, hold the points or settle a
>   dispute. What a raid does with loot is between the guild and its raiders.
> - **Invite characters.** A raid post can name a character to send a tell to for an invite. A guild must not publish a
>   password or credential there.

### 3.4 "What you must not do" (T:87-98), add bullets

> - **Claim a character you do not play,** or load another player's characters as yours.
> - **Post on raids or looking-for lists as someone else,** or post a raid you do not intend to run.
> - **Post anything but plain text.** No links meant to trick, no images, no scripts. Posts may be removed by us or by the
>   guild that owns the raid, and an account that keeps breaking this may be locked out (see "Ending an account").
> - **Harass** a player through a post, a rejection or a recruit list. This extends the existing harassment bullet (T:90).

### 3.5 "Your content and the guild's records" (T:100-106)

Current (T:102-104): "By uploading to the service you let us store it, process it and show it to the people your guild and its settings allow, for the one purpose of running the service."

Proposed addition:
> For a player with no paying guild, that permission lasts **7 days** from each upload. For characters you choose to
> share, it covers showing them to the guilds you shared them with.

### 3.6 "EverQuest belongs to Daybreak" (T:108-112)

**Do not change the text, but flag it.** It renders `RIGHTS_NOTICE` (`web/lib/eqmimicLanding.ts:29-33`), which is held
word for word by a test and says "unofficial, **non-commercial** fan-made companion ... neither affiliated with nor endorsed
by Daybreak Game Company LLC". A paid guild tier sits awkwardly beside "non-commercial". The same applies to any mention
of the server operators: the notice names Project Quarm but says nothing about not being affiliated with its operators.
Proposed addition (new sentence under the notice, outside the pinned constant):
> Raid Mimic is also not run by, or endorsed by, the people who run the Project Quarm server.

Open question 3 asks the guild lead whether to rewrite the notice itself.

### 3.7 "Ending an account" (T:121-134)

Add:
> - **If you leave or are locked out,** characters and flags you loaded are deleted with the account (or by the 7-day rule
>   if it comes first). Posts you made are removed.

### 3.8 NEW "Service changes"

> ## Service changes
> We can change what the free and paid tiers include. We will tell you before a paid change takes effect, and never in
> the middle of a paid month. We may also change the 7-day free window; a shorter window is announced at least 14 days
> [CONFIRM] before it applies to data already sent.

### 3.9 "Changes, and who to write to" (T:146-152)

Bump `TERMS_VERSION` in `web/lib/legal.ts`: the retention and ownership terms change in a way people should agree to again
(the page's own header comment, T:8, says so).

---

## 4. raidmimic.com Refunds (R) and wolfpack.quest Privacy (W)

### 4.1 Refunds: small change

Current (R:49):
> You **keep Pro until the end of the month you have paid for**, then you are back on the free tier.

Proposed, add:
> Your guild's hosted data stays for a **30-day grace period** after that so you can download it. A refund does
> not change this.

Current (R:56-57): "if your guild did not use Pro that month, you get that charge back." Keep. Nothing else in R changes, and
the "Payments are not live yet" banner stays until billing exists.

### 4.2 wolfpack.quest Privacy (W:606-626, "If your guild runs this")

Affected: yes, in two places, both named by DESIGN-flag-exchange §5.

Current (W:616):
> **Anonymised aggregates only, computed inside your deployment** before anything leaves it: counts and totals, never names or characters.

Proposed:
> **Anonymised aggregates only, unless a player chooses otherwise:** counts and totals leave a deployment, never names or
> characters. A player may switch on sharing of one of their own characters with a guild they apply to; that is the
> player's choice, never the guild's.

Current (W:615 area, first rule, "Observations made under your deployment belong to your guild"): add "A guild that stops
paying has a 30-day export window, then its hosted data is deleted."

Current (W:620-621): "A future per-person 'be known' opt-in ... does not exist today." The per-character publish switch is
that opt-in; update it **only when the switch exists**.

Also W has a retention table and a hosted-database paragraph (W:151, W:560): they describe Wolf Pack's own, kept data, so
**leave them**. Add one sentence near W:560 that hosted data from players outside Wolf Pack follows the 7-day rule on the
Raid Mimic privacy page. `docs/PRIVACY.md` (the agent's model: private chat dropped on the PC, tells off by default) needs no
change; add one line under "What we can't promise yet": "Guest characters on another's PC send nothing" only after item 9
in section 5 is verified.

---

## 5. Must be true before publishing

Each line is a sentence in the drafts. Publish a sentence only with the change that makes it true.

| # | Sentence (section) | What must exist | State found |
|---|---|---|---|
| 1 | "Kept 7 days, then deleted" (2.1, 2.4, 2.7, 3.1) | A sweep that deletes unclaimed hub rows AND files; the 7 days start from the last send | **Not built** (§547). No code found. |
| 2 | "A paying guild has claimed it ... while it pays" (2.4, 2.8, 3.2) | The guild claim, and a paid flag per guild | **Not built** (§547). Payments not built either (T:8, R:5). |
| 3 | "Bulk data stored as one compressed file each" (2.4) | Hub data moved to files | **Not built** for hub data. Built for fight snapshots only (§539, mode 1 on). Say "fight snapshots" until then. |
| 4 | "Switch on a character, per character, off by default" (2.6) | A per-character publish switch, default off, enforced where guilds read | **Not built** |
| 5 | "Counts, not names, unless the player publishes" (2.6) | The counts view, and the publish switch from 4 | **Not built** (§545 "still open") |
| 6 | "Delete removes your characters and flags" (2.9) | The cascade for `hub_characters` / `hub_flags` | **Fixed in the repo:** `20261102220000_self_delete_hub_sync.sql` deletes both before anonymising `hub_players`, and `DeleteAccount.tsx` lists it. **Live in production (checked 2026-11-09):** the deployed `member_self_delete` deletes from both tables. Also check `selfData.ts` `SELF_TABLES` includes `hub_characters`/`hub_flags` (it does, lines 137-139). |
| 7 | Archive / backups do not hold 7-day data longer (2.7) | Archive excludes hub rows and hosted files, or the page says otherwise | **Conflicts today:** the page says the archive is permanent and backups are 30 days. Decide (open question 1). |
| 8 | "Raid posts, looking-for posts, partner guilds, the invite character" (2.3, 2.5, 3.3, 3.4) | Those features | **Not built** (§545 steps 2-4). Keep "coming". |
| 9 | "Nothing about a guest character leaves that PC / the owner's account never receives it" (2.4) | Verified in Mimic beta: guest characters excluded from every upload and every owner-account stream, including live state, `/who`, and the roster | **Shipped to Mimic beta 2026-11-09 (agent 4.0.81)**, reviewed: one predicate gates every upload, plus a last-line scrub in the upload queue. Known limits to word around or close before publishing: (a) while a guest's client is live, the raid roster is not uploaded at all (the game's raid list names no character); (b) if the PC owner and the guest fight the same mob, the owner's fight upload names the guest as a combatant, as any other raider's log would; (c) the rampage fan-out is not gated by character. Recommended wording: "nothing from a guest's own log is uploaded", not "the owner's account never receives it". Needs the stable cut before publishing. |
| 10 | "Contested names hidden from guild views" (2.10) | A guild view that respects `contested` | No guild reader exists yet, so true vacuously; re-check when one is built. |
| 11 | "Export in 30 days, grace period" (2.8, 3.2, 4.1) | A real export for a guild, and the scheduler | **Not built**; the number is a proposal. |
| 12 | "Sign-in notice on changes" (2.12) | A notice mechanism | [CONFIRM] |
| 13 | "Supabase region" (2.3, 2.7) | The region read from the dashboard | **Settled 2026-11-09:** us-east-2 (Ohio), read from the project. |
| 14 | "Delete is immediate" (2.9) | Observed timing | [CONFIRM]; keep to "when you press Delete" otherwise |
| 15 | Terms: loot rules "we only display" (3.3) | Display only; no rolls or points held by us | True by design; re-check if loot mode ever tallies. |
| 16 | No wolfpack.quest address on raidmimic.com pages | `test/raidmimic-no-wolfpack.test.js` | Constraint on the wording of 2.9. |

Also: `test/legal-pages.test.js` holds that no governing-law clause appears; the Terms drafts add none.

---

## 6. Open questions for the guild lead (recommendation first)

1. **Backups and the archive vs the 7-day promise.** Options: (a) archive skips unclaimed hosted data, backups still hold
   up to 30 days and the page says so; (b) say "7 days, and up to 30 more in backups" with no archive change. **Recommend
   (a):** it is the honest and checkable version, and the data is small.
2. **Grace period when a guild stops paying.** Recommend **30 days**, matching the 30-day backup window and the monthly
   billing cycle, with a warning at 7 days left.
3. **"Non-commercial" in the rights notice.** The notice is pinned by a test and says non-commercial; a paid guild tier
   contradicts it. Recommend **asking the rights-notice owner's wording once, then changing the sentence to "unofficial
   fan-made companion"** and keeping "not affiliated". Not a lawyer's call by me; mark for review before billing opens.
4. **Per-guild or per-raid sharing.** Recommend **per character, per guild, switched on at the moment of applying**, off
   after the raid. Simplest to explain and the smallest exposure.
5. **7-day clock.** Recommend **7 days from the last upload** (a player who keeps playing keeps their data), not from first send.
6. **Should free-tier raid and looking-for posts expire?** Recommend yes: **30 days after the raid date, or when deleted**.
7. **Who may moderate posts.** Recommend **the owning guild for its raids, the Raid Mimic team for everything**, with posts
   plain text only (no links or images) at launch.
8. **Guest data and the host.** Recommend adding a visible **"guest" tag on the host's overlay** and a one-line notice to the
   guest at first use, in addition to the policy text.
9. **Consent notice at sign-in.** Recommend a **one-time notice on the next sign-in** after the Terms change (bump
   `TERMS_VERSION`), since retention and ownership both change.
