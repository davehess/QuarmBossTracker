# DESIGN — The business: positioning, selling, hosting, and getting paid

> **This is not legal, tax or accounting advice, and nobody who wrote it is a
> lawyer or an accountant.** Where a professional has to decide something, this
> document writes down the **exact question to ask them** instead of inventing
> an answer. Treat every section below as preparation for those conversations,
> not a substitute for them. The binding documents are `LICENSE` (Business
> Source License 1.1, converting to AGPL-3.0-or-later four years after each
> version ships — explained in `docs/LICENSING.md`) and, once a lawyer has been
> through it, `docs/TERMS-hosted.md`, which is still marked DRAFT.

**Written 2026-09-18, as the architecture pass that follows the licensing and
terms decisions of the same day** (`docs/DECISIONS-2026-09-18.md` §1, §2, §8).
Nothing here re-decides those. It takes them as given and asks: if another
guild wants this, how do they hear about it, how do they get it running, and if
they want to pay for it, what has to be true first.

## 0. The five facts everything below is built on

| Fact | Where it is decided |
|---|---|
| The license lets any guild run this free, forever, for itself. Charging others for it needs an arrangement with the Licensor. Every version turns AGPL after four years. | `LICENSE`, `docs/LICENSING.md` |
| The hosted offering is **managed hosting + best-effort feature requests, no timelines, no SLA**, monthly in advance, fee = infrastructure + the guild lead's time, encrypted data handover at term end, the guild owns its domain. | `docs/TERMS-hosted.md` |
| **S / M / L, all three offered at once.** S is sized for free tiers — with the honest caveat that Railway's free tier cannot run the bot. | `docs/DECISIONS-2026-09-18.md` §8.1, §8.8 |
| **The planning horizon is roughly nine months** of viability for large guilds on this server before merges and shrinkage, and the server may eventually close. | `docs/DECISIONS-2026-09-18.md` §8.2 |
| This is tooling for an EverQuest emulator, running on the game owner's tolerance. A conversation with the server's operators is a **prerequisite** to the first paid arrangement. | `docs/DECISIONS-2026-09-18.md` §2; `docs/TERMS-hosted.md` §9.5 |

Two more that constrain the money specifically:

- **The Vercel Hobby plan is non-commercial under Vercel's terms.** A guild
  running the site for its own members qualifies. The moment anyone pays for
  hosting, that plan must be upgraded — not eventually, immediately
  (`docs/DESIGN-selfhost-wizard.md` §2a).
- **The guild lead is one person.** Every commitment in this document is a
  commitment of one person's evenings, against a nine-month clock, next to a
  raid schedule. That is the single strongest argument for keeping all of this
  small.

---

## 1. Positioning and the offer

### 1.1 Who this is actually for

Not "EverQuest guilds." The buyer is narrower and worth naming precisely:

| Segment | Why they want it | Why they might not |
|---|---|---|
| **A raiding guild on this server, mid-to-large, with an officer who already keeps a spreadsheet** | Every problem this platform solves is one they are hand-solving right now: spawn timers in a pinned Discord message, parses pasted by hand, loot and ticks tracked in a sheet | They have a working spreadsheet and a volunteer who likes maintaining it |
| **A guild that has just merged or is about to** | Merges are the dominant event of the next nine months (§0). Two rosters, two DKP histories, two sets of timers — tooling is suddenly worth real effort | Mid-merge is the worst possible time to adopt anything |
| **An allied guild that already sees our output** | The shortest sale in existence: they have watched the timers and the parse cards work for a season | Nothing — this is the beachhead |
| **A guild on another EQEmu server** | The platform is mostly server-agnostic; the Quarm-specific seams are known and listed (`docs/DECISIONS-2026-09-18.md` §8.2) | We have never run it anywhere else. Every claim about it is untested |

The **non-buyer** is worth naming too, because chasing them wastes the whole
nine months: a small casual guild with no raid schedule has nothing for this to
parse and no timers to track. The value curve starts at "you raid on a
schedule."

### 1.2 What S / M / L mean to a buyer

The internal definitions are in `docs/TERMS-hosted.md` §3 and
`docs/DESIGN-guild-kit.md` §4. What a guild officer should read:

| Size | The sentence that sells it | What they actually get | The honest cost line |
|---|---|---|---|
| **S — Starter** | "Your raid timers, your parses, and the overlay client — in Discord and in game." | The Discord bot, the log-parsing agent, and the Mimic desktop client | Free to self-host. The bot needs about **$5/mo** of hosting or a spare machine you already own — the free tier of our hosting provider cannot run it |
| **M — Guild Site** | "All of that, plus your guild's own website." | S plus the full web application — member dashboards, parse history, raid boards, loot and wishlist tools — on **your** domain | Adds little database cost over S; the realistic floor for a fully paid, hands-off stack across everything is around **$30/mo** |
| **L — Full Platform** | "Everything, including the competitive tools." | M plus the PvP and competitive tracking components — off by default, and the de-anonymisation path additionally requires an alliance code agreed between guilds | Same infrastructure as M. L is a **feature-completeness** tier, not a bigger server. The extra cost is setup steps, not money |

Three things to say clearly when presenting these, because each has bitten
somewhere in this repo already:

1. **All three are self-hostable for free.** The sizes are not a paywall; they
   are a description of how much you are choosing to run.
2. **S is not "the free one."** S is a *scope*. There is a free S and a paid S.
3. **L's competitive features are off by default and stay off** unless two
   guilds agree to turn the shared part on (`docs/TERMS-hosted.md` §8). Selling
   L as "spy tools" would be both inaccurate and the fastest way to make
   enemies on a small server.

### 1.3 Free vs managed — the actual difference

