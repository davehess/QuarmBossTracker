// Made-up spawn board for the boards-next-up draft. Times are minutes from a fixed "now", so screenshots are stable.
// Boss and zone names are game data; the timers are invented.
import type { BoardRowIn } from '@/lib/boardsNextUpView';

export const LAB_NOW = Date.UTC(2026, 10, 15, 1, 0, 0);
export const LAB_EXPANSIONS = ['Classic', 'Kunark', 'Velious', 'Luclin', 'PoP'] as const;
export const LAB_LABELS: Record<string, string> = {
  Classic: 'Classic EverQuest', Kunark: 'Ruins of Kunark', Velious: 'Scars of Velious', Luclin: 'Shadows of Luclin', PoP: 'Planes of Power',
};

const D = 1440;
// [id, name, zone, expansion, timer hours, minutes until it opens (null or negative: up now)]
const T: [string, string, string, string, number, number | null][] = [
  ['nag', 'Lord Nagafen', 'Nagafen\'s Lair', 'Classic', 72, -45],
  ['vox', 'Lady Vox', 'Permafrost Keep', 'Classic', 72, 4 * D + 300],
  ['cazic', 'Cazic Thule', 'Lair of the Spider Clan', 'Classic', 168, 5 * D + 90],
  ['phini', 'Phinigel Autropos', 'Kedge Keep', 'Classic', 96, 3 * D + 15],
  ['sev', 'Severilous', 'Temple of Veeshan Approach', 'Classic', 120, 6 * D + 700],
  ['ven', 'Venril Sathir', 'Karnor\'s Castle', 'Classic', 168, 2 * D + 640],
  ['tun', 'Tunare, Queen of the Faydark', 'Plane of Growth', 'Classic', 168, 6 * D + 60],
  ['gorg', 'The Gorgalosk', 'Swamp of No Hope', 'Classic', 72, 3 * D + 880],
  ['trak', 'Trakanon', 'Sebilis', 'Kunark', 168, 3 * D + 200],
  ['gore', 'Gorenaire', 'Trakanon\'s Teeth', 'Kunark', 168, 4 * D + 20],
  ['talen', 'Talendor', 'Trakanon\'s Teeth', 'Kunark', 168, 4 * D + 480],
  ['vulak', 'Vulak`Aerr', 'Veeshan\'s Peak', 'Kunark', 168, 5 * D + 760],
  ['ghar', 'Ghaz Gharol Vaxxthrall', 'Chardok', 'Kunark', 96, 2 * D + 200],
  ['dark', 'Dread', 'Fear Plane', 'Kunark', 72, 2 * D + 1100],
  ['sevi', 'Lord Inquisitor Seru, Keeper of the Forbidden Archive', 'Howling Stones', 'Kunark', 120, 3 * D + 40],
  ['zlex', 'Zlandicar', 'Dragon Necropolis', 'Kunark', 168, 6 * D + 300],
  ['dain', 'Dain Frostreaver IV', 'Thurgadin', 'Velious', 168, -3],
  ['hoshk', 'Hoshkar', 'Skyshrine', 'Velious', 168, 12],
  ['vind', 'Lord Vyemm', 'Temple of Veeshan', 'Velious', 144, 7 * 60 + 25],
  ['klan', 'Klandicar', 'Dragon Necropolis', 'Velious', 168, 2 * D + 330],
  ['wurm', 'Wuoshi', 'Wakening Land', 'Velious', 168, 3 * D + 700],
  ['yelin', 'Yelinak', 'Velketor\'s Labyrinth', 'Velious', 168, 4 * D + 160],
  ['kael', 'King Tormax', 'Kael Drakkel', 'Velious', 120, 9 * 60 + 40],
  ['aryn', 'Arch Lich Rhag`Zadune', 'Plane of Fear', 'Velious', 96, 11 * 60 + 50],
  ['ssra', 'Emperor Ssraeshza', 'Ssraeshza Temple', 'Luclin', 168, null],
  ['aten', 'Aten Ha Ra', 'Vex Thal', 'Luclin', 168, 26],
  ['xtz', 'Xana the Seer', 'The Deep', 'Luclin', 72, 2 * 60 + 15],
  ['dkir', 'Dozekar the Cursed', 'Grimling Forest', 'Luclin', 72, 5 * 60 + 5],
  ['thex', 'Thought Horror Overlord', 'The Deep', 'Luclin', 96, 14 * 60 + 30],
  ['vtal', 'Va Xi Aten Ha Ra', 'Vex Thal', 'Luclin', 168, 2 * D + 20],
  ['kerf', 'Kerafyrm', 'Sleeper\'s Tomb', 'Luclin', 168, 3 * D + 910],
  ['sev2', 'Lord Koi`Doken', 'Katta Castellum', 'Luclin', 120, 20 * 60 + 5],
  ['rall', 'Rallos Zek', 'Plane of Tactics', 'PoP', 168, 3 * 60 + 40],
  ['zeb', 'Zebuxoruk', 'Plane of Time', 'PoP', 168, 6 * 60 + 10],
  ['bert', 'Bertoxxulous', 'Plane of Disease', 'PoP', 168, 13 * 60 + 20],
  ['myth', 'Mithaniel Marr', 'Plane of Valor', 'PoP', 168, 16 * 60 + 45],
  ['carp', 'Carprin Hydrae', 'Plane of Nightmare', 'PoP', 168, 22 * 60 + 15],
  ['hate', 'Innoruuk', 'Plane of Hate', 'PoP', 168, 1 * D + 600],
  ['saryr', 'Saryrn', 'Torment', 'PoP', 168, 2 * D + 710],
  ['quarm', 'Gilgamesh', 'Plane of Earth', 'PoP', 168, 4 * D + 60],
];

export const LAB_ROWS: BoardRowIn[] = T.map(([id, name, zone, expansion, hours, mins]) => ({
  boss_id: id, name, zone, expansion, timer_hours: hours, pqdi_url: null,
  next_spawn: mins === null ? null : new Date(LAB_NOW + mins * 60000).toISOString(),
}));
