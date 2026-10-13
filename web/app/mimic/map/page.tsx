// /mimic/map: training for the Mimic Map, for the 2.9 "Cartography Release" (the guild lead, 2026-10-13: "Add a
// training page on the map to send out to the users, give me some samples to see if the training and features of
// the map. Simple terms please, but talk about persistence.").
//
// Two genuinely different samples on one route, picked by ?v=:
//   (default)  A, the guided tour: eight short lessons in the order a new user meets the Map, one picture each.
//   ?v=b       B, the cheat sheet: one dense screen for someone mid-raid: buttons, colours and shapes, and what is kept.
// Both carry the same "what it remembers" facts (the PERSISTENCE list below), because that is the part the guild
// lead asked for by name. Each fact was read out of the Map overlay and the agent's map code, not recalled:
// the claims and the lines that back them are in the session report, and the ledger is docs/MAP-REFINEMENTS.md.
//
// A NEW page, so it ships live with the [beta] tag (CLAUDE.md, DECISIONS §135). Public: it says nothing about
// anyone. The names in the drawings are invented.
import Link from 'next/link';
import type { ReactNode } from 'react';
import NewPageTag from '@/components/NewPageTag';
import { Btn, FigAggro, FigLegs, FigOpen, FigPath, FigShelves, FigSpawn, FigTimers, FigYou, swatch } from './figures';

export const metadata = {
  title: '[beta] The Map — Mimic 2.9, the Cartography Release',
  description: 'How to use the Mimic Map, from opening it to reading a roamer’s path and respawn timers, and exactly what it remembers.',
};

type Tone = 'keep' | 'share' | 'gone';
type Fact = { what: string; where: ReactNode; howLong: ReactNode; shared: ReactNode; tone: Tone };

// What the Map remembers. One list, shown as story cards on the tour and as a table on the cheat sheet.
const PERSISTENCE: Fact[] = [
  {
    what: 'Roamer paths you have watched',
    tone: 'keep',
    where: 'On your computer.',
    howLong: 'Through restarts. They never expire. Up to 3,000 walks per zone; the oldest-seen go first.',
    shared: 'No. Each computer learns its own.',
  },
  {
    what: 'Respawn timers',
    tone: 'keep',
    where: 'On your computer.',
    howLong: 'Through restarts and through zoning. A timer stays until 10 minutes after its window has closed, then drops off.',
    shared: 'Yes, with your raid (or your group, or everyone in the same copy of the zone). When the Map is sure which spawn point a mob died at, or you click a dot, a small note goes to the Wolf Pack server: which spawn point, which mob, when, and your character’s name. Not linked to your account? Nothing is sent or received.',
  },
  {
    what: '“Up · seen” sightings',
    tone: 'keep',
    where: 'On your computer.',
    howLong: 'Shown for 30 minutes after you saw the mob alive on its spawn point.',
    shared: 'Same as timers.',
  },
  {
    what: 'Deaths it could not place (the “?” ones)',
    tone: 'keep',
    where: 'On your computer.',
    howLong: 'Until the longest possible respawn has passed, plus 10 minutes. Two hours if the zone’s data is not loaded.',
    shared: 'Never. Only deaths it is sure of are shared.',
  },
  {
    what: 'The zone’s spawn data',
    tone: 'keep',
    where: 'On your computer, one saved copy per zone, the first time you visit.',
    howLong: 'Kept. Next visit it loads from your computer. When Mimic is linked it checks for updates about once a day.',
    shared: 'Downloaded from Wolf Pack, nothing uploaded. Not linked? Mimic never asks the server, so the Map works in zones it has saved and says “no saved spawn data” in the rest.',
  },
  {
    what: 'Your EverQuest map files',
    tone: 'keep',
    where: 'Read in place on your computer. Brewall’s maps, the ones Zeal draws, are fetched once per zone from Zeal’s public page and saved on your computer.',
    howLong: 'The Map re-reads your files when they change.',
    shared: 'Never uploaded. Nothing about you goes with the download.',
  },
  {
    what: 'The toolbar and your settings',
    tone: 'keep',
    where: 'Saved by the Map window, on your computer. The settings panel says so at the bottom.',
    howLong: 'Until you change them: the toolbar’s edge and whether it stands upright, what is drawn, colours and scheme, background, label size, Labels all/targets/off, Fit zone/group/raid, zoom, Follow lock, heights, the timers list in or out.',
    shared: 'No, and not backed up. A new computer starts with the defaults.',
  },
  {
    what: 'Map on or off, timers in their own window',
    tone: 'keep',
    where: 'Mimic’s own settings, on your computer.',
    howLong: 'Until you change them.',
    shared: 'No.',
  },
  {
    what: 'Walked-path trails, and the faint paths of mobs that died',
    tone: 'gone',
    where: 'In memory only.',
    howLong: 'Cleared when you zone and gone when Mimic restarts. (The walks between waypoints they confirmed are kept; see roamer paths.)',
    shared: 'No.',
  },
  {
    what: 'Which spawn point a live mob is tied to, and Follow target',
    tone: 'gone',
    where: 'In memory only.',
    howLong: 'Cleared when you zone. Follow always starts as Follow me again.',
    shared: 'No.',
  },
  {
    what: 'Your pet’s buff timers (new in this release)',
    tone: 'share',
    where: 'On your computer, with a small backup on the Wolf Pack server: your pet’s buffs, its name, and when you were last seen in your log.',
    howLong: 'They pause while you are logged out (a gap of a minute or more that ends with “Welcome to EverQuest”) and carry on when you are back. Kept through restarts. Your own buffs come straight from the game when you log in.',
    shared: 'Backed up, one small record per character, so a new computer or a reinstall gets them back. Not sent if Mimic is not linked or the character is set to stay out of stats. A charmed pet’s timers and every mob’s timers keep ticking: the world does not pause for them.',
  },
];