| | Self-host (free) | Managed (paid) |
|---|---|---|
| Who installs it | You, from `docs/SELFHOSTING.md` | Us |
| Who is the uptime | You | Still nobody — **there is no SLA** (`docs/TERMS-hosted.md` §2) |
| Who is the backup | You (`scripts/unraid-backup-supabase.sh` is provided) | Us |
| Feature requests | Pull requests, under `CONTRIBUTING.md` | Taken best-effort, **no timelines** |
| Your data | On your box | On ours, never merged with anyone's, exported encrypted when you leave |
| Your domain | Yours | **Still yours** — we take DNS delegation, never the registrar |
| Cost | Electricity, or roughly $30/mo of cloud if you want it hands-off | A monthly fee, in advance, covering that infrastructure plus time |

The honest summary of what managed buys: **it buys the setup and the
babysitting, not a guarantee.** That is a real product — the setup is
genuinely hard (§3) — but it must never be described as reliability.

### 1.4 What to promise, and what never to promise

Given no SLA, the language discipline matters more than usual.

**Promise:**
- We will stand your deployment up and it will work on day one.
- We will keep it on a supported version and back it up.
- We will show you the full infrastructure cost before provisioning anything
  (`docs/TERMS-hosted.md` §3).
- Your data is yours: not read without your per-incident consent, never merged
  with another guild's, exported encrypted to a key you hold when you leave.
- You own your domain the entire time.
- Feature requests get looked at, and the ones that help every guild get built.

**Never promise:**
- Uptime, a response time, or a fix window. Not "we usually respond in a day" —
  that becomes an expectation, and one person plus a raid schedule cannot hold
  it.
- A delivery date for any feature. `docs/TERMS-hosted.md` §2 says best-effort,
  no timelines; sales copy must not quietly upgrade that.
- That the server, or this platform, will still be here in a year (§0).
- Anything about performance, parse accuracy, or coverage that is not already
  measured in this repo.
- Any implication that this is endorsed by, affiliated with, or blessed by the
  game's owner or the server's operators. It is not, and saying otherwise is
  the fastest route to §8's worst risk.

**Next actions.** (a) Write the three size descriptions above into a single
public page, in these words, before the brochure goes out — **half a day**.
(b) Add a one-line "no SLA" statement to that page, not buried in terms —
**ten minutes**, and it is the most important ten minutes in this section.

---

## 2. Sales and marketing

### 2.1 Channels that actually reach these guilds

Ordered by how well they work, which is roughly the inverse of how much effort
they take.

| Channel | What it is | Effort | Honest expectation |
|---|---|---|---|
| **Allied guild leaders, directly** | A conversation with someone who already knows us | Hours | This is where the first two adopters come from. Everything else is a supporting act |
| **The server's own community spaces** | The places guilds already gather to discuss the server | A few hours to write one good post | Good reach, one shot. A second post reads as spam |
| **Individual guild Discord servers** | Being invited in by a guild leader who asked | Per-guild | Only ever inbound. Cold-joining a guild's Discord to pitch is how you become the thing people warn each other about |
| **A page on the existing site** | `wolfpack.quest` already exists and already renders. A `/for-guilds` route is a normal web change | **1–2 days** including copy | The thing every other channel links to. Build this before the brochure, not after |
| **The brochure** | A one-page, screenshot-led PDF or image a guild leader can paste into their own officer channel | **1 day** for the first version | Its whole job is to survive being forwarded. Design for a phone screenshot |
| **The repository itself** | A public repo with a readable README is a credential | Already done | Passive. Nobody finds you this way, but it closes people who are already looking |
| **Word of mouth from members** | A raider in two guilds mentions the overlay | Zero | Unmeasurable and probably the largest single source. Optimise by making the client good, not by asking |

**Do not** buy advertising, make videos, or start a content schedule. Against a
nine-month horizon and a total addressable market of the guilds on one server,
every one of those costs more than it can return.

### 2.2 What the brochure has to do

It has one job: make a guild leader forward it. That means it must be readable
in about thirty seconds on a phone, and every claim on it must be true.

Content, in order:

1. **One line of what it is.** Not a feature list — the problem it removes.
2. **Three screenshots**, because this is a visual product and the overlays are
   the thing people react to. `docs/` already holds a `flyer-v2.gif` and several
   setup screenshots from earlier onboarding work.
3. **The numbers, which are real and are the strongest thing we have.** Only
   these, only in this form:
   - **217 raid nights recorded** · **12,891 fights parsed** · **691 million
     points of damage tracked** (Supabase aggregate counts as of 2026-09-17)
   - **135 bosses tracked** across five expansions (`data/bosses.json`) —
     phrase this as *"Classic through Luclin, with Planes of Power tracking
     ready"*, because PoP is locked until 2026-10-01 in `utils/config.js`
     (`isPopLocked()`), and claiming it as live today would be false
   - **88 slash commands** (`commands/*.js`) and **13 in-game overlays**
     (`apps/mimic/*.html`)
4. **"Free for your guild, forever"** with the one-sentence license explanation.
5. **One link**, to the site page from §2.1. Not five links.

**Never on the brochure:** how many people or installs we have, anything about
another guild's data, any member's name or character name, or any
screenshot that shows real chat, real tells, or a real roster. That last one is
a live issue in this repo — `docs/DECISIONS-2026-09-18.md` flags that some
public pages still render real raid data in their mock components, and those
must be swapped before any of this is promoted.

### 2.3 The pitch sequence

Five steps, and the discipline is in step 4.

1. **Show, don't tell.** A screenshot of the timer board or a parse card in a
   conversation the guild leader is already in.
2. **"It's free for your guild. Here's the page."** The license is the pitch —
   it removes the "what's the catch" objection before it is asked.
3. **Offer a look, not a deployment.** A walkthrough of the running system, 20
   minutes, screen-shared. This is where the actual selling happens.
