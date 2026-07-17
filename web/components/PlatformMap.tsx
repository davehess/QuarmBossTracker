// Shared platform-map visual + branch data. Rendered on /platform (full page
// with drill-down cards) AND on the signed-out homepage (the "what IS all of
// this?" hero for curious visitors). Server component — pure SVG/JSX.
// Identity is carried by label + icon + position; color is reinforcement only.

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
      ['CH Chain', 'complete-heal rotation board — beats, gaps, and who is NEXT, synced across clerics'],
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
    tag: '~24k lines · zero deps',
    summary:
      'A single-file engine on each raider&apos;s machine: tails EQ logs, bridges the Zeal pipe, and filters privately before anything leaves.',
    leaves: ['Privacy-first filter', 'Multi-char tailing', 'Zeal pipe bridge', 'Durable queue'],
    details: [
      ['Privacy filter', 'officer chat, tells, group, and private channels are dropped at byte level BEFORE parsing — they never leave the machine'],
      ['Multi-log tailing', 'every eqlog on the box, each character self-identified — boxers fully supported'],
      ['Zeal pipe bridge', 'live gauges, raid roster, cast bars, and target HP straight from the client'],
      ['Durable queue', 'every upload persists to disk first; network blips retry with backoff, nothing is lost'],
      ['Trigger engine', 'compiled patterns + Zeal gauge conditions; TTS, timers, and cross-client relays'],
      ['Local dashboard', 'the full HUD in any browser at localhost:7779 — no install needed to peek'],
      ['Opt-in backfill', 'point it at years of old logs and it rebuilds history without double-counting'],
    ],
  },
  {
    id: 'bot',
    icon: '🤖',
    title: 'Discord Bot',
    tint: 'gold',
    tag: '80 commands · 58 endpoints',
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
    ],
  },
  {
    id: 'web',
    icon: '🌐',
    title: 'wolfpack.quest',
    tint: 'purple',
    tag: '59 pages · OAuth gated',
    summary:
      'The between-fights surface: compare parses, plan raids, manage loot — and the officer console behind it.',
    leaves: ['/me home base', 'Parses + boards', 'Raid HQ', '20+ admin pages'],
    details: [
      ['/me', 'your characters, tells, buffs, stats, gear, spellbooks, and privacy toggles in one place'],
      ['Parses', 'every merged fight, drillable to per-player ability detail'],
      ['Raid HQ', 'live raid page: roster, healer mana, buff queues, boss boards'],
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
      ['Escape hatches', 'one-click revert to stable, update gates that refuse to interrupt a live fight'],
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

const SVG_HEX: Record<string, string> = {
  blue: '#58a6ff', green: '#56d364', gold: '#d29922',
  purple: '#a371f7', orange: '#ffa657', red: '#f85149',
};

// Hand-laid radial positions (1200×780 viewBox). Node = pill anchor; leaves fan outward.
const MAP_POS: Record<string, { x: number; y: number; leafDir: 1 | -1; leafYStart: number }> = {
  mimic:   { x: 305, y: 128, leafDir: -1, leafYStart: -8 },
  bot:     { x: 890, y: 128, leafDir: 1,  leafYStart: -8 },
  agent:   { x: 300, y: 396, leafDir: -1, leafYStart: -30 },
  web:     { x: 892, y: 396, leafDir: 1,  leafYStart: -30 },
  data:    { x: 320, y: 652, leafDir: -1, leafYStart: 6 },
  liveops: { x: 880, y: 652, leafDir: 1,  leafYStart: 6 },
};

export const STATS: Array<[string, string]> = [
  ['4', 'independent components'],
  ['500+', 'versioned releases'],
  ['~43k', 'lines across the three cores'],
  ['18', 'desktop overlay surfaces'],
  ['80', 'Discord slash commands'],
  ['58', 'agent API endpoints'],
  ['133', 'bosses on timers'],
  ['59', 'website pages'],
];

// anchorBase: '' on /platform (same-page anchors), '/platform' when the map is
// embedded elsewhere (homepage) so node clicks land on the full page's cards.
export function PlatformMap({ anchorBase = '' }: { anchorBase?: string }) {
  const cx = 600, cy = 388;
  return (
    <svg
      viewBox="0 0 1200 780"
      role="img"
      aria-label="Map of the Wolf Pack platform: miMIC desktop, logsync agent, Discord bot, wolfpack.quest, data platform, and live ops, all connected to one hub"
      className="w-full h-auto select-none"
    >
      {/* connectors first (under everything) */}
      {BRANCHES.map((b) => {
        const p = MAP_POS[b.id];
        const midX = (cx + p.x) / 2, midY = (cy + p.y) / 2 + (p.y < cy ? -30 : 30);
        return (
          <path
            key={`c-${b.id}`}
            d={`M ${cx} ${cy} Q ${midX} ${midY} ${p.x} ${p.y}`}
            fill="none"
            stroke={SVG_HEX[b.tint]}
            strokeOpacity="0.35"
            strokeWidth="2"
          />
        );
      })}

      {/* leaf stubs */}
      {BRANCHES.map((b) => {
        const p = MAP_POS[b.id];
        return b.leaves.map((leaf, i) => {
          const ly = p.y + p.leafYStart + i * 26;
          const lx = p.x + p.leafDir * 118;
          const tx = lx + p.leafDir * 14;
          return (
            <g key={`${b.id}-leaf-${i}`}>
              <path
                d={`M ${p.x + p.leafDir * 92} ${p.y} Q ${p.x + p.leafDir * 108} ${p.y} ${lx} ${ly}`}
                fill="none" stroke="#30363d" strokeWidth="1.5"
              />
              <circle cx={lx} cy={ly} r="3.5" fill={SVG_HEX[b.tint]} />
              <text
                x={tx} y={ly + 4}
                textAnchor={p.leafDir === 1 ? 'start' : 'end'}
                fill="#c9d1d9" fontSize="13" fontFamily="Cascadia Code, Consolas, monospace"
              >
                {leaf}
              </text>
            </g>
          );
        });
      })}

      {/* branch nodes (clickable → drill-down cards) */}
      {BRANCHES.map((b) => {
        const p = MAP_POS[b.id];
        return (
          <a key={`n-${b.id}`} href={`${anchorBase}#${b.id}`} aria-label={`${b.title} — jump to details`}>
            <g className="cursor-pointer">
              <rect
                x={p.x - 92} y={p.y - 24} width="184" height="48" rx="12"
                fill="#161b22" stroke={SVG_HEX[b.tint]} strokeWidth="2"
              />
              <text x={p.x} y={p.y - 2} textAnchor="middle" fontSize="15" fontWeight="bold"
                fill="#c9d1d9" fontFamily="Cascadia Code, Consolas, monospace">
                {b.icon} {b.title}
              </text>
              <text x={p.x} y={p.y + 15} textAnchor="middle" fontSize="10.5"
                fill="#6e7681" fontFamily="Cascadia Code, Consolas, monospace">
                {b.tag}
              </text>
            </g>
          </a>
        );
      })}

      {/* hub */}
      <g>
        <circle cx={cx} cy={cy} r="86" fill="#161b22" stroke="#1f6feb" strokeWidth="2.5" />
        <circle cx={cx} cy={cy} r="94" fill="none" stroke="#1f6feb" strokeOpacity="0.25" strokeWidth="1.5" />
        <text x={cx} y={cy - 18} textAnchor="middle" fontSize="30">🐺</text>
        <text x={cx} y={cy + 10} textAnchor="middle" fontSize="16" fontWeight="bold"
          fill="#c9d1d9" fontFamily="Cascadia Code, Consolas, monospace">
          Wolf Pack
        </text>
        <text x={cx} y={cy + 30} textAnchor="middle" fontSize="12"
          fill="#58a6ff" fontFamily="Cascadia Code, Consolas, monospace">
          one shared raid brain
        </text>
      </g>
    </svg>
  );
}

export function PlatformStats() {
  return (
    <div className="grid grid-cols-4 md:grid-cols-8 gap-y-4 text-center">
      {STATS.map(([n, label]) => (
        <div key={label} className="px-1">
          <div className="text-xl md:text-2xl text-blue font-bold">{n}</div>
          <div className="text-[10px] md:text-[11px] text-dim leading-tight mt-1">{label}</div>
        </div>
      ))}
    </div>
  );
}
