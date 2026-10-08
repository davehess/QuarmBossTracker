// /platform/architecture — the deep version of /platform.
//
// /platform answers "what is all this?" for a curious guildmate. This page
// answers "how does it actually work?" for someone who wants the mechanism:
// every overlay, every dashboard, every integration, and the path a single line
// of log text takes from the game to the guild.
//
// The four diagrams are archify artifacts (MIT, github.com/tt-a1i/archify),
// generated from the typed JSON in docs/diagrams/ and delivered to
// public/platform/. ⚠ The JSON is the source of truth, not the HTML: regenerate
// with `archify deliver <type> docs/diagrams/<file>.json web/public/platform/<n>.html
// --quality showcase` after any edit. All four pass the showcase profile with
// 0 errors and 0 warnings; keep it that way rather than hand-editing the output.
//
// Public, like /platform: this is architecture and features, never member data.
import Link from 'next/link';
import type { Metadata } from 'next';
import Diagram from './Diagram';

export const metadata: Metadata = {
  title: 'How it works',
  description:
    'Every overlay, dashboard and integration in the Wolf Pack platform, and the path one line of your combat log takes to reach the guild.',
};

// The full overlay roster. The diagram groups these four ways because fifteen
// boxes is an unreadable picture; the names belong in a table instead.
const OVERLAYS: Array<[string, string, string]> = [
  ['DPS + Tank HUD',   'combat log',        'Per-fight damage, healing and tanking, with pets folded under their owner.'],
  ['Threat meter',     'log + Zeal',        'Per-target threat per player, with a caution band when melee should back off.'],
  ['CH chain',         'raid chat, local',  'The cleric Complete Heal rotation, read from zone chat. Fully local — no round trip, which is how it keeps a 2-second cadence.'],
  ['Tank',             'Zeal + relay',      'Main-tank health with exact numbers when the tank runs Mimic, percentage when they do not.'],
  ['Buff queue',       'log + relay',       'Who is missing which buff, ordered by same-zone, tank HP and curse counters.'],
  ['Extended Target',  'relay',             'Every mob the raid is on, sorted by how many raiders are targeting it, with HP and debuffs.'],
  ['Target Info',      'catalog + relay',   "The current target's stats, loot table and landed effects."],
  ['Triggers',         'combat log',        'Guild and personal callouts with countdown timers and text-to-speech.'],
  ['Charm tracker',    'Zeal slot 16',      'Charm break timers, driven by the pet gauge rather than the log.'],
  ['Pet tracker',      'log + Zeal',        'Summoned pet health, buffs and uptime.'],
  ['Command Center',   'everything local',  'The one-window raid board: mana, discipline timers, rez queue, roll sets, cures.'],
  ['Melody',           'combat log',        'Bard song rotation, detected from the Zeal casting label.'],
  ['/who',             'combat log',        'The last /who you ran, plus everyone seen in the zone recently.'],
  ['PoP raid guide',   'guide content',     'Encounter-by-encounter raid guide, pinned beside the fight.'],
  ['Zeal health',      'the pipe itself',   'Diagnostic surface: is the pipe connected, what is it sending, why not.'],
];

const DASHBOARDS: Array<[string, string, string]> = [
  ['Agent dashboard',  'localhost:7777',    'Served by the agent itself on the raider’s own machine. Queue depth, trigger fires, charm diagnostics, live parse. Works with the network down.'],
  ['Mimic window',     'the desktop app',   'The same dashboard inside the Electron shell, plus overlay toggles, UI Studio and settings.'],
  ['wolfpack.quest',   'the website',       'The durable record: parses, raid boards, loadouts, characters, leaderboards. Discord sign-in, role-gated.'],
  ['Officer console',  '/admin on the site','Triggers, attendance, encounters, agents, members, audit, feedback, and the mid-raid tuning knobs.'],
  ['Discord boards',   'in the guild',      'Timer cards, kill announcements, daily summaries — edited in place, never re-posted.'],
];

const INTEGRATIONS: Array<[string, string, string]> = [
  ['Discord',       'bot + OAuth',      'The bot is a Discord client; the website signs in through Discord and inherits guild and role membership from it.'],
  ['Supabase',      'Postgres + auth',  'Every durable fact. Row-level security separates public catalog data from guild data; the bot uses a service role and bypasses it.'],
  ['Zeal',          'named pipe',       'The in-game DLL. Gauges arrive sub-second over a local pipe — health, target, buffs, raid positions.'],
  ['OpenDKP',       'attendance, bids', 'Somebody else’s AWS account, so every call is budgeted, cached and killable without a deploy.'],
  ['Raid-Helper',   'signups',          'Pulled on a schedule to reconcile who said they were coming with who actually showed up.'],
  ['Quarm mirror',  'weekly sync',      'Items, spells, NPCs and loot tables mirrored from the server’s own data by a scheduled job.'],
  ['GitHub',        'releases',         'Mimic auto-updates from tagged releases on a stable and a beta channel; the agent hot-swaps along the same line.'],
];

