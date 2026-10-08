// The Zeal tag icons shown on /zeal-icons: what each /tag key draws, and the picture files we host.
//
// Mirrors the guild lead's Zeal fork, not upstream Zeal: GUILDS is kGuilds in tag_shapes.cpp (same
// order, same codes), SYMBOLS are the icon keys in nameplate.cpp. The images in public/zeal/marks are
// rendered from those meshes (public/zeal/PROVENANCE.txt). When a guild is added to kGuilds, add it
// here and re-run the export, or its card shows a broken image; test/zeal-icons-page.test.js checks
// every image named here exists.

export type Picture = {
  file: string;   // Under public/zeal/tagicons; the file name is the tag key (EUR.png -> ^IEUR^).
  width: number;
  height: number;
};

export type Guild = {
  code: string;         // ^B<code>^ banner, ^I<code>^ icon.
  name: string;
  pictures?: Picture[]; // Downloadable picture files, PNG first.
};

export const GUILDS: Guild[] = [
  { code: 'WP', name: 'Wolf Pack' },
  { code: 'MAY', name: 'Mayhem' },
  {
    code: 'EUR', name: 'Europa',
    pictures: [{ file: 'EUR.png', width: 244, height: 256 }, { file: 'EUR.tga', width: 244, height: 256 }],
  },
  { code: 'TRQ', name: 'Tranquility' },
  { code: 'SOW', name: 'Squirrels of War' },
  { code: 'INT', name: 'Intervention' },
  { code: 'ECG', name: "Erud's Crossing Guard" },
  { code: 'SAV', name: 'Savage' },
  { code: 'BRN', name: 'Burnouts' },
  { code: 'FG', name: 'Former Glory' },
  { code: 'AX', name: 'Axiom' },
  { code: 'HVN', name: 'Haven' },
  { code: 'FRE', name: 'Freedom' },
  { code: 'SOS', name: 'Seekers of Souls' },
  { code: 'HC', name: 'Hardened Casuals' },
  { code: 'NOC', name: 'Nocturnal' },
  { code: 'DND', name: 'Dungeons and Dragons' },
  { code: 'ZEK', name: 'Zek' },
  { code: 'DRF', name: 'The Drift' },
  { code: 'CON', name: 'Continuum' },
  { code: 'ECL', name: 'Eclipse' },
  { code: 'LSF', name: 'Loot & Some Fun' },
  { code: 'NOV', name: 'Novae' },
  { code: 'MGE', name: 'Mass Group Ego' },
  { code: 'BC', name: 'Breakfast Club' },
  { code: 'HBM', name: 'Here There Be Monsters' },
  { code: 'SEN', name: 'Sentinels' },
  { code: 'ALZ', name: 'Alianza' },
  { code: 'CMP', name: 'Camped' },
  { code: 'CVT', name: 'Convicts' },
];

// Uses are given only where the icon was drawn for one; the rest are whatever your raid agrees.
export const SYMBOLS: { key: string; image: string; name: string; use?: string }[] = [
  { key: 'K', image: 'skull', name: 'Skull' },
  { key: 'X', image: 'cross', name: 'X' },
  { key: 'A', image: 'sword', name: 'Sword' },
  { key: 'D', image: 'diamond', name: 'Diamond' },
  { key: 'F', image: 'flame', name: 'Flame' },
  { key: 'T', image: 'star', name: 'Star' },
  { key: 'WP', image: 'wolf', name: 'Wolf', use: 'Wolf Pack' },
  { key: 'M', image: 'moon', name: 'Moon', use: 'mez' },
  { key: 'U', image: 'lasso', name: 'Lasso', use: 'pull' },
  { key: 'N', image: 'lute', name: 'Lute', use: 'bard' },
  { key: 'H', image: 'shield', name: 'Shield', use: 'tank' },
  { key: '$', image: 'dollar', name: 'Dollar' },
  { key: 'E', image: 'euro', name: 'Euro' },
];

export const BADGES = Array.from({ length: 12 }, (_, i) => i + 1);
export const PAW_GLYPHS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// Zeal's own limits for a picture file (tag_arrows.cpp / nameplate.cpp on the tag-icon-files branch).
export const PICTURE_RULES = { maxPixels: 512, maxBytes: 1024 * 1024, maxNameLength: 6 };
export const TAGICONS_FOLDER = 'EverQuest\\uifiles\\zeal\\tagicons';
export const DISCORD_URL = 'https://discord.wolfpack.quest';

export const markSrc = {
  banner: (code: string) => `/zeal/marks/banner-${code}.png`,
  guild: (code: string) => `/zeal/marks/guild-${code}.png`,
  symbol: (image: string) => `/zeal/marks/icon-${image}.png`,
  badge: (n: number) => `/zeal/marks/badge-${n}.png`,
  paw: (c: string) => `/zeal/marks/paw-${c}.png`,
  picture: (file: string) => `/zeal/tagicons/${file}`,
};

export function guildByCode(code: string): Guild | undefined {
  const c = code.toUpperCase();
  return GUILDS.find(g => g.code === c);
}
