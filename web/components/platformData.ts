// The platform's branch data — pure values, NO 'use client'.
//
// ⚠ This lives apart from PlatformMap.tsx on purpose. That file is a client
// component, and `'use client'` marks EVERY export in its module as client-side
// — including plain arrays. `/platform` and `/` are server components that map
// over BRANCHES to build their drill-down cards, and doing that across the
// boundary fails at RUNTIME with "Attempted to call map() from the server but
// map is on the client". It type-checks and it builds; only loading the page
// shows it. Keep data here and components there.
export const BRANCHES = [
  {
    id: 'mimic',
    icon: '🖥',
    title: 'miMIC Desktop',
    tint: 'blue',
    tag: 'Electron · 18 live surfaces',
    summary:
      'The in-raid cockpit: frameless, click-through overlays that float over EverQuest and stay out of your way until they matter.',
    leaves: ['DPS + Tank HUDs', 'CH Chain', 'Command Center', 'Trigger callouts', 'UI Studio'],
    details: [
      ['DPS HUD', 'live damage/threat meter with DPS + Tank tabs, pets attributed to owners'],
      ['CH Chain', 'complete-heal rotation board — beats, gaps, and who is NEXT, synced across clerics — and it speaks your "04 GO" out loud'],
      ['Loot bidding', 'log into OpenDKP once and place sealed bids from the dashboard — open auctions, last winner + runner-up, your DKP, and a wishlist built from your bid history'],
      ['Command Center', 'one board: healer mana, cures needed, Divine Intervention coverage, defensives'],
      ['Tank overlay', 'MT HP with inbound heal cast-bars and ghost projection, rampage tracking'],
      ['Extended Target', 'raid-wide target list with off-tank flags and per-mob debuff chips'],
      ['Triggers', 'guild-shared + personal patterns → text, timers, and TTS callouts'],
      ['Charm + Pet trackers', 'gauge-driven charm-break countdowns; pet buffs swept per owner'],
      ['Mob Info', 'stats, loot, and spells for your target — merged local + cross-client observations'],
      ['Buff queue', 'who needs what buff, sorted by class, zone, and tank priority'],
      ['UI Studio', 'capture, edit, and restore your whole EQ UI + macros from the browser'],
      ['…and more', 'Melody, /who, Zeal health, PoP raid slideshow, quiet mode, auto-arrange'],
    ],
  },
  {
    id: 'agent',
    icon: '📡',
    title: 'Logsync Agent',
    tint: 'green',
    tag: '~32k lines · zero deps',
    summary:
      'A single-file engine on each raider\'s machine: tails EQ logs, bridges the Zeal pipe, and filters privately before anything leaves.',
    leaves: ['Privacy-first filter', 'Multi-char tailing', 'Zeal pipe bridge', 'Durable queue'],
    details: [
      ['Privacy filter', 'officer chat, tells, group, and private channels are dropped at byte level BEFORE parsing — they never leave the machine'],
      ['Multi-log tailing', 'every eqlog on the machine, each character self-identified — play as many characters as you like'],
      ['Zeal pipe bridge', 'live gauges, raid roster, cast bars, and target HP straight from the client'],
      ['Durable queue', 'every upload persists to disk first; network blips retry with backoff, nothing is lost'],
      ['Trigger engine', 'compiled patterns + Zeal gauge conditions; TTS, timers, and cross-client relays — with a checkpoint journal that proves every callout fired AND played'],
      ['Local dashboard', 'the full HUD in any browser at localhost:7779 — no install needed to peek'],
      ['Reporter elections', 'the fleet elects who uploads shared streams (chat, buffs, roster) so 60 raiders don\'t upload the same bytes 60 times — with camp-out and logout handoff'],
      ['One control poll', 'six background polling loops collapsed into a single multiplexed ask, and boss-kill upload bursts self-stagger'],
      ['Opt-in backfill', 'point it at years of old logs and it rebuilds history without double-counting'],
    ],
  },
  {
    id: 'bot',
    icon: '🤖',
    title: 'Discord Bot',
    tint: 'gold',
    tag: '83 commands · 52 endpoints',
    summary:
      'The hub: raid timers, multi-perspective parse merging, DKP, and the API every agent talks to — running 24/7.',
    leaves: ['133 boss timers', 'Parse merging', 'DKP + sealed bids', 'Spawn alerts'],
    details: [
      ['Raid timers', '133 bosses with per-variant respawn math (PvP variance, quakes, Plane of Hate)'],
      ['Parse merging', 'every raider uploads their view of a fight; the bot merges max-per-player into ONE card'],
      ['DKP + loot', 'OpenDKP integration, sealed AES-encrypted bids, in-client ticks and loot posting'],
      ['Agent API', '58 bearer-authed endpoints: encounters, chat relay, live state, buffs, triggers, PvP'],
      ['Spawn alerts', 'windows opening, daily summaries, and midnight archives — all edited in place'],
      ['Member sync', 'Discord roles → database every 6 hours; officer tools with full audit trail'],
      ['Admission control', 'per-client rate budgets, a circuit breaker on the database, and poison-payload hardening — one misbehaving client can\'t hurt the raid'],
      ['Control plane', 'officer kill switches, a fleet version floor, and live tuning flags the whole fleet honors within a minute — no deploys'],
    ],
  },
  {
    id: 'web',
    icon: '🌐',
    title: 'wolfpack.quest',
    tint: 'purple',
    tag: '75 pages · OAuth gated',
    summary:
      'The between-fights surface: compare parses, plan raids, manage loot — and the officer console behind it.',
    leaves: ['/me home base', 'Parses + boards', 'Raid HQ', 'Raid Guide', '20+ admin pages'],
    details: [
      ['/me', 'your characters, tells, buffs, stats, gear, spellbooks, and privacy toggles in one place'],
      ['Parses', 'every merged fight, drillable to per-player ability detail — with a timeline of deaths, slows, mob heals, discs, and which callouts fired'],
      ['Roll nights', '/rolls: off-night NBG raids reviewed — who rolled, who won, who actually looted, and the Hot Dice crown'],
      ['Raid HQ', 'live raid page: roster, healer mana, buff queues, boss boards'],
      ['Raid Guide', 'one page per boss, built from our OWN kill history — what the fight does, what went wrong last time, and who usually handles what'],
      ['Leaderboards', 'damage, healing, attendance — scoped so excluded characters never appear'],
      ['Planner + PoP flags', 'raid-night planning with per-character flag progress for the next era'],
      ['Admin suite', 'triggers, attendance, encounters, agents, members, audits, feedback — 20+ officer pages'],
    ],
  },
  {
    id: 'data',
    icon: '🗄',
    title: 'Data Platform',
    tint: 'orange',
    tag: 'Supabase · 40+ tables · RLS',
    summary:
      'One shared spine: the EQ catalog mirrored weekly, plus everything the guild generates, access-tiered end to end.',
    leaves: ['EQ catalog mirrors', 'Guild tables', 'Row-level security', 'Weekly sync'],
    details: [
      ['Catalog mirrors', 'items, NPCs, spells, zones, and loot tables synced weekly from the emulator source'],
      ['Guild data', 'encounters, contributions, buffs, chat, rosters, live state, crash reports, DKP mirrors'],
      ['Security tiers', 'public catalog / members-only guild data / service-role-only encrypted bids'],
      ['Data floor', 'per-character history starts the day THEY joined — alts and mains linked as families'],
      ['Stat scopes', 'every log-derived stat declares PRIVATE, ANON, or GUILD visibility — enforced everywhere'],
    ],
  },
  {
    id: 'liveops',
    icon: '🚀',
    title: 'Live Ops',
    tint: 'red',
    tag: '500+ releases and counting',
    summary:
      'The part you never see: shipping fixes to a fleet of raiders mid-week without breaking raid night.',
    leaves: ['Redeploy-free updates', 'beta / stable channels', 'Raid-hold freeze', 'Remote tuning'],
    details: [
      ['Redeploy-free updates', 'the update manifest is fetched from the release branch itself — an agent fix reaches the whole fleet in minutes, sha-verified, with zero server bounces'],
      ['Channels', 'beta testers soak every change first; stable graduates only what survived a raid'],
      ['Raid-hold', 'the bot tells every agent "a raid is live — hold your updates and heavy scans for later"'],
      ['Remote tuning', 'officers flip load-shedding and overlay knobs mid-raid from the website — no deploys'],
      ['Escape hatches', 'one-click revert to stable, update gates that refuse to interrupt a live fight, and a crash-looping update that rolls itself back to last-known-good'],
      ['CI gates', '1,100+ blocking tests + a lint wall on every push — the gate caught two latent raid-night bugs the day it turned on'],
    ],
  },
] as const;

