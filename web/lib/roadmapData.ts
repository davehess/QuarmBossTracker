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

// ── Release log — the member-facing changelog. NEWEST FIRST. ─────────────────
// RULE (Hitya 2026-07-08): EVERY release updates this list. Call out the
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
    key: 'mimic-2-6-2',
    title: 'A Loot tab, and Mimic stops phoning the DKP site',
    version: 'Mimic 2.6.2 · Agent 3.6.2 · Bot 3.1.88 · Web 1.2.2',
    date: '2026-08-27',
    headline: 'Bidding and rolls now share one Loot tab, and your copy of Mimic no longer contacts the DKP site directly at all.',
    features: [
      {
        name: 'New 💰 Loot tab',
        blurb: 'Bidding was on the Dashboard and rolls were buried in Stats — two ways of handing out the same drop, on two different screens. They are one tab now, with the live auction at the top.',
      },
      {
        name: 'Mimic no longer contacts the DKP site',
        blurb: 'Your DKP balance now comes from our bot, which looks it up once for the whole guild instead of every raider\u2019s PC asking separately. Same number, and the DKP site sees one visitor instead of one per person online.',
      },
      {
        name: 'Loot is only checked when loot is happening',
        blurb: 'During raids, or whenever you have the Loot tab open. A dashboard left open on another tab all week no longer checks for auctions in the background.',
      },
      {
        name: 'Your balance is checked live during raids, and read from our own records the rest of the time',
        blurb: 'DKP only moves when a tick lands, and ticks only happen while raiding — so that is the only time the number needs checking against the DKP site. Between raids the panel shows the figure from our own database, which is the same number.',
      },
    ],
    fixes: [
      'Inside a raid the balance refreshes faster once an auction is actually open, rather than on a fixed timer — which also means it picks up loot posted off trash mobs, not just named ones.',
    ],
  },
  {
    key: 'mimic-2-6-1',
    title: 'Mimic asks the DKP site far less often',
    version: 'Mimic 2.6.1 · Agent 3.6.1 · Web 1.2.0',
    date: '2026-08-27',
    headline: 'The loot panel was checking your DKP balance every single minute. Now it checks every ten, and stops entirely when you are not looking at it.',
    features: [
      {
        name: 'Your DKP balance updates every ten minutes instead of every minute',
        blurb: 'The number in the loot panel comes from the DKP site itself, and Mimic was asking for the full standings list once a minute for as long as it was open. DKP only moves when a bid settles, so ten minutes is still fresher than bidding needs — and it is a tenth of the requests.',
      },
      {
        name: 'Nothing is fetched while the dashboard is hidden',
        blurb: 'Minimise the dashboard or switch to another window and the balance check stops until you come back.',
      },
    ],
    fixes: [
      'The DKP site owner spotted this on his side before we did, because these requests went straight from your PC to the DKP site and never touched our bot — so they were missing from our own traffic counter. The counter page now says so.',
    ],
  },
  {
    key: 'web-1-1-98',
    title: 'A public counter for our OpenDKP traffic',
    version: 'Web 1.1.98 · Bot 3.1.73',
    date: '2026-08-26',
    headline: 'Anyone can now watch exactly what we send the DKP site — including the person who pays for it.',
    features: [
      {
        name: 'wolfpack.quest/opendkp',
        blurb: 'A live counter of every request our bot makes to OpenDKP, open to anyone with the link and no sign-in needed. It shows calls per endpoint, data returned, and whether we are currently paused.',
      },
      {
        name: 'A pause button that works in under a minute',
        blurb: 'Officers can stop all DKP traffic from the admin page and it takes effect within 60 seconds, with no code deploy — so if anything looks wrong we can stop first and work it out after.',
      },
    ],
    fixes: [],
  },
  {
    key: 'web-1-1-97',
    title: 'My Characters on the PoP page',
    version: 'Web 1.1.97',
    date: '2026-08-26',
    headline: 'The PoP page can now show your whole roster in one place — alts included, since flagging isn’t just a main’s job.',
    features: [
      {
        name: 'My Characters tab',
        blurb: 'A new tab on /pop lists every character linked to your account — mains and alts alike — with their zone access and PoP spells still needed side by side.',
      },
      {
        name: 'Guild views now default to mains',
        blurb: 'The chart, matrix, planner, and spell-needs table default to showing mains, with a one-click toggle to widen to every character when you want the fuller picture.',
      },
    ],
    fixes: [],
  },
  {
    key: 'web-1-1-96',
    title: 'Parchment math, from the source',
    version: 'Web 1.1.96',
    date: '2026-08-25',
    headline: 'The PoP spell matrix now reads the actual turn-in quests instead of guessing from spell levels \u2014 thanks to Gonner catching the overcount on night one.',
    features: [
      {
        name: 'Counts you can plan around',
        blurb: 'Each class trainer hands out a hand-picked list per parchment, and the matrix now shows exactly those lists. A new Other column shows spells you still need that your own turn-ins can\u2019t award \u2014 research spells, or another class\u2019s tradeable scroll \u2014 instead of quietly miscounting them.',
      },
      {
        name: 'Bards exist now',
        blurb: 'Bard rewards are Songs, not Spells, and the old filter dropped every one of them. The needs list and the matrix now cover bards like everyone else.',
      },
    ],
    fixes: [
      'Spell-page PoP badges name the parchment from the real quest lists; a spell your trainer can\u2019t award says so instead of showing the wrong parchment.',
    ],
  },
  {
    key: 'web-1-1-94',
    title: 'A door that isn\u2019t Discord',
    version: 'Web 1.1.94',
    date: '2026-08-24',
    headline: 'Members who can\u2019t get past Discord\u2019s sign-in checks can now use the whole site with a username and password.',
    features: [
      {
        name: 'Officer invite \u2192 username + password',
        blurb: 'If Discord\u2019s \u201cverify your account\u201d wall blocks you from signing in, an officer can send you a personal invite link. Open it, pick a username and password, and you\u2019re in \u2014 parses, raid pages, your characters, everything, same as everyone else. Forgot the password later? A fresh invite from an officer doubles as the reset.',
      },
    ],
    fixes: [],
  },
  {
    key: 'web-1-1-93',
    title: 'Mimic without the Discord wall',
    version: 'Bot 3.1.70 \u00b7 Web 1.1.93',
    date: '2026-08-24',
    headline: 'Members whose Discord account can\u2019t authorize the website can now get Mimic signed in with an officer\u2019s help.',
    features: [
      {
        name: 'Officer-assisted Mimic sign-in',
        blurb: 'If Discord shows you the \u201cverify your account\u201d wall when signing in, you\u2019re no longer stuck. Open Mimic, click Sign in to Wolf Pack, and read the short code it shows to an officer \u2014 they enter it on the site, pick your name, and your Mimic links up with your real identity. Uploads, parses and your character pages all work.',
      },
    ],
    fixes: [],
  },
  {
    key: 'web-1-1-92',
    title: 'How this gets built',
    version: 'Web 1.1.92',
    date: '2026-08-23',
    headline: 'A new page at /ai lays out how the platform is actually built and maintained, written for people and for AI assistants alike.',
    features: [
      {
        name: 'Every rule, and the thing that went wrong to cause it',
        blurb: 'The platform is built almost entirely by AI sessions that cannot see each other\u2019s conversations. What keeps that from falling apart is a set of written rules \u2014 and every one of them was added the day something specific broke. The page pairs each rule with that story.',
      },
      {
        name: 'A timeline you can drag',
        blurb: 'Pull the slider backwards and the rules un-adopt one at a time, back to the first commit in April. Each stop shows what forced the change and links to the exact commit that made it.',
      },
      {
        name: 'Readable by other people\u2019s tools',
        blurb: 'The same content is served in two plain formats an assistant can fetch directly, so anyone wanting to copy the approach for their own project can read the whole method without needing access to our code.',
      },
    ],
    fixes: [],
  },
  {
    key: 'bot-3-1-68',
    title: 'Lockouts we can actually see',
    version: 'Bot 3.1.69 · Web 1.1.91',
    date: '2026-08-22',
    headline: 'Raid lockouts now come from the parses you already upload, instead of waiting for someone to type /sll.',
    features: [
      {
        name: 'Your kills tell us your lockouts',
        blurb: 'When someone uploads a boss kill, everyone the parse can see gets a lockout recorded — the person who uploaded it, the damage list, the healers and the tanks. That includes healers who did no damage, who used to be invisible to this.',
      },
      {
        name: 'The pre-raid check only flags what matters',
        blurb: 'A lockout lasts as long as the boss takes to come back, so after our own kill the whole raid is locked and the boss is down anyway. The officer post now only names people blocked from a boss that is actually up — which is the case worth asking about.',
      },
      {
        name: 'Lockout page shows where each one came from',
        blurb: 'Every entry says whether it came from a /sll or from a kill parse, and links straight to that parse. Characters who are not on our roster, and bosses from expansions we are past, each get their own section instead of crowding the list.',
      },
      {
        name: 'It tells you about mains first',
        blurb: 'A blocked alt is a swap; a blocked main is a hole in the raid. The officer post now leads with mains and says "all mains clear" when that is the answer, with the alts noted underneath.',
      },
      {
        name: 'A guild event off the calendar still counts as ours',
        blurb: 'Our Friday rolling events are not on the raid schedule, so they were being filed as if we had raided with another guild. If most of the people in a fight are ours, it is ours.',
      },
    ],
    fixes: [
      'The lockout list was reading only the first 500 entries; it now reads all of them.',
      'A lockout seen twice — once from /sll and once from a kill — used to show up as two separate entries for the same boss.',
    ],
  },
  {
    key: 'web-1-1-88',
    title: '\u{1F4DC} PoP spells, raid-only parses, and flag coverage for everyone',
    version: 'Web 1.1.88 · Bot 3.1.64 · Agent 3.6.4',
    date: '2026-08-21',
    headline: 'Planes of Power prep: see what you need to turn in for each spell, and get your flags recorded even if you do not run Mimic.',
    features: [
      { name: '\u{1F4DC} What to turn in for a PoP spell', blurb: 'Missing spell lists now name the parchment that buys it — Ethereal for level 61-62, Spectral for 63-64, Glyphed Rune Word for 65 — and remind you the spell you get is random from that tier.' },
      { name: '\u{1F5F3} Who needs which PoP spell', blurb: 'The PoP page lists every main who has submitted a spellbook and how many spells they still need at each tier, highest level first — whoever gets to the level first has first dibs. You can submit your spellbook right there.' },
      { name: '\u{2694} Raid kills separated from farming', blurb: 'The parses page now splits each night into what the raid cleared and what was killed outside it, so a day of farming no longer hides the raid.' },
      { name: '\u{1F6A9} Flags recorded even without Mimic', blurb: 'The game only tells YOU when you get a flag, so anyone not running Mimic had no record. Now, if someone running Mimic is standing there when you hail a flagging NPC, that gets recorded for you.' },
    ],
    fixes: [],
  },
  {
    key: 'web-1-1-83',
    title: '\u{1F3E6} Shared banks, actually counted once',
    version: 'Web 1.1.84',
    date: '2026-08-20',
    headline: 'The shared-bank fix from this morning only worked when every character had an identical snapshot — which is almost never. Now it holds.',
    features: [],
    fixes: [
      'One stack in the shared bank could still be counted once per character (ten characters, ten copies of the same three Words of the Spectre). Characters on an account are now matched by which bank slots agree, so snapshots taken hours apart still group — the stack counts once.',
      'Unrelated mule accounts could be chained together into one giant fake "account" — they stay separate now.',
      'Characters moved between your game accounts are recognised as belonging to the account they are on now, even while their last inventory export still shows the old one.',
    ],
  },
  {
    key: 'web-1-1-82',
    title: '\u{1F50E} Tell us about your traders',
    version: 'Web 1.1.82 · Bot 3.1.63',
    date: '2026-08-20',
    headline: 'Your /me page now lists the characters uploading from your machine that nobody has claimed — file them as traders in one click, no class needed.',
    features: [
      { name: '\u{1F50E} "Characters we think are yours"', blurb: 'A new section on /me lists every character uploading from your machine that isn\'t linked to anyone. You know what they are, so you file them: Trader, Raid alt, or Not mine. Once filed, their inventories join your account inventory.' },
      { name: '\u{1F3E6} Traders need nothing', blurb: 'Bank mules and bazaar toons file as Traders with one click — no class, no level, and they never go into OpenDKP. Previously the Trader button demanded a class that a mule has never had, which is why so many stayed unlinked.' },
      { name: '\u{2694} The raid-alt bar, spelled out', blurb: 'Raid alts show which eras their level can actually raid — 46+ for Classic, 50+ Kunark, 55+ Velious, 60 for Luclin. Below 46 nothing is raidable, so we say so and point you at Trader instead of asking for an OpenDKP entry nobody needs.' },
    ],
    fixes: [
      'A trader whose owner had no OpenDKP family came back unlinked after being filed, and reappeared in the review queue forever.',
    ],
  },
  {
    key: 'web-1-1-81',
    title: '\u{1F3E6} Shared banks count once',
    version: 'Web 1.1.81',
    date: '2026-08-20',
    headline: 'Your account inventory no longer counts shared-bank items once per character — characters on the same game account are grouped automatically.',
    features: [
      { name: '\u{1F3E6} Automatic account grouping', blurb: 'Characters whose shared-bank contents match are recognized as the same game account — no setup, and it regroups itself if you move a character to another account. Shared-bank items count once per account on My Inventory, with a new "Shared banks" counter showing how many accounts you have.' },
    ],
    fixes: [
      'Items in a shared bank were counted up to 8 times — once for every character on the account that uploaded an inventory.',
    ],
  },
  {
    key: 'mimic-2-6-0',
    title: '\u{1F392} Inventory that keeps itself current',
    version: 'Mimic 2.6.0 · Agent 3.6.0',
    date: '2026-08-20',
    headline: 'Run /outputfile inventory and forget about it — Mimic picks the file up within ~10 minutes, so the item search and your character pages stay current. Stable for the whole fleet; Mimic updates itself.',
    features: [
      { name: '\u{1F392} Automatic inventory uploads', blurb: 'Mimic now watches your <Name>-Inventory.txt files the same way it already watches spellbook and Quarmy exports. Re-run /outputfile inventory any time — the fresh snapshot uploads on its own, no more visiting the website to re-upload by hand. Works for mules and bank alts too. Money is never uploaded, and the /me privacy opt-out is honored as always.' },
      { name: '\u{1F9F9} Buff queue fits on screen', blurb: 'Buff sections start collapsed with the first few names previewed on the header — tap to open. The cure/debuff queue stays always-visible. The Feral Avatar / Savagery list shows who already has it with time remaining, soonest to drop first, and the dashboard gained cures-only / Feral-only options to run it lean.' },
    ],
    fixes: [
      'The item search was showing months-old inventories (new spells and gear missing) — snapshots only updated when someone re-uploaded manually. They now stay fresh automatically.',
      'Death touch countdowns are more dependable: the raid-wide timer now starts even when the hit lands on a pet, so the next cycle is always on the clock.',
    ],
  },
  {
    key: 'web-1-1-77',
    title: '\u{1F5E1} Boss kills back in front',
    version: 'Web 1.1.77 · Bot 3.1.61',
    date: '2026-08-20',
    headline: 'The parses page shows boss kills as cards again — farm and trash kills roll up into one line per zone instead of burying the night.',
    features: [
      { name: '\u{1F5E1} Trash rolls up', blurb: 'Every kill still counts and is kept — but only real bosses get kill cards. Farm sessions and raid trash show as a single line per zone with the kill count and total damage, so a night of clearing can’t push the boss kills off the page.' },
      { name: '\u{1F513} Lockout bosses earn their card', blurb: 'Any mob the server gives a loot lockout for counts as a boss — instanced nameds outside the boards promote themselves to kill cards the first time a lockout or kill broadcast names them, with their whole kill history attached.' },
      { name: '\u{1F4CD} Zones instead of "Unknown zone"', blurb: 'Kills now resolve their zone from the mob itself, so the page says Ssraeshza Temple or The Fungus Grove instead of lumping everything under Unknown zone.' },
    ],
    fixes: [
      'The Recent Kills widget on the front page no longer fills up with whatever someone farmed overnight.',
    ],
  },
  {
    key: 'agent-3-5-88',
    title: '\u{2728} smoOOTH SCAlers',
    version: 'Mimic 2.5.4 · Agent 3.5.91',
    date: '2026-08-19',
    headline: 'Size every overlay to your screen — one slider for all of them, plus one on each — and the bard swarm counter tells the truth about the kite. Now on stable for the whole fleet.',
    features: [
      { name: '\u{1F50D} Overlay size, three places', blurb: 'A "Size — all overlays" slider on the dashboard Overlays tab scales everything 50%–200% for high-DPI screens. Each overlay also has its own size slider in its setup bar that overrides the global for just that one, with a reset to follow the global again.' },
      { name: '\u{2728} Overlays glide to their new size', blurb: 'Changing the size smoothly grows or shrinks the whole overlay — window, background, and rounded corners together — when you release the slider. That smooth glide is on by default; a checkbox turns it off for instant snapping.' },
      { name: '⚔ Swarm damage on the melody tracker', blurb: 'AE songs now show what each pulse hit for per mob and a running damage total for the current kite next to the hit counter. Toggle it from the tray if you prefer just the count.' },
      { name: '\u{1F4BE} Layouts and tray controls on the Overlays page', blurb: 'Per-character overlay layouts — save the current layout for your toon, see every saved one, and turn on automatic swapping as you switch characters — now live on the Overlays page, not just the tray. Lock/unlock, Setup mode, Hide-all, and the Dock itself got buttons and a row there too.' },
      { name: '\u{25AB} Dock layouts with names', blurb: 'The dock can save its whole arrangement — which panes, how many columns, their sizes and backgrounds — under a name, and swap between saved layouts from the new 💾 button. You can also rename the dock itself.' },
      { name: '\u{25E2} Stretch panes by their corner', blurb: 'In Setup mode every dock pane has a corner grip — drag it to stretch the pane across extra columns or rows, snapping to the grid as you go. The pane menu presets still work too.' },
    ],
    fixes: [
      'The swarm hit counter could climb past the 12-mob cap ("123/12") when the game wrote its log in bursts — pulses are now counted by the log’s own clock, so the badge always reads one pulse.',
      'Scaled-up overlays no longer clip their content or their right-click menu, and their card backgrounds stay centered with rounded edges in the right place.',
      'The dock no longer grows and shrinks on its own when a size other than 100% is set — and it now stays at 100% entirely unless you check "Scale the dock too".',
      'The setup bar keeps its controls on two tidy rows instead of wrapping into a jumble on narrow overlays, and it stays one readable size at any overlay scale, spanning the window edge to edge.',
      'The tray could claim overlays were hidden while every one of them was on screen — that stale state now clears itself the moment it stops being true.',
      'The dock stopped growing a little taller every second — it now sizes to exactly what is in it, and an empty dock collapses to its header.',
      'Docking an overlay while placing everything in Setup mode no longer makes the rest of your overlays vanish.',
      'Overlays in Setup mode no longer clip the bottom of their card, and the duplicate move icon over the setup bar is gone.',
      'Setup mode finally reaches the dock: "Setup THIS Overlay" works on it, and panes can be dragged to reorder while placing.',
      '"Eye of" pets no longer sneak onto the DPS meter or history.',
    ],
  },
  {
    key: 'bot-3-1-55',
    title: '\u{1F9D9} Real class names on /who',
    version: 'Bot 3.1.55',
    date: '2026-08-19',
    headline: 'The /who overlay says "Necromancer", not "Warlock" — level titles fold back to the real class.',
    features: [],
    fixes: [
      'High-level characters show their level title in /who (a 60 necromancer reads "Warlock", a 60 beastlord "Savage Lord"), and the anonymous-player lookup passed those titles straight through — they now fold back to the base class everywhere the lookup feeds.',
    ],
  },
  {
    key: 'web-1-1-67',
    title: '\u{1F6D2} Spell shopping list',
    version: 'Web 1.1.67',
    date: '2026-08-18',
    headline: 'Your missing-spells page now tells you exactly who sells or drops each spell and where — and plans your shopping trip zone by zone.',
    features: [
      { name: '\u{1F50D} Click a spell, see the source', blurb: 'Every missing spell opens up to the vendors that sell it and the mobs that drop it, with zones — straight from our own weekly game-data mirror, no more broken outside links. An Expand-all button opens the whole list at once.' },
      { name: '\u{1F6D2} Shopping list mode', blurb: 'Flip the view to go zone by zone: each zone lists the spells you can buy there, the zones you MUST visit sort to the top, and spells sold in only one place carry an "only here" badge so nothing gets missed on the trip.' },
    ],
    fixes: [
      'The old "find" links pointed at an outside site in a form that didn’t load — sources now come from our own database, with the outside link kept only as a working cross-check.',
    ],
  },
  {
    key: 'web-1-1-66',
    title: '\u{1F4C8} Adoption',
    version: 'Web 1.1.66',
    date: '2026-08-18',
    headline: 'Officers get a product-health page: who contributes data, who’s new, who stayed, and which raiders to talk to next.',
    features: [
      { name: '\u{1F4C8} Contributors, counted honestly', blurb: 'Weekly active contributors, new activations (split between brand-new raiders and veterans converting), and retention — all counted in people, not characters, since one person plays many.' },
      { name: '\u{1F4CB} The work list', blurb: 'The page names who raided in the last month without ever contributing data, who went quiet, and which attendees can’t be counted until their characters get linked — turning the numbers into next steps.' },
    ],
    fixes: [],
  },
  {
    key: 'bot-3-1-54',
    title: '\u{1F501} Retrigger',
    version: 'Bot 3.1.54',
    date: '2026-08-18',
    headline: 'Ask the bot to take another look: /retrigger re-runs its automatic reply in a thread from what has been said there.',
    features: [
      { name: '\u{1F501} /retrigger', blurb: 'In a suggestion-box thread (or pointing at one by link), the bot re-reads the post and recent chat — you choose how far back with "10m" or "5h" — and posts its tap-the-boss request card. Threads that still have the old text-only card get the buttons swapped in right where it sits.' },
    ],
    fixes: [],
  },
  {
    key: 'bot-3-1-53',
    title: '\u{1F446} Two-tap event requests',
    version: 'Bot 3.1.53',
    date: '2026-08-18',
    headline: 'Post in the suggestion box, tap the boss, tap when — the officers get your request. No command to type.',
    features: [
      { name: '\u{1F446} Tap the boss, tap the time', blurb: 'The bot’s reply to your suggestion post now has buttons: it offers the boss it spotted in your post (or a full picker by era), then time choices — with "Any time, any night" front and center. Your request goes to the officers instantly, linked back to your post so they see the whole story.' },
      { name: '\u{270F} Exact times still welcome', blurb: 'An "Exact time…" button opens a small form if you have a specific night in mind — and the classic /suggest command works everywhere, unchanged.' },
    ],
    fixes: [],
  },
  {
    key: 'bot-3-1-52',
    title: '\u{1F3C6} First kills always count',
    version: 'Bot 3.1.52',
    date: '2026-08-17',
    headline: 'Killing something the guild has never killed before now always makes it into the records.',
    features: [],
    fixes: [
      'Fights against brand-new content used to be silently dropped from the website records if the mob wasn’t already on our tracked list — which cost us the Final Arbiter first kill and all the Sleeper’s Tomb trash on its first clear. New mobs now register themselves automatically the moment a fight is uploaded.',
      'Re-running your logs (backfill) over fights with tracked bosses now files them correctly — a naming mismatch used to make backfilled boss fights vanish.',
    ],
  },
  {
    key: 'web-1-1-62',
    title: '\u{1F550} A readable fight timeline',
    version: 'Web 1.1.62',
    date: '2026-08-17',
    headline: 'The new fight timeline list, cleaned up from its first raid night.',
    features: [],
    fixes: [
      'Events from a neighboring trash pull no longer pile up at 0:00 — they fold into their own "before this pull" drop-down with real times.',
      'Personal range-check callouts (Too Far, Can Not See, Out of Range…) are no longer shown — they are about where YOU stood, not the fight. The summary says how many were hidden.',
      'Repeated calls fold into one line with a count even when two targets alternate, duplicate "(copy)" triggers merge into the original, and rows read cleanly on a phone.',
    ],
  },
  {
    key: 'web-1-1-61',
    title: '\u{1F5C2} Fight cards',
    version: 'Web 1.1.61',
    date: '2026-08-16',
    headline: 'A pre-raid checklist page: one card per fight with the comp it needs, the kit to bring, the tactics, and whether every callout is actually armed.',
    features: [
      { name: '\u{1F5C2} One card per fight', blurb: 'Fight cards (linked from the Raid Guide) show each fight’s composition needs, kit, and tactics before the pull — written by officers, readable by everyone. Tonight’s Tunare fights, the four warders, and the Vulak ring are already in.' },
      { name: '✓ Callouts checked live', blurb: 'Each card lists its callouts straight from the guild trigger list — armed, deliberately off, or MISSING in red — with the timer and what the voice says. If a trigger changes, the card changes with it.' },
    ],
    fixes: [],
  },
  {
    key: 'web-1-1-60',
    title: '\u{1F4CA} Parse charts read by class',
    version: 'Web 1.1.60',
    date: '2026-08-16',
    headline: 'The damage-over-the-fight chart on a parse page now reads the way a raid leader thinks: by class first, by character when you ask.',
    features: [
      { name: '\u{1F3AF} Classes first, percentages on the chart', blurb: 'The stacked chart groups damage by class, with each class named on the right edge of the graph next to its share of the total. Click a class to break it out into its characters with the same percentages; hover any class to light up its slice.' },
      { name: '\u{1F6E1} The MT bar explains its gaps', blurb: 'A gap in the tank strip means NOBODY was taking hits — the mob was running, kited, or off the raid — not that the tank changed. Hover a gap to see exactly when. Tiny false gaps from how often the data samples are gone.' },
      { name: '\u{1F550} The fight timeline is a list now', blurb: 'Instead of unreadable dots, the timeline is a drop-down below the chart: every death, raid event, and callout in order, with names and times. Repeats fold into one line with a count.' },
    ],
    fixes: [],
  },
  {
    key: 'web-1-1-57',
    title: '\u{1F3B2} See who else rolled',
    version: 'Web 1.1.57 · Agent 3.5.85',
    date: '2026-08-14',
    headline: 'Roll sessions only ever showed the winner. Open one up and you can now see everybody who rolled and what they got.',
    features: [
      { name: '\u{1F3B2} Every roll, not just the winning one', blurb: 'On the roll page, click a winner to drop down the whole list for that item — who rolled, what they got, highest first. Re-rolls are marked, so a big number that did not win no longer looks like a mistake.' },
      { name: '✖ Tidy up the Command Center as loot goes out', blurb: 'The same drop-down is on the Command Center overlay, and each roll now has an ✖ to clear it away once that item is handed out — plus a "clear all". It only affects your own screen, and it resets each night.' },
    ],
    fixes: [],
  },
  {
    key: 'agent-3-5-84',
    title: '\u{1F3B2} Roll nights know what you were rolling for',
    version: 'Agent 3.5.84',
    date: '2026-08-14',
    channel: 'beta',
    headline: 'The roll page kept saying "unlabeled roll" because it only understood one way of calling loot. It now understands the way people actually type.',
    features: [],
    fixes: [
      'Roll calls written with commas — "Black Tear 111, Platinum Tear 222" — now name their items on the roll page. Only a vertical bar between them used to count, so most calls came through blank.',
      'A single item with several ranges — "Helmet of Shadow 311 pick, 322 upgrade, 333 alt" — now labels all three, instead of none.',
      'A plain "Atramentous Shield 333" on its own now works too. That is the most common way people call a roll and it had never been picked up.',
      'Because the item name is also what links a roll to who actually looted it, all of the above were leaving the "looted by" column empty. Those now fill in — including when the person who won the roll passed it to someone else.',
      'Last night’s Tears have been named on the roll page already.',
    ],
  },
  {
    key: 'web-1-1-55',
    title: '\u{1F9F0} The Quartermaster shows your characters',
    version: 'Web 1.1.55',
    date: '2026-08-14',
    headline: 'The utility-kit board used to list everyone in the guild who owned each item. It now shows yours, and a count for the rest.',
    features: [
      { name: '\u{1F9F0} Your kit, not the whole roster', blurb: 'On the Quartermaster page, each item now shows which of YOUR characters carry it. Everyone else is counted but not named — so you still see "eleven people in the guild have one", just not a list of who. Officers still see the full list, same as before.' },
    ],
    fixes: [],
  },
  {
    key: 'web-1-1-53',
    title: '\u{1F9F3} Bank mules and alts, without running Mimic on them',
    version: 'Web 1.1.54',
    date: '2026-08-14',
    headline: 'Characters that never raid can now be added from a single file, so your bank toons show up on your page like everything else.',
    features: [
      { name: '\u{1F9F3} Add characters from inventory files', blurb: 'On your own page there is a new button that takes EverQuest inventory files. Log in on a mule once, type /outputfile inventory, and drop the file in \u2014 the character appears on your page with everything it is carrying. You can do a whole stack of them at once. Nothing needs to be running on that computer afterwards, and you do not need an officer to add them.' },
      { name: '\u{1F464} It also picks up alts we already knew about', blurb: 'If one of your characters was already on the roster but had never been linked to you, uploading its inventory file now adds it to your page too. The only thing it will not do is take a character that is already somebody else\u2019s.' },
    ],
    fixes: [
      'Mimic now finds EverQuest when it is installed in a TAKP folder, instead of asking you to browse for it.',
      'Pointing Mimic at your EverQuest folder now counts even before you have any log files \u2014 previously the "Set up EQ for me" button would say it did not know where EverQuest was, on a folder you had just told it about.',
      'When you have no characters yet, the page now explains that logging is simply switched off in game (and how to turn it on) instead of implying your folder was wrong.',
    ],
  },
  {
    key: 'web-1-1-51',
    title: '\u{1F464} Raid view: people who log back in show up again',
    version: 'Web 1.1.51',
    date: '2026-08-14',
    headline: 'If someone swapped characters earlier in the night and then logged their own toon back in, the raid page kept showing them as offline. It now notices they are back.',
    features: [],
    fixes: [
      'A raider who came back after a character swap no longer sits under "Not seen / offline" with their group stripped — they go back into their real group as soon as they are moving around in the zone again.',
    ],
  },
  {
    key: 'mimic-2-5-0',
    title: '\u{1F4CA} A damage meter you can trust, and a dashboard you can find things in',
    version: 'Mimic 2.5.0 \u00b7 Bot 3.1.45 \u00b7 Web 1.1.52',
    date: '2026-08-14',
    headline: 'The raid-wide damage numbers were doubling people up mid-fight, so they now wait until the fight is over and everyone has reported. The CH chain stopped picking up healers who were never on it. And the dashboard has a sidebar.',
    features: [
      { name: '\u{1F4CA} History tab on the damage meter', blurb: 'A new tab holds the last few mobs you killed, with the raid-wide numbers for each and arrows to page between them. It says how many people\u2019s clients agreed on those numbers, and shows \u201csettling\u201d while it is still waiting on the last few to report.' },
      { name: '\u{1F440} During the fight, the meter is yours again', blurb: 'The DPS and Tank tabs show what your own machine saw while you are actually fighting. Raid-wide totals need everyone to report in, and mid-fight too few have \u2014 which was making some people look like they did twice the damage they really did.' },
      { name: '\u{274C} Take someone off the CH chain', blurb: 'Every slot on the chain has a small \u2715 to take that healer off it, and they stay off even if they keep calling that number. If two people are claiming the same slot, removing one hands the slot back to the other instead of clearing it.' },
      { name: '\u{1F5C2} A sidebar on the Mimic dashboard', blurb: 'The tabs moved to a rail down the left so you can jump straight to what you want instead of scrolling. The two most crowded tabs were split up while we were in there: what happened this session now lives under Stats, and is-it-working-properly lives under Diagnostics.' },
      { name: '\u{1F43E} Pets count towards their owner', blurb: 'A warder or a charmed pet no longer takes up its own line on the damage meter \u2014 its damage is added to whoever it belongs to, with a small \u201c+pet\u201d beside their name.' },
      { name: '\u{23F1} Your own countdown on your CH row', blurb: 'The next cleric up now sees the countdown on their own line, not just in the footer.' },
    ],
    fixes: [
      'The \u201cyou\u2019re up next\u201d call on the CH chain was being said twice, and the first one was early \u2014 it fired the moment the cleric before you started casting rather than when you were actually due. It is said once now, at the right moment.',
      'A CH call no longer gets cut off when another callout fires at the same time. Callouts queue behind each other, and the chain call jumps the queue.',
      'A druid shouting their heals without a slot number no longer gets dropped into the CH chain on top of a cleric who really is on that slot \u2014 a spot heal on the rampage target now shows on its own line.',
      'Slow and rampage callouts work on instanced bosses again. The name Mimic reads from the game and the name in your log are written slightly differently, and the callouts were quietly comparing the two.',
      'If you copy your log file aside and let EverQuest start a fresh one, the copy is no longer counted as a separate raider. That one phantom was setting the raid-wide damage number for the whole guild.',
      'A character who logs out now leaves the healer mana board instead of sitting there at whatever mana they last called.',
      'The Damage and Observed columns line up with their headings on a wide damage meter.',
    ],
  },
  {
    key: 'mimic-2-4-0',
    title: '\u{1FA7A} Crash review, raid-wide damage, and item pictures',
    version: 'Mimic 2.4.0 \u00b7 Web 1.1.49 \u00b7 Bot 3.1.41',
    date: '2026-08-13',
    headline: 'Mimic can now tell you what actually crashed EverQuest, the damage meter shows what the whole raid did next to what your own machine saw, and items have their real icons on the site.',
    features: [
      { name: '\u{1FA7A} Find out what crashed you', blurb: 'On the Info tab, Mimic reads the crash files EverQuest leaves on your PC and says in plain words what broke \u2014 including whether Mimic or Zeal had anything to do with it. On the first one we looked at, neither did: the sound device the game was playing through had been switched off underneath it. Your crash files never leave your PC.' },
      { name: '\u{1F4CA} The damage meter now shows the whole raid', blurb: 'Each row shows what the raid recorded, with what your own machine saw in brackets beside it. If someone did 164k and you saw none of it, you can finally tell \u2014 which matters more than it sounds, because a raider who zones in late can be watching a meter showing a twentieth of the fight.' },
      { name: '\u{1F5E1} Items show their real icons', blurb: 'Loot on the website now appears with the same picture you see in your inventory.' },
      { name: '\u{1F4C8} Fight timeline on parse pages', blurb: 'Boss health across the fight with every damage dealer stacked underneath it, plus a lane showing who was tanking and when. Search for a player or click a class to highlight where they were.' },
      { name: '\u{1F5E3} Callouts can say something different to what they show', blurb: 'A personal trigger can now have its own spoken line, so an alert can read one way on screen and be said another way out loud.' },
    ],
    fixes: [
      'Personal alerts like "your target is too far" no longer get broadcast to the entire raid \u2014 that was burying the trigger log.',
      'Hiding all overlays no longer silences your callouts. The screen goes quiet, the voice does not.',
      'Spoken callouts no longer read emoji out loud (the Divine Intervention alert was being announced as "high voltage").',
      'The settings gear no longer appears on the Command Center overlay.',
      'Crash reports keep your character and zone when the game crashes while zoning \u2014 which was exactly when we most wanted them.',
    ],
  },
  {
    key: 'crash-review',
    title: '\u{1FA7A} Mimic can tell you what crashed you',
    version: 'Agent 3.5.67',
    date: '2026-08-13',
    channel: 'beta',
    headline: 'When EverQuest closes on you, Mimic can now read the crash files left on your PC and tell you in plain words what broke \u2014 including whether it was anything to do with Mimic or Zeal.',
    features: [
      { name: '\u{1F9EA} "Was that Mimic\u2019s fault?"', blurb: 'The honest answer, per crash. On the first one we looked at, Zeal was running but had nothing to do with it \u2014 the sound device the game was playing through had been switched off underneath it.' },
      { name: '\u{1F50D} A real answer instead of an error code', blurb: 'The summary file EverQuest leaves behind usually just says something like "error 0x6ef". Mimic now reads the full crash file next to it and says which part of your PC gave out \u2014 sound, graphics, the network, or the game itself.' },
      { name: '\u{1F6E0} What to actually try', blurb: 'Where we can tell, you get the specific next step \u2014 which speakers the game was using when it died, or that your graphics driver restarted four times in six minutes.' },
      { name: '\u{1F512} Nothing is uploaded', blurb: 'The crash files stay on your PC. Reading them is a button on your own dashboard, and you do not have to share anything with the guild to use it.' },
    ],
    fixes: [
      'Crash reports no longer lose your character name and zone when the game crashes while zoning \u2014 which was exactly when we most wanted them.',
    ],
  },
  {
    key: 'roll-officer-edits',
    title: '\u{1F3B2} Officers can fix and hide roll records',
    version: 'Web 1.1.42',
    date: '2026-08-12',
    headline: 'Rolls captured off the /random lines are now correctable \u2014 name one that came through blank, or hide a misfire so it stops cluttering the night.',
    features: [
      { name: '\u{270E} Name a roll that came through blank', blurb: 'Some announcements do not attach the item \u2014 "Do a 777 if you want a Shield of the Immaculate" landed as an unlabeled roll. Officers can now type the item in, and it sticks even as more people upload their view of the same roll.' },
      { name: '\u{1F648} Hide a misfire', blurb: 'A stray 0-22 roll no longer has to sit in the night\u2019s record forever. Hidden rolls disappear for members but stay visible to officers, so a wrong hide is easy to undo.' },
    ],
    fixes: [],
  },
  {
    key: 'raid-brain-batch-204-207',
    title: '\u{1F9E0} Four raid-night helpers land on beta',
    version: 'Agent 3.5.59 \u00b7 Bot 3.1.38',
    date: '2026-08-11',
    channel: 'beta',
    headline: 'The four designed-during-the-Ssra-review helpers, built and on the beta channel: a DI callout that names who should cast next, a second death-detector that watches group health, capture for the boss effects that vanish instantly, and dismissible countdown chips that stay out of the middle of your screen.',
    features: [
      { name: '\u{1F64F} When a Divine Intervention fires, the overlay names who should recast', blurb: 'Instead of "someone DI", the CH chain card shows the two clerics best placed to recast \u2014 skipping anyone dead, anyone who just cast theirs, and anyone who is not a cleric at all.' },
      { name: '\u{1FAA6} A second witness for deaths', blurb: 'Your group members\u2019 health bars are now a death detector in their own right: a bar that hits zero and stays there counts as proof, cross-checked against the log \u2014 with guards so a feigning monk or a zoning groupmate never reads as dead.' },
      { name: '\u{1F4A5} The instant boss effects stop being invisible', blurb: 'About 138 boss abilities land and vanish in the same moment \u2014 dispels, drains, knockbacks \u2014 and none of them were being kept. A new Boss Mechanics card on the dashboard records each one with who it hit, honestly marked "unidentified" when several spells share the same message.' },
      { name: '\u2715 Every countdown chip can be dismissed', blurb: 'Every timer chip now has an \u2715, there is a clear-all button, the stack grows upward from the bottom so it never creeps over the middle of your screen, caps at six rows with a "+N more" tail, and one mob never shows two slow bars. Dismissals are counted so we can learn which callouts people do not want.' },
    ],
    fixes: [
      'A rehearsed or replayed timer chip showed "null" instead of the mob name, and timer triggers without a per-mob key were quietly back to stacking one row per fire \u2014 a counter added for imported GINA triggers had snuck back into the timer\u2019s identity.',
    ],
  },
  {
    key: 'overlays-stop-guessing',
    title: '\u{1F6E1} Your overlays stop telling you things they don’t know',
    version: 'Mimic 2.3.5 · Agent 3.5.58',
    date: '2026-08-10',
    headline: 'Everything from the Ssra raid, now on the stable release — timers that stop stacking up, countdowns that agree with each other, and overlays that admit when they are not sure instead of guessing.',
    features: [
      { name: '\u{23F1} A re-slow resets the bar instead of adding another one', blurb: 'Every timer trigger was starting a brand new row each time it fired, so a trash pull buried the overlay in near-identical lines — and killing the mob could not clear them. Slows, snares and the rest now reuse one bar per mob, the row is labelled with the mob’s name, and killing it clears the bar. Reported by Hitya mid-raid.' },
      { name: '\u{1F551} Shared callouts run on your clock, not the sender’s', blurb: 'When someone else’s trigger fires and gets passed to the raid it used to carry the time THEIR computer thought it was. PCs drift — three of ours are between 14 and 56 seconds out. A sender running slow had their callouts thrown away as "too old" before anyone heard them; a sender running fast had the callout arrive and then sit silent. Every countdown started from a shared trigger was wrong by that same gap. That difference is now measured and taken out on arrival.' },
      { name: '\u{1F507} A death callout you hear once', blurb: 'Two people watching the same death each announced it, because the "have we already said this" check included their own log line — and two PCs never write that line identically. Shared callouts also respect the trigger’s cooldown now; they previously ignored it entirely.' },
      { name: '\u{1F40C} The slow badge stops naming a spell it cannot know', blurb: 'Eleven different spells print the exact same message when they land, and a Willsapper proc (35%) was being reported as a shaman Turgur’s Insects (75%) — the same message, the same duration, less than half the actual slow. When we cannot tell which one landed the badge now just says SLOWED, with the possibilities in the tooltip. A slow we can actually identify still shows its real strength.' },
      { name: '\u{1F489} Tank health numbers stop lying when they go stale', blurb: 'The main tank could show a full "7k / 7k" bar while sitting at half health, because the percentage came from your live game data while the exact numbers came from a snapshot that could be a minute and a half old. Exact numbers now expire, and the card falls back to the live percentage instead of showing figures nobody can stand behind.' },
      { name: '\u{1FAA6} The dead stop showing up as people to heal', blurb: 'A raider who died stayed on the off-heal list at whatever health they died on, and stayed listed as a tank. Overlays now know who is currently dead.' },
    ],
    fixes: [
      'A trigger set up to run one countdown per target — one bar per mez, say — was ignoring that setting and starting a new bar every fire anyway.',
      'Raising a trigger’s cooldown could not stop a duplicated callout, because callouts passed between raiders ignored cooldowns completely.',
    ],
  },
  {
    key: 'timers-agree-with-each-other',
    title: '\u{23F1} Everyone’s countdown finally says the same thing',
    version: 'Agent 3.5.56 · Bot 3.1.37',
    date: '2026-08-10',
    channel: 'beta',
    headline: 'Timer triggers piled up a fresh row on every single fire, and when a callout was shared with the raid it was timed off the sender’s PC clock instead of yours — so no two people saw the same number.',
    features: [
      { name: '\u{1F5D3} A re-slow resets the bar instead of adding another one', blurb: 'Every timer trigger was starting a brand new row each time it fired, so a Ssra trash pull buried the overlay in near-identical lines — and killing the mob could not clear them. The cause was the countdown quietly using the whole log line, timestamp included, as the name of the timer, which made every fire look like a different mob. Slows, snares and the rest now reuse one bar per mob, the row is labelled with the mob’s name rather than the raw line, and killing it clears the bar. Reported by Hitya mid-raid.' },
      { name: '\u{1F551} Shared callouts run on YOUR clock, not the sender’s', blurb: 'When someone else’s trigger fires and gets passed to the rest of the raid, it carries the time their computer thought it was. PCs drift — three of ours are between 14 and 56 seconds out and getting worse by a couple of seconds a day — and everyone receiving it was doing the maths against their own clock. A sender running slow had their callouts thrown away as "too old" before anyone heard them; a sender running fast had the callout arrive on time and then sit silent for as long as their clock was ahead; and every countdown started from a shared trigger was wrong by that same gap, warnings included. The difference is now measured and taken out on arrival, so the bar you see matches the bar next to you.' },
      { name: '\u{1F507} A death callout you hear once', blurb: 'Two people watching the same death each announced it, because the check for "we have already said this" included their own log line — and two PCs never write that line identically. It now compares the parts that actually describe the event, so the raid hears it once. Shared callouts also respect the trigger’s cooldown now; they previously ignored it entirely, which is why turning the cooldown up never helped.' },
    ],
    fixes: [
      'A trigger set up to run one countdown per target — one bar per mez, say — was ignoring that setting completely and starting a new bar every fire anyway.',
    ],
  },
  {
    key: 'tagged-mobs-stay-put',
    title: '\u{1F3F7} Tagged mobs stop vanishing off the list',
    version: 'Bot 3.1.37',
    date: '2026-08-10',
    headline: 'A mob you had tagged dropped off the Extended Target list as soon as its health moved out of the band the list was watching.',
    features: [
      { name: '\u{1F4CC} If you tagged it, it stays on the list', blurb: 'Tagging a mob is a deliberate "keep an eye on this one", but the list was still filtering tagged mobs by health like everything else, so the thing you had just marked could disappear at exactly the wrong moment. Anything carrying a tag now stays on the list at any health, and keeps its tag text through a refresh.' },
    ],
    fixes: [],
  },
  {
    key: 'loot-panel-knows-what-you-won',
    title: '\u{1F4B0} The bidding panel knows what you already won',
    version: 'Bot 3.1.33 · Mimic 2.3.4 · Agent 3.5.54',
    date: '2026-08-09',
    headline: 'Gear you had already won kept showing up as gear you still wanted — and the alt list threw away what you typed into it.',
    features: [
      { name: '\u{1F3C6} Your wins are no longer forgotten past the hundredth one', blurb: 'The panel only ever checked your hundred most recent awards when working out what you had won, and it sorted them by when our copy of OpenDKP last refreshed rather than by when you actually won them — so which hundred it looked at was close to random and shifted every week. If you have more than a hundred pieces of loot, the rest came back as “bid on but not yet won” and as recent misses. It now reads your whole award history, and your wins list is in the order you won them. This one is already live for everyone. Reported by Hitya.' },
      { name: '\u{1F464} Your characters come from OpenDKP now', blurb: 'You should not have to type your own main and alts — OpenDKP already knows them. They fill in on their own when you sign in, and any character OpenDKP knows about that your list is missing gets added. Anything you typed yourself stays put, and there is a button to replace your list with OpenDKP’s outright if you would rather start clean.' },
      { name: '\u{1F576} Your loot history stays hidden until you ask for it', blurb: 'The wishlist, misses and wins now start closed behind a “show my loot history” button, and close again every time the dashboard loads. People share their screen during raids, and a wishlist on display tells everyone else exactly what you are saving for. Suggested by Hitya.' },
      { name: '✕ Take anything off the list', blurb: 'Every wishlist and miss row has an ✕ to hide it — useful for the items the panel guessed at from your old bids that you have no interest in any more. A “restore all” link brings them back, so a mis-click costs you nothing. This is only on your own PC; nothing is sent anywhere.' },
      { name: '\u{1F5D3} The list opens on the current expansion', blurb: 'Instead of every item you have ever bid on going back to Classic, the expansion filter starts on the one being raided now — worked out from your newest award, so it moves on by itself when the next expansion opens. If that would leave you with an empty list it shows everything instead.' },
    ],
    fixes: [
      'Adding an alt wiped out the main you had just typed, and a name you added was thrown away if you did not hit save within seven seconds — the panel refreshes on a timer and was handing back your last saved list mid-typing. It now leaves what is on screen alone and tells you when there is something unsaved.',
    ],
  },
  {
    key: 'tag-youre-spawn-id-it',
    title: '\u{1F3F7} Tag! You’re spawn_id it!',
    version: 'Mimic 2.3.4 · Agent 3.5.54',
    date: '2026-08-08',
    headline: 'When two mobs share a name, nothing the game hands us can tell them apart — except a /tag. Marking a mob quietly carries a hidden ID that is the only thing separating one “a decaying skeleton” from the other four, and this release makes that work properly.',
    features: [
      { name: '\u{1F3F7} Tagging is how we tell identical mobs apart — but check two settings', blurb: 'Live in The Deep we separated seventeen simultaneous “an elder thought horror” purely from tags. That only works if your tag actually reaches the log, and two Zeal options silently stop it. “Suppress tag msgs” drops the message entirely, and “Prettyprint tag msgs” rewrites it and throws away the ID — leaving just the name we already had. In both cases the arrow still appears over the mob, so it looks like it worked when nobody received it. Turn both OFF. Mimic’s tag card now warns you if either is on, and tells you when the game’s chat limit ate a tag so you know to send it again. Found by Hitya in live testing.' },
      { name: '\u{1F5C2} Huge logs tidy themselves up', blurb: 'A log file over 500 MB gets moved into a LogArchive folder once you have stopped playing that character, and EverQuest starts a fresh one. Nothing is ever deleted — your old logs stay on your disk and can still be used to fill in past raids. There is a card on the dashboard showing what is about to be archived and a one-click off switch. Suggested by Ashieron.' },
      { name: '⏱ Timers can warn you more than once', blurb: 'A tank buster can now call out at ten seconds AND at four, instead of forcing a choice. A timer can also read its length straight out of the game text when a mob announces its own timing, one trigger can run several separate countdowns at once (one per mez target, say), and abilities with only a recast — Feign Death, Lay on Hands — can finally show a bar telling you when they are back. Triggers you already wrote keep working exactly as they did.' },
      { name: '\u{1F4E5} Imported GINA and EQLogParser triggers actually fire', blurb: 'Most triggers imported from those tools were silently dead on arrival — they loaded, looked fine in the list, and never fired. Several separate faults in how their patterns were read have been fixed, GINA trigger packages (.gtp) now import at all, and a GINA timer arrives as a real countdown instead of muting the trigger for its duration.' },
    ],
    fixes: [
      'Every slow in the game read as dropped 12 seconds early — Slow, the Insects line, Forlorn Deeds, Cloud of Grummus and the rest — so the call went out while the mob was still slowed and shamans re-slowed for nothing.',
      'Monk special attacks (flying kick, round kick, dragon punch, eagle strike, tiger claw) and Harm Touch were credited to nobody on the damage meter. Harm Touch never counted as damage at all.',
      'A buff cast on a lower-level character showed a shorter time than it really had, because the countdown used the recipient’s level instead of the caster’s.',
      'On a busy pull the tag list quietly filled up and kept only the oldest marks, so the boss — usually tagged last — was the one thrown away.',
      'A tag stayed put when you changed zones and could end up sitting on a completely unrelated mob, because the game reuses mob ID numbers between zones.',
      'Re-tagging a mob wiped out the record of who had tagged it before you.',
      'Replaying an old log to test a trigger never showed the countdown bar, so a perfectly good timer looked broken.',
      'A trigger that began with a mob or player name — like the Razor Fang callout — was picking up the date and time stamped at the front of every log line as part of the name. The callout read the timestamp out loud, and any timer keyed to that name started a brand new bar on every single fire instead of reusing one.',
      'If another program had already claimed Ctrl+Shift+H — Microsoft Edge is a common culprit — the hide-all-overlays hotkey did nothing at all and every overlay just looked broken. The tray menu now says when the hotkey is blocked so you can use the menu instead. Found by Hitya.',
    ],
  },
  {
    key: 'attendance-since-you-joined',
    title: '\u{1F4CA} Your attendance counts from when you joined',
    version: 'Bot 3.1.32',
    date: '2026-08-08',
    headline: 'Attendance was measured against every raid tick the guild has ever held — including the years before you were in it.',
    features: [
      { name: '\u{1F4CA} Measured against raids you could actually have attended', blurb: 'Your percentage now counts only the ticks since you joined, for every window, which is what OpenDKP has always shown. Everyone who joined after the guild’s early days was being under-reported, and the newer you were the worse it looked — exactly backwards for a number used to spot who needs a nudge. Long-standing members barely move; genuinely low attendance stays low. Spotted by Hitya, who pointed out that Gonner has never missed a tick while the page showed him at 64%.' },
    ],
    fixes: [],
  },
  {
    key: 'harmshield-ch-chain-tags',
    title: '\u{1F6E1} Harmshield counts as invuln, and the chain stops renaming your healers',
    version: 'Mimic 2.3.3 · Agent 3.5.42',
    date: '2026-08-07',
    headline: 'Everything the beta testers have been running for the last few weeks, now on the stable channel for the whole guild — three raid-floor corrections and a sign-in that no longer fails in silence.',
    features: [
      { name: '\u{1F6E1} Harmshield counts on Rampage', blurb: 'The rampage warning only ever recognised Divine Aura. A monk who popped Harmshield still showed as a normal target, and the raid kept spending heals on someone who could not be hurt — that is exactly how Syko’s went unnoticed. Harmshield now lights the gold bar alongside DA. Defensive and Weapon Shield deliberately stay off it: they reduce damage, they do not make you immune.' },
      { name: '\u{1F49A} Your healers show their real class', blurb: 'The Command Center listed Brynnja and Denniker as Cleric and Druid at the same time, flickering between the two. Anyone in the CH chain was being called a Cleric, but druids take chain slots too and shamans turn up as well. Being in the chain now proves you are chain healing and nothing more — the class shown is the real one.' },
      { name: '\u{1F3F7} A tag lasts the whole fight', blurb: 'Marking a mob with /tag used to expire after two minutes. On Thall Va Xakra the tag six people had caught aged out at 32% boss health, halfway through the pull, taking the only thing that told the two spawns apart with it. Tags now hold for ten minutes. Appending with +tag also records both taggers rather than only the last one.' },
    ],
    fixes: [
      'The Command Center raid panel blinked between a full 45-raider board and "No raid roster flowing yet". A single slow or empty poll was enough to wipe the whole list; it now keeps the last good roster through a blip.',
      'Divine Intervention could show as ready for someone nobody was observing — Fargan read as up when he was not. An unobserved DI now reads as unknown instead of ready.',
      'Clicking Discord sign-in in Settings did nothing whatsoever if your default browser failed to open, with no tab and no error. Seen on Firefox. The failure is now reported with the link shown so you can open it yourself.',
    ],
  },
  {
    key: 'intentional-deaths',
    title: '\u{1F480} Deaths that were the plan, and a review that sits at the top',
    version: 'Bot 3.1.21 \u00b7 Web 1.1.19',
    date: '2026-08-06',
    headline: 'Some deaths are the strat. The raid review kept filing them under "what to work on" \u2014 and it was landing on the third line of the thread besides.',
    features: [
      { name: '\u{1F480} Mark a death as on purpose', blurb: 'Officers can mark a character as dying deliberately on a specific boss. Fawx and Dant make a corpse on Kaas Thox Xi Ans Dyek every single week, so it is set once from that fight\u2019s parse page and holds every week after \u2014 no re-marking. Those two are already set. The death is never hidden: it still counts in the night\u2019s total and still shows in the deaths list, it just stops being listed as a mistake, and the header says how many were on purpose.' },
      { name: '\u{1F4D3} The review sits at the top of the thread', blurb: 'The night\u2019s thread now holds its first two spots the moment it opens, and the review moves into one of them instead of posting under whatever landed first. The second spot is there for nights when the review runs long, and is cleaned up when it is not needed.' },
    ],
    fixes: [],
  },
  {
    key: 'clock-skew-deaths',
    title: '⏱ A slow PC clock stops inventing deaths',
    version: 'Bot 3.1.20 · Web 1.1.18',
    date: '2026-08-06',
    headline: 'Your computer\'s clock stamps every line the parser reads, so an install running a minute slow reported a death a minute late — far enough from everyone else\'s copy of the same death that it counted as a second one.',
    features: [
      { name: '⏱ The clock correction gets spent', blurb: 'The bot has been measuring how far off each install\'s clock is on its regular heartbeat. It now uses that measurement, correcting death times as the upload lands rather than trusting the stamp. Nothing to install and nothing to configure. If your clock is a minute out it is still worth a Windows date & time → "Sync now" — but the parse is right either way now. The original timestamp is kept alongside the corrected one.' },
    ],
    fixes: [
      'A parse could show two deaths where one happened, if any of the raiders reporting it had a clock more than 30 seconds off. One install was over a minute out.',
      'Diabo Xi Va and Diabo Xi Xin were transposed in the boss table, so every kill of one was recorded and shown as the other. Fixed, and the 41 past kills back to January have been relabelled to match.',
      'The raid review counted trash from after the raid broke up — 89 kills last Tuesday, some more than an hour past the final boss. The tally now stops 15 minutes after the last kill.',
    ],
  },
  {
    key: 'thousand-row-cap',
    title: '🔢 Pages were only ever seeing 1,000 rows',
    version: 'Web 1.1.13',
    date: '2026-08-05',
    headline: 'Several pages were quietly working from the first 1,000 records and no further — inventories were cut off, and the era timeline could not see a new main had started raiding.',
    features: [
      { name: '🔢 The whole list, everywhere', blurb: 'Account inventory, the Quartermaster boards and the character era timeline now read every record instead of the first 1,000. Nothing about how you use them changes — the numbers are just right now.' },
    ],
    fixes: [
      'Your account inventory stopped at 1,000 items. Four accounts are over that, the largest by more than double, so those players were missing over half their stuff.',
      'The era timeline named the wrong main. It works out who your main was from raid attendance, but the newest attendance records were exactly the ones being cut off — so a character who became the main recently had every single one of their raids invisible to it, and the page kept showing the previous main.',
      'The Quartermaster "who owns one of these?" boards were answering from about 5% of the guild\'s inventory.',
    ],
  },
  {
    key: 'mimic-231-stable',
    title: '🏷 Mimic 2.3.1 — nameplate tags, and two mobs with one name',
    version: 'Mimic 2.3.1 · Agent 3.5.36',
    date: '2026-08-05',
    headline: 'Everything the beta testers have been running for the last week goes out to everyone: Zeal nameplate tags feed the Extended Target overlay, same-name adds show as separate rows, and the pet tracker stops showing a dead pet\'s buffs.',
    features: [
      { name: '🏷 Tag a mob, see it everywhere', blurb: 'Target an add and use Zeal\'s /tag — the label and its arrow show up on the Extended Target overlay for everyone in the tag channel. The tag carries the mob\'s true identity, which is the one thing the game never tells us otherwise, so it is the most reliable way to tell two identical adds apart. Works over the chat channel, group say or raid say.' },
      { name: '👥 Two mobs with one name show as two mobs', blurb: 'When two same-name adds are tanked apart, they show as separate rows labeled with who is tanking each — and your slows and tashes are credited to the right one. Built for Thall Va Xakra\'s twin adds.' },
      { name: '📡 One Mimic covers the raid', blurb: 'A single raider running Mimic reports every raid member\'s position and every tank the mobs are hitting, so the split works even when the tanks themselves are not running it.' },
      { name: '🩺 The dashboard says whether tags will work', blurb: 'A readiness card reads your Zeal settings and names the exact fix when something is switched on that would quietly stop tags reaching us — including the two that draw the arrow in game while sending nothing at all.' },
    ],
    fixes: [
      'The pet tracker showed a previous pet\'s buffs on a new one. A charmed pet\'s spells stayed filed under the owner, so when the charm broke and a warder was summoned, the warder appeared to be carrying spells it never had — for up to three hours. A new pet now starts clean, and /pet health corrects anything stale.',
      'Tags sent over group say were not picked up at all, which looked exactly like nobody having tagged. Every way Zeal can broadcast a tag is now read, in both chat formats.',
      'The tag readiness check was looking for zeal.ini next to your log files instead of in your EverQuest folder, so it never found anything to report.',
      'Your own group chat is now excluded from the local trigger engine in both of the wordings the game uses, not just one.',
    ],
  },
  {
    key: 'header-one-line',
    title: '🧭 The site header stopped sprawling',
    version: 'Web 1.1.11',
    date: '2026-08-05',
    headline: 'Your name and the Sign out button now sit on the same line as the WolfPack.quest logo, instead of on a row of their own.',
    features: [
      { name: '🧭 Two tidy rows', blurb: 'Logo and your account controls share the top line; the download buttons, search and timezone picker sit on the line below. On a phone the account controls wrap under themselves rather than shoving the logo around.' },
    ],
    fixes: [
      'The logo and the three download buttons were treated as one block, which was too wide to fit beside the account controls — so the browser pushed them onto their own line and the header read as four ragged rows.',
    ],
  },
  {
    key: 'same-name-instance-split-194',
    title: '👥 Two mobs with one name show as two mobs',
    version: 'Bot 3.1.10 · Agent 3.5.30',
    date: '2026-08-05',
    channel: 'beta',
    headline: 'When two same-name adds are tanked apart, the Extended Target overlay now splits them into separate rows — each labeled with who is tanking it — and shows which one your slows and tashes actually landed on. Built for Thall Va Xakra\'s twin adds.',
    features: [
      { name: '👥 The split', blurb: 'The game gives us no mob identity at all — two same-name mobs are pixel-identical in every data stream (we\'ve asked the Zeal team for the one field that would fix this properly; no traction yet). The workaround: a tanked mob stands on its tank, and we DO know where our own people are. Tanks held apart mean separate mobs, and each row is labeled "@ <tank>" so callouts finally have a handle.' },
      { name: '🎯 Debuffs land on the right row', blurb: 'A slow or tash is credited to the add its caster or tank was actually on. When we genuinely can\'t tell — both adds at identical health, nobody placeable — the debuff shows dimmed with a ? on both rows rather than pretending to know.' },
      { name: '📡 One Mimic covers the raid', blurb: 'A single raider running Mimic with Zeal now reports every raid member\'s position and every tank the mobs are hitting — so the feature works even when none of the tanks run Mimic themselves.' },
    ],
    fixes: [
      'Same-name mobs at identical health that are tanked on the same spot still merge into one row — that is the honest limit of the data, and the row says so rather than guessing.',
    ],
  },
  {
    key: 'fun-tunare-zero',
    title: '🌿 Tunare invocations was reading zero',
    version: 'Web 1.1.9',
    date: '2026-08-04',
    headline: 'The Tunare counter showed 0 and sat in the "waiting on data" pile, while 83 invocations were recorded and the most recent was July 31st.',
    features: [
      { name: '🌿 The count is back', blurb: 'Naggato\'s family has 83 Tunare invocations on record. The card had been quietly reporting none of them.' },
    ],
    fixes: [
      'The card fetched its number in a way that returns an error object instead of throwing, and the error was never checked — so "the query did not answer" looked exactly like "nobody has ever mentioned Tunare". A failure now says so instead of showing a zero.',
      'If the fast lookup is ever unavailable, the card falls back to counting directly rather than reporting nothing.',
    ],
  },
  {
    key: 'item-page-nodrop-effects',
    title: '🏷️ NO DROP was showing on the wrong items',
    version: 'Web 1.1.8',
    date: '2026-08-04',
    headline: 'The item pages had the NO DROP tag backwards — it appeared on items you CAN trade, and was missing from the ones you cannot. Worn and combat effects were never shown at all.',
    features: [
      { name: '🏷️ NO DROP is right now', blurb: 'The mirror stores this flag inverted, and three places on the site read it as-is: the item page, the inventory tile border, and the item hover card. So a tradeable item was tagged NO DROP and a genuinely untradeable one showed nothing. If you ever checked the site before passing loot to someone, it told you the opposite of the truth. All three now go through one shared check.' },
      { name: '✨ Worn and combat effects', blurb: 'Item pages only ever showed CLICK effects, so gear whose whole point is a worn or proc effect looked like it had none — the Ancient Burrower Flesh Cap carries Truesight in both and showed neither. 1,560 items gain an effect line, each linking to the spell.' },
      { name: '📊 The full stat block', blurb: 'STR/STA/AGI/DEX/WIS/INT/CHA are now listed alongside AC, HP and mana instead of being dropped.' },
      { name: '📖 LORE ITEM appears again', blurb: 'The tag was reading a column that is empty for every single item, so it could never show. It now uses the marker the game itself uses — 11,148 items are lore and none of them said so.' },
    ],
    fixes: [
      'Lore text no longer prints the internal asterisk marker in front of it.',
      'NO RENT is shown on item pages for the first time.',
    ],
  },
  {
    key: 'mimic-230-quick-setup-save-memory',
    title: '🧹 Quick Setup and Save Memory Update',
    version: 'Mimic 2.3.0 · Agent 3.5.29',
    date: '2026-08-04',
    headline: 'Mimic used to open eleven windows whether you used them or not — around a gigabyte of them. Now it only opens the overlays you actually run, and closes them again when EverQuest is not up. Setup got faster too: the Settings page that used to hang for twenty seconds opens straight away.',
    features: [
      { name: '💾 Only the overlays you use', blurb: 'Every overlay is its own window, and every window costs memory whether it is on screen or not. Mimic now opens one only when you have it switched on, and hands the memory back the moment you switch it off. With EverQuest closed it keeps almost nothing running.' },
      { name: '🙈 Hide-all no longer looks like off', blurb: 'The hide-overlays hotkey used to flip every overlay to OFF, so afterwards you could not tell what you had turned off yourself from what the hotkey was holding. The Overlays page now shows those as HIDDEN, with a note saying how many are coming back. They also reopen with fresh data instead of whatever was frozen on screen before.' },
      { name: '⚡ Settings opens immediately', blurb: 'Hunting for your EverQuest folder could stall Mimic for twenty seconds if you had a network or backup drive attached — it was waiting on a drive that was asleep. Mimic now skips drives that are not local, remembers folders that turned out to be dead ends, and never re-reads a log file it has already identified.' },
      { name: '🛡️ One-click Windows fixes', blurb: 'Buttons on the dashboard and in Settings to add Windows Defender exceptions for your EverQuest and Mimic folders, install or update Zeal, and fix a drifting Windows clock. Each asks for permission once and tells you exactly what it did.' },
      { name: '📊 An honest resource readout', blurb: 'The Resource use window names every process — DPS HUD, Charm tracker, Dashboard — instead of ten identical rows, and explains why its memory figure differs from Task Manager rather than pretending to match. There is a checkbox if you want it to match exactly.' },
    ],
    fixes: [
      'Mimic could track the wrong EverQuest. Every EverQuest client uses the same program name, so a second install — EQLegends, a Live client — counted as yours: overlays over the wrong game, and closing it looked like closing Quarm. Mimic now checks which folder the running game came from.',
      'The Windows Defender and clock buttons reported "cancelled at the permission prompt" even when you had approved it and the fix had worked.',
      'The one-click folder scan no longer hides a second EverQuest install it found.',
      'Beta updates that were ready would not install when you closed EverQuest unless Mimic happened to notice at the right moment.',
      'A raid review could post to the thread again on every redeploy — eleven copies in one night at worst.',
    ],
  },
  {
    key: 'dead-triggers-190',
    title: '🔇 37 callouts that were never going to fire',
    version: 'Web 1.1.4',
    date: '2026-08-04',
    headline: 'A third of our enabled triggers cannot match a log line, and never could — including the Feeblemind and Shadow Poison callouts added this week. They were all switched on, which is exactly why nobody noticed.',
    features: [
      { name: '🔇 What went wrong', blurb: 'A trigger pattern is matched against the whole log line, and every line starts with its timestamp. So a pattern beginning with ^ — meaning "the message starts with this" — was actually asking the TIMESTAMP to start with it. 37 of our 109 live triggers are written that way: every slow-landed callout, Enrage, Cripple, Malo, Death Touch RIP, and the new Vex Thal ones.' },
      { name: '🛡️ It cannot happen again', blurb: 'The officer trigger form now corrects a leading ^ when you save, and explains why. Every existing trigger with the problem carries a warning on its row telling you that re-saving fixes it.' },
      { name: '⏳ Not switched on yet — on purpose', blurb: 'Un-deadening 37 callouts at once, the day before a Vex Thal night, could be a wall of voice lines mid-fight. Six different slow-landed callouts firing on every single pull is the obvious risk. The fix is staged so the boss mechanics can go first and the noisy family can wait for a verdict.' },
    ],
    fixes: [
      'The "D.I. fired on <tank>" trigger was matching text that does not exist in the game — three phrasings, none of them the real one. It has been enabled and silent this whole time.',
    ],
  },
  {
    key: 'what-counts-as-a-death',
    title: '💀 What counts as a death',
    version: 'Bot 3.1.7 · Web 1.1.2',
    date: '2026-08-04',
    headline: 'A Shadow Knight feigning read as a Shadow Knight dying, and 44% of every death we have stored came from the only two classes that can feign. Fixing that pulled a thread through the death list, the trash tally, the cure queue and the raid review.',
    features: [
      { name: '💀 Feign death is no longer a death', blurb: 'Feign Death and Death Peace print "Soandso dies." — and we counted every one. One Shadow Knight shows 63 deaths in a single fight. Between them, Shadow Knights and Necromancers account for 44% of every death row we hold, which is the size of the suspect pile rather than a count of fakes — those classes do really die too. New parses are clean.' },
      { name: '💊 Shadow Poison now reaches the cure queue', blurb: 'It has been landing on us 324 times a week and never once showed up as curable, because the spell was stored without an id. It carries 5 poison counters, so one weak cure will not strip it. A callout now names who to cure, and 28,000 other landings got their ids back at the same time.' },
      { name: '🧟 Trash cleared counts only the raid', blurb: 'Last review said 967 mobs and 9h22m of combat for a 1h48m raid — it was counting everything anyone killed that day, including lunchtime XP groups. Now gated to actual raid hours, so expect a much smaller and much truer number.' },
      { name: '🗓️ Every fight knows its raid night', blurb: '193 raid nights reconstructed from our own history and 1,022 encounters linked to them. "Which raid was this?" used to be a guess based on timestamps; now it is a fact.' },
      { name: '📣 New callouts', blurb: 'Feeblemind on the Overfiend with a 30-second countdown and an OUT call at 26 seconds. Shadow Poison naming who needs the cure. Wave of Death for the Ssra serpents — the one that stuns and feigns half the raid and never appeared in a log we read.' },
    ],
    fixes: [
      'Three machines are running behind everyone else — the worst by nearly a minute — which split single deaths into two on the parse page. Those clocks are now measured continuously (correcting the stored timestamps with them is designed and queued), and Mimic warns you if your own clock is off.',
      'Deaths from a daytime XP group could land on a raid parse, because encounters merge within a 30-minute window.',
      'A pending Zeal update now shows in Mimic Mail on the dashboard, not just as a toast you probably missed.',
      'The golden-log parser suite contained no "died." line at all, which is why the feign bug survived a regression net for a month. It does now.',
    ],
  },
  {
    key: 'beta-agent-3-5-15',
    title: '🚑 Beta testers: update again, the agent was not starting',
    version: 'Agent 3.5.15',
    date: '2026-08-04',
    channel: 'beta',
    headline: 'Every beta build from yesterday crashed the log agent at startup. If you updated Tuesday and Mimic looked fine but nothing was uploading, this is why. Stable was never affected.',
    features: [
      { name: '🚑 The agent starts again', blurb: 'A rename in the threat-snapshot code left one stale reference behind, in a line that runs the moment the agent begins watching your logs. It printed "ready" and then quit. Six beta builds shipped that way in a day. Update to 3.5.15 and it is gone.' },
      { name: '🧪 Beta now has the same tests main does', blurb: 'This is the embarrassing part: the beta branch had no automated checks at all. Two of them claimed to cover it and neither ever ran once. Beta is where every Mimic and agent change lands, so it was the branch that needed them most. They run now — and caught this on the first try.' },
      { name: '🏃 A test that just starts the agent', blurb: 'Nothing we ran had ever actually launched it. The suites all loaded the code and called pieces of it, which cannot notice that the program does not run. Now something starts it for real every time, and there is a second test that breaks it on purpose to prove the first one would notice.' },
    ],
    fixes: [
      'Feigning also cancelled countdown timers aimed at you and wiped your tracked buffs — the same "dies." mixup as yesterday, in a second place that the first fix missed.',
    ],
  },
  {
    key: 'mimic-2-3-0-beta',
    title: '🔄 Mimic 2.3.0 — it updates itself now',
    version: 'Mimic 2.3.0 · Agent 3.5.13',
    date: '2026-08-04',
    channel: 'beta',
    headline: 'People kept turning up to raid on old builds without realising it. Mimic was downloading updates fine — it was just waiting for you to quit, and nobody quits Mimic.',
    features: [
      { name: '🔄 Updates install when you close EverQuest', blurb: 'The safest possible moment: you are provably not raiding. If you relaunch within 15 seconds it defers and catches you next time. Meanwhile it nags once an hour via a Windows notification that cannot steal focus from the game — and it asks nothing of you, because there is nothing to do.' },
      { name: '📊 Resource use, measured not promised', blurb: 'Settings now shows live CPU and memory for every Mimic process on YOUR machine with YOUR overlays. Close EQ and watch it settle. If it does not settle on your box, that is a real finding and we want to hear it.' },
      { name: '😴 Quieter when you are not playing', blurb: 'Mimic checked whether EverQuest was running every 10 seconds forever — about 8,600 process spawns a day on an idle desktop. Now 45 seconds once the game has been closed a minute: 76% fewer. Everything else already idled properly.' },
      { name: '🐌 Sha\'s Advantage reads as a slow', blurb: 'Beastlord slow now shows BST SLOW 50% on the target instead of sitting in the debuff list unrecognised. Tigir\'s Insects had the same gap and never raised the badge at all.' },
    ],
    fixes: [
      'If someone had played on your computer, the CH chain would call THEIR slot number at you forever — a leftover log file made them permanently "you".',
      'CH callouts written with brackets, like "004 CH < Dongru >", never registered a heal target on anybody\'s client.',
      'Zeal occasionally reports a negative HP percent, which could make the off-heal list rank a dead target above a genuinely hurt raider.',
      'Per-fight damage curves are sampled every 6 seconds instead of 18, and officers can change that mid-raid without a release.',
    ],
  },
  {
    key: 'raid-review-2-ddr-boogaloo',
    title: '🎉 Raid Review 2: Plus CH Chain DDR Boogaloo',
    version: 'Bot 3.1.0 · Web 1.1.0 · Mimic 2.2.0 · Agent 3.5.0',
    date: '2026-08-02',
    headline: 'The big one. The raid review now writes itself while you raid, every boss has a guide page built from our own kills, and the CH Chain grades your timing DDR-style — that last one finally graduating from beta to everybody.',
    features: [
      { name: '📡 Live Raid Night Review', blurb: 'A card appears in the night\'s thread on the first pull and grows all raid — kills as they land, what\'s in progress, how long since the last one, and whether we\'re ahead of a typical night. At 00:45 it becomes the finished writeup: standouts measured against our own history, loot, attendance including who left early, and deaths by fight.' },
      { name: '🕺 CH Chain DDR — now for everyone', blurb: 'Call your number within a quarter second of the beat and PERFECT flashes on your bar; three in a row is MARVELOUS. Half a second GREAT, inside a second GOOD. Plus the 10-second cast bar with a red ✕ when someone gets interrupted. Beta-tested, now stable.' },
      { name: '📖 The Raid Guide', blurb: 'Every boss we have parses for — 99 of them — has a page built from our own kills: typical duration, raid size, what has killed us there, and which callouts fire on that fight. Nobody wrote a word of it.' },
      { name: '🧟 Trash counts + fight timelines', blurb: 'Non-boss kills are tallied now, and each fight carries the timeline view from the parse pages. Heads up: trash has never been stored before, so those totals start from tonight.' },
      { name: '🛡️ Officer console + smart backfill', blurb: 'One screen that says whether anything is wrong, with twelve runbooks next to it. And when someone\'s upload claims more damage than the mob actually has, /backfillscan names the two or three raiders whose logs would settle it.' },
      { name: '⚔ Swarm mob counter', blurb: 'The Melody overlay shows how many mobs your last song pulse hit, out of Quarm\'s 12-target cap — green at a perfect swarm.' },
    ],
    fixes: [
      'Damage shields were permanently labelled "non-melee" instead of naming the spell — the log line that names them was discarded before it was ever read.',
      'Charm sessions have always uploaded with a blank duration; they now record real time.',
      'Critical heals from other players, and critical spell damage, were both discarded before parsing.',
      'Mob Info could show a boss as a level-1 dummy immune to everything; it now merges the real variants of a same-named mob and shows whether it roots or flees.',
      'Charm-pet damage no longer sprays across everyone who ever charmed that mob name — it goes to whoever is actually charming it in that fight.',
      'The pace comparison counted weeknight six-mans as raids, so an ordinary night read as far ahead of pace.',
    ],
  },
  {
    key: 'live-raid-review',
    title: '📡 The raid review writes itself while you raid',
    version: 'Bot 3.0.248 · Web 1.0.291 · Agent 3.4.44',
    date: '2026-08-02',
    headline: 'The Raid Night Review no longer waits for the morning after — the card appears on the night\'s first pull and grows all raid, then becomes the final writeup at 00:45. It also counts trash now, and shows a timeline of each fight.',
    features: [
      { name: '📡 Live during the raid', blurb: 'One card in the night\'s thread, updated as kills land (edits, so it never pings you). Shows what is in progress, how long since the last kill, and whether the night is running ahead of or behind a typical raid.' },
      { name: '🧟 Trash counts too', blurb: 'Non-boss kills are now tallied — how many, how much damage, and where. Heads up: nothing outside our tracked boss list has ever been stored, so these totals start from the first raid this ships for; there is no history to backfill.' },
      { name: '📈 Fight timelines', blurb: 'The per-fight timeline from the parse pages now appears on the review — deaths, slows, mob heals and disc usage laid out along each kill, with a compact version in Discord that links to the full one.' },
      { name: '🔎 Bad-parse detection', blurb: 'When one person\'s upload claims more damage than the mob actually has, officers can run /backfillscan — it finds the fights whose numbers are wrong and names the two or three raiders whose logs would settle it (people who were in melee all fight and did not die).' },
    ],
    fixes: [
      'Damage shields were permanently labelled "non-melee" instead of naming the spell — the log line that names them was being discarded before it was read.',
      'Charm sessions have always uploaded with a blank duration; they now record real time.',
      'Critical heals from other players and critical spell damage were both being discarded before parsing.',
      'Mob Info could show a boss as a level-1 dummy immune to everything; it now merges the real variants of a same-named mob.',
      'The night pace comparison counted weeknight six-mans as raids, so an ordinary night looked far ahead of pace.',
    ],
  },
  {
    key: 'overnight-fleet-batch',
    title: '📓 Raid Night Review, a raid guide, and an officer console',
    version: 'Bot 3.0.245 · Web 1.0.290',
    date: '2026-08-02',
    headline: 'Four things built overnight: the morning-after raid writeup now posts itself, every boss we fight got a guide page built from our own kills, officers got one screen that says what is wrong, and mob warnings stopped lying about which mob you are looking at.',
    features: [
      { name: '📓 Raid Night Review', blurb: 'The night after a raid, a writeup lands in that night\'s thread automatically — kills with times, standout parses measured against our own history, loot and DKP, attendance including who left early, and deaths by fight. Officers can also run /raidreview for any date; re-running edits the post instead of spamming a second one.' },
      { name: '📖 The Raid Guide', blurb: 'Every boss we have parses for — 99 of them — now has a page built from our own kills: how long it usually takes, how big a raid we bring, what has killed us there, and which callouts actually fire on that fight. No one had to write a word of it.' },
      { name: '🛡️ Officer console', blurb: 'One screen showing whether anything is wrong right now — with the answer written down next to it. Twelve runbooks for the things that actually go wrong, and the console knows it is 3am on a Tuesday so it does not cry wolf.' },
      { name: '🎯 Mob warnings tell the truth', blurb: 'Mob Info was picking one database row at random for same-named mobs, which is how a boss could show up as a level-1 dummy that is "immune to everything". It now merges the real variants and never warns you off a mob using a placeholder\'s stats.' },
    ],
    fixes: [
      'Charm-pet damage on parses, the Rampage card HP, and the "View in Discord" button all landed earlier this weekend — see the entries below.',
    ],
  },
  {
    key: 'roadmap-votes',
    title: '🗳️ The roadmap is yours now — vote, sort, unblock',
    version: 'Web 1.0.288',
    date: '2026-08-02',
    headline: 'The What\'s-next queue got numbers, a vote button, and a way to hand us exactly the thing an item is stuck on. Open to read without signing in; sign in with Discord to vote or submit.',
    features: [
      { name: '▲ Vote it up', blurb: 'Every queue item has a vote button — tell us what you want built next and sort the whole queue by votes. One vote per member per item, take it back any time.' },
      { name: '🙏 Unblock us', blurb: 'Items stuck on something a member can supply — a verbatim log line, a raid-night observation — say exactly what they need, with a box right on the card. Submissions go straight to the officers\' feedback thread.' },
      { name: '#️⃣ Numbers on everything', blurb: 'Each item carries its tracking number, so "I vote #193" means the same thing on the site, in Discord, and in the dev docs.' },
    ],
    fixes: [],
  },
  {
    key: 'new-member-walkthrough',
    title: '✨ The guided tour — your data, page by page',
    version: 'Web 1.0.286 · Agent 3.4.43',
    date: '2026-08-01',
    headline: 'New (or just curious)? Hit ✨ Tour in the site header or on the Mimic dashboard for a guided clickthrough — one stop per page, spotlighting your own real data: your characters, your parses, your standing. Re-run it any time.',
    features: [
      { name: '🌐 Website walkthrough', blurb: 'Ten stops from Me to the Roadmap — each page spotlit with a plain-language card about what it does for you. Wander off mid-tour and a quiet Resume button waits in the corner; nothing is mocked, every number is yours.' },
      { name: '🐺 Mimic dashboard tour (beta)', blurb: 'Six stops across the dashboard tabs — the Me card, overlays, buffs, fights, triggers, and the privacy controls — on your own live parser data. ✨ Tour button in the nav, offered once automatically on first load.' },
      { name: '🏆 Accomplishment-first', blurb: 'The tour leads with what you\'ve done: your characters, The Scrap standing, the boards your name climbs. (PvP stays out of the way unless you ask to see it.)' },
    ],
    fixes: [],
  },
  {
    key: 'charm-attribution-fix',
    title: '🐾 Charm pets stop lying on the parse',
    version: 'Bot 3.0.241 · Agent 3.4.42',
    date: '2026-07-31',
    headline: 'Thursday\'s Blood of Ssraeshza parse credited huge pet damage to raiders who were mezzing, dead, or in another zone — charm-cycled same-named mobs were spraying damage across everyone who ever charmed that name. Fixed end to end, and the bad parses are repaired.',
    features: [
      { name: '⚖️ Fair charm credit', blurb: 'A charm pet\'s damage now goes to the raiders actively charming that mob name in that fight — split equally when several run same-named pets at once — never to the whole night\'s history of past charmers. (Same-named mobs still can\'t be told apart individually; that needs a Zeal update we\'ve drafted the request for.)' },
      { name: '🐾 Charmed on parse cards', blurb: 'Parse cards list each charmed mob\'s damage and who it split across, so pet credit is visible instead of hidden inside someone\'s total.' },
      { name: '🖥️ Honest DPS meter (beta)', blurb: 'The live meter labels a charm pet with its proven current charmer — or just "(charmed)" when it can\'t prove one — instead of pinning every same-named pet on one person.' },
    ],
    fixes: [
      'Thursday\'s corrupted parses (Blood of Ssraeshza and two more) were repaired: phantom players removed, totals back under the boss\'s actual HP.',
      'The "View in Discord" button on parse pages now opens the readable parse card (and tries your Discord app first) instead of the machine-format log.',
    ],
  },
  {
    key: 'ch-ddr-damage-alert',
    title: '🎯 The CH chain gets a cast bar (and grades your timing)',
    version: 'Agent 3.4.40',
    date: '2026-07-31',
    channel: 'beta',
    headline: 'Raider requests, all in this beta round: the CH Chain overlay shows each cleric\'s 10-second cast as it happens — with a red ✕ if they get interrupted — and grades your chain timing DDR-style. Swarm bards get a mob counter on the Melody overlay. Plus an opt-in audio alert the moment you start taking hits.',
    features: [
      { name: '⚔ Swarm mob counter', blurb: 'The Melody overlay now shows how many mobs your last song pulse actually hit, right next to the song name — like ⚔ 11/12. Songs cap at 12 targets on Quarm (extras warp onto you instead), so the chip turns green at a perfect 12-mob swarm. Damaging songs show the pulse\'s damage too, with per-mob detail on hover.' },
      { name: '⏳ CH cast bar', blurb: 'When a chain number is called, that cleric\'s bar starts a 10-second cast countdown so everyone can see the heal in flight. If the cast gets interrupted, a red ✕ appears on the bar. (No ✕ doesn\'t always mean safe — interrupt messages only carry so far in-game.)' },
      { name: '🕺 DDR timing grades', blurb: 'Call your number within a quarter second of the beat and PERFECT flashes on your bar — three in a row earns MARVELOUS. Half a second is GREAT, inside a second is GOOD. Purely visual fun on the overlay (nothing spoken), with a 🎯 button to turn it off.' },
      { name: '🔔 Damage-taken alert', blurb: 'An optional audio ping the moment something starts hitting you — for when you\'re watching chat, not your health bar. Off by default; flip it from the Mimic tray menu or its hotkey (Ctrl+Shift+D, rebindable in the dashboard).' },
    ],
    fixes: [],
  },
  {
    key: 'event-driven-night-threads',
    title: '📅 Night threads follow the calendar',
    version: 'Bot 3.0.235',
    date: '2026-07-31',
    headline: 'The per-night Discord thread now knows your schedule: raid nights land in #raid-chat, scheduled off-night events get their own thread in #event-chat with roll loot instead of DKP — driven by the server\'s Discord events, no setup required.',
    features: [
      { name: '🗓️ Event-driven windows', blurb: 'The thread opens for posting 30 minutes before an event\'s scheduled start and closes 15 minutes after its end. Your Discord events (the same ones /announce creates) drive it.' },
      { name: '🎲 Off-night roll loot', blurb: 'Event threads show each dropped item with its assigned roll range and the winner — the /random flow the guild already uses — instead of DKP bidding posts.' },
      { name: '🔇 Less trash spam', blurb: 'Named bosses always post to the thread; one-second trash skirmishes no longer flood it.' },
    ],
    fixes: [
      '/onboarding works again for long-absent members — the "what\'s new" list overflowed Discord\'s message limit and errored for most people who ever used it.',
      'The night thread now opens in #raid-chat as intended (it was falling back to #raid-mobs).',
    ],
  },
  {
    key: 'raidnight-fleet-batch',
    title: '🐺 The raid-night batch — cures, night threads, and nine fixes in one evening',
    version: 'Bot 3.0.233 · Agent 3.4.38',
    date: '2026-07-31',
    headline: 'Everything Thursday\'s raid surfaced, fixed the same night: cured raiders finally leave the debuff queue, each raid night gets its own Discord thread with the parses and loot in it, charm pets show up on parses, and the callouts that were firing late or never now fire on time.',
    features: [
      { name: '🧪 Cures count now', blurb: 'When a cleric running Mimic cures someone, the whole raid\'s Buff Queue knows — even if the cured player doesn\'t run Mimic. Cures spend their real counter values, so one Remove Greater Curse clears a 9-counter curse but only dents a 72-counter Gravel Rain, which now shows what\'s left instead of lying.' },
      { name: '🧵 Raid-night threads', blurb: 'Each raid night gets its own Discord thread, named the way /raidnight names things. The auto-parse cards and the night\'s loot posts land there — and every loot post links straight to the OpenDKP auctions page.' },
      { name: '🐾 Charm pets on parses', blurb: 'Charmed pets\' damage now reaches the uploaded parse and credits the charmer — it was rendering on the local meter and then being thrown away on upload. Distinct pets stay distinct instead of collapsing into one "so-and-so\'s pet".' },
      { name: '📣 Callouts on time', blurb: 'Vyzh\`dra\'s melee dance now actually calls MELEE OUT / MELEE IN off the AE that really lands (Dragon Roar). The Emperor\'s "Paladin DA NOW" fires at 2:00 on the true 2:10 cycle. And the phantom "Eye of so-and-so" rows are gone from the DPS meter.' },
    ],
    fixes: [
      'The Rampage card can no longer show a bogus HP pair for the victim — a Zeal weight reading (130/180) was slipping through as health. Real numbers when we have them, a plain % when we don\'t.',
      'Off-tank surfacing on Extended Target had been silently reading empty data since early July — the agent was sending it, the server was dropping it. Reconnected.',
      'A false "Death touch" callout from a Cleric hammer pet self-destructing is fixed, and the Emperor tank-buster countdown no longer risks double-firing.',
    ],
  },
  {
    key: 'wpqdi-item-npc-spell',
    title: '📚 Our own item/mob/spell database — on wolfpack.quest',
    version: 'Web 1.0.273',
    date: '2026-07-30',
    headline: 'PQDI has been down a lot lately, so we started building our own copy of it here — powered by the same game data we already sync every week. Items, mobs and spells are live now.',
    features: [
      { name: '🗡️ Item pages', blurb: 'Full stat block (slot, class/race, resists, damage/delay, clicky, weight and value) plus the two things you actually open a database for: everything that drops it, with drop chance and zone, and every merchant zone that sells it.' },
      { name: '🐉 Mob pages', blurb: 'Level, HP, AC, resists, damage range and special abilities (enrage, rampage, summon, unslowable, immunities), the full loot table, the spells it can cast — and where it spawns, with zone, coordinates, respawn timer and placeholder chance. There is also a link straight to our own kill history for that mob.' },
      { name: '✨ Spell pages', blurb: 'Effects, resist type, target, duration, cast and recast times, plus the exact log messages a spell writes — handy when you are building a trigger.' },
      { name: '🔗 A "(WP)" link next to every PQDI link', blurb: 'Anywhere the site used to send you off to pqdi.cc — search results, loot lists, your inventory and gear, the parse pages, faction standings — there is now a small (WP) link beside it that opens our copy instead. The PQDI link stays put, so nothing you are used to disappears.' },
      { name: '🤝 Faction pages', blurb: 'Every faction now has its own page: what your starting standing is by race, class and deity, which mobs con on it, and — the useful part — which quest turn-ins raise or lower it, with the exact numbers. Reachable from any mob page and from your own faction standings.' },
      { name: '📜 Quest turn-ins', blurb: 'Item pages now answer "what is this for?" — what you hand it to and what you get back, and in reverse, which turn-in hands it out. Mob pages list every turn-in that NPC accepts. Read straight from the server\'s own quest scripts, so it covers far more than a hand-maintained list ever would.' },
      { name: '🔎 Searchable, and in the nav', blurb: 'New 📚 Database tab with its own search — type an item, mob or spell name and go straight to it. The header search box (⌘K) now finds mobs too, and its item/spell results open our pages instead of bouncing you to pqdi.cc.' },
    ],
    fixes: [
      'Character pages load dramatically faster. Looking up a character was scanning the entire /who sighting history (over a hundred thousand rows) on every single page load just to read a level and guild tag — that alone was several seconds per visit, and it is now an indexed lookup.',
    ],
  },
  {
    key: 'agent-3435-field-fixes',
    title: '🩹 Agent 3.4.35 — slows, the DPS meter, and charm breaks',
    version: 'Agent 3.4.35',
    date: '2026-07-30',
    channel: 'beta',
    headline: 'Three things the raid reported this week, all fixed: shaman slows finally show up on the target, the DPS meter stops clinging to a mob you killed ages ago, and charm breaks announce again.',
    features: [
      { name: '🐌 Shaman slows show on the target', blurb: 'Turgur\'s, Togor\'s, Tagar\'s, Tigir\'s, Drowsy, Walking Sleep — the whole shaman line now appears on Target Info and the slow badge, for everyone, not just the shaman who cast it. Enchanter slows were showing all along because they announce themselves plainly ("<mob> slows down"), while every shaman slow lands as a bare "<mob> yawns" — a line eleven different spells share. That ambiguity was getting the entire family discarded before it ever reached the overlay.' },
    ],
    fixes: [
      'The DPS meter no longer sits on a mob you fought ages ago. A finished fight now clears itself whether or not you\'re still swinging at something — before, it only expired while you were actively in combat, so the last mob of the night could stay on screen indefinitely.',
      'Charm breaks announce again when the charm was picked up from Zeal rather than from your log. In that case the "Your charm spell has worn off" line was being thrown away, so the tracker never noticed the break and never spoke.',
      'The Charm diagnostic card no longer prints an internal note in the middle of its explanation.',
    ],
  },
  {
    key: 'mimic-21-pqdi-spellsets',
    title: '🐺 Mimic 2.1 — PQDI link + one-shot spell-set swap',
    version: 'Mimic 2.1 · Agent 3.4.34',
    date: '2026-07-25',
    headline: 'Two raider-requested wins graduate to stable: pull up any mob\'s PQDI page straight from the Target Info overlay, and swap a song or spell across every one of your saved spell sets in a single step.',
    features: [
      { name: '🔗 PQDI link on Target Info', blurb: 'The Target Info overlay now carries a PQDI link. Tap it and that mob\'s full PQDI page — drops, spawn details, resists — opens in your browser, so you can check what it drops or how it resists without alt-tabbing out to search for it mid-fight.' },
      { name: '🎵 Spell sets: swap once, done everywhere', blurb: 'UI Studio can now replace a song or spell across all of your saved spell sets at once. Got an upgrade that belongs in every set? Pick the old spell (shown by name and ID), pick the new one, and apply — the change lands in every named set, with a backup written first. No more opening and editing each set by hand.' },
    ],
    fixes: [],
  },
  {
    key: 'mimic-204-raid-clarity',
    title: '🐺 Mimic 2.0.4 — the raid-clarity release',
    version: 'Mimic 2.0.4 · Agent 3.4.17 · Web 1.0.269',
    date: '2026-07-23',
    headline: 'Twelve items, one day, all from the field-report queue: everything the Wednesday raid surfaced plus the most-requested overlay upgrades — targeting info that keeps up with the fight, slow timers, AoE dance callouts, and a pile of quality-of-life fixes.',
    features: [
      { name: '🎯 Extended Target V2', blurb: 'Every mob row can now show who the mob is beating on (→ Hawkner), the raid\'s observed DPS into it, and a time-to-live estimate that only appears when the HP trend is real — never a garbage guess. Same-name mobs get honest bookkeeping under the hood (deaths + HP continuity), so a fresh "a temple guard" no longer inherits the last one\'s debuffs.' },
      { name: '🐌 Slow status on the target', blurb: 'Target Info shows an amber badge when your target is slowed — spell, %, caster when known, and a countdown. Slows don\'t stack, so it always shows the STRONGEST active slow (a weaker cast can\'t hide a better one), with "Slowed" / "Slow dropped — reslow" callouts for your current target. Magnitudes are pulled from the server data, not guessed.' },
      { name: '🏃 AoE dance callouts', blurb: 'First target: Vyzh`dra the Cursed\'s Caustic Mist. When the AE fires you hear "DPS IN" and a countdown arms to the next one, warning "DPS OUT" just before it — same machinery as the Emperor tank-buster timer, and it re-syncs on every observed AE.' },
      { name: '⚡ Target HP that keeps up', blurb: 'Your own target\'s HP now reads straight from the Zeal gauge — about half a second from game to overlay, down from several seconds when it detoured through the server aggregate.' },
      { name: '📋 One-click "Post to /rs"', blurb: 'A copy button on the DPS meter builds the parse line the guild recognizes (top 10 + total) — click, paste in /rs, done. The bot can re-ingest the pasted line, so posted parses still count.' },
      { name: '🧭 Command Center & Buff queue QoL', blurb: 'Cure/curse alert lines get a per-line ✕ and a clear-all; DI availability compacts into chips beside HEALER MANA; and dismissing a buff-queue item now removes just that row instead of collapsing the whole overlay mid-raid.' },
    ],
    fixes: [
      'The /who overlay no longer freezes after setting an anonymous player\'s class (the dropdown kept keyboard focus and quietly paused updates forever).',
      'Charm pets now appear in the Pet tracker on a brand-new Mimic install — no history required.',
      'Parse cards in Discord link to the wolfpack.quest parse page, and the parse page links back to Discord.',
      'Raid Night Review: deaths no longer double-count across overlapping fights, pet deaths fold into a one-line summary, and slows/mechanics only show the actual raid window.',
    ],
  },
  {
    key: 'raid-night-review',
    title: '📓 Raid Night Review — the morning-after page',
    version: 'Web 1.0.266',
    date: '2026-07-23',
    headline: 'The ask was simple: "let us review the raid at 9am, not 11:30pm." A new /raid/review page gives you exactly that — open it the morning after and one page shows what happened last night, no Discord scrolling.',
    features: [
      { name: 'One night, one page', blurb: 'From the live Raid view (or /raid/review) pick a night and see it laid out in the order it happened: the kills timeline (boss, time, duration, damage, with wipe/engaged markers), who died and on which boss, which slows landed and when, the callouts that fired (Death Touch included), and that night\'s loot with winners and DKP. Every section only shows up when there\'s something to show, so an empty night stays tidy instead of erroring.' },
      { name: 'The same numbers as the parse page', blurb: 'Death counts use the exact cross-parser dedup the parse pages already use — no new, disagreeing count — and foreign (pugging-another-guild) raids are hidden the same way /parses hides them. It reads only; nothing here changes any record.' },
    ],
    fixes: [],
  },
  {
    key: 'mimic-201-setup-replay',
    title: '🐺 Mimic 2.0.1 — one-click EQ setup + fight replay',
    version: 'Mimic 2.0.1 · Agent 3.4.1',
    date: '2026-07-20',
    headline: 'A small stable follow-up to Harmonic Howl: get a new machine logging and Zeal-ready in one click, and replay a past fight through your triggers to test them without waiting for the boss.',
    features: [
      { name: '🔧 “Set up EQ for me” now on the Settings page', blurb: 'The one-click configurator that turns on logging (eqclient.ini) and Zeal export/verbose (zeal.ini) across every EQ folder is now on the Mimic Settings page too, not just the dashboard — close EQ, click once, done. Perfect for getting a brand-new raider ready in seconds.' },
      { name: '⏪ Replay a fight through your triggers', blurb: 'A new Replay card (Triggers tab) walks any slice of your logs back through the real trigger engine — you hear the actual callouts, marked as a replay, with nothing uploaded and cooldowns left alone. It won’t run during a live fight. Every parse page also gets a “Replay this fight locally” link that pre-fills the time window. Great for proving a trigger works before it matters.' },
    ],
    fixes: [],
  },
  {
    key: 'quartermaster-v1',
    title: '🧰 Quartermaster — who has the gear that keeps a raid moving',
    version: 'Web 1.0.260 · Agent 3.4.1',
    date: '2026-07-20',
    headline: 'A new member-visible /quartermaster page answers the two logistics questions that always turn into a /gu spam: "does anyone have X?" and "how far along is everyone on the key quests?" — at a glance, for the whole guild. Plus: replay a past fight through your own trigger callouts to hear how they would have sounded.',
    features: [
      { name: 'Utility-kit coverage', blurb: 'One board shows who owns the raid movers — Puppet Strings, a Cleric disease-cure shield, resist-buff rings, a Divine Aura panic button, mana batteries, JBoots, lev cloaks and more — with an owner count, the owners, and a plain-English gap line when a slot is thin ("No Cleric owns Shield of the Immaculate"). It reads your worn + bag gear only; the bank is stripped before upload, so a blank means "not seen", not "nobody has it".' },
      { name: 'Common-quest checklist', blurb: 'The other board tracks the guild\'s recurring chains (keys, VT shards, Coldain shawl, giant turn-ins, and a seeded Emperor Ssraeshza key) as a per-character checklist off the officer quest catalog — your own characters up top, and for officers a "who\'s missing what" rollup. Steps we can\'t see (already turned in, or a hail/flag) show as — rather than a false red. Opted-out characters never appear.' },
      { name: '⏪ Replay a fight through your triggers (Mimic)', blurb: 'Every parse page now has a "⏪ Replay this fight locally" link, and Mimic\'s Triggers tab has a matching ⏪ Replay card. Point it at one of your logs and a time window (the parse link prefills the fight for you) and Mimic walks those lines back through your real trigger engine — pattern, cooldown, suppression and all — and speaks the actual callouts, at real-time pace or a quick fast audit. It is a rehearsal end to end: every fire is tagged ⏪, nothing uploads or relays, and your live cooldowns are never touched, so it is safe to run any time except mid-fight (it politely refuses then). Perfect for testing that a new TTS callout sounds right before raid night. Needs the Mimic agent 3.4.1 update; the whole thing runs on your machine, against your logs.' },
    ],
    fixes: [],
  },
  {
    key: 'mimic-20-harmonic-howl',
    title: '🐺 Mimic 2.0 — "Harmonic Howl" · the whole pack, in voice and in tune',
    version: 'Mimic 2.0.0 · Agent 3.4.0',
    date: '2026-07-20',
    headline: 'The biggest release we\'ve ever cut, now stable for everyone as a normal auto-update. The name says it: the HOWL is Mimic learning to speak — callouts that prove they played, the CH chain calling your GO, loot announced with a bid clock — and the HARMONY is the pack acting as one: reporter elections, clean handoffs when someone camps, and officer kill switches keeping it all in tune. Everything below in the 1.9.6 beta entry is what\'s inside; if you were on beta, you\'ve been living it all week.',
    features: [
      { name: 'Why "2.0"', blurb: 'One number for one idea: this line crossed from "overlays that show you things" to a platform that talks, listens, and protects itself. Full feature detail is in the beta entry just below — wins, fixes, and all.' },
      { name: 'If you\'re on stable', blurb: 'Just accept the update. Everything arrives configured with sane defaults; anything spoken has an obvious toggle right where you\'d look for it.' },
    ],
    fixes: [],
  },
  {
    key: 'callout-trust-and-ch-go-196',
    title: '📣 Callouts you can trust — and the CH chain speaks your GO · Mimic 1.9.6 (beta)',
    version: 'Mimic 1.9.6 beta · Agent 3.4.4 · Bot 3.0.226',
    date: '2026-07-22',
    channel: 'beta',
    headline: 'This beta round makes the callouts you rely on impossible to miss — and impossible to silently lose — plus one thing clerics asked for: the CH chain says your number out loud when it’s your turn. And you can now place your loot bids right from Mimic. The dashboard also got a facelift: your character is front and center, and officers get a dedicated quick menu. Newest for raid night: a self-running Emperor tank-buster clock, and MEZ / SLOW badges on your Extended Target.',
    features: [
      { name: '⏱ The Emperor tank-buster clock runs itself', blurb: 'For the Emperor Ssraeshza fight, Mimic now keeps the tank-buster clock for you straight off your combat log — no setup, and it works for every raider whether or not they run Zeal. When Blood of Ssraeshza dies it starts a 2:00 countdown to the Emperor’s spawn and calls “Paladin DA NOW” ten seconds out, so the DA lands right on the spawn buster. When a buster actually hits — its telltale ~4000 non-melee hit — it calls “TANK BUSTER” and re-arms a 60-second countdown to the next one (a repeat hit just resets the same bar, it never stacks a second one). And the instant the Emperor dies the countdown clears itself, so there’s no phantom “next buster” ticking on a corpse. The re-arm and clear-on-death are built to be reused, so more boss timers can plug into it over time.' },
      { name: '🟣 MEZ / 🟠 SLOW badges on the Extended Target', blurb: 'The Extended Target overlay now shows a bright pill right next to a mob’s name when it’s mesmerized (purple MEZ) or slowed (amber SLOW) — read straight from the debuffs already on that mob, so at a glance you can see which adds are locked down and which still need a slow. If a mob is both, you see both, and a badge disappears the moment its debuff falls off.' },
      { name: '🐺 Your character, front and center', blurb: 'The Mimic dashboard opens on a new 🐺 Me card instead of the engine-status wall. It shows the character you’re playing and where they are, a quick line of your buffs, the other characters Mimic is watching, your last few tells (which never leave your PC), and your last few fights with a jump to the parse — plus one big button to your full wolfpack.quest/me page. The sync/plumbing details (files being read, upload queue, session counts) are still there, just tucked into a collapsed “⚙ Engine” section right below.' },
      { name: '🛡 An officer quick menu', blurb: 'Officers get a dedicated 🛡 Admin tab in the dashboard that gathers the officer tools that used to be scattered around — DKP ticks, loot capture, “Post for bidding” — into one place for quick changes during a raid, with fast links to the wolfpack.quest admin pages (overlay kill switches, triggers, encounters). Only officers see the tab or anything in it.' },
      { name: '💰 Place your loot bids from Mimic (BETA)', blurb: 'There’s a new 💰 Loot bidding card on the dashboard. Log into your OpenDKP account once (it stays on your PC, never uploaded) and every open auction shows up — what an officer just called in chat and the real OpenDKP auctions both — with the item’s last winner and runner-up right there. Type a bid and send it (sealed, same as always), or hit “+1” to pre-fill last time’s runner-up plus one and bid that. Set your main and alts once, then pick who you’re bidding as. When you’re logged in it also shows your own recent wins and a wishlist built from what you’ve bid on before. Until you log in, bidding stays locked — it’s BETA, so tell us what’s rough.' },
      { name: '💰 Loot bidding v2 — a misses table, your DKP, and no more dead links', blurb: 'The Loot bidding card grew up. It now shows a full-width Recent misses table — every item you bid on and lost — with who bid, your last bid, that item’s most-recent winning and second-place bids, an editable “planned next bid” you can jot down (saved on your PC), and your current DKP right there. Your wishlist now hides anything you’ve already won (preregs still show with a ★), item names link to the right OpenDKP page instead of dead-ending on a 404, and the first time you log in your family — main plus raid alts — fills in for you automatically. A new expansion filter narrows every list to Classic / Kunark / Velious / Luclin. The DKP figure is pooled across your linked characters (that’s the balance you actually bid against) and read from our OpenDKP mirror, so treat it as “as of the last sync,” not to-the-second. Still BETA — tell us if a number looks off.' },
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
      { name: '🎲 Roll nights — and who actually looted', blurb: 'Off-night loot rolls now have a home. Mimic quietly records the “You have looted” line from your own log — the real answer to who ended up with a no-drop drop, since a re-roll or a pass means the roll winner often isn’t the looter. The new 🎲 Rolls page on wolfpack.quest lays out each roll night: every session with its range, who rolled, the winning roll, and the person who actually looted it shown right beside the winner when they differ. Plus 🎲🔥 Hot Dice — a perfect roll gets called out live, and whoever out-rolls the room on more than 20% of the night’s contested rolls takes the night’s Hot Dice crown (also on the Fun page).' },
    ],
    fixes: [
      'Mob Info / Target Info no longer shows a mob from another zone. When you targeted a mob whose name also exists somewhere else — say “a geonid,” which lives in both The Wakening Land and Crystal Caverns — Mimic could pull in the OTHER zone’s version: wrong level and HP, and even debuffs and casts that someone in a completely different zone had landed on their mob. Now everything on the Target Info panel is scoped to YOUR zone — the stats match the mob in front of you, and only spells cast by people in your zone show up. (Two raiders in the SAME zone still share what they see, exactly as before.)',
      'Your DKP on the Loot bidding card now matches OpenDKP exactly. It’s read live from OpenDKP’s own standings — your account’s Current DKP, the same number the OpenDKP site shows — instead of an estimate we rebuilt from our local mirror. The old figure could be well off (one family read −123, and a different recompute 711, when the real balance was 171); now it’s the real number. If OpenDKP can’t be reached for a moment the card falls back to that estimate, clearly marked “~est. (mirror)” so it’s never mistaken for your real balance. Log into OpenDKP on the card to see it.',
      'Trigger voice callouts actually make sound now. On some machines the alert overlay was speaking into the void — you’d see the flash but hear nothing, and Windows’ volume mixer never even listed Mimic. The overlay window is never clicked, and Windows was silently blocking its voice for that reason; Mimic now clears that block on startup so suggested triggers, guild callouts and blind alerts all speak. Rehearse a trigger to confirm — you should hear it, see “Mimic” appear in the volume mixer, and get a green “playback started” line in the new why-didn’t-it-fire panel. If a machine is still silent, that panel now says so out loud instead of pretending everything fired.',
      'The dashboard Triggers tab no longer flickers every couple of seconds — the “recent fires” list was repainting the whole tab on every refresh, which reset the trigger editor mid-type. It updates in place now.',
      'A stray “Not signed in to Discord” banner no longer flashes at people who ARE signed in. It used to blink on for a second every time Mimic restarted (before it re-checked your login); now it waits to be sure, and shows a calm “verifying…” note in the meantime instead of the scary red one.',
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
      { name: 'Fair by default', blurb: 'Only each player’s FIRST roll counts — re-rolls are listed struck through and can never win. Hearing the same roll on two of your own logs counts once.' },
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

export type SprintAspect = 'mimic' | 'agent' | 'bot' | 'web' | 'data' | 'liveops';
export type SprintComplexity = 'S' | 'M' | 'L' | 'XL' | 'design';
export type SprintItem = {
  num: string;          // the board number raiders saw in updates ("#72")
  title: string;
  phase: string;        // grouping — matches the queue's waves/threads
  cx: SprintComplexity;
  aspects: SprintAspect[];
  note: string;         // one plain-language line
};

export const sprintPhases = [
  'Safety & release gates',
  'Wave 2 — survive success',
  'Callout trust',
  'Election field round',
  'Loot & DKP',
  'Rules thread',
  'Member surfaces',
  'Designs — build pending',
] as const;

export const sprintItems: SprintItem[] = [
  { num: 'SEC', title: 'Database RPC lockdown + view hardening', phase: 'Safety & release gates', cx: 'L', aspects: ['data'], note: 'Closed an anonymous data-deletion vector and 21 over-permissive functions; the security advisor now reads clean.' },
  { num: 'LINT', title: 'ESLint no-undef wall + CI gates', phase: 'Safety & release gates', cx: 'M', aspects: ['liveops'], note: 'Caught 2 latent production defects the day it turned on — including the exact bug class behind the Jul 16 raid outage.' },
  { num: 'TEST', title: 'Blocking test suite, 0 → 275 in four days', phase: 'Safety & release gates', cx: 'M', aspects: ['liveops'], note: 'Elections, auth, budgets, parsers, timelines — every push now has to prove itself.' },
  { num: '#72', title: 'Designated-reporter elections (chat · buffs · roster)', phase: 'Wave 2 — survive success', cx: 'XL', aspects: ['bot', 'agent'], note: 'At 60 raiders, 98% of buff uploads were duplicates. Now the bot elects reporters — with camp-out and logout handoff.' },
  { num: '#73', title: 'Admission control + database circuit breaker', phase: 'Wave 2 — survive success', cx: 'L', aspects: ['bot'], note: 'Per-client rate budgets, a fuse on the database, and poison-payload hardening — one bad client can no longer hurt the raid.' },
  { num: '#106', title: 'Six polling loops → one', phase: 'Wave 2 — survive success', cx: 'L', aspects: ['bot', 'agent'], note: 'Every Mimic now asks the server once instead of six times, and boss-kill upload bursts spread themselves out.' },
  { num: '#74', title: 'Control plane: kill switches + version floor + auto-rollback', phase: 'Wave 2 — survive success', cx: 'L', aspects: ['bot', 'agent', 'mimic', 'liveops'], note: 'Officers can pause the fleet, floor old versions, and a crash-looping update rolls itself back.' },
  { num: '#58', title: 'Health-gated zero-downtime deploys', phase: 'Wave 2 — survive success', cx: 'M', aspects: ['bot', 'liveops'], note: 'The server only takes traffic when it is actually ready, and drains cleanly when it restarts.' },
  { num: '#89', title: 'Mimic 1.9.5 graduated to stable', phase: 'Wave 2 — survive success', cx: 'M', aspects: ['liveops'], note: 'The whole 1.9 beta line — heal overlays, fast restarts, officer tools — reached every raider as a normal auto-update.' },
  { num: '#76', title: 'Callout trust: journal, real Rehearse, sticky calls', phase: 'Callout trust', cx: 'L', aspects: ['agent', 'mimic'], note: '"Why didn\'t my trigger fire" is now answerable on the dashboard, and Rehearse drives the REAL pipeline out loud.' },
  { num: '#103', title: 'The CH chain speaks your GO', phase: 'Callout trust', cx: 'S', aspects: ['mimic', 'agent'], note: '"04 GO" in your ear when it\'s your slot — one 📣 button to silence.' },
  { num: '#107', title: 'Loot posts announced + bid-clock chips + self-growing overlay', phase: 'Callout trust', cx: 'M', aspects: ['agent', 'mimic'], note: 'Loot called in chat gets spoken with a countdown like a Death Touch timer; the overlay stopped cutting off its buttons.' },
  { num: '#120', title: 'The silent-TTS root cause', phase: 'Callout trust', cx: 'L', aspects: ['mimic', 'agent'], note: 'Found why some machines never spoke at all (a browser audio gate) — and made Rehearse prove audio end-to-end.' },
  { num: '#116', title: 'Overlay bug round: stale cards + stuck setup frames', phase: 'Callout trust', cx: 'M', aspects: ['mimic', 'agent'], note: 'The frozen "stopped 8m ago" casting card and the setup outline that never went away — both fixture-proven fixes.' },
  { num: '#112', title: 'The chat-blackout fix', phase: 'Election field round', cx: 'M', aspects: ['bot', 'agent'], note: 'Guild chat went dark for 8 hours when a logged-out reporter stayed elected. Reporters now must prove they SEE chat.' },
  { num: '#115', title: 'Officer reporter panel: see, swap, include', phase: 'Election field round', cx: 'M', aspects: ['agent', 'bot'], note: 'The live fleet, who is elected for what, and one-click overrides — in Mimic\'s Admin tab.' },
  { num: '#118', title: 'Kill switches inside Mimic + fleet versions', phase: 'Election field round', cx: 'M', aspects: ['agent', 'bot'], note: 'Every emergency toggle one click away mid-raid, with a typed confirm on the big red one.' },
  { num: '#119', title: 'Liveness across all your characters', phase: 'Election field round', cx: 'M', aspects: ['agent', 'bot'], note: 'Playing an alt counts — the fleet shows "Canopy (Hitya)" and the wolf follows whoever is actually online.' },
  { num: '#108', title: 'Loot bidding from Mimic (BETA)', phase: 'Loot & DKP', cx: 'L', aspects: ['agent', 'bot', 'data'], note: 'Log into OpenDKP once, see open auctions with last-winner context, and place sealed bids without alt-tabbing.' },
  { num: '#121', title: 'Bidding v2: misses table, DKP, auction links', phase: 'Loot & DKP', cx: 'L', aspects: ['agent', 'bot', 'web'], note: 'What you lost, what it went for, what you\'d bid next time, and whether you can afford it — one full-width table.' },
  { num: '#110', title: 'OpenDKP deletions now propagate', phase: 'Loot & DKP', cx: 'M', aspects: ['bot', 'data'], note: 'Deleted a test award in OpenDKP? It leaves wolfpack.quest within one sync instead of haunting the loot page.' },
  { num: '#91', title: 'Roll nights: /rolls page, who-looted, Hot Dice crown', phase: 'Loot & DKP', cx: 'M', aspects: ['agent', 'bot', 'web', 'data'], note: 'Off-night NBG raids get a review page — rolls, who actually looted, and a crown for whoever out-rolled everyone.' },
  { num: '#94', title: 'The rulebook became data', phase: 'Rules thread', cx: 'M', aspects: ['bot', 'web', 'data'], note: '/ingestrules reads the Discord rules channels into a store the platform can consult — one source, no drift.' },
  { num: '#92', title: 'Attendance audit (OpenDKP already had it)', phase: 'Rules thread', cx: 'S', aspects: ['data', 'web'], note: 'One SQL view filled the real gaps: 60-day windows, family rollups, lifetime RA%.' },
  { num: '#95', title: 'Raid Kit readiness (rule 12)', phase: 'Rules thread', cx: 'M', aspects: ['web'], note: 'Your gear page checks the 100 MR floor + utility coverage; officers get the whole-roster board.' },
  { num: '#93', title: 'Comp templates + sign-up gap check', phase: 'Rules thread', cx: 'M', aspects: ['web'], note: '"Need 1 more cleric-archetype healer" — before the raid pulls, from the sign-ups.' },
  { num: '#109', title: 'Mimic dashboard: you first, engine second', phase: 'Member surfaces', cx: 'M', aspects: ['agent'], note: 'A 🐺 Me card replaces the plumbing wall; officers get a dedicated Admin tab.' },
  { num: '#111', title: 'A smarter /who', phase: 'Member surfaces', cx: 'M', aspects: ['agent', 'mimic', 'bot'], note: 'Clean columns, a 🐺 on Mimic runners, mains in parentheses, and levels we know even when someone is anon.' },
  { num: '#113', title: 'Extended Target: same-zone only', phase: 'Member surfaces', cx: 'S', aspects: ['bot', 'agent'], note: 'Splinter groups elsewhere stop polluting your target list — with a toggle if you want them back.' },
  { num: '#117', title: 'Pet buffs + range awareness', phase: 'Member surfaces', cx: 'M', aspects: ['agent', 'bot'], note: 'Pet buffs attribute correctly, and the buff queue flags who was likely out of range.' },
  { num: '#105', title: 'Richer fight timelines', phase: 'Member surfaces', cx: 'M', aspects: ['agent', 'web'], note: 'Slow landed / slow fell off / mob healed itself / discipline used — the wipe post-mortem reads itself.' },
  { num: '#114', title: 'Multi-raid awareness', phase: 'Designs — build pending', cx: 'design', aspects: ['bot', 'agent', 'web'], note: 'Two raids at once, identified by their raid leaders — designed so the normal one-raid night cannot be touched.' },
  { num: '#56', title: 'Same-name mob serial tracks', phase: 'Designs — build pending', cx: 'design', aspects: ['agent', 'bot', 'mimic'], note: 'Telling twelve Rathe Council members apart without spawn IDs — split-only evidence, never a risky merge.' },
];

export const sprintMeta = {
  window: 'Thu Jul 16 → Sun Jul 20, 2026',
  versions: 'Bot 3.0.203 → 3.0.221 · Agent 3.3.73 → 3.3.100 · Web 1.0.231 → 1.0.252 · Mimic 1.9.5 stable / 1.9.6 beta',
  lintFinds: [
    'Turned on the no-undef lint wall and it immediately flagged 2 latent production defects: an admin endpoint that would have crashed on first use (undeclared variable), and 13 undeclared references in the stable agent — the EXACT bug class that caused the July 16 raid-night outage.',
    'The dashboard-escape check (the blank-localhost-page bug we shipped twice in the past) and 275 blocking tests now run on every single push — that whole class of "worked on my machine" defect can no longer reach a raid.',
  ],
  watchList: [
    'Rehearse any trigger: you should HEAR it, and "Mimic" should appear in your Windows volume mixer. Silent? The dashboard\'s trigger journal names exactly why — screenshot it to #feedback.',
    'Buff your pet: the Pet tracker should show it (update Mimic first — the fix needs the latest beta). If not, screenshot the 🐾 diagnostic card.',
    'CH chain: listen for your "0X GO" when your slot comes up. The 📣 button on the overlay toggles it.',
    'Post loot in /gu or /rs: expect the spoken announce + a gold countdown chip you can dismiss with ✕.',
    '/who: columns should line up, Mimic runners get a 🐺, members show (Main) after their name.',
    'Loot bidding card: log into OpenDKP and check the DKP number against the OpenDKP site — report any mismatch (it pools your whole alt family on purpose).',
    'Officers: the 🛡 Admin tab now has the Reporters panel + kill switches — flip something and confirm /admin/overlays agrees within a minute.',
    'Anything weird → #feedback or wolfpack.quest/feedback. Screenshots beat descriptions.',
  ],
};

// ── What's next — the open queue, quick → complex ────────────────────────────
// Sourced from the committed design/continuation docs (docs/STATUS.md ledger,
// DESIGN-platform-queue.md waves, and the DESIGN-*.md files) — this is the
// member-readable mirror of what's actually still open, ordered by how much
// work each one is. `components` names the parts of the platform a change
// touches; `status` carries the one fact worth knowing (design ready /
// blocked on X / awaiting sign-off). Keep it honest: when something ships it
// moves to `releases`, and when it dies it just comes off this list.
export type QueueComponent = 'Bot' | 'Web' | 'Agent' | 'Mimic' | 'Database' | 'Upstream';
export type QueueItem = {
  key: string;
  num: string;           // canonical ledger number ('#169'); minted #190+ are
                         // recorded in docs/STATUS.md so the numbering stays owned
  title: string;
  summary: string;
  effort: 'quick' | 'medium' | 'large';
  components: QueueComponent[];
  status?: string;
  // Something a member can hand us that unblocks or verifies this item —
  // renders a highlighted "we need" callout + the submission box.
  needs?: string;
};

export const queueItems: QueueItem[] = [
  // ── Quick wins ─────────────────────────────────────────────────────────
  {
    key: 'dead-triggers',
    num: '#190',
    title: '30 silent callouts wake up',
    summary: 'An audit found 30 of our 102 guild triggers can never fire — a pattern-anchoring bug that the rehearsal tool accidentally hid. Each gets fixed against a real log line in one reviewed batch (waking 30 callouts mid-raid-week unreviewed is its own hazard), and the rehearsal tool gets fixed so this can\'t hide again.',
    effort: 'quick',
    components: ['Bot', 'Database'],
    status: 'audited — the list is in hand',
    needs: 'Real log lines for any boss emote or callout you rely on — each fixed trigger gets verified against one before it re-arms.',
  },
  {
    key: 'rampage-hp-source',
    num: '#144',
    title: 'Real HP on the Rampage card, always',
    summary: 'A Zeal weight reading (130/180) was sneaking into the data as if it were health. The displays are already guarded; this fixes the source so garbage never lands in the database at all, and rampage victims not running Mimic show what the raid collectively knows about their HP.',
    effort: 'quick',
    components: ['Mimic', 'Agent'],
  },
  {
    key: 'parse-log-dedup',
    num: '#191',
    title: 'One archive entry per fight',
    summary: 'The parse archive sometimes gets near-identical entries posted seconds apart by different uploaders. Collapse them — carefully, because this archive is also what the bot rebuilds its history from after a restart.',
    effort: 'quick',
    components: ['Bot'],
  },
  {
    key: 'dt-pet-victims',
    num: '#169',
    title: 'Death Touch on a pet gets captured',
    summary: 'The Death Touch trigger recognizes player victims but not pets. Blocked on one thing: a verbatim log line of a pet eating a DT (send it if you have one!). May resolve itself when the silent-callouts batch lands.',
    effort: 'quick',
    components: ['Database'],
    status: 'blocked — needs one real log line',
    needs: 'A verbatim log line of a PET being Death Touched (copy it straight from your eqlog file, timestamp and all).',
  },
  {
    key: 'buster-double-fire',
    num: '#142',
    title: 'Tank-buster countdown: one voice, not two',
    summary: 'The Emperor tank-buster now has two working detection paths (the rebuilt guild trigger and the built-in countdown). Verify they don\'t both fire on the same cast.',
    effort: 'quick',
    components: ['Agent', 'Database'],
    needs: 'A raid-night observation from the next Emperor pull: did the tank-buster callout fire once or twice per cast?',
  },
  // ── Medium builds ──────────────────────────────────────────────────────
  {
    key: 'onboarding-v1',
    num: '#192',
    title: 'New Here? — the start-to-raiding checklist',
    summary: 'A slimmer Discord welcome card plus a /start page that checks off the steps it can already prove — signed in, Mimic uploading, first parse recorded. The guided tours that just shipped are step one of this design.',
    effort: 'medium',
    components: ['Bot', 'Web'],
    status: 'design ready',
  },
  {
    key: 'serialization-p1',
    num: '#56',
    title: 'Two same-named mobs, two cards',
    summary: 'When two "a crypt guardian" die back to back, their damage currently knits into one card. Phase one separates two instances using the HP tracks we already record — no client update needed.',
    effort: 'medium',
    components: ['Bot'],
    status: 'design ready',
  },
  {
    key: 'aoe-burn-windows',
    num: '#84',
    title: 'AoE burn windows, automatically',
    summary: 'Detect the raid\'s AoE burn phases from the data instead of the manual /parseaoe ritual, and put the results on the fight page.',
    effort: 'medium',
    components: ['Bot', 'Web'],
  },
  {
    key: 'golden-log-ci',
    num: '#75',
    title: 'The golden log — a replayable raid for testing',
    summary: 'A recorded raid night that every parser change replays before it ships, so "did this break charm tracking?" gets answered by a machine instead of a raid. Doubles as the pre-raid drill.',
    effort: 'medium',
    components: ['Agent'],
  },
  {
    key: 'first-raid-mode',
    num: '#86',
    title: 'First-raid mode',
    summary: 'A role-aware Mimic preset for someone\'s first night: the two overlays their class actually needs, the callouts that matter, nothing else. Builds on the first-run setup flow.',
    effort: 'medium',
    components: ['Mimic'],
  },
  {
    key: 'officer-console',
    num: '#87',
    title: 'Officer runbooks + one console',
    summary: 'The "how do I fix X mid-raid" knowledge, written down and wired to buttons — one officer surface instead of knowledge living in three heads.',
    effort: 'medium',
    components: ['Web', 'Bot'],
  },
  {
    key: 'opendkp-auctions',
    num: '#68–70',
    title: 'Finish the OpenDKP wiring',
    summary: 'Auction creation is already captured; bids and awards still happen on the OpenDKP site. Wire the rest so loot night never leaves Discord.',
    effort: 'medium',
    components: ['Bot'],
  },
  {
    key: 'deck-graduation',
    num: '#156',
    title: 'Steam Deck / Linux Mimic graduates',
    summary: 'The native Linux build works on its own experimental update channel today. Graduation means it stops being a science project: supported, documented, on by default for Deck testers.',
    effort: 'medium',
    components: ['Mimic'],
  },
  {
    key: 'fight-page-v2',
    num: '#199',
    title: 'Fight pages, EQL-Meter style',
    summary: 'Adopt the presentation Hitya flagged from eqlmeter.com for our own fight pages: a damage-over-time chart, melee/DoT/spell mix bars, and the per-ability breakdown per player. Phase one renders from data we already store (the per-verb rollups); phase two adds a small time-bucket series and crit/miss counts to agent uploads for the chart and accuracy stats. The look is theirs; the data and cross-client pipeline stay ours.',
    effort: 'medium',
    components: ['Web', 'Agent', 'Bot'],
    status: 'scoped 2026-08-02 — phase one is web-only',
  },
  // ── Big rocks ──────────────────────────────────────────────────────────
  {
    key: 'zeal-spawn-id',
    num: '#193',
    title: 'The spawn-id ask — exact mob identity',
    summary: 'One additive field in Zeal\'s data pipe would give every mob a unique id — ending same-name ambiguity forever: charm credit to the right charmer, debuff timers per mob, multi-pull cards that never merge. The upstream request is drafted with implementation sketch; once it lands, a chain of workarounds on this list simply gets deleted.',
    effort: 'large',
    components: ['Upstream', 'Agent', 'Mimic', 'Bot'],
    status: 'request drafted — the unlock for everything below it',
  },
  {
    key: 'serialization-p2',
    num: '#194',
    title: 'Many same-named mobs, all separate',
    summary: 'Beyond two instances: cluster the raiders fighting each copy by position ("a tanked mob is a mob standing on a tank") to keep three-plus same-named mobs apart. Honest caveat: spawn-id upstream makes most of this unnecessary.',
    effort: 'large',
    components: ['Agent', 'Bot'],
    status: 'design ready',
  },
  {
    key: 'raid-night-review',
    num: '#80',
    title: 'Raid Night Review, automatic',
    summary: 'The morning-after writeup — kills, wipes, standout parses, loot, attendance — generated from the night\'s data and posted to that night\'s thread.',
    effort: 'large',
    components: ['Bot', 'Web'],
  },
  {
    key: 'raid-guide',
    num: '#81',
    title: 'The living Wolf Pack Raid Guide',
    summary: 'Per-boss pages seeded from our own playbooks, real parses, and what the callouts already know — a guide that updates itself because the raids feed it.',
    effort: 'large',
    components: ['Web'],
  },
  {
    key: 'ui-studio-web',
    num: '#195',
    title: 'UI Studio on the website + cloud backups',
    summary: 'View and edit your EQ interface layouts from the browser, with automatic cloud backups of your UI and settings files — restore a blown-up layout from any machine.',
    effort: 'large',
    components: ['Web', 'Agent'],
  },
  {
    key: 'me-advisors',
    num: '#196',
    title: 'Advisors on /me',
    summary: 'Spells you\'re missing at your level, tradeskill next-steps, faction runs worth doing — computed from your own uploads against the game data we already mirror.',
    effort: 'large',
    components: ['Web', 'Database'],
  },
  {
    key: 'multi-raid',
    num: '#114',
    title: 'Two raids at once',
    summary: 'A split night (two targets, two raid groups) currently risks the data streams colliding. Leader-anchored identity keeps each raid\'s parses, threads, and callouts separate.',
    effort: 'large',
    components: ['Agent', 'Bot'],
    status: 'design ready',
  },
  {
    key: 'storage-partitioning',
    num: '#197',
    title: 'Years of raids, still fast',
    summary: 'Partition the long-haul storage so three years of parses and sightings stay as quick as three weeks. Invisible when done right — that\'s the point.',
    effort: 'large',
    components: ['Database'],
  },
  {
    key: 'eql-support',
    num: '#198',
    title: 'EQLegends support',
    summary: 'When the pack plays EQLegends, the parser and overlays should come along. The groundwork study is done; the port waits until we\'re actually raiding there.',
    effort: 'large',
    components: ['Agent', 'Mimic'],
    status: 'parked until we play',
  },
];
