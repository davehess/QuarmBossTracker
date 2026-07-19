// Content for the public /roadmap page. Plain-language, member-facing —
// the technical version (file paths, version numbers, backlog letter-codes)
// lives in docs/roadmap.md. Keep this file the thing you edit when the
// roadmap changes; the page itself is just a renderer.
//
// `media` is optional per feature — drop screenshots/clips in
// `public/roadmap/<file>` and reference them here (type 'image' | 'video')
// to get the click-to-focus lightbox on the feature card for free. Nothing
// has media yet; the capability just doesn't render anything until it does.

export type RoadmapMedia = { type: 'image' | 'video'; src: string; alt: string };

export type RoadmapFeature = {
  key: string;
  title: string;
  tag?: string;          // small pill, e.g. "Mimic 1.4.0"
  summary: string;
  media?: RoadmapMedia[];
};

export type RetroItem = {
  title: string;
  hit: 'shipped' | 'reworked' | 'open';
  note: string;
};

// ── Release log — the member-facing changelog. NEWEST FIRST. ─────────────────
// RULE (Uilnayar 2026-07-08): EVERY release updates this list. Call out the
// version, give a SIMPLIFIED plain-language line per headline feature, and put
// the bug fixes at the bottom of that release. Keep it human — this is what a
// raider reads, not a git log. (Technical detail lives in the component
// changelogs + docs/roadmap.md.)
export type Release = {
  key: string;
  title: string;         // short human name for the release
  version: string;       // the version pill, e.g. "Web 1.0.180 · Bot 3.0.147"
  date: string;          // YYYY-MM-DD
  channel?: 'beta';      // omit for stable
  headline: string;      // one-line "why this release matters"
  features: { name: string; blurb: string }[];   // main things, simplified
  fixes: string[];       // bug fixes — rendered at the bottom of the release
};

