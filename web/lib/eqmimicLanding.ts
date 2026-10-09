// The words and facts of the eqmimic.quest landing page (the guild lead, 2026-10-08, DECISIONS §209):
// "a landing page for someone that's new to Mimic to be able to deploy it for themselves as standalone,
// have an understanding of what each component does as a walk-through ... do you want more hive mind?
// here's how your guild can implement this".
//
// ONE content module, three layouts (web/app/eqmimic/_landing/Layout{A,B,C}.tsx). The layouts decide
// order and shape; they never carry a sentence of their own, so a fact is corrected in exactly one place.
// Plain data and strings only: no JSX, no imports. test/eqmimic-landing.test.js reads this file as text
// and imports it.
//
// ⚠ This repo is PUBLIC. Nothing here names a member, a character, a real id, a token or an address. The
// one demo guild is invented ("Lantern Watch"). Hosting numbers are the measured ones in docs/COSTS.md.

export const REPO_URL = 'https://github.com/davehess/QuarmBossTracker';
export const docUrl = (path: string) => `${REPO_URL}/blob/main/${path}`;

// Where the downloads live. The installer is served by wolfpack.quest; the eqmimic host has no download
// route of its own, so there the links are absolute.
export const WOLFPACK_ORIGIN = 'https://wolfpack.quest';
export const DOWNLOAD_PATH = '/mimic?direct=1';
export const LINUX_PATH = '/mimic/linux?direct=1';
export const START_GUIDE_URL = `${WOLFPACK_ORIGIN}/start`;
export const PRIVACY_URL = `${WOLFPACK_ORIGIN}/privacy`;

// ─── Rights notice ──────────────────────────────────────────────────────────────────────────────────
// ⚠ VERBATIM from web/app/layout.tsx's footer (the wolfpack.quest wording). test/eqmimic-landing.test.js
// reads both sources and compares the sentence sets, so the two cannot drift. Do not paraphrase.
export const RIGHTS_NOTICE =
  'EverQuest is a registered trademark of Daybreak Game Company LLC. ' +
  'All EverQuest game data and art assets are the property of Daybreak Game Company LLC. ' +
  'This is an unofficial, non-commercial fan-made companion for Project Quarm, and is neither ' +
  'affiliated with nor endorsed by Daybreak Game Company LLC.';

export const FAN_PROJECT_LINE =
  'Wolf Pack Mimic is a fan project by Wolf Pack, a Project Quarm guild; it is open source (AGPL-3.0-or-later).';

// ─── Hero ───────────────────────────────────────────────────────────────────────────────────────────
export const HERO = {
  title: 'Wolf Pack Mimic',
  line: 'Overlays for Project Quarm: DPS, timers, charm, buffs, triggers and more, drawn over EverQuest, free and open source.',
  primary: 'Download Mimic for Windows',
  primaryNote: 'free · stable · installs for your user only',
  secondary: 'How it works',
  platformNote:
    'Windows is the supported target. Linux and Steam Deck is experimental: it works for some people and breaks for others.',
  linuxLabel: 'Linux / Steam Deck build (experimental)',
};

// ─── Highlights (video slots) ───────────────────────────────────────────────────────────────────────
// TODO(guild lead): clips to come. Set `src` (a path under web/public/ or a hosted file) and optionally
// `poster` on a card and it becomes a <video controls muted playsInline preload="none">. Until then the
// card is a "clip coming" placeholder. Nothing external is fetched or embedded.
export interface Highlight { title: string; caption: string; src?: string; poster?: string }
export const HIGHLIGHTS: Highlight[] = [
  { title: 'Clip 1: DPS and threat in a raid', caption: 'The DPS meter and the threat meter during a real pull.' },
  { title: 'Clip 2: Triggers and timers', caption: 'A trigger fires, speaks, and starts a countdown you can see over the game.' },
  { title: 'Clip 3: Charm and pets', caption: 'The charm tracker counting the break, with the pet tracker beside it.' },
  { title: 'Clip 4: The hive mind', caption: 'Buff queue and extended target, fed by every raider in the raid at once.' },
];