4. **Let them try to self-host — and be honest that it is hard.** §3 says most
   people will not finish. Say so up front. A guild that abandons a setup you
   promised was easy is a lost customer; a guild that abandons a setup you
   *warned* was hard is a customer asking about managed hosting.
5. **Managed is the answer to their abandonment, not the opening offer.** If
   they ask what it costs before step 4, the answer is "tell me your size and
   I'll price it" — not a number in the air.

### 2.4 Referrals from allied guilds

The only referral mechanism worth building is the one that costs nothing: **a
guild that is happy tells another guild.** Do not build a referral program, a
discount code, or a tracking link. At this scale, referrals arrive as a
sentence in a Discord message, and any scheme to formalise them costs more to
run than the revenue it could possibly route.

The one thing worth doing: when a guild is referred, **say who sent them, to
them, and thank the referrer in the open.** That is the entire program.

### 2.5 Is "freemium" worth having here?

The wizard design already flags freemium as an open product decision
(`docs/DESIGN-guild-kit.md` §4). The answer this document gives is: **no, not
as a tier — and yes, as a description of what already exists.**

Freemium normally means *a crippled free version that upsells*. That is
impossible here and undesirable:

- **Impossible**, because the license explicitly grants a guild full use of
  everything for free (`docs/LICENSING.md`). There is no feature we can hold
  back from a self-hoster, and any attempt to would be undone by a fork in an
  afternoon.
- **Undesirable**, because the free thing is what makes the paid thing
  credible. A guild that can read the code and run it themselves is a guild
  that can trust us with their data.

What we actually have is the honest version: **the software is free and
complete; the labour is what costs money.** That is not freemium, it is
open-core-inverted, and it is a cleaner story. The upsell is not features —
it is §3's 8–20 hours.

**Next actions.** (a) Build `/for-guilds` on the site — **1–2 days**, following
the repo's UI rule of presenting the guild lead two or three options rather
than one design (`CLAUDE.md`). (b) Sweep the public pages' mock data for real
member and raid names before promoting anything — **half a day**, and it is a
blocker, not a nice-to-have. (c) Draft the brochure — **1 day**.

---

## 3. Onboarding funnel

### 3.1 Where people drop, with a number

`docs/DESIGN-external-tenancy.md` §0 measured this honestly and the number is
the most important input to this entire document:

> For a competent-but-not-expert guild officer, working alone from the README:
> **8–20 hours spread over a week, with a ~70–80% chance of abandonment.**

Named give-up points, from that same section: (a) the Discord anchor-ID
ceremony — roughly 30 hand-copied channel, thread and message IDs; (b) the
database — many migrations and a large reference catalog with no self-serve
import path; (c) the first silent failure with no diagnostic.

Against that estimate, a rough funnel for a hundred guild leaders who see the
brochure — these are **judgement, not measurement**, and should be replaced
with real numbers the moment any exist:

| Stage | Survives | Why they leave |
|---|---|---|
| See the brochure | 100 | — |
| Open the site page | maybe a third | Not raiding seriously; already have a solution; wrong moment |
| Start a setup | a handful | It is a big commitment for an unproven tool |
| **Finish a setup** | **~1 in 4 of those who start** | The measured 70–80% abandonment |
| Still running it a month later | fewer still | Nobody was the uptime |
| Ask about managed hosting | the ones who abandoned *and* still wanted it | — |

The uncomfortable, useful read: **the abandonment rate is the sales funnel for
managed hosting.** People who fail at step 4 and still want the product are
exactly the people who should be paying someone to do it. This is only an
honest business if we tell them the difficulty up front (§2.3 step 4) rather
than letting them discover it.

### 3.2 What the wizard fixes, and what it does not

The wizard is designed but mostly unbuilt: `docs/DESIGN-guild-kit.md` §7 has
the slice plan with the guild lead's own effort estimates.

| Give-up point | Fixed by | Status / estimate |
|---|---|---|
| ~30 hand-copied Discord IDs | Slice 3 — the Discord provisioner creates the layout and captures the IDs itself | **2–3 days**, unbuilt. This is the single highest-value item in the whole document |
| Migrations leaving tables missing | Already fixed — `supabase/bootstrap/` + `scripts/selfhost-bootstrap-db.sh` takes an empty Postgres to a complete schema in one pass | **Done** (`docs/DESIGN-external-tenancy.md` header note) |
| Silent failures with no diagnostic | Slice 4 — `wolfpack doctor`, built so its output cannot contain secrets or member data | **1–2 days**, unbuilt |
| Our name and URLs baked into the product | Slice 2 — the de-branding sweep, roughly 580 hardcoded sites | **2–3 days**, unbuilt, and blocked behind slice 1b |
| Everything strung together | Slice 5 — the CLI wizard | **2–3 days**, unbuilt |

Plus **slice 1b**, the config loader, at **1 day** — slice 1a already landed.

That is roughly **9–14 days of focused work** to take the funnel from "most
people abandon" to something a pilot can complete. Against a nine-month
horizon, spending two to three weeks on it is defensible **only if there is a
pilot guild waiting at the end of it**. Building the wizard speculatively is
the most likely way to spend the whole horizon on plumbing.

### 3.3 What a pilot guild is for

Exactly one thing: **to find out whether anyone outside this guild can finish.**
Not revenue, not a reference, not a testimonial.

The design already sets the exit criterion — *one pilot guild, sat with;
success is under 5 hours and at most 3 questions* (`docs/DESIGN-guild-kit.md`
§7). Hold to that number. Some concrete framing:

- **Pick an allied guild**, because the failure mode of a pilot is an unhappy
  stranger, and an ally will tell you the truth instead of quietly giving up.
- **The pilot is free.** Charging for the run where you find out the product
  does not install is indefensible.
- **Sit with them and take notes on every question.** Each question is either a
  documentation bug or a wizard slice.
