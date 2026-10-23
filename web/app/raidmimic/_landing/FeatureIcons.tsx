// The raidmimic.com feature icons and the grid that carries them (the guild lead's pick, 2026-10-23: "the second set looks best").
// Eight hand-drawn line icons on a 48 x 48 box, one stroke weight, round caps and joins. Gold is `currentColor` (set once on the
// svg, so it follows the text colour); the two accents are fixed and MEAN something: green is "good / here" (the map pin, the
// check), red is "heal" (the cross on the drop). Shapes that cross another line are filled with the card colour (`fill-panel`)
// so the line behind them is cut instead of showing through. No raster, no <image>, no font, no request: inline paths only.
// The cards are CSS, not part of the drawing; the icon is decorative (aria-hidden) and the label is the text.
// The words are in web/lib/raidmimicFeatures.ts. Server component.
import type { ReactNode } from 'react';
import { FEATURES, FEATURES_HEAD, type FeatureId } from '@/lib/raidmimicFeatures';
import { TAG } from '@/lib/raidmimicPlayer';

function Ico({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false" className="h-full w-full">
      {children}
    </svg>
  );
}

/** Timers: an hourglass with a progress pill under it. */
export function TimersIcon() {
  return (
    <Ico>
      <path d="M13 5H35" />
      <path d="M13 34H35" />
      <path d="M16 5V9C16 15 21.5 19.5 24 21C26.5 19.5 32 15 32 9V5" />
      <path d="M16 34V30C16 24 21.5 22.5 24 21C26.5 22.5 32 24 32 30V34" />
      <path d="M19 12H29C28 15 26 17.5 24 19C22 17.5 20 15 19 12Z" fill="currentColor" />
      <path d="M18.5 34C19.5 30.5 21.5 28.5 24 27C26.5 28.5 28.5 30.5 29.5 34Z" fill="currentColor" />
      <rect x="9" y="39" width="30" height="5" rx="2.5" />
      <path d="M12.5 41.5H22" strokeWidth={2.25} />
    </Ico>
  );
}

/** Map: a folded map with a green location pin. */
export function MapIcon() {
  return (
    <Ico>
      <path d="M5 23L16 19L32 23L43 19V40L32 44L16 40L5 44Z" />
      <path d="M16 19V40" />
      <path d="M32 23V44" />
      <path d="M24 28C19.5 22.5 17 19 17 15C17 11 20 8 24 8C28 8 31 11 31 15C31 19 28.5 22.5 24 28Z" className="fill-panel stroke-green" />
      <circle cx="24" cy="15" r="2.6" className="stroke-green" />
    </Ico>
  );
}

/** Target Info: a crosshair with a small shield at its lower right. */
export function TargetIcon() {
  return (
    <Ico>
      <circle cx="21" cy="21" r="12" />
      <path d="M21 4V13" />
      <path d="M21 29V38" />
      <path d="M4 21H13" />
      <path d="M29 21H38" />
      <path d="M35.5 27L43 30V35.5C43 40.5 39.5 43.5 35.5 45.5C31.5 43.5 28 40.5 28 35.5V30Z" className="fill-panel" />
    </Ico>
  );
}

/** Damage meter: three rising bars on a baseline. */
export function DamageIcon() {
  return (
    <Ico>
      <path d="M5 41H43" />
      <rect x="9" y="26" width="8" height="15" rx="1.5" />
      <rect x="20" y="17" width="8" height="24" rx="1.5" />
      <rect x="31" y="8" width="8" height="33" rx="1.5" />
    </Ico>
  );
}

/** Loot rolls: a die beside a small chest. */
export function LootIcon() {
  return (
    <Ico>
      <rect x="5" y="6" width="22" height="22" rx="4.5" />
      <circle cx="11.5" cy="12.5" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="20.5" cy="12.5" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="16" cy="17" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="11.5" cy="21.5" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="20.5" cy="21.5" r="1.4" fill="currentColor" stroke="none" />
      <path d="M22 34C22 28 26 25.5 32.5 25.5C39 25.5 43 28 43 34V43H22Z" className="fill-panel" />
      <path d="M22 34H43" />
      <rect x="29.5" y="32" width="6" height="6" rx="1.5" />
      <path d="M32.5 34.5V35.5" />
    </Ico>
  );
}

