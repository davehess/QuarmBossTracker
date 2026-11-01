// The raidmimic landing's `?v=c` ("Story stage") and `?v=d` ("Chapters") variants: the one place their timeline, words and
// money live (the guild lead, 2026-11-01: "underwhelming ... the video ... started as the primary view ... menus appear as the
// video progresses ... way less wordy, less of the same pictures ... start for free, unlock pro with guild or individual plan").
// Pure data and pure functions, so test/raidmimic-landing-variants.test.js runs the real thing.

// ─── The story's timeline ───────────────────────────────────────────────────────────────────────────
// Measured on story-720.mp4 (81.5 s) frame by frame at 0.2 s steps, 2026-11-01. Re-measure if the video is re-cut. Change
// them HERE and nowhere else: both variants read this one object.
export const STORY_CUES = {
  mimicIcon: 10.8,  // the chest has become the mimic (grin done, "Hi! I'm Raid Mimic!"): the icon appears top-left
  overlays: 23.0,   // the first overlay comes out of its mouth: the top menu appears
  calls: 29.3,      // the player's calls turn the fight
  loot: 49.4,       // the loot card appears
  hail: 61.0,       // "hail the Projection for your flags"
  end: 81.5,        // the story is over: the video dims and the sign-up card appears
} as const;
export type StoryCues = { [K in keyof typeof STORY_CUES]: number };

/** What the page chrome shows at time `t` seconds into the story. `all` (skip, reduced motion) shows everything at once. */
export interface Reveal { icon: boolean; menu: boolean; end: boolean }
export function revealAt(t: number, all = false, cues: StoryCues = STORY_CUES): Reveal {
  if (all) return { icon: true, menu: true, end: true };
  const x = Number.isFinite(t) ? t : 0;
  return { icon: x >= cues.mimicIcon, menu: x >= cues.overlays, end: x >= cues.end };
}
export const sameReveal = (a: Reveal, b: Reveal) => a.icon === b.icon && a.menu === b.menu && a.end === b.end;

// ─── Features (four, one picture and one sentence each) ──────────────────────────────────────────────
// The pictures are plain strings, not imports: a file that is not on disk yet is a 404 in a preview, never a failed build.
// `chip` marks a promise: anything not built yet says "coming" (CLAUDE.md, honesty rule; web/lib/raidmimicLanding.ts COMING).
export type FeatureId = 'canvas' | 'studio' | 'sync' | 'replay';
export interface Feature { id: FeatureId; name: string; line: string; img: string; alt: string; chip?: string }
const SHOTS = '/raidmimic/shots';
export const FEATURES: readonly Feature[] = [
  { id: 'canvas', name: 'Canvas & builder', line: 'Standard overlays on one canvas, or build your own.',
    img: `${SHOTS}/canvas-overlays.webp`,
    alt: 'The Mimic canvas: the standard overlays (damage, target debuffs, timers) laid out on one screen over the game.' },
  { id: 'studio', name: 'UI Studio', line: 'Design your EverQuest UI once, keep every version.',
    img: `${SHOTS}/ui-studio.webp`,
    alt: 'UI Studio: a layout of the game window being arranged, with the list of saved versions beside it.' },
  { id: 'sync', name: 'Sync', line: 'Your layouts and backups follow you to every PC.', chip: 'Cloud backup is coming',
    img: `${SHOTS}/sync.webp`,
    alt: 'Two computers showing the same overlay layout.' },
  { id: 'replay', name: 'Replay & spectator', line: 'Watch the raid back, or live, with you highlighted.',
    img: `${SHOTS}/replay.webp`,
    alt: 'The replay board: a raid night as a timeline of fights, with the raiders moving on the map.' },
];
export const featureById = (id: FeatureId): Feature => {
  const f = FEATURES.find(x => x.id === id);
  if (!f) throw new Error(`raidmimic story: no feature "${id}"`);
  return f;
};