- **Do not fix things live.** Write them down, fix them after, and re-run.
- **The pilot ends with a decision**, not a customer: either the setup is now
  under five hours, or the managed path is the only real product and the
  self-host story stays "here is the repo, good luck."

**Next actions.** (a) Find one allied guild willing to be the pilot — a
conversation, **this month**. (b) Do slices 1b and 3 before that pilot, because
the Discord ceremony alone will end it otherwise — **3–4 days**. (c) Keep a
literal list of every question the pilot asks; it is the onboarding backlog.

---

## 4. Pricing mechanics

### 4.1 The real infrastructure numbers

All measured, all in `docs/DESIGN-selfhost-wizard.md` §2a:

| Layer | Plan | Monthly | What we measured |
|---|---|---|---|
| Supabase | Pro | **$25** | Our own database at 1.72 GB of the 8 GB included |
| Railway | Hobby | **$5** (includes $5 of usage) | Our bot draws roughly **$1.92/mo** of resources at Railway's published rates |
| Vercel | Hobby today | **$0** | ⚠ Must become a paid plan the moment anyone pays us — Hobby is non-commercial |
| **Floor, fully hosted** | | **≈ $30/mo** | |
| **Floor, fully on-prem** | | **$0** + electricity | |

Two facts that change how a fee is justified, both from the same section:

- **Neither provider meters requests.** They bill storage and data transfer. So
  a second guild's *upload* traffic is close to free, while their *reads* —
  poll cadences, wide queries, un-cached refreshes — are what actually cost.
- **Database size is the number that only grows**, and it is dominated by
  high-volume ephemeral telemetry, not by guild history. The most detail-rich
  telemetry table accretes roughly 15 MB/day and is more than half our database,
  while two and a half years of guild chat history is a fraction of it. **A
  guild's cost is set by its retention windows, not by its size.**

### 4.2 What a second guild actually costs us

The honest answer depends entirely on shape:

| Shape | Marginal infrastructure cost | Notes |
|---|---|---|
| Their own Supabase project + their own Railway service, in their name | **≈ $30/mo**, billed to them directly | Cleanest. We charge only for time |
| A schema on our existing Supabase Pro, a second bot process on our Railway | **Low** — headroom exists on both, but storage grows per guild and a second Postgres of similar shape is not free | Cheapest to run, most expensive in risk (§8) |
| Fully on-prem, on their hardware | **$0 to us** | We charge only for setup and time |

The marginal-cost answer is therefore *"between nothing and $30, depending on
where it runs"* — which is exactly why `docs/TERMS-hosted.md` §3 commits to
**showing the full infrastructure cost of a size before provisioning anything**
and treating that cost as part of the fee rather than a separate line.

### 4.3 How to state a fee

The terms already fix the mechanics: **monthly, in advance, agreed per guild
against the size, not published** (`docs/TERMS-hosted.md` §4). What is left is
how to say it in a conversation. A defensible structure:

> *"Your deployment costs $X/mo in infrastructure — here is the breakdown. On
> top of that is my time: setup, keeping it running, and taking your feature
> requests. That's $Y/mo. Total $Z, paid before the month starts. No contract,
> no uptime guarantee; stop any month and I hand you an encrypted copy of
> everything."*

Three rules for the number:

1. **Show the infrastructure line separately, then fold it into one total.**
   Transparency on the cost half is what makes the time half credible.
2. **The time component should be a round monthly number, not an hourly rate.**
   Hourly invites arguments about hours, and the actual pattern of work is
   lumpy: heavy at setup, near-zero for weeks, then a raid-night problem.
3. **Do not discount the first guild to zero and call it paid.** Either the
   pilot is free and named as a pilot (§3.3), or it is a paying arrangement at
   a real number. A $0 "customer" teaches nothing about whether anyone will pay.

⚠ **Setup is the expensive part and it is not monthly.** Standing a deployment
up is days of work; running it is hours a month. A pure monthly fee means the
first month is sold at a loss and a guild that leaves after one month is pure
cost. Two ways to handle it, both needing a decision:

- **A one-time setup fee** plus a lower monthly. Honest, matches the shape of
  the work, and slightly harder to sell.
- **A minimum term** — e.g. the first three months committed. Simpler to state,
  but it contradicts the current "leave any month end" promise in
  `docs/TERMS-hosted.md` §6 and would need that document changed.

**This is an open decision, and it is the pricing decision that matters most.**

### 4.4 Per-guild invoicing

At a handful of guilds this is deliberately manual:

- **One invoice per guild per month**, issued before the month starts, paid
  before it starts.
- **Sequential invoice numbers** and a dated record of what was billed for
  which month. This is the minimum an accountant will ask for (§7).
- **Non-payment is not a dispute, it is non-renewal.** The terms already say
  so (`docs/TERMS-hosted.md` §4): the month simply does not begin, and the exit
  process in §6 runs. Say this at signup so it is never a surprise.
- **Do not automate this** until there are enough guilds that it hurts. With a
  handful, a recurring calendar reminder and a template beats any system.

### 4.5 What happens at a merge

This is not hypothetical — merges are the dominant event of the horizon (§0),
and a tenant/roster/DKP merge operation **does not exist today**
(`docs/DECISIONS-2026-09-18.md`, Open table). Two paying guilds becoming one
raises three separate questions:

| Question | The answer to write down before it happens |
|---|---|
| **Billing** | The surviving guild continues at the size it needs; the absorbed guild's arrangement ends at its paid month end. No refund of the part-month (consistent with §4 — a month is paid, not pro-rated), and no double-billing into the next month |
| **Data** | The absorbed guild's data is **theirs**, not the survivor's. The default is the exit process: encrypted export handed to the absorbed guild's leadership. Merging it into the survivor's deployment is a **separate, explicitly consented operation**, requested by the absorbed guild, not assumed from the merge |
| **Tooling** | The merge operation itself — combining rosters and DKP histories — does not exist. It is real work, it is squarely in the horizon, and it is the most likely thing a paying guild asks for that we cannot do today |