// ─── What each piece does (connection order) ────────────────────────────────────────────────────────
export interface FlowNode { label: string; sub?: string }
export interface Piece {
  id: string;
  name: string;
  tag: string;                 // one short line under the name
  body: string;                // one plain paragraph
  flow: [FlowNode, FlowNode, FlowNode];   // input -> this piece -> output
  guildOnly?: boolean;         // only exists once you sign in to a guild
}
export const PIECES: Piece[] = [
  {
    id: 'zeal', name: 'Zeal', tag: 'a community add-on for the Quarm client',
    body: 'Zeal is a community in-game DLL for the Quarm client. It publishes live game state (HP, buffs, ' +
      'target, pet, group and raid, your position) on a Windows named pipe. It is not part of Mimic and you do ' +
      'not have to use it, but it is what makes the overlays live rather than log-driven.',
    flow: [{ label: 'EverQuest client' }, { label: 'Zeal', sub: 'DLL in the client' }, { label: 'Named pipe', sub: 'live game state' }],
  },
  {
    id: 'log', name: 'Your EQ log', tag: 'a text file the game already knows how to write',
    body: 'Type /log on in game and EverQuest writes everything you see in chat and combat to a file named ' +
      'like eqlog_Name_pq.proj.txt in your EverQuest folder. Mimic reads that file; it never touches the game.',
    flow: [{ label: 'EverQuest client' }, { label: '/log on', sub: 'one setting' }, { label: 'eqlog_*_pq.proj.txt', sub: 'in your EQ folder' }],
  },
  {
    id: 'agent', name: 'The agent', tag: 'a small program that reads the log',
    body: 'A zero-dependency Node program bundled inside Mimic. It tails your log, filters private chat on your ' +
      'own PC before anything else can see it, parses fights, runs triggers and timers, and serves a local ' +
      'dashboard on port 7777 of your own machine.',
    flow: [{ label: 'Your log' }, { label: 'Agent', sub: 'filter · parse · triggers' }, { label: 'Dashboard', sub: 'localhost:7777' }],
  },
  {
    id: 'mimic', name: 'Mimic', tag: 'the tray app you actually install',
    body: 'An Electron tray app. It reads Zeal’s pipe, runs the agent, and draws one transparent, always-on-top ' +
      'window for each overlay you turn on. Everything above this line works on one PC with no account.',
    flow: [{ label: 'Pipe + agent' }, { label: 'Mimic', sub: 'tray app' }, { label: 'Overlays', sub: 'one window each' }],
  },
  {
    id: 'guild', name: 'The guild bot and website', tag: 'only if you sign in to a guild',
    body: 'A Discord bot with an HTTP API, plus a website. It merges everyone’s parses, serves shared triggers, ' +
      'buff queues and catalogs back to every Mimic, and the website shows parses, raid and loot. Without ' +
      'signing in, none of this exists for you.',
    flow: [{ label: 'Everyone’s Mimic' }, { label: 'Guild bot', sub: 'Discord + API + site' }, { label: 'Everyone’s overlays' }],
    guildOnly: true,
  },
];

// ─── Standalone setup ───────────────────────────────────────────────────────────────────────────────
export interface Step { title: string; body: string }
export const SETUP_STEPS: Step[] = [
  { title: 'Download the installer',
    body: 'Windows SmartScreen and your browser will warn, because Mimic is not code-signed: choose More info, then ' +
      'Run anyway. It installs for your user only (no admin prompt). Install it outside your EverQuest folder.' },
  { title: 'First run: choose “Run local-only”',
    body: 'Pick “Run local-only” instead of Discord sign-in. Nothing is sent anywhere, and you can sign in later from the tray.' },
  { title: 'Point it at your EverQuest folder',
    body: 'Mimic scans for it. If it does not find it, use Browse.' },
  { title: 'Let it set EverQuest up for you',
    body: 'With EverQuest closed, open Settings and press “Set up EQ for me”. It turns on logging (Log=TRUE in ' +
      'eqclient.ini) and sets Zeal’s pipe options. Already in game? Type /log on.' },
  { title: 'Zeal, for the live overlays',
    body: 'Zeal is needed for live overlays; Mimic installs and updates it from a card in Settings. Without Zeal you ' +
      'still get everything that is driven by the log.' },
  { title: 'Turn overlays on',
    body: 'Use the tray icon, or the Overlays tab of the dashboard. Each overlay can be moved, resized and locked.' },
];

export const GUIDE_LINK = { label: 'Read the full click-by-click guide', href: START_GUIDE_URL };

export interface Trouble { sign: string; fix: string; first?: boolean }
export const TROUBLESHOOTING: Trouble[] = [
  { sign: '“EPERM” in the log, over and over',
    fix: 'Untick Windows compatibility mode on eqgame.exe (Properties, then Compatibility). Check this first: it is the most common cause.',
    first: true },
  { sign: 'Mimic cannot find Zeal',
    fix: 'Reinstall Mimic outside your EverQuest folder.' },
  { sign: 'It connects, then drops',
    fix: 'Run-as-administrator has to match between EverQuest and Mimic: both elevated, or neither.' },
];