export const releases: Release[] = [
  {
    key: 'callout-trust-and-ch-go-196',
    title: '📣 Callouts you can trust — and the CH chain speaks your GO · Mimic 1.9.6 (beta)',
    version: 'Mimic 1.9.6 beta · Agent 3.3.96',
    date: '2026-07-19',
    channel: 'beta',
    headline: 'This beta round makes the callouts you rely on impossible to miss — and impossible to silently lose — plus one thing clerics asked for: the CH chain says your number out loud when it’s your turn. And you can now place your loot bids right from Mimic. The dashboard also got a facelift: your character is front and center, and officers get a dedicated quick menu.',
    features: [
      { name: '🐺 Your character, front and center', blurb: 'The Mimic dashboard opens on a new 🐺 Me card instead of the engine-status wall. It shows the character you’re playing and where they are, a quick line of your buffs, the other characters Mimic is watching, your last few tells (which never leave your PC), and your last few fights with a jump to the parse — plus one big button to your full wolfpack.quest/me page. The sync/plumbing details (files being read, upload queue, session counts) are still there, just tucked into a collapsed “⚙ Engine” section right below.' },
      { name: '🛡 An officer quick menu', blurb: 'Officers get a dedicated 🛡 Admin tab in the dashboard that gathers the officer tools that used to be scattered around — DKP ticks, loot capture, “Post for bidding” — into one place for quick changes during a raid, with fast links to the wolfpack.quest admin pages (overlay kill switches, triggers, encounters). Only officers see the tab or anything in it.' },
      { name: '💰 Place your loot bids from Mimic (BETA)', blurb: 'There’s a new 💰 Loot bidding card on the dashboard. Log into your OpenDKP account once (it stays on your PC, never uploaded) and every open auction shows up — what an officer just called in chat and the real OpenDKP auctions both — with the item’s last winner and runner-up right there. Type a bid and send it (sealed, same as always), or hit “+1” to pre-fill last time’s runner-up plus one and bid that. Set your main and alts once, then pick who you’re bidding as. When you’re logged in it also shows your own recent wins and a wishlist built from what you’ve bid on before. Until you log in, bidding stays locked — it’s BETA, so tell us what’s rough.' },
      { name: '💰 Loot posts get called out — with a bid clock', blurb: 'When an officer drops a loot list in guild or raid chat, Mimic now says it out loud — “Loot posted, 3 items, bids open 2 minutes” — and starts a gold countdown chip on your trigger overlay that ticks down the auction, exactly like a Death Touch timer (it even warns you at 15 seconds). It reads the time from the bid call, or falls back to a default you can set. Re-posting the same items just resets the clock instead of stacking a duplicate, every separate drop gets its own chip, and you can dismiss any chip with its ✕. On by default; one toggle in the dashboard’s Triggers tab silences it.' },
      { name: 'The trigger overlay stops cutting off its own buttons', blurb: 'The trigger/timer window now grows on its own to fit whatever’s on it — stacked timers, pinned callouts, the new loot chips — so the buttons along the bottom never get clipped again. It shrinks back down when things clear, and grows the right direction whether you have it set to grow up or grow down.' },
      { name: '⛑ The CH chain calls your “04 GO”', blurb: 'When the chain reaches your slot, Mimic speaks your number — “04 GO” — out loud, so you can react without staring at the overlay counting rows. It’s a 📣 button right on the CH chain overlay: on by default, one click to silence. It only speaks for the character you’re actually playing, and only once per rotation pass.' },
      { name: 'A “Rehearse” button that really rehearses', blurb: 'The trigger Test button used to just play the alert — it never checked whether your pattern actually matches anything, so a broken trigger looked fine until raid night. Now it feeds a real matching line through the whole engine (pattern, cooldown, suppression) and speaks the real callout, so a trigger that won’t fire tells you BEFORE it matters.' },
      { name: 'Callouts can’t silently die', blurb: 'A new “why didn’t my trigger fire?” panel on the dashboard shows exactly how far each callout got — matched, cooled down, suppressed by your charm pet, or spoken — so a trigger that goes quiet is no longer a mystery. And a relayed callout that arrives late after a network backlog is dropped instead of shouted minutes after the moment passed.' },
      { name: '📌 Pin the life-or-death calls', blurb: 'Officers can flag a trigger “sticky” — Death Touch target, tank swap, whatever can’t be missed — and it stays pinned on screen until you click it away, instead of fading after a few seconds.' },
      { name: '🐾 Pet buffs finally show on the Pet tracker', blurb: 'Buffs you cast on your summoned pet — Girdle of Karana, a Symbol, Strength, and other single-target buffs — now appear on the Pet tracker with their countdown, even when you weren’t targeting the pet at the moment you cast (buffing yourself, keeping the mob targeted, whatever). Before, those buffs quietly never showed unless the pet happened to be your live target the instant the spell landed. Buffs someone ELSE lands on your pet still fill in from a /pet report.' },
      { name: '📍 The buff queue hints who’s out of range', blurb: 'The buff-queue overlay now dims a same-zone raider who’s run more than a couple hundred units away from you and marks them with a 📍, so you don’t waste a cast on someone across the zone. It’s only ever a hint — positions update at the same heartbeat as everyone’s buffs, and anyone we can’t place is shown normally, never hidden.' },
      { name: 'Smoother reporter handoff on camp-out', blurb: 'When a raider camps out, the raid’s data reporting now hands off to someone still online a few seconds early, so buff and roster tracking never blinks during the swap. (Carried over from the last beta build.)' },
      { name: '👁 A smarter /who overlay', blurb: 'The in-game /who overlay now lines everyone up in clean columns — class in one column, level in its own, instead of drifting ragged after the guild tag — and drops a 🐺 next to any raider who’s running Mimic right now. Wolf Pack members show their main in parentheses after the character name (a couple of folks are on a privacy exception and never do), and when a guildmate is /anon we fill in the level we know from our own history, shown dimmed so you can tell it didn’t come from the game.' },
      { name: '🕒 A richer fight timeline', blurb: 'The per-fight timeline (on each parse) now marks more of what actually happened during a boss fight: when a slow landed on the mob — and the warning moment it fell off — when the mob healed itself back up, and when someone dropped into a defensive discipline. Each gets its own colored tick with a small legend, so a wipe post-mortem reads the “slow fell off here, then it healed” story at a glance.' },
      { name: '🎯 Extended Target sticks to your zone', blurb: 'The Extended Target overlay can now hide targets coming from raiders in a different zone, so a splinter group off in another zone stops cluttering your target list. It’s on by default, as a “Same-zone targets only” checkbox in the dashboard’s Overlays tab — turn it off any time to see every online raider’s target again. Anyone we can’t place (zone unknown) is always shown, never hidden.' },
    ],
    fixes: [
      'The Spell Casting card no longer freezes a long-gone cast on screen — a stopped caster now clears within a minute instead of lingering as a stale “stopped N ago” entry with a doubled border.',
      'Running Setup on the trigger alert box (or any overlay via “Setup THIS”) now actually puts the frame away when you finish — the blue setup outline used to stay stuck on screen until a restart.',
    ],
  },
  {
    key: 'raid-kit-and-comp-245',
    title: '🎒 Raid Kit readiness + 🧩 raid comp templates',
    version: 'Web 1.0.245',
    date: '2026-07-18',
    headline: 'Two helpers built straight off raid rule 12 and your sign-ups: a Raid Kit card that checks your magic resist and utility spells at a glance, and a comp tool that shows officers the role gaps in a raid before it pulls.',
    features: [
      { name: '🎒 A Raid Kit card on your gear page', blurb: 'Your character’s gear page now has a Raid Kit card that checks the things raid rule 12 asks for: a 100 magic-resist floor from your worn gear, plus whether you’re covered for Enduring Breath, Levitate, self-invis and a self-port (and, for necromancers, a Summon-corpse coffin). It’s a helper, not a scold — magic resist is the only hard pass/fail, and only when we actually have your gear export. A blank utility just means we can’t see the source (bank items are stripped before upload, and class self-buffs show up once your spellbook uploads), never that you’re missing it.' },
      { name: 'An officer readiness board', blurb: 'Officers get the whole-roster version at the admin Raid Kit readiness page — one row per raider with their MR and utility checklist, sorted so anyone actually below the floor floats to the top. Raiders who haven’t run a Quarmy export yet simply read “no snapshot” instead of a red X.' },
      { name: '🧩 Raid comp templates + a sign-up gap check', blurb: 'Officers can save named raid compositions — how many tanks, healers, support, melee and casters, down to specific classes — and the sign-ups page now diffs a chosen template against everyone who signed up “Going”: “need 1 more cleric-archetype healer, 3 over on melee.” When a raid actually ran during the event window, it shows the live roster right next to the plan.' },
    ],
    fixes: [],
  },
  {
    key: 'web-gear-vision-235',
    title: '👁 Gear page sees proc-granted vision',
    version: 'Web 1.0.235',
    date: '2026-07-18',
    headline: 'The gear page now counts every way an item can grant sight — worn, clicked, or proc.',
    features: [],
    fixes: [
      'No more false "no vision item detected" warning when your sight rides a weapon or armor proc — Truesight on Gauntlets of View now counts as a vision source and shows up in the 👁 Vision & worn effects list.',
    ],
  },
  {
    key: 'mimic-19-line-stable-195',
    title: '🐺 The whole 1.9 line goes stable · Mimic 1.9.5',
    version: 'Mimic 1.9.5 · Agent 3.3.80',
    date: '2026-07-18',
    headline: 'Everything the 1.9 beta round has been running on for weeks — the healing overlays, seconds-fast restarts, officer loot + DKP tools, and quicker, more reliable triggers — is now the stable build for the whole raid, delivered as a normal auto-update.',
    features: [
      { name: '\u{1FA7A} Tanks see heals coming', blurb: 'The Tank overlay draws every heal in flight — a countdown bar to each landing, colored to its healer, plus a striped “ghost” segment showing where the tank’s HP lands once it connects. And every heal (not just Complete Heal) now gets credited on parse cards, even for tanks who aren’t running Mimic — so the 🩺 healer table shows real healed totals.' },
      { name: 'Restarts come back in seconds', blurb: 'The parser now remembers what it already uploaded and skips re-reading files that haven’t changed, so restarts and updates no longer freeze your overlays for minutes. Overlays also re-find the engine on their own after any restart — no more CH chain stuck on “OVERLAY BLIND” or a blank Command Center.' },
      { name: '🛟 Settings backups with one-click restore', blurb: 'Mimic quietly keeps the last 10 versions of your eqclient.ini and zeal.ini for every EQ folder it knows. Patch day wiped your settings or a crash ate them? Open the dashboard’s Info tab → Settings backups and restore any version with one click.' },
      { name: '💰 Officer loot capture + DKP ticks', blurb: 'Drop lists posted in guild or raid chat (comma or pipe separated) collect on the dashboard for officers — check the items you want for a clean “Copy for /loot” paste, post a list for bidding, and run DKP ticks straight from the dashboard’s live roster. Only officers see any of it.' },
      { name: '↩ Revert to stable, any time', blurb: 'On a beta build and want the stable release back? One click in the tray, the “you’re up to date” dialog, or next to the BETA badge downloads stable and installs on your next restart — no reinstall, and you can rejoin the beta whenever you like.' },
      { name: 'Faster, more reliable triggers', blurb: 'New or edited guild triggers now reach raiders in about 2 minutes instead of 10, and {s}-style triggers finally fire on backtick boss names like Rhag`Zhezum and Aten`Ha`Ra — so Enrage and other callouts stop silently missing on Luclin mobs.' },
    ],
    fixes: [
      'Closing the trigger overlay with its ✕ no longer silences your callouts — it hides the visual only; text-to-speech keeps firing from the hidden window.',
      'Overlays can no longer go blank mid-raid from a single bad target or buff lookup — the Mob Info and Command Center feeds are hardened against it.',
    ],
  },
  {
    key: 'platform-map-228',
    title: '🗺 The platform, on one page',
    version: 'Web 1.0.228',
    date: '2026-07-17',
    headline: 'Ever tried to explain what all of this actually is? Now you just send one link.',
    features: [
      { name: 'wolfpack.quest/platform', blurb: 'A single public page that maps the whole platform — the desktop overlays, the parser engine, the Discord bot, the website, the data behind it, and how updates ship — mindmap style. Click any branch to drill into the details, scroll for the story of how a respawn timer became all of this. Share it with anyone curious about what we built.' },
    ],
    fixes: [],
  },
  {
    key: 'officer-loot-and-revert-195',
    title: '💰 Loot capture + ↩ revert to stable · Mimic 1.9.5 (beta)',
    version: 'Mimic 1.9.5-beta · Agent 3.3.60',
    date: '2026-07-16',
    channel: 'beta',
    headline: 'Officers can now review drop lists straight from the dashboard, and any beta tester can drop back to the stable release in one click.',
    features: [
      { name: '💰 Loot capture (officers)', blurb: 'When someone posts a drop list in guild or raid chat — comma OR pipe separated, however your Zeal is set — it collects on the dashboard’s Info tab. Check the items you want, and "Copy for /loot" gives you the exact paste, cleaned of chatter. Only officers see it. (One-click posting to bidding and DKP ticks are landing next.)' },
      { name: '↩ Revert to stable', blurb: 'On a beta build and need the stable release back? There’s now a one-click "Revert to stable" in the tray, on the "you’re up to date" dialog, and next to the BETA badge on the dashboard. It downloads stable and installs on your next restart — no reinstall, and you can rejoin the beta any time.' },
    ],
    fixes: [],
  },
  {
    key: 'no-more-boot-burst-193',
    title: '🔌 Restarts without the freeze · Mimic 1.9.3 (beta)',
    version: 'Mimic 1.9.3-beta · Agent 3.3.56',
    date: '2026-07-16',
    channel: 'beta',
    headline: 'Restarting Mimic no longer freezes your overlays for minutes — the parser now remembers what it already uploaded, and overlays reconnect to the engine on their own after any restart.',
    features: [
      { name: 'No more re-upload marathon after a restart', blurb: 'The parser used to re-read and re-send every character’s gear and spellbook after every restart or update — minutes of frozen overlays on big multi-character setups. It now remembers what it already sent AND skips re-reading files that haven’t changed at all, so restarts come back in seconds.' },
      { name: '🛟 Settings backups with one-click restore', blurb: 'Mimic now quietly keeps the last 10 versions of your eqclient.ini and zeal.ini for every EQ folder it knows. Patch day wiped your settings? A crash ate them? Open the dashboard’s Info tab → Settings backups and restore any version with one click (close EQ first — it’s safe, the current file is saved before every restore).' },
      { name: 'Overlays find the engine by themselves', blurb: 'If the parser engine comes back on a different connection after a restart, every overlay now re-points itself automatically — no more CH chain stuck on "OVERLAY BLIND" or a blank Command Center until you restarted Mimic.' },
    ],
    fixes: [
      'Every engine restart now records exactly what asked for it, so "the parser randomly restarted" reports can finally be traced.',
    ],
  },
  {
    key: 'calm-connection-192',
    title: '🧘 The calm-connection release · Mimic 1.9.2',
    version: 'Mimic 1.9.2 · Agent 3.3.55 · Web 1.0.225',
    date: '2026-07-16',
    headline: 'Raid-night fixes, live from the trenches: the blue "Reload to the live engine" banner stops crying wolf, the engine stays responsive under raid load, and the healing release is now stable for everyone.',
    features: [
      { name: 'The banner stops crying wolf', blurb: 'The "can’t reach the parser engine" banner now only appears after ~10 seconds of real silence, explains that the engine usually recovers on its own, and clears itself the moment it does. It also stopped hammering a busy engine with page reloads — that was making things worse.' },
      { name: 'Engine stays responsive during raids', blurb: 'All the overlays share one snapshot of the engine’s state instead of each demanding their own copy several times a second — the engine spends its time parsing your fight, not photocopying itself.' },
      { name: 'The 1.9 healing release goes stable', blurb: 'Inbound heals on the Tank overlay, heal attribution on parse cards, the Divine Intervention tracker, and the Command Center healer-mana board — everything from the 1.9 beta line, now on the stable channel for the whole raid.' },
    ],
    fixes: [
      'Setup-help banner no longer crashes the dashboard header for installs that aren’t reading any logs yet.',
      '/me loads in seconds instead of a minute (a heavy stat lookup ran on every page view — now indexed and cached).',
      'Release announcements no longer cut off mid-sentence.',
    ],
  },
  {
    key: 'tank-sees-heals-mimic-19',
    title: '\u{1FA7A} Tanks see heals coming · Mimic 1.9 (beta)',
    version: 'Bot 3.0.176 · Mimic 1.9.0 · Agent 3.3.37 (beta)',
    date: '2026-07-15',
    channel: 'beta',
    headline: 'The Tank overlay now shows heals in flight — a countdown to each landing plus a projected-HP bar — and every heal (not just Complete Heal) now gets attributed on parse cards, even for tanks who aren’t running Mimic.',
    features: [
      { name: 'Heals incoming, on the Tank overlay', blurb: 'Every heal being cast on the tank draws its own countdown bar to when it lands, colored to its healer, and a striped “ghost” segment on the HP bar shows where the tank’s health lands once it connects. Tanks and healers can see the save arriving. Complete Heals are left off this view — the CH-chain overlay owns those, and their volume would swamp it.' },
      { name: 'Every heal attributed', blurb: 'Parse cards used to only credit Complete Heals from a witnessed landing. Now ANY heal landing anyone in the raid sees (Remedy, Superior Healing, …) is credited to the caster at the spell’s catalog value — so a CH chain (or any heal) on a tank who isn’t running Mimic still shows real numbers.' },
      { name: 'Extended Target: target-of-target + declutter', blurb: 'Each mob row now shows 🎯 who it’s meleeing (usually the tank). And player/pet rows that used to clutter the list are hidden by default (👥 to show them), with a ✕ on any row to hide it and a “show all” to bring them back.' },
    ],
    fixes: [],
  },
  {
    key: 'healer-truth-and-mimic-181',
    title: '\u{1FA7A} Real healer numbers · Mimic 1.8.1 stable',
    version: 'Bot 3.0.174 · Web 1.0.220 · Mimic 1.8.1 · Agent 3.3.35 (beta)',
    date: '2026-07-14',
    headline: 'Parse cards finally show how much each healer actually healed — and the whole 1.8.1 beta round (finishing-blow fix, "Set up for me", /who class picker) went out to every Mimic as a stable update.',
    features: [
      { name: 'Healers, attributed', blurb: 'EQ never tells anyone else how big your heal was — so Mimic now marries what the healer cast (and on whom) with what the recipient felt land. The 🩺 table shows each healer’s healed total, cast count, and top recipients; healers whose targets don’t run Mimic still show their casts. The useless "→ You" self rows are gone. Coverage grows with every Mimic install.' },
      { name: 'Mimic 1.8.1 stable', blurb: 'The beta round is now the stable build: one-click "Set up for me" (turns on EQ logging + Zeal exports for you), the /who overlay class picker anyone can use, the CH-chain trust banner, HP-bar text you can read on any color, and the auto-arrange freeze fix.' },
      { name: 'PoP spells marked', blurb: 'The missing-spells page tags Planes of Power spells with a PoP pill — they’re locked until Oct 1, so don’t farm for scrolls you can’t scribe yet.' },
    ],
    fixes: [
      'Trash parses no longer double-count damage: Finishing Blow AA hits are dropped from the totals.',
      'The spells page opens fast from links now (was a 3-second stall that looked like a hang), with a loading skeleton.',
      'The site header shows your Wolf Pack server name again instead of your raw Discord handle.',
      'Release announcements in #mimic-releases now say what changed instead of installer boilerplate.',
    ],
  },
  {
    key: 'raid-night-hardening',
    title: '\u{1F6E1}️ Raid-night hardening',
    version: 'Bot 3.0.167 · Web 1.0.212 · Agent 3.3.28 (beta)',
    date: '2026-07-13',
    headline: 'After Sunday’s speed bumps we went through everything the raid depends on and made it tougher: uploads can’t back up behind Discord anymore, a stuck upload can’t jam the queue, and the CH Chain overlay now TELLS you if it ever goes blind.',
    features: [
      { name: 'CH Chain trust banner', blurb: 'The chain overlay now watches its own data feed. If calls stop mid-fight it shows an amber “verify verbally” warning — and if the feed itself dies it flashes a red GO MANUAL banner and says so out loud, so clerics switch to the classic chain before a tank drops, not after.' },
      { name: 'Uploads never wait on Discord', blurb: 'Your parser gets its “got it” immediately; posting parse cards and chat to Discord happens afterwards. Busy-night Discord slowdowns can’t back up your upload queue anymore.' },
      { name: 'Stuck uploads get parked', blurb: 'If one bad upload keeps getting rejected, it moves to a slow lane instead of clogging everything behind it. “Drain now” retries parked items at full speed.' },
      { name: 'Pre-raid health check', blurb: 'At 7:30pm on raid nights the bot checks Discord, the database, sign-in, and wolfpack.quest, and posts one green/red line — so problems surface at setup, not at the first pull.' },
      { name: '/raid in the menu', blurb: 'The live raid page now sits in the main menu next to Buffs, and the character detail panel follows you as you scroll.' },
    ],
    fixes: [
      'Web pushes no longer restart the bot mid-raid (this was the root of Sunday’s queue backups).',
      'The Mimic release announcer is back — its memory now survives restarts, so no more repeat spam. Stable releases only.',
      'wolfpack.quest rides out sign-in service hiccups instead of 504ing the whole site.',
      'A failing voice trigger can’t make your parser retry forever anymore.',
    ],
  },
  {
    key: 'mimic-180-stable',
    title: '\u{1F43A} Mimic 1.8.0 \u2014 overlay control center',
    version: 'Mimic 1.8.0 \u00b7 Agent 3.3.24',
    date: '2026-07-12',
    headline: 'Everything from the 1.7.4 beta round: color themes with a one-click picker, hotkeys you can rebind or disable, an all-overlays opacity slider, backgrounds that hug their cards, and no surprise rearranging \u2014 ever.',
    features: [
      { name: 'One control center', blurb: 'The Overlays page now holds it all: theme picker (Wolf/Light/Vivid/Muted/High contrast), rebindable + disableable hotkeys for hide-all and backgrounds, auto-arrange on demand, and a single opacity slider that sets every overlay at once.' },
      { name: 'Backgrounds done right', blurb: 'Solid backgrounds are rounded, follow the opacity slider, and extend exactly as far as the content \u2014 no more tall empty slabs.' },
      { name: 'Your layout is sacred', blurb: 'Opening an overlay never moves anything, and auto-arrange never resizes \u2014 it only runs when you click it, and windows keep their exact size.' },
    ],
    fixes: [
      'Light theme sharpened \u2014 pale grey text now lands near-black.',
      'Buff queue scrolls when longer than the screen; buff sections stay collapsible.',
      'Setup strip wraps on narrow overlays so the Done button never clips.',
      'Chat relay (bot): speaker tags stick for the session and every line carries its real in-game time.',
    ],
  },
  {
    key: 'mimic-173-stable',
    title: '\u{1F43A} Mimic 1.7.3 — the big beta lands for everyone',
    version: 'Mimic 1.7.3 · Agent 3.3.18',
    date: '2026-07-11',
    headline: 'Everything from the 1.7.2 beta line graduates to stable: the PoP raid slideshow, auto-arrange, color themes, class-default setups, and a pile of overlay polish.',
    features: [
      { name: 'PoP raid slideshow', blurb: 'A new overlay walks the raid through every PoP/PoTime encounter — callouts, boss stats, live drop tables, shared objective checkboxes, EQProgression diagrams and phase videos, plus a ⚑ button to report where Quarm differs from the guides.' },
      { name: 'Auto-arrange + themes', blurb: 'Right-click any overlay: auto-arrange packs your overlays around your in-game windows (edges first, center kept clear), five color themes (dark/light/vivid/muted/high-contrast), solid backgrounds, and a grow-upward mode for bottom-parked overlays.' },
      { name: 'Class-default setups', blurb: 'A brand-new install turns on the right overlays for your class (officer-crafted on /admin/overlays) and arranges them automatically. Existing setups are never touched.' },
      { name: 'Roll tracker + crash reports', blurb: 'The Command Center tracks loot rolls (winners per item, re-rolls struck out), and an opt-in tray toggle shares Zeal crash metadata so crash clusters can be spotted guild-wide — the memory dump never leaves your machine.' },
    ],
    fixes: [
      'Right-click menu no longer clips or lingers on any overlay; dismisses on outside click, Escape, or a 4s idle.',
      'Auto-arrange no longer stacks overlays on top of each other.',
      'Grow-upward keeps the overlay exactly in place when toggled.',
      '/who gains a copy-name button on unknown-identity rows.',
    ],
  },
  {
    key: 'overlay-themes',
    title: '\u{1F3A8} Overlay color themes',
    version: 'Mimic 1.7.2 beta',
    date: '2026-07-11',
    channel: 'beta',
    headline: 'Prefer brighter overlays? Right-click any overlay and cycle the theme — it changes every overlay at once.',
    features: [
      { name: 'Five themes', blurb: 'Wolf (the classic dark), Light, Vivid (brighter + punchier colors), Muted (softer), and High contrast. Danger colors stay meaningful in every theme — red is still red in Light mode. Your pick persists and composes with the solid-background toggle and opacity slider.' },
    ],
    fixes: [],
  },
  {
    key: 'crash-telemetry',
    title: '🩺 Crash clustering (opt-in) + /who name copy',
    version: 'Mimic 1.7.2 beta · Agent 3.3.18 · Bot 3.0.160',
    date: '2026-07-11',
    channel: 'beta',
    headline: 'Opt in to share Zeal crash summaries (never the memory dump) so we can spot crash patterns across the guild, and copy unknown names off the /who overlay in one click.',
    features: [
      { name: 'Share crash reports (opt-in, default OFF)', blurb: 'A new tray toggle. When on, Mimic reads the small crash summaries Zeal already writes and uploads just the metadata — which DLL crashed, where, your GPU/driver — so officers can see “five of us crash at the same spot”. The memory dump never leaves your machine. Details on the privacy page.' },
      { name: '/who copy button', blurb: 'Rows with no known class/level get a ⧉ button that copies the name — paste it into the Quarm Discord search to check their public posts.' },
    ],
    fixes: [],
  },
  {
    key: 'overlay-chrome-fixes',
    title: '🧰 Overlay polish: menus behave, arranging lines the edges',
    version: 'Mimic 1.7.2 beta',
    date: '2026-07-11',
    channel: 'beta',
    headline: 'The right-click overlay menu no longer clips or lingers, auto-arrange keeps the middle of your screen clear, and overlays can grow upward.',
    features: [
      { name: 'Grow upward', blurb: 'Any overlay can now anchor its BOTTOM edge (right-click → ⬆ Grow upward) — perfect for Extended Target parked at the bottom of the screen: the list grows up instead of running off-screen.' },
      { name: 'Edge-first arranging', blurb: 'Auto-arrange now treats the middle of your screen as the play area — overlays line the outside (right side first, then top/bottom, then left) and only use the center if there is truly nowhere else.' },
    ],
    fixes: [
      'The right-click menu was getting cut off on Target Info, CH chain, /who and others — the overlay kept resizing itself to its content underneath the open menu. It now stays put while the menu is up (and the menu scrolls if it ever must).',
      'That menu also stays open forever if you click into EQ. It now closes on an outside click, Escape, or on its own ~4 seconds after your cursor leaves it.',
      'Auto-arrange could leave overlays stacked on top of each other — anything it could not move now blocks its spot so nothing else gets placed on top of it.',
    ],
  },
  {
    key: 'class-default-overlays',
    title: '🧩 New installs set themselves up for your class',
    version: 'Mimic 1.7.2 beta · Agent 3.3.17 · Bot 3.0.159 · Web 1.0.201',
    date: '2026-07-11',
    channel: 'beta',
    headline: 'Officers craft a default overlay set per class; a brand-new Mimic install turns on the right overlays for your toon and arranges them around your in-game windows automatically.',
    features: [
      { name: 'Class default sets', blurb: 'On /admin/overlays, officers pick which overlays each class starts with — clerics get the CH chain and Buff queue, warriors get the Tank HUD and Command Center, and so on. New installs pick their set up within a couple of minutes of logging in.' },
      { name: 'First-boot arrangement', blurb: 'A fresh install no longer leaves overlays stacked in default spots — the first time it knows your class (or right after onboarding), it packs everything into the free space around your actual EQ windows.' },
      { name: 'Your setup is safe', blurb: 'This only ever touches brand-new installs. If you have ever turned an overlay on yourself, saved a per-character layout, or placed things where you like them, nothing changes — updates and set edits never rearrange you.' },
    ],
    fixes: [],
  },
  {
    key: 'pop-raid-slideshow',
    title: '⚔ PoP raid guide, in-game',
    version: 'Mimic 1.7.2 beta · Agent 3.3.16 · Bot 3.0.158',
    date: '2026-07-11',
    channel: 'beta',
    headline: 'A new overlay walks the raid through every Planes of Power + Plane of Time encounter — callouts, boss stats, diagrams, and objective checkboxes the whole raid shares.',
    features: [
      { name: 'Encounter slideshow', blurb: 'Flip through 34 encounters from Grummus to Quarm (Tier 1–4 plus PoTime phase by phase). Each slide has the raid-leader callouts, boss HP/hits/slow/rampage, its named abilities, and the live drop table.' },
      { name: 'Shared objectives', blurb: 'Every encounter has objective checkboxes — “doors held”, “50% dispel dodged” — that are raid-wide: when the puller checks one, everyone’s overlay ticks it and shows who did. Officers can reset the board between attempts.' },
      { name: 'Diagrams & videos', blurb: 'Strategy diagrams load straight from EQProgression (credited, and never re-hosted by us), and each PoTime phase links its strategy video — one click opens it in your browser.' },
      { name: 'Flag an anomaly', blurb: 'Quarm not matching the guide? Hit ⚑, type what you saw, and it lands in the officers’ QOL thread with the guide numbers attached for comparison.' },
      { name: 'Ultrawide layout', blurb: 'A framed multi-panel mode (🖥) spreads callouts, target info, and objectives side-by-side for ultrawide monitors instead of one tall column.' },
    ],
    fixes: [],
  },
  {
    key: 'overlay-auto-arrange',
    title: '✨ Overlays arrange themselves around YOUR UI',
    version: 'Mimic 1.7.2 beta',
    date: '2026-07-10',
    channel: 'beta',
    headline: 'Right-click any overlay → Auto-arrange: Mimic reads your in-game window layout and packs the visible overlays into the free space.',
    features: [
      { name: 'Auto-arrange', blurb: 'Mimic reads the window positions EQ itself saves (your UI files — never modified), maps them onto your screen, and slots the visible overlays into the gaps — right edge first, never on top of your game windows or each other. Overlays that don’t fit shrink through the size presets until they do. There’s also an “arrange when overlays open” mode: turning an overlay on slides the others out of its way.' },
      { name: 'Solid backgrounds', blurb: 'Every overlay can now have an opaque dark plate behind it for readability over bright zones — toggle one overlay from its right-click menu, or ALL of them at once with Ctrl+Shift+B.' },
    ],
    fixes: [
      'The Command Center now obeys the hide-all-overlays hotkey — it was missing from the hide list and stayed on screen when everything else hid.',
    ],
  },
  {
    key: 'roll-tracker',
    title: '🎲 Roll tracker on the Command Center',
    version: 'Mimic 1.7.2 beta · Agent 3.3.15',
    date: '2026-07-10',
    channel: 'beta',
    headline: 'Every /random in the zone is tracked and grouped by roll range — with the winners named, straight off your loot links.',
    features: [
      { name: 'Rolls, grouped and won', blurb: 'Rolls with the same range (0–333, 0–555, …) group into a set, EQ Log Parser-style. Link loot in raid chat as “Item Name (3)333 | …” and the set picks up its item name — the (3) means the top three rolls each win one. The Command Center shows each set as “333 (Item name) — winner names”; the Mimic dashboard has the full table with every roll expandable.' },
      { name: 'Fair by default', blurb: 'Only each player’s FIRST roll counts — re-rolls are listed struck through and can never win. Multi-boxers hearing the same roll on two logs count once.' },
    ],
    fixes: [],
  },
  {
    key: 'roster-family-attendance',
    title: 'Roster shows real attendance, per person',
    version: 'Web 1.0.197',
    date: '2026-07-10',
    headline: 'The roster now counts a PERSON’s raid attendance across all their characters — plus an Alt Nights view.',
    features: [
      { name: 'Attendance out of possible', blurb: 'Each roster row is a person: the percentage is raids attended on ANY of their characters out of all possible ticks, with the tick count right beside it. Someone who splits time across three characters finally shows their true 100% instead of three fragments.' },
      { name: 'Alts fold under the main', blurb: 'Alts under 50% of a person’s usage tuck into an expandable “+N alts” line under the main — open it to see each alt’s ticks and usage share. An alt the person mostly plays stays visible.' },
      { name: 'Alt Nights view', blurb: 'A toggle recomputes the whole page over just the alt-night raids (Alt Extravaganza / Alt Bonanza / VT + Alt Fun), so you can see who shows up for alt nights specifically.' },
    ],
    fixes: [],
  },
  {
    key: 'aa-faction-accuracy',
    title: 'AA lists cleaned up + faction page tells the truth',
    version: 'Web 1.0.196 · Bot 3.0.157',
    date: '2026-07-09',
    headline: 'Your Gear page no longer shows AAs you can’t have, and the faction page stops claiming you’re at max and min at the same time.',
    features: [
      { name: 'Conned mobs show their faction', blurb: 'The faction page’s consider table now resolves each mob to its faction (with a PQDI link) — the lookup was reading an empty mirror table, so the column never appeared.' },
    ],
    fixes: [
      'The Quarmy export writes junk AA rows for some slots (a monk showing Jewelcraft Mastery rank 255, Elemental Form…). Those are now rejected at upload, filtered from the Gear page, and 285 bad rows across 112 characters were purged — everyone’s AA list is real now.',
      'A faction can’t be at max and min at once: the Position column now shows the most recent signal (“raise capped” / “at floor”) with the older one in the hover — and the wording reflects what the server actually says: the kills you’re doing can’t push it further, which isn’t necessarily ally.',
    ],
  },
  {
    key: 'mana-macro-reports',
    title: 'Mana list hears your macros',
    version: 'Web 1.0.192 · Bot 3.0.155',
    date: '2026-07-09',
    headline: 'The /raid Mana list and Twitch Queue now fill from the “% mana” macros healers already call out — not just from casters running Mimic.',
    features: [
      { name: 'Two mana sources, merged', blurb: 'Casters on Mimic report exact mana straight off their client (Zeal pipe). Everyone else is covered by their “% mana” raid-chat macros — if any one Mimic user hears the call-out, it lands on the board under the caller’s name. Readings persist through the whole fight (10-minute window), freshest source wins.' },
    ],
    fixes: [
      'The Twitch Queue no longer claims “full mana across the board” when it simply had no data yet.',
    ],
  },
  {
    key: 'beta-buffs-outrank',
    title: 'PoP-beta buffs count as the best in slot',
    version: 'Web 1.0.190 · Bot 3.0.154',
    date: '2026-07-09',
    headline: 'Quarm’s PoP-beta reward buffs (Beta Virtue, Beta VoG, …) now rank above the era tops instead of reading as missing buffs.',
    features: [
      { name: 'Beta buffs recognized', blurb: 'Someone carrying Beta Virtue used to show empty HP slots on /raid — the queue would tell clerics to land Ancient Aego right over the strictly better buff. Beta Virtue now fills the Aego slots (and Beta VoG counts as top haste with its attack bonus), so beta-buffed raiders read as fully covered.' },
    ],
    fixes: [
      'Spiritual Purity is now recognized as an HP buff filling the Khura/Brell slot instead of landing in “Other”.',
      'The Tank overlay no longer shows a percentage dressed up as exact HP (“88 / 100”) — real numbers only appear when a /pipeverbose groupmate supplies a genuine HP pool.',
    ],
  },
  {
    key: 'raid-mana-twitch',
    title: 'Raid mana list + Twitch Queue',
    version: 'Web 1.0.189 · Bot 3.0.152',
    date: '2026-07-09',
    headline: 'The /raid page now shows everyone’s mana at a glance and a Twitch Queue telling enchanters exactly who to feed next.',
    features: [
      { name: 'Mana at a glance', blurb: 'A new Mana list in the /raid sidebar (under “Classes in raid”) shows every caster’s current mana — pulled straight from their own client via Mimic — sorted highest first, so you can see who still has gas.' },
      { name: 'Twitch Queue', blurb: 'A prioritized list of who to twitch mana to next: lowest mana up top, Wizards and Enchanters first, then Clerics, then everyone else. No more guessing who’s about to go OOM.' },
    ],
    fixes: [
      'Removed the Roster / Cursed toggle buttons — the roster is the only view now, and cursed raiders already show up in the debuff queue at the top.',
    ],
  },
  {
    key: 'tank-overlay-live-hp-defensives',
    title: 'Tank overlay: exact HP + defensive recharge timers',
    version: 'Mimic 1.7.1 · Agent 3.3.13',
    date: '2026-07-09',
    headline: 'The Tank overlay shows a non-Mimic tank’s exact HP near-live, and the Command Center now counts down defensives — active AND recharge.',
    features: [
      { name: 'Exact tank HP, fast', blurb: 'When someone in the tank’s group runs /pipeverbose, the Tank overlay shows the tank’s real HP numbers (“4211 / 4348”), not just a percent — and it now refreshes about every 3 seconds instead of every 15-20.' },
      { name: 'Defensive recharge timers', blurb: 'The Command Center shows a discipline’s remaining ACTIVE time counting down, then flips to “DOWN · m:ss” counting down the recharge until it’s usable again — so you always know when the next Defensive is ready.' },
    ],
    fixes: [
      'The Command Center’s Healer Mana list stopped hiding clerics whose class it couldn’t look up — only KNOWN non-healers are filtered now, and the Zeal raid roster fills in classes when /who data is cold.',
      'Healer mana readings stay on the board for the whole fight — the old 5-minute timeout only applies between fights.',
      'The Rampage card no longer blinks off mid-fight — the rampage target stays on the Tank overlay and Command Center for the whole encounter, and clears when the fight ends.',
      'The trigger-alert timing buttons («Earlier / ✓Good! / »Too early) no longer sit on top of the callout text — they sit in a fixed spot below it, so the message never jumps.',
      'Mimic’s upload backlog can no longer balloon to gigabytes and freeze the overlays; it bounds itself and cleans up stale files on startup.',
    ],
  },
  {
    key: 'tank-hp-cross-client',
    title: 'Tank overlay shows a non-Mimic tank’s HP',
    version: 'Bot 3.0.148',
    date: '2026-07-09',
    headline: 'The Tank overlay can now show the main tank’s HP even when the tank isn’t running Mimic — as long as someone in their group is.',
    features: [
      { name: 'Borrowed HP from a groupmate', blurb: 'When the main tank isn’t on Mimic and you aren’t targeting or grouped with them, the Tank overlay used to just say “HP not visible.” Now it uses the tank’s HP as seen by any Mimic-running groupmate’s Zeal window — the same cross-client HP the /raid grid already shows — and it lights up on your Tank bar within a couple seconds. No Mimic update needed; your current agent picks it up on its own.' },
    ],
    fixes: [
      'The target panel no longer shows a phantom “Kneel Test” debuff — an EQEmu internal test spell that older agents in the raid were still reporting on every mob. Filtered out and the stale rows purged.',
    ],
  },
  {
    key: 'mimic-queue-reliability',
    title: 'Mimic stops eating disk space and freezing overlays',
    version: 'Agent 3.3.6',
    date: '2026-07-09',
    headline: 'A rare pile-up in Mimic’s upload backlog could balloon to multiple GB and freeze every overlay mid-raid. It now bounds itself and cleans up after itself.',
    features: [
      { name: 'Self-healing upload backlog', blurb: 'If the connection to the bot stalls during a raid, Mimic’s outbound queue used to grow without limit (one player’s hit 2.6 GB) and lock up the app so the DPS/Tank overlays stopped updating. The backlog is now capped by size, throwaway data (live casts, roster snapshots) is dropped first, and stale leftover files are swept on startup — a bloated folder shrinks itself the next time Mimic launches.' },
    ],
    fixes: [
      'A format-detection bug meant the saved backlog was mis-read and set aside as “corrupt” on almost every restart, quietly leaving multi-hundred-MB files behind that never got cleaned up.',
      'The Command Center’s Healer Mana list no longer shows non-healers — only Clerics, Druids, and Shamans appear, so a Mage healing its pet doesn’t clutter it.',
    ],
  },
  {
    key: 'command-center-defensive',
    title: 'Command Center now sees Defensive Discipline',
    version: 'Mimic 1.7 · Agent 3.3.4',
    date: '2026-07-08',
    headline: 'Warrior Defensive Discipline (and Weapon Shield) now show up on the Command Center’s defensives list, not just Divine Aura.',
    features: [
      { name: 'Defensives, straight from the log', blurb: 'The Command Center reads Defensive Discipline directly off the combat log (“Soandso assumes a defensive fighting style”), so it lights up for any tank who pops it — no announce macro required — and clears when it fades. It also understands the chat call-outs tanks already use (“Defensive is activated”, “1 min on defensive”, “Weapon Shield activated for the next 15s!”), and each row is labeled with which cooldown it is.' },
    ],
    fixes: [
      'The defensives tracker used to only recognize “DA” (Divine Aura), so a tank popping Defensive went completely unseen.',
    ],
  },
  {
    key: 'account-inventory',
    title: 'See everything your characters own, all at once',
    version: 'Web 1.0.185',
    date: '2026-07-08',
    headline: 'A new account-wide inventory on /me: the total count of every item across all your characters, and exactly who’s holding it.',
    features: [
      { name: 'Account inventory (/me → 🎒)', blurb: 'One list of every item across all your characters, with a running total and the per-character breakdown — “3 total: Bowvendor ×2 (shared bank), Manamana ×1 (bags)”. Items sitting in your shared bank are tagged, since any of your characters can pull them.' },
      { name: 'Filters + include/exclude', blurb: 'Filter by Weapon / Armor / Tradeskill / No-Drop / Spell, search by name, and toggle which characters or which places (equipped / bags / bank / shared bank) to count — totals recompute live. It’s private to you, built from your /outputfile inventory uploads.' },
    ],
    fixes: [],
  },
  {
    key: 'spell-levels',
    title: 'Fill in levels for spells nobody has yet',
    version: 'Web 1.0.184',
    date: '2026-07-08',
    headline: 'Officers can now file the level for PoP (and any un-scribed) spells so the missing-spells page stops dumping them all under “Level unknown.”',
    features: [
      { name: 'Officer spell-level editor', blurb: 'The missing-spells page groups by level, but a spell nobody has scribed yet (every PoP 61-65 spell, until the October unlock) has no level to group by — the game data mirror doesn’t carry class levels. Officers now get a little “type a level” box next to each unknown-level spell; set it once and it applies guild-wide. The instant a real druid scribes the spell and uploads their book, their actual level takes over automatically.' },
    ],
    fixes: [],
  },
  {
    key: 'spellbook-auto',
    title: 'Spellbook uploads itself now',
    version: 'Mimic 1.7 · Agent 3.3.3',
    date: '2026-07-08',
    headline: 'Your spellbook flows to the site automatically, so the missing-spells page stays current on its own.',
    features: [
      { name: 'Automatic spellbook ingest', blurb: 'Run /outputfile spellbook in game and Mimic uploads it within a few minutes — same as your Quarmy gear and inventory. No more copy-pasting into the site. The manual paste stays as a fallback for standalone/older setups, and it honors your inventory opt-out.' },
    ],
    fixes: [],
  },
  {
    key: 'missing-spells',
    title: 'Missing-spells page shows the whole picture',
    version: 'Web 1.0.182',
    date: '2026-07-08',
    headline: 'Your character’s missing-spell list now includes the ones you have to go get, not just what a vendor sells.',
    features: [
      { name: 'Every missing spell, not just buyable', blurb: 'The missing-spells page now lists all of a class’s spells you haven’t scribed — quest, drop, and planar spells (Divine Intervention, Mark of Karn, …) included. Each is tagged 🛒 buyable or ⚔ go-get, and the “find ↗” link opens PQDI so you can see exactly where a non-vendor spell drops.' },
    ],
    fixes: [
      'Fixed spells you already have showing as missing — a junk duplicate item in the game data ("Spell: Courage*") was masquerading as a separate spell you hadn’t scribed. Courage and its cousins now match correctly.',
    ],
  },
  {
    key: 'pop-roster-polish',
    title: 'PoP flags, roster, and a site-wide polish pass',
    version: 'Web 1.0.181 · Bot 3.0.147',
    date: '2026-07-08',
    headline: 'The road to Quarm gets a map, and the whole site gets more flexible.',
    features: [
      { name: 'PoP Flags (Preview)', blurb: 'A live chart of the guild’s Planes of Power flagging — who can enter each zone today, and a planner that ranks what to raid next by how many people each kill pushes forward.' },
      { name: 'Raid Roster', blurb: 'Your typical raiders, grouped by role and class, sorted by 60-day attendance. Notable alts are called out in italics under their class.' },
      { name: 'Expandable time windows', blurb: 'Leaderboards, parses, and PvP now let you expand or contract the window — day, week, 30/60/90 days, the whole expansion, or lifetime.' },
      { name: 'Sharper link previews', blurb: 'Sharing any page link in Discord now unfurls with that page’s own description instead of the generic site blurb.' },
    ],
    fixes: [
      'Guild chat stopped posting under the wrong character name after someone swaps characters mid-raid (and the bot now edits an already-posted line to the right name within seconds).',
      'The /fun dirge and Lord of Ire cards now fold alts into their main and drop stray log-file names — no more mystery raiders like “Ashaiya.”',
      'The /fun “What’s new” box is collapsed by default so the counters are front-and-center.',
    ],
  },
  {
    key: 'zeal-deep-dive',
    title: 'Zeal deep-dive + real tank HP',
    version: 'Mimic 1.7.0 · Agent 3.3',
    date: '2026-07-08',
    headline: 'Mimic now surfaces every scrap of live game data Zeal exposes.',
    features: [
      { name: 'Zeal Pipe explorer', blurb: 'A new Info-tab panel that decodes everything the Zeal pipe carries — your stats, buffs, group, spell gems, position — each section expandable. Fully documented, so nothing is guesswork anymore.' },
      { name: 'Real HP on the tank overlay', blurb: 'The tank overlay’s raw HP numbers used to be nonsense; now they read your actual current/max HP, correct even at full health.' },
      { name: 'Raid-wide HP via /pipeverbose', blurb: 'Turning on /pipeverbose in-game streams exact HP and zone for the whole raid, not just percentages.' },
    ],
    fixes: [
      'The Zeal Pipe panels no longer snap shut the instant you open them — and that’s now an enforced rule so no future dashboard change can regress it.',
      'Beta builds version themselves correctly (beta.2, beta.3…) instead of forcing a version bump every iteration.',
    ],
  },
  {
    key: 'mimic-mail-speed',
    title: 'Mimic Mail + a big speed pass',
    version: 'Bot 3.0.144 · Mimic 1.6.0',
    date: '2026-07-07',
    headline: 'Officers can reach every Mimic at once, and the whole stack got faster.',
    features: [
      { name: 'Mimic Mail', blurb: 'Officers publish a notice on the site and every running Mimic shows a pulsing mail icon within ~90 seconds — mark it critical and the bot also posts it to Discord. Works on every future Mimic version with no extra plumbing.' },
      { name: '“✓ cured” button', blurb: 'When nobody near a cursed player runs Mimic, anyone can now clear a stuck cure-need from the whole raid’s queue with one click.' },
      { name: 'Efficiency pass', blurb: 'Overlays skip repainting unchanged frames, the buff queue computes once for the whole raid instead of once per person (~20× less database traffic), and agent log parsing got cheap pre-filters across the board.' },
    ],
    fixes: [
      'The /fun page had slowed to a crawl — its counters now load in parallel with the two heaviest moved into fast indexed queries (measured 1.5s → 18ms on one of them).',
      'Two storage tables that had been hoarding rows (buff history and /who sightings) now prune themselves — 60–73% smaller with no visible change.',
    ],
  },
];