⚠ **Never merge two guilds' data on the strength of one leader's say-so.** The
terms make cross-tenant separation a stated protection
(`docs/TERMS-hosted.md` §5), and a merge is the one situation where it is
tempting to break it. Written consent from both sides, or it does not happen.

**Next actions.** (a) Decide setup-fee vs minimum-term (§4.3) — a conversation,
not a build. (b) Write the merge-billing answers above into
`docs/TERMS-hosted.md` before the first arrangement, since a merge is more
likely than a renewal over this horizon — **half a day**. (c) Price one
hypothetical S and one hypothetical M end to end as an exercise, so the first
real conversation is not the first time the number is computed — **an hour**.

---

## 5. Taking payment

### 5.1 The options, for one person, at this scale

| Option | What it needs | Fees | Fit here |
|---|---|---|---|
| **Stripe** (invoicing or subscriptions) | Business details; can usually start as an individual/sole proprietor, but ask (§5.2). Bank account. Tax ID | Roughly a few percent plus a fixed amount per transaction | **The default answer.** Proper invoices, recurring billing, clean records for an accountant. Overkill at one guild, right at three |
| **PayPal** (invoices, or business account) | Least setup. Individual accounts exist | Similar order | Fastest to start. Weaker records, and a well-known history of holding funds on unusual account activity — worth asking about before relying on it |
| **Ko-fi / Patreon / "buy me a coffee"** | Almost nothing | Platform cut | **Wrong shape.** These are donation platforms. Taking money for a contracted service through one blurs gift and invoice, which is exactly the ambiguity an accountant and a lawyer both need removed |
| **Direct invoice + bank transfer** | A bank account and an invoice template | Near zero | Perfectly viable at a handful of guilds. Manual, no automatic recurrence, no card |
| **Crypto** | — | — | No. Volatile, records are harder not easier, and it signals the wrong thing to a guild leader deciding whether to trust you with their data |

**Recommendation: Stripe invoicing, or direct invoice + bank transfer, and
nothing donation-shaped.** The distinction that matters is not fees — at these
amounts fees are noise — it is that a paid service needs a record that looks
like a service, because that is what §6 and §7 are built on.

### 5.2 The questions for a professional

Do not guess at any of these.

**For an accountant / tax professional:**
1. "I am one person in [jurisdiction]. If I take a few hundred dollars a month
   from a handful of customers for a hosting service, what am I required to
   register before the first payment?"
2. "Can I take this through a personal bank account and a personal payment
   account, or do I need a business account first?"
3. "Do I need a tax ID separate from my personal one, and does that change if I
   form an entity?"
4. "My customers may be in other countries. What changes about my obligations
   if they are?"

**For the payment processor (in writing, before relying on them):**
5. "My service is software hosting for gaming communities, and the software is
   tooling for an emulated game server. Is that within your acceptable use
   policy?" — **Ask this explicitly.** Anything adjacent to game emulation sits
   near several processors' restricted lists, and finding out after a guild has
   paid is the bad version.

### 5.3 Chargebacks and refunds, given month-in-advance

Payment in advance for a service with no SLA is the highest-chargeback shape
there is — the customer has paid for something they cannot point at. Posture:

- **Be radically clear at signup.** The no-SLA line from §1.4, and the "a month
  is paid, not pro-rated" line, stated in the conversation *and* in the invoice
  text, not only in `docs/TERMS-hosted.md`.
- **Keep a written record of what was agreed**, per guild, per month. A saved
  message thread is a record. This is the only real defence against a dispute.
- **Refund posture: refund it.** At these amounts, one person's time arguing a
  dispute costs more than the month, and a disputed charge on a small server is
  a reputational event that reaches every other guild within a week. A fought
  dispute wins the month and loses the market.
- **The exception** is a guild that has already received the encrypted handover
  and then disputes — at that point they hold the delivered thing. Even then,
  document and decide once; do not build a policy for a case that has not
  happened.
- **Never take a payment you are not confident you can service.** If the month
  ahead contains a move, a holiday, or the game server looking shaky, say so
  before invoicing.

### 5.4 How the encrypted exit interacts with billing

The exit is defined in `docs/TERMS-hosted.md` §6: at the end of the last paid
month, data is exported, encrypted to a key the guild holds, and handed over;
deletion follows, on a window still marked as a placeholder. Three interactions
worth stating explicitly because they are where money and data touch:

1. **The handover is not conditional on anything.** It is not leverage, it is
   not withheld for a disputed invoice, and it happens whether they left
   happily or not. A hosting arrangement that holds data hostage is
   indefensible and would end the business on a server this small.
2. **The handover has a cost in time**, and it is not currently priced. Ask:
   is a full encrypted export part of the last month's fee, or a one-time exit
   task? The defensible answer is **part of the fee** — it is the promise that
   makes the whole arrangement safe to enter — and that argues again for §4.3's
   setup fee, which is where that cost really belongs.
3. **The deletion window is an open legal question**, already logged as such
   (`docs/TERMS-hosted.md` §9.3). Until it is answered, do not state a number
   to a guild.

**Next actions.** (a) Ask the processor question (§5.2 item 5) **in writing**
before anything else in this section — **a day of waiting, zero effort**, and
it can invalidate the plan. (b) Write a one-paragraph plain-English payment and
refund statement to accompany every invoice — **an hour**. (c) Do not open any
payment account until §6's sequence says to.

---

## 6. Incorporation

### 6.1 The three options