const TONE: Record<Tone, { label: string; cls: string }> = {
  keep: { label: 'Kept', cls: 'border-green/60 text-green' },
  share: { label: 'Kept + backed up', cls: 'border-gold/60 text-gold' },
  gone: { label: 'Forgotten', cls: 'border-red/60 text-red' },
};

function Chip({ tone }: { tone: Tone }) {
  const t = TONE[tone];
  return <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${t.cls}`}>{t.label}</span>;
}

function Switcher({ cheat }: { cheat: boolean }) {
  const tab = (on: boolean) =>
    `rounded px-3 py-1.5 text-sm ${on ? 'bg-accent text-white' : 'text-dim hover:text-text'}`;
  return (
    <nav aria-label="Pick a version of this page" className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="inline-flex rounded-md border border-border bg-panel p-0.5">
        <Link href="/mimic/map" className={tab(!cheat)} aria-current={!cheat ? 'page' : undefined}>Guided tour</Link>
        <Link href="/mimic/map?v=b" className={tab(cheat)} aria-current={cheat ? 'page' : undefined}>Cheat sheet</Link>
      </div>
      <span className="text-xs text-dim">
        {cheat ? 'The one-screen version for mid-raid.' : 'Eight short lessons, in the order you will meet things.'}{' '}
        Two samples of the same page: tell us which you would send around.
      </span>
    </nav>
  );
}

function Head({ cheat }: { cheat: boolean }) {
  return (
    <header className="mb-5">
      <NewPageTag note="New page: training for the Map." />
      <h1 className="text-2xl text-gold">The Map</h1>
      <p className="text-sm text-dim">Mimic 2.9, the Cartography Release</p>
      {!cheat && (
        <p className="mt-3 max-w-2xl text-sm leading-relaxed">
          The Map is the zone from above: you, your group and raid, every spot a mob can spawn, and where the mobs you
          watch actually walk. It also remembers some things, so it gets better the more you use it. The last lesson
          says exactly what, and where it is kept. It comes with Mimic 2.9 (<a className="text-blue underline" href="/mimic">get Mimic</a>;
          an install that is already running updates itself).
        </p>
      )}
    </header>
  );
}

// ── Sample A: the guided tour ──────────────────────────────────────────────────────────────────

function Lesson({ n, title, figure, children }: { n: number; title: string; figure: ReactNode; children: ReactNode }) {
  return (
    <li id={`lesson-${n}`} className="grid gap-4 border-t border-border py-6 first:border-t-0 md:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
      <div>
        <h2 className="mb-2 flex items-center gap-3 text-lg text-text">
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gold text-sm text-gold">{n}</span>
          {title}
        </h2>
        <div className="space-y-2 text-sm leading-relaxed [&_b]:text-text [&_li]:ml-4 [&_li]:list-disc">{children}</div>
      </div>
      <div className="space-y-3 md:pt-1">{figure}</div>
    </li>
  );
}

function Tour() {
  return (
    <>
      <ol className="list-none p-0">
        <Lesson n={1} title="Open it" figure={<FigOpen />}>
          <p>
            Open the Map from the Mimic tray menu under <b>Overlays</b>, or from the Overlays tab on the dashboard. Log in
            and zone: the Map needs Zeal running to know where you are.
          </p>
          <p>
            The first time you enter a zone it says <i>loading spawn points…</i> for a moment, then draws. If it says
            <i> this zone is not on the Map yet</i>, we have nothing for that zone. That is not something you did.
          </p>
        </Lesson>

        <Lesson
          n={2}
          title="Find yourself"
          figure={
            <>
              <FigYou />
              <div className="flex flex-wrap gap-1.5">
                <Btn on>Follow me</Btn><Btn>Fit zone</Btn><Btn>✋ Pan / zoom</Btn>
              </div>
            </>
          }
        >
          <p>
            You are the <b className="!text-blue">blue arrow</b>, pointing the way you face. North is up. Your group are
            <b className="!text-green"> green dots</b>, your raid <b className="!text-purple">purple dots</b>. Top left
            is your <code>/loc</code> and how fast you are running; the yellow line under it is the <code>/loc</code> under
            your mouse.
          </p>
          <ul>
            <li><b>Follow me</b> keeps the map moving with you. Drag the map and it switches off.</li>
            <li>Click it again for <b>Follow target</b> (handy with Solidarity of Vision), once more for off.</li>
            <li>Right-click it to <b>lock</b> 🔒: then dragging moves where you sit on screen instead of switching Follow off.</li>
            <li><b>Fit</b> cycles zone, group, raid. A raider parked far away does not stretch it.</li>
            <li>Locked overlays let clicks through to EverQuest. Rest the mouse over <b>✋ Pan / zoom</b>: the wheel zooms, dragging pans. Click it to switch Pan on; right-click to centre on yourself.</li>
          </ul>
        </Lesson>

        <Lesson n={3} title="Read a spawn point" figure={<FigSpawn />}>
          <p>
            Every dot is a place a mob can appear. <b className="!text-text">Grey</b> is ordinary, <b className="!text-gold">gold and bigger</b> is a
            named mob, the <b className="!text-red">biggest red</b> is a raid target.
          </p>
          <ul>
            <li>Hover a dot for what can spawn there, its level, the chance of each, and the respawn time. <b style={{ color: '#9ecbff' }}>↻</b> means it walks a route.</li>
            <li>
              Small icons beside a dot say what the mob can do: 👁 sees invisible, 👁ᵤ sees invisible to undead, 🥷 sees through
              hide, ↯ summons, ☮ cannot be lulled, ⚔ rampage, 💢 enrage, ≋ flurry, ⇅ reverse slow.
            </li>
            <li>Target a mob and a thin green line joins it to its spawn point. If several look-alike roamers share one route, the Map cannot tell which you have, so it draws faint dashed lines to all of their points.</li>
          </ul>
        </Lesson>

        <Lesson n={4} title="Aggro rings" figure={<FigAggro />}>
          <p>
            Press <b>◯</b> to draw how close you can get to each spawn before it aggros. The colour is worked out from
            its faction, your race, class and deity, and your con.
          </p>
          <ul>
            <li><b className="!text-red">Red:</b> it would aggro you.</li>
            <li><b className="!text-gold">Yellow:</b> it would not aggro you, but it aggros some players.</li>
            <li><b className="!text-green">Green:</b> it aggros nobody.</li>
            <li><b>Dashed ring:</b> how far it comes to help a friend (social aggro).</li>
          </ul>
          <p>Your target always carries its own rings, wherever it walks. A spawn point on a running timer has none: nothing is there.</p>
        </Lesson>

        <Lesson
          n={5}
          title="Read a roamer’s path"
          figure={<><FigPath /><FigLegs /></>}
        >
          <p>Target the roamer. You get an <b className="!text-orange">orange ring</b>, a dotted orange line to you, and the distance on it. Behind it, the path it has walked since you targeted it, in colour:</p>
          <ul>
            <li><b style={{ color: '#ffd23f' }}>Yellow:</b> on its route, or at its spawn spot.</li>
            <li><b style={{ color: '#ff3b30' }}>Red:</b> off its route and getting further. A red glow marks the spot where it stepped off.</li>
            <li><b style={{ color: '#ff7a33' }}>Reddish-orange:</b> off its route but walking back home.</li>
          </ul>
          <p>
            An arrowhead shows which way it is going. Ahead of it, a dashed line runs to the waypoint it is heading for, with the
            seconds it needs at its pace. With no waypoint in line, a dashed line runs on the way it is heading, about 15 seconds of walking.
          </p>
          <p>
            Under it you will see <b>“84 from spawn”</b> when the Map knows its spawn point. Past 200 it adds
            <i> past gate range (can gate ≤15% HP)</i>. That says it <i>can</i> gate, not that this one will: the Map does not know which mobs have Gate.
          </p>
          <p>
            Mobs that follow a set path show a dashed route line, and yours is drawn bright while the others step back. Mobs that
            pick waypoints at random show <b>diamonds</b> instead: a line through them in order would draw a walk nobody makes.
            Every walk between two waypoints that you watch end to end is counted, and the lower picture is what that builds up
            to. See lesson 8.
          </p>
          <p>When a mob you were watching dies, its path fades, and drops off after three more kills. It comes back faded under the next mob you target from that spawn point.</p>
        </Lesson>

        <Lesson n={6} title="Respawn timers" figure={<FigTimers />}>
          <p>
            A ring on a dot is a timer. <b className="!text-red">Red</b> is not yet, <b className="!text-gold">yellow</b> is it could be up
            any moment, <b className="!text-green">green</b> is it should be up. A ring flashes for about 15 seconds the moment the window opens.
          </p>
          <ul>
            <li>A timer is a <b>range</b> (“up in 4m–6m”), because respawns vary. Named mobs on our boss board use the board’s hours.</li>
            <li>It starts when the Map sees a mob die and knows which spawn point it came from. If it is not sure it draws <b className="!text-purple">?</b> on up to four possible points and starts nothing.</li>
            <li>
              <b>Click a dot</b> to help it: <i>Killed — this one</i> settles a “?”, <i>Empty since now</i> and <i>Up</i> say what you see, <i>Clear timer</i> wipes it.
              A click is a hint; a death the Map actually sees overrides it.
            </li>
            <li><b>Timers ▸</b> slides the list in and out. Right-click it to pop the list into its own window you can move and lock. Click a row to centre the map on it.</li>
            <li>Your raid shares these with you. The list says who saw it (“by Aldenmar”).</li>
          </ul>
        </Lesson>

        <Lesson
          n={7}
          title="The toolbar"
          figure={
            <div className="rounded-md border border-border bg-panel p-3">
              <div className="flex flex-wrap gap-1.5">
                <Btn>⠿</Btn><Btn on>Follow me</Btn><Btn>Fit zone</Btn><Btn>✋ Pan / zoom</Btn><Btn on>Labels: all</Btn><Btn on>•</Btn><Btn>◯</Btn><Btn>⚙</Btn>
              </div>
              <p className="mt-2 text-xs text-dim">…and the same bar stood upright on the left or right edge:</p>
              <div className="mt-1 inline-flex flex-col gap-1.5">
                <Btn>⠿</Btn><Btn on>Follow me</Btn><Btn>Fit zone</Btn><Btn>⚙</Btn>
              </div>
            </div>
          }
        >
          <ul>
            <li><b>⠿</b> drags the whole bar. Let go near an edge and it locks there; on the left or right edge it stands upright.</li>
            <li><b>Labels</b> cycles all, targets, off. Off hides every name but keeps the circles.</li>
            <li><b>•</b> hides or shows spawn points (and their route marks, except your target’s).</li>
            <li><b>◯</b> aggro rings (lesson 4).</li>
            <li>
              <b>⚙</b> opens settings beside the map, where the timers list sits, so you can watch the map change as you go. Switch each thing on or off,
              set how far above and below you walls and spawns stay bright, pick colours (Default, High contrast, Colour-blind safe, or your own),
              the background and its opacity, and the label size. <i>Mob names in con colour</i> is off until you ask.
            </li>
            <li>Every Mimic window has <b>✥</b> to move it, <b>✕</b> to hide it and <b>◢</b> to resize it. In Mimic’s settings, <i>Mouse-over opacity</i> makes an overlay brighten under your mouse and fade back after a moment.</li>
          </ul>
        </Lesson>

        <li id="lesson-8" className="border-t border-border pt-6">
          <h2 className="mb-1 flex items-center gap-3 text-lg text-text">
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gold text-sm text-gold">8</span>
            What it remembers
          </h2>
          <Remembers cheat={false} />
        </li>
      </ol>
    </>
  );
}

// ── The persistence section, in both samples ───────────────────────────────────────────────────

function Remembers({ cheat }: { cheat: boolean }) {
  if (cheat) {
    return (
      <div className="overflow-x-auto rounded-md border border-gold/50">
        <table className="w-full min-w-[720px] border-collapse text-left text-xs leading-snug">
          <thead>
            <tr className="bg-panel text-dim">
              <th className="p-2 font-normal">What</th>
              <th className="p-2 font-normal">Kept</th>
              <th className="p-2 font-normal">Where</th>
              <th className="p-2 font-normal">For how long</th>
              <th className="p-2 font-normal">Shared?</th>
            </tr>
          </thead>
          <tbody>
            {PERSISTENCE.map((f) => (
              <tr key={f.what} className="border-t border-border align-top">
                <td className="p-2 text-text">{f.what}</td>
                <td className="p-2"><Chip tone={f.tone} /></td>
                <td className="p-2">{f.where}</td>
                <td className="p-2">{f.howLong}</td>
                <td className="p-2">{f.shared}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm leading-relaxed">
        The short version: the Map keeps what takes a long time to learn (roamer paths, spawn data, timers, your settings)
        on your computer, shares only the notes that help your raid, and forgets the scribbles of a live fight when you zone.
      </p>
      <div className="max-w-sm"><FigShelves /></div>
      <ul className="grid list-none gap-3 p-0 md:grid-cols-2">
        {PERSISTENCE.map((f) => (
          <li key={f.what} className="rounded-md border border-border bg-panel p-3 text-sm leading-relaxed">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <b className="text-text">{f.what}</b>
              <Chip tone={f.tone} />
            </div>
            <dl className="space-y-1 text-[13px]">
              <div><dt className="inline text-dim">Where: </dt><dd className="inline">{f.where}</dd></div>
              <div><dt className="inline text-dim">How long: </dt><dd className="inline">{f.howLong}</dd></div>
              <div><dt className="inline text-dim">Shared: </dt><dd className="inline">{f.shared}</dd></div>
            </dl>
          </li>
        ))}
      </ul>
      <p className="max-w-2xl text-sm leading-relaxed text-dim">
        Your position, your group’s and your raid’s are drawn on your computer and are never uploaded. Which copy of a
        zone you are in (the live zone, a PvP copy, or a guild and raid copy) shows beside the zone name, and timers are
        only shared with people in the same copy.
      </p>
    </div>
  );
}

// ── Sample B: the cheat sheet ──────────────────────────────────────────────────────────────────

function Legend({ title, rows }: { title: string; rows: [ReactNode, ReactNode][] }) {
  return (
    <section className="rounded-md border border-border bg-panel p-3">
      <h3 className="mb-2 text-xs uppercase tracking-wider text-dim">{title}</h3>
      <ul className="list-none space-y-1.5 p-0">
        {rows.map(([sw, text], i) => (
          <li key={i} className="flex items-center gap-2 text-[13px] leading-tight">
            {sw}<span>{text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Cheat() {
  const buttons: [ReactNode, ReactNode][] = [
    [<Btn key="g">⠿</Btn>, 'Drag the bar. Let go near an edge to lock it there; left/right stands it upright.'],
    [<Btn key="f" on>Follow me</Btn>, 'Click: me → target → off. Right-click: lock 🔒. Dragging the map turns it off.'],
    [<Btn key="fit">Fit zone</Btn>, 'Click: zone → group → raid. Stragglers do not stretch it.'],
    [<Btn key="p">✋ Pan / zoom</Btn>, 'Hover: wheel zooms, drag pans. Click: Pan on. Right-click: centre on you.'],
    [<Btn key="l" on>Labels: all</Btn>, 'all → targets → off. Off hides names, keeps the circles.'],
    [<Btn key="d" on>•</Btn>, 'Spawn points on/off (route marks too, but not your target’s).'],
    [<Btn key="a">◯</Btn>, 'Aggro rings on/off.'],
    [<Btn key="s">⚙</Btn>, 'Settings beside the map: what is drawn, heights, icons, colours, opacity, text size.'],
    [<Btn key="t">Timers ▸</Btn>, 'Slide the list in/out. Right-click: its own window.'],
    [<Btn key="w">✥ ✕ ◢</Btn>, 'Move, hide, resize (every Mimic window).'],
  ];
  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-2 text-lg text-text">Buttons</h2>
        <ul className="grid list-none gap-x-6 gap-y-2 p-0 md:grid-cols-2">
          {buttons.map(([b, t], i) => (
            <li key={i} className="flex items-start gap-3 text-[13px] leading-snug">
              <span className="w-[116px] shrink-0">{b}</span><span>{t}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-lg text-text">Colours and shapes</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Legend
            title="Dots"
            rows={[
              [swatch.you, 'You, pointing the way you face. North is up.'],
              [swatch.group, 'Your group.'],
              [swatch.raid, 'Your raid.'],
              [swatch.target, 'Your target.'],
              [swatch.targetLine, 'Dotted line to your target, with the distance.'],
              [swatch.tot, 'Pink arrow: who your target is on, if the Map can place them.'],
              [swatch.dot, 'Spawn point.'],
              [swatch.named, 'Named mob’s spawn point.'],
              [swatch.raidTarget, 'Raid target’s spawn point.'],
              [swatch.seen, 'Green and ringed: seen alive there.'],
              [swatch.walker, '↻ it walks a route.'],
            ]}
          />
          <Legend
            title="Rings"
            rows={[
              [swatch.ringWait, 'Respawn: not yet.'],
              [swatch.ringWindow, 'Respawn: could be up any moment.'],
              [swatch.ringUp, 'Respawn: should be up.'],
              [swatch.ringFlash, 'Flashing: the window just opened.'],
              [swatch.candidate, '? A death was near here, spawn point not sure.'],
              [swatch.aggro, 'Aggro ring, red: it would aggro you.'],
              [swatch.aggroSafe, 'Yellow: aggros some players, not you.'],
              [swatch.aggroNone, 'Green: aggros nobody.'],
              [swatch.assist, 'Dashed: comes to help a friend.'],
            ]}
          />
          <Legend
            title="Lines and arrows"
            rows={[
              [swatch.route, 'Route a mob walks.'],
              [swatch.routeTarget, 'Your target’s route, bright. The others step back.'],
              [swatch.wander, 'Diamonds: a random roamer’s waypoints.'],
              [swatch.legSolid, 'Solid and thick: a walk seen again and again.'],
              [swatch.legFaint, 'Faint and dashed: seen once.'],
              [swatch.pin, 'Thin green: target to its spawn point.'],
              [swatch.trailPath, 'Trail yellow: on its route.'],
              [swatch.trailAway, 'Red: off its route, going further.'],
              [swatch.glow, 'Red glow: where it stepped off.'],
              [swatch.trailBack, 'Reddish-orange: walking back.'],
              [swatch.arrow, 'Arrowhead: the way it is going.'],
              [swatch.heading, 'Dashed ahead: where it is heading (about 15 s).'],
            ]}
          />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <section className="rounded-md border border-border bg-panel p-3 text-[13px] leading-relaxed">
            <h3 className="mb-1 text-xs uppercase tracking-wider text-dim">Icons beside a spawn point</h3>
            👁 sees invisible · 👁ᵤ sees invisible to undead · 🥷 sees through hide · ↯ summons · ☮ cannot be lulled · ⚔ rampage · 💢 enrage · ≋ flurry · ⇅ reverse slow
          </section>
          <section className="rounded-md border border-border bg-panel p-3 text-[13px] leading-relaxed">
            <h3 className="mb-1 text-xs uppercase tracking-wider text-dim">Numbers worth knowing</h3>
            Under your target: <b className="text-text">“N from spawn”</b>. Past <b className="text-text">200</b> it adds <i>past gate range (can gate ≤15% HP)</i>:
            it can, not will. Click a dot: Killed — this one · Empty since now · Up · Clear timer.
          </section>
        </div>
      </section>

      <section id="remembers">
        <h2 className="mb-1 text-lg text-gold">What it remembers</h2>
        <p className="mb-2 text-xs text-dim">
          Kept = stays on your computer. Forgotten = gone when you zone or restart. Your position is never uploaded.
        </p>
        <Remembers cheat />
      </section>
    </div>
  );
}

export default async function MapTrainingPage({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  const { v } = await searchParams;
  const cheat = v === 'b';
  return (
    <div className="mx-auto max-w-5xl py-2">
      <Head cheat={cheat} />
      <Switcher cheat={cheat} />
      {cheat ? <Cheat /> : <Tour />}
      <p className="mt-8 border-t border-border pt-3 text-xs text-dim">
        The Map is new in Mimic 2.9, so some of it is still settling in. If something looks wrong,
        say so on <a href="/feedback" className="underline hover:text-text">feedback</a>.
      </p>
    </div>
  );
}
