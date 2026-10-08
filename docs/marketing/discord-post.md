# Sharing this in the main PQ Discord's leader channel

For guild leadership to post in the **leader-only channel on the main Project
Quarm Discord** (the guild lead, 2026-09-18). This is not the brochure — that is
a one-page handout for a named guild. This is a short post into someone else's
community space, and it is written differently on purpose.

---

## 1. The post

Fits one Discord message (~1,200 of the 2,000-character limit). Attach the
screenshots from §3.

> **We built a raid platform for Quarm and open-sourced it — free for any guild to run.**
>
> Wolf Pack has been running this for about five months: a Discord bot, a website, and an in-game overlay client. Sharing it in case it's useful to anyone else here.
>
> What it does:
> • **Parses merge themselves.** Every raider's log feeds one record of the fight — no pasting, no arguing about whose parse is right. 12,891 fights so far.
> • **The boss board maintains itself** in a Discord channel; timers edit in place as mobs die. 135 bosses, Classic through Luclin, with PoP flag tracking built and ready for October.
> • **In-game overlays** — DPS and heals, CH chain, rampage warnings, buff queue, mob info. Thirteen of them.
> • **Loot and DKP** — sealed bids, wishlists, OpenDKP ticks, and a written raid recap that posts itself overnight.
>
> It's **AGPL — genuinely open source.** Run it for your guild free, fork it, change whatever you like. The only obligation is the licence's: if you modify it and run it for people over a network, you share your source back.
>
> Setup is honest work — budget an evening or two. Guide: <https://github.com/davehess/QuarmBossTracker/blob/main/docs/SELFHOSTING.md>
> Repo: <https://github.com/davehess/QuarmBossTracker>
>
> Happy to answer questions or walk anyone through setup. Not selling anything.

**Why it reads like that.** A leader-only channel on the server's own Discord is
a peer space, not an advertising surface. "We built this, it's free, here's the
link" is welcome; a pitch deck is not. The last line is doing real work — say it
because it is true (`docs/LICENSING.md`), and because someone will wonder.

**Do not** paste the brochure into this channel. It is designed as a handout for
a specific guild and reads as marketing in a community thread.

## 2. Before posting — three checks

1. **Read the channel's rules on self-promotion.** Some community Discords
   restrict tool posts to a designated channel. If leadership is unsure, ask a
   server admin first — a one-line DM costs nothing and posting into the wrong
   channel is hard to undo.
2. **This is the same audience as the operator conversation already on record**
   (`DECISIONS-2026-09-18.md` §2). Sharing a free, open-source tool is a much
   easier conversation than anything commercial, and this is a good moment for
   it to happen naturally rather than as a formal ask.
3. **A leader-only channel is still ~20 guilds.** Treat anything posted there as
   effectively public — which is the whole reason for §3.

## 3. Screenshots — what is safe, and what is not

⚠ **Every live overlay screenshot contains real raider names**, and usually class,
group, mana and a DPS ranking. Do not post raid captures straight from a client.

**Use `/about` on wolfpack.quest.** As of 2026-09-18 its overlay demo renders
**invented** names (`web/components/about/OverlayDemo.tsx` — it previously showed
ten real raiders, 53 occurrences, which was an open item from the 2026-09-16
sanitization pass and is now closed). It shows the CH chain, the tank overlay,
heals and the buff queue animating on mock data, in the real UI. That makes it
the correct screenshot source: on-brand, always current, and nobody's name on it.

| Shot | Source | Safe? |
|---|---|---|
| Overlay montage (CH chain, tank, buffs) | `/about` | ✅ invented names since 2026-09-18 |
| Boss board / timer channel | a Discord capture | ⚠ check for member names in the sidebar and any kill-credit line |
| Parse card | a Discord capture | ❌ real names and a damage ranking — scrub or skip |
| **Extended Target (pre-targeting)** | a client capture | ❌ a name on every assignment chip, plus the online count — and there is no safe source for it yet (see below) |
| Mimic dashboard | a client capture | ⚠ shows the signed-in character and the Discord display name |
| Installer / first-run | `docs/screenshot-install.png`, `docs/screenshot-logsync-setup.png` | ✅ already in the repo, no names |

**Two or three images is right.** Lead with the overlay montage — it is the thing
nobody else on the server has.

⚠ **The Extended Target overlay is the strongest capability shot we have, and
we cannot post one.** A live Ssraeshza capture (the guild lead, 2026-09-18) shows
a dozen identically-named mobs separated cleanly — several `Disciple of Rhag`,
four `Ssraeshzian ... Priest` — each carrying its own spawn id and its own tank
assignment. That is spawn-id disambiguation working in a real pull at N≈12, and
it is exactly the thing no other tool on the server does. It is also **one real
character name per assignment chip**, roughly a dozen of them, which puts it
firmly in the ❌ row above.

`/about`'s demo has no Extended Target panel — it renders the tank overlay, the
Command Center, the CH chain and loot TTS (`web/components/about/OverlayDemo.tsx`),
so there is nothing safe to substitute. Two options, neither done:
- **Scrub the capture** — the assignment chips are the payload, so blurring them
  removes the point of the shot. Weak.
- **Add an Extended Target panel to the demo** on the same invented-name roster
  as the others. That makes the capability screenshottable permanently, on-brand,
  and for every future conversation rather than this one. Queued in
  `docs/STATUS.md`; the right answer if the shot matters.

Until one of those lands, **describe it in words instead** — the post's overlay
bullet already covers it, and the capability survives a sentence better than most.

⚠ **`/mimic/mini` still renders real raiders** (`web/app/mimic/mini/mocks.tsx`,
`web/lib/miniReview.ts`). Its vote has closed, so it can be swapped the same way
`/about` was — but until it is, **do not screenshot that page.**

## 4. If someone replies

- **"Can you host it for us?"** → Yes, as cost-share, not a product
  (`docs/TERMS-hosted.md`). Infrastructure plus time, no SLA, monthly, your data
  and your domain stay yours. Say the terms are a draft.
- **"What does it cost?"** → Nothing to run yourself. Your own box is
  electricity; fully hosted on cloud services is around $30/month paid to those
  services, not to us (`docs/COSTS.md`).
- **"Can I change the branding?"** → Today it takes real work; that is being
  fixed (`DESIGN-guild-kit.md` §7a/§7b). Be honest rather than promising.
- **"Will you add X?"** → Feature requests go through the issue forms
  (`.github/ISSUE_TEMPLATE/`), and a pull request is worth more than a request.
- **"Is this allowed?"** → It reads the game's own log files and Zeal's pipe,
  same as EQLogParser or GINA. Officer chat and tells are filtered on the
  raider's own machine before anything uploads (`docs/PRIVACY.md`).
