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
    version: 'Agent 3.3.13',
    date: '2026-07-09',
    channel: 'beta',
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
    channel: 'beta',
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
    channel: 'beta',
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
    channel: 'beta',
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
    channel: 'beta',
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
    channel: 'beta',
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