| Option | What it is | Protects personal assets? | Effort / cost | When it fits |
|---|---|---|---|---|
| **Nothing** — free only, never take money | The status quo | Not applicable, no service is sold | Zero | **Genuinely the right answer if the pilot (§3.3) shows nobody will pay** |
| **Sole proprietor** (or the local equivalent) | Operate as yourself; income is personal income | **No.** A claim reaches personal assets | Low — often just registration and a tax line | The smallest real option. Ask whether it is enough given §6.2 |
| **A limited-liability entity** (LLC or local equivalent) | A separate legal person that holds the contracts and the accounts | **That is its entire purpose**, subject to keeping it genuinely separate | Formation fee, annual filings, separate bank account, more bookkeeping | If money is taken for hosting **other guilds' data** |

### 6.2 Why the answer depends on liability, not revenue

This is the section's whole argument, and it is the one that gets reasoned
backwards. The instinct is *"a few hundred a month is too small to incorporate
for."* That reasons from revenue. The exposure here does not come from revenue —
it comes from **custody**.

A managed deployment means holding another guild's data: their members' Discord
identities, their chat relays, their private tells
(`docs/PRIVACY.md`, and the ingest surface listed in `CLAUDE.md`). The
realistic bad day is not a contract dispute over $30 — it is a breach, or a
member of someone else's guild objecting to what was stored about them. **The
size of that exposure has nothing to do with what was charged.**

Two aggravating factors specific to this situation:

- **A $0 favour has exposure too, but taking money is what makes it a business
  relationship** with expectations attached. The moment of first payment is the
  moment the calculus changes, which is why §6.4 sequences the entity first.
- **One person.** There is no partner to absorb a bad month, and no corporate
  veil unless one is created.

The honest framing for the decision: *an entity is not about whether the
revenue justifies the paperwork. It is about whether you are willing to hold
another guild's members' data as yourself.*

### 6.3 The questions to ask

**For a lawyer:**
1. "I am one person hosting software that stores other communities' chat,
   member lists and private messages, for a small monthly fee. What entity
   structure is appropriate, and does it meaningfully limit my personal
   exposure if that data is breached?"
2. "The software is tooling for an emulated game server that operates without
   the game owner's involvement. Does that create exposure for me, and does it
   change if I take money for it?" — **Ask this one explicitly.** It is the
   risk most specific to this situation and the one a general business lawyer
   will not raise unprompted.
3. "Here is my draft service terms document (`docs/TERMS-hosted.md`). It has a
   §9 listing what I know I do not know — liability and warranty for the
   service, governing law and venue, the deletion window after handover, the
   notice period, and whether consent-for-support needs a written form. What
   else is missing?"
4. "Do I need any specific privacy language or a privacy policy given that the
   data includes other people's chat messages, and does it matter that those
   people are not my customers — they are my customer's members?"
5. "My code license is BSL 1.1 converting to AGPL-3.0. Does hosting for a fee
   under my own license need anything written down beyond the service terms?"

**For an accountant:** the four questions in §5.2, plus:
6. "If I form an entity, what changes about how I record the infrastructure
   costs I am already paying personally today?"

### 6.4 The sequence

Order matters, and doing it out of order is how a first payment lands in a
personal account under terms nobody reviewed.

1. **Decide whether to take money at all.** Gate this on the pilot (§3.3). If
   nobody will pay, the entire rest of this stops here and that is a fine
   outcome.
2. **Talk to the server's operators.** Already a stated prerequisite
   (`docs/TERMS-hosted.md` §9.5, `docs/DECISIONS-2026-09-18.md` §2). This is
   before the lawyer, because a "no" here ends it cheaply.
3. **Lawyer**, with §6.3's questions and the terms draft.
4. **Form the entity** (or decide, on advice, that sole proprietor is enough).
5. **Business bank account** in the entity's name.
6. **Payment processor**, having already asked §5.2 item 5.
7. **Finish the terms** — fill `docs/TERMS-hosted.md` §9's placeholders, drop
   the DRAFT header.
8. **Then** the first arrangement.

Steps 2–7 are mostly waiting, not working: perhaps **a few days of actual
effort spread over four to eight weeks**. Against a nine-month horizon, that is
a meaningful fraction of it — which is itself an argument for starting step 2
now and step 4 only when a paying guild actually exists.

---

## 7. Accounting

### 7.1 Proportionate bookkeeping

For a handful of guilds, one person: **a spreadsheet and a folder.** Nothing
more, until an accountant says otherwise.

| What to track | Granularity | Why |
|---|---|---|
| **Revenue** | One row per guild per month: date, invoice number, amount, paid date | The minimum record for tax, and the only defence in a dispute (§5.3) |
| **Infrastructure cost, per guild** | Monthly, from the providers' own invoices | Needed to prove the fee is cost-plus (§4.3), and to notice the month a guild's retention settings start costing real money |
| **Shared infrastructure cost** | Monthly | The costs not attributable to one guild. Do not over-engineer the allocation; note it and move on |
| **Time** | Roughly, per guild, in hours | Not for billing — the fee is monthly, not hourly — but to answer *"is this worth doing?"* honestly at the 90- and 270-day checkpoints (§9) |
| **Everything else paid for** | As it happens | Domains, any paid tooling, the entity's own filing fees |

Two notes specific to this setup:

- **Per-guild infrastructure cost is knowable if each guild's deployment is in
  their own name** (which the terms already require —
  `docs/TERMS-hosted.md` §7). If deployments share our accounts instead, the
  attribution becomes an estimate. That is a real argument for the separated
  shape in §4.2, on accounting grounds as well as risk grounds.
- **Track when infrastructure costs change.** Both providers bill on storage
  and transfer, not requests (§4.1), so a guild's bill drifts with its
  retention settings rather than with its size. A guild whose telemetry
  retention was left at our defaults will cost more than one sized for a small
  tier — and nobody will notice unless it is written down monthly.

### 7.2 The questions for an accountant

Beyond §5.2's registration questions:

1. "Do I have to issue tax forms to anyone, or receive them from a payment
   processor, at these amounts?" — in the US this is the 1099 question; ask it
   in local terms.