// Site accent tokens per branch (borders/icons only — labels stay in text ink).
export const TINT: Record<string, { border: string; text: string; glow: string }> = {
  blue:   { border: 'border-blue/60',   text: 'text-blue',   glow: 'hover:shadow-[0_0_24px_rgba(88,166,255,0.25)]' },
  green:  { border: 'border-green/60',  text: 'text-green',  glow: 'hover:shadow-[0_0_24px_rgba(86,211,100,0.25)]' },
  gold:   { border: 'border-gold/60',   text: 'text-gold',   glow: 'hover:shadow-[0_0_24px_rgba(210,153,34,0.25)]' },
  purple: { border: 'border-purple/60', text: 'text-purple', glow: 'hover:shadow-[0_0_24px_rgba(163,113,247,0.25)]' },
  orange: { border: 'border-orange/60', text: 'text-orange', glow: 'hover:shadow-[0_0_24px_rgba(255,166,87,0.25)]' },
  red:    { border: 'border-red/60',    text: 'text-red',    glow: 'hover:shadow-[0_0_24px_rgba(248,81,73,0.25)]' },
};

export const STATS: Array<[string, string]> = [
  ['4', 'independent components'],
  ['500+', 'versioned releases'],
  ['~57k', 'lines across the three cores'],
  ['18', 'desktop overlay surfaces'],
  ['83', 'Discord slash commands'],
  ['52', 'agent API endpoints'],
  ['133', 'bosses on timers'],
  ['75', 'website pages'],
];
