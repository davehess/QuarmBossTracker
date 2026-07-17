# Mimic recruitment / engagement copy

Ready-to-post Discord content. Three angles, plus screenshot guidance so the
visual lands as hard as the text.

---

## Post 1 — The dreamcast ("imagine") — for #general / #raid-talk

> 💭 *Imagine a world where your buffs were always accounted for and your buffing duties were crystal clear without extra tells.*
>
> No "anyone need C2?" in /raid. No tank wiping because we missed the rampage. No cleric scrambling because someone forgot to call out a CH gap. No beastlord guessing who needs Feral Avatar.
>
> That world only works if **we all run Mimic**.
>
> The new `/raid` view at https://wolfpack.quest/raid lights up more capabilities the more raiders are on Mimic — and the page literally tells you what unlocks next.
>
> **Right now** we have **X / Y** raiders covered.
>
> Each install unlocks more for the whole pack:
> - **25%** → Buffing duties crystal-clear, no tells
> - **50%** → Live HP heat-map + mass-buff cooldown board
> - **70%** → CH chain integrity tracking
> - **100%** → Everything: every buff, every cooldown, every death timer, every mob targeted
>
> Mimic is silent. Free. Auto-updates. Settings stick across upgrades. **It runs while you raid and the pack gets stronger because of it.**
>
> Install: https://wolfpack.quest/mimic

📷 *Screenshot the `/raid` page on raid night (the Coverage Unlocks widget visualizes the pitch).*

---

## Post 2 — The personal pitch ("here's what YOU get") — for #recruit / DMs

> If you've been on the fence about Mimic, here's the honest pitch — what **you** get the moment you install it:
>
> 🛡️ **Your own buff coverage** — every buff, every HP slot, every gap. See exactly what you're missing before you ask.
> 🎯 **Live target intel** — what you're targeting, current HP%, your last seen zone.
> 🔮 **Charm tracker (enchanters & bards)** — full duration bar, class-aware break warning, no surprise breaks mid-pull.
> ⚡ **Trigger alerts you don't have to set up** — raid mechanics fire on the bot, you just hear them.
> 📊 **Your own parse history** — DPS, attendance, loot, all linked to your Discord.
> 🐺 **Auto-detection of EQ folder + Discord login** — no tokens to copy/paste.
>
> And **nothing leaks** that you don't opt into:
> - Tells are off by default. Officer chat is filtered at the byte level — it literally cannot leave your machine.
> - Per-character exclusion: friends' boxes in other guilds, alts you share — flip them off in onboarding, the agent never even opens their log.
>
> Install once. Forget it's there. The whole pack gets stronger every time someone does.
>
> https://wolfpack.quest/mimic

---

## Post 3 — The officer angle (operational case) — for #officers / Pack Leader chat

> Reminder of what scales with Mimic coverage, since we're at **X / Y** right now:
>
> **Things we CAN'T do without coverage in the right slots:**
> - Track when MGB Aego / MGB Avatar / MGB Clarity come off cooldown → we can't stagger them
> - Live CH chain gap detection → tank wipes we wouldn't otherwise wipe to
> - Worn-attack-cap-aware Feral Avatar queue → Avatar gets wasted on capped melee
> - Auction winner → "add as looter" loop → manual lookup every time
> - Confirm RaidHelper sign-ups against live roster → we don't know who's actually here
> - Smart group-buff regrouping ("move these 3 into Group 4, MGB hits all of them")
>
> Every one of these is **already engineered** and just waiting on the inputs. Each new Mimic install unlocks more of the picture.
>
> The new `/raid` page surfaces this live — it tells you exactly what % we're at and what unlocks next. Worth posting in raid-talk.
>
> Officer tip: when someone joins, point them at https://wolfpack.quest/mimic and tell them to leave it running. That's it.

---

## Pull-quotes for one-liners / image captions

- *"Imagine a world where your buffs were always accounted for."*
- *"Mimic is silent. Free. The whole pack gets stronger every time someone installs it."*
- *"More raiders running it = more of the picture we have. The page literally tells you what unlocks next."*
- *"Officer chat never leaves your machine. Tells are off by default. Your friends' alts in other guilds? Flip them off in onboarding."*
- *"Install once. Forget it's there. The pack gets stronger."*

---

## What to screenshot

The `/raid` page is designed to be the marketing material. Best frames:

1. **The Coverage Unlocks widget** — full live ladder of locked/unlocked capabilities at our current %. Pairs perfectly with Post 1.
2. **The Raid grid with crowns + tier colors** — operational view that "looks like raid software." Pair with Post 3.
3. **A character side panel** — HP slots, buff coverage, the /target copy button. Pair with Post 2 ("here's what you'll see for yourself").

Tip: screenshot on a real raid night when coverage is low *and* on a night when it's high — same page, dramatically different unlock state. The contrast is the pitch.

---

## Maintenance

Update the "X / Y" numbers in posts 1 + 3 before posting. The post otherwise
stays evergreen — the unlock thresholds are documented in the widget itself
(`web/app/raid/RaidView.tsx::CoverageUnlocks`).
