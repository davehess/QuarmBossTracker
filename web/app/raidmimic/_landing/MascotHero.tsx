// The hero of the raidmimic "Output first" preview, built on the mascot the guild lead supplied (2026-10-21: "None, that's
// not enough UI. we should have more on there. more of the mimic."; picked: "i like B for the hero"). Read at
// b.wolfpack.quest/raidmimic?v=b. The mascot hops in a loop in the middle and the real captures sit around it as
// cards you can read. (The other candidate, a howl clip that played once, was dropped when this one was picked.)
// Server component; the only script is MascotVideo (reduced motion). Cards animate transform + opacity only.
import { SHOTS, SHOTS_DIR, type Shot } from '@/lib/raidmimicLanding';
import MascotVideo from './MascotVideo';

const DIR = '/raidmimic/mascot';

// One placed card of the stage (lg and up): left / top / width as a percent of the stage, a tilt, the colour of the
// window-title edge, and where it flies in from. Heights follow the capture's own ratio.
// `mw` is the card's width in the swipe row under lg: the tall captures are narrower so the row does not stand 480px high.
const CARDS: { id: string; l: number; t: number; w: number; mw: number; r: number; edge: string; fx: number }[] = [
  { id: 'map',          l: 0,  t: 1,    w: 32, mw: 78, r: -1,   edge: '#56d364', fx: 140 },
  { id: 'target-stats', l: 3,  t: 28.5, w: 29, mw: 78, r: 1,    edge: '#f85149', fx: 160 },
  { id: 'dps',          l: 0,  t: 54,   w: 32, mw: 78, r: -1.5, edge: '#58a6ff', fx: 140 },
  { id: 'target-quest', l: 68, t: 1,    w: 32, mw: 78, r: 1,    edge: '#a371f7', fx: -140 },
  { id: 'rolls',        l: 69, t: 32,   w: 24, mw: 62, r: -1,   edge: '#d29922', fx: -160 },
  { id: 'cc',           l: 75, t: 62.5, w: 19, mw: 54, r: 1.5,  edge: '#ffa657', fx: -140 },
  { id: 'timeline',     l: 34, t: 80,   w: 32, mw: 78, r: 0,    edge: '#e0a92c', fx: 0 },
];

const shotById = (id: string): Shot => {
  const s = SHOTS.find(x => x.id === id);
  if (!s) throw new Error(`raidmimic: no capture "${id}"`);
  return s;
};

const FADE = 'rm-fade block h-auto w-full';

export default function MascotHero() {
  return (
    <section aria-label="The mascot and the overlays it shows" className="relative mb-4 lg:mb-10 lg:aspect-[1152/860]">
      {/* The clip is wider than the gap between the cards on purpose: its edges are dark and faded, the cards sit above. */}
      <div className="mx-auto w-[min(72%,300px)] lg:absolute lg:left-[24%] lg:top-[5%] lg:w-[52%]">
        <MascotVideo src={`${DIR}/hop.mp4`} poster={`${DIR}/hop-poster.jpg`} loop className={FADE}
          alt="The raidmimic mascot, a wooden treasure chest with wolf ears, hopping in a circle." />
      </div>
      {/* Under lg the cards are a swipe row under the mascot; from lg they leave the flow and fan out around it. */}
      <ul className="m-0 mt-2 flex list-none items-start snap-x snap-mandatory gap-3 overflow-x-auto p-0 pb-3 lg:contents">
        {CARDS.map((c, i) => {
          const s = shotById(c.id);
          const src = `${SHOTS_DIR}/${s.file}`;
          return (
            <li key={c.id}
              className="rm-card w-[var(--mw)] max-w-[340px] shrink-0 snap-start lg:absolute lg:left-[var(--l)] lg:top-[var(--t)] lg:w-[var(--w)] lg:max-w-none lg:hover:z-20"
              style={{
                '--l': `${c.l}%`, '--t': `${c.t}%`, '--w': `${c.w}%`, '--mw': `${c.mw}%`,'--r': `${c.r}deg`, '--fx': `${c.fx}px`, '--d': `${120 + i * 90}ms`,
              } as React.CSSProperties}>
              <a href={src} target="_blank" rel="noreferrer" aria-label={`${s.title}: open the full-size capture`}
                className="block overflow-hidden rounded-md border border-border border-t-[3px] bg-bg shadow-lg shadow-black/40 hover:no-underline"
                style={{ borderTopColor: c.edge }}>
                <span className="block bg-panel px-2 py-1 text-[11px] leading-4 text-dim">{s.title}</span>
                <img src={src} width={s.w} height={s.h} alt={s.alt} decoding="async" className="block h-auto w-full" />
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