/** Hail board: a speech bubble with a green check. */
export function HailIcon() {
  return (
    <Ico>
      <path d="M24 7C14 7 6 13.5 6 21.5C6 26 8.3 30 12 32.6C11.6 35.5 10.5 38 8.5 40.5C13 40 16.5 38.5 19 36.8C20.6 37 22.3 37.2 24 37.2C34 37.2 42 30.5 42 21.5C42 13.5 34 7 24 7Z" />
      <path d="M15.5 22L21.5 28L33 16" strokeWidth={2.75} className="stroke-green" />
    </Ico>
  );
}

/** CH chain: a drop with a red cross at its lower right. */
export function ChIcon() {
  return (
    <Ico>
      <path d="M22 5C16 12.5 9 20 9 28C9 35.2 14.8 41 22 41C29.2 41 35 35.2 35 28C35 20 28 12.5 22 5Z" />
      <path d="M15.5 28C15.5 31.5 17.5 34 20.5 35" />
      <path d="M33 29H39V33H43V39H39V43H33V39H29V33H33Z" className="fill-panel stroke-red" />
    </Ico>
  );
}

/** Join with a code: a ticket with a key. */
export function CodeIcon() {
  return (
    <Ico>
      <g transform="rotate(-38 21 22)">
        <path d="M4 12H38V19.5A3 3 0 0 0 38 25.5V33H4V25.5A3 3 0 0 0 4 19.5Z" />
        <rect x="9" y="17" width="24" height="10" rx="1.5" />
      </g>
      <path d="M35 34L27 42" strokeWidth={7} className="stroke-panel" />
      <path d="M35 34L27 42" />
      <path d="M31 38L33.5 40.5" />
      <path d="M28.5 40.5L30.5 42.5" />
      <circle cx="38" cy="31" r="4.2" className="fill-panel" />
    </Ico>
  );
}

export const ICONS: Record<FeatureId, () => ReactNode> = {
  timers: TimersIcon, map: MapIcon, target: TargetIcon, damage: DamageIcon,
  loot: LootIcon, hail: HailIcon, ch: ChIcon, code: CodeIcon,
};

/** The section: eight cards, four across from lg, two across on a phone. */
export default function FeatureGrid() {
  return (
    <section id={FEATURES_HEAD.id} aria-label={FEATURES_HEAD.title} className="mt-10 scroll-mt-4">
      <h2 className="text-xl text-[#f2ede1] sm:text-2xl">{FEATURES_HEAD.title}</h2>
      <p className="mb-4 mt-1 max-w-[62ch] text-sm leading-6 text-text">{FEATURES_HEAD.lead}</p>
      <ul className="m-0 grid list-none grid-cols-2 gap-4 p-0 lg:grid-cols-4">
        {FEATURES.map(f => {
          const Icon = ICONS[f.id];
          return (
            <li key={f.id} data-feature={f.id} className="flex min-w-0 flex-col rounded-lg border border-border bg-panel p-3 sm:p-4">
              <span aria-hidden="true" className="block h-12 w-12 text-[#e0a92c] sm:h-14 sm:w-14"><Icon /></span>
              <h3 className="mt-3 text-sm font-semibold leading-5 text-[#f2ede1] sm:text-base">{f.label}</h3>
              <p className="mt-1 text-xs leading-5 text-text sm:text-sm sm:leading-6">{f.line}</p>
              {f.hub && (
                <p className="mt-auto pt-3">
                  <span data-tone="hub" className="inline-flex items-center rounded border border-blue/60 px-1.5 py-0.5 text-[11px] leading-4 tracking-wide text-blue">{TAG.hub}</span>
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