export const retroSummary = {
  headline: '9 of 13 tracked initiatives shipped',
  blurb:
    "Before starting the next push, we checked the last backlog against what's " +
    'actually live rather than trusting old checkmarks. Most of it landed — a ' +
    'couple of things were solved differently than originally planned, and a ' +
    "few are still open (mostly things blocked on outside factors, not us dragging feet).",
};

export const retroItems: RetroItem[] = [
  {
    title: 'Charm-pet HP on the Charm/Pet overlays',
    hit: 'shipped',
    note: 'Live pet HP shows directly instead of only inferring it from combat lines.',
  },
  {
    title: 'Resisted-spell breakdown',
    hit: 'shipped',
    note: 'The local dashboard shows which mobs cast a resisted spell, and how often.',
  },
  {
    title: 'More overlay toggles in the tray',
    hit: 'shipped',
    note: 'DPS panels (Healing, Tanking, Threat, Top damage) each get their own on/off switch.',
  },
  {
    title: 'Live character state syncing to the website',
    hit: 'shipped',
    note: "Your buffs and zone show on your /me page — this became the backbone for a lot of what's shipped since.",
  },
  {
    title: 'Mimic setup overhaul',
    hit: 'shipped',
    note: 'Guided first-run setup, auto-detected EQ folder, opt-in overlays, a ✕ to hide any overlay.',
  },
  {
    title: 'Buff & Debuff coordination queue',
    hit: 'shipped',
    note: 'Grew well past the original pitch — curse/cure tracking, HP-slot awareness, severity sorting, and a whole speed pass this round.',
  },
  {
    title: 'CH Chain tracking',
    hit: 'shipped',
    note: "Not the arcade-game version we first sketched, but rotation order, live cast bar, and a beat countdown are a real, well-used feature now.",
  },
  {
    title: '/who directory on the website',
    hit: 'shipped',
    note: 'Searchable history of everyone ever seen in a /who.',
  },
  {
    title: 'Keeping Supabase storage under control',
    hit: 'reworked',
    note: "Instead of periodically deleting old rows, we stopped generating most of them in the first place — a counter table replaced a row-per-upload log that was growing ~30k rows a day.",
  },
  {
    title: 'PvP debuff assist credit',
    hit: 'open',
    note: "Blocked on real combat-log samples of a landed debuff on an enemy player — we don't want to guess at this one.",
  },
  {
    title: 'Named-mob kill counts on /me',
    hit: 'open',
    note: "Still queued — straightforward to build, just hasn't come up yet.",
  },
  {
    title: 'Unified /raid operational view',
    hit: 'open',
    note: "Most of the data it needs is already flowing (roster, live-state, buffs); the dedicated view itself is still a work in progress.",
  },
  {
    title: 'Windows code-signing for Mimic',
    hit: 'open',
    note: "Everything is staged and ready — waiting on SignPath Foundation's free open-source signing approval.",
  },
];

