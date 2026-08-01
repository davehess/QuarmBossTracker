// The new-member walkthrough — one clickthrough across the member surfaces,
// re-runnable any time from the ✨ Tour button, always over the member's OWN
// live data (nothing is mocked; every page shows what the guild has actually
// recorded about them). Copy leans on what the member has ACCOMPLISHED —
// their characters, their parses, their standing — per Hitya 2026-08-01.
//
// PvP is deliberately not part of the core loop: the last core step offers it
// as an opt-in branch ("don't make a huge deal out of the PVP parts unless
// they ask to see them").
//
// `selector` is a CSS selector resolved on the step's route. Prefer
// `[data-tour=…]` anchors (stable, grep-able) where per-element precision
// matters; nav chips + page containers otherwise. A missing target renders
// the card centered instead of spotlit, so an empty page never strands the
// tour.

export type TourStep = {
  route: string;         // pathname the step lives on
  selector: string;      // what to spotlight there
  title: string;
  body: string;
  pvp?: boolean;         // branch step — only shown after the opt-in
  offersPvp?: boolean;   // final core step — renders the PvP opt-in button
};

export const TOUR_STEPS: TourStep[] = [
  {
    route: '/me',
    selector: '[data-tour="me-characters"]',
    title: '👤 Your corner of the pack',
    body: 'These are your characters — every one the guild\'s data knows is yours. Levels, gear, buffs, and stats hang off them, and the exclusion toggles here always win: your logs stay on your machine unless you say otherwise.',
  },
  {
    route: '/me',
    selector: '[data-tour="me-scrap"]',
    title: '🐺 The Scrap',
    body: 'Your damage standing this month against the rest of the pack. Top Dog is earned, not given — everything it counts comes from fights you were actually in.',
  },
  {
    route: '/parses',
    selector: 'main > *:first-child',
    title: '📊 Every fight, remembered',
    body: 'Raid parses the pack has recorded — including the ones you were in. Open any fight for the full breakdown: rankings, healers, deaths, and a View in Discord jump to that night\'s thread.',
  },
  {
    route: '/boards',
    selector: 'main > *:first-child',
    title: '⏱️ The boss boards',
    body: 'Live spawn timers for every boss we track, straight from raid kills as they happen. When a window opens, Discord hears about it — this page is the same clock the raid runs on.',
  },
  {
    route: '/raid',
    selector: 'main > *:first-child',
    title: '🧭 Raid night, live',
    body: 'During a raid this is the live card — who\'s on, buffs and resists per raider, and what needs covering. Your own row lights up here when you\'re logged in with the parser running.',
  },
  {
    route: '/buffs',
    selector: 'main > *:first-child',
    title: '🧪 Buff coverage',
    body: 'Who has what running right now, and what\'s missing. If you\'ve ever wondered whether your Virtue made it to the whole raid — this is where it shows.',
  },
  {
    route: '/quartermaster',
    selector: 'main > *:first-child',
    title: '🧰 The Quartermaster',
    body: 'Utility-kit coverage and quest checklists — resist gear, clickies, and the errands worth running between raids. It reads your uploaded inventory, so the checkmarks are genuinely yours.',
  },
  {
    route: '/db',
    selector: 'main > *:first-child',
    title: '📚 Our own database',
    body: 'Items, mobs, spells, factions — the guild\'s in-house reference, built from the same data the server runs on. Search anything from the bar up top; no more waiting on third-party sites to load.',
  },
  {
    route: '/leaderboards',
    selector: 'main > *:first-child',
    title: '🏆 Ranks',
    body: 'Where your name climbs. Damage, healing, attendance — every board here is built from recorded fights, so a spot on it is something you did, not something you claimed.',
  },
  {
    route: '/rolls',
    selector: 'main > *:first-child',
    title: '🎲 Roll nights',
    body: 'Off-night loot rolls, captured automatically — each item, its roll range, and who won it. If you\'ve ever won a Hot Dice night, it\'s in here forever.',
  },
  {
    route: '/roadmap',
    selector: 'main > *:first-child',
    title: '🗺️ That\'s the tour!',
    body: 'The roadmap is where every release lands in plain language — what\'s new, what\'s coming, what your feedback changed. Check back after patches. And if the battlefields ever call, we keep a PvP scene too — up to you.',
    offersPvp: true,
  },
  {
    route: '/pvp',
    selector: 'main > *:first-child',
    title: '⚔️ The Zek watch',
    body: 'Kills, deaths, and boss windows on the PvP side, tracked the same way as everything else. If this is your thing, grab the PVP role in Discord (the welcome card has a button) and the alerts find you.',
    pvp: true,
  },
];