// ─── Chapters (the `?v=d` rail): a moment in the video, and the feature card it swaps in ─────────────
export interface Chapter { id: string; label: string; at: number; feature: FeatureId }
export const CHAPTERS: readonly Chapter[] = [
  { id: 'overlays', label: 'Overlays', at: STORY_CUES.overlays, feature: 'canvas' },
  { id: 'calls',    label: 'Calls',    at: STORY_CUES.calls,    feature: 'studio' },
  { id: 'loot',     label: 'Loot',     at: STORY_CUES.loot,     feature: 'sync' },
  { id: 'hail',     label: 'Hail',     at: STORY_CUES.hail,     feature: 'replay' },
];
/** The chapter the video is in at `t`: the last one that has started; the first one before any has (the card is never empty). */
export function chapterAt(t: number, chapters: readonly Chapter[] = CHAPTERS): Chapter {
  const x = Number.isFinite(t) ? t : 0;
  let cur = chapters[0];
  for (const c of chapters) if (x >= c.at) cur = c;
  return cur;
}

// ─── Money ──────────────────────────────────────────────────────────────────────────────────────────
// Guild: $25 a month, monthly only, first month free (DECISIONS §495). Individual: NOT decided (DESIGN-raidmimic-hosted.md §8d
// costs options and recommends one; the guild lead has not picked), so the price is `null` and the page says "price at launch".
export const GUILD_PRICE = 25;
export const INDIVIDUAL_PRICE: number | null = null;
export function priceLabel(price: number | null, per = 'month'): string {
  return price == null ? 'price at launch' : `$${price} / ${per}`;
}

export interface Tier { id: 'free' | 'guild' | 'individual'; name: string; price: string; note: string; tone: 'green' | 'blue' | 'gold'; points: string[]; coming?: string }
export const TIERS = (individual: number | null = INDIVIDUAL_PRICE): Tier[] => [
  { id: 'free', name: 'Free', price: '$0', note: 'No account needed.', tone: 'green',
    points: ['The overlays', 'Triggers', 'Your own parses'] },
  { id: 'guild', name: 'Pro · Guild', price: priceLabel(GUILD_PRICE), note: 'Monthly only. First month free.', tone: 'blue',
    points: ['Shared raid reviews', 'Merged parses', 'Replay & spectator', 'Command center', 'Guild Discord bot'],
    coming: 'Live for one guild today. Hosting other guilds is coming.' },
  { id: 'individual', name: 'Pro · Individual', price: priceLabel(individual), note: 'For you, with or without a guild.', tone: 'gold',
    points: ['Cloud sync of your layouts and UI Studio backups', 'Your history and replays, with you highlighted', 'Gear comparisons'],
    coming: 'Coming.' },
];

/** The page's gold button (the same classes as Parts.tsx PRIMARY_BTN), for the client stages that cannot import Parts. */
export const GOLD_BTN =
  'inline-flex min-h-11 items-center justify-center rounded-md border border-gold bg-gold px-4 py-2 text-sm font-semibold text-[#1a1206] no-underline transition-colors hover:bg-[#e0a92c] hover:no-underline disabled:opacity-60 motion-reduce:transition-none';

// ─── Words ──────────────────────────────────────────────────────────────────────────────────────────
export const STORY_WORDS = {
  brand: 'Raid Mimic',
  signUp: 'Sign up with Discord',
  signIn: 'Sign in',
  startFree: 'Start free · Pro for your guild or for you',
  skip: 'Skip',
  again: 'Watch again',
  soundOn: 'Sound on',
  soundOff: 'Sound off',
  ccOn: 'Captions on',
  ccOff: 'Captions off',
  scroll: 'See what you get',
  menu: [
    { label: 'What you get', href: '#features' },
    { label: 'Pricing', href: '#pricing' },
  ],
  featuresTitle: 'What you get',
  pricingTitle: 'Start free',
  pricingLead: 'Pro for your guild or for you.',
  after: '/guilds',
} as const;

/** Every sentence these variants add, for the sweeps in test/raidmimic-landing-variants.test.js. */
export const STORY_TEXT = [STORY_WORDS, FEATURES, TIERS(), CHAPTERS];