2. "Is a hosting service taxable as a sale in my state or country, and does
   that change based on where my customer is?" — the sales-tax / VAT / GST
   question. **This is the one most likely to produce a surprising answer**,
   because digital services are taxed by the customer's location in several
   places.
3. "My customers may be in other countries. At what point do I have an
   obligation there?"
4. "Can I deduct the infrastructure I am already paying for, and does it matter
   that some of it also serves my own guild's non-commercial use?" — this one
   is genuinely specific to this situation: the same Supabase project serves
   both, and that mixed use needs an answer rather than an assumption.
5. "What records do you want me to keep, and for how long?"

### 7.3 What to keep

Invoices issued; provider invoices received; the written record of what each
guild agreed to and when; bank and processor statements; the entity's own
filings. Keep them for however long the answer to §7.2 item 5 says.

**What not to keep:** any copy of a guild's data outside their running
deployment. Retaining an export "just in case" converts a clean exit into a
standing liability, and it contradicts the deletion promise in
`docs/TERMS-hosted.md` §6.

**Next actions.** (a) Start the spreadsheet **now**, before any revenue, with
the infrastructure costs already being paid — **an hour**, and it makes the
first accountant conversation concrete instead of hypothetical. (b) Ask §7.2
item 2 early; it can change pricing.

---

## 8. Risk register

Ordered by expected impact, not likelihood.

### 8.1 The game owner objects to third-party tooling

**Impact: total.** Everything here is tooling for an emulated server that
operates on the game owner's tolerance (`docs/DECISIONS-2026-09-18.md` §2).
Charging money is visibly different from a guild sharing a tool, and it raises
the profile of the whole thing.

- **Decided:** a conversation with the server's operators is a **prerequisite**
  to the first paid arrangement, not a follow-up
  (`docs/TERMS-hosted.md` §9.5).
- **Still needed:** ask the lawyer §6.3 item 2. And decide in advance what
  happens if the answer is a soft no — the answer should be *the free,
  self-hosted product continues and the paid one does not start*, since the
  license already permits every guild to run it themselves.

### 8.2 The server closes, or shrinks below viability

**Impact: total, and it is the expected case.** The horizon is roughly nine
months for large guilds, with merges and shrinkage before that, and eventual
closure possible (§0).

- **Decided:** export and portability **outrank** hosting
  (`docs/DECISIONS-2026-09-18.md` §8.2). Every guild must always be able to
  walk away holding a complete archive. The Quarm-specific seams — the log file
  naming and the reference catalog — are already written down as the
  portability list for any other EQEmu server.
- **Still needed:** a decision on what happens to paying guilds at closure. The
  defensible answer, which should be stated in the terms rather than improvised:
  **billing stops, the export runs, nobody is billed for a month in which the
  game server ceased to exist.**

### 8.3 A data breach on hosted data

**Impact: severe and personal.** This is the risk that drives §6.

- **Decided:** tenant data is tenant-owned; no standing operator access; the
  operator does not read a guild's data without express per-incident consent;
  the support tooling is built so its output cannot contain secrets or member
  data; cross-tenant data is never merged
  (`docs/TERMS-hosted.md` §5, `docs/DECISIONS-2026-09-18.md` §3).
- **Still needed, all three:** (a) the entity decision in §6; (b) the lawyer's
  answer on privacy obligations to people who are not customers — a guild's
  members did not sign anything (§6.3 item 4); (c) a written answer to *"what
  do I do in the first hour"* if it happens. That last one costs half a day and
  does not exist.

### 8.4 Key-person risk — one maintainer

**Impact: severe, and it is structural, not hypothetical.** One person is the
developer, the support desk, the accounts, and a raider with a schedule.

- **Partly mitigated by design:** the license means **every guild can always
  run it themselves** (`docs/LICENSING.md`), the code is public, the
  deployment is documented (`docs/SELFHOSTING.md`), and the exit hands every
  guild a complete encrypted archive. A guild's worst case is a migration, not
  a loss.
- **Explicitly not mitigated by a promise:** there is no SLA precisely because
  one person cannot honour one (`docs/TERMS-hosted.md` §2). The mitigation is
  honesty at the point of sale (§1.4), not redundancy that does not exist.
- **Still needed:** a stated answer to *"what happens if you are unavailable for
  a month?"* — a guild leader will ask, and the true answer is *"your
  deployment keeps running, nothing new gets built, and if you want out I hand
  you the archive."* Write it down before it is asked.

### 8.5 A guild leaves mid-month

**Impact: low, and already handled.**

- **Decided:** monthly in advance, non-renewal ends the arrangement at the paid
  month's end, no partial month, no obligation to keep a lapsed deployment
  running, encrypted export handed over at term end
  (`docs/TERMS-hosted.md` §4, §6).
- **Still needed:** the deletion window after handover and the notice period
  for the operator ending an arrangement are both open placeholders in that
  document's §9 — and the setup-cost question from §4.3, which is what actually
  makes an early departure expensive.

### 8.6 A competitor forks under the license

**Impact: moderate, and largely by design.**

- **What the license does:** anyone may fork, modify and run it for their own
  guild, free. **Offering it to third parties for a fee requires an arrangement
  with the Licensor** (`docs/LICENSING.md`). Every version becomes AGPL four
  years after it ships, so nothing is locked away permanently.
- **What the license cannot do**, and this is written down rather than wished
  away: it **cannot compel share-back** before the Change Date — the BSL's
  Covenants allow the Additional Use Grant only to add permission, never to
  impose a condition (`docs/DECISIONS-2026-09-18.md` §1). Upstream
  contribution is a norm asked for in `CONTRIBUTING.md`, not an enforceable
  term.
- **The realistic competitor is not a fork.** It is a guild deciding a
  spreadsheet is fine, or an existing well-known raid tool adding one feature.
  Forking this platform means inheriting the 8–20 hour setup (§3.1); that is a
  much better moat than the license.
