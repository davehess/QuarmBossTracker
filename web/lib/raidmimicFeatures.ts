// The eight feature cards on the raidmimic.com page, under the three doors (the guild lead, 2026-10-23: the feature icon set,
// "the second set looks best"). Plain data and strings: no JSX. The drawings are in
// web/app/raidmimic/_landing/FeatureIcons.tsx and are matched to these rows by `id`; test/raidmimic-feature-icons.test.js
// holds the two together.
//
// RULE for every line (same as raidmimicPlayer.ts): say what runs today. Checked against the captures' own lines in
// raidmimicLanding.ts (SHOTS, CLIPS) and the setup guide in raidmimicSetup.ts:
//   timers .... trigger overlay: countdown timers; spoken alerts are the trigger's TTS action
//   map ....... "Spawn timers on the map ... with your raid on it" (SHOTS 'map')
//   target .... SHOTS 'target-debuffs' / 'target-stats'
//   damage .... SHOTS 'dps': bars or a table, pets under their owner
//   loot ...... SHOTS 'rolls': every roll, highest first. DKP bids come from the guild's OpenDKP through the hub, so the
//               line says they need one
//   hail ...... CLIPS 'grummus-hail' (the Command Center, which the Guild door lists as hub-side)
//   ch chain .. SHOTS 'ch-chain'; the Guild door lists it as hub-side
//   code ...... raidmimicSetup.ts "Join a raid with a code ... It works for 6 hours"; no guild account needed
// `hub` puts the page's own "Needs your guild’s server" chip on the card, for a card that needs a hub as a whole; a card
// that needs one for only a part of it says so in its line instead.
//
// ⚠ This repo is PUBLIC. Nothing here names a member, a character, an id, a token or an address.

export type FeatureId = 'timers' | 'map' | 'target' | 'damage' | 'loot' | 'hail' | 'ch' | 'code';

export interface Feature {
  id: FeatureId;
  label: string;
  line: string;
  hub?: true;
}

export const FEATURES_HEAD = {
  id: 'features',
  title: 'What you get',
  lead: 'Eight of the overlays and tools raiders reach for most.',
};

export const FEATURES: Feature[] = [
  { id: 'timers', label: 'Timers',
    line: 'Countdowns and spoken alerts, set off by lines in your own game log.' },
  { id: 'map', label: 'Map',
    line: 'Spawn points and respawn timers, with your raid on the map.' },
  { id: 'target', label: 'Target Info',
    line: 'The debuffs on your target and who cast them, its resists and what it can do.' },
  { id: 'damage', label: 'Damage meter',
    line: 'The fight as bars or a table, with each pet counted under its owner.' },
  { id: 'loot', label: 'Loot rolls',
    line: 'Every roll for every item, highest first. DKP bids need a guild hub.' },
  { id: 'hail', label: 'Hail board', hub: true,
    line: 'Who has hailed the boss’s projection and who still has to.' },
  { id: 'ch', label: 'CH chain', hub: true,
    line: 'The Complete Heal rotation on the tank, with a warning when a heal is late.' },
  { id: 'code', label: 'Join with a code',
    line: 'Type the short code from a raid leader to join their raid. No guild account needed.' },
];