// Retired 2026-07-08 — the flat feature grid was replaced by the release log
// (`releases` above). Kept (exported to avoid an unused-symbol lint) as archive
// context for older shipped work that predates the release log; NOT rendered.
// Add new work to `releases`, not here.
export const archivedFeatures: RoadmapFeature[] = [
  {
    key: 'family-links',
    title: 'One-click "same family" confirm for officers',
    tag: 'web · admin',
    summary:
      "On the character-linking page, an officer can now fold all of a member's characters under their real main in a single click, instead of linking each toon one at a time. The suggested main is now the person's actual main (their Discord identity / rank) rather than whichever alt happened to sort first alphabetically.",
  },
  {
    key: 'pqdi-link',
    title: '[PQDI] link on parse pages',
    tag: 'web',
    summary:
      'Every boss on a parse page now links straight to its PQDI.cc reference page — stats, spells, loot — no more searching for it yourself.',
  },
  {
    key: 'warder-damage',
    title: 'Beastlord Warder damage now counted',
    tag: 'agent',
    summary:
      "A Beastlord's Warder pet damage was quietly falling off the parse instead of crediting the owner. Fixed — pets named after their owner now self-attribute immediately, no waiting on a declaration line the pet doesn't always send.",
  },
  {
    key: 'charm-break-self',
    title: 'Enchanter charm-break alerts now catch the self-only case',
    tag: 'agent',
    summary:
      "EverQuest has a charm-break log line that only the charmer ever sees (\"Your charm spell has worn off\") — no pet name attached, invisible to a bystander-based detector. That exact case is now caught, so enchanters get the callout every time a charm breaks, not just the times someone else was watching.",
  },
  {
    key: 'buff-queue-speed',
    title: 'Buff & debuff queue got dramatically faster',
    tag: 'agent',
    summary:
      "Root-caused a staleness bug that meant most raiders' data reaching the queue was minutes old at best — at one point, exactly zero of thirty rostered raiders had current data flowing in at all. Now it's near real-time.",
  },
  {
    key: 'ch-chain-druids',
    title: 'CH Chain: Druids join the rotation, smarter gap warning, quieter by default',
    tag: 'mimic',
    summary:
      "Druids filling Complete-Heal gaps now show up on the chain overlay labeled distinctly instead of looking like a numbered cleric slot. The \"gap coming\" warning now scales to your raid's actual chain speed instead of a fixed number, and the audible callout is off by default (still one click to turn back on).",
  },
  {
    key: 'tank-overlay',
    title: 'Tank overlay grew up',
    tag: 'mimic',
    summary:
      "Follows whoever's actually tanking (not just you), shows a damage-shield breakdown with known sources, puts the Rampage target's HP right on the bar, highlights gold when they've got Divine Aura / Harmshield / any short invulnerability up (green once it's about to fall — your cue to be ready to heal), and adds a Death Touch countdown for bosses with that mechanic configured.",
  },
  {
    key: 'extended-target-fixes',
    title: 'Extended Target overlay — three bugs fixed in a row',
    tag: 'agent + bot',
    summary:
      "First it showed nothing at all (a database column the feature needed had never actually been turned on). Then every target's HP froze at 100% (a staleness bug). Then a single real player or boss started showing up as two fake duplicate rows. All three are fixed now.",
  },
  {
    key: 'command-center',
    title: 'Command Center — a new one-window raid board',
    tag: 'mimic 1.4.0',
    summary:
      "New overlay combining boss/tank focus with two sections built straight from what raiders already say in raid chat: a raid-wide 'who has Divine Aura up' tracker and a healer mana roster, plus curse/cure alerts. We mined 60 days of real guild raid chat to find the recurring patterns before building it, rather than guessing.",
  },
];

