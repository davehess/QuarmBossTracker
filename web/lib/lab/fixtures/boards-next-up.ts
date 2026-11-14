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
  ['nag', 'Lord Nagafen', 'Nagafen\'s Lair', 'Classic', 72, null],
  ['vox', 'Lady Vox', 'Permafrost Keep', 'Classic', 72, 4 * D + 300],
  ['cazic', 'Cazic Thule', 'Lair of the Spider Clan', 'Classic', 168, 5 * D + 90],
  ['phini', 'Phinigel Autropos', 'Kedge Keep', 'Classic', 96, null],
  ['sev', 'Severilous', 'Temple of Veeshan Approach', 'Classic', 120, -31],
  ['ven', 'Venril Sathir', 'Karnor\'s Castle', 'Classic', 168, 2 * D + 640],
  ['tun', 'Tunare, Queen of the Faydark', 'Plane of Growth', 'Classic', 168, null],
  ['gorg', 'The Gorgalosk', 'Swamp of No Hope', 'Classic', 72, null],
  ['trak', 'Trakanon', 'Sebilis', 'Kunark', 168, 3 * D + 200],
  ['gore', 'Gorenaire', 'Trakanon\'s Teeth', 'Kunark', 168, -52],
  ['talen', 'Talendor', 'Trakanon\'s Teeth', 'Kunark', 168, null],
  ['vulak', 'Vulak`Aerr', 'Veeshan\'s Peak', 'Kunark', 168, null],
  ['ghar', 'Ghaz Gharol Vaxxthrall', 'Chardok', 'Kunark', 96, -73],
  ['dark', 'Dread', 'Fear Plane', 'Kunark', 72, null],
  ['sevi', 'Lord Inquisitor Seru, Keeper of the Forbidden Archive', 'Howling Stones', 'Kunark', 120, 3 * D + 40],
  ['zlex', 'Zlandicar', 'Dragon Necropolis', 'Kunark', 168, null],
  ['dain', 'Dain Frostreaver IV', 'Thurgadin', 'Velious', 168, -94],
  ['hoshk', 'Hoshkar', 'Skyshrine', 'Velious', 168, 12],
  ['vind', 'Lord Vyemm', 'Temple of Veeshan', 'Velious', 144, null],
  ['klan', 'Klandicar', 'Dragon Necropolis', 'Velious', 168, null],
  ['wurm', 'Wuoshi', 'Wakening Land', 'Velious', 168, -115],
  ['yelin', 'Yelinak', 'Velketor\'s Labyrinth', 'Velious', 168, null],
  ['kael', 'King Tormax', 'Kael Drakkel', 'Velious', 120, 9 * 60 + 40],
  ['aryn', 'Arch Lich Rhag`Zadune', 'Plane of Fear', 'Velious', 96, null],
  ['ssra', 'Emperor Ssraeshza', 'Ssraeshza Temple', 'Luclin', 168, -136],
  ['aten', 'Aten Ha Ra', 'Vex Thal', 'Luclin', 168, 26],
  ['xtz', 'Xana the Seer', 'The Deep', 'Luclin', 72, 2 * 60 + 15],
  ['dkir', 'Dozekar the Cursed', 'Grimling Forest', 'Luclin', 72, null],
  ['thex', 'Thought Horror Overlord', 'The Deep', 'Luclin', 96, null],
  ['vtal', 'Va Xi Aten Ha Ra', 'Vex Thal', 'Luclin', 168, -157],
  ['kerf', 'Kerafyrm', 'Sleeper\'s Tomb', 'Luclin', 168, null],
  ['sev2', 'Lord Koi`Doken', 'Katta Castellum', 'Luclin', 120, null],
  ['rall', 'Rallos Zek', 'Plane of Tactics', 'PoP', 168, 3 * 60 + 40],
  ['zeb', 'Zebuxoruk', 'Plane of Time', 'PoP', 168, 6 * 60 + 10],
  ['bert', 'Bertoxxulous', 'Plane of Disease', 'PoP', 168, -178],
  ['myth', 'Mithaniel Marr', 'Plane of Valor', 'PoP', 168, null],
  ['carp', 'Carprin Hydrae', 'Plane of Nightmare', 'PoP', 168, null],
  ['hate', 'Innoruuk', 'Plane of Hate', 'PoP', 168, -199],
  ['saryr', 'Saryrn', 'Torment', 'PoP', 168, 2 * D + 710],
  ['quarm', 'Gilgamesh', 'Plane of Earth', 'PoP', 168, null],
];

export const LAB_ROWS: BoardRowIn[] = T.map(([id, name, zone, expansion, hours, mins]) => ({
  boss_id: id, name, zone, expansion, timer_hours: hours, pqdi_url: null,
  next_spawn: mins === null ? null : new Date(LAB_NOW + mins * 60000).toISOString(),
}));