- **Still needed:** the commercial terms — what an arrangement actually costs
  someone who wants to host it commercially — are **deliberately not in the
  license and are undecided** (`docs/DECISIONS-2026-09-18.md`, Open table).
  Decide before the first person asks, not during the conversation.

### 8.7 Two smaller ones worth naming

- **Vercel Hobby's non-commercial clause.** The moment anyone pays, the plan
  must be upgraded (§0). This is a five-minute fix and a real terms violation if
  missed; put it in the go-live checklist, not in someone's memory.
- **Public pages still rendering real raid data in mock components.** Flagged
  open in `docs/DECISIONS-2026-09-18.md`. Under a public license, on a site
  about to be promoted to other guilds, that is a privacy problem before it is
  a marketing problem. **Blocker for §2's launch.**

---

## 9. The nine-month plan

The horizon is the constraint. Everything below is sized to fit inside it, and
§9.4 says when to stop.

### 9.1 Next 30 days — find out if anyone wants this

No entity, no payment account, no wizard work. Answer one question: *does a
second guild want this enough to try?*

| Do | Effort |
|---|---|
| Sweep public pages for real member and raid data in mock components (§8.7) — **blocker** | half a day |
| Build the `/for-guilds` page, with the sizes, the honest cost lines, and the no-SLA statement (§1.4) | 1–2 days |
| Draft the brochure with the verified numbers from §2.2 | 1 day |
| Show it to two or three allied guild leaders — the actual experiment | hours |
| **Start the conversation with the server's operators** (§6.4 step 2) | hours, then waiting |
| Start the bookkeeping spreadsheet with current infrastructure costs (§7.1) | an hour |

**Exit condition:** at least one guild says *"yes, I want to run this."* If
nobody does, go to §9.4.

### 9.2 Next 90 days — make it installable, with a pilot

Only if §9.1 produced a real pilot candidate.

| Do | Effort |
|---|---|
| Guild-kit slice 1b — the config loader | 1 day |
| Slice 3 — the Discord provisioner. **The single highest-value item in this document** (§3.2) | 2–3 days |
| Slice 4 — `wolfpack doctor` | 1–2 days |
| Slice 2 — the de-branding sweep | 2–3 days |
| Slice 5 — the CLI wizard stringing them together | 2–3 days |
| **Run the pilot**, sat with, notes on every question (§3.3) | 1 week + support |
| In parallel: the lawyer conversation (§6.3), *if* the pilot guild has asked about paying | waiting, mostly |

**Exit condition:** the pilot finished in under five hours with at most three
questions. If it did not, the self-host product is not real yet and §9.3 must
not assume it.

### 9.3 Next 270 days — take money only if it is earned

| Do | Gate |
|---|---|
| Complete §6.4's sequence — operators, lawyer, entity, bank, processor, terms finalised | Only if a guild has said they want to pay |
| Upgrade Vercel off Hobby | The day before the first payment, not after |
| Decide setup-fee vs minimum-term (§4.3) | Before the first invoice |
| Decide and write the commercial-arrangement terms for third-party hosting (§8.6) | Before someone asks |
| Build the roster/DKP **merge** operation (§4.5) | When the first guild needs it — which the horizon says is likely |
| Fill `docs/TERMS-hosted.md` §9's placeholders and drop the DRAFT header | Before the first arrangement |
| Keep shipping the platform itself | Always — it is the product, paid or not |

Everything in that table is gated. None of it is worth doing speculatively
against this horizon.

### 9.4 The explicit point at which this is not worth doing

Stop, and keep the free self-hosted product, if **any** of these is true:

1. **The operator conversation returns anything other than a clear yes.** The
   free product continues; the paid one does not start.
2. **No guild completes a pilot setup in under five hours after the wizard
   slices are built.** The onboarding funnel is then not a funnel, and managed
   hosting means personally installing every deployment — which one person
   cannot sustain.
3. **Nobody offers to pay by day 90.** Two or three allied guilds is the entire
   realistic market; if none of them wants to pay after seeing it work, the
   demand is not there and further effort is speculation against a shrinking
   clock.
4. **The lawyer's answer to §6.3 item 2 is discouraging**, or the entity and
   professional advice cost more than a year of realistic revenue.
5. **The server's population falls far enough that the remaining guilds are
   merging rather than tooling up.** That is the horizon arriving, and the
   correct response is to make sure everyone holds their archive.

**And say the quiet part plainly: stopping here is a good outcome, not a
failure.** The platform is already valuable, already free for any guild to run,
already licensed so it becomes fully open source regardless, and already
documented well enough for someone else to carry. The business is an option on
top of that, not the point of it. If the option is not worth exercising, the
thing underneath is unharmed — and the nine months are better spent making the
raid tooling better for the guilds that are still playing.

---

## Where this leaves the open decisions

| Decision | Who decides | Blocking what |
|---|---|---|
| Setup fee vs minimum term (§4.3) | the guild lead | The first invoice |
| Commercial-arrangement terms for third-party hosting (§8.6) | the guild lead | The first person who asks to host it commercially |
| Entity: none / sole proprietor / LLC (§6) | the guild lead, on a lawyer's advice | The first payment |
| Deletion window after handover; notice period (`docs/TERMS-hosted.md` §9) | a lawyer | Finalising the terms |
| Service liability and warranty; governing law and venue | a lawyer | Finalising the terms |
| Sales tax / VAT treatment of hosting (§7.2) | an accountant | Pricing |
| Is game-emulator tooling within the payment processor's acceptable use? (§5.2) | the processor, in writing | Everything downstream of taking payment |
| What happens to paying guilds at server closure (§8.2) | the guild lead | Should be in the terms before the first arrangement |
| Whether to take money at all (§9.4) | the guild lead | Everything |