export const nearTermItems: RoadmapFeature[] = [
  {
    key: 'pull-tracker-glide',
    title: 'Extended Target: watch mobs climb the list',
    tag: 'up next',
    summary:
      "We looked into showing exactly how far away an incoming add is and when it'll reach camp — turns out the game data we have access to doesn't include position information for mobs or players, so a real countdown isn't possible yet (that needs an upstream change from the Zeal team). What we can do without that: animate the target list so a mob visibly climbs up as more raiders engage it, and drops back down if it gets abandoned.",
  },
  {
    key: 'per-char-layout',
    title: 'Overlay layouts remember your character',
    tag: 'up next',
    summary:
      "Overlay visibility already switches automatically when you swap characters. Position and size will too — so your monk's layout and your enchanter's layout can both be exactly right without you moving anything by hand.",
  },
  {
    key: 'me-layout-sync',
    title: 'Your overlay layout on /me',
    tag: 'planned',
    summary:
      "Once layouts remember your character locally, we'll sync a read-only view of them to your /me page — most of what's there already lives on your machine first.",
  },
  {
    key: 'trigger-onboarding',
    title: 'Smarter first impression for new Mimic installs',
    tag: 'planned',
    summary:
      'Trigger alerts linked directly to the Triggers tab, with starter suggestions based on your class and role — so a fresh install feels tailored from the first raid, not a blank slate.',
  },
  {
    key: 'ui-studio-positioning',
    title: 'Visual overlay layout tool',
    tag: 'exploring',
    summary:
      "UI Studio already has a polished visual editor for your in-game UI. We're looking at borrowing that same drag-and-drop feel for laying out Mimic's own overlays.",
  },
];