function Table({ head, rows }: { head: [string, string, string]; rows: Array<[string, string, string]> }) {
  return (
    <div className="overflow-x-auto border border-border rounded-lg">
      <table className="w-full text-sm" style={{ minWidth: 640 }}>
        <thead>
          <tr className="bg-bg text-dim text-[10px] uppercase tracking-widest">
            {head.map((h) => <th key={h} className="text-left font-normal px-4 py-2.5">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(([a, b, c]) => (
            <tr key={a} className="border-t border-border align-top">
              <td className="px-4 py-2.5 text-text whitespace-nowrap font-medium">{a}</td>
              <td className="px-4 py-2.5 text-dim whitespace-nowrap text-xs">{b}</td>
              <td className="px-4 py-2.5 text-dim leading-6">{c}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({
  eyebrow, title, children,
}: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div>
        <p className="text-[10px] uppercase tracking-[0.16em] text-dim mb-1">{eyebrow}</p>
        <h2 className="text-xl md:text-2xl text-gold font-bold tracking-tight">{title}</h2>
      </div>
      {children}
    </section>
  );
}

export default function ArchitecturePage() {
  return (
    <div className="space-y-14 pb-8">
      <section className="space-y-4 pt-2">
        <p className="text-[10px] uppercase tracking-[0.16em] text-dim">
          <Link href="/platform" className="text-blue hover:underline">The platform</Link>
          {' · '}the deep version
        </p>
        <h1 className="text-3xl md:text-4xl text-gold font-bold tracking-tight">
          How it actually works
        </h1>
        <p className="max-w-3xl text-sm md:text-base leading-7 text-text">
          Four diagrams and three tables. Every overlay, every dashboard, every integration, and the
          path one line of your combat log takes from the moment EverQuest writes it to the moment
          the guild can read it. The diagrams are interactive — use the view switcher inside each
          one to isolate a path, and search to find a component.
        </p>
      </section>

      <Section eyebrow="Diagram 1" title="The whole platform">
        <p className="max-w-3xl text-sm leading-7 text-dim">
          Four components that ship independently. The <strong className="text-text">agent</strong> reads
          logs on the raider&apos;s machine, <strong className="text-text">Mimic</strong> draws overlays over
          the game, the <strong className="text-text">bot</strong> merges what everyone uploaded and posts
          to Discord, and the <strong className="text-text">website</strong> is the guild&apos;s memory.
          The dashed line back to the fleet is the part people find surprising: triggers, tuning and a
          kill switch reach every raider by polling, so the guild can change how the fleet behaves
          mid-raid without shipping anything.
        </p>
        <Diagram src="/platform/platform.html" title="the platform map" height={880} />
      </Section>

      <Section eyebrow="Diagram 2" title="One line of your log">
        <p className="max-w-3xl text-sm leading-7 text-dim">
          The privacy story is a filter, not a promise. Officer chat, tells, group and custom channels
          are matched on <em>raw bytes before the parser runs</em>, so they are discarded rather than
          parsed and then withheld — there is nothing in memory to leak. What survives goes to local
          trackers, which is what your overlays read: nothing you see about your own client depends on
          the network. Only the shareable remainder joins a durable queue that survives restarts, and
          the bot merges it with every other raider&apos;s view of the same fight.
        </p>
        <Diagram src="/platform/logline.html" title="a log line's journey" height={940} />
      </Section>

      <Section eyebrow="Diagram 3" title="How an overlay knows anything">
        <p className="max-w-3xl text-sm leading-7 text-dim">
          Two local sources with different clocks. The <strong className="text-text">Zeal pipe</strong> is
          fast and shallow — names and health, sub-second, no identity. The{' '}
          <strong className="text-text">combat log</strong> is slower and exact: it is the only thing that
          says who did what to whom. Both land in one tracker layer, and overlays hold no state of their
          own; they poll the agent and paint. That is why fixing one tracker corrects every window that
          shows it.
        </p>
        <Diagram src="/platform/overlays.html" title="the overlay pipeline" height={880} />
        <Table head={['Overlay', 'Reads from', 'What it does']} rows={OVERLAYS} />
        <p className="text-xs text-dim leading-6">
          Every overlay carries the same furniture: a ✕ to hide it, a ✥ to drag it, a right-click menu
          for size presets, and a hover handshake so its buttons work even though a locked overlay is
          click-through to the game.
        </p>
      </Section>

      <Section eyebrow="Diagram 4" title="What the bot talks to">
        <p className="max-w-3xl text-sm leading-7 text-dim">
          Three of these are somebody else&apos;s server, and one of them is a guild member&apos;s own
          AWS bill — which is why outbound calls carry a per-minute budget, a shared cache so N clients
          cost one upstream call, and a kill switch that works without a deploy. Nothing pushes into us
          except the agent fleet, over a single bearer-authenticated surface with per-uploader admission
          budgets.
        </p>
        <Diagram src="/platform/integrations.html" title="the integration map" height={880} />
        <Table head={['Integration', 'Kind', 'What it is for']} rows={INTEGRATIONS} />
      </Section>

      <Section eyebrow="Surfaces" title="Where you actually look at it">
        <p className="max-w-3xl text-sm leading-7 text-dim">
          Five places, deliberately. The first two run on the raider&apos;s own machine and keep working
          with the network down; the last three are the shared record.
        </p>
        <Table head={['Dashboard', 'Where', 'What it shows']} rows={DASHBOARDS} />
      </Section>

      <section className="border-t border-border pt-6 text-xs text-dim space-y-2">
        <p>
          Diagrams generated with{' '}
          <a href="https://github.com/tt-a1i/archify" target="_blank" rel="noreferrer"
             className="text-blue hover:underline">archify ↗</a>{' '}
          (MIT) from typed JSON kept in the repo at <span className="text-text">docs/diagrams/</span>.
          Each one validates against archify&apos;s showcase profile with zero errors before it ships.
        </p>
        <p className="space-x-3">
          <Link href="/platform" className="text-blue hover:underline">← back to the platform overview</Link>
          <a href="https://github.com/davehess/QuarmBossTracker" target="_blank" rel="noreferrer"
             className="text-blue hover:underline">source ↗</a>
          <Link href="/privacy" className="text-blue hover:underline">privacy</Link>
        </p>
      </section>
    </div>
  );
}
