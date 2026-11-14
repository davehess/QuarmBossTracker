// The words and the pictures of the three raidmimic first-screen drafts, as plain data. Every picture is a real capture or
// clip that already ships under web/public/raidmimic (the same files web/lib/raidmimicLanding.ts and raidmimicStory.ts name);
// nothing here is invented. The headline says what the overlays show during a raid, not what the product is "about".
export interface HeroLinks { download: string; demo: string; setup: string; register: string }
export interface HeroShot { src: string; w: number; h: number; alt: string; label: string }
export interface HeroCopy {
  headline: string; sentence: string;
  download: string; demo: string; demoShort: string; watch: string; closeStory: string;
  raidTitle: string; raidLine: string; setup: string;
  guildTitle: string; guildLine: string; register: string;
  storyTitle: string; aiLabel: string; skip: string; again: string;
}
export interface HeroMedia {
  video: { src: string; poster: string; endPoster: string; captions: string };
  dps: HeroShot; stats: HeroShot; cc: HeroShot;
}

export const COPY: HeroCopy = {
  headline: 'Damage, boss debuffs and timers, on your screen while you raid',
  sentence: 'Raid Mimic reads the log EverQuest already writes and draws overlays over your game: damage meters, what is on the boss, spawn timers and who still has to hail. Free and open source.',
  download: 'Download Mimic',
  demo: 'See the guild demo',
  demoShort: 'See the demo',
  watch: 'Watch the 80-second story',
  closeStory: 'Close the story',
  raidTitle: 'I raid',
  raidLine: 'Overlays on your own screen: who does the damage, what is on the boss, what is due next. Free, no account needed.',
  setup: 'Then set it up',
  guildTitle: 'I run a guild',
  guildLine: 'Shared raid reviews, merged parses and a command center for your officers, built from the same log.',
  register: 'Then register interest',
  storyTitle: 'The 80-second story',
  aiLabel: 'Animated with AI tools',
  skip: 'Skip video',
  again: 'Watch again',
};

const SHOTS = '/raidmimic/shots';
const MOTION = '/raidmimic/motion';
export const MEDIA: HeroMedia = {
  video: {
    src: `${MOTION}/story-sq-1080.mp4`,
    poster: `${MOTION}/story-first-sq-poster.jpg`,
    endPoster: `${MOTION}/story-sq-poster.jpg`,
    captions: `${MOTION}/story.vtt`,
  },
  dps: { src: `${SHOTS}/dps.webp`, w: 1712, h: 800, label: 'Damage meters',
    alt: 'Two damage overlays side by side: a ranked list of bars split into swings, procs and spells, and a table of damage, share, damage per second and seconds for each raider, with pets folded into their owners.' },
  stats: { src: `${SHOTS}/target-stats.webp`, w: 1208, h: 688, label: 'Debuffs on the boss',
    alt: 'The Target Info overlay on a nightstalker: a slow timer, six observed debuffs with the caster and a draining bar each, armour class and resists, and chips for its special abilities.' },
  cc: { src: `${SHOTS}/cc.webp`, w: 960, h: 1358, label: 'Command Center',
    alt: 'The Command Center overlay: the target’s health, a rampage warning, a hail board listing who still has to hail before the projection leaves, a defensive cooldown, healer mana bars, curse and disease cure requests and the last two deaths.' },
};