export const LOCAL_MODE = {
  title: 'What local mode is',
  lead: 'Local mode is Mimic with no guild: nothing is sent to any guild server.',
  points: [
    'Spell, item and clicky catalogs are bundled, so lookups work offline.',
    'Guild-only overlays (Buff queue, Extended Target, Target Info, Command Center) show “needs your raid’s Mimics” or are empty.',
    'Triggers work locally, from a personal triggers file.',
    'Mimic still contacts GitHub for its own updates and Zeal’s.',
  ],
};

// ─── What you get ───────────────────────────────────────────────────────────────────────────────────
export type Scope = 'local' | 'guild';
export interface Overlay { name: string; purpose: string; scope: Scope; note?: string }
export const OVERLAYS: Overlay[] = [
  { name: 'DPS and Tank meter', purpose: 'Who is doing what, with History and Trend tabs.', scope: 'local' },
  { name: 'Threat meter', purpose: 'How close you are to pulling aggro, with a warning to back off.', scope: 'local' },
  { name: 'CH chain', purpose: 'Complete Heal rotation timing, spoken when it is your turn.', scope: 'local' },
  { name: 'Charm tracker', purpose: 'The charm break countdown, with the server tick and the mob tick.', scope: 'local' },
  { name: 'Pets', purpose: 'Your pet and your charmed pets, their health and buffs.', scope: 'local' },
  { name: 'Target Info', purpose: 'What a mob is, what it drops and what has landed on it.', scope: 'guild', note: 'fills in from your raid’s Mimics' },
  { name: 'Buff queue', purpose: 'Who needs which buff, debuff or cure next, in order.', scope: 'guild' },
  { name: 'Extended Target', purpose: 'The mobs your raid is fighting, beyond the one you have targeted.', scope: 'guild' },
  { name: '/who', purpose: 'A readable /who list you can keep on screen.', scope: 'local' },
  { name: 'Melody', purpose: 'Bard song casting, tracked on screen.', scope: 'local' },
  { name: 'Trigger alerts', purpose: 'Text, speech and countdown timers from a log line; GINA import.', scope: 'local', note: 'guild triggers arrive when you sign in' },
  { name: 'Me HUD ring', purpose: 'Your own status in a ring around the screen, built from parts you choose.', scope: 'local' },
  { name: 'Tick', purpose: 'The server tick and charm tick, so you can time a heal or a cast.', scope: 'local' },
  { name: 'PoP raid objectives', purpose: 'The Planes of Power checklist for the raid in front of you.', scope: 'local', note: 'shared checkboxes need a guild' },
];

// ─── Privacy ────────────────────────────────────────────────────────────────────────────────────────
export const PRIVACY_BULLETS: string[] = [
  'Nothing goes to a guild server until you sign in, and signing out stops every upload.',
  'Officer, group, custom-channel, /say, OOC, shout and auction chat is dropped on your PC before anything is sent. Tells are too, unless you turn relay on.',
  'Tell relay, crash reports, old-log upload, UI backups and attaching logs to feedback are off until you opt in.',
  'It never records keystrokes, captures the screen, or reads your browser, passwords or clipboard.',
  'It installs per user, with no admin rights, drivers or services, and the code is open source.',
];
export const PRIVACY_CAVEAT =
  'The honest caveat: once you are signed in to a guild, uploads include your live status and the results of your /who. Local mode avoids all of it.';

// ─── Hive mind ──────────────────────────────────────────────────────────────────────────────────────
export const HIVE = {
  title: 'Want more hive mind?',
  lead:
    'A hive mind is every raider’s Mimic feeding one shared brain: parses merged into one fight, triggers pushed to ' +
    'everyone in about two minutes, a shared buff and debuff queue, an extended target list, the timers canvas, and loot.',
  howTitle: 'Here’s how your guild can run it',
  howNote: 'The fork is the default shape: your guild’s copy of the repository, with your own name, roles and sites in it.',
};

export interface HiveStep { title: string; body: string; code?: string }
export const HIVE_STEPS: HiveStep[] = [
  { title: 'Fork the repository',
    body: `Fork ${REPO_URL}. The fork is the default shape.` },
  { title: 'Create the database',
    body: 'Create a Supabase project and run the bootstrap script against it. On hosted Supabase, apply the migrations instead.',
    code: 'bash scripts/selfhost-bootstrap-db.sh' },
  { title: 'Create a Discord application and bot',
    body: 'Make the application and bot in the Discord developer portal and invite it to your server.' },
  { title: 'Fill in .env and guild/config.json',
    body: 'Copy .env.example to .env and set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_GUILD_ID (your guild tag), ' +
      'WOLFPACK_AGENT_TOKEN (any long random string), DISCORD_TOKEN, DISCORD_CLIENT_ID and DISCORD_GUILD_ID. Commit ' +
      'guild/config.json for your names, roles, timezone and sites. Never commit secrets.',
    code: '{ "guild": { "tag": "lanternwatch", "name": "Lantern Watch", "timezone": "America/Chicago" } }' },
  { title: 'Deploy the bot',
    body: 'On Railway, or with docker compose. With GUILD_PROVISION=auto the bot lays out your Discord channels on a new server.',
    code: 'docker compose up -d' },
  { title: 'Deploy the website',
    body: 'Deploy web/ to Vercel or Coolify and add the Supabase Discord OAuth redirect URLs for your site.' },
  { title: 'Point Mimic at your bot',
    body: 'Build Mimic against your own bot and have members sign in with Discord. See the honest list below: this is the step that is not turnkey yet.' },
];

export const NOT_FINISHED = {
  title: 'Not finished yet (honest list)',
  items: [
    'The setup wizard is only designed, not built.',
    'Sign-in links and branding inside Mimic are still hard-coded to wolfpack.quest and the Wolf Pack bot. Today your guild builds its own Mimic, which is about a day of work. We are not promising otherwise.',
    '.env.example still holds Wolf Pack defaults, so read every line before you trust it.',
    'The EverQuest game-data catalog (about 100 MB) has no self-serve import yet, so item, NPC and spell lookups are empty without it.',
    'There is no doctor diagnostic yet to tell you what is misconfigured.',
  ],
};

export const COSTS = {
  title: 'What it costs to run',
  measured: 'Measured September 2026 for Wolf Pack:',
  rows: [
    { what: 'Supabase Pro', cost: '$25 / month' },
    { what: 'Railway Hobby', cost: '~$5 / month (the bot itself uses about $2 of it)' },
    { what: 'Vercel Hobby', cost: '$0' },
  ],
  total: 'About $30 a month in all.',
  notes: [
    'Railway Free cannot run the bot.',
    'Supabase Free works if you tune the retention down.',
    'Fully on-prem costs electricity.',
  ],
};

export const DOC_LINKS: { label: string; href: string }[] = [
  { label: 'Self-hosting runbook', href: docUrl('docs/SELFHOSTING.md') },
  { label: 'The guild kit design', href: docUrl('docs/DESIGN-guild-kit.md') },
  { label: 'guild/ folder README', href: docUrl('guild/README.md') },
  { label: 'What it costs (full numbers)', href: docUrl('docs/COSTS.md') },
];

export const HELP_LINE = 'Questions or want help standing it up?';

// ─── FAQ (layout B) ─────────────────────────────────────────────────────────────────────────────────
export const FAQ: { q: string; a: string }[] = [
  { q: 'Do I need a Discord account or a guild?',
    a: 'No. Choose “Run local-only” on first run. Most overlays work on your own PC with no account.' },
  { q: 'Why does Windows warn me about the installer?',
    a: 'Mimic is not code-signed, so SmartScreen and browsers call it uncommon. Choose More info, then Run anyway. The code is open source if you would rather read it first.' },
  { q: 'Do I need Zeal?',
    a: 'For the live overlays, yes. Mimic can install and update it for you from Settings. Without it you keep everything that runs from your log.' },
  { q: 'Where do my logs go?',
    a: 'They stay on your PC. The agent reads them there and filters private chat there. Only if you sign in to a guild do parsed fights and live status go to that guild’s server.' },
  { q: 'Does it work on Linux or the Steam Deck?',
    a: 'There is an experimental build. It works for some people and not others; Windows is the supported target.' },
  { q: 'Can my guild run its own?',
    a: 'Yes, and the code is all here, but it is not turnkey: today your guild builds its own Mimic, about a day of work. The hive-mind section lists what is missing.' },
];

// ─── Section ids (shared by nav and anchors) ────────────────────────────────────────────────────────
export const SECTIONS = [
  { id: 'what', label: 'What it is' },
  { id: 'pieces', label: 'The pieces' },
  { id: 'setup', label: 'Set it up' },
  { id: 'overlays', label: 'What you get' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'hive', label: 'Hive mind' },
] as const;
